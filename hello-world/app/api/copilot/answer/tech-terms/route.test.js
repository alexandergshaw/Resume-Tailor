// N150 Wave B — the GENERATION sub-route (app/api/copilot/answer/tech-terms/
// route.js), mirroring project-example/route.test.js. RED on HEAD because the
// route does not exist, so `import("./route.js")` throws at the dynamic import.
//
// Pins: embedded refuses with NO model client (I-8); every post-gate failure is
// a 200 {status:"failed"} (no-poison, I-9); failed when the posting has nothing
// to anchor on; auth and input gates; and — the privacy property with no visible
// symptom — materials-independence (I-7): the route reads only posting columns,
// imports no answer-context loader, and selects no salary field.
//
// IMPLEMENTER: this route imports the Gemini client, so it must also appear in
// lib/rateLimit/adoption.test.js's DEFERRED table (it is UNMETERED by owner
// ruling). That is pinned separately in adoption.test.js.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn(() => ({})) }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(() => ({ geminiModel: "gemini-2.5-flash" })) }));
vi.mock("@/lib/copilot/techTermsGen", () => ({ generateTechTerms: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { generateTechTerms } from "@/lib/copilot/techTermsGen";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const POSITION = { id: "p1", company: "Acme", title: "SRE", location: "Remote", description: "Own the estate." };
const ROUTE_REL = "app/api/copilot/answer/tech-terms/route.js";

let userSeq = 0;
function supabaseWith({ found = true, position = POSITION, userId = `u-${(userSeq += 1)}` } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: found ? { id: APP_ID, user_id: userId, positions: position } : null,
    error: null,
  });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => chain),
  });
}

function req(body) {
  return new Request("http://localhost/api/copilot/answer/tech-terms", {
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
  generateTechTerms.mockReset();
  getGeminiClient.mockClear();
  getServerEnv.mockClear();
});

describe("tech-terms generation route — behaviour", () => {
  it("[positive control] returns a ready techTerms list when generation succeeds", async () => {
    supabaseWith();
    generateTechTerms.mockResolvedValue(["idempotency keys", "circuit breaker"]);
    const res = await post({ applicationId: APP_ID, question: "Tell me about retries.", engine: "gemini" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.techTerms.status).toBe("ready");
    expect(json.techTerms.terms).toEqual(["idempotency keys", "circuit breaker"]);
  });

  it("[no-poison] a SLOW-rejecting generation still yields 200 {status:'failed'}", async () => {
    supabaseWith();
    generateTechTerms.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5)),
    );
    const res = await post({ applicationId: APP_ID, question: "q?", engine: "gemini" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.techTerms).toEqual({ status: "failed" });
  });

  it("returns {techTerms:null} for the embedded engine, with NO model client built (I-8)", async () => {
    supabaseWith();
    const res = await post({ applicationId: APP_ID, question: "q?", engine: "embedded" });
    expect(res.status).toBe(200);
    expect((await res.json()).techTerms).toBeNull();
    expect(generateTechTerms).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
  });

  it("returns {status:'failed'} without paying for generation when the posting has no title and no description", async () => {
    supabaseWith({ position: { id: "p1", company: "Acme" } });
    const res = await post({ applicationId: APP_ID, question: "q?", engine: "gemini" });
    expect((await res.json()).techTerms).toEqual({ status: "failed" });
    expect(generateTechTerms).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated caller", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    expect((await post({ applicationId: APP_ID, question: "q?" })).status).toBe(401);
  });

  it("400s when applicationId or question is missing", async () => {
    supabaseWith();
    expect((await post({ question: "q?" })).status).toBe(400);
    supabaseWith();
    expect((await post({ applicationId: APP_ID })).status).toBe(400);
  });
});

describe("I-7 — the generation path never touches the candidate's materials", () => {
  function routeSource() {
    return readFileSync(path.resolve(process.cwd(), ROUTE_REL), "utf8");
  }

  it("imports no answer-context loader or materials module", () => {
    const src = routeSource();
    expect(src).not.toMatch(/loadAnswerContext|answerContext|applicationDocs|loadAnswerMaterials/);
  });

  it("selects only posting columns — never a salary field", () => {
    const src = routeSource();
    // Canary: it actually reads the posting (so the negative below is measured).
    expect(src).toMatch(/positions\s*\(/);
    expect(src).not.toMatch(/salary_min|salary_max/);
  });
});

describe("the route is UNMETERED (owner ruling)", () => {
  it("carries no rate limiter, measured against a limited route as the canary", () => {
    const src = readFileSync(path.resolve(process.cwd(), ROUTE_REL), "utf8");
    expect(src).not.toMatch(/createRateLimiter/);
    // Canary: a route that IS limited shows the symbol, so the absence is real.
    const limited = readFileSync(path.resolve(process.cwd(), "app/api/copilot/glossary/route.js"), "utf8");
    expect(limited).toMatch(/createRateLimiter/);
  });
});
