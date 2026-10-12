// @vitest-environment jsdom
//
// N162 Wave D (owner reversal of N161, 2026-10-12). QuestionFeed's two
// answerLines sites: the per-card answer (QuestionCard, QuestionFeed.js:144)
// and the feed-level aria-live status region derived from `latestLines`
// (:85). Driven through the real default export with the `questions` array a
// live session produces.
//
// N162 flips N161's REPLACE to ADDITIVE: the normal answer is ALWAYS rendered
// whenever the record has spoken lines, and a detected coding question's
// CodeSolution is APPENDED after it (after the normal answer's own
// <AnswerAids>), never in place of it. A coding record now carries real
// `points` (the route always produces the normal answer — Wave B), so the
// card shows the spoken answer AND the code.
//
// RED on HEAD: HEAD gates `done && q.codingSolution` BEFORE the points arm, so
// a record carrying BOTH points and codingSolution renders ONLY the code and
// suppresses the spoken points — the "spoken point is on screen" assertion
// REDs. The no-double-aids assertion REDs for the complementary reason (HEAD
// shows no normal-answer AnswerAids at all on a coding card, so once additive
// lands, a build that keeps CodeSolution's own trailing <AnswerAids> would
// show the posting-words group twice).
//
// GUARDS (GREEN on HEAD): a non-coding card renders its points and no code;
// the feed status region never reads "0 points" for a done answer.

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

// The spoken point a coding answer now ALSO carries (additive). A distinctive
// substring so "it is on screen" is unambiguous.
const SPOKEN_POINT = "SPOKEN_POINT_SENTINEL — I state the invariant before I write the loop.";
// A buzzword that appears nowhere else, so counting its group header is a
// clean no-double-aids signal.
const BUZZWORD = "ZZIdempotencyZZ";

function codingQuestion(overrides = {}) {
  return {
    id: "c1",
    question: "Write a function that checks whether a string is a palindrome.",
    at: Date.now(),
    status: "done",
    codingSolution: SOLUTION,
    // Additive: a coding answer now carries real spoken points (Wave B route).
    points: [SPOKEN_POINT],
    cues: ["The check"],
    buzzwords: [BUZZWORD],
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
    root.render(createElement(QuestionFeed, { questions: [], onDraft: () => {}, ...props }));
  });
}

function statusRegionText() {
  const region = document.body.querySelector('[role="status"]');
  return region ? region.textContent || "" : "";
}

describe("QuestionCard (site :144) — the coding answer is ADDITIVE (AC-N162-12)", () => {
  it("renders the code in an inline-styled monospace block", async () => {
    await render({ questions: [codingQuestion()] });
    const code = codeEl(container, CODE);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
    expect(container.textContent).toContain(SOLUTION.complexity);
  });

  it("renders the NORMAL answer AND the code, with the code AFTER the spoken answer", async () => {
    // The additive + ordering pin, and the REPLACE-restoring mutant control:
    // a record with BOTH points and codingSolution must show both, code last.
    // A build that still gates codingSolution BEFORE points suppresses the
    // spoken point and REDs on the first assertion.
    await render({ questions: [codingQuestion()] });
    const spoken = deepestWith(container, "SPOKEN_POINT_SENTINEL");
    const code = codeEl(container, CODE);
    expect(spoken, "the spoken answer must still be on screen beside the code").not.toBeNull();
    expect(code).not.toBeNull();
    // Document order: the code follows the spoken answer.
    const following = spoken.compareDocumentPosition(code) & window.Node.DOCUMENT_POSITION_FOLLOWING;
    expect(following, "the code block must render AFTER the normal answer").toBeTruthy();
  });

  it("shows the posting-words aid exactly ONCE (no double aids — AC-N162-14)", async () => {
    // The normal answer's own <AnswerAids> renders the "Words from the posting
    // to work in" group; the appended CodeSolution must not render it again. A
    // build that keeps CodeSolution's trailing <AnswerAids buzzwords> shows the
    // group twice and REDs here. Paired with both sentinels so it is never
    // vacuous.
    await render({ questions: [codingQuestion()] });
    expect(deepestWith(container, "SPOKEN_POINT_SENTINEL")).not.toBeNull();
    expect(codeEl(container, CODE)).not.toBeNull();
    expect(countMatches(container.textContent || "", /Words from the posting/gi)).toBe(1);
  });

  it("[gate: OFF/non-coding] a record with points and NO codingSolution renders the answer and no code", async () => {
    // The OFF (toggle off) and non-coding cases both reach render as a record
    // with no codingSolution/codingFallback — byte-identical to a plain
    // answer. GREEN on HEAD (non-regression).
    await render({ questions: [normalQuestion()] });
    expect(container.textContent).toContain("I listened first");
    expect(codeEl(container, CODE)).toBeNull();
  });

  it("[AC-N162-10 render] embedded fallback is appended beside the normal answer, no code block", async () => {
    await render({
      questions: [
        codingQuestion({
          codingSolution: null,
          codingFallback:
            "The on-device engine can't write a worked code solution. Switch to the AI engine for a worked solution.",
        }),
      ],
    });
    expect(deepestWith(container, "SPOKEN_POINT_SENTINEL")).not.toBeNull();
    expect(container.textContent).toMatch(/AI engine/i);
    expect(codeEl(container, CODE)).toBeNull();
  });
});

describe("feed status region (site :85) — readiness under the additive model", () => {
  it("announces the point count, not '0 points', for a done coding answer (AC-N162-15)", async () => {
    // A coding answer now carries points, so the normal "Answer ready, N
    // points" is correct and true — there is no special coding readiness
    // message to replace it. Pins only: no "0 point(s)", and some readiness.
    // GREEN-ish guard: re-stated from N161's "Code solution ready".
    await render({ questions: [codingQuestion()] });
    const text = statusRegionText();
    expect(text).not.toMatch(/0\s*points?/i);
    expect(text).toMatch(/ready/i);
  });

  it("[regression] a non-coding done answer still announces its point count", async () => {
    await render({ questions: [normalQuestion()] });
    expect(statusRegionText()).toMatch(/Answer ready, 1 point/);
  });
});
