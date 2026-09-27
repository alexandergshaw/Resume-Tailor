// N60 S4 (4b, OWED route-wiring coverage) -- the REACTION of the real cron
// route to the spend/mail reserves and the kill switch. The ledger MODULES are
// well covered (autoTailorSpendLedger/alertMailLedger/killSwitch tests); what
// had ZERO test power was their CONSUMPTION here: a fresh verifier (N60-V) ran
// three behaviour-inverting mutants against route.decouple.test.js and ALL
// THREE SURVIVED --
//   route.js:169  reservation forced to {ok:true,reserved:true} (ignore the cap)
//   route.js:175  `if (!reservation.reserved)` -> `if (false && ...)` (spend past cap)
//   route.js:300  `if (mailKill.disabled) continue;` -> `if (false)` (mail fails OPEN)
// because that file's admin fake makes every reserve succeed and never drives a
// refusal, so nothing observes what the route does when a reserve refuses or the
// switch is off.
//
// This file drives the REAL exported POST handler (the same entry point Vercel
// cron hits) with an authorized Request, and mocks the ledger/mail/db
// collaborators at the module boundary -- exactly the sibling-cron pattern
// (route.decouple.test.js, position-glossary/route.test.js). Stubbing the ledger
// boundary is deliberate and correct here: the point is the route's REACTION to
// a refusal, not the ledger's own atomicity (covered by its own suite). Reserve
// and mail-kill outcomes are controlled per test; tailorAndQueueOne / sendEmail /
// reserveMailSend / recordNotifiedExternalIds are spies whose call/no-call is the
// observable.
//
// GREEN-ON-HEAD note (honest): the wiring at HEAD 24c6fa0 is correct by
// inspection, so tests 1-4 PASS on the working tree and their POWER is proven by
// mutation (each named surviving mutant now DIES -- see tests.route-wiring.md).
// The CAP-CLAMP block (item 6) is the exception: it encodes the OWNER RULING and
// is RED on HEAD for stored 0 / negative / non-numeric caps, which the current
// `Math.max(1, cap || 10)` mishandles -- a genuine hand-off red for the
// implementer. Each such case is labelled below.
//
// NON-VACUITY: every "X not called" assertion is paired with a control in which
// the same path DOES reach X, so a route that never got far enough (for an
// unrelated reason) cannot pass the assertion vacuously.

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
// The three N60 S4 ledger boundaries, controlled per test.
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
import { sendEmail } from "@/lib/email/sendEmail";
import { tailorAndQueueOne } from "@/lib/feed/tailorAndQueue";
import { selectEmailOnlyJobs, recordNotifiedExternalIds } from "@/lib/feed/emailOnlyMatches";
import { selectQueueCandidates } from "@/lib/feed/selectQueueCandidates";
import { reserveDailyTailor } from "@/lib/feed/autoTailorSpendLedger";
import { reserveMailSend } from "@/lib/email/alertMailLedger";
import { isFeatureDisabled } from "@/lib/feed/killSwitch";
import { SKIP_REASONS } from "@/lib/feed/autoTailorRunLog";
import { MAX_TAILORS_PER_USER_PER_UTC_DAY } from "@/lib/feed/autoTailorBounds";
import { POST } from "./route.js";

const ACCOUNT_EMAIL = "acct@example.com";

// A chainable, thenable Supabase query builder. Since the ledger/tailor/email
// collaborators are mocked at the module boundary, the admin fake only has to
// serve the saved_searches selects, feed_postings, notifications insert, and the
// account-email lookup. It never resolves a reserve (those go through the mocked
// modules).
function makeAdmin({ rows = [], feedPostings = [{ id: "p1", source_posting_id: "gh-1" }] } = {}) {
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
        if (calls.some((c) => c[0] === "update")) return { data: null, error: null };
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
  return {
    from: (table) => builder(table),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { email: ACCOUNT_EMAIL } }, error: null })),
      },
    },
    storage: { from: () => ({ download: vi.fn(async () => ({ data: null, error: { message: "nf" } })) }) },
    rpc: vi.fn(async () => ({ data: null, error: { message: "rpc should not be reached in this file" } })),
  };
}

