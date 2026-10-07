// N129 defect 2: the doubled TAILORED model call. Two render sites run the same
// per-question request, so two identical tailored resolutions arrive while the
// first is still in flight. They must share ONE model call and both receive the
// example; the result is cached once, so a later ask is a cache hit.
//
// Pinned here, at the resolver, because that is where the model call is made;
// the endpoint-level twin (two concurrent POSTs) is in
// app/api/copilot/ideal-project/route.tailoredDeadline.test.js. The model is a
// hand-resolved promise, so "concurrent" is exact: both resolutions are issued
// before the generation is allowed to finish.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { idealProjectTailoredKey, resolveTailoredIdealProject } from "./idealProjectResolver.js";
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

const Q1 = "Tell me about a project you owned.";
const Q2 = "Tell me about a time you resolved a conflict.";

// A model whose every call stays pending until `release()` lets them all finish.
function installHeldModel() {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const waiters = [];
  const generateContent = vi.fn(() => new Promise((resolve) => waiters.push(resolve)));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return {
    generateContent,
    release: () => waiters.forEach((resolve) => resolve({ text: JSON.stringify(GOOD_EXAMPLE) })),
  };
}

const resolveFor = (question, userId = "user-1") =>
  resolveTailoredIdealProject({
    engine: "gemini",
    description: DESCRIPTION,
    question,
    cacheKey: idealProjectTailoredKey(userId, "app-1", question),
  });

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

describe("resolveTailoredIdealProject — concurrent identical asks share one in-flight call (N129)", () => {
  it("calls the model EXACTLY ONCE for two concurrent resolutions of one key, and both receive the example", async () => {
    const { generateContent, release } = installHeldModel();
    const first = resolveFor(Q1);
    const second = resolveFor(Q1);
    expect(generateContent).toHaveBeenCalledTimes(1);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(a.title).toBe(GOOD_EXAMPLE.title);
    expect(b.title).toBe(GOOD_EXAMPLE.title);
  });

  it("populates the tailored cache once, and a later ask is a cache hit with no further model call", async () => {
    const { generateContent, release } = installHeldModel();
    const key = idealProjectTailoredKey("user-1", "app-1", Q1);
    const pair = [resolveFor(Q1), resolveFor(Q1)];
    release();
    await Promise.all(pair);
    expect(idealProjectTailoredCache.size()).toBe(1);
    expect(idealProjectTailoredCache.peek(key).project.title).toBe(GOOD_EXAMPLE.title);

    const later = await resolveFor(Q1);
    expect(later.title).toBe(GOOD_EXAMPLE.title);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("shares the call for a trailing-punctuation / case variant of the same question (one key)", async () => {
    const { generateContent, release } = installHeldModel();
    const first = resolveFor("Tell me about a project you owned.");
    const second = resolveFor("  TELL ME ABOUT A PROJECT YOU OWNED?  ");
    release();
    await Promise.all([first, second]);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("control: two DIFFERENT questions make two model calls", async () => {
    const { generateContent, release } = installHeldModel();
    const first = resolveFor(Q1);
    const second = resolveFor(Q2);
    expect(generateContent).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
    expect(idealProjectTailoredCache.size()).toBe(2);
  });

  it("control: the same question for two different USERS is two model calls (the key carries the user)", async () => {
    const { generateContent, release } = installHeldModel();
    const first = resolveFor(Q1, "user-1");
    const second = resolveFor(Q1, "user-2");
    expect(generateContent).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
  });

  it("both concurrent callers get null — never a rejection — when the shared call fails", async () => {
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    const generateContent = vi.fn(() => Promise.reject(new Error("network gone")));
    getGeminiClient.mockReturnValue({ models: { generateContent } });
    const [a, b] = await Promise.all([resolveFor(Q1), resolveFor(Q1)]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
