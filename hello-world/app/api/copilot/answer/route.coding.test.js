// N162 Wave B (4b) — RE-STATED from N161 SC-1. Owner reversed N161's REPLACE on
// 2026-10-12 (N162.ac.r1.md §BLAST RADIUS authorises this rework). Under N162 the
// coding solution is ADDITIVE and DOUBLE-GATED: the route ALWAYS produces the
// normal answer, and appends a coding section ONLY when
//   wantsCoding = body.includeCodingSolution === true && detectCodingChallenge(question)
// Binds to N162.arch.r1.md §5 and AC-N162-6/7/9/10/11/16/17/20.
//
// THE FIVE ANSWER-PRODUCING BRANCHES (route.js), re-read this round:
//   1. streaming Gemini done frame      (route.js:276-343)
//   2. non-streaming Gemini answer-mode (route.js:734-811)
//   3. non-streaming Gemini points-mode (route.js:863-931)
//   4. embedded answer-mode             (route.js:676-733)
//   5. embedded points-mode             (route.js:826-861)
//
// RED/GREEN on HEAD (verified 2026-10-12 against the shipped N161 tree):
//   - "AC-6 non-coding key sets" (below) are GREEN today and stay GREEN under
//     N162 (OFF/non-coding path is byte/key-identical to today — AC-N162-17).
//     They redden only if a build leaks a coding field onto a non-coding
//     response — the over-fire control.
//   - every ADDITIVE / gate case is RED today: HEAD REPLACES a detected-coding
//     Gemini answer with `{codingSolution, type}` (no points) and early-returns
//     the embedded fallback marker alone — so the normal-answer `points` this
//     chunk requires are absent, and HEAD ignores the request flag entirely.
//
// Satisfiability: the discarded reference in tests.r1.md builds the additive
// route and turns every RED green; the mocks here control the payload, so one
// model call returning BOTH `points` and `codingSolution` is mechanical.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
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

const NON_CODING = "Tell me about yourself.";
const NON_CODING_BEHAVIORAL = "Tell me about a time you handled a tight deadline.";

// A detected coding question (AC-1 positive; detectCodingChallenge→true and
// roleTerms→[] verified this round, so no role-term key perturbs the key sets).
const CODING_Q = "Write a function to reverse a linked list.";

