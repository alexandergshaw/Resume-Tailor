// @vitest-environment jsdom
//
// N162 Wave D (owner reversal of N161, 2026-10-12). Practice mode's
// answerLines site — SampleAnswer.js:124/243. SampleAnswer is purely
// presentational (every value is a prop), so it is driven here exactly as
// PracticeClient drives it: the `codingSolution` prop carries the worked
// solution onto the reveal panel, which the user's "Show sample answer"
// toggle shows (`visible: true`).
//
// N162 flips N161's REPLACE to ADDITIVE. A coding answer now carries real
// spoken `points`, so the panel renders the NORMAL answer (AnswerLines + its
// AnswerAids + the "Drafted by" provenance caption) AND appends the
// CodeSolution after it. The provenance caption and aids, which N161
// suppressed on a code-only card (D1), now ride the always-present normal
// answer (AC-N162-14).
//
// RED on HEAD: HEAD gates `status === "done" && codingSolution` BEFORE the
// lines arm, so a record with BOTH points and codingSolution renders ONLY the
// code — the spoken point, the aids and the "Drafted by" caption are all
// suppressed. Those assertions (present) RED on HEAD.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import SampleAnswer from "./SampleAnswer.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const CODE = [
  "def fizzbuzz(n):",
  "    for i in range(1, n + 1):",
  "        if i % 15 == 0:  # I test the combined case first",
  '            print("FizzBuzz")',
  "        elif i % 3 == 0:",
  '            print("Fizz")',
  "        else:",
  "            print(i)",
].join("\n");

const SOLUTION = {
  approach: "Loop 1..n, testing the 15 case before 3 and 5.",
  language: "Python",
  code: CODE,
  complexity: "Time O(n), space O(1).",
  edgeCases: ["n is zero: nothing prints.", "n is negative: nothing prints."],
};

const SPOKEN_POINT = "SPOKEN_POINT_SENTINEL — I name the constraint before I loop.";
const BUZZWORD = "ZZIdempotencyZZ";

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

function regenerateButton() {
  return [...container.querySelectorAll("button")].find((b) => /regenerate/i.test(b.textContent || ""));
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

// A coding draft under the additive model: real points PLUS a codingSolution.
async function render(props) {
  await act(async () => {
    root.render(
      createElement(SampleAnswer, {
        visible: true,
        status: "done",
        points: [SPOKEN_POINT],
        cues: ["FizzBuzz"],
        buzzwords: [BUZZWORD],
        anchor: null,
        pageSources: [],
        grounding: { resume: true },
        error: "",
        isEmbedded: false,
        onToggle: () => {},
        onRetry: () => {},
        onRegenerate: () => {},
        codingSolution: SOLUTION,
        ...props,
      }),
    );
  });
  return container;
}

describe("SampleAnswer (site :124) — the coding answer is ADDITIVE (AC-N162-12)", () => {
  it("renders the code in an inline-styled monospace block", async () => {
    await render();
    const code = codeEl(container, CODE);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
    expect(container.textContent).toContain(SOLUTION.complexity);
  });

  it("renders the NORMAL answer AND the code, with the code AFTER the spoken answer", async () => {
    await render();
    const spoken = deepestWith(container, "SPOKEN_POINT_SENTINEL");
    const code = codeEl(container, CODE);
    expect(spoken, "the spoken answer must still be on screen beside the code").not.toBeNull();
    expect(code).not.toBeNull();
    const following = spoken.compareDocumentPosition(code) & window.Node.DOCUMENT_POSITION_FOLLOWING;
    expect(following, "the code block must render AFTER the normal answer").toBeTruthy();
  });

  it("the provenance caption and posting-words aid ride the normal answer, each exactly once (AC-N162-14)", async () => {
    // D1 is reversed: with the normal answer always present, "Drafted by ..."
    // and the posting-words group belong to it. They must appear (RED on HEAD,
    // which suppressed them on a code-only card) and must NOT be duplicated by
    // the appended CodeSolution.
    await render();
    expect(deepestWith(container, "SPOKEN_POINT_SENTINEL")).not.toBeNull();
    expect(codeEl(container, CODE)).not.toBeNull();
    expect(countMatches(container.textContent || "", /Drafted by/gi)).toBe(1);
    expect(countMatches(container.textContent || "", /Words from the posting/gi)).toBe(1);
  });

  it("still offers Regenerate for a coding answer", async () => {
    await render();
    expect(codeEl(container, CODE)).not.toBeNull();
    expect(regenerateButton()).toBeTruthy();
  });

  it("[gate: OFF/non-coding] a record with points and NO codingSolution renders the answer and no code", async () => {
    await render({
      codingSolution: null,
      points: ["I would start by clarifying the constraints."],
      cues: ["Clarify"],
    });
    expect(container.textContent).toContain("I would start by clarifying");
    expect(regenerateButton()).toBeTruthy();
    expect(codeEl(container, CODE)).toBeNull();
  });
});

describe("Embedded fallback in practice (AC-N162-10 render half)", () => {
  it("appends the honest fallback marker beside the normal answer and renders NO code block", async () => {
    await render({
      isEmbedded: true,
      codingSolution: null,
      codingFallback:
        "The on-device engine can't write a worked code solution. Switch to the AI engine for a worked solution.",
    });
    expect(deepestWith(container, "SPOKEN_POINT_SENTINEL")).not.toBeNull();
    expect(container.textContent).toMatch(/AI engine/i);
    expect(codeEl(container, CODE)).toBeNull();
  });
});
