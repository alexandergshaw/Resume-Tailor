// @vitest-environment jsdom
//
// N161 SC-3 / AC-4, AC-3(render half), D1. The NEW CodeSolution component:
// the whitespace-preserving, INLINE-styled code block that replaces the
// spoken answer for a detected coding question. Rendered with
// react-dom/client (no @testing-library in this repo), the same idiom
// QuestionFeed.test.js / CitationDetail.test.js already establish for a
// full-DOM render under this suite's per-file jsdom opt-in.
//
// RED on HEAD: app/copilot/CodeSolution.js does not exist, so the import
// below fails at collection — INVALID until built, reported as RED, not a
// pass. It becomes reachable the moment the implementer lands the component
// AND imports it at the five render sites (SC-3).
//
// THE INSTRUMENT, and why it is element.style and not getComputedStyle.
// jsdom's cascade does not apply emotion/author (`sx`) classes, so
// getComputedStyle resolves an sx-declared `white-space`/`font-family` to the
// UA default — it is ZERO-POWER for exactly the two declarations AC-4 is
// about (CitationDetail.test.js:266-270 pays for that lesson). Only an INLINE
// `style={{...}}` attribute resolves via `element.style`. So the code block
// MUST carry `style={{ whiteSpace, fontFamily }}` and these tests read
// `codeEl.style.*`. A build that declares them via `sx` instead leaves
// `element.style.whiteSpace === ""` and these tests RED — that is the
// sx-instead-of-inline mutant, watched dead in the TDD notes.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import CodeSolution from "./CodeSolution.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

// Multi-line, indented, with a first-person COMMENT and an imperative line —
// the exact content deriveAnswerFromPoints / answerLines / sanitizeTechTermDetail
// would collapse, join or drop (AC-7). It must reach the DOM byte-for-byte.
const CODE = [
  "def reverse(head):",
  "    prev = None",
  "    while head:",
  "        nxt = head.next",
  "        head.next = prev  # I keep the previous link here",
  "        prev = head",
  "        head = nxt",
  "    return prev",
].join("\n");

const SOLUTION = {
  approach: "Walk the list once, flipping each next pointer to the node before it.",
  language: "Python",
  code: CODE,
  complexity: "Time O(n), space O(1).",
  edgeCases: ["An empty list returns None.", "A single node returns itself."],
};

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
    root.render(createElement(CodeSolution, { solution: SOLUTION, buzzwords: [], ...props }));
  });
  return container;
}

// The code element: the DEEPEST element whose text contains the whole code
// string (the one that contains no other matching element). For a correct
// `<Box component="pre">{code}</Box>` that is the <pre> itself.
function codeEl(rootEl, code) {
  const matches = [...rootEl.querySelectorAll("*")].filter((el) => (el.textContent || "").includes(code));
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) || null;
}

const MONO_RE = /mono|consolas|menlo|courier|monaco|ui-monospace/i;

describe("CodeSolution — the four worked-solution parts render (AC-3 render half)", () => {
  it("shows approach, the code, complexity and every edge case", async () => {
    const el = await render();
    const text = el.textContent || "";
    expect(text).toContain(SOLUTION.approach);
    expect(text).toContain("def reverse(head):");
    expect(text).toContain(SOLUTION.complexity);
    for (const edge of SOLUTION.edgeCases) expect(text).toContain(edge);
  });
});

describe("CodeSolution — the code renders in an INLINE-styled monospace block (AC-4)", () => {
  it("carries whiteSpace pre/pre-wrap AND a monospace fontFamily as an inline style attribute", async () => {
    const el = await render();
    const code = codeEl(el, CODE);
    expect(code).not.toBeNull();
    // Read via element.style — the ONLY thing that resolves in jsdom. An
    // sx-declared value leaves these empty strings (the mutant REDs here).
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
  });

  it("preserves newlines and indentation in the DOM text (AC-4 / AC-7)", async () => {
    // CSS white-space is a VISUAL effect jsdom cannot measure; what this pins
    // is that the code reached the DOM UNSPLIT — a route through
    // deriveAnswerFromPoints (joins lines with a single space) or answerLines
    // would have destroyed the newline+indent this asserts.
    const el = await render();
    const code = codeEl(el, CODE);
    expect(code.textContent).toContain("def reverse(head):\n    prev = None");
    expect(code.textContent).toContain("# I keep the previous link here");
    expect(code.textContent).toContain("    return prev");
  });

  it("[control] the inline-style read is not trivially true for any element", async () => {
    // Distinguishes a real inline declaration on the code element from an
    // instrument that would read truthy on anything. A bare element the test
    // creates has no such style — so a passing AC-4 test above is measuring
    // the code block's own declaration, not an artefact of element.style.
    await render();
    const plain = document.createElement("p");
    plain.textContent = CODE;
    document.body.appendChild(plain);
    expect(plain.style.whiteSpace).toBe("");
    expect(plain.style.fontFamily).toBe("");
    plain.remove();
  });
});

describe("CodeSolution — buzzwords may remain, experience aids may not (D1)", () => {
  it("renders the posting-words aid when buzzwords are supplied", async () => {
    // D1 lets a coding card keep the posting's vocabulary (not a provenance
    // claim). The arch's recommended default reuses <AnswerAids buzzwords/>,
    // whose always-mounted disclosure header names the group regardless of
    // the collapse state (robust against jsdom's matchMedia). Pins the
    // recommended default; a chip-row alternative is a reconcilable choice.
    const el = await render({ buzzwords: ["Kafka", "idempotency"] });
    expect(el.textContent || "").toMatch(/Words from the posting/i);
  });

  it("[control] renders NO posting-words aid when buzzwords are empty", async () => {
    // Without this, the test above would pass for a component that always
    // shows the header regardless of input.
    const el = await render({ buzzwords: [] });
    expect(el.textContent || "").not.toMatch(/Words from the posting/i);
  });

  it("does not accept or render a résumé anchor or example project", async () => {
    // D1 structural: CodeSolution's props are { solution, buzzwords } only —
    // there is nowhere for an experience aid to enter. Passing them anyway
    // must render nothing of them (the suppression is enforced at the render
    // SITES too; see the per-site files).
    const el = await render({ buzzwords: [], anchor: { title: "Staff Engineer", company: "Acme" }, projectExample: { status: "ready", title: "Payments cutover", bullets: ["Did a thing."] } });
    const text = el.textContent || "";
    expect(text).not.toContain("Staff Engineer");
    expect(text).not.toContain("Payments cutover");
    expect(text).not.toMatch(/Example projects/i);
  });
});
