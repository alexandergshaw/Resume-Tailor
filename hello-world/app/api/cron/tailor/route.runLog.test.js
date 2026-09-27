// N60 S7 (4b) -- AC-R4's PERSISTED half, wired into the real cron route.
//
// The pure summariser and the durable store are pinned in their own suites
// (autoTailorRunLog*.test.js, autoTailorRunStore.test.js). What had NO coverage
// is their CONSUMPTION here: that the exported POST handler Vercel hits actually
// records one run per user, AFTER the spend, and that a failure to record can
// neither break the run nor cause a re-tailor (double spend). "Logging is not a
// gate" (brief item 1) is a property of the ROUTE, not of the store.
//
// Same harness as route.spendWiring.test.js: drive the real POST with an
// authorized Request and mock the collaborators at the module boundary. The
// NEW mock here is @/lib/feed/autoTailorRunStore.recordRun.
//
// RED ON HEAD (measured intent):
//   * "records one run per user" and "records WHY" are RED -- route.js at HEAD
//     never imports or calls recordRun, so the spy has zero calls.
//   * "logging is not a gate / no double spend" is GREEN-BUT-VACUOUS at HEAD
//     and is DISCLOSED as such: with recordRun uncalled, forcing it to reject
//     changes nothing, so the route trivially still returns ok. Its POWER is
//     proven by the mutation that makes recordRun a gate (tests.s7.md).
//     It is kept because once the wiring lands it is the only guard against a
//     log write aborting a run or triggering a retry.
//
// NON-VACUITY: each "recordRun called" assertion checks the payload it carried,
// so a build that calls it with the wrong data (or with an empty object) fails.

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
// The S7 store. Mocked so the route's CONSUMPTION is the observable; the store's
// own fail-soft contract is proven in autoTailorRunStore.test.js.
vi.mock("@/lib/feed/autoTailorRunStore", () => ({
  recordRun: vi.fn(async () => ({ ok: true })),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { tailorAndQueueOne } from "@/lib/feed/tailorAndQueue";
import { selectQueueCandidates } from "@/lib/feed/selectQueueCandidates";
import { reserveDailyTailor } from "@/lib/feed/autoTailorSpendLedger";
import { isFeatureDisabled } from "@/lib/feed/killSwitch";
import { recordRun } from "@/lib/feed/autoTailorRunStore";
import { POST } from "./route.js";

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
      return { data: [], error: null };
    };
    b.single = () => Promise.resolve(resolve());
    b.maybeSingle = () => Promise.resolve(resolve());
    b.then = (res, rej) => Promise.resolve(resolve()).then(res, rej);
    return b;
  }
  return {
    from: (table) => builder(table),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: "a@example.com" } }, error: null })) } },
    storage: { from: () => ({ download: vi.fn(async () => ({ data: null, error: { message: "nf" } })) }) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
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
const payloadFor = (userId) =>
  recordRun.mock.calls.map(([, run]) => run).find((run) => run && run.userId === userId);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret-value");
  vi.stubEnv("RESUME_TAILOR_API_URL", "https://app.example.com");
  isFeatureDisabled.mockResolvedValue({ ok: true, disabled: false });
  reserveDailyTailor.mockResolvedValue({ ok: true, reserved: true, usedToday: 1 });
  tailorAndQueueOne.mockResolvedValue(null);
  selectQueueCandidates.mockReturnValue([]);
  recordRun.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// The run is PERSISTED, once per user, carrying what happened (AC-R4).
// ---------------------------------------------------------------------------
describe("the cron persists one run row per user", () => {
  it("records a run for every user processed, carrying that user's tailored count", async () => {
    tailorAndQueueOne.mockResolvedValue({ title: "Role", applicationId: "app-1" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(
      makeAdmin({ rows: [autoSearch({ id: "ss-1", user_id: "user-1" }), autoSearch({ id: "ss-2", user_id: "user-2" })] }),
    );

    const { body } = await runPost();
    expect(body.ok).toBe(true);
    // One record per user.
    expect(recordRun).toHaveBeenCalledTimes(2);
    // NON-VACUITY: the payloads carry the real per-user summary, not an empty
    // object -- so a build that calls recordRun with the wrong data fails here.
    expect(payloadFor("user-1")).toMatchObject({ tailored: 1 });
    expect(payloadFor("user-2")).toMatchObject({ tailored: 1 });
  });

  it("records WHY a run did nothing -- a zero run still persists a reason", async () => {
    // AC-R4's whole point: an idle run is DISTINGUISHABLE and DURABLE. One
    // eligible search, no candidates -> tailored 0 with a non-null zeroReason.
    selectQueueCandidates.mockReturnValue([]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch()] }));

    await runPost();
    expect(recordRun).toHaveBeenCalledTimes(1);
    const run = payloadFor("user-1");
    expect(run).toBeTruthy();
    expect(run.tailored).toBe(0);
    expect(run.zeroReason, "a zero run persists a machine-readable reason").toBeTypeOf("string");
    expect(run.zeroReason.length).toBeGreaterThan(0);
  });

  it("records AFTER the spend, never before (spend precedes logging)", async () => {
    // Ordering guard: if recordRun ran before/inside the reserve+tailor loop, a
    // log failure could abort a run mid-spend or a retry could re-tailor. The
    // record must come after tailorAndQueueOne for the run it describes.
    tailorAndQueueOne.mockResolvedValue({ title: "Role", applicationId: "app-1" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch()] }));

    await runPost();
    expect(tailorAndQueueOne).toHaveBeenCalled();
    expect(recordRun).toHaveBeenCalled();
    const tailorOrder = tailorAndQueueOne.mock.invocationCallOrder[0];
    const recordOrder = recordRun.mock.invocationCallOrder[0];
    expect(recordOrder).toBeGreaterThan(tailorOrder);
  });
});

