// @vitest-environment jsdom
//
// N145 Wave B, seam 2 (LIVE surface reachability) — the "Try again" retry must
// be reachable through the REAL live current-answer surface, not just on
// AnswerAids in isolation. "The parent forwards it" is not "anyone supplies
// it" (measurement-instruments), so this mounts the real CopilotDashboard and
// drives it exactly as CopilotClient does: a `current` answer entry carrying a
// failed/stale Row-1 example, plus the two presentational retry props. The
// button is found in the rendered DOM and a real click is dispatched.
//
// GROUNDING:
//   - CopilotDashboard.js:928-937 renders CurrentAnswerPanel with the current
//     entry; CurrentAnswerPanel (:465-471) renders <AnswerAids> from
//     current.{buzzwords,anchor,projectExample,projectExampleLive,techTerms}
//     and passes NO retry props today -> the button cannot reach the live
//     surface, which is the RED this file lands.
//   - CopilotClient.js:880-907 is the live call site that must supply
//     onRetryRowOne/rowOneRetrying (its own wiring is pinned by
//     projectExampleRetry.wiring.test.js).
//   - AnswerAids renders only when current.status==="done" && it has lines, so
//     the fixture carries one point.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import CopilotDashboard from "./CopilotDashboard.js";

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

// A done current answer with exactly one renderable line, so CurrentAnswerPanel
// reaches its <AnswerAids> branch. `projectExample` is swapped per test.
const currentWith = (projectExample) => ({
  id: "q1",
  question: "Tell me about a time you handled an incident.",
  status: "done",
  points: ["Led the response and cut recovery time."],
  cues: [],
  pageSources: [],
  buzzwords: [],
  anchor: null,
  projectExample,
  at: 0,
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
    root.render(createElement(CopilotDashboard, props));
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

describe("the live current-answer panel reaches the Try again retry (N145-4)", () => {
  it("[failed] a real click on the panel's Try again fires the handler the client supplied", async () => {
    const onRetryRowOne = vi.fn();
    const { el } = await render({
      questions: [],
      current: currentWith({ status: "failed" }),
      onRetryRowOne,
      rowOneRetrying: false,
    });
    const btn = retryButton(el);
    expect(btn, "Try again reachable in CurrentAnswerPanel").not.toBeNull();
    await click(btn);
    expect(onRetryRowOne).toHaveBeenCalledTimes(1);
  });

  it("[stale] the panel shows the stale example AND a working Try again", async () => {
    const onRetryRowOne = vi.fn();
    const { el, text } = await render({
      questions: [],
      current: currentWith(STALE()),
      onRetryRowOne,
      rowOneRetrying: false,
    });
    expect(text).toContain("Rebuilt the paging rotation"); // stale content served here too
    const btn = retryButton(el);
    expect(btn).not.toBeNull();
    await click(btn);
    expect(onRetryRowOne).toHaveBeenCalledTimes(1);
  });

  // DISCLOSED vacuous on HEAD (no button exists yet): once the feature lands
  // these pin that the live panel does not over-fire the control.
  it("[control] a ready Row 1 shows NO Try again even when a handler is supplied", async () => {
    const { el } = await render({
      questions: [],
      current: currentWith(STALE({ status: "ready" })),
      onRetryRowOne: vi.fn(),
    });
    expect(retryButton(el)).toBeNull();
  });

  it("[control] a failed Row 1 with NO handler supplied shows NO Try again", async () => {
    const { el } = await render({ questions: [], current: currentWith({ status: "failed" }) });
    expect(retryButton(el)).toBeNull();
  });
});
