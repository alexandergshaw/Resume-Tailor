// @vitest-environment jsdom
//
// N161 SC-2 (step 4b) — practice mode's half of AC-8: the worked solution a
// detected coding question produces must ride useSampleAnswer.js's full
// round-trip (response -> state -> cache ENTRY) on BOTH the user-requested
// `request` path and the silent `queue` pre-fetch, so a reveal served from the
// cache is never served without it. Written BEFORE SC-2 lands; every coding
// case fails against today's hook, which does not destructure or cache a coding
// field.
//
// Harness copied from useSampleAnswer.projectExample.test.js next door. The
// cache-hit case uses the SAME queue(...) -> toggle() shape that file uses to
// prove Row 1 rides the cache: queue writes the entry, toggle reveals FROM it,
// and `draftAnswer` must NOT be called a second time on the reveal — that call
// count is what makes "the solution replayed" a genuine cache read rather than
// a second fetch returning the same mock.
//
// THE STRUCTURAL CATCH (see sampleAnswerState.codingSolution.test.js's header):
// a detected coding answer carries NO `points`; cachedSampleAnswerFor (via
// cachedAnswerFor) rejects a pointless entry, so on HEAD the toggle MISSES and
// pays for a fresh `request`. The `draftAnswer.not.toHaveBeenCalled()`
// assertion after the toggle is what forces the cache to admit a coding entry,
// not merely carry the field.

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

const QUESTION = "Code a function that checks if a string is a palindrome.";
const OTHER_QUESTION = "Tell me about an incident you handled.";
const BASE = { question: QUESTION, profile: "", interviewType: "technical", applicationId: "app-1", codeLanguage: "auto" };

// The route's non-streaming answer-mode body for a detected coding question:
// codingSolution and type, NO points (SC-1, route.js:762-763). draftAnswer
// resolves with this.
const codingResponse = () => ({ codingSolution: CODING, type: "technical" });

// The embedded engine's honest marker (AC-10): a fallback string, no code.
const fallbackResponse = () => ({
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

describe("useSampleAnswer — a fresh coding sample answer carries the solution", () => {
  it("exposes codingSolution from the response after a user-requested reveal (the `request` path)", async () => {
    // RED on HEAD: the hook destructures neither codingSolution nor exposes it
    // on its return, so api.codingSolution is undefined.
    answerClient.draftAnswer.mockResolvedValue(codingResponse());
    await mount();
    await act(async () => api.toggle());

    expect(api.status).toBe("done");
    expect(api.codingSolution).toEqual(CODING);
    expect(answerClient.draftAnswer).toHaveBeenCalledTimes(1);
  });

  it("re-reveals the SAME solution from the `request` cache after moving away and back (no refetch)", async () => {
    // The `request` path's own cache write (useSampleAnswer.js:306) must carry
    // the field. Reveal, switch to another question (which resets the single
    // state slot), switch back, reveal again — the second reveal is served
    // from the cache, so draftAnswer must stay at one call and the solution
    // must replay. RED on HEAD: field not cached AND the pointless entry is
    // rejected by the cache gate, so the second reveal refetches.
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
    expect(api.codingSolution).toEqual(CODING);
  });
});

describe("useSampleAnswer — a QUEUED coding draft rides the cache entry (AC-8 practice)", () => {
  it("reveals the solution from the queue's cache without a request of its own", async () => {
    // The queue path's cache write (useSampleAnswer.js:430) is the sabotage
    // target named by AC-8: the mutant to watch drops codingSolution from THIS
    // write. queue pre-fetches silently; toggle reveals from the entry.
    answerClient.draftAnswer.mockResolvedValue(codingResponse());
    await mount();
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto"));

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle());

    // RED on HEAD: a pointless coding entry is rejected by the cache gate, so
    // toggle pays for a fresh request (draftAnswer called) instead of a free
    // replay, and the field was never stored anyway.
    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
    expect(api.codingSolution).toEqual(CODING);
  });

  it("reveals an embedded codingFallback marker from the queue's cache too (AC-10)", async () => {
    answerClient.draftAnswer.mockResolvedValue(fallbackResponse());
    await mount();
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto"));

    answerClient.draftAnswer.mockClear();
    await act(async () => api.toggle());

    expect(answerClient.draftAnswer).not.toHaveBeenCalled();
    expect(api.status).toBe("done");
    expect(api.codingFallback).toBe("Switch to the AI engine for a worked code solution.");
  });
});

describe("useSampleAnswer — a non-coding sample answer is UNCHANGED (SC-2 regression guard)", () => {
  it("still reveals points and pageSources from the queue cache and carries no coding field", async () => {
    // Green on HEAD and after SC-2 — the control that the gate relaxation for
    // coding entries did not disturb the ordinary cached reveal.
    answerClient.draftAnswer.mockResolvedValue(plainResponse());
    await mount();
    await act(async () => api.queue(QUESTION, "", "technical", "app-1", "auto"));

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