// ---------------------------------------------------------------------------
// LOGGING IS NOT A GATE. A failed record must not break the run or double-spend.
// DISCLOSED: GREEN-BUT-VACUOUS at HEAD (recordRun is uncalled there). Power is
// proven by the mutation that makes recordRun a gate -- see tests.s7.md.
// ---------------------------------------------------------------------------
describe("[not-a-gate] a failed run-log write neither breaks the run nor double-spends", () => {
  it("a rejected recordRun still returns ok with the correct totalQueued and reserves exactly once", async () => {
    recordRun.mockRejectedValue(new Error("insert failed"));
    tailorAndQueueOne.mockResolvedValue({ title: "Role", applicationId: "app-1" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch()] }));

    const { res, body } = await runPost();
    // The run is unaffected: it still succeeded and reported its work.
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.totalQueued).toBe(1);
    // The user's OUTCOME is unchanged: exactly one clean result for the user,
    // carrying the tailored count and NO error. A build that lets recordRun's
    // rejection propagate turns the run into an errored result (an extra
    // {userId,error} entry) -- logging becoming a gate. That is what this
    // catches; totalQueued alone does not (the error entry contributes 0).
    expect(body.results).toHaveLength(1);
    expect(body.results[0].userId).toBe("user-1");
    expect(body.results[0].tailored).toBe(1);
    expect(body.results[0].error, "a log failure must not mark the run errored").toBeUndefined();
    // NO DOUBLE SPEND: the log failure did not trigger a re-run of the spend.
    expect(reserveDailyTailor).toHaveBeenCalledTimes(1);
    expect(tailorAndQueueOne).toHaveBeenCalledTimes(1);
  });

  it("[control] recordRun succeeding does not change the spend count either", async () => {
    // Baseline for the no-double-spend assertion above: the same run with a
    // succeeding record spends exactly the same amount.
    recordRun.mockResolvedValue({ ok: true });
    tailorAndQueueOne.mockResolvedValue({ title: "Role", applicationId: "app-1" });
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Role" }]);
    createAdminClient.mockReturnValue(makeAdmin({ rows: [autoSearch()] }));

    const { body } = await runPost();
    expect(body.totalQueued).toBe(1);
    expect(reserveDailyTailor).toHaveBeenCalledTimes(1);
    expect(tailorAndQueueOne).toHaveBeenCalledTimes(1);
  });
});
