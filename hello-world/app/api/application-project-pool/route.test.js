import { describe, it, expect, vi, beforeEach } from "vitest";

// N143 seam 4 (T6). Route contract for the project-pool prewarm — RED on HEAD
// because app/api/application-project-pool/route.js does not exist (collection
// fails at the import of ./route.js; that is the hand-off).
//
// The expensive mistakes this pins are all about the spend ceiling and the
// no-poison recovery (design r2 §2.2 / AC-4/-9/-17 / R-I):
//   • a 'pending' row is written BEFORE the (spied) model call, so a crashed
//     generation leaves a timestamped pending row the cost gate can retry
//     rather than no row (the re-armed stampede);
//   • an already-ready pool short-circuits with ZERO model calls;
//   • a failed pool is NOT auto-retried on load (force is the only way back);
//   • a generation throw persists a 'failed' row and returns 200 (no-poison);
//   • the route carries a module-scope rate limiter (the digestLimiter idiom).
//
// Fixtures are constructed; there is no GEMINI_API_KEY here. generateProjectPool
// is the model-calling function, so "0 model calls" = it was not invoked.
//
// IMPLEMENTER NOTE: this route imports the Gemini client, so it must be added
// to lib/rateLimit/adoption.test.js's BOUNDED table or that sweep goes red.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn(() => ({})) }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(() => ({ geminiModel: "gemini-2.5-flash" })) }));
vi.mock("@/lib/supabase/applicationProjectPool", () => ({
  getProjectPool: vi.fn(),
  upsertProjectPool: vi.fn(async () => ({ pool: { status: "pending" }, error: null })),
  listProjectPools: vi.fn(),
}));
vi.mock("@/lib/copilot/projectExampleGen", () => ({
  generateProjectPool: vi.fn(async () => ({ projects: [POOL_ENTRY] })),
  stripPostingFigures: vi.fn((e) => e),
}));

import { createClient } from "@/lib/supabase/server";
import { getProjectPool, upsertProjectPool } from "@/lib/supabase/applicationProjectPool";
import { generateProjectPool, stripPostingFigures } from "@/lib/copilot/projectExampleGen";
import { POST } from "./route.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const POSITION = { id: "p1", company: "Acme", title: "SRE", description: "Own the estate. Comp $120k-$150k." };
const POOL_ENTRY = { competency: "incident response", domain: "SRE", title: "t", bullets: ["a one", "b two"], hypothetical: true };

let userSeq = 0;
function supabaseWith({ found = true, userId = `pool-user-${(userSeq += 1)}` } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: found ? { id: APP_ID, user_id: userId, positions: POSITION } : null,
    error: null,
  });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => chain),
  });
  return userId;
}

function req(body) {
  return new Request("http://localhost/api/application-project-pool", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  generateProjectPool.mockClear();
  upsertProjectPool.mockClear();
  stripPostingFigures.mockClear();
  getProjectPool.mockReset();
  getProjectPool.mockResolvedValue({ pool: null, error: null });
  upsertProjectPool.mockResolvedValue({ pool: { status: "pending" }, error: null });
});

describe("prewarm route — pending-before-model, short-circuit, no-poison (T6)", () => {
  it("writes a 'pending' row BEFORE the model call (R-I crash recovery)", async () => {
    supabaseWith();
    const res = await POST(req({ applicationId: APP_ID, engine: "gemini" }));
    expect(res.status).toBe(200);
    expect(generateProjectPool).toHaveBeenCalledTimes(1);
    // A pending upsert happened and happened first.
    const pendingCall = upsertProjectPool.mock.calls.find((c) => c[3] && c[3].status === "pending");
    expect(pendingCall, "a status:'pending' upsert").toBeTruthy();
    const pendingOrder = Math.min(...upsertProjectPool.mock.invocationCallOrder);
    const modelOrder = generateProjectPool.mock.invocationCallOrder[0];
    expect(pendingOrder).toBeLessThan(modelOrder);
  });

  it("writes a 'ready' row with the generated projects after the model call", async () => {
    supabaseWith();
    await POST(req({ applicationId: APP_ID, engine: "gemini" }));
    const readyCall = upsertProjectPool.mock.calls.find((c) => c[3] && c[3].status === "ready");
    expect(readyCall).toBeTruthy();
    expect(readyCall[3].projects).toEqual([POOL_ENTRY]);
  });

  it("short-circuits an already-ready pool with ZERO model calls", async () => {
    supabaseWith();
    getProjectPool.mockResolvedValue({ pool: { status: "ready", projects: [POOL_ENTRY] }, error: null });
    await POST(req({ applicationId: APP_ID, engine: "gemini" }));
    expect(generateProjectPool).not.toHaveBeenCalled();
  });

  it("[mutation control] does NOT auto-retry a failed pool (force is the only way in)", async () => {
    supabaseWith();
    getProjectPool.mockResolvedValue({ pool: { status: "failed", projects: [] }, error: null });
    await POST(req({ applicationId: APP_ID, engine: "gemini" }));
    expect(generateProjectPool).not.toHaveBeenCalled();
  });

  it("re-generates a ready pool only when force is set", async () => {
    supabaseWith();
    getProjectPool.mockResolvedValue({ pool: { status: "ready", projects: [POOL_ENTRY] }, error: null });
    await POST(req({ applicationId: APP_ID, engine: "gemini", force: true }));
    expect(generateProjectPool).toHaveBeenCalledTimes(1);
  });

  it("persists a 'failed' row and returns 200 when generation throws (no-poison)", async () => {
    supabaseWith();
    generateProjectPool.mockRejectedValueOnce(new Error("model boom"));
    const res = await POST(req({ applicationId: APP_ID, engine: "gemini" }));
    expect(res.status).toBe(200);
    const failedCall = upsertProjectPool.mock.calls.find((c) => c[3] && c[3].status === "failed");
    expect(failedCall, "a status:'failed' upsert on throw").toBeTruthy();
  });

  it("refuses the embedded engine with 503 and no model call", async () => {
    supabaseWith();
    const res = await POST(req({ applicationId: APP_ID, engine: "embedded" }));
    expect(res.status).toBe(503);
    expect(generateProjectPool).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated caller", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    const res = await POST(req({ applicationId: APP_ID }));
    expect(res.status).toBe(401);
  });
});

describe("prewarm route — the spend ceiling (AC-17)", () => {
  it("denies past the module-scope limit (behavioural, same user)", async () => {
    const userId = supabaseWith();
    getProjectPool.mockResolvedValue({ pool: { status: "ready", projects: [POOL_ENTRY] }, error: null });
    let last;
    for (let i = 0; i < 13; i += 1) {
      // Re-point createClient at the same user each iteration.
      supabaseWith({ userId });
      getProjectPool.mockResolvedValue({ pool: { status: "ready", projects: [POOL_ENTRY] }, error: null });
      last = await POST(req({ applicationId: APP_ID, engine: "gemini" }));
    }
    // A module-scope limiter at 12/window denies the 13th; a per-request
    // limiter would pass all 13.
    expect(last.status).toBe(429);
  });
});
