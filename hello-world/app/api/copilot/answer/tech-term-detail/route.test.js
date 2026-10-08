// N150 Wave B — the per-term DETAIL sub-route (app/api/copilot/answer/
// tech-term-detail/route.js), mirroring expand/route.js step order plus the
// MANDATORY step 6b. RED on HEAD: neither the route nor the modules it imports
// (techTermPrompt, techTermDetailHonesty) exist, so the dynamic import throws.
//
// THE LOAD-BEARING ROUTE-LEVEL CONTROL IS T-F1b CONTROL C: the REAL
// sanitizeTechTermDetail is NOT mocked here, so a mocked model returning a
// scripted first-person claim proves the gate is actually WIRED at step 6b (the
// response `detail` is sanitized), not merely exported. A build that forgot to
// call it, or hid it behind a flag, reds this.
//
// Also pins: kill switch 503; auth 401; the module-scope limiter's bound
// behaviourally (limit+1 -> 429); validation 400s; applicationId OPTIONAL; the
// embedded branch returns empty with NO model client (I-8); 504 on timeout and
// 502 on any other throw with a FIXED error string (no degradation).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(() => ({ geminiModel: "gemini-2.5-flash" })) }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";

const APP_ID = "22222222-2222-2222-2222-222222222222";
const POSITION = { id: "p1", company: "Acme", title: "SRE", description: "Own the estate." };

let userSeq = 0;
function supabaseWith({ userId = `d-${(userSeq += 1)}`, position = POSITION } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { id: APP_ID, user_id: userId, positions: position }, error: null });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => chain),
  });
  return userId;
}

// A fake Gemini client whose one call returns `text` (or throws `err`).
function modelReturns(text) {
  getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn(async () => ({ text })) } });
}
function modelThrows(err) {
  getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn(async () => { throw err; }) } });
}

function req(body) {
  return new Request("http://localhost/api/copilot/answer/tech-term-detail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function post(body) {
  const { POST } = await import("./route.js");
  return POST(req(body));
}

beforeEach(() => {
  createClient.mockReset();
  getGeminiClient.mockReset();
  getServerEnv.mockClear();
  delete process.env.COPILOT_TECH_TERM_DETAIL_DISABLED;
});
afterEach(() => {
  delete process.env.COPILOT_TECH_TERM_DETAIL_DISABLED;
});

describe("T-F1b CONTROL C — the output gate is wired at step 6b (not merely exported)", () => {
  it("sanitizes a scripted first-person claim OUT of the route's own response", async () => {
    supabaseWith();
    modelReturns(
      "Idempotency keys dedupe retried requests. You could say: 'I used idempotency keys to stop double charges.'",
    );
    const res = await post({ applicationId: APP_ID, question: "Tell me about retries.", term: "idempotency keys", engine: "gemini" });
    expect(res.status).toBe(200);
    const json = await res.json();
    // The fabrication is gone from the WIRE…
    expect(json.detail).not.toContain("I used");
    expect(json.detail).not.toContain("You could say");
    // …and the honest explanation survives.
    expect(json.detail).toContain("Idempotency keys dedupe retried requests.");
    expect(json.empty).toBe(false);
  });

  it("returns empty:true when the whole detail was scripted claims (T-F1c at the route)", async () => {
    supabaseWith();
    modelReturns("I used Redis here. We built the cache. I led the rollout.");
    const json = await (await post({ applicationId: APP_ID, question: "q?", term: "caching", engine: "gemini" })).json();
    expect(json.detail).toBe("");
    expect(json.empty).toBe(true);
  });
});

describe("gates and failure modes", () => {
  it("503s when the kill switch is set, before any model client", async () => {
    process.env.COPILOT_TECH_TERM_DETAIL_DISABLED = "1";
    supabaseWith();
    const res = await post({ applicationId: APP_ID, question: "q?", term: "t", engine: "gemini" });
    expect(res.status).toBe(503);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated caller", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    expect((await post({ applicationId: APP_ID, question: "q?", term: "t" })).status).toBe(401);
  });

  it("returns {detail:'',empty:true,engine:'embedded'} for the embedded engine, with NO model client", async () => {
    supabaseWith();
    const res = await post({ applicationId: APP_ID, question: "q?", term: "t", engine: "embedded" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ detail: "", empty: true, engine: "embedded" });
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("400s when the term is missing or empty", async () => {
    supabaseWith();
    expect((await post({ applicationId: APP_ID, question: "q?" })).status).toBe(400);
    supabaseWith();
    expect((await post({ applicationId: APP_ID, question: "q?", term: "   " })).status).toBe(400);
  });

  it("400s when the question is missing", async () => {
    supabaseWith();
    expect((await post({ applicationId: APP_ID, term: "t" })).status).toBe(400);
  });

  it("answers WITHOUT an applicationId (it is optional, role context only)", async () => {
    // No supabase row is needed; the term is explained generally.
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "no-app" } }, error: null }) },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn() })) })) })) })),
    });
    modelReturns("Idempotency keys make a retried request safe.");
    const res = await post({ question: "Tell me about retries.", term: "idempotency keys", engine: "gemini" });
    expect(res.status).toBe(200);
    expect((await res.json()).detail).toContain("Idempotency keys");
  });

  it("504s on a model timeout and 502s on any other throw, with a FIXED string (no err.message, no degradation)", async () => {
    supabaseWith();
    const timeout = Object.assign(new Error("deadline"), { name: "TimeoutError" });
    modelThrows(timeout);
    const t = await post({ applicationId: APP_ID, question: "q?", term: "t", engine: "gemini" });
    expect(t.status).toBe(504);

    supabaseWith();
    modelThrows(new Error("SECRET provider detail 0xdeadbeef"));
    const h = await post({ applicationId: APP_ID, question: "q?", term: "t", engine: "gemini" });
    expect(h.status).toBe(502);
    const json = await h.json();
    expect(JSON.stringify(json)).not.toContain("0xdeadbeef");
  });
});

describe("the module-scope limiter bounds the route (BOUNDED 40/10min)", () => {
  it("[behavioural] the 41st attempt by one user is a 429", async () => {
    const userId = supabaseWith({ userId: "rl-fixed-user" });
    modelReturns("Idempotency keys make a retried request safe.");
    let last;
    for (let i = 0; i < 41; i += 1) {
      // Same user id throughout, so identify() keys every attempt on one bucket.
      supabaseWith({ userId, position: POSITION });
      modelReturns("Idempotency keys make a retried request safe.");
      last = await post({ applicationId: APP_ID, question: "q?", term: `term ${i}`, engine: "gemini" });
    }
    expect(last.status).toBe(429);
  });
});
