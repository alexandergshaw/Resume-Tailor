// @vitest-environment jsdom
//
// N161 SC-3 / AC-4, AC-9, AC-11, D1, plus the answerStatus readiness wrinkle.
// QuestionFeed's two answerLines sites: the per-card answer
// (QuestionFeed.js:144/205, QuestionCard) and the feed-level aria-live status
// region derived from `latestLines` (:85). Driven through the real default
// export with the `questions` array a live session produces.
//
// RED on HEAD: a done coding question has no points, so QuestionCard's
// `done && lines.length` gate is false and nothing renders; the status region
// reads "Answer ready, 0 points" (misleading for a coding answer). The
// implementer adds the CodeSolution branch (SC-3 render) and makes
// answerStatusMessage coding-aware (SC-3 answerStatus edit).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import QuestionFeed from "./QuestionFeed.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const CODE = [
  "function isPalindrome(s) {",
  "  let i = 0, j = s.length - 1;",
  "  while (i < j) {",
  "    if (s[i] !== s[j]) return false;  // I compare from both ends",
  "    i++; j--;",
  "  }",
  "  return true;",
  "}",
].join("\n");

const SOLUTION = {
  approach: "Two pointers from each end, comparing inward.",
  language: "JavaScript",
  code: CODE,
  complexity: "Time O(n), space O(1).",
  edgeCases: ["Empty string is a palindrome.", "Single character is a palindrome."],
};

const SPOKEN_POINT = "SPOKEN_POINT_SENTINEL — this must never render beside the code.";

function codingQuestion(overrides = {}) {
  return {
    id: "c1",
    question: "Write a function that checks whether a string is a palindrome.",
    at: Date.now(),
    status: "done",
    codingSolution: SOLUTION,
    points: null,
    cues: [],
    buzzwords: [],
    anchor: null,
    type: "technical",
    error: "",
    provisional: false,
    ...overrides,
  };
}

function normalQuestion(overrides = {}) {
  return {
    id: "n1",
    question: "Describe a conflict with a coworker.",
    at: Date.now(),
    status: "done",
    points: ["I listened first, then proposed a concrete next step."],
    cues: ["The conflict"],
    buzzwords: [],
    anchor: null,
    type: "behavioral",
    error: "",
    provisional: false,
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
    root.render(createElement(QuestionFeed, { questions: [], onDraft: () => {}, ...props }));
  });
}

function statusRegionText() {
  const region = document.body.querySelector('[role="status"]');
  return region ? region.textContent || "" : "";
}

describe("QuestionCard (site :144) — the per-card coding answer", () => {
  it("renders the code in an inline-styled monospace block (AC-4)", async () => {
    await render({ questions: [codingQuestion()] });
    const code = codeEl(container, CODE);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
    expect(container.textContent).toContain(SOLUTION.complexity);
  });

  it("REPLACES the spoken answer — no points list beside the code (AC-11)", async () => {
    await render({ questions: [codingQuestion({ points: [SPOKEN_POINT], cues: ["The check"] })] });
    expect(codeEl(container, CODE)).not.toBeNull();
    expect(container.textContent).not.toContain("SPOKEN_POINT_SENTINEL");
  });

  it("suppresses the experience aids (D1) while still showing the code", async () => {
    await render({
      questions: [
        codingQuestion({
          anchor: { title: "Staff Engineer", company: "Acme", matched: true },
          projectExample: { status: "ready", title: "Payments cutover", bullets: ["Shipped it."] },
        }),
      ],
    });
    expect(codeEl(container, CODE)).not.toBeNull();
    expect(container.textContent).not.toContain("Staff Engineer");
    expect(container.textContent).not.toMatch(/Example projects/i);
  });

  it("[regression] a non-coding card renders its points and no code block", async () => {
    await render({ questions: [normalQuestion()] });
    expect(container.textContent).toContain("I listened first");
    expect(codeEl(container, CODE)).toBeNull();
  });
});

describe("feed status region (site :85) — readiness for a coding answer", () => {
  it("announces readiness, not '0 points', for a done coding answer", async () => {
    // A coding answer has no spoken points, so bulletCount is 0 and HEAD's
    // answerStatusMessage says "Answer ready, 0 points" — misleading. The
    // SC-3 answerStatus edit must make this coding-aware. jsdom-decidable
    // (pure string in the live region); the exact wording is an OWNER a11y
    // sub-decision, so this pins only: no "0 point(s)", and some readiness.
    await render({ questions: [codingQuestion()] });
    const text = statusRegionText();
    expect(text).not.toMatch(/0\s*points?/i);
    expect(text).toMatch(/ready|solution/i);
  });

  it("[regression] a non-coding done answer still announces its point count", async () => {
    // GREEN on HEAD: "Answer ready, 1 point" must survive the coding-aware edit.
    await render({ questions: [normalQuestion()] });
    expect(statusRegionText()).toMatch(/Answer ready, 1 point/);
  });
});
