// @vitest-environment jsdom
//
// N161 SC-2 RE-STATED FOR N162 (step 4b) — practice mode's half of the coding
// answer's round-trip. The INTENT is preserved exactly: the worked solution a
// detected coding question produces must ride useSampleAnswer.js's full
// round-trip (response -> state -> cache ENTRY) on BOTH the user-requested
// `request` path and the silent `queue` pre-fetch, so a reveal served from the
// cache is never served without it.
//
// WHAT N162 REVERSES: N161 made the coding solution REPLACE the spoken answer,
// so the response carried codingSolution and NO points. N162 makes it ADDITIVE
// — the normal answer is ALWAYS produced and codingSolution/codingFallback
// COEXISTS with non-empty `points` on the same record. The responses below now
// carry BOTH, and the reveal is asserted to replay BOTH.
//
// The cache-hit case no longer needs the old "admit a pointless entry" trick:
// the entry carries real points, so cachedSampleAnswerFor admits it on the
// points alone. `draftAnswer.not.toHaveBeenCalled()` after the reveal still
// proves the coding field was CACHED, not re-fetched.
//
// The toggle is consistent ON throughout (BASE.includeCodingSolution = true and
// queue's trailing arg true), so the reveal grounding matches the entry's and
// the cache hits — the cross-toggle MISS is pinned separately in
// useSampleAnswer.includeCodingSolution.test.js.
//
// Harness copied from useSampleAnswer.projectExample.test.js next door.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
}));

import { useSampleAnswer } from "./useSampleAnswer.js";
import * as answerClient from "@/lib/copilot/answerClient.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CODING = {
  approach: "Two pointers from both ends of the string.",
  language: "Python",
  code: "def is_pal(s):\n    i, j = 0, len(s) - 1\n    # I keep two pointers\n    while i < j:\n        if s[i] != s[j]:\n            return False\n        i, j = i + 1, j - 1\n    return True",
  complexity: "O(n) time, O(1) space.",
  edgeCases: ["Empty string", "Single character"],
};

const CODING_POINTS = ["I would frame it as a two-pointer scan and talk through the invariant."];

const QUESTION = "Code a function that checks if a string is a palindrome.";
const OTHER_QUESTION = "Tell me about an incident you handled.";
const BASE = {
  question: QUESTION,
  profile: "",
  interviewType: "technical",
  applicationId: "app-1",
  codeLanguage: "auto",
  includeCodingSolution: true,
};

// N162 ADDITIVE: the non-streaming answer-mode body for a detected coding
// question under the toggle ON carries the normal answer (points + cues) AND
// the worked solution alongside it.
const codingResponse = () => ({
  points: CODING_POINTS,
  cues: ["Two-pointer scan"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [],
  grounding: { resume: false, coverLetter: false, pages: false },
  codingSolution: CODING,
  type: "technical",
});

// The embedded engine's honest marker (AC-10), again ALONGSIDE a normal answer.
const fallbackResponse = () => ({
  points: CODING_POINTS,
  cues: ["Two-pointer scan"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [],
  grounding: { resume: false, coverLetter: false, pages: false },
  codingFallback: "Switch to the AI engine for a worked code solution.",
  type: "technical",
});

// An ordinary non-coding answer — the regression control.
const plainResponse = () => ({
  points: ["I led the response."],
  cues: ["the response"],
  buzzwords: [],
  resumeAnchor: null,
  pageSources: [{ id: "p1", title: "Payments migration" }],
  grounding: { resume: false, coverLetter: false, pages: false },
});

let api;
function Probe(props) {
  api = useSampleAnswer(props);
  return null;
}

let root;
async function mount(props = BASE) {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(createElement(Probe, props)));
}
async function rerender(props) {
  await act(async () => root.render(createElement(Probe, props)));
}

beforeEach(() => {
  answerClient.draftAnswer.mockReset();
});

describe("useSampleAnswer — a fresh coding sample answer carries points AND the solution (N162 coexist)", () => {
  it("exposes BOTH points and codingSolution after a user-requested reveal (the `request` path)", async () => {
    answerClient.draftAnswer.mockResolvedValue(codingResponse());
    await mount();
    await act(async () => api.toggle());

    expect(api.status).toBe("done");
    expect(api.points).toEqual(CODING_POINTS);
    expect(api.codingSolution).toEqual(CODING);
    expect(answerClient.draftAnswer).toHaveBeenCalledTimes(1);
  });

  it("re-reveals points AND the solution from the `request` cache after moving away and back (no refetch)", async () => {
    answerClient.draftAnswer.mockResolvedValue(codingResponse());
    await mount();
    await act(async () => api.toggle());
    expect(api.codingSolution).toEqual(CODING);

    await rerender({ ...BASE, question: OTHER_QUESTION });
    await rerender(BASE);

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle());
    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
    expect(api.points).toEqual(CODING_POINTS);
    expect(api.codingSolution).toEqual(CODING);
  });
});

describe("useSampleAnswer — a QUEUED coding draft rides the cache entry (AC-8 practice)", () => {
  it("reveals points AND the solution from the queue's cache without a request of its own", async () => {
    // The queue path's cache write (:446) is the sabotage target: the mutant to
    // watch drops codingSolution from THIS write.
    answerClient.draftAnswer.mockResolvedValue(codingResponse());
    await mount();
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto", true));

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle());

    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
    expect(api.points).toEqual(CODING_POINTS);
    expect(api.codingSolution).toEqual(CODING);
  });

  it("reveals an embedded codingFallback marker beside its points from the queue's cache (AC-10)", async () => {
    answerClient.draftAnswer.mockResolvedValue(fallbackResponse());
    await mount();
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto", true));

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle());

    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
    expect(api.points).toEqual(CODING_POINTS);
    expect(api.codingFallback).toBe("Switch to the AI engine for a worked code solution.");
  });
});

describe("useSampleAnswer — a non-coding sample answer is UNCHANGED (SC-2 regression guard)", () => {
  it("still reveals points and pageSources from the queue cache and carries no coding field", async () => {
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount();
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto", true));

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle());

    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
    expect(api.points).toEqual(["I led the response."]);
    expect(api.pageSources).toEqual([{ id: "p1", title: "Payments migration" }]);
    expect(api.codingSolution).toBeUndefined();
    expect(api.codingFallback).toBeUndefined();
  });
});
