// @vitest-environment jsdom
//
// AC-O4: practice mode's drill half. The typed question also becomes the
// question on the card the candidate records an answer against, which means
// it has to survive everything that can arrive after it — most importantly a
// generated question that was already in flight when they typed. That guard
// is `reqGenRef`, and it only exists inside the hook's own async body, so
// nothing under `environment: "node"` can observe whether the manual setter
// participates in it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/questionClient", () => ({ fetchNextQuestion: vi.fn() }));

import { usePracticeQuestions } from "./usePracticeQuestions.js";
import { fetchNextQuestion } from "@/lib/copilot/questionClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ onState }) {
  const state = usePracticeQuestions({ posting: null });
  onState(state);
  return null;
}

// Every mount is tracked and torn down in afterEach -- an unmount written as
// the last statement of an `it` is skipped whenever an assertion fails.
const mounted = [];

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Probe, { onState: (s) => Object.assign(state, s) }));
  });
  return { root, container, state };
}

// A fetch the test controls the settling of, so "still in flight" is a real
// state rather than a race.
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  vi.clearAllMocks();
});

describe("usePracticeQuestions — a manually set question (AC-O4)", () => {
  it("puts the typed question on the card with the type it was given", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.setManualQuestion("Tell me about a time you disagreed with your manager.", "behavioral");
    });
    expect(state.currentQuestion).toMatchObject({
      question: "Tell me about a time you disagreed with your manager.",
      type: "behavioral",
    });
    expect(state.currentQuestionText).toBe(
      "Tell me about a time you disagreed with your manager.",
    );
  });

  it("updates currentQuestionRef synchronously, before any effect flushes", async () => {
    // usePracticeAnswerActions reads the REF, not the state value, when it
    // stamps which question an answer belongs to.
    //
    // Read INSIDE the same act as the call, with nothing flushed in between.
    // Asserting after `await act(...)` proved nothing: the hook already
    // mirrors currentQuestion into the ref from an effect, and awaiting runs
    // that effect, so the assertion passed even when the setter itself never
    // touched the ref. Only this timing distinguishes the two -- and it is
    // the timing a user gets when they press Add and immediately press
    // Start answering.
    const { state } = mountProbe();
    let seen;
    await act(async () => {
      state.setManualQuestion("Why are you leaving your current job?", "general");
      seen = state.currentQuestionRef.current;
    });
    expect(seen).toEqual({
      question: "Why are you leaving your current job?",
      type: "general",
    });
  });

  it("clears a failed request's error, since a question is now on screen", async () => {
    fetchNextQuestion.mockRejectedValueOnce(new Error("Could not reach the question service."));
    const { state } = mountProbe();
    await act(async () => {
      await state.requestQuestion([]);
    });
    expect(state.questionError).toBeTruthy();

    await act(async () => {
      state.setManualQuestion("What interests you about this role?", "general");
    });
    expect(state.questionError).toBe("");
  });

  it("clears the spinner, so the card shows the typed question rather than 'getting your next question'", async () => {
    const pending = deferred();
    fetchNextQuestion.mockReturnValueOnce(pending.promise);
    const { state } = mountProbe();
    act(() => {
      state.requestQuestion([]);
    });
    expect(state.questionLoading).toBe(true);

    await act(async () => {
      state.setManualQuestion("What interests you about this role?", "general");
    });
    expect(state.questionLoading).toBe(false);
  });

  it("clears 'exhausted', so Next question is usable again after typing one", async () => {
    // The exhausted notice disables Next question. Left standing beside a
    // freshly typed question it both reads as false and strands the user on
    // that question with no way forward.
    fetchNextQuestion.mockResolvedValueOnce({ question: "Last one.", type: "general", exhausted: true });
    const { state } = mountProbe();
    await act(async () => {
      await state.requestQuestion([]);
    });
    expect(state.exhausted).toBe(true);

    await act(async () => {
      state.setManualQuestion("What interests you about this role?", "general");
    });
    expect(state.exhausted).toBe(false);
  });

  it("is not overwritten by a generated question that was already in flight", async () => {
    const pending = deferred();
    fetchNextQuestion.mockReturnValueOnce(pending.promise);
    const { state } = mountProbe();
    act(() => {
      state.requestQuestion([]);
    });

    await act(async () => {
      state.setManualQuestion("Describe your ideal team.", "general");
    });
    // The slow generated question lands AFTER the user typed their own.
    await act(async () => {
      pending.resolve({ question: "Tell me about yourself.", type: "general", exhausted: false });
      await pending.promise;
    });

    expect(state.currentQuestion.question).toBe("Describe your ideal team.");
    expect(state.questionLoading).toBe(false);
  });

  it("joins the asked list when the user moves on, so it is not regenerated", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.setManualQuestion("Describe your ideal team.", "general");
    });
    let next;
    await act(async () => {
      next = state.advanceAsked();
    });
    expect(next).toEqual(["Describe your ideal team."]);
  });
});
