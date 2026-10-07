// N125 §3.2 (L2/L13): lib/copilot/idealProjectResolver.js — the gates-first /
// void-start / explicit-peek resolver for the READY (pool) and TAILORED
// examples, modelled on answerCodeLanguage.js (and its test file).
//
// Written BEFORE the module exists (step 4b): every case fails on the missing
// ./idealProjectResolver.js import until step 5 lands.
//
// What this file pins that unit-testing the pieces cannot:
//  - the FIRST statement is the embedded gate (no generateContent, EVER, and
//    the client is never even constructed on the embedded path);
//  - the READY serve is a pure synchronous peek — peekIdealProject starts
//    nothing and returns the model project object or null (the `|| fallback`
//    trap that bites codeLanguage does not apply, but peek must still not hand
//    back a promise or a truthy sentinel);
//  - startIdealProjectResolution is a VOID start (returns undefined) so an
//    await on it is unwritable — the whole latency point;
//  - the question key (L13) is collision-safe: distinct interior tokens keep
//    distinct keys; case / whitespace / trailing-punctuation variants collapse.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import {
  idealProjectPoolKey,
  idealProjectQuestionKey,
  idealProjectTailoredKey,
  startIdealProjectResolution,
  peekIdealProject,
  resolveTailoredIdealProject,
} from "./idealProjectResolver.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { idealProjectPoolCache, idealProjectTailoredCache } from "./answerSessionCache.js";

const DESCRIPTION = [
  "Senior Product Manager, Education Technology",
  "We are hiring a product manager to own our K-12 product suite end to end.",
  "You will run Agile ceremonies and partner with UX design and customer success.",
].join("\n");

// A worked example normalizeIdealProject vouches for against DESCRIPTION: four
// labels in order, bodies in bounds, third person, digit-free metrics, figures
// carrying digits, and not one number the posting states (it states none).
const GOOD_EXAMPLE = {
  title: "Rebuilding the enrolment workflow teachers actually use, in Education.",
  sections: [
    { label: "Problem", body: "Two thirds of licensed teachers never returned after their first week, and the enrolment flow ran to seven screens." },
    { label: "Built", body: "A single-screen flow with the roster pre-filled from the student system, and an assistant flagging incomplete records before submission." },
    { label: "Ran", body: "Two-week sprints with a teacher advisory group in every review, and a written decision log so settled trade-offs stayed settled." },
    { label: "Landed", body: "Baselined against the prior term and measured the same way after, including the part that did not move at all." },
  ],
  outcomes: [
    { metric: "adoption rate", figure: "34% → 71% of teachers active weekly" },
    { metric: "user satisfaction / NPS", figure: "teacher NPS +9 → +38" },
    { metric: "time-to-ship", figure: "median idea-to-production 9 weeks → 3" },
  ],
};

const POOL_KEY = idealProjectPoolKey("user-1", "app-1");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Installs the module-level client the resolver builds for itself; hands back
// the generateContent spy.
function installModel(payload = GOOD_EXAMPLE) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async () => ({ text: JSON.stringify(payload) }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

beforeEach(() => {
  getServerEnv.mockReset();
  getGeminiClient.mockReset();
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
});

describe("the three keys (L13 — collision-safe)", () => {
  it("the pool key is posting-only (question-INDEPENDENT)", () => {
    expect(idealProjectPoolKey("user-1", "app-1")).toBe("user-1::app-1::ip");
    // No question ever enters it — the whole basis of the READY/pool invariant.
    expect(idealProjectPoolKey("user-1", "app-1")).not.toContain("ipq");
  });

  it("two questions differing in ANY interior token keep distinct tailored keys", () => {
    const a = idealProjectTailoredKey("user-1", "app-1", "Tell me about a time you led a team.");
    const b = idealProjectTailoredKey("user-1", "app-1", "Tell me about a time you resolved a conflict?");
    expect(a).not.toBe(b);
  });

  it("case / whitespace / trailing-punctuation variants of ONE question collapse to ONE key", () => {
    const base = idealProjectQuestionKey("Tell me about a project.");
    for (const variant of [
      "tell me about a project",
      "  Tell me about a project?!  ",
      "TELL ME ABOUT A PROJECT",
      "Tell  me   about a project...",
    ]) {
      expect(idealProjectQuestionKey(variant)).toBe(base);
    }
    // ...and that collapsing is correct, not a degenerate "everything is one
    // key": a genuinely different question still differs.
    expect(idealProjectQuestionKey("Tell me about a failure.")).not.toBe(base);
  });

  it("the tailored key embeds the collision-safe question key under its own suffix", () => {
    expect(idealProjectTailoredKey("user-1", "app-1", "Tell me about a project?")).toBe(
      `user-1::app-1::ipq:${idealProjectQuestionKey("Tell me about a project?")}`,
    );
  });
});

describe("startIdealProjectResolution — gates first, void start (L2)", () => {
  it("resolves and caches the POOL example when NOT embedded — the positive control", async () => {
    const generateContent = installModel();
    startIdealProjectResolution({ engine: "gemini", description: DESCRIPTION, cacheKey: POOL_KEY });
    await flush();
    expect(generateContent).toHaveBeenCalledTimes(1);
    const peeked = peekIdealProject(POOL_KEY);
    expect(peeked).not.toBeNull();
    expect(peeked.title).toBe(GOOD_EXAMPLE.title);
  });

  it("writes NOTHING and makes ZERO model calls for the embedded engine — and never even builds the client", async () => {
    const generateContent = installModel();
    startIdealProjectResolution({ engine: "embedded", description: DESCRIPTION, cacheKey: POOL_KEY });
    await flush();
    expect(generateContent).not.toHaveBeenCalled();
    // Gates run BEFORE the client is constructed — the ordering three route
    // suites assert for the codeLanguage precedent.
    expect(getServerEnv).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(peekIdealProject(POOL_KEY)).toBeNull();
  });

  it("starts nothing for a blank posting (no key written)", async () => {
    const generateContent = installModel();
    startIdealProjectResolution({ engine: "gemini", description: "   ", cacheKey: POOL_KEY });
    await flush();
    expect(generateContent).not.toHaveBeenCalled();
    expect(peekIdealProject(POOL_KEY)).toBeNull();
  });

  it("returns undefined — a void start, so the forbidden await is unwritable", () => {
    installModel();
    expect(startIdealProjectResolution({ engine: "gemini", description: DESCRIPTION, cacheKey: POOL_KEY })).toBeUndefined();
  });

  it("calls the model at most ONCE per pool key per TTL", async () => {
    const generateContent = installModel();
    startIdealProjectResolution({ engine: "gemini", description: DESCRIPTION, cacheKey: POOL_KEY });
    await flush();
    startIdealProjectResolution({ engine: "gemini", description: DESCRIPTION, cacheKey: POOL_KEY });
    await flush();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not throw and resolves nothing when the client setup throws synchronously", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("no Gemini key configured");
    });
    expect(() => startIdealProjectResolution({ engine: "gemini", description: DESCRIPTION, cacheKey: POOL_KEY })).not.toThrow();
    await flush();
    expect(peekIdealProject(POOL_KEY)).toBeNull();
  });
});

