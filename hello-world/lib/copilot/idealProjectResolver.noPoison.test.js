// N130 part (1): a FAILED or empty TAILORED generation must not be retained.
//
// `generateIdealProjectExample` resolves to null (never rejects) on a model
// failure, a timeout-shaped error, an unparseable reply, or a reply
// `normalizeIdealProject` rejects. The tailored cache stores the LOADER'S
// PROMISE, so caching that null would pin "no example" under the question's key
// for the whole 30 minute TTL: a same-question retry would get null without
// the model being asked again, which undoes the N129 deadline fix for exactly
// the case the candidate retries. A null must be evicted the moment it settles
// (so the next resolution re-attempts), while a real example still caches for
// the full TTL and concurrent identical asks still share one call.
//
// The READY (pool) tier deliberately keeps caching its null — at most one
// attempt per pool key per TTL is its cost bound — and one control here pins
// that it is untouched.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import {
  idealProjectPoolKey,
  idealProjectTailoredKey,
  peekIdealProject,
  resolveTailoredIdealProject,
  startIdealProjectResolution,
} from "./idealProjectResolver.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { idealProjectPoolCache, idealProjectTailoredCache } from "./answerSessionCache.js";

const DESCRIPTION = [
  "Senior Product Manager, Education Technology",
  "We are hiring a product manager to own our K-12 product suite end to end.",
  "You will run Agile ceremonies and partner with UX design and customer success.",
].join("\n");

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

const Q = "Tell me about a project you owned.";
const KEY = idealProjectTailoredKey("user-1", "app-1", Q);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A model that plays `steps` in order, one per call. A step is a thunk returning
// the generateContent result (or a rejected promise).
function installScriptedModel(steps) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  let call = 0;
  const generateContent = vi.fn(() => steps[Math.min(call++, steps.length - 1)]());
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

const rejects = () => Promise.reject(new Error("model timed out"));
const garbage = () => Promise.resolve({ text: "this is not json at all" });
const emptyObject = () => Promise.resolve({ text: "{}" });
const good = () => Promise.resolve({ text: JSON.stringify(GOOD_EXAMPLE) });

const resolveQ = () =>
  resolveTailoredIdealProject({ engine: "gemini", description: DESCRIPTION, question: Q, cacheKey: KEY });

beforeEach(() => {
  getServerEnv.mockReset();
  getGeminiClient.mockReset();
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
});

afterEach(() => {
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
});

describe("resolveTailoredIdealProject — a null result is not retained (N130 part 1)", () => {
  it.each([
    ["the model call rejects", rejects],
    ["the reply is not JSON", garbage],
    ["the reply is JSON normalizeIdealProject rejects", emptyObject],
  ])("a retry RE-ATTEMPTS the model and can succeed when %s the first time", async (_label, failingStep) => {
    const generateContent = installScriptedModel([failingStep, good]);
    expect(await resolveQ()).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(1);

    const retry = await resolveQ();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(retry).not.toBeNull();
    expect(retry.title).toBe(GOOD_EXAMPLE.title);
  });

  it("leaves nothing under the key once the null settles: no entry, no peekable value", async () => {
    installScriptedModel([garbage]);
    expect(await resolveQ()).toBeNull();
    expect(idealProjectTailoredCache.size()).toBe(0);
    expect(idealProjectTailoredCache.peek(KEY)).toBeNull();
  });

  it("re-attempts on EVERY retry while the model keeps failing, never serving a cached null", async () => {
    const generateContent = installScriptedModel([rejects, garbage, rejects, good]);
    expect(await resolveQ()).toBeNull();
    expect(await resolveQ()).toBeNull();
    expect(await resolveQ()).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(3);
    const finally_ = await resolveQ();
    expect(generateContent).toHaveBeenCalledTimes(4);
    expect(finally_.title).toBe(GOOD_EXAMPLE.title);
  });

  it("a failed call for one question does not touch another question's cached example", async () => {
    const otherQ = "Tell me about a time you resolved a conflict.";
    const otherKey = idealProjectTailoredKey("user-1", "app-1", otherQ);
    const generateContent = installScriptedModel([good, garbage]);
    const other = await resolveTailoredIdealProject({ engine: "gemini", description: DESCRIPTION, question: otherQ, cacheKey: otherKey });
    expect(other.title).toBe(GOOD_EXAMPLE.title);
    expect(await resolveQ()).toBeNull();
    expect(idealProjectTailoredCache.peek(otherKey).project.title).toBe(GOOD_EXAMPLE.title);
    expect(idealProjectTailoredCache.size()).toBe(1);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("concurrent identical asks still share ONE call when it fails, both get null, and the next ask re-attempts", async () => {
    const generateContent = installScriptedModel([rejects, good]);
    const [a, b] = await Promise.all([resolveQ(), resolveQ()]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(1);

    const retry = await resolveQ();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(retry.title).toBe(GOOD_EXAMPLE.title);
  });
});

describe("resolveTailoredIdealProject — a real example still caches and dedupes (controls)", () => {
  it("control: a SUCCESSFUL result is cached — a second same-key resolution is a hit, one model call", async () => {
    const generateContent = installScriptedModel([good]);
    const first = await resolveQ();
    const second = await resolveQ();
    expect(first.title).toBe(GOOD_EXAMPLE.title);
    expect(second.title).toBe(GOOD_EXAMPLE.title);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(idealProjectTailoredCache.peek(KEY).project.title).toBe(GOOD_EXAMPLE.title);
  });

  it("control: a success is not evicted by a later failing call for another key", async () => {
    const generateContent = installScriptedModel([good, garbage]);
    await resolveQ();
    const otherQ = "Tell me about a time you failed.";
    const other = await resolveTailoredIdealProject({
      engine: "gemini",
      description: DESCRIPTION,
      question: otherQ,
      cacheKey: idealProjectTailoredKey("user-1", "app-1", otherQ),
    });
    expect(other).toBeNull();
    const again = await resolveQ();
    expect(again.title).toBe(GOOD_EXAMPLE.title);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("control: two CONCURRENT same-key asks share one call and both get the example", async () => {
    const waiters = [];
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    const generateContent = vi.fn(() => new Promise((resolve) => waiters.push(resolve)));
    getGeminiClient.mockReturnValue({ models: { generateContent } });

    const first = resolveQ();
    const second = resolveQ();
    expect(generateContent).toHaveBeenCalledTimes(1);
    waiters.forEach((resolve) => resolve({ text: JSON.stringify(GOOD_EXAMPLE) }));
    const [a, b] = await Promise.all([first, second]);
    expect(a.title).toBe(GOOD_EXAMPLE.title);
    expect(b.title).toBe(GOOD_EXAMPLE.title);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(idealProjectTailoredCache.size()).toBe(1);
  });
});

describe("the READY pool tier is untouched (control)", () => {
  it("still caches a failed pool generation: one attempt per pool key per TTL, peek stays null", async () => {
    const generateContent = installScriptedModel([garbage, good]);
    const poolKey = idealProjectPoolKey("user-1", "app-1");
    startIdealProjectResolution({ engine: "gemini", description: DESCRIPTION, cacheKey: poolKey });
    await flush();
    startIdealProjectResolution({ engine: "gemini", description: DESCRIPTION, cacheKey: poolKey });
    await flush();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(peekIdealProject(poolKey)).toBeNull();
    expect(idealProjectPoolCache.size()).toBe(1);
  });
});
