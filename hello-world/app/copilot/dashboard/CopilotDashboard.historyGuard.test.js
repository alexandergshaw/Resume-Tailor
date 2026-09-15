// @vitest-environment jsdom
//
// M5/AC-N18.7. The shipped behaviour is already correct — a collapsed
// history item renders no answer content and calls answerLines() for
// nothing but the current panel — but nothing in the suite enforced it BY
// CONSTRUCTION: two mutants survive the full suite today —
//   1. dropping HistoryItem's `expanded ?` guard (`answerLines(...)` called
//      unconditionally instead of only when expanded);
//   2. `{true ? (<Box…>` in place of `{expanded ? (<Box…>` in HistoryItem's
//      render, which mounts the expanded content regardless of state.
// Mutant 1 is invisible to an assertion that merely checks specific point
// TEXT is absent from a single collapsed item, because that also passes if
// the component never rendered points at all for an unrelated reason —
// caught here by asserting the CALL COUNT directly.
//
// N18 delta review F4: mutant 2 needs a DIFFERENT catch, and an earlier
// version of this file claimed (in this very comment) to assert "the DOM
// SUBTREE'S absence for every collapsed item at once" while its actual
// assertions only checked for specific POINT TEXT. Mutant 2 does not affect
// `lines` itself (still correctly gated at its own `expanded ?` guard,
// HistoryItem's line above the JSX) — it always mounts the content Box
// regardless of `expanded`, which renders `copy.noPoints`'s fallback
// sentence, not the point text, so a check for point text absence never
// sees it. Every collapsed item would gain a permanent "No talking points
// have been drafted for this question yet." block. Caught here by asserting
// the actual DOM subtree: a collapsed header's own container has no sibling
// content element at all — not merely that a specific string is missing
// from the page as a whole.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerPoints", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, answerLines: vi.fn(actual.answerLines) };
});

import { answerLines } from "@/lib/copilot/answerPoints";
import CopilotDashboard, { LIVE_COPY } from "./CopilotDashboard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function entry(id, question, points) {
  return {
    id,
    question,
    at: Date.now(),
    status: "done",
    points,
    cues: [],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    pageSources: [],
    error: "",
  };
}

let container;
let root;

beforeEach(() => {
  vi.mocked(answerLines).mockClear();
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

function text() {
  return container.textContent || "";
}

describe("M5/AC-N18.7: HistoryItem's answerLines call and render are gated BY CONSTRUCTION", () => {
  it("calls answerLines exactly once — for the current panel only — with three collapsed history items", async () => {
    const h1 = entry(1, "History question one", ["H1 distinctive point"]);
    const h2 = entry(2, "History question two", ["H2 distinctive point"]);
    const h3 = entry(3, "History question three", ["H3 distinctive point"]);
    const current = entry(4, "Current question", ["Current distinctive point"]);

    await render({
      questions: [h1, h2, h3, current],
      current,
      currentIsSeed: false,
      history: [h3, h2, h1],
      pace: { measured: false },
      fillers: { measured: false },
    });

    // Mutant 1 (dropping the `expanded ?` guard): would call answerLines
    // once per history item PLUS once for the current panel — 4 calls, not 1.
    expect(answerLines).toHaveBeenCalledTimes(1);
    expect(answerLines).toHaveBeenCalledWith(current.cues, current.points, current.pageSources);

    // Mutant 2 (`{true ? (<Box…>` in HistoryItem): mounts the content Box —
    // and therefore copy.noPoints's fallback sentence, since `lines` itself
    // stays correctly empty while collapsed — regardless of `expanded`. A
    // check for POINT TEXT never sees that fallback sentence at all, so this
    // asserts the actual DOM SUBTREE instead: every collapsed header's own
    // container holds nothing but the header button itself.
    const collapsedHeaders = [...container.querySelectorAll('button[aria-expanded="false"]')];
    expect(collapsedHeaders).toHaveLength(3);
    for (const header of collapsedHeaders) {
      expect(header.parentElement.children).toHaveLength(1);
    }
    // Restated as the user-facing symptom the subtree check above rules
    // out: the fallback sentence a mounted-but-empty content Box would show.
    expect(text()).not.toContain(LIVE_COPY.noPoints);
    expect(text()).not.toContain("H1 distinctive point");
    expect(text()).not.toContain("H2 distinctive point");
    expect(text()).not.toContain("H3 distinctive point");
    // The current panel's own content is unaffected by either mutation.
    expect(text()).toContain("Current distinctive point");
  });

  // Control: proves the call-count assertion is discriminating — expanding
  // ONE history item must raise the count by exactly one, not to some
  // constant, and must reveal ONLY that item's content.
  it("[control] expanding one history item calls answerLines a second time and reveals only its own content", async () => {
    const h1 = entry(1, "History question one", ["H1 distinctive point"]);
    const h2 = entry(2, "History question two", ["H2 distinctive point"]);
    const current = entry(3, "Current question", ["Current distinctive point"]);

    await render({
      questions: [h1, h2, current],
      current,
      currentIsSeed: false,
      history: [h2, h1],
      pace: { measured: false },
      fillers: { measured: false },
    });
    expect(answerLines).toHaveBeenCalledTimes(1);

    const header = [...container.querySelectorAll("button")].find((b) =>
      /history question one/i.test(b.textContent),
    );
    await act(async () => {
      header.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(answerLines).toHaveBeenCalledTimes(2);
    expect(text()).toContain("H1 distinctive point");
    expect(text()).not.toContain("H2 distinctive point");
  });
});
