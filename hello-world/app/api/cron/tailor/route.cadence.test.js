// N60 SECOND CHUNK, Step A (4b) -- the cadence GATE inside the real cron route
// (AC2-C4b, brief items 1-3 and 6). "frequency" left unbuilt: the cron writes
// last_run_at (route.js:221-224) and NEVER reads it, and never reads
// auto_tailor_min_interval_minutes -- so every auto-enabled search is tailored on
// EVERY run regardless of any stored interval (MEASURED: grep cadence terms over
// route.js -> 0 hits; processUser :120-227 has no due-check).
//
// WHY DRIVE THE REAL POST, NOT A HELPER. The due-check must live in processUser's
// per-search loop, reached the same way Vercel reaches it -- through the exported
// POST handler. A direct call to an isAutoTailorDue helper would prove the helper
// works (that is cronSchedule.test.js's job) but NOT that the route consults it
// before tailoring. So this file mocks the collaborators at the module boundary
// (the sibling-cron pattern from route.spendWiring.test.js) and observes
// tailorAndQueueOne's call/no-call and the saved_searches update the route issues.
//
// WHAT IS RED AT HEAD, AND WHY (MEASURED, genuinely red):
//   - A within-interval search is TAILORED at HEAD (no due-check), so
//     "tailorAndQueueOne not called" FAILS.
//   - SKIP_REASONS.CADENCE_NOT_DUE does not exist at HEAD (undefined), so the
//     reason contract pin FAILS.
//   - THE RATCHET: at HEAD the last_run_at write at :221 runs for every processed
//     search; the guarantee this file adds -- that a NOT-DUE skip does NOT bump
//     last_run_at (the `continue` sits BEFORE :221) -- has no code to satisfy it
//     yet. This is R1, the headline silent failure: a skip that bumps the clock
//     pushes the next run further out every time and stops the search FOREVER.
//
// NON-VACUITY: every "not called" / "not written" assertion is paired with a
// control in which the SAME observable DOES fire (a due search tailors and its
// last_run_at IS written), so the negative is measuring a suppression, not a dead
// path. Per-assertion mutation proof + the reference build are in tests.stepA.md.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/feed/tailorAndQueue", () => ({
  loadStorageBuffer: vi.fn(async () => Buffer.from("resume-bytes")),
  loadAlreadyTrackedExternalIds: vi.fn(async () => new Set()),
  tailorAndQueueOne: vi.fn(async () => null),
}));
vi.mock("@/lib/feed/emailOnlyMatches", () => ({
  selectEmailOnlyJobs: vi.fn(() => ({ jobs: [], externalIds: [] })),
  loadAlreadyNotifiedExternalIds: vi.fn(async () => new Set()),
  recordNotifiedExternalIds: vi.fn(async () => {}),
}));
vi.mock("@/lib/feed/selectQueueCandidates", () => ({
  selectQueueCandidates: vi.fn(() => []),
  postingExternalId: vi.fn((p) => p?.source_posting_id || p?.id || null),
}));
vi.mock("@/lib/feed/autoTailorSpendLedger", () => ({
  reserveDailyTailor: vi.fn(async () => ({ ok: true, reserved: true, usedToday: 1 })),
}));
vi.mock("@/lib/email/alertMailLedger", () => ({
  reserveMailSend: vi.fn(async () => ({ ok: true, reserved: true })),
}));
vi.mock("@/lib/feed/killSwitch", () => ({
  isFeatureDisabled: vi.fn(async () => ({ ok: true, disabled: false })),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { tailorAndQueueOne } from "@/lib/feed/tailorAndQueue";
import { selectQueueCandidates } from "@/lib/feed/selectQueueCandidates";
import { reserveDailyTailor } from "@/lib/feed/autoTailorSpendLedger";
import { isFeatureDisabled } from "@/lib/feed/killSwitch";
import { SKIP_REASONS } from "@/lib/feed/autoTailorRunLog";
import { POST } from "./route.js";

const ACCOUNT_EMAIL = "acct@example.com";
const MIN = 60000;
const CADENCE_NOT_DUE = "cadence_not_due"; // the frozen SKIP_REASONS value (AC2-C4b)

// last_run_at helpers, relative to real Date.now() so they hold whatever clock
// the route captures internally (offsets of minutes are robust to the ms-scale
// gap between here and processUser's own `now`).
const minsAgo = (m) => new Date(Date.now() - m * MIN).toISOString();

// A chainable Supabase query fake that ALSO records the last_run_at writes the
// route issues, so a not-due skip's "no clock bump" (the ratchet) is observable.
// `savedSearchUpdates` collects { id, lastRunAt } for every
// saved_searches.update({last_run_at}).eq("id", <id>) chain the route runs.
function makeAdmin({ rows = [], feedPostings = [{ id: "p1", source_posting_id: "gh-1" }] } = {}) {
  const savedSearchUpdates = [];
  function builder(table) {
    const calls = [];
    const b = {};
    const rec = (name) => (...args) => {
      calls.push([name, ...args]);
      return b;
    };
    for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "in", "or", "order", "limit", "gte", "lte", "lt", "gt", "not", "is"]) {
      b[m] = rec(m);
    }
    const resolve = () => {
      if (table === "saved_searches") {
        const updateCall = calls.find((c) => c[0] === "update");
        if (updateCall) {
          const payload = updateCall[1] || {};
          const eqId = calls.find((c) => c[0] === "eq" && c[1] === "id");
          if ("last_run_at" in payload) {
            savedSearchUpdates.push({ id: eqId ? eqId[2] : null, lastRunAt: payload.last_run_at });
          }
          return { data: null, error: null };
        }
        return { data: rows, error: null };
      }
      if (table === "feed_postings") return { data: feedPostings, error: null };
      if (table === "notifications") return { data: null, error: null };
      return { data: [], error: null };
    };
    b.single = () => Promise.resolve(resolve());
    b.maybeSingle = () => Promise.resolve(resolve());
    b.then = (res, rej) => Promise.resolve(resolve()).then(res, rej);
    return b;
  }
  const admin = {
    from: (table) => builder(table),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { email: ACCOUNT_EMAIL } }, error: null })),
      },
    },
    storage: { from: () => ({ download: vi.fn(async () => ({ data: null, error: { message: "nf" } })) }) },
    rpc: vi.fn(async () => ({ data: null, error: { message: "rpc should not be reached in this file" } })),
  };
  admin.__savedSearchUpdates = savedSearchUpdates;
  return admin;
}

