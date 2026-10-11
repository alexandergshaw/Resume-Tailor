import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// N157 SC-gen (4b TDD seat) -- POST /api/study-plan gate logic.
// Binds docs/loop/N157.SC-gen.plan.r1.md step 3 + risk rows R5/R6, and
// docs/loop/N157.arch.r2.md §4.2/§7/§8 / ledger ARCH-N157-8/9/15.
//
// This is the mock-and-source instrument (the IP3/digest convention): the
// model call shape is proven on the bytes by route.wire.test.js; this file
// proves everything the bytes cannot reach -- the gate order, the engine split,
// identity off the wire, and that the route is PHASE 2 ONLY (it issues no
// grounded call and never POSTs /api/application-digest -- R-IP3-21 / R5).
//
// generateStudyPlan is MOCKED here: this file is about the gates around it, not
// its internals (those are studyPlanGenerate.test.js). globalThis.fetch is
// stubbed and asserted NEVER called, which is the phase-2-only guard.
//
// RED ON HEAD: app/api/study-plan/route.js does not exist yet -> the import
// below throws at collection and every `it` reds (honest greenfield red).

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/studyPlan/studyPlanGenerate", () => ({ generateStudyPlan: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({ listDigests: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { generateStudyPlan } from "@/lib/studyPlan/studyPlanGenerate";
import { listDigests } from "@/lib/supabase/applicationDigests";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { POST } from "./route.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const POSITION = { id: "p1", title: "Senior Platform Engineer", company: "Acme Robotics", description: "Own the estate." };

// Unique user per case: the route's rate limiter is a module singleton whose
// counters survive between it() blocks, exactly as they survive between
// requests. A shared id would let an early case deny a later one.
let userSeq = 0;
function supabaseWith({ found = true, userId = `study-user-${(userSeq += 1)}` } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({
      data: found ? { id: APP_ID, user_id: userId, positions: POSITION } : null,
      error: null,
    }),
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => chain),
  });
  return { chain, userId };
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: vi.fn(),
  });
}

const request = (body, raw) =>
  new Request("http://localhost/api/study-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });

let fetchSpy;
beforeEach(() => {
  vi.clearAllMocks();
  supabaseWith();
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn() } });
  listDigests.mockResolvedValue({ digests: {}, error: null });
  generateStudyPlan.mockResolvedValue({ status: "ready", written: true, error: null });
  // The phase-2-only guard: nothing on this route may touch the network.
  fetchSpy = vi.fn(async () => { throw new Error("no network from this route"); });
  globalThis.fetch = fetchSpy;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/study-plan -- the gates, in order", () => {
  it("GATE 1 kill switch: STUDY_PLAN_DISABLED=1 -> 503 before any client or spend", async () => {
    vi.stubEnv("STUDY_PLAN_DISABLED", "1");
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(503);
    expect(generateStudyPlan).not.toHaveBeenCalled();
  });

  it("GATE 2 auth: an unauthenticated caller -> 401, nothing generated", async () => {
    signedOut();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(401);
    expect(generateStudyPlan).not.toHaveBeenCalled();
  });

  it("GATE 3 body parse: invalid JSON -> 400", async () => {
    const res = await POST(request(undefined, "{ not json"));
    expect(res.status).toBe(400);
    expect(generateStudyPlan).not.toHaveBeenCalled();
  });

  it("GATE 5 validation: a missing applicationId -> 400, no =\"\" default reaches generate (S9)", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
    expect(generateStudyPlan).not.toHaveBeenCalled();
  });

  it("GATE 5 validation: a blank/whitespace applicationId -> 400", async () => {
    const res = await POST(request({ applicationId: "   " }));
    expect(res.status).toBe(400);
    expect(generateStudyPlan).not.toHaveBeenCalled();
  });

  it("GATE 6 ownership: an application that is not the caller's -> 404", async () => {
    supabaseWith({ found: false });
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(404);
    expect(generateStudyPlan).not.toHaveBeenCalled();
  });

  it("GATE 6 ownership: the application read is scoped to the caller's user_id IN THE QUERY (S8)", async () => {
    // Deleting the tenant filter would leave every other case green -- this is
    // the one that reds for it.
    const { chain, userId } = supabaseWith({ userId: "scoped-user" });
    void userId;
    await POST(request({ applicationId: APP_ID }));
    expect(chain.eq).toHaveBeenCalledWith("id", APP_ID);
    expect(chain.eq).toHaveBeenCalledWith("user_id", "scoped-user");
  });
});

