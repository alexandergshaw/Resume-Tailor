// @vitest-environment jsdom
//
// N161 SC-3 / AC-4, AC-9, AC-11, D1, AC-10(render). The live dashboard's two
// answerLines render sites — CurrentAnswerPanel (CopilotDashboard.js:267/444)
// and HistoryItem (:699/747, a reveal of a PAST live answer, in scope per
// AC-9). Driven through the REAL default export with the real `current` /
// `history` props a user's session produces, and the history reveal is driven
// by CLICKING the real expander, not by reaching past it — a code block that
// renders only when a handler is called directly would not satisfy AC-9's
// "a revealed past coding answer shows the code block".
//
// RED on HEAD: there is no CodeSolution path at either site, so a coding
// record falls through to the copy.noPoints branch (lines.length === 0) — the
// code never renders. The non-coding tests are regression guards and pass on
// HEAD.
//
// Absence assertions are PAIRED with a code-present positive in the same
// test, so "the spoken points are not on screen" is never satisfied by a
// component that renders nothing (both the REPLACE and the aid-suppression
// checks ride on top of an assertion that REDs on HEAD).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import CopilotDashboard, { LIVE_COPY } from "./CopilotDashboard.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const CODE = [
  "def two_sum(nums, target):",
  "    seen = {}",
  "    for i, n in enumerate(nums):",
  "        if target - n in seen:  # I check the complement first",
  "            return [seen[target - n], i]",
  "        seen[n] = i",
].join("\n");

const SOLUTION = {
  approach: "One pass with a hash map from value to index.",
  language: "Python",
  code: CODE,
  complexity: "Time O(n), space O(n).",
  edgeCases: ["No pair sums to the target.", "Duplicate values in the array."],
};

const SPOKEN_POINT = "SPOKEN_POINT_SENTINEL — this STAR sentence must never show beside the code.";

function codingEntry(overrides = {}) {
  return {
    id: "c1",
    question: "Given an array, return the indices of the two numbers that sum to the target.",
    at: Date.now(),
    status: "done",
    codingSolution: SOLUTION,
    // A coding response carries NO points (SC-1 contract); these are present
    // ONLY in the REPLACE test, to prove the render gate suppresses them when
    // codingSolution is set rather than stacking both (AC-11).
    points: null,
    cues: [],
    buzzwords: [],
    anchor: null,
    error: "",
    ...overrides,
  };
}

function normalEntry(overrides = {}) {
  return {
    id: "n1",
    question: "Tell me about a time you disagreed with your manager.",
    at: Date.now(),
    status: "done",
    points: ["I raised the concern early and backed it with data."],
    cues: ["The disagreement"],
    buzzwords: [],
    anchor: null,
    error: "",
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    questions: [],
    current: null,
    history: [],
    copy: LIVE_COPY,
    answerHidden: false,
    pace: { measured: false },
    fillers: { measured: false },
    ...overrides,
  };
}

function codeEl(rootEl, code) {
  const matches = [...rootEl.querySelectorAll("*")].filter((el) => (el.textContent || "").includes(code));
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) || null;
}

const MONO_RE = /mono|consolas|menlo|courier|monaco|ui-monospace/i;

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
    root.render(createElement(CopilotDashboard, baseProps(props)));
  });
}

function body() {
  return document.body;
}

describe("CurrentAnswerPanel (site :267) — the current coding answer", () => {
  it("renders the code in an inline-styled monospace block (AC-4)", async () => {
    await render({ current: codingEntry() });
    const code = codeEl(body(), CODE);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
    expect(body().textContent).toContain(SOLUTION.complexity);
  });

  it("REPLACES the spoken answer — no points list beside the code (AC-11)", async () => {
    // The adversarial record carries BOTH a codingSolution AND a spoken
    // point. A correct gate (codingSolution ? <CodeSolution> : lines ...)
    // renders only the code; an augment build renders both and REDs here.
    await render({ current: codingEntry({ points: [SPOKEN_POINT], cues: ["The pair"] }) });
    expect(codeEl(body(), CODE)).not.toBeNull();
    expect(body().textContent).not.toContain("SPOKEN_POINT_SENTINEL");
  });

  it("suppresses the experience aids (D1) while still showing the code", async () => {
    await render({
      current: codingEntry({
        anchor: { title: "Staff Engineer", company: "Acme", matched: true },
        projectExample: { status: "ready", title: "Payments cutover", bullets: ["Shipped it."] },
      }),
    });
    expect(codeEl(body(), CODE)).not.toBeNull();
    expect(body().textContent).not.toContain("Staff Engineer");
    expect(body().textContent).not.toMatch(/Example projects/i);
  });

  it("[regression] a non-coding answer renders its points and no code block", async () => {
    // GREEN on HEAD: proves the coding gate leaves the ordinary arm untouched.
    await render({ current: normalEntry() });
    expect(body().textContent).toContain("I raised the concern early");
    expect(codeEl(body(), CODE)).toBeNull();
  });
});

describe("HistoryItem (site :699) — a revealed PAST coding answer (AC-9)", () => {
  function expander() {
    return [...body().querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("two numbers that sum"),
    );
  }

  it("shows no code while collapsed, then the code block once expanded", async () => {
    await render({ current: null, history: [codingEntry()] });
    // Collapsed: HistoryItem renders a header row only (the cost discipline
    // the component already follows for `lines`). The code must not be there.
    expect(codeEl(body(), CODE)).toBeNull();

    const btn = expander();
    expect(btn).toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    const code = codeEl(body(), CODE);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
  });

  it("[regression] a revealed non-coding past answer still shows its points", async () => {
    await render({ current: null, history: [normalEntry()] });
    const btn = [...body().querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("disagreed with your manager"),
    );
    await act(async () => {
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(body().textContent).toContain("I raised the concern early");
    expect(codeEl(body(), CODE)).toBeNull();
  });
});

describe("Embedded fallback at the dashboard (AC-10 render half)", () => {
  it("renders the honest fallback marker and NO code block", async () => {
    // The embedded engine returns `codingFallback` (a marker string) instead
    // of a codingSolution. The surface must show the marker and never a code
    // block. RED on HEAD for the right reason: the marker text is absent (the
    // no-code half is vacuously true on HEAD and is paired with it).
    await render({
      current: codingEntry({
        codingSolution: null,
        codingFallback: "The on-device engine can't write a worked code solution. Switch to the AI engine for a worked solution.",
      }),
    });
    expect(body().textContent).toMatch(/AI engine/i);
    expect(codeEl(body(), CODE)).toBeNull();
  });
});
