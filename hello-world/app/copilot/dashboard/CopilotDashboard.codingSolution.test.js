// @vitest-environment jsdom
//
// N162 Wave D (owner reversal of N161, 2026-10-12). The live dashboard's two
// answerLines render sites — CurrentAnswerPanel (CopilotDashboard.js:267/453)
// and HistoryItem (:716/769, a reveal of a PAST live answer, in scope). Driven
// through the REAL default export with the real `current` / `history` props a
// user's session produces, and the history reveal is driven by CLICKING the
// real expander, not by reaching past it — a code block that renders only
// when a handler is called directly would not satisfy "a revealed past coding
// answer shows the code block".
//
// N162 flips N161's REPLACE to ADDITIVE: a coding record now carries real
// `points`, so each site renders the NORMAL answer (AnswerLines + AnswerAids)
// AND appends the CodeSolution after it.
//
// RED on HEAD: HEAD gates `codingSolution` BEFORE the points arm at both
// sites, so a record with BOTH points and codingSolution renders ONLY the code
// and suppresses the spoken answer — the "spoken point / aid on screen"
// assertions RED. The non-coding tests are regression guards (GREEN on HEAD).
//
// Absence assertions are PAIRED with a code-present positive so "the spoken
// points are not duplicated" is never satisfied by a component that renders
// nothing.

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

const SPOKEN_POINT = "SPOKEN_POINT_SENTINEL — I state the hash-map invariant out loud.";
const BUZZWORD = "ZZIdempotencyZZ";

function codingEntry(overrides = {}) {
  return {
    id: "c1",
    question: "Given an array, return the indices of the two numbers that sum to the target.",
    at: Date.now(),
    status: "done",
    codingSolution: SOLUTION,
    // Additive: a coding answer now carries real spoken points (Wave B route).
    points: [SPOKEN_POINT],
    cues: ["The pair"],
    buzzwords: [BUZZWORD],
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

function deepestWith(rootEl, needle) {
  const matches = [...rootEl.querySelectorAll("*")].filter((el) => (el.textContent || "").includes(needle));
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) || null;
}

function codeEl(rootEl, code) {
  return deepestWith(rootEl, code);
}

function countMatches(text, re) {
  return (text.match(re) || []).length;
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

describe("CurrentAnswerPanel (site :267) — the current coding answer is ADDITIVE (AC-N162-12)", () => {
  it("renders the code in an inline-styled monospace block", async () => {
    await render({ current: codingEntry() });
    const code = codeEl(body(), CODE);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
    expect(body().textContent).toContain(SOLUTION.complexity);
  });

  it("renders the NORMAL answer AND the code, with the code AFTER the spoken answer", async () => {
    await render({ current: codingEntry() });
    const spoken = deepestWith(body(), "SPOKEN_POINT_SENTINEL");
    const code = codeEl(body(), CODE);
    expect(spoken, "the spoken answer must still be on screen beside the code").not.toBeNull();
    expect(code).not.toBeNull();
    const following = spoken.compareDocumentPosition(code) & window.Node.DOCUMENT_POSITION_FOLLOWING;
    expect(following, "the code block must render AFTER the normal answer").toBeTruthy();
  });

  it("shows the posting-words aid exactly ONCE (no double aids — AC-N162-14)", async () => {
    await render({ current: codingEntry() });
    expect(deepestWith(body(), "SPOKEN_POINT_SENTINEL")).not.toBeNull();
    expect(codeEl(body(), CODE)).not.toBeNull();
    expect(countMatches(body().textContent || "", /Words from the posting/gi)).toBe(1);
  });

  it("[AC-N162-15] the status region never reads '0 points' for a done coding answer", async () => {
    await render({ current: codingEntry() });
    const region = body().querySelector('[role="status"]');
    expect(region).toBeTruthy();
    expect(region.textContent || "").not.toMatch(/0\s*points?/i);
  });

  it("[gate: OFF/non-coding] a record with points and NO codingSolution renders the answer and no code", async () => {
    await render({ current: normalEntry() });
    expect(body().textContent).toContain("I raised the concern early");
    expect(codeEl(body(), CODE)).toBeNull();
  });

  it("[AC-N162-10 render] embedded fallback is appended beside the normal answer, no code block", async () => {
    await render({
      current: codingEntry({
        codingSolution: null,
        codingFallback:
          "The on-device engine can't write a worked code solution. Switch to the AI engine for a worked solution.",
      }),
    });
    expect(deepestWith(body(), "SPOKEN_POINT_SENTINEL")).not.toBeNull();
    expect(body().textContent).toMatch(/AI engine/i);
    expect(codeEl(body(), CODE)).toBeNull();
  });
});

describe("HistoryItem (site :716) — a revealed PAST coding answer is ADDITIVE (AC-N162-12)", () => {
  function expander() {
    return [...body().querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("two numbers that sum"),
    );
  }

  it("shows no code while collapsed, then the normal answer AND the code once expanded", async () => {
    await render({ current: null, history: [codingEntry()] });
    // Collapsed: HistoryItem renders a header row only. Neither code nor the
    // spoken point is there yet.
    expect(codeEl(body(), CODE)).toBeNull();
    expect(deepestWith(body(), "SPOKEN_POINT_SENTINEL")).toBeNull();

    const btn = expander();
    expect(btn).toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    const spoken = deepestWith(body(), "SPOKEN_POINT_SENTINEL");
    const code = codeEl(body(), CODE);
    expect(spoken, "the revealed past answer must show its spoken points beside the code").not.toBeNull();
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    const following = spoken.compareDocumentPosition(code) & window.Node.DOCUMENT_POSITION_FOLLOWING;
    expect(following, "the code block must render AFTER the normal answer").toBeTruthy();
  });

  it("[regression] a revealed non-coding past answer still shows its points and no code", async () => {
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
