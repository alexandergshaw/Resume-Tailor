// @vitest-environment jsdom
//
// N161 SC-2 RE-STATED FOR N162 (step 4b) — live mode's half of the coding
// answer's client round-trip. The INTENT is preserved exactly: the worked
// solution a detected coding question produces must ride useDraftAnswer.js's
// full round-trip (response -> card -> answerCacheRef) so a CACHE HIT is never
// served without it.
//
// WHAT N162 REVERSES (owner ruling, see docs/loop/N162.ac.r1.md): N161 made the
// coding solution REPLACE the spoken answer, so the done frame carried
// codingSolution and NO points. N162 makes it ADDITIVE — the normal answer is
// ALWAYS produced and the codingSolution/codingFallback COEXISTS with non-empty
// `points` on the very same record. So the frames below now carry BOTH, and
// every assertion pins that BOTH survive the round-trip and the cache replay.
//
// The cache-hit case therefore no longer needs the old "admit a pointless
// entry" trick: a coding answer now carries real points, so answerGrounding.js's
// cachedAnswerFor admits it on the points alone. `toHaveBeenCalledTimes(1)`
// still holds the second ask to a cache read rather than a second fetch of the
// same mock — the proof that the coding field was CACHED, not merely re-fetched.
//
// Harness copied verbatim from useDraftAnswer.pageSources.test.js next door.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  draftAnswerStreaming: vi.fn(),
}));

import { useDraftAnswer } from "./useDraftAnswer.js";
import { draftAnswerStreaming } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CODING = {
  approach: "Two pointers from both ends of the string.",
  language: "Python",
  code: "def is_pal(s):\n    i, j = 0, len(s) - 1\n    # I keep two pointers\n    while i < j:\n        if s[i] != s[j]:\n            return False\n        i, j = i + 1, j - 1\n    return True",
  complexity: "O(n) time, O(1) space.",
  edgeCases: ["Empty string", "Single character"],
};

const CODING_POINTS = [
  "I would frame it as a two-pointer scan and walk through the invariant out loud.",
  "Then I would call out the empty-string and single-character edge cases.",
];

// N162 ADDITIVE: the route's streaming done frame for a detected coding question
// under the toggle ON carries the normal spoken answer (points + cues) AND the
// worked solution alongside it — never one in place of the other.
const CODING_FRAME = {
  points: CODING_POINTS,
  cues: ["Two-pointer scan"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [],
  codingSolution: CODING,
  type: "technical",
};

// The embedded engine's honest marker (AC-10) — again ALONGSIDE a normal answer,
// no code of any kind.
const FALLBACK_FRAME = {
  points: CODING_POINTS,
  cues: ["Two-pointer scan"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [],
  codingFallback: "Switch to the AI engine for a worked code solution.",
  type: "technical",
};

// An ordinary, non-coding done frame — the regression control.
const PLAIN_FRAME = {
  points: ["We moved settlement onto Kafka."],
  cues: ["The migration"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [{ id: "p1", title: "Payments migration" }],
  type: "behavioral",
};

const CODING_QUESTION = "Code a function that checks if a string is a palindrome.";
const PLAIN_QUESTION = "Tell me about a time you sharded a ledger.";

function seedQuestion(id, question) {
  return {
    id,
    question,
    at: Date.now(),
    status: "idle",
    points: null,
    cues: [],
    buzzwords: [],
    anchor: null,
    pageSources: [],
    type: null,
    error: "",
  };
}

function Probe({ onState }) {
  const [questions, setQuestions] = useState([]);
  const answerCacheRef = useRef(new Map());
  const draftGenRef = useRef(0);
  const runDraft = useDraftAnswer({
    profile: "Senior engineer, payments.",
    posting: null,
    answerCacheRef,
    draftGenRef,
    buildContext: () => "",
    setQuestions,
    logEvent: () => {},
  });
  onState({ questions, setQuestions, runDraft });
  return null;
}

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  act(() => {
    root.render(createElement(Probe, { onState: (s) => Object.assign(state, s) }));
  });
  return { root, container, state };
}

const entryOf = (state, id) => state.questions.find((q) => q.id === id);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useDraftAnswer — a fresh coding draft carries points AND the solution (N162 coexist)", () => {
  it("writes BOTH the spoken points and codingSolution from the done frame to the card", async () => {
    draftAnswerStreaming.mockResolvedValue(CODING_FRAME);
    const { root, state } = mountProbe();
    act(() => {
      state.setQuestions([seedQuestion(1, CODING_QUESTION)]);
    });
    await act(async () => {
      await state.runDraft(1, CODING_QUESTION);
    });

    expect(entryOf(state, 1).status).toBe("done");
    // The reversal in one line: the normal answer is present AND the solution
    // rides beside it. A build that re-introduced REPLACE (points dropped when
    // a solution is present) reds the points assertion.
    expect(entryOf(state, 1).points).toEqual(CODING_POINTS);
    expect(entryOf(state, 1).codingSolution).toEqual(CODING);

    act(() => root.unmount());
  });
});

