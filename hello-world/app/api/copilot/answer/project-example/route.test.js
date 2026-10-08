import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// N143 seam 6 (T11). Contract for the Row-2 on-the-spot sub-route — RED on
// HEAD because app/api/copilot/answer/project-example/route.js does not exist.
//
// The property this guards (AC-10 / R-K): Row 2 is additive and NON-POISONING.
// A generation rejection or timeout must yield a 200 with {status:'failed'},
// never a 5xx that the client turns into a torn-down answer. The route lives
// under answer/ (which has applicationId) and the question route must NOT gain
// this model call. Row 2 is never persisted/cached server-side.
//
// IMPLEMENTER NOTE: this route imports the Gemini client — add it to
// lib/rateLimit/adoption.test.js's BOUNDED table.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn(() => ({})) }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn(() => ({ geminiModel: "gemini-2.5-flash" })) }));
vi.mock("@/lib/copilot/projectExampleGen", () => ({
  generateOnTheSpotProject: vi.fn(),
  stripPostingFigures: vi.fn((e) => e),
}));

import { createClient } from "@/lib/supabase/server";
import { generateOnTheSpotProject } from "@/lib/copilot/projectExampleGen";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const POSITION = { id: "p1", company: "Acme", title: "SRE", description: "Own the estate." };
const ENTRY = { competency: "incident response", domain: "SRE", title: "t", bullets: ["a one", "b two"], hypothetical: true };

let userSeq = 0;
function supabaseWith({ found = true, userId = `rl-user-${(userSeq += 1)}` } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: found ? { id: APP_ID, user_id: userId, positions: POSITION } : null,
    error: null,
  });
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => chain),
  });
}

function req(body) {
  return new Request("http://localhost/api/copilot/answer/project-example", {
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
  generateOnTheSpotProject.mockReset();
});

describe("Row-2 sub-route — no-poison on failure (T11 / AC-10)", () => {
  it("[positive control] returns a ready projectExample when generation succeeds", async () => {
    supabaseWith();
    generateOnTheSpotProject.mockResolvedValue(ENTRY);
    const res = await post({ applicationId: APP_ID, question: "Tell me about an incident.", engine: "gemini" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.projectExample).toBeTruthy();
    expect(json.projectExample.hypothetical).toBe(true);
  });

  it("[delayed rejection] a SLOW-rejecting generation still yields 200 with {status:'failed'}", async () => {
    supabaseWith();
    // A delayed rejection, not an immediate throw — the route must await and
    // catch it rather than letting it escape as a 5xx.
    generateOnTheSpotProject.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5)),
    );
    const res = await post({ applicationId: APP_ID, question: "Tell me about an incident.", engine: "gemini" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.projectExample).toEqual({ status: "failed" });
  });

  it("returns {projectExample:null} for the embedded engine, with no model call", async () => {
    supabaseWith();
    const res = await post({ applicationId: APP_ID, question: "Q?", engine: "embedded" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.projectExample).toBeNull();
    expect(generateOnTheSpotProject).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated caller", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    const res = await post({ applicationId: APP_ID, question: "Q?" });
    expect(res.status).toBe(401);
  });

  it("400s when the question is missing", async () => {
    supabaseWith();
    const res = await post({ applicationId: APP_ID });
    expect(res.status).toBe(400);
  });
});

describe("route graph — lives under answer/, absent from the question route", () => {
  it("the sub-route file exists under app/api/copilot/answer/project-example/", () => {
    expect(existsSync(path.resolve(process.cwd(), "app/api/copilot/answer/project-example/route.js"))).toBe(true);
  });

  it("the question route gains no on-the-spot project-example model call", () => {
    const q = readFileSync(path.resolve(process.cwd(), "app/api/copilot/question/route.js"), "utf8");
    expect(q).not.toMatch(/generateOnTheSpotProject|project-example|projectExampleLive/);
  });
});
