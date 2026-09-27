// N60 S1 (4b) -- AC-R6 (the two features are independent) + AC-R4's response half.
//
// At HEAD one select feeds both features:
//     admin.from("saved_searches").select("*")
//       .or("auto_tailor_enabled.eq.true,email_on_new_jobs.eq.true")   (route.js:290-293)
// and any error on it returns 500 at :295 BEFORE either feature runs. If the live
// `auto_tailor_enabled` column is missing or errors, email-only alerts -- a feature
// that IS reachable today -- go down with it, invisibly. AC-R6: "an error reading,
// filtering on, or processing the auto-tailor flag leaves email-only alert delivery
// unaffected, and vice versa", each failure reported per feature (AC-R4).
//
// This drives the REAL exported POST handler. Its DB/mail/LLM collaborators are
// mocked at the module boundary exactly as the sibling cron test does
// (app/api/cron/position-glossary/route.test.js), but the admin fake resolves the
// saved-search select PER PREDICATE, so the single coupled query and a decoupled
// pair of queries behave differently and observably. `@/lib/email/newJobsEmail`
// is left REAL on purpose: whether the route groups via `groupJobsByRecipient`
// (pre-S2) or `groupJobsForAccount` (post-S2), the real module supplies it, so
// this file does not couple to the S2 rename.
//
// RED ON HEAD: the coupled query makes every "does not 500 / other feature still
// runs / per-feature error reported" assertion fail because the route 500s first,
// and the eligibility-count assertions fail because those response fields do not
// exist yet. Reasons are per-test in tests.r1.md.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/feed/tailorAndQueue", () => ({
  loadStorageBuffer: vi.fn(async () => null),
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

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import {
  loadStorageBuffer,
  tailorAndQueueOne,
} from "@/lib/feed/tailorAndQueue";
import { selectEmailOnlyJobs } from "@/lib/feed/emailOnlyMatches";
import { selectQueueCandidates } from "@/lib/feed/selectQueueCandidates";
import { POST } from "./route.js";

const ACCOUNT_EMAIL = "acct@example.com";

// A chainable query builder that records its filter calls and resolves via a
// per-table resolver. Unlike test/helpers/supabaseMock.js this lets the resolver
// see WHICH predicate a saved_searches select used -- required to make the coupled
// vs decoupled query distinguishable.
function makeAdmin(cfg) {
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
    b.single = () => Promise.resolve(cfg.resolve(table, calls));
    b.maybeSingle = () => Promise.resolve(cfg.resolve(table, calls));
    b.then = (res, rej) => Promise.resolve(cfg.resolve(table, calls)).then(res, rej);
    return b;
  }
  return {
    from: (table) => builder(table),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { email: ACCOUNT_EMAIL } }, error: null })),
      },
    },
    storage: {
      from: () => ({ download: vi.fn(async () => ({ data: null, error: { message: "nf" } })) }),
    },
    // N60 S4: cron/tailor/route.js now reserves a slot via rpc before every
    // tailor and every mail send. This file's assertions are about the two
    // eligibility queries' independence, not the ledger, so the default here
    // models a healthy, freshly-unspent counter (every reserve succeeds) --
    // the same as a real project with no prior spend today. A real admin
    // client always exposes `.rpc`; nothing here narrows what any test below
    // asserts.
    rpc: vi.fn(async (fn) => {
      if (fn === "reserve_auto_tailor_slot") return { data: [{ reserved: true, used_today: 1 }], error: null };
      if (fn === "reserve_alert_mail_slot") return { data: [{ reserved: true, blocked_by: null }], error: null };
      return { data: null, error: { message: `unmocked rpc ${fn}` } };
    }),
  };
}

