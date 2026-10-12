// @vitest-environment jsdom
//
// N161 SC-3 / AC-4, AC-9 (practice half), AC-11, D1, AC-10(render). Practice
// mode's answerLines site — SampleAnswer.js:124/222. SampleAnswer is purely
// presentational (every value is a prop), so it is driven here exactly as
// PracticeClient drives it: a new `codingSolution` prop carries the worked
// solution onto the reveal panel. The panel is shown (`visible: true`) the
// same way the user's "Show sample answer" toggle shows it.
//
// RED on HEAD: a done coding record has no points, so the `status === "done"
// && lines.length > 0` gate is false and the panel body renders nothing;
// SampleAnswer also does not read a `codingSolution` prop yet. The non-coding
// tests are regression guards (GREEN on HEAD).

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

const SPOKEN_POINT = "SPOKEN_POINT_SENTINEL — this must never render beside the code.";

function codeEl(rootEl, code) {
  const matches = [...rootEl.querySelectorAll("*")].filter((el) => (el.textContent || "").includes(code));
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) || null;
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

async function render(props) {
  await act(async () => {
    root.render(
      createElement(SampleAnswer, {
        visible: true,
        status: "done",
        points: null,
        cues: [],
        buzzwords: [],
        anchor: null,
        pageSources: [],
        grounding: null,
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

describe("SampleAnswer (site :124) — the practice coding answer", () => {
  it("renders the code in an inline-styled monospace block (AC-4)", async () => {
    await render();
    const code = codeEl(container, CODE);
    expect(code).not.toBeNull();
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
    expect(container.textContent).toContain(SOLUTION.complexity);
  });

  it("REPLACES the spoken answer — no points list beside the code (AC-11)", async () => {
    await render({ points: [SPOKEN_POINT], cues: ["FizzBuzz"] });
    expect(codeEl(container, CODE)).not.toBeNull();
    expect(container.textContent).not.toContain("SPOKEN_POINT_SENTINEL");
  });

  it("suppresses the experience aids and the provenance caption (D1)", async () => {
    await render({
      anchor: { title: "Staff Engineer", company: "Acme", matched: true },
      projectExample: { status: "ready", title: "Payments cutover", bullets: ["Shipped it."] },
      grounding: { resume: true },
    });
    expect(codeEl(container, CODE)).not.toBeNull();
    expect(container.textContent).not.toContain("Staff Engineer");
    expect(container.textContent).not.toMatch(/Example projects/i);
    // The sourceCaption ("Drafted by ... from the resume you submitted") is a
    // provenance claim about a SPOKEN answer; a worked solution is general
    // knowledge, so it must not ride under the code (D1).
    expect(container.textContent).not.toMatch(/Drafted by/i);
  });

  it("still offers Regenerate for a coding answer (arch §4)", async () => {
    // canRegenerate is `visible && done && lines.length > 0` on HEAD, so a
    // coding answer (no lines) loses the Regenerate control. The SC-3 edit
    // must re-admit it. Paired with a code-present check so it is not vacuous.
    await render();
    expect(codeEl(container, CODE)).not.toBeNull();
    expect(regenerateButton()).toBeTruthy();
  });

  it("[regression] a non-coding answer renders points, Regenerate, and no code block", async () => {
    await render({ codingSolution: null, points: ["I would start by clarifying the constraints."], cues: ["Clarify"] });
    expect(container.textContent).toContain("I would start by clarifying");
    expect(regenerateButton()).toBeTruthy();
    expect(codeEl(container, CODE)).toBeNull();
  });
});

describe("Embedded fallback in practice (AC-10 render half)", () => {
  it("renders the honest fallback marker and NO code block", async () => {
    await render({
      isEmbedded: true,
      codingSolution: null,
      codingFallback: "The on-device engine can't write a worked code solution. Switch to the AI engine for a worked solution.",
    });
    expect(container.textContent).toMatch(/AI engine/i);
    expect(codeEl(container, CODE)).toBeNull();
  });
});