describe("POST /api/study-plan -- the engine split (R6 / ARCH-N157-9)", () => {
  it("server RESUME_ENGINE=embedded forces embedded even when the body asks for gemini", async () => {
    vi.stubEnv("RESUME_ENGINE", "embedded");
    await POST(request({ applicationId: APP_ID, engine: "gemini" }));
    expect(generateStudyPlan.mock.calls[0][0].engine).toBe("embedded");
  });

  it("an explicit body engine:embedded always wins (de-escalation)", async () => {
    await POST(request({ applicationId: APP_ID, engine: "embedded" }));
    expect(generateStudyPlan.mock.calls[0][0].engine).toBe("embedded");
  });

  it("otherwise, with a Gemini key and no server default -> gemini", async () => {
    await POST(request({ applicationId: APP_ID, engine: "gemini" }));
    expect(generateStudyPlan.mock.calls[0][0].engine).toBe("gemini");
  });

  it("with NO Gemini key, a body engine:gemini is FORCED to embedded (serverForcesEmbedded OR term)", async () => {
    // This is the load-bearing half of GATE 7 the RESUME_ENGINE case cannot
    // reach: wantsEmbedded("gemini") returns false for an explicit gemini
    // request, so WITHOUT the `serverForcesEmbedded ||` term a key-less
    // deployment would try the (unconfigured) gemini path on a request's say-so.
    // A mutant that drops that OR term computes engine:"gemini" here -> red.
    vi.stubEnv("Gemini_LLM_API_Key", "");
    await POST(request({ applicationId: APP_ID, engine: "gemini" }));
    expect(generateStudyPlan.mock.calls[0][0].engine).toBe("embedded");
  });
});

describe("POST /api/study-plan -- identity off the wire + phase-2-only (S9 / R5)", () => {
  it("hands generate a NON-EMPTY applicationId and userId off the owned row (S9)", async () => {
    const { userId } = supabaseWith({ userId: "identity-user" });
    await POST(request({ applicationId: APP_ID }));
    const arg = generateStudyPlan.mock.calls[0][0];
    expect(arg.applicationId).toBe(APP_ID);
    expect(arg.userId).toBe(userId);
    expect(arg.applicationId).not.toBe("");
    expect(arg.userId).not.toBe("");
  });

  it("issues NO grounded call and never POSTs /api/application-digest (R-IP3-21 / R5)", async () => {
    // The create-time ensure-digest ordering is the SC-C client's job; this
    // route reads the already-persisted digest only. A mutant that fired
    // ensureCompanyDigest (an IP3-style unawaited POST) would call fetch -> red.
    await POST(request({ applicationId: APP_ID }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the status generate produced", async () => {
    generateStudyPlan.mockResolvedValue({ status: "partial", written: true, error: null });
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "partial" });
  });

  it("is dynamic and runs on node", async () => {
    const mod = await import("./route.js");
    expect(mod.runtime).toBe("nodejs");
    expect(mod.dynamic).toBe("force-dynamic");
  });
});

describe("the study-plan spend ceiling actually bites (module-scope limiter)", () => {
  it("eventually denies a single caller with 429, and a denied request does not reach generate", async () => {
    // A per-handler limiter gets a fresh store on every request and NEVER
    // denies -- so "a 429 appears within a bounded number of calls" reds that
    // mutant. The exact limit is not hardcoded; the bite is what is pinned.
    supabaseWith({ userId: "greedy-study-user" });
    let firstDenied = -1;
    for (let i = 0; i < 200 && firstDenied < 0; i += 1) {
      const res = await POST(request({ applicationId: APP_ID }));
      if (res.status === 429) firstDenied = i;
    }
    expect(firstDenied).toBeGreaterThanOrEqual(0);
    const callsBefore = generateStudyPlan.mock.calls.length;
    const denied = await POST(request({ applicationId: APP_ID }));
    expect(denied.status).toBe(429);
    expect(generateStudyPlan.mock.calls.length).toBe(callsBefore);
  });
});
