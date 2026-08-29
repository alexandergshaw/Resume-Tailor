import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// AC-C9b: this file's own resolver stays a no-op/miss by default — every
// case above this mock's addition sends no `applicationId`, so the real
// module would already behave this way; mocked so the one new case below can
// pin a resolved TOKEN without warming a real cache through a hanging
// `generateContent` mock (AC-P3.2's worked-example stand-in, above).
vi.mock("@/lib/copilot/answerCodeLanguage", () => ({
  startCodeLanguageResolution: vi.fn(),
  peekCodeLanguage: vi.fn(() => null),
  generateCodeLanguage: vi.fn(),
}));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { peekCodeLanguage } from "@/lib/copilot/answerCodeLanguage";
import { splitFrames } from "@/lib/copilot/answerStream";

// AC-P2.3/AC-P2.4/AC-P2.5/AC-P3.2: the streaming half of /api/copilot/answer.
//
// The user-visible claim under test is "the first bullet appears while the
// model is still writing the rest". That is only true if (a) the route
// actually flushes partial frames instead of buffering the whole response,
// and (b) nothing else on the request — the worked-example call, the posting
// lookup — sits in front of those frames. Both are asserted below by
// construction (a promise that never settles), not by timing, so neither can
// pass on a fast machine and fail on a slow one.

function jsonRequest(body) {
  return { json: async () => body };
}

function mockUser(id = "user-1") {
  const from = vi.fn(() => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    return chain;
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
    from,
  });
}

// AC-C9b: a signed-in user with a SELECTED posting, so the resolver's
// `applicationId`/`description` gates are satisfied and there is a
// description for the streamed prompt to leak. Same shape as
// `route.codeLanguage.test.js`'s own `mockUserWithPosting` — one
// `applications` row answers `fetchApplicationDocs`, `fetchPostingDescription`
// and `fetchPostingEmployer` alike. `company` is deliberately empty so no
// company-facts search starts and puts a third call on this request.
function mockUserWithPosting(description) {
  const from = vi.fn((table) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(async () => ({ data: [], error: null })),
      maybeSingle: vi.fn(async () => {
        if (table === "applications") {
          return {
            data: { id: "app-1", resume_used_id: null, cover_letter_id: null, positions: { description, company: "", title: "Backend Engineer" } },
            error: null,
          };
        }
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

// An async generator standing in for @google/genai's generateContentStream,
// which yields response chunks each carrying a `text` fragment of the whole.
function chunkStream(chunks) {
  return (async function* () {
    for (const text of chunks) yield { text };
  })();
}

// Splits a complete JSON document into `count` roughly equal fragments, the
// way the real stream arrives — arbitrary byte boundaries, no respect for
// token or field edges.
function fragment(doc, count) {
  const size = Math.ceil(doc.length / count);
  const out = [];
  for (let i = 0; i < doc.length; i += size) out.push(doc.slice(i, i + size));
  return out;
}

// Reads a streamed Response body to completion and returns the parsed frames.
async function readFrames(res) {
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
  const tail = splitFrames(buffer + "\n");
  frames.push(...tail.frames);
  return frames;
}

const PAYLOAD = {
  points: ["Situation: I led the checkout migration.", "Result: latency fell by a third."],
  type: "behavioral",
};

function mockGeminiStream(chunks, { idealProject } = {}) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const models = {
    generateContentStream: vi.fn().mockResolvedValue(chunkStream(chunks)),
    // The worked-example call. Defaults to a promise that NEVER settles, so
    // any test that completes proves the points frames did not wait on it.
    generateContent: vi.fn(() => idealProject || new Promise(() => {})),
  };
  getGeminiClient.mockReturnValue({ models });
  return models;
}

// Default the aux-feature engine to Gemini by making a key present, the same
// fix app/api/company-research/route.test.js's own beforeEach documents:
// wantsEmbedded (called by the route before any of this file's mocks come
// into play) reads process.env directly, not the mocked getServerEnv, so on
// a machine/CI with no Gemini_LLM_API_Key every request below that omits an
// explicit `engine` would silently take the embedded branch instead of the
// streaming one under test — passing or failing by accident of whether the
// developer's own .env.local happens to have a key, never by what the route
// actually does. The one test that exercises the embedded branch on purpose
// still passes engine: "embedded" explicitly and is unaffected.
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  peekCodeLanguage.mockReturnValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/copilot/answer with stream:true (AC-P2.3)", () => {
  it("401s before any model call when not signed in", async () => {
    mockUser(null);
    mockGeminiStream([JSON.stringify(PAYLOAD)]);
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    expect(res.status).toBe(401);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("responds as NDJSON, not JSON", async () => {
    mockUser();
    mockGeminiStream(fragment(JSON.stringify(PAYLOAD), 6));
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
  });

  it("emits points frames and then exactly one terminal done frame", async () => {
    mockUser();
    mockGeminiStream(fragment(JSON.stringify(PAYLOAD), 8));
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    const frames = await readFrames(res);

    const terminal = frames.filter((f) => f.t === "done" || f.t === "error");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].t).toBe("done");
    expect(frames[frames.length - 1]).toBe(terminal[0]);
  });

  it("emits at least one points frame BEFORE the response is complete (AC-P2.5)", async () => {
    // The whole feature. If the route buffers the model's response and only
    // writes once, this is 0 and the "streaming" answer is just a slower
    // non-streaming one with extra machinery.
    mockUser();
    mockGeminiStream(fragment(JSON.stringify(PAYLOAD), 8));
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    const frames = await readFrames(res);
    const pointFrames = frames.filter((f) => f.t === "points");
    expect(pointFrames.length).toBeGreaterThan(0);
    expect(pointFrames[0].points.length).toBeGreaterThan(0);
  });

  it("each points frame is a superset of the one before it", async () => {
    mockUser();
    mockGeminiStream(fragment(JSON.stringify(PAYLOAD), 12));
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    const pointFrames = (await readFrames(res)).filter((f) => f.t === "points");
    let previous = [];
    for (const frame of pointFrames) {
      expect(frame.points.slice(0, previous.length)).toEqual(previous);
      previous = frame.points;
    }
  });

  it("the done frame carries the full answer payload", async () => {
    mockUser();
    mockGeminiStream(fragment(JSON.stringify(PAYLOAD), 5));
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    const done = (await readFrames(res)).find((f) => f.t === "done");
    expect(done.points).toEqual(PAYLOAD.points);
    expect(done.type).toBe("behavioral");
    expect(Array.isArray(done.cues)).toBe(true);
    expect(done.cues).toHaveLength(PAYLOAD.points.length);
    expect(Array.isArray(done.buzzwords)).toBe(true);
    expect(done).toHaveProperty("resumeAnchor");
    expect(done).toHaveProperty("idealProject");
  });

  it("reports a model failure as a terminal error frame, never as a hung stream", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: {
        generateContentStream: vi.fn().mockRejectedValue(new Error("upstream exploded")),
        generateContent: vi.fn(() => new Promise(() => {})),
      },
    });
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    const frames = await readFrames(res);
    const terminal = frames.filter((f) => f.t === "done" || f.t === "error");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].t).toBe("error");
    expect(typeof terminal[0].error).toBe("string");
    expect(terminal[0].error.length).toBeGreaterThan(0);
  });

  it("reports an empty answer as an error frame rather than an empty done", async () => {
    mockUser();
    mockGeminiStream([JSON.stringify({ points: [], type: "general" })]);
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    const terminal = (await readFrames(res)).filter((f) => f.t === "done" || f.t === "error");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].t).toBe("error");
  });
});

