// N60 S5 (4b/TDD) -- the ROUTE's consumption of S5's email changes, driven
// through the real exported POST (the entry Vercel cron hits). Two S5 properties
// that only exist at the route boundary:
//
//  (1) AC-E5 carry-forward: when a send does NOT succeed FOR ANY REASON, the
//      postings are NOT marked notified, so they carry forward and are retried
//      rather than silently lost. HEAD marks notified whenever sendEmail's result
//      is not `skipped` -- which is correct for the missing-key skip but WRONG for
//      S5's new missing-EMAIL_FROM `refused` shape. Guard the CLASS ("record only
//      on a real send"), and prove it BITES on the NEW member (`refused`) as well
//      as the already-handled one (`skipped`).
//
//  (2) AC-E3 end-to-end: a message the route sends carries a working unsubscribe
//      link -- the route hands buildNewJobsEmail an absolute unsubscribe URL, and
//      when it cannot build one (the unsubscribe secret is unset) it REFUSES to
//      send rather than mailing a remedy-less message (AC-E5 direction; owner item
//      G.4). The link is embedded by buildNewJobsEmail (newJobsEmail.unsubscribe
//      .test.js); this file pins that the route actually supplies it.
//
// DESIGN NOTE (flagged for the architect/implementer): the "refuse to send when
// there is no unsubscribe link" decision is placed at the ROUTE, not inside
// buildNewJobsEmail, so buildNewJobsEmail keeps its one-argument contract and the
// S2-authored (protected) buildNewJobsEmail tests stay green. The route reads the
// site base from RESUME_TAILOR_API_URL (the repo's established base-URL env, 12
// uses); if the implementer picks another env, update the stubEnv here, not the
// assertion.
//
// NON-VACUITY: every "not called" is paired with a control where the same path
// DOES call it, so a route that never reached the send cannot pass vacuously.

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
// Partial mock: keep selectEmailableJobs / groupJobsForAccount REAL (so the route
// actually groups and reaches the send), spy only buildNewJobsEmail so its call
// arguments are observable.
vi.mock("@/lib/email/newJobsEmail", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    buildNewJobsEmail: vi.fn(() => ({ subject: "s", html: "h", text: "t" })),
  };
});

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { selectEmailOnlyJobs, recordNotifiedExternalIds } from "@/lib/feed/emailOnlyMatches";
import { reserveMailSend } from "@/lib/email/alertMailLedger";
import { isFeatureDisabled } from "@/lib/feed/killSwitch";
import { buildNewJobsEmail } from "@/lib/email/newJobsEmail";
import { POST } from "./route.js";

const ACCOUNT_EMAIL = "acct@example.com";

function makeAdmin({ rows = [] } = {}) {
  function builder(table) {
    const calls = [];
    const b = {};
    const rec = (name) => (...a) => {
      calls.push([name, ...a]);
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
      if (table === "feed_postings") return { data: [{ id: "p1", source_posting_id: "gh-1" }], error: null };
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
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: ACCOUNT_EMAIL } }, error: null })) } },
    storage: { from: () => ({ download: vi.fn(async () => ({ data: null, error: { message: "nf" } })) }) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
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
  return { res, body: await res.json() };
}

// An emailable posting the email-only path will try to send about.
function emailOnlyJobs() {
  return {
    jobs: [{ title: "Emailed role", url: "u", savedSearchName: "Email search", emailOnNewJobs: true, externalId: "gh-9" }],
    externalIds: ["gh-9"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret-value");
  vi.stubEnv("RESUME_TAILOR_API_URL", "https://app.example.com");
  isFeatureDisabled.mockResolvedValue({ ok: true, disabled: false });
  reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
  selectEmailOnlyJobs.mockReturnValue(emailOnlyJobs());
  buildNewJobsEmail.mockReturnValue({ subject: "s", html: "h", text: "t" });
  createAdminClient.mockReturnValue(makeAdmin({ rows: [emailSearch()] }));
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// (1) Carry-forward: a send that did not succeed must not mark postings notified
// ---------------------------------------------------------------------------
describe("a send that did not succeed leaves postings unnotified (AC-E5 carry-forward)", () => {
  it("REFUSED send (unconfigured EMAIL_FROM) does NOT mark postings notified [RED on HEAD -- the new member]", async () => {
    // The S5 shape for a missing EMAIL_FROM: a refusal, distinct from `skipped`.
    // HEAD only checks `result.skipped`, so it treats this as a success and marks
    // notified -> the postings are permanently lost, not retried.
    sendEmail.mockResolvedValue({ ok: false, refused: true, reason: "EMAIL_FROM not set" });

    await runPost();

    expect(sendEmail).toHaveBeenCalled(); // the path reached the send (non-vacuity)
    expect(recordNotifiedExternalIds).not.toHaveBeenCalled();
  });

  it("[control] SKIPPED send (missing key) does NOT mark postings notified [already handled on HEAD]", async () => {
    sendEmail.mockResolvedValue({ ok: false, skipped: true, reason: "RESEND_API_KEY not set" });
    await runPost();
    expect(sendEmail).toHaveBeenCalled();
    expect(recordNotifiedExternalIds).not.toHaveBeenCalled();
  });

  it("[control] a genuinely sent email DOES mark postings notified", async () => {
    sendEmail.mockResolvedValue({ ok: true, id: "resend-1" });
    await runPost();
    expect(sendEmail).toHaveBeenCalled();
    expect(recordNotifiedExternalIds).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (2) Every sent message carries a working unsubscribe link (AC-E3 end-to-end)
// ---------------------------------------------------------------------------
describe("the route supplies buildNewJobsEmail a working unsubscribe link (AC-E3)", () => {
  it("passes an absolute unsubscribe URL for the account to buildNewJobsEmail [RED on HEAD]", async () => {
    sendEmail.mockResolvedValue({ ok: true, id: "resend-1" });
    await runPost();

    expect(buildNewJobsEmail).toHaveBeenCalled();
    const opts = buildNewJobsEmail.mock.calls[0][1];
    expect(opts).toBeTruthy();
    expect(typeof opts.unsubscribeUrl).toBe("string");
    expect(opts.unsubscribeUrl).toMatch(/^https?:\/\/.+\/api\/alerts\/unsubscribe\?token=/);
  });
});