function autoSearch(overrides = {}) {
  return {
    id: "ss-auto",
    user_id: "user-1",
    name: "Auto search",
    auto_tailor_enabled: true,
    email_on_new_jobs: false,
    auto_tailor_daily_cap: 10,
    ...overrides,
  };
}
function emailSearch(overrides = {}) {
  return {
    id: "ss-email",
    user_id: "user-1",
    name: "Email search",
    auto_tailor_enabled: false,
    email_on_new_jobs: true,
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
const resultFor = (body, userId = "user-1") =>
  body.results.find((r) => r && r.userId === userId);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  // Sensible per-test defaults; tests override what they exercise.
  isFeatureDisabled.mockResolvedValue({ ok: true, disabled: false });
  reserveDailyTailor.mockResolvedValue({ ok: true, reserved: true, usedToday: 1 });
  reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
  tailorAndQueueOne.mockResolvedValue(null);
  selectQueueCandidates.mockReturnValue([]);
  selectEmailOnlyJobs.mockReturnValue({ jobs: [], externalIds: [] });
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// TEST 1 -- a refused reserve stops the user's spend (KILLS route.js:169, :175)
// ---------------------------------------------------------------------------
describe("a refused daily reserve stops tailoring and breaks the user's run", () => {
  // Two auto searches, each yielding one candidate, so a build that does NOT
  // break the outer loop would call reserveDailyTailor TWICE. The correct build
  // refuses on the first and breaks, so it calls it exactly ONCE.
  const twoSearches = () => [autoSearch({ id: "ss-1" }), autoSearch({ id: "ss-2" })];

  it("does not tailor, records PER_DAY_CEILING, and reserves only once (break) when the ceiling is reached", async () => {
    reserveDailyTailor.mockResolvedValue({
      ok: true,
      reserved: false,
      reason: "per_day_ceiling_reached",
      usedToday: MAX_TAILORS_PER_USER_PER_UTC_DAY,
    });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: twoSearches() }));

    const { res, body } = await runPost();
    expect(res.status).toBe(200);

    // KILLS :169 (forced reserved:true -> would tailor) and :175 (removed break
    // -> would fall through to tailorAndQueueOne). Driven through the real POST.
    expect(tailorAndQueueOne).not.toHaveBeenCalled();
    // The outer loop broke: only the first search's first candidate reserved.
    expect(reserveDailyTailor).toHaveBeenCalledTimes(1);
    const r = resultFor(body);
    expect(r.skipped[SKIP_REASONS.PER_DAY_CEILING]).toBeGreaterThanOrEqual(1);
    // Not mislabelled as a counter-unreadable refusal.
    expect(r.skipped[SKIP_REASONS.COUNTER_UNREADABLE]).toBeUndefined();
  });

  it("[control] a granted reserve DOES tailor and reserves once per candidate across both searches", async () => {
    // Non-vacuity: proves the route actually reaches the reserve/tailor, so the
    // "not called" assertion above is measuring a suppression, not a dead path.
    reserveDailyTailor.mockResolvedValue({ ok: true, reserved: true, usedToday: 1 });
    tailorAndQueueOne.mockResolvedValue({ title: "Role", applicationId: "app-1" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: twoSearches() }));

    const { body } = await runPost();
    expect(tailorAndQueueOne).toHaveBeenCalledTimes(2);
    expect(reserveDailyTailor).toHaveBeenCalledTimes(2);
    expect(resultFor(body).tailored).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TEST 2 -- an unreadable counter is NOT an idle day (distinct reason + break)
// ---------------------------------------------------------------------------
describe("an unreadable spend counter refuses and is recorded distinctly", () => {
  const twoSearches = () => [autoSearch({ id: "ss-1" }), autoSearch({ id: "ss-2" })];

  it("does not tailor, records COUNTER_UNREADABLE (not PER_DAY_CEILING), and breaks", async () => {
    reserveDailyTailor.mockResolvedValue({ ok: false, reason: "counter_unreadable" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: twoSearches() }));

    const { body } = await runPost();
    expect(tailorAndQueueOne).not.toHaveBeenCalled();
    expect(reserveDailyTailor).toHaveBeenCalledTimes(1); // broke the outer loop
    const r = resultFor(body);
    // A failed read must never look like an idle day or a reached ceiling. The
    // reason string is what discriminates -- a build that treats !ok the same as
    // !reserved records the wrong reason here.
    expect(r.skipped[SKIP_REASONS.COUNTER_UNREADABLE]).toBeGreaterThanOrEqual(1);
    expect(r.skipped[SKIP_REASONS.PER_DAY_CEILING]).toBeUndefined();
    // And the run's zero-reason must reflect the unreadable counter, not "no new postings".
    expect(r.zeroReason).toBe("spend_counter_unreadable");
  });
});

// ---------------------------------------------------------------------------
// TEST 3 -- the mail kill switch gates BOTH send paths (KILLS route.js:300, :355)
// ---------------------------------------------------------------------------
describe("the alert-mail kill switch stops every send (both paths)", () => {
  it("emailNewJobs: a disabled switch sends nothing and reserves no mail slot", async () => {
    isFeatureDisabled.mockImplementation(async (_admin, key) =>
      key === "alert_mail" ? { ok: true, disabled: true } : { ok: true, disabled: false },
    );
    // Reserve succeeds so that a build which SKIPS the kill-switch guard would
    // actually reach sendEmail -- makes the kill-switch the ONLY thing stopping
    // the send, so the assertion isolates :300.
    reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
    reserveDailyTailor.mockResolvedValue({ ok: true, reserved: true, usedToday: 1 });
    tailorAndQueueOne.mockResolvedValue({ title: "Role", company: "Acme", applicationId: "app-1" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    // email_on_new_jobs:true so the queued job is emailable and emailNewJobs runs.
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch({ email_on_new_jobs: true })] }));

    await runPost();
    // KILLS :300 (`if(mailKill.disabled) continue` -> `if(false)`): under the
    // mutant the continue never fires and reserveMailSend + sendEmail run.
    expect(reserveMailSend).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emailOnlyNewJobs: a disabled switch sends nothing and does NOT mark postings notified", async () => {
    isFeatureDisabled.mockImplementation(async (_admin, key) =>
      key === "alert_mail" ? { ok: true, disabled: true } : { ok: true, disabled: false },
    );
    reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
    selectEmailOnlyJobs.mockReturnValue({
      jobs: [{ title: "Emailed role", url: "u", savedSearchName: "Email search", emailOnNewJobs: true, externalId: "gh-9" }],
      externalIds: ["gh-9"],
    });
    createAdminClient.mockReturnValue(makeAdmin({ rows: [emailSearch()] }));

    await runPost();
    // KILLS :355 (the email-only copy of the guard).
    expect(reserveMailSend).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    // Carry-forward preserved: a suppressed batch never marks its postings
    // notified, so they are retried, not silently dropped (AC-E2).
    expect(recordNotifiedExternalIds).not.toHaveBeenCalled();
  });

  it("[control] emailNewJobs: an enabled switch DOES reserve a slot and send", async () => {
    // Non-vacuity for the emailNewJobs suppression above.
    isFeatureDisabled.mockResolvedValue({ ok: true, disabled: false });
    reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
    reserveDailyTailor.mockResolvedValue({ ok: true, reserved: true, usedToday: 1 });
    tailorAndQueueOne.mockResolvedValue({ title: "Role", company: "Acme", applicationId: "app-1" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch({ email_on_new_jobs: true })] }));

    await runPost();
    expect(reserveMailSend).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalled();
  });

  it("[control] emailOnlyNewJobs: an enabled switch DOES send and marks postings notified", async () => {
    // Non-vacuity for the email-only suppression above (incl. recordNotifiedExternalIds).
    isFeatureDisabled.mockResolvedValue({ ok: true, disabled: false });
    reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
    sendEmail.mockResolvedValue({ ok: true });
    selectEmailOnlyJobs.mockReturnValue({
      jobs: [{ title: "Emailed role", url: "u", savedSearchName: "Email search", emailOnNewJobs: true, externalId: "gh-9" }],
      externalIds: ["gh-9"],
    });
    createAdminClient.mockReturnValue(makeAdmin({ rows: [emailSearch()] }));

    await runPost();
    expect(reserveMailSend).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalled();
    expect(recordNotifiedExternalIds).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TEST 4 -- an UNREADABLE mail switch fails CLOSED (owner ruling), both paths
// ---------------------------------------------------------------------------
describe("an unreadable alert-mail switch fails closed, not open", () => {
  it("emailNewJobs: {ok:false,disabled:true} suppresses the send", async () => {
    // isFeatureDisabled fails CLOSED: a read error returns disabled:true with
    // ok:false. The route must honour `disabled` regardless of `ok` -- a build
    // that gated on `mailKill.ok && mailKill.disabled` would fail OPEN here.
    isFeatureDisabled.mockImplementation(async (_admin, key) =>
      key === "alert_mail"
        ? { ok: false, disabled: true, reason: "kill_switch_unreadable" }
        : { ok: true, disabled: false },
    );
    reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
    reserveDailyTailor.mockResolvedValue({ ok: true, reserved: true, usedToday: 1 });
    tailorAndQueueOne.mockResolvedValue({ title: "Role", company: "Acme", applicationId: "app-1" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch({ email_on_new_jobs: true })] }));

    await runPost();
    expect(reserveMailSend).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emailOnlyNewJobs: {ok:false,disabled:true} suppresses the send and the notify", async () => {
    isFeatureDisabled.mockImplementation(async (_admin, key) =>
      key === "alert_mail"
        ? { ok: false, disabled: true, reason: "kill_switch_unreadable" }
        : { ok: true, disabled: false },
    );
    reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
    selectEmailOnlyJobs.mockReturnValue({
      jobs: [{ title: "Emailed role", url: "u", savedSearchName: "Email search", emailOnNewJobs: true, externalId: "gh-9" }],
      externalIds: ["gh-9"],
    });
    createAdminClient.mockReturnValue(makeAdmin({ rows: [emailSearch()] }));

    await runPost();
    expect(reserveMailSend).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordNotifiedExternalIds).not.toHaveBeenCalled();
  });

  // The [control] cases in TEST 3 (enabled switch -> send happens) are the
  // shared non-vacuity controls for these fail-closed assertions too.
});

