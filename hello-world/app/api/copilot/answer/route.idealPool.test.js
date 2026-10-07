// N125 L3/L4/L5: how /api/copilot/answer SERVES the worked example now that it
// generates none. The example on the answer response is the READY pool entry —
// posting-only, question-INDEPENDENT — read by a synchronous cache peek; the
// per-question example has its own endpoint. idealProjectWiring.test.js pins the
// COLD half (a cold pool serves the deterministic archetype); this file is the
// WARM half and the latency invariant the whole chunk exists for, which the 4b
// pass named and left unauthored until the route was real:
//
//  - a warm pool is served as the answer's `idealProject.project`, on every
//    branch (streaming done frame, non-streaming answer mode, non-streaming
//    points mode), and it is the SAME example for two different questions —
//    the proof that what is served is the pool and never a per-question one;
//  - serving it makes ZERO example model calls: a warm-pool request's
//    `generateContent` count is exactly the answer call (or zero on the
//    streaming branch, whose answer call is `generateContentStream`), because
//    the prefetch's `cache.get` is a hit and starts no loader;
//  - a cold request starts the prefetch AFTER its own answer call, so the answer
//    is `generateContent`'s first call and the prefetch never sits ahead of it;
//  - the embedded engine neither reads nor primes the pool, even a warm one a
//    Gemini request left behind: no model example, no model call.
//
// Every absence assertion is paired with a positive control (the warm example
// IS served on the Gemini branches), so a route that served nothing at all
// cannot satisfy them.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache, idealProjectPoolCache } from "@/lib/copilot/answerSessionCache";
import { idealProjectPoolKey } from "@/lib/copilot/idealProjectResolver";
import { splitFrames } from "@/lib/copilot/answerStream";

const POSTING = [
  "Senior Product Manager, Education Technology",
  "We are hiring a product manager to own our K-12 product suite end to end.",
  "You will run Agile ceremonies and partner with UX design and customer success to shape the product roadmap.",
].join("\n");

const ANSWER_PAYLOAD = {
  points: ["Situation: I owned the rollout.", "Result: it landed on time."],
  cues: ["Situation: the rollout", "Result: on time"],
  type: "behavioral",
};

// The POOL's project, as normalizeIdealProject would have left it in the cache.
const POOL_PROJECT = {
  title: "POOL EXAMPLE TITLE: rebuilding the enrolment workflow teachers actually use.",
  sections: [
    { label: "Problem", body: "Two thirds of licensed teachers never returned after their first week, and the enrolment flow ran to seven screens." },
    { label: "Built", body: "A single-screen flow with the roster pre-filled from the student system, and an assistant flagging incomplete records." },
    { label: "Ran", body: "Two-week sprints with a teacher advisory group in every review, and a written decision log so settled trade-offs stayed settled." },
    { label: "Landed", body: "Baselined against the prior term and measured the same way after, including the part that did not move at all." },
  ],
  outcomes: [
    { metric: "adoption rate", figure: "34% to 71% of teachers active weekly" },
    { metric: "user satisfaction / NPS", figure: "teacher NPS +9 to +38" },
    { metric: "time-to-ship", figure: "median idea-to-production 9 weeks to 3" },
  ],
};

const POOL_KEY = idealProjectPoolKey("user-1", "app-1");

function mockUserWithPosting(description = POSTING) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        if (table === "applications") return { data: { id: "app-1", positions: { description } }, error: null };
        return { data: null, error: null };
      }),
    };
    return chain;
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from,
  });
}

function chunkStream(chunks) {
  return (async function* () {
    for (const text of chunks) yield { text };
  })();
}

// Answers every `generateContent` with the answer payload — which is also what
// a pool PREFETCH would receive, and normalizeIdealProject rejects it, so a
// cold prefetch here resolves to `{ project: null }` and never warms the pool
// behind the test's back.
function mockGemini() {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn(async () => ({ text: JSON.stringify(ANSWER_PAYLOAD) }));
  const generateContentStream = vi.fn(async () => chunkStream([JSON.stringify(ANSWER_PAYLOAD)]));
  getGeminiClient.mockReturnValue({ models: { generateContent, generateContentStream } });
  return { generateContent, generateContentStream };
}

async function warmPool() {
  await idealProjectPoolCache.get(POOL_KEY, async () => ({ project: POOL_PROJECT, resolvedAt: Date.now() }), {
    now: Date.now(),
  });
}

const ask = (body) =>
  POST({ json: async () => ({ applicationId: "app-1", engine: "gemini", question: "Tell me about a project you owned.", ...body }) });

async function framesOf(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const split = splitFrames(buffer);
    buffer = split.rest;
    frames.push(...split.frames);
  }
  frames.push(...splitFrames(`${buffer}\n`).frames);
  return frames;
}

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  idealProjectPoolCache.clear();
  mockUserWithPosting();
});

