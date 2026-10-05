// N104 - weaknessSteering reaches the Gemini Ideal chain's prompts (rule: wire the
// new value at the PRODUCTION call site, not only at the pure builder).
//
// idealChainPrompts.test.js pins the builders; this pins the chain: a request that
// carries `weaknessSteering` through geminiEngine.tailorIdeal puts the steered term
// in the HYPOTHETICAL and APPLICATION-READY stage prompts and never in the analysis
// stage's (the analysis reads the posting, not the candidate), and a request without
// it sends the same prompts it always did. Same harness as geminiIdealChain.test.js:
// the REAL @google/genai client over a scripted fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { GoogleGenAI } from "@google/genai";
import { geminiEngine } from "@/lib/llm/engines/geminiEngine";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";

const ARGS = {
  jobPosting: "We need a payments engineer to rebuild the settlement pipeline.",
  resumeText: "Jane Doe\nSenior Engineer\nReduced support tickets at Acme Corp.",
  resumeFileName: "resume.docx",
  templateLines: ["Jane Doe", "Senior Engineer", "Experience"],
  additionalContext: "",
};
const STEERING = { resolvable: [{ category: "missing-keyword", term: "Kubernetes" }] };

const promptOf = (body) => body?.contents?.[0]?.parts?.[0]?.text ?? "";
const json = (payload) =>
  new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
const ok = (text) => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });

const ANALYSIS = {
  jobTitle: "Payments Engineer",
  companyName: "Acme",
  requirements: [{ text: "Rebuild the settlement pipeline", kind: "responsibility" }],
  keywordMap: [{ keyword: "settlement", section: "experience", priority: 1, requirementIndex: 0 }],
};
const LINES = ["Jane Doe", "Senior Engineer", "Cut support-ticket volume at Acme Corp"];

function stageOf(body) {
  if (body.generationConfig?.responseJsonSchema?.properties?.keywordMap) return "analysis";
  return /HYPOTHETICAL IDEAL resume/.test(promptOf(body)) ? "hypothetical" : "application-ready";
}

function scriptFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const stage = stageOf(body);
    calls.push({ stage, prompt: promptOf(body) });
    return ok(JSON.stringify(stage === "analysis" ? ANALYSIS : { resultLines: LINES }));
  };
  return calls;
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", geminiApiKey: "k" });
  getGeminiClient.mockReturnValue(new GoogleGenAI({ apiKey: "k" }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("weaknessSteering through geminiEngine.tailorIdeal", () => {
  it("lands in the two draft prompts and never in the analysis prompt", async () => {
    const calls = scriptFetch();
    await geminiEngine.tailorIdeal({ ...ARGS, weaknessSteering: STEERING });
    const byStage = Object.fromEntries(calls.map((c) => [c.stage, c.prompt]));
    expect(byStage.hypothetical).toContain("Kubernetes");
    expect(byStage["application-ready"]).toContain("Kubernetes");
    expect(byStage.analysis).not.toContain("Kubernetes");
  });

  it("CONTROL: a request without steering sends prompts with no steering text", async () => {
    const calls = scriptFetch();
    await geminiEngine.tailorIdeal({ ...ARGS });
    expect(calls.map((c) => c.stage)).toEqual(["analysis", "hypothetical", "application-ready"]);
    for (const call of calls) expect(call.prompt).not.toContain("Kubernetes");
  });
});
