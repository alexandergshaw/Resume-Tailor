// N161 SC-1 — route wiring for the coding path (AC-6 per-branch key sets +
// codingSolution rides the done frame; AC-11 REPLACE on the response side;
// AC-10 embedded fallback fence). New file beside route.test.js / streaming.js
// so their existing exact-key-set assertions are never edited or weakened.
//
// THE FIVE ANSWER-PRODUCING BRANCHES (route.js), re-read this round to anchor
// AC-6's "codingSolution absent when not detected" to the REAL assertions:
//   1. streaming Gemini done frame      (route.js:313-337) — streaming.test.js
//      pins points/type/resumeAnchor on the done frame but NO full key-set
//      toEqual, so this file adds one.
//   2. non-streaming Gemini answer-mode (route.js:725-797) — route.test.js:314
//      has a full toEqual (with applicationId → projectExample); this file adds
//      the no-application key set.
//   3. non-streaming Gemini points-mode (route.js:851-915) — route.test.js:192
//      / :452 full toEqual (6 / 7 keys).
//   4. embedded answer-mode             (route.js:665-720) — route.test.js:225
//      pins fields but NO full key-set toEqual, so this file adds one.
//   5. embedded points-mode             (route.js:817-846) — route.test.js:172
//      full toEqual (6 keys).
// For branches 3 and 5 the existing toEqual already reddens if codingSolution
// leaks in; branches 1, 2 (no-app) and 4 are the gaps this file closes (AC-6 /
// m2). Every non-coding key set below is a regression guard: GREEN on HEAD,
// RED on a build that leaks codingSolution onto a non-coding response.
//
// The detected-coding cases are RED on HEAD: there is no coding branch, so a
// model payload carrying codingSolution but no `points` makes the route 502
// (Gemini) or emit a terminal `error` frame (streaming). The discarded
// reference in tests.r1.md proves them satisfiable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// Same reason streaming.test.js mocks it: keep the per-application resolver a
// miss so no request warms a real cache through a hanging generateContent.
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
import { answerContextCache } from "@/lib/copilot/answerSessionCache";

function jsonRequest(body) {
  return { json: async () => body };
}

function mockUser(id = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

// Non-streaming Gemini: returns exactly `payload` as the model's JSON text.
function mockGemini(payload) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockReturnValue({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(payload) }),
      generateContentStream: vi.fn(),
    },
  });
}

// Streaming Gemini: yields `payload` as one or more text chunks; generateContent
// never settles so any completed test proves the done frame came from the stream.
function chunkStream(chunks) {
  return (async function* () {
    for (const text of chunks) yield { text };
  })();
}
function mockGeminiStream(payload) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockReturnValue({
    models: {
      generateContentStream: vi.fn().mockResolvedValue(chunkStream([JSON.stringify(payload)])),
      generateContent: vi.fn(() => new Promise(() => {})),
    },
  });
}
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

const PROFILE = [
  "Senior Software Engineer, Acme Corp",
  "Built a React and Node.js platform serving 2M users.",
].join("\n");

// Non-coding question with no role-taxonomy term (so roleTermsFlag stays {}),
// used for the clean key-set guards. "Tell me about a time you handled a tight
// deadline." is the embedded-mode fixture route.test.js:153 already pins at a
// 6-key set, confirming it fires no role-term flags.
const NON_CODING = "Tell me about yourself.";
const NON_CODING_BEHAVIORAL = "Tell me about a time you handled a tight deadline.";