// ---------------------------------------------------------------------------
// TEST 6 -- the per-user daily cap clamp (OWNER RULING; RED-on-HEAD cases marked)
// ---------------------------------------------------------------------------
// Drives the real route's cap computation and reads the cap handed to the
// ledger boundary (reserveDailyTailor's 3rd arg). Owner ruling: a FINITE 0
// passes through AS 0 (the migration's `p_cap < 1` guard then refuses -- a cap
// of zero means NO auto-tailoring); a negative clamps to 0 (never up to 1); only
// a MISSING or NON-FINITE value falls back to the default 10; the global ceiling
// (MAX_TAILORS_PER_USER_PER_UTC_DAY = 20) always caps from above. For an
// unattended spender the fallback must never mean "spend MORE than asked".
//
// This pins only the VALUE crossed at the boundary; that a p_cap<1 is actually
// refused is a DB guarantee proven by the migration-shape test, not here.
describe("the daily cap clamp hands the ledger the owner-ruled value", () => {
  async function capPassedFor(storedCap) {
    reserveDailyTailor.mockResolvedValue({ ok: true, reserved: true, usedToday: 1 });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch({ auto_tailor_daily_cap: storedCap })] }));
    await runPost();
    expect(reserveDailyTailor).toHaveBeenCalled();
    return reserveDailyTailor.mock.calls[0][2].cap;
  }

  it("NULL falls back to the default 10", async () => {
    expect(await capPassedFor(null)).toBe(10); // GREEN on HEAD
  });
  it("a stored 10 passes through as 10", async () => {
    expect(await capPassedFor(10)).toBe(10); // GREEN on HEAD
  });
  it("a stored 25 clamps to the global ceiling 20", async () => {
    expect(await capPassedFor(25)).toBe(20); // GREEN on HEAD
  });
  it("a FINITE 0 passes through as 0 (no auto-tailoring), NOT the default 10", async () => {
    // RED on HEAD: `Math.max(1, 0 || 10)` = 10. Owner ruling: 0.
    expect(await capPassedFor(0)).toBe(0);
  });
  it("a negative cap clamps to 0, not to 1 and not to the default", async () => {
    // RED on HEAD: `Math.max(1, -5 || 10)` = 1. Owner ruling: 0.
    expect(await capPassedFor(-5)).toBe(0);
  });
  it("a non-numeric cap falls back to the default 10 (never NaN across the boundary)", async () => {
    // RED on HEAD: `Math.max(1, "abc" || 10)` = NaN. Owner ruling: 10.
    expect(await capPassedFor("abc")).toBe(10);
  });
});
