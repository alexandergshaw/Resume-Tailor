// @vitest-environment jsdom
//
// N145 Wave B, seam 3 (PRACTICE surface reachability) — mirror of
// CopilotDashboard.retryRowOne.test.js for the practice current-answer
// surface. Mounts the REAL SampleAnswer (the component QuestionCard renders and
// the surface the design names for practice) and drives it as QuestionCard
// does: a visible, done sample answer carrying a failed/stale Row-1 example
// plus the two retry props. Finds the button in the DOM and clicks it.
//
// GROUNDING:
//   - SampleAnswer.js:242-256 renders <AnswerAids> only in the
//     done && lines.length>0 branch, forwarding projectExample et al. and NO
//     retry props today -> the RED this file lands.
//   - QuestionCard.js:215-234 and PracticeClient.js:750-783 are the practice
//     call sites that must supply the props (pinned by
//     projectExampleRetry.wiring.test.js).
//   - SampleAnswer's own "Retry"/"Regenerate"/"Hide sample answer" controls use
//     different labels, so matching exactly "Try again" never collides.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import SampleAnswer from "./SampleAnswer.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RETRY_LABEL = "Try again";

const STALE = (over = {}) => ({
  status: "stale",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift"],
  hypothetical: true,
  engine: "gemini",
  ...over,
});

// A done, visible sample answer with one renderable line so SampleAnswer
// reaches its <AnswerAids> branch.
const baseProps = (projectExample, extra = {}) => ({
  visible: true,
  status: "done",
  points: ["Led the response and cut recovery time."],
  cues: [],
  buzzwords: [],
  anchor: null,
  pageSources: [],
  projectExample,
  projectExampleLive: undefined,
  techTerms: undefined,
  grounding: { resume: false, coverLetter: false },
  isEmbedded: false,
  onToggle: () => {},
  onRetry: () => {},
  onRegenerate: () => {},
  ...extra,
});

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(createElement(SampleAnswer, props));
  });
  return { text: document.body.textContent || "", el: container };
}

function retryButton(el) {
  const matches = Array.from(el.querySelectorAll("button")).filter(
    (b) => (b.textContent || "").trim() === RETRY_LABEL,
  );
  if (matches.length === 0) return null;
  expect(matches.length).toBe(1);
  return matches[0];
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("the practice sample-answer surface reaches the Try again retry (N145-4)", () => {
  it("[failed] a real click on the card's Try again fires the handler the client supplied", async () => {
    const onRetryRowOne = vi.fn();
    const { el } = await render(baseProps({ status: "failed" }, { onRetryRowOne, rowOneRetrying: false }));
    const btn = retryButton(el);
    expect(btn, "Try again reachable in SampleAnswer").not.toBeNull();
    await click(btn);
    expect(onRetryRowOne).toHaveBeenCalledTimes(1);
  });

  it("[stale] the card shows the stale example AND a working Try again", async () => {
    const onRetryRowOne = vi.fn();
    const { el, text } = await render(baseProps(STALE(), { onRetryRowOne, rowOneRetrying: false }));
    expect(text).toContain("Rebuilt the paging rotation");
    const btn = retryButton(el);
    expect(btn).not.toBeNull();
    await click(btn);
    expect(onRetryRowOne).toHaveBeenCalledTimes(1);
  });

  // DISCLOSED vacuous on HEAD (no button exists yet).
  it("[control] a ready Row 1 shows NO Try again even with a handler supplied", async () => {
    const { el } = await render(baseProps(STALE({ status: "ready" }), { onRetryRowOne: vi.fn() }));
    expect(retryButton(el)).toBeNull();
  });

  it("[control] a failed Row 1 with NO handler supplied shows NO Try again", async () => {
    const { el } = await render(baseProps({ status: "failed" }));
    expect(retryButton(el)).toBeNull();
  });
});
