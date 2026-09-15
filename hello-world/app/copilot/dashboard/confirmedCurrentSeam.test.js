// @vitest-environment jsdom
//
// B2/BUG-3/R-121, THE SEAM TEST. Before this fix, StickyQuestionStrip.js
// derived "what's current" from `pinnedQuestionEntry(questions, pinnedId)` —
// a THIRD, independent decision alongside CopilotDashboard.js's own
// confirm-gate-driven `current` and QuestionFeed.js's own derivation.
// Measured on one fixture: the strip showed the array's latest DETECTED
// question (QUESTION-TWO-NEVER-CONFIRMED) while the dashboard showed the
// CONFIRMED one — two surfaces naming different questions "current" at
// once, with the strip additionally advancing to an unconfirmed question
// with no click behind it. That is exactly the failure BUG-3/R-121's "one
// decision, one place" standard exists to prevent.
//
// This test computes ONE resolveConfirmedView result — the same function
// useQuestionConfirm.js calls — and feeds it into BOTH components, with a
// `questions` array shaped exactly like the regression: a confirmed entry
// that is NOT the array's last element, and a later, unconfirmed entry
// still waiting. It is the mechanised proof that would have caught the
// defect: run against the pre-B2 strip (deriving via `pinnedId` alone, with
// no prop for the resolved `current`), the first assertion below fails.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import StickyQuestionStrip from "./StickyQuestionStrip.js";
import CopilotDashboard from "./CopilotDashboard.js";
import { resolveConfirmedView } from "@/lib/copilot/questionConfirm";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const q1 = {
  id: 1,
  question: "Tell me about a conflict you resolved.",
  status: "done",
  points: ["Handled it calmly."],
};
const q2 = {
  id: 2,
  question: "QUESTION-TWO-NEVER-CONFIRMED",
  status: "done",
  points: ["Never confirmed."],
};
const questions = [q1, q2];

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
  document.documentElement.style.removeProperty("--sticky-top");
  document.documentElement.style.removeProperty("--sticky-pad");
  document.documentElement.style.scrollPaddingTop = "";
});

async function render(ui) {
  await act(async () => {
    root.render(ui);
  });
}

function text() {
  return container.textContent || "";
}

describe("B2 seam: StickyQuestionStrip and CopilotDashboard name the same question from ONE resolveConfirmedView result", () => {
  it("both surfaces show the CONFIRMED entry, never the array's later, unconfirmed one", async () => {
    // The ONE decision, computed once — exactly as useQuestionConfirm.js does.
    const resolved = resolveConfirmedView({ questions, confirmedIds: [1] });
    expect(resolved.current).toBe(q1);
    expect(resolved.waiting).toEqual([q2]);

    await render(createElement(StickyQuestionStrip, { questions, current: resolved.current, sessionLive: true }));
    expect(text()).toContain(q1.question);
    expect(text()).not.toContain(q2.question);

    await render(
      createElement(CopilotDashboard, {
        questions,
        current: resolved.current,
        currentIsSeed: resolved.currentIsSeed,
        history: resolved.history,
        waiting: resolved.waiting,
      }),
    );
    expect(text()).toContain("Handled it calmly.");
    expect(text()).not.toContain("Never confirmed.");
    // The waiting surface still names the unconfirmed entry by its own text
    // (AC-N18.4/N18.5) — it is not evicted, only not current.
    expect(text()).toContain(q2.question);
  });

  // Control: proves the assertion above is discriminating, not vacuously
  // true of any fixture — with NOTHING confirmed yet (the seed shape), the
  // array's OLDEST entry is current on both surfaces (AC-N18.1, N18 delta
  // review F2 — a fresh session must wait for a confirm before advancing
  // past its first detected question, so this must flip the other way).
  it("[control] with nothing confirmed, the array's OLDEST entry IS current on both surfaces", async () => {
    const resolved = resolveConfirmedView({ questions, confirmedIds: [] });
    expect(resolved.current).toBe(q1);

    await render(createElement(StickyQuestionStrip, { questions, current: resolved.current, sessionLive: true }));
    expect(text()).toContain(q1.question);

    await render(
      createElement(CopilotDashboard, {
        questions,
        current: resolved.current,
        currentIsSeed: resolved.currentIsSeed,
        // N18 delta review F5: `answerHidden` now defaults to `currentIsSeed`
        // (true here, the genuine seed state), which would hide the answer
        // behind a reveal button — the reveal gate is CopilotDashboard.confirm
        // .test.js's own concern ("AC-N18.13/F-F7: the reveal gate on the
        // seed entry"). This test is about which entry `current` resolves
        // to, not the gate, so it opts out of it explicitly to inspect the
        // resolved entry's own content directly.
        answerHidden: false,
      }),
    );
    expect(text()).toContain("Handled it calmly.");
  });
});