function autoSearch(overrides = {}) {
  return {
    id: "ss-auto",
    user_id: "user-1",
    name: "Auto search",
    auto_tailor_enabled: true,
    email_on_new_jobs: false,
    auto_tailor_daily_cap: 10,
    auto_tailor_min_interval_minutes: 60,
    last_run_at: null,
    ...overrides,
  };
}

const authedReq = () =>
  new Request("http://localhost/api/cron/tailor", {
    method: "POST",
    headers: { authorization: "Bearer s3cret" },
  });

async function runPost() {
  const res = await POST(authedReq());
  const body = await res.json();
  return { res, body };
}
const resultFor = (body, userId = "user-1") => body.results.find((r) => r && r.userId === userId);
// tailorAndQueueOne is called with { ..., savedSearchId }, so we can attribute a
// tailor to the search that produced it.
const tailoredIds = () => tailorAndQueueOne.mock.calls.map((c) => c[0]?.savedSearchId);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret-value");
  vi.stubEnv("RESUME_TAILOR_API_URL", "https://app.example.com");
  isFeatureDisabled.mockResolvedValue({ ok: true, disabled: false });
  reserveDailyTailor.mockResolvedValue({ ok: true, reserved: true, usedToday: 1 });
  tailorAndQueueOne.mockResolvedValue(null);
  // Every search yields one candidate, so tailoring WOULD happen unless the
  // due-check suppresses it -- that is what makes "not tailored" meaningful.
  selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// The reason contract the run log and this file agree on (AC2-C4b).
// ---------------------------------------------------------------------------
describe("SKIP_REASONS carries a distinct cadence reason", () => {
  it("CADENCE_NOT_DUE is the frozen string 'cadence_not_due'", () => {
    // RED on HEAD: the key is absent (undefined). Pins the exact machine reason
    // the run log's legibility guard (autoTailorRunLogMarkdown.test.js:146) then
    // forces human copy for.
    expect(SKIP_REASONS.CADENCE_NOT_DUE).toBe(CADENCE_NOT_DUE);
  });
});

