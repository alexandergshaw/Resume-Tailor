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
import { tailorAndQueueOne, loadStorageBuffer } from "@/lib/feed/tailorAndQueue";
import { selectQueueCandidates } from "@/lib/feed/selectQueueCandidates";
import { reserveDailyTailor } from "@/lib/feed/autoTailorSpendLedger";
import { isFeatureDisabled } from "@/lib/feed/killSwitch";
import { POST } from "./route.js";

const ACCOUNT_EMAIL = "acct@example.com";

// last_run_at helpers, relative to real Date.now() so they hold whatever clock
// the route captures internally (offsets of minutes are robust to the ms-scale
// gap between here and processUser's own `now`).

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
// tailorAndQueueOne is called with { ..., savedSearchId }, so we can attribute a
// tailor to the search that produced it.

beforeEach(() => {
  vi.clearAllMocks();
  loadStorageBuffer.mockResolvedValue(Buffer.from("fixture source"));
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


describe("N170 actual cron document mode wiring",()=>{
 it("passes each of two searches independent stored output choices",async()=>{
  createAdminClient.mockReturnValue(makeAdmin({rows:[autoSearch({id:"resume-search",tailoring_document_mode:"resume_only"}),autoSearch({id:"both-search",tailoring_document_mode:"resume_cover"})]}));
  const {res}=await runPost();expect(res.status).toBe(200);
  expect(tailorAndQueueOne.mock.calls.map(([a])=>({id:a.savedSearchId,mode:a.tailoringDocumentMode}))).toEqual([{id:"resume-search",mode:"resume_only"},{id:"both-search",mode:"resume_cover"}]);
  expect(tailorAndQueueOne.mock.calls.every(([a])=>Buffer.isBuffer(a.resumeBuffer)&&Buffer.isBuffer(a.coverLetterBuffer))).toBe(true);
 });
 it("does not call queue generation when the account has no source resume",async()=>{
  loadStorageBuffer.mockResolvedValue(null);createAdminClient.mockReturnValue(makeAdmin({rows:[autoSearch({id:"resume-search",tailoring_document_mode:"resume_only"}),autoSearch({id:"both-search",tailoring_document_mode:"resume_cover"})]}));
  const {res}=await runPost();expect(res.status).toBe(200);expect(loadStorageBuffer).toHaveBeenCalled();expect(tailorAndQueueOne).not.toHaveBeenCalled();expect(reserveDailyTailor).not.toHaveBeenCalled();
 });
});