describe("the worked example never blocks the bullets (AC-P3.2)", () => {
  it("streams and completes even when the ideal-project call never resolves", async () => {
    // generateContent is a promise that never settles. If `answerAids` still
    // awaits it on the critical path — as it does today — this test hangs and
    // times out rather than failing cleanly, which is itself the signal.
    mockUser();
    mockGeminiStream(fragment(JSON.stringify(PAYLOAD), 8));
    const res = await POST(jsonRequest({ question: "Tell me about a migration.", stream: true }));
    const frames = await readFrames(res);
    expect(frames.filter((f) => f.t === "points").length).toBeGreaterThan(0);
    const done = frames.find((f) => f.t === "done");
    expect(done).toBeTruthy();
    expect(done.points).toEqual(PAYLOAD.points);
  }, 5000);
});

describe("the code-language TOKEN reaches the streamed prompt, the posting never does (AC-C9b)", () => {
  it("streams a code-bearing answer carrying the token but none of the posting's own wording", async () => {
    // Distinctive spans from a posting that names no language at all, so
    // their absence is about the DESCRIPTION not crossing rather than about
    // some unrelated word being filtered.
    const description = [
      "Staff Engineer, Northwind Logistics",
      "PAYBANDMARKER: $160,000 - $210,000 annually.",
      "We operate 9 fulfillment centers across two continents.",
    ].join("\n");
    mockUserWithPosting(description);
    peekCodeLanguage.mockReturnValue("Go");
    const { generateContentStream } = mockGeminiStream(fragment(JSON.stringify(PAYLOAD), 6));
    const res = await POST(
      jsonRequest({
        question: "Implement a rate limiter.",
        applicationId: "app-1",
        interviewType: "technical",
        codeLanguage: "auto",
        engine: "gemini",
        stream: true,
      }),
    );
    await readFrames(res);

    const prompt = String(generateContentStream.mock.calls[0]?.[0]?.contents?.[0]?.parts?.[0]?.text || "");
    expect(prompt).toContain("Go");
    for (const marker of ["PAYBANDMARKER", "9 fulfillment centers", "two continents"]) {
      expect(prompt).not.toContain(marker);
    }
  });
});

describe("the non-streaming path is untouched (AC-P2.4)", () => {
  it("a request without stream:true still returns a plain JSON body", async () => {
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(PAYLOAD) }),
        generateContentStream: vi.fn(),
      },
    });
    const res = await POST(jsonRequest({ question: "Tell me about a migration." }));
    const data = await res.json();
    expect(data.points).toEqual(PAYLOAD.points);
    expect(data.type).toBe("behavioral");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("does not open a stream for a non-streaming request", async () => {
    mockUser();
    const generateContentStream = vi.fn();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(PAYLOAD) }),
        generateContentStream,
      },
    });
    await POST(jsonRequest({ question: "Tell me about a migration." }));
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it("the embedded engine ignores stream:true and answers on-device, with no model call", async () => {
    // Engine choice governs whether a feature calls a model at all — the
    // established rule for every AI feature in this repo. A streaming request
    // must not become the one hole in it.
    mockUser();
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn(), generateContentStream: vi.fn() } });
    const res = await POST(
      jsonRequest({
        question: "Tell me about a time you resolved a conflict.",
        profile: "Senior Engineer at Acme. Led the checkout migration, cut latency 30%.",
        engine: "embedded",
        stream: true,
      }),
    );
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });
});