// failPredicate: "auto" | "email" | null -- which saved_searches select errors.
function adminFor({ failPredicate = null, rows = [], feedPostings = [] } = {}) {
  return makeAdmin({
    resolve(table, calls) {
      if (table === "saved_searches") {
        if (calls.some((c) => c[0] === "update")) return { data: null, error: null };
        const filter = calls
          .filter((c) => c[0] === "or" || c[0] === "eq")
          .map((c) => JSON.stringify(c.slice(1)))
          .join(" ");
        const refsAuto = /auto_tailor_enabled/.test(filter);
        const refsEmail = /email_on_new_jobs/.test(filter);
        if (failPredicate === "auto" && refsAuto) return { data: null, error: { message: "auto column boom" } };
        if (failPredicate === "email" && refsEmail) return { data: null, error: { message: "email column boom" } };
        let out = rows;
        if (refsAuto && !refsEmail) out = rows.filter((r) => r.auto_tailor_enabled);
        else if (refsEmail && !refsAuto) out = rows.filter((r) => r.email_on_new_jobs);
        else out = rows.filter((r) => r.auto_tailor_enabled || r.email_on_new_jobs);
        return { data: out, error: null };
      }
      if (table === "feed_postings") return { data: feedPostings, error: null };
      if (table === "email_notified_postings") return { data: [], error: null };
      if (table === "notifications") return { data: null, error: null };
      return { data: [], error: null };
    },
  });
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  // N60 S5: the route now refuses to send when it cannot mint a working
  // unsubscribe link (owner ruling -- folded into the config gate). This
  // file's "still delivers email-only alerts" assertion is about AC-R6's
  // feature independence, not the unsubscribe link, so both env vars are
  // stubbed present as mock plumbing.
  vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret-value");
  vi.stubEnv("RESUME_TAILOR_API_URL", "https://app.example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("authorization is unchanged by the decoupling (guard)", () => {
  it("returns 401 and never builds an admin client without the secret", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/tailor", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("AC-R6: an auto-tailor eligibility failure cannot suppress email-only alerts", () => {
  beforeEach(() => {
    selectEmailOnlyJobs.mockReturnValue({
      jobs: [{ title: "Emailed role", company: "Acme", url: "u", savedSearchName: "Email search", emailOnNewJobs: true, externalId: "gh-1" }],
      externalIds: ["gh-1"],
    });
  });

  it("does not 500 when the saved-search auto-tailor query errors", async () => {
    createAdminClient.mockReturnValue(adminFor({ failPredicate: "auto", rows: [emailSearch()], feedPostings: [{ id: "p1", source_posting_id: "gh-1" }] }));
    const res = await POST(authedReq());
    expect(res.status).toBe(200);
  });

  it("still delivers email-only alerts when the auto-tailor query errors", async () => {
    createAdminClient.mockReturnValue(adminFor({ failPredicate: "auto", rows: [emailSearch()], feedPostings: [{ id: "p1", source_posting_id: "gh-1" }] }));
    const res = await POST(authedReq());
    const body = await res.json();
    expect(sendEmail).toHaveBeenCalled();
    expect(body.totalEmailedOnly).toBeGreaterThanOrEqual(1);
  });

  it("reports the auto-tailor failure per feature rather than as a whole-route error", async () => {
    createAdminClient.mockReturnValue(adminFor({ failPredicate: "auto", rows: [emailSearch()], feedPostings: [{ id: "p1", source_posting_id: "gh-1" }] }));
    const res = await POST(authedReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.some((r) => r && r.autoFeatureError)).toBe(true);
  });
});

describe("AC-R6, mirror: an email-only failure cannot suppress auto-tailoring", () => {
  beforeEach(() => {
    loadStorageBuffer.mockResolvedValue(Buffer.from("resume-bytes"));
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Auto role" }]);
    tailorAndQueueOne.mockResolvedValue({ title: "Auto role", company: "Acme", applicationId: "app-1", positionId: "pos-1" });
  });

  it("does not 500 when the email-only query errors", async () => {
    createAdminClient.mockReturnValue(adminFor({ failPredicate: "email", rows: [autoSearch()], feedPostings: [{ id: "p1", source_posting_id: "gh-1" }] }));
    const res = await POST(authedReq());
    expect(res.status).toBe(200);
  });

  it("still runs auto-tailoring when the email-only query errors", async () => {
    createAdminClient.mockReturnValue(adminFor({ failPredicate: "email", rows: [autoSearch()], feedPostings: [{ id: "p1", source_posting_id: "gh-1" }] }));
    const res = await POST(authedReq());
    const body = await res.json();
    expect(tailorAndQueueOne).toHaveBeenCalled();
    expect(body.totalQueued).toBeGreaterThanOrEqual(1);
  });

  it("reports the email failure per feature", async () => {
    createAdminClient.mockReturnValue(adminFor({ failPredicate: "email", rows: [autoSearch()], feedPostings: [{ id: "p1", source_posting_id: "gh-1" }] }));
    const res = await POST(authedReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.some((r) => r && r.emailFeatureError)).toBe(true);
  });
});

describe("AC-R4: the response reports per-feature eligibility and outcome counts", () => {
  it("[control] a healthy run reports numeric eligibility/outcome counts and NO feature errors", async () => {
    // Healthy path: nothing errors. This control proves the per-feature-error
    // assertions above are not always-firing -- here they must be absent -- and
    // that both features run. It is green on HEAD by design for the "no error"
    // half; the count assertions are the RED-on-HEAD half (fields absent at HEAD).
    loadStorageBuffer.mockResolvedValue(Buffer.from("resume-bytes"));
    selectQueueCandidates.mockReturnValue([{ id: "p1", source_posting_id: "gh-1", title: "Auto role" }]);
    tailorAndQueueOne.mockResolvedValue({ title: "Auto role", applicationId: "app-1" });
    selectEmailOnlyJobs.mockReturnValue({
      jobs: [{ title: "Emailed role", url: "u", savedSearchName: "Email search", emailOnNewJobs: true, externalId: "gh-2" }],
      externalIds: ["gh-2"],
    });
    createAdminClient.mockReturnValue(
      adminFor({ failPredicate: null, rows: [autoSearch(), emailSearch()], feedPostings: [{ id: "p1", source_posting_id: "gh-1" }, { id: "p2", source_posting_id: "gh-2" }] }),
    );
    const res = await POST(authedReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    const r = body.results.find((x) => x && x.userId === "user-1");
    expect(r).toBeTruthy();
    expect(r.autoFeatureError == null).toBe(true);
    expect(r.emailFeatureError == null).toBe(true);
    for (const field of ["autoEligible", "autoProcessed", "tailored", "emailEligible", "emailed"]) {
      expect(typeof r[field], `results[].${field} should be a number`).toBe("number");
    }
  });
});