describe("useDraftAnswer — a CACHE HIT carries points AND codingSolution (AC-8 live reuse)", () => {
  it("replays BOTH on the second ask WITHOUT a refetch", async () => {
    draftAnswerStreaming.mockResolvedValue(CODING_FRAME);
    const { root, state } = mountProbe();

    act(() => {
      state.setQuestions([seedQuestion(1, CODING_QUESTION)]);
    });
    await act(async () => {
      await state.runDraft(1, CODING_QUESTION);
    });
    expect(entryOf(state, 1).codingSolution).toEqual(CODING);
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);

    // A second card for the SAME normalized question — the interviewer circling
    // back — must be served from answerCacheRef, not a fresh call. Under N162 a
    // coding entry carries real points, so it is admitted on points alone;
    // holding the count at 1 proves the coding field was cached, not re-fetched.
    act(() => {
      state.setQuestions((prev) => [...prev, seedQuestion(2, CODING_QUESTION)]);
    });
    await act(async () => {
      await state.runDraft(2, CODING_QUESTION);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    const second = entryOf(state, 2);
    expect(second.status).toBe("done");
    expect(second.cached).toBe(true);
    expect(second.points).toEqual(CODING_POINTS);
    // The sabotage target: a cache write that dropped codingSolution passes
    // every other assertion here and reds this one alone.
    expect(second.codingSolution).toEqual(CODING);

    act(() => root.unmount());
  });

  it("replays an embedded codingFallback marker beside its points from the cache too (AC-10)", async () => {
    draftAnswerStreaming.mockResolvedValue(FALLBACK_FRAME);
    const { root, state } = mountProbe();

    act(() => {
      state.setQuestions([seedQuestion(1, CODING_QUESTION)]);
    });
    await act(async () => {
      await state.runDraft(1, CODING_QUESTION);
    });
    expect(entryOf(state, 1).codingFallback).toBe(FALLBACK_FRAME.codingFallback);
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);

    act(() => {
      state.setQuestions((prev) => [...prev, seedQuestion(2, CODING_QUESTION)]);
    });
    await act(async () => {
      await state.runDraft(2, CODING_QUESTION);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    const second = entryOf(state, 2);
    expect(second.cached).toBe(true);
    expect(second.points).toEqual(CODING_POINTS);
    expect(second.codingFallback).toBe(FALLBACK_FRAME.codingFallback);

    act(() => root.unmount());
  });
});

describe("useDraftAnswer — a non-coding draft is UNCHANGED (SC-2 regression guard)", () => {
  it("carries points and pageSources exactly as today and adds no codingSolution key", async () => {
    draftAnswerStreaming.mockResolvedValue(PLAIN_FRAME);
    const { root, state } = mountProbe();

    act(() => {
      state.setQuestions([seedQuestion(1, PLAIN_QUESTION)]);
    });
    await act(async () => {
      await state.runDraft(1, PLAIN_QUESTION);
    });
    expect(entryOf(state, 1).points).toEqual(PLAIN_FRAME.points);
    expect(entryOf(state, 1).pageSources).toEqual(PLAIN_FRAME.pageSources);
    expect(entryOf(state, 1).codingSolution).toBeUndefined();

    act(() => {
      state.setQuestions((prev) => [...prev, seedQuestion(2, PLAIN_QUESTION)]);
    });
    await act(async () => {
      await state.runDraft(2, PLAIN_QUESTION);
    });
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    const second = entryOf(state, 2);
    expect(second.cached).toBe(true);
    expect(second.pageSources).toEqual(PLAIN_FRAME.pageSources);
    expect(second.codingSolution).toBeUndefined();

    act(() => root.unmount());
  });
});