// The ADDITIVE model payload: ONE call returns BOTH the spoken `points` AND a
// `codingSolution`. `points` is FIRST so the streaming parser emits points
// frames before the solution (arch §4.1 / pointsFromPartialJson anchor).
const CODING_PAYLOAD_ADDITIVE = {
  points: [
    "Walk the list once, reversing each next-pointer in place.",
    "Track previous, current, and next as you go.",
    "Return the previous pointer once you reach the end.",
  ],
  cues: ["reverse in place", "three pointers", "return prev"],
  type: "technical",
  codingSolution: {
    approach: "Walk the list once, reversing each next-pointer in place.",
    language: "Python",
    code: "def reverse(head):\n    prev = None\n    while head:\n        nxt = head.next\n        head.next = prev\n        prev = head\n        head = nxt\n    return prev",
    complexity: "O(n) time, O(1) space.",
    edgeCases: ["empty list", "single node"],
  },
};
// Hand-written EXPECTED (independent of normalizeCodingSolution): model token
// "Python" honoured.
const EXPECTED_SOLUTION = {
  approach: CODING_PAYLOAD_ADDITIVE.codingSolution.approach,
  language: "Python",
  code: CODING_PAYLOAD_ADDITIVE.codingSolution.code,
  complexity: CODING_PAYLOAD_ADDITIVE.codingSolution.complexity,
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
// AC-N162-17 — the OFF / non-coding path is key-for-key today's shape;
// NO coding field on any branch. Regression guards (GREEN on HEAD AND under
// N162). RED only on a build that leaks a coding field onto a non-coding
// response — the over-fire control.
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
// AC-N162-7 / AC-N162-9 — ADDITIVE: flag ON + detected coding → the NORMAL
// answer (points non-empty) AND codingSolution, on every Gemini branch.
// RED on HEAD (HEAD REPLACES: codingSolution with NO points). The exact key
// sets pinned here are the shape C caches and D renders.
// ---------------------------------------------------------------------------
describe("AC-N162-7/9 — additive: normal answer + codingSolution when flag ON ∧ detected (Gemini)", () => {
  it("branch 3: gemini points-mode returns points AND codingSolution (exact shape)", async () => {
    mockUser();
    mockGemini(CODING_PAYLOAD_ADDITIVE);
    const res = await POST(
      jsonRequest({ question: CODING_Q, engine: "gemini", interviewType: "technical", includeCodingSolution: true }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // Both sentinels — the normal answer is NOT suppressed (FD-2) AND the code
    // section is additive. A mutant restoring REPLACE fails the points sentinel.
    expect(data.points?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(data.codingSolution).toEqual(EXPECTED_SOLUTION);
    expect(data).not.toHaveProperty("answer"); // points mode
    // The exact additive shape: today's points-mode key set + codingSolution.
    expect(Object.keys(data).sort()).toEqual([
      "buzzwords",
      "codingSolution",
      "cues",
      "pageSources",
      "points",
      "resumeAnchor",
      "type",
    ]);
  });

  it("branch 2: gemini answer-mode returns points, answer AND codingSolution (exact shape)", async () => {
    mockUser();
    mockGemini(CODING_PAYLOAD_ADDITIVE);
    const res = await POST(
      jsonRequest({
        question: CODING_Q,
        mode: "answer",
        engine: "gemini",
        interviewType: "technical",
        includeCodingSolution: true,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(typeof data.answer).toBe("string");
    expect(data.codingSolution).toEqual(EXPECTED_SOLUTION);
    expect(Object.keys(data).sort()).toEqual([
      "answer",
      "buzzwords",
      "codingSolution",
      "cues",
      "grounding",
      "pageSources",
      "points",
      "resumeAnchor",
      "type",
    ]);
  });

  it("branch 1: streaming emits ≥1 points frame AND a done frame carrying points AND codingSolution", async () => {
    mockUser();
    mockGeminiStream(CODING_PAYLOAD_ADDITIVE);
    const res = await POST(
      jsonRequest({
        question: CODING_Q,
        engine: "gemini",
        interviewType: "technical",
        stream: true,
        includeCodingSolution: true,
      }),
    );
    const frames = await readFrames(res);
    const terminal = frames.filter((f) => f.t === "done" || f.t === "error");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].t).toBe("done");
    // The normal answer streams (≥1 incremental points frame) — RED→GREEN vs
    // N161 which asserted 0 points frames for a coding question.
    expect(frames.filter((f) => f.t === "points").length).toBeGreaterThanOrEqual(1);
    // The done frame carries BOTH the spoken points AND the solution.
    expect(terminal[0].points?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(terminal[0].codingSolution).toEqual(EXPECTED_SOLUTION);
    expect(Object.keys(terminal[0]).sort()).toEqual([
      "buzzwords",
      "codingSolution",
      "cues",
      "pageSources",
      "points",
      "resumeAnchor",
      "t",
      "type",
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC-N162-6 / AC-N162-16 — the gate is flag AND detection. Each conjunct has
// its own mutation control:
//   OFF + detected   → no coding section (catches the IGNORE-FLAG / always-add
//                       mutant, i.e. HEAD's detection-only gate).
//   ON  + non-coding → no coding section (catches the IGNORE-DETECTION /
//                       flag-alone mutant). GREEN on HEAD (non-coding path).
// ---------------------------------------------------------------------------
describe("AC-N162-6/16 — gate = includeCodingSolution === true AND detectCodingChallenge(question)", () => {
  it.each([
    ["flag omitted", {}],
    ["flag explicitly false", { includeCodingSolution: false }],
  ])("OFF (%s) + detected coding → normal answer, NO codingSolution (RED on HEAD)", async (_label, flag) => {
    mockUser();
    mockGemini(CODING_PAYLOAD_ADDITIVE); // payload carries a solution; the gate must drop it when OFF
    const res = await POST(
      jsonRequest({ question: CODING_Q, engine: "gemini", interviewType: "technical", ...flag }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(data).not.toHaveProperty("codingSolution");
  });

  it("ON + NON-coding question → normal answer, NO codingSolution (detection gates it; GREEN on HEAD, ignore-detection control)", async () => {
    mockUser();
    mockGemini(CODING_PAYLOAD_ADDITIVE); // payload carries a solution; detection=false must drop it
    const res = await POST(
      jsonRequest({ question: NON_CODING, engine: "gemini", includeCodingSolution: true }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(data).not.toHaveProperty("codingSolution");
  });
});

// ---------------------------------------------------------------------------
// AC-N162-10 / AC-N162-20 — embedded engine is ADDITIVE and still never
// fabricates code: normal on-device answer (points) + honest codingFallback
// marker, no `code` field anywhere. RED on HEAD (HEAD early-returns the marker
// ALONE, before the drafter runs — no points).
// ---------------------------------------------------------------------------
describe("AC-N162-10/20 — embedded additive: normal answer + honest fallback, no fabricated code", () => {
  it("embedded points-mode ON + detected → normal points AND codingFallback, no code", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        question: CODING_Q,
        profile: PROFILE,
        engine: "embedded",
        interviewType: "technical",
        includeCodingSolution: true,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points?.length ?? 0).toBeGreaterThanOrEqual(1); // RED on HEAD: fallback alone, no points
    expect(typeof data.codingFallback).toBe("string");
    expect(data.codingFallback.length).toBeGreaterThan(0);
    expect(data).not.toHaveProperty("code"); // FD-4
    expect(data.codingSolution?.code).toBeUndefined();
  });

  it("embedded answer-mode ON + detected → normal answer AND codingFallback, no code", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({
        question: CODING_Q,
        profile: PROFILE,
        mode: "answer",
        engine: "embedded",
        interviewType: "technical",
        includeCodingSolution: true,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(typeof data.codingFallback).toBe("string");
    expect(data).not.toHaveProperty("code");
    expect(data.codingSolution?.code).toBeUndefined();
  });

  it("embedded OFF + detected → normal answer, NO codingFallback (RED on HEAD; embedded ignore-flag control)", async () => {
    mockUser();
    const res = await POST(
      jsonRequest({ question: CODING_Q, profile: PROFILE, engine: "embedded", interviewType: "technical" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points?.length ?? 0).toBeGreaterThanOrEqual(1); // RED on HEAD
    expect(data).not.toHaveProperty("codingFallback"); // RED on HEAD
  });

  it("no Gemini client is constructed on the embedded coding path (guard)", async () => {
    mockUser();
    await POST(
      jsonRequest({
        question: CODING_Q,
        profile: PROFILE,
        engine: "embedded",
        interviewType: "technical",
        includeCodingSolution: true,
      }),
    );
    expect(getGeminiClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC-N162-11 — a malformed model coding payload (normalizeCodingSolution→null)
// with the flag ON must degrade to the NORMAL answer when points are present,
// never a half-built solution and never a 502. This is a GUARD, not a RED:
// with BOTH points and a malformed solution in one payload, HEAD already drops
// the unparseable solution and returns the points (200), so there is no
// HEAD/additive divergence to redden. The "502 → 200 flip" the AC describes is
// a PROMPT effect (the additive prompt asks for points), proven in
// answerPrompts.coding.test.js, not reproducible with one fixed route payload.
// ---------------------------------------------------------------------------
describe("AC-N162-11 — malformed coding payload with points present degrades to the normal answer (guard)", () => {
  it("gemini points-mode, flag ON, detected, codingSolution missing `code` → 200 normal answer, no codingSolution", async () => {
    mockUser();
    mockGemini({
      points: ["A real spoken point.", "A second spoken point."],
      type: "technical",
      codingSolution: { approach: "x", complexity: "y", edgeCases: [] }, // no code → normalizer returns null
    });
    const res = await POST(
      jsonRequest({ question: CODING_Q, engine: "gemini", interviewType: "technical", includeCodingSolution: true }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.points?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(data).not.toHaveProperty("codingSolution");
  });
});