describe("a WARM pool is served as the answer's example, with no example model call (N125 L4/L5)", () => {
  it("non-streaming answer mode: the pool project, and exactly ONE generateContent (the answer)", async () => {
    const { generateContent } = mockGemini();
    await warmPool();
    const data = await (await ask({ mode: "answer" })).json();

    expect(data.idealProject.project.title).toBe(POOL_PROJECT.title);
    // Enrich, not substitute: the deterministic aid's own fields survive.
    expect(data.idealProject.shape.trim()).not.toBe("");
    expect(data.idealProject.summary).toMatch(/^They want a project built around/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("non-streaming points mode: the pool project, and exactly ONE generateContent (the answer)", async () => {
    const { generateContent } = mockGemini();
    await warmPool();
    const data = await (await ask({ mode: "points" })).json();

    expect(data.idealProject.project.title).toBe(POOL_PROJECT.title);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("streaming: the done frame carries the pool project, and generateContent is NEVER called", async () => {
    const { generateContent, generateContentStream } = mockGemini();
    await warmPool();
    const frames = await framesOf(await ask({ mode: "points", stream: true }));
    const done = frames.find((f) => f.t === "done");

    expect(done).toBeTruthy();
    expect(done.idealProject.project.title).toBe(POOL_PROJECT.title);
    // The latency invariant on the streaming branch: the answer is the stream
    // call; the READY example was a peek, and its prefetch was a cache hit.
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("serves the SAME pool example for two different questions (it is the pool, never a per-question example)", async () => {
    const { generateContent } = mockGemini();
    await warmPool();
    const first = await (await ask({ mode: "answer", question: "Tell me about a project you owned." })).json();
    const second = await (await ask({ mode: "answer", question: "Describe a time you handled a conflict." })).json();

    expect(first.idealProject.project.title).toBe(POOL_PROJECT.title);
    expect(second.idealProject.project.title).toBe(POOL_PROJECT.title);
    // Two requests, two answer calls, and no example call on either.
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});

describe("a COLD pool starts the prefetch AFTER the request's own answer call (N125 L3)", () => {
  it("the answer is generateContent's FIRST call and the prefetch is its second", async () => {
    const { generateContent } = mockGemini();
    const data = await (await ask({ mode: "answer" })).json();

    // Positive control on the cold contract: the deterministic archetype served.
    expect(data.idealProject.project.title).not.toBe(POOL_PROJECT.title);
    expect(data.idealProject.project.sections).toHaveLength(4);

    expect(generateContent).toHaveBeenCalledTimes(2);
    const texts = generateContent.mock.calls.map((c) => String(c[0]?.contents?.[0]?.parts?.[0]?.text || ""));
    // The answer prompt never carries the posting; the prefetch's does.
    expect(texts[0]).not.toContain("Senior Product Manager");
    expect(texts[1]).toContain("Senior Product Manager");
  });
});

// N125 fresh-verify F3: the streaming branch used to prime the pool in POST,
// BEFORE streamAnswer — and streamAnswer issues its stream call only after the
// producer's own facts wait, so the fire-and-forget pool call dispatched ahead of
// the answer the candidate is staring at (the opposite of the two non-streaming
// branches, and of "the prefetch is never the first model call"). It primes from
// inside the producer now, right after the stream call is issued.
describe("a COLD pool on the STREAMING branch also primes AFTER the request's own answer call (N125 F3)", () => {
  it("generateContentStream is issued before the prefetch's generateContent", async () => {
    const { generateContent, generateContentStream } = mockGemini();
    const frames = await framesOf(await ask({ mode: "points", stream: true }));
    const done = frames.find((f) => f.t === "done");

    // Positive controls: the stream completed, the cold serve was the
    // deterministic archetype (the pre-prime peek), and the prefetch DID run —
    // an ordering assertion over a prefetch that never happened proves nothing.
    expect(done).toBeTruthy();
    expect(done.idealProject.project.title).not.toBe(POOL_PROJECT.title);
    expect(done.idealProject.project.sections).toHaveLength(4);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(String(generateContent.mock.calls[0][0]?.contents?.[0]?.parts?.[0]?.text || "")).toContain("Senior Product Manager");

    expect(generateContentStream.mock.invocationCallOrder[0]).toBeLessThan(generateContent.mock.invocationCallOrder[0]);
  });

  it("a stream call that fails still leaves the candidate an error frame, never a hang", async () => {
    const { generateContentStream } = mockGemini();
    generateContentStream.mockImplementation(() => Promise.reject(new Error("upstream exploded")));
    const frames = await framesOf(await ask({ mode: "points", stream: true }));

    expect(frames.some((f) => f.t === "error")).toBe(true);
    expect(frames.some((f) => f.t === "done")).toBe(false);
  });
});

describe("the embedded engine neither reads nor primes the pool (N125 L10)", () => {
  it.each([
    ["answer mode", { mode: "answer" }],
    ["points mode", { mode: "points" }],
  ])("%s: a warm pool left by a Gemini request is NOT served, and no model is called", async (_name, body) => {
    const { generateContent, generateContentStream } = mockGemini();
    await warmPool();
    const data = await (await ask({ ...body, engine: "embedded" })).json();

    // Positive control: an example IS served — the deterministic one.
    expect(data.idealProject.project.sections).toHaveLength(4);
    expect(data.idealProject.project.title).not.toBe(POOL_PROJECT.title);
    expect(generateContent).not.toHaveBeenCalled();
    expect(generateContentStream).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
  });
});
