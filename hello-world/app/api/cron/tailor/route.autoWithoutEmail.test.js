// N175: drive the real cron POST with deterministic no-provider dependencies.
// A queued posting and in-app notification are the oracle, not merely a helper
// call. Successful opted-in mail is the positive control for refusal/no-opt-in.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/feed/tailorAndQueue", () => ({
  loadStorageBuffer: vi.fn(async () => Buffer.from("resume-bytes")),
  loadAlreadyTrackedExternalIds: vi.fn(async () => new Set()),
  tailorAndQueueOne: vi.fn(),
}));
vi.mock("@/lib/feed/selectQueueCandidates", () => ({
  selectQueueCandidates: vi.fn(() => [{ id: "p1", source_posting_id: "job-1", title: "Engineer" }]),
  postingExternalId: (posting) => posting.source_posting_id,
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
vi.mock("@/lib/feed/autoTailorRunStore", () => ({ recordRun: vi.fn(async () => {}) }));

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { tailorAndQueueOne } from "@/lib/feed/tailorAndQueue";
import { reserveDailyTailor } from "@/lib/feed/autoTailorSpendLedger";
import { recordRun } from "@/lib/feed/autoTailorRunStore";
import { POST } from "./route.js";

function makeAdmin(emailOnNewJobs) {
  const notifications = [];
  const search = {
    id: "search-1", user_id: "user-1", name: "Engineering",
    auto_tailor_enabled: true, email_on_new_jobs: emailOnNewJobs,
    auto_tailor_daily_cap: 2, auto_tailor_min_interval_minutes: 60,
    last_run_at: null,
  };
  function from(table) {
    const calls = [];
    const chain = {};
    for (const method of ["select", "insert", "update", "eq", "order", "limit"]) {
      chain[method] = (...args) => {
        calls.push([method, ...args]);
        if (table === "notifications" && method === "insert") notifications.push(args[0]);
        return chain;
      };
    }
    const result = () => {
      if (table === "saved_searches") {
        if (calls.some(([method]) => method === "update")) return { data: null, error: null };
        const filter = calls.find(([method]) => method === "eq");
        return { data: filter && search[filter[1]] === filter[2] ? [search] : [], error: null };
      }
      if (table === "feed_postings") return { data: [{ id: "p1", source_posting_id: "job-1" }], error: null };
      if (table === "user_alert_settings") return { data: { alerts_paused: false }, error: null };
      return { data: null, error: null };
    };
    chain.single = chain.maybeSingle = () => Promise.resolve(result());
    chain.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  }
  return {
    from, notifications,
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: "account@example.com" } } })) } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "unit-test-cron");
  vi.stubEnv("RESEND_API_KEY", "unit-test-key");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret");
  vi.stubEnv("RESUME_TAILOR_API_URL", "https://app.example.com");
  tailorAndQueueOne.mockResolvedValue({
    title: "Engineer", company: "Example", url: "https://jobs.example.com/1",
    applicationId: "application-1", positionId: "position-1",
  });
  sendEmail.mockResolvedValue({ ok: false, refused: true, reason: "EMAIL_FROM not set" });
});
afterEach(() => vi.unstubAllEnvs());

describe("N175: auto-tailoring does not require email", () => {
  for (const mode of ["no-opt-in", "refused", "sent"]) {
    it(`queues and notifies when email is ${mode}`, async () => {
      const admin = makeAdmin(mode !== "no-opt-in");
      createAdminClient.mockReturnValue(admin);
      if (mode === "sent") {
        vi.stubEnv("EMAIL_FROM", "Resume Tailor <jobs@example.com>");
        sendEmail.mockResolvedValue({ ok: true, id: "mail-1" });
      }
      const response = await POST(new Request("http://localhost/api/cron/tailor", {
        method: "POST", headers: { authorization: "Bearer unit-test-cron" },
      }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(reserveDailyTailor).toHaveBeenCalledTimes(1);
      expect(tailorAndQueueOne).toHaveBeenCalledTimes(1);
      expect(body.totalQueued).toBe(1);
      expect(body.autoFeatureError).toBeNull();
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({ tailored: 1, zeroReason: null });
      expect(body.results[0]).not.toHaveProperty("error");
      expect(admin.notifications).toEqual([expect.objectContaining({
        user_id: "user-1", kind: "auto_tailor", related_application_id: "application-1",
      })]);
      expect(recordRun).toHaveBeenCalledWith(admin, expect.objectContaining({ tailored: 1, zeroReason: null }));
      if (mode === "no-opt-in") expect(sendEmail).not.toHaveBeenCalled();
      else expect(sendEmail).toHaveBeenCalledTimes(1);
    });
  }
});