// ---------------------------------------------------------------------------
// AC2-C4b -- a search inside its interval is SKIPPED (not tailored) with the
// cadence reason; a search past its interval is tailored (the paired control).
// ---------------------------------------------------------------------------
describe("the cron skips a search still inside its interval, and tailors one past it", () => {
  it("within-interval: does NOT tailor, records cadence_not_due", async () => {
    createAdminClient.mockReturnValue(
      makeAdmin({ rows: [autoSearch({ id: "ss-notdue", last_run_at: minsAgo(5), auto_tailor_min_interval_minutes: 60 })] }),
    );
    const { res, body } = await runPost();
    expect(res.status).toBe(200);
    // HEAD tailors regardless of cadence -> this fails at HEAD.
    expect(tailorAndQueueOne).not.toHaveBeenCalled();
    const r = resultFor(body);
    expect(r.skipped[CADENCE_NOT_DUE]).toBeGreaterThanOrEqual(1);
    // Not mislabelled as one of the existing skip causes.
    expect(r.skipped[SKIP_REASONS.PER_RUN_CAP]).toBeUndefined();
  });

  it("[control] past-interval: DOES tailor (proves 'not called' above is a suppression, not a dead path)", async () => {
    createAdminClient.mockReturnValue(
      makeAdmin({ rows: [autoSearch({ id: "ss-due", last_run_at: minsAgo(120), auto_tailor_min_interval_minutes: 60 })] }),
    );
    const { body } = await runPost();
    expect(tailorAndQueueOne).toHaveBeenCalledTimes(1);
    expect(tailoredIds()).toContain("ss-due");
    expect(resultFor(body).skipped[CADENCE_NOT_DUE]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// THE RATCHET (R1, brief item 2) -- a not-due skip must NOT bump last_run_at, or
// the interval never elapses and the search is skipped forever.
// Instrument: a SINGLE-PASS write-spy -- the admin fake records every
// last_run_at update. Chosen over a two-pass simulation because the write IS the
// mechanism (the `continue` at the loop top sits BEFORE the :221 write): observing
// that no last_run_at update is issued for the not-due search is a direct,
// complete proof of the guarantee, and the paired due-search control proves the
// spy can observe a write at all (so "no write" is not vacuous). A two-pass
// simulation would prove the same consequence more indirectly; it is noted as the
// stronger-but-unneeded alternative in tests.stepA.md.
// ---------------------------------------------------------------------------
describe("a not-due skip does NOT advance last_run_at (the ratchet guard)", () => {
  it("within-interval: no last_run_at write is issued for the skipped search", async () => {
    const admin = makeAdmin({
      rows: [autoSearch({ id: "ss-notdue", last_run_at: minsAgo(5), auto_tailor_min_interval_minutes: 60 })],
    });
    createAdminClient.mockReturnValue(admin);
    await runPost();
    const bumps = admin.__savedSearchUpdates.filter((u) => u.id === "ss-notdue");
    expect(bumps, "a not-due skip bumped last_run_at -- the search will never become due again").toEqual([]);
  });

  it("[control] past-interval: last_run_at IS written for the processed search (spy can observe a write)", async () => {
    const admin = makeAdmin({
      rows: [autoSearch({ id: "ss-due", last_run_at: minsAgo(120), auto_tailor_min_interval_minutes: 60 })],
    });
    createAdminClient.mockReturnValue(admin);
    await runPost();
    const bumps = admin.__savedSearchUpdates.filter((u) => u.id === "ss-due");
    expect(bumps.length).toBeGreaterThanOrEqual(1);
    expect(typeof bumps[0].lastRunAt).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// continue, NOT break (brief item 3) -- a sibling search may be due even when an
// earlier one is not; a `break` would strand every search after the first not-due
// one in the user's list.
// ---------------------------------------------------------------------------
describe("a not-due search does not stop its due siblings (continue, not break)", () => {
  it("[not-due, due]: the due sibling AFTER a not-due one is still tailored", async () => {
    createAdminClient.mockReturnValue(
      makeAdmin({
        rows: [
          autoSearch({ id: "ss-notdue", last_run_at: minsAgo(5), auto_tailor_min_interval_minutes: 60 }),
          autoSearch({ id: "ss-due", last_run_at: minsAgo(120), auto_tailor_min_interval_minutes: 60 }),
        ],
      }),
    );
    const { body } = await runPost();
    // With `break`, the loop stops at ss-notdue and ss-due is never reached.
    expect(tailoredIds()).toContain("ss-due");
    // The not-due one is still skipped, not tailored.
    expect(tailoredIds()).not.toContain("ss-notdue");
    expect(resultFor(body).skipped[CADENCE_NOT_DUE]).toBeGreaterThanOrEqual(1);
  });

  it("[control] [due, due]: both are tailored (proves the harness can process two searches)", async () => {
    createAdminClient.mockReturnValue(
      makeAdmin({
        rows: [
          autoSearch({ id: "ss-due-1", last_run_at: minsAgo(120), auto_tailor_min_interval_minutes: 60 }),
          autoSearch({ id: "ss-due-2", last_run_at: minsAgo(120), auto_tailor_min_interval_minutes: 60 }),
        ],
      }),
    );
    await runPost();
    expect(tailoredIds()).toContain("ss-due-1");
    expect(tailoredIds()).toContain("ss-due-2");
  });
});

// ---------------------------------------------------------------------------
// NULL TOLERANCE (brief item 6) -- a NULL last_run_at (never run) and a NULL
// interval must both read as DUE, never "never run again".
// ---------------------------------------------------------------------------
describe("NULL means due, never frozen out", () => {
  it("a never-run search (last_run_at null) is tailored", async () => {
    createAdminClient.mockReturnValue(
      makeAdmin({ rows: [autoSearch({ id: "ss-null", last_run_at: null, auto_tailor_min_interval_minutes: 60 })] }),
    );
    await runPost();
    expect(tailoredIds()).toContain("ss-null");
  });

  it("an old search with a NULL interval is tailored (null interval != infinite interval)", async () => {
    createAdminClient.mockReturnValue(
      makeAdmin({
        rows: [autoSearch({ id: "ss-nullint", last_run_at: minsAgo(24 * 60), auto_tailor_min_interval_minutes: null })],
      }),
    );
    await runPost();
    expect(tailoredIds()).toContain("ss-nullint");
  });
});
