// N105 Step 3b (4b) — the Gemini Ideal chain, wire-verified (K7, R-1/R-2/R-5/R-6).
// Binds to: N105.plan.r2.md Step 3b + PL-6/PL-14; research R-1/R-2/R-5/R-6;
// gemini-tools-nesting (assert the REAL SDK's bytes, never an injected fake).
//
// WHY THESE DRIVE THE REAL SDK. A tool or schema passed at the wrong nesting is
// silently dropped by @google/genai; a fake client sees whatever the caller
// hands it and cannot observe the drop. So these stub globalThis.fetch and read
// the request bytes via captureGeminiRequests (lib/llm/geminiWireProbe.js).
//
// K7 (SILENT): (i) a stage shipping tool+schema together is server-rejected or
// silently degraded on gemini-2.5-flash (R-1); (ii) an unchecked MAX_TOKENS
// truncation parsed as success ships a half-built draft (R-5). Both are pinned.
//
// RED on HEAD: geminiEngine.tailorIdeal is not a function. captureGeminiRequests
// swallows the throw and returns [], so the "bodies.length >= 1" guard reds (not
// a vacuous pass); the R-5 positive control also reds because no artifact is
// produced. Satisfiability of the chain is a best-effort reference item (see the
// TDD seat's report).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { GoogleGenAI } from "@google/genai";
import { geminiEngine } from "./geminiEngine.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";

const ARGS = {
  jobPosting: "We need a payments engineer to rebuild the settlement pipeline.",
  resumeText: "Jane Doe\nSenior Engineer\nReduced support tickets at Acme Corp.",
  resumeFileName: "resume.docx",
  templateLines: ["Jane Doe", "Senior Engineer", "Experience"],
  additionalContext: "",
};
const URL_ONLY = { ...ARGS, jobPosting: "", jobPostingUrl: "https://example.test/job/9" };

beforeEach(() => {
  vi.clearAllMocks();
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", geminiApiKey: "k" });
  getGeminiClient.mockReturnValue(new GoogleGenAI({ apiKey: "k" }));
});

const schemaStages = (bodies) => bodies.filter((b) => b?.generationConfig?.responseMimeType);

describe("R-1 — no single stage carries tool + JSON schema together (gemini-2.5-flash)", () => {
  it("every captured request has at most one of { tools, responseMimeType }", async () => {
    const bodies = await captureGeminiRequests(() => geminiEngine.tailorIdeal({ ...ARGS }));
    expect(bodies.length).toBeGreaterThanOrEqual(1); // guard against a vacuous pass
    for (const body of bodies) {
      const hasTool = Boolean(toolsOf(body));
      const hasSchema = Boolean(body?.generationConfig?.responseMimeType);
      expect(hasTool && hasSchema).toBe(false);
    }
  });
});

describe("R-2 — a URL-only posting is read in a schema-free stage, then schema stages receive text", () => {
  it("emits a tools-without-schema stage AND a schema-without-tools stage, never both at once", async () => {
    const bodies = await captureGeminiRequests(() => geminiEngine.tailorIdeal({ ...URL_ONLY }));
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const toolNoSchema = bodies.some((b) => toolsOf(b) && !b?.generationConfig?.responseMimeType);
    const schemaNoTool = bodies.some((b) => !toolsOf(b) && b?.generationConfig?.responseMimeType);
    expect(toolNoSchema).toBe(true);
    expect(schemaNoTool).toBe(true);
  });
});

describe("R-6 — every schema stage sets thinkingConfig and maxOutputTokens explicitly", () => {
  it("each schema-constrained request carries thinkingConfig and maxOutputTokens in generationConfig", async () => {
    const bodies = await captureGeminiRequests(() => geminiEngine.tailorIdeal({ ...ARGS }));
    const stages = schemaStages(bodies);
    expect(stages.length).toBeGreaterThanOrEqual(1);
    for (const b of stages) {
      expect(b.generationConfig.thinkingConfig).toBeTruthy();
      expect(typeof b.generationConfig.maxOutputTokens).toBe("number");
    }
  });
});

describe("R-5 / K7 — truncation is a HARD failure, never a partial artifact", () => {
  // Positive control (reds on HEAD because tailorIdeal is absent): a well-formed
  // STOP response yields BOTH drafts.
  it("a complete (STOP) response resolves with hypothetical AND applicationReadyCandidate", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify({ resultLines: ["Jane Doe", "Senior Engineer"], jobTitle: "Payments Engineer", companyName: "Acme", requirements: [], keywordMap: [] }) }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    try {
      const out = await geminiEngine.tailorIdeal({ ...ARGS });
      expect(out.hypothetical).toBeTruthy();
      expect(out.applicationReadyCandidate).toBeTruthy();
    } finally {
      globalThis.fetch = original;
    }
  });

  // The teeth: a MAX_TOKENS stage must reject (atomic fail), never resolve with a
  // partial document. Mutant removing the finishReason check -> this reds.
  it("a MAX_TOKENS response rejects and produces no artifact", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"resultLines":["Jane Doe"' }] }, finishReason: "MAX_TOKENS" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    try {
      await expect(geminiEngine.tailorIdeal({ ...ARGS })).rejects.toBeTruthy();
    } finally {
      globalThis.fetch = original;
    }
  });
});
