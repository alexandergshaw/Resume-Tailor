// @vitest-environment jsdom
//
// N161 SC-2 (step 4b) — live mode's half of AC-8/AC-9: the worked solution a
// detected coding question produces must ride useDraftAnswer.js's full client
// round-trip (response -> card -> answerCacheRef) so a CACHE HIT is never served
// without it. Written BEFORE SC-2 lands; every coding case fails against today's
// hook, which does not destructure or cache `codingSolution`.
//
// Harness copied verbatim from useDraftAnswer.pageSources.test.js next door —
// the field this file pins travels the exact same response -> entry -> cache
// path pageSources does, so the proof is the same shape: a real mount of
// runDraft (NOT a source read, NOT a stubbed store), and the cache-hit case
// asserts the streaming client is called exactly ONCE across two asks for the
// same question, so "the solution survived" cannot be satisfied by a second
// real fetch returning the same mock.
//
// THE STRUCTURAL CATCH (see sampleAnswerState.codingSolution.test.js's header
// in full): a detected coding answer carries NO `points` — the solution
// REPLACES them. answerGrounding.js's cachedAnswerFor rejects an entry with no
// usable points, so on HEAD the second ask for a coding question MISSES the
// cache and refetches. `toHaveBeenCalledTimes(1)` is what makes that a red:
// carrying the field onto the entry is necessary but not sufficient; the cache
// must also admit a coding (pointless) entry.

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

// The route's streaming done frame for a detected coding question: the worked
// solution and the type, and NOTHING else — no points, cues or aids (SC-1
// contract, confirmed at app/api/copilot/answer/route.js:277-279). draftAnswer-
// Streaming resolves with exactly this frame (minus `t`).
const CODING_FRAME = { codingSolution: CODING, type: "technical" };

// The embedded engine's honest marker for the same question (AC-10): a fallback
// string, no code of any kind.
const FALLBACK_FRAME = {
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

describe("useDraftAnswer — a fresh coding draft carries the solution onto the card", () => {
  it("writes codingSolution from the done frame to the question entry", async () => {
    draftAnswerStreaming.mockResolvedValue(CODING_FRAME);
    const { root, state } = mountProbe();
    act(() => {
      state.setQuestions([seedQuestion(1, CODING_QUESTION)]);
    });
    await act(async () => {
      await state.runDraft(1, CODING_QUESTION);
    });

    // RED on HEAD: the hook does not destructure `codingSolution`, so it never
    // reaches the card.
    expect(entryOf(state, 1).status).toBe("done");
    expect(entryOf(state, 1).codingSolution).toEqual(CODING);

    act(() => root.unmount());
  });
});

describe("useDraftAnswer — a CACHE HIT still carries codingSolution (AC-8 live reuse)", () => {
  it("replays the SAME solution on the second ask WITHOUT a refetch", async () => {
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

    // A second card for the SAME normalized question — the interviewer
    // circling back — must be served from answerCacheRef, not a fresh call.
    // RED on HEAD for TWO reasons at once: (1) the field is never cached, and
    // (2) a coding entry has no points, so cachedAnswerFor rejects it and this
    // second ask refetches — call count goes to 2. Holding the count at 1 is
    // what forces BOTH the carry AND the cache-admission fix.
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
    // The sabotage target (the mutant to watch): a cache write that dropped
    // codingSolution passes every other assertion here and reds this one
    // alone.
    expect(second.codingSolution).toEqual(CODING);

    act(() => root.unmount());
  });

  it("replays an embedded codingFallback marker from the cache too (AC-10 live reuse)", async () => {
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
    expect(second.codingFallback).toBe(FALLBACK_FRAME.codingFallback);

    act(() => root.unmount());
  });
});

describe("useDraftAnswer — a non-coding draft is UNCHANGED (SC-2 regression guard)", () => {
  it("carries points and pageSources exactly as today and adds no codingSolution key", async () => {
    // Green on HEAD and after SC-2: the ordinary path must not sprout a coding
    // field, and the fields that already round-trip must keep doing so. This
    // is the control that a gate relaxation for coding entries did not quietly
    // change the non-coding entry's shape.
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
