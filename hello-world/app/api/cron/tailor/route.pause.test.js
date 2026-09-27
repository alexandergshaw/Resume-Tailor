// N60 S6 (4b/TDD) -- AC-E4: the account-level pause SUPPRESSES alert mail on
// BOTH send paths, carries the undelivered postings forward, fails CLOSED, and
// is scoped to mail ONLY (it does not stop tailoring). Driven through the real
// exported POST the cron hits.
//
// SCOPE READING (AC-E4 is not silent): "A single control pauses all job-alert
// EMAIL for the account ... without altering any per-search flag." The AC
// specifies MAIL, not tailoring. So the pause suppresses the two mail paths and
// leaves auto-tailoring running -- Block B pins that a paused account still
// queues jobs (the over-fire control) while sending no mail.
//
// HOW THE PAUSE IS DRIVEN: through the REAL read path, not a mock of the reader.
// The cron reads the pause from user_alert_settings (design §6.3,
// readAlertsPaused(admin, userId)); this test drives that read through the admin
// stub's user_alert_settings rows, so it exercises the actual read+gate JOIN and
// does not depend on the reader module existing at HEAD.
//
// FAIL DIRECTION: an unreadable setting must behave like paused (fail CLOSED),
// never like not-paused -- Block C. Driven by making the user_alert_settings
// read error.
//
// RED on HEAD: cron/tailor/route.js does not read user_alert_settings and does
// not gate either mail path on the pause -- so a paused account still gets mail
// (sendEmail called; email-only postings marked notified). The stub's paused row
// is simply ignored, which is exactly the defect this pins.
//
// NON-VACUITY: every "sendEmail not called" is paired with a not-paused control
// where the SAME path DOES send, so a route that never reached the send cannot
// pass vacuously.

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
// Keep selectEmailableJobs / groupJobsForAccount REAL so the route actually
// groups and reaches the send; buildNewJobsEmail is a harmless spy.
vi.mock("@/lib/email/newJobsEmail", async (orig) => {
  const actual = await orig();
  return { ...actual, buildNewJobsEmail: vi.fn(() => ({ subject: "s", html: "h", text: "t" })) };
});

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { selectEmailOnlyJobs, recordNotifiedExternalIds } from "@/lib/feed/emailOnlyMatches";
import { selectQueueCandidates } from "@/lib/feed/selectQueueCandidates";
import { tailorAndQueueOne } from "@/lib/feed/tailorAndQueue";
import { reserveMailSend } from "@/lib/email/alertMailLedger";
import { isFeatureDisabled } from "@/lib/feed/killSwitch";
import { POST } from "./route.js";

const ACCOUNT_EMAIL = "acct@example.com";

// admin stub: `alertsPaused` seeds the user_alert_settings row the pause reader
// reads; `pauseError` makes that read fail (fail-closed case).
function makeAdmin({ rows = [], alertsPaused, pauseError = false } = {}) {
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
      if (table === "user_alert_settings") {
        if (pauseError) return { data: null, error: { message: "settings read failed" } };
        return { data: alertsPaused === undefined ? null : { alerts_paused: alertsPaused }, error: null };
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
  return { id: "ss-email", user_id: "user-1", name: "Email search", auto_tailor_enabled: false, email_on_new_jobs: true, ...overrides };
}
function autoSearch(overrides = {}) {
  return { id: "ss-auto", user_id: "user-1", name: "Auto search", auto_tailor_enabled: true, email_on_new_jobs: true, auto_tailor_daily_cap: 5, ...overrides };
}
function emailOnlyJobs() {
  return {
    jobs: [{ title: "Emailed role", url: "u", savedSearchName: "Email search", emailOnNewJobs: true, externalId: "gh-9" }],
    externalIds: ["gh-9"],
  };
}

const authedReq = () =>
  new Request("http://localhost/api/cron/tailor", { method: "POST", headers: { authorization: "Bearer s3cret" } });
const runPost = async () => POST(authedReq());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret-value");
  vi.stubEnv("RESUME_TAILOR_API_URL", "https://app.example.com");
  isFeatureDisabled.mockResolvedValue({ ok: true, disabled: false });
  reserveMailSend.mockResolvedValue({ ok: true, reserved: true });
  sendEmail.mockResolvedValue({ ok: true, id: "resend-1" });
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// Block A -- the email-only alert path: paused suppresses the send AND carries
// the postings forward (they are NOT marked notified), so unpausing resumes.
// ---------------------------------------------------------------------------
describe("the pause suppresses email-only alert mail and carries postings forward (AC-E4)", () => {
  beforeEach(() => {
    selectEmailOnlyJobs.mockReturnValue(emailOnlyJobs());
  });

  it("PAUSED: sends no email-only alert and does NOT mark postings notified [RED on HEAD]", async () => {
    createAdminClient.mockReturnValue(makeAdmin({ rows: [emailSearch()], alertsPaused: true }));
    await runPost();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordNotifiedExternalIds).not.toHaveBeenCalled();
  });

  it("[control] NOT paused: DOES send and DOES mark postings notified", async () => {
    createAdminClient.mockReturnValue(makeAdmin({ rows: [emailSearch()], alertsPaused: false }));
    await runPost();
    expect(sendEmail).toHaveBeenCalled();
    expect(recordNotifiedExternalIds).toHaveBeenCalled();
  });

  it("FAIL CLOSED: an unreadable setting suppresses mail exactly as a deliberate pause does [RED on HEAD]", async () => {
    createAdminClient.mockReturnValue(makeAdmin({ rows: [emailSearch()], pauseError: true }));
    await runPost();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(recordNotifiedExternalIds).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Block B -- the auto-tailor new-jobs email path: paused suppresses the email
// but NOT the tailoring (mail-only scope, AC-E4).
// ---------------------------------------------------------------------------
describe("the pause suppresses the auto-tailor new-jobs email but not the tailoring (AC-E4 scope)", () => {
  beforeEach(() => {
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "T" }]);
    tailorAndQueueOne.mockResolvedValue({ title: "T", company: "C", applicationId: "a1", positionId: "p1" });
  });

  it("PAUSED: sends no new-jobs email, yet STILL tailors and queues the job [RED on HEAD]", async () => {
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch()], alertsPaused: true }));
    await runPost();
    // Mail is suppressed...
    expect(sendEmail).not.toHaveBeenCalled();
    // ...but the pause is scoped to mail: tailoring still ran (over-fire control).
    expect(tailorAndQueueOne).toHaveBeenCalled();
  });

  it("[control] NOT paused: DOES send the new-jobs email (and tailors)", async () => {
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch()], alertsPaused: false }));
    await runPost();
    expect(tailorAndQueueOne).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalled();
  });
});
