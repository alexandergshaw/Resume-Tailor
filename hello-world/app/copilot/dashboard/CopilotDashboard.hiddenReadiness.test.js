// @vitest-environment jsdom
//
// M8/AC-N18.13. Forty lines of doc comment on CurrentAnswerPanel explain the
// DELIBERATE divergence `announceHiddenReadiness` drives: live mode passes it
// so the status region keeps announcing the REAL draft status
// ("Drafting an answer" / "Answer ready, N points") even while the answer is
// hidden behind the confirm gate's reveal button — the whole point of
// withholding it is to tell the candidate an answer is ready BEFORE they
// click to see it. Nothing in the suite measured this: re-importing R-110's
// unconditional silence (`status: answerHidden ? "idle" : current?.status`, dropping the
// `&& !announceHiddenReadiness` clause) survives the full suite today. This
// file renders both sides of the divergence and asserts the region's TEXT
// directly.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CopilotDashboard from "./CopilotDashboard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function entry(overrides = {}) {
  return {
    id: 1,
    question: "Tell me about yourself.",
    at: Date.now(),
    status: "done",
    points: ["A specific accomplishment."],
    cues: [],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    pageSources: [],
    error: "",
    ...overrides,
  };
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(CopilotDashboard, props));
  });
}

function region() {
  return container.querySelector('[role="status"]');
}

describe("M8/AC-N18.13: announceHiddenReadiness keeps the real status flowing while the answer is hidden", () => {
  it("announces 'Answer ready, N points' while hidden, when announceHiddenReadiness is true", async () => {
    const current = entry({ status: "done" });
    await render({
      questions: [current],
      current,
      currentIsSeed: true,
      answerHidden: true,
      announceHiddenReadiness: true,
      onRevealAnswer: () => {},
      revealLabel: "Show answer",
    });
    expect(region().textContent).toContain("Answer ready, 1 point");
    // The answer's own content must still be withheld — this only affects
    // what the polite region SAYS, never what is visibly on screen.
    expect(container.textContent).not.toContain("A specific accomplishment.");
  });

  it("announces 'Drafting an answer' while hidden and still loading, when announceHiddenReadiness is true", async () => {
    const current = entry({ status: "loading", points: null });
    await render({
      questions: [current],
      current,
      currentIsSeed: true,
      answerHidden: true,
      announceHiddenReadiness: true,
      onRevealAnswer: () => {},
      revealLabel: "Show answer",
    });
    expect(region().textContent).toBe("Drafting an answer");
  });

  // Control: proves the region's text is actually GATED on
  // announceHiddenReadiness, not merely always reflecting the real status —
  // practice mode's own R-110 silence (the default, `false`) must still
  // withhold it.
  it("[control] stays silent about readiness while hidden, when announceHiddenReadiness is false (the default)", async () => {
    const current = entry({ status: "done" });
    await render({
      questions: [current],
      current,
      currentIsSeed: true,
      answerHidden: true,
      announceHiddenReadiness: false,
      onRevealAnswer: () => {},
      revealLabel: "Show sample answer",
    });
    expect(region().textContent).not.toContain("Answer ready");
    expect(region().textContent).toBe("");
  });

  // Control: proves the divergence is specific to the HIDDEN state — once
  // revealed, both flags must read identically (there is nothing left to
  // withhold either way).
  it("[control] once revealed, the region reads the same regardless of announceHiddenReadiness", async () => {
    const current = entry({ status: "done" });
    await render({
      questions: [current],
      current,
      currentIsSeed: false,
      answerHidden: false,
      announceHiddenReadiness: true,
    });
    const withTrue = region().textContent;

    await render({
      questions: [current],
      current,
      currentIsSeed: false,
      answerHidden: false,
      announceHiddenReadiness: false,
    });
    const withFalse = region().textContent;

    expect(withTrue).toBe(withFalse);
    expect(withTrue).toContain("Answer ready, 1 point");
  });
});