// A detected coding question (AC-1 positive) and the model payload the coding
// prompt asks for. No `points`: a worked solution REPLACES the spoken answer.
const CODING_Q = "Write a function to reverse a linked list.";
const CODING_PAYLOAD = {
  codingSolution: {
    approach: "Walk the list once, reversing each next-pointer in place.",
    language: "Python",
    code: "def reverse(head):\n    prev = None\n    while head:\n        nxt = head.next\n        head.next = prev\n        prev = head\n        head = nxt\n    return prev",
    complexity: "O(n) time, O(1) space.",
    edgeCases: ["empty list", "single node"],
  },
  type: "technical",
};
// Hand-written EXPECTED (independent of normalizeCodingSolution, so this is not
// a self-consistency canary): model language token "Python" is honoured.
const EXPECTED_SOLUTION = {
  approach: CODING_PAYLOAD.codingSolution.approach,
  language: "Python",
  code: CODING_PAYLOAD.codingSolution.code,
  complexity: CODING_PAYLOAD.codingSolution.complexity,
  edgeCases: ["empty list", "single node"],
};

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  peekCodeLanguage.mockReturnValue(null);
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// AC-6 — non-coding response is key-for-key today's shape; codingSolution
// ABSENT (not null, not []) on every branch. Regression guards (GREEN on HEAD).
// ---------------------------------------------------------------------------
describe("AC-6 — non-coding key sets, codingSolution absent on all five branches", () => {
  it("branch 3: gemini points-mode (no application)", async () => {
    mockUser();
    mockGemini({ points: ["Point one", "Point two"], type: "general" });
    const res = await POST(jsonRequest({ question: NON_CODING, engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(["buzzwords", "cues", "pageSources", "points", "resumeAnchor", "type"]);
    expect(data).not.toHaveProperty("codingSolution");
  });

  it("branch 2: gemini answer-mode (no application)", async () => {
    mockUser();
    mockGemini({ points: ["A generic sample point."], type: "general" });
    const res = await POST(jsonRequest({ question: NON_CODING, mode: "answer", engine: "gemini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual([
      "answer",
      "buzzwords",
      "cues",
      "grounding",
      "pageSources",
      "points",
      "resumeAnchor",
      "type",
    ]);
    expect(data).not.toHaveProperty("codingSolution");
  });

  it("branch 5: embedded points-mode", async () => {
    mockUser();
    const res = await POST(jsonRequest({ question: NON_CODING_BEHAVIORAL, profile: PROFILE, engine: "embedded" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(["buzzwords", "cues", "pageSources", "points", "resumeAnchor", "type"]);
    expect(data).not.toHaveProperty("codingSolution");
  });

  it("branch 4: embedded answer-mode", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({ question: NON_CODING_BEHAVIORAL, profile: PROFILE, mode: "answer", engine: "embedded" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual([
      "answer",
      "buzzwords",
      "cues",
      "grounding",
      "pageSources",
      "points",
      "resumeAnchor",
      "type",
    ]);
    expect(data).not.toHaveProperty("codingSolution");
  });

  it("branch 1: streaming gemini done frame", async () => {
    mockUser();
    mockGeminiStream({ points: ["Situation: I led it.", "Result: it worked."], type: "behavioral" });
    const res = await POST(jsonRequest({ question: NON_CODING, engine: "gemini", stream: true }));
    const frames = await readFrames(res);
    const done = frames.find((f) => f.t === "done");
    expect(done).toBeTruthy();
    expect(Object.keys(done).sort()).toEqual([
      "buzzwords",
      "cues",
      "pageSources",
      "points",
      "resumeAnchor",
      "t",
      "type",
    ]);
    expect(done).not.toHaveProperty("codingSolution");
  });
});

// ---------------------------------------------------------------------------
// AC-6 + AC-11 — a DETECTED coding question: the worked solution rides the
// response in place of points, on the three Gemini branches. RED on HEAD.
// ---------------------------------------------------------------------------
describe("AC-6 / AC-11 — detected coding question carries codingSolution, suppresses points (Gemini)", () => {
  it("branch 3: gemini points-mode returns codingSolution and NO points/answer", async () => {
    mockUser();
    mockGemini(CODING_PAYLOAD);
    const res = await POST(jsonRequest({ question: CODING_Q, engine: "gemini", interviewType: "technical" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.codingSolution).toEqual(EXPECTED_SOLUTION);
    // AC-11 REPLACE: no spoken-points list and no derived prose beside the code.
    expect(data).not.toHaveProperty("points");
    expect(data).not.toHaveProperty("answer");
  });

  it("branch 2: gemini answer-mode returns codingSolution and NO points/answer", async () => {
    mockUser();
    mockGemini(CODING_PAYLOAD);
    const res = await POST(
      jsonRequest({ question: CODING_Q, mode: "answer", engine: "gemini", interviewType: "technical" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.codingSolution).toEqual(EXPECTED_SOLUTION);
    expect(data).not.toHaveProperty("points");
    expect(data).not.toHaveProperty("answer");
  });

  it("branch 1: streaming done frame carries codingSolution, not a spoken answer", async () => {
    mockUser();
    mockGeminiStream(CODING_PAYLOAD);
    const res = await POST(
      jsonRequest({ question: CODING_Q, engine: "gemini", interviewType: "technical", stream: true }),
    );
    const frames = await readFrames(res);
    const terminal = frames.filter((f) => f.t === "done" || f.t === "error");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].t).toBe("done");
    expect(terminal[0].codingSolution).toEqual(EXPECTED_SOLUTION);
    // No incremental points frames for a coding question: nothing to speak.
    expect(frames.filter((f) => f.t === "points")).toHaveLength(0);
    expect(terminal[0]).not.toHaveProperty("points");
  });

  it("a malformed model coding payload degrades to a safe non-coding answer, never a half-built object (AC-3)", async () => {
    // Model claims a coding solution but omits `code` AND returns no points:
    // the normaliser yields null, and with no points the route reports the
    // ordinary empty-answer error rather than shipping a partial solution.
    mockUser();
    mockGemini({ codingSolution: { approach: "x", complexity: "y", edgeCases: [] }, type: "technical" });
    const res = await POST(jsonRequest({ question: CODING_Q, engine: "gemini", interviewType: "technical" }));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data).not.toHaveProperty("codingSolution");
  });
});

// ---------------------------------------------------------------------------
// AC-10 / D6 — the embedded engine never fabricates code. Honest fallback
// marker, no code field, on both embedded branches. The "no code" half is a
// scope fence (vacuous on HEAD until the marker exists); the teeth are the
// marker-present assertion (RED on HEAD) and the no-code mutant.
// ---------------------------------------------------------------------------
describe("AC-10 — embedded engine returns an honest fallback, no fabricated code", () => {
  it("embedded points-mode: a detected coding question yields the fallback marker and no code", async () => {
    mockUser();
    const res = await POST(jsonRequest({ question: CODING_Q, engine: "embedded", interviewType: "technical" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.codingFallback).toBe("string");
    expect(data.codingFallback.length).toBeGreaterThan(0);
    expect(data).not.toHaveProperty("code");
    // No fabricated solution object carrying code either.
    expect(data.codingSolution?.code).toBeUndefined();
  });

  it("embedded answer-mode: same honest fallback, no code", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({ question: CODING_Q, mode: "answer", engine: "embedded", interviewType: "technical" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.codingFallback).toBe("string");
    expect(data).not.toHaveProperty("code");
    expect(data.codingSolution?.code).toBeUndefined();
  });

  it("no Gemini client is constructed on the embedded coding path", async () => {
    mockUser();
    await POST(jsonRequest({ question: CODING_Q, engine: "embedded", interviewType: "technical" }));
    expect(getGeminiClient).not.toHaveBeenCalled();
  });
});