describe("peekIdealProject — pure, starts nothing (L2)", () => {
  it("returns null for a miss, and starts no model call", async () => {
    const generateContent = installModel();
    expect(peekIdealProject("user-9::app-9::ip")).toBeNull();
    await flush();
    expect(generateContent).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("returns null while a resolution is still in flight, and never a promise", () => {
    idealProjectPoolCache.get(POOL_KEY, () => new Promise(() => {}), { now: Date.now() });
    const hit = peekIdealProject(POOL_KEY);
    expect(hit).toBeNull();
    expect(hit).not.toBeInstanceOf(Promise);
  });
});

describe("resolveTailoredIdealProject — per-question, awaited only on its own channel (L2/L10)", () => {
  it("resolves the model example for a question and caches it under the tailored key", async () => {
    const generateContent = installModel();
    const tKey = idealProjectTailoredKey("user-1", "app-1", "Tell me about a project you owned.");
    const result = await resolveTailoredIdealProject({
      engine: "gemini",
      description: DESCRIPTION,
      question: "Tell me about a project you owned.",
      cacheKey: tKey,
    });
    expect(result).not.toBeNull();
    expect(result.title).toBe(GOOD_EXAMPLE.title);
    expect(generateContent).toHaveBeenCalledTimes(1);
    // Cached under the tailored key, in the TAILORED Map only.
    expect(idealProjectTailoredCache.peek(tKey)).toEqual({ project: expect.objectContaining({ title: GOOD_EXAMPLE.title }), resolvedAt: expect.any(Number) });
  });

  it("serves an exact repeat from the tailored cache — one model call across two identical asks", async () => {
    const generateContent = installModel();
    const q = "Tell me about a project you owned.";
    const tKey = idealProjectTailoredKey("user-1", "app-1", q);
    await resolveTailoredIdealProject({ engine: "gemini", description: DESCRIPTION, question: q, cacheKey: tKey });
    const again = await resolveTailoredIdealProject({ engine: "gemini", description: DESCRIPTION, question: q, cacheKey: tKey });
    expect(again.title).toBe(GOOD_EXAMPLE.title);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("returns null and makes ZERO model calls for the embedded engine", async () => {
    const generateContent = installModel();
    const result = await resolveTailoredIdealProject({
      engine: "embedded",
      description: DESCRIPTION,
      question: "Tell me about a project you owned.",
      cacheKey: idealProjectTailoredKey("user-1", "app-1", "Tell me about a project you owned."),
    });
    expect(result).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("returns null for a blank posting, no model call", async () => {
    const generateContent = installModel();
    const result = await resolveTailoredIdealProject({
      engine: "gemini",
      description: "   ",
      question: "Tell me about a project you owned.",
      cacheKey: idealProjectTailoredKey("user-1", "app-1", "Tell me about a project you owned."),
    });
    expect(result).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("resolves to null — never rejects — when the model call throws", async () => {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn(() => Promise.reject(new Error("network gone"))) },
    });
    const result = await resolveTailoredIdealProject({
      engine: "gemini",
      description: DESCRIPTION,
      question: "Tell me about a project you owned.",
      cacheKey: idealProjectTailoredKey("user-1", "app-1", "Tell me about a project you owned."),
    });
    expect(result).toBeNull();
  });
});
