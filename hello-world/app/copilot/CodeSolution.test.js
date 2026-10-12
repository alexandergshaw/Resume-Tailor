// @vitest-environment jsdom
//
// N162 Wave D (owner reversal of N161, 2026-10-12). The CodeSolution
// component is now an ADDITIVE, pure code-block presenter: it renders a
// detected coding question's worked solution AFTER the normal answer, never
// in place of it. Rendered with react-dom/client (no @testing-library in this
// repo), the same idiom QuestionFeed.test.js / CitationDetail.test.js already
// establish for a full-DOM render under this suite's per-file jsdom opt-in.
//
// WHAT N162 CHANGES in this component (arch §7.2, AC-N162-14): because the
// normal answer is now ALWAYS present, its own <AnswerAids> already renders
// the posting-words ("Words from the posting to work in") group once. A
// CodeSolution appended after it that ALSO rendered <AnswerAids buzzwords>
// would show that group TWICE. So CodeSolution drops its trailing
// <AnswerAids> and its `buzzwords` prop; it is now a pure code-block
// presenter taking `{ solution }` only. The inline-style <pre> (AC-N162-13)
// is UNCHANGED and is guarded below.
//
// RED reasons on HEAD:
//   - "does NOT render a posting-words aid even when buzzwords are passed":
//     HEAD's CodeSolution renders <AnswerAids buzzwords>, so the header "Words
//     from the posting to work in" IS present with buzzwords supplied — the
//     assertion that it is absent REDs on HEAD. This is the no-double-aids
//     driver (AC-N162-14).
// GREEN guards on HEAD (non-regression):
//   - the four worked-solution parts still render.
//   - the inline-style <pre> carries whiteSpace + monospace fontFamily on its
//     own style attribute, verbatim code (AC-N162-13). jsdom resolves only an
//     element's own style attribute, so this is the only assertion that can
//     pin it (CitationDetail.test.js:266-270 documents the trap).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import CodeSolution from "./CodeSolution.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

// Multi-line, indented, with a first-person COMMENT and an imperative line —
// the exact content deriveAnswerFromPoints / answerLines / sanitizeTechTermDetail
// would collapse, join or drop. It must reach the DOM byte-for-byte.
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
    root.render(createElement(CodeSolution, { solution: SOLUTION, ...props }));
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

describe("CodeSolution — the four worked-solution parts render (AC-N162-13 guard)", () => {
  it("shows approach, the code, complexity and every edge case", async () => {
    const el = await render();
    const text = el.textContent || "";
    expect(text).toContain(SOLUTION.approach);
    expect(text).toContain("def reverse(head):");
    expect(text).toContain(SOLUTION.complexity);
    for (const edge of SOLUTION.edgeCases) expect(text).toContain(edge);
  });
});

describe("CodeSolution — the code renders in an INLINE-styled monospace block (AC-N162-13 guard)", () => {
  it("carries whiteSpace pre/pre-wrap AND a monospace fontFamily as an inline style attribute", async () => {
    const el = await render();
    const code = codeEl(el, CODE);
    expect(code).not.toBeNull();
    // Read via element.style — the ONLY thing that resolves in jsdom. An
    // sx-declared value leaves these empty strings (the sx-instead-of-inline
    // mutant REDs here).
    expect(["pre", "pre-wrap"]).toContain(code.style.whiteSpace);
    expect(code.style.fontFamily).toMatch(MONO_RE);
  });

  it("preserves newlines and indentation in the DOM text (AC-N162-13)", async () => {
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
    // creates has no such style — so a passing inline-style test above is
    // measuring the code block's own declaration, not an artefact of
    // element.style.
    await render();
    const plain = document.createElement("p");
    plain.textContent = CODE;
    document.body.appendChild(plain);
    expect(plain.style.whiteSpace).toBe("");
    expect(plain.style.fontFamily).toBe("");
    plain.remove();
  });
});

describe("CodeSolution is a PURE code-block presenter — no aids of its own (AC-N162-14)", () => {
  it("does NOT render the posting-words aid, even when buzzwords are passed", async () => {
    // N162 REVERSAL of N161. The normal answer is now always present and its
    // own <AnswerAids> renders the posting-words group once; a CodeSolution
    // appended below it must NOT render that group a second time. So
    // CodeSolution renders no <AnswerAids> at all — passing a legacy
    // `buzzwords` prop renders nothing of it.
    //
    // RED on HEAD: HEAD's CodeSolution renders <AnswerAids buzzwords>, so the
    // "Words from the posting to work in" header IS on screen with buzzwords
    // supplied. Paired with a code-present positive so "the header is absent"
    // is never satisfied by a component that renders nothing.
    const el = await render({ buzzwords: ["Kafka", "idempotency"] });
    expect(codeEl(el, CODE)).not.toBeNull();
    expect(el.textContent || "").not.toMatch(/Words from the posting/i);
  });

  it("does not accept or render a résumé anchor or example project", async () => {
    // D1 structural, carried forward: CodeSolution's only prop is `solution`.
    // Passing experience aids anyway must render nothing of them (the
    // suppression is also enforced at the render SITES — see the per-site
    // files, where these aids ride the NORMAL answer exactly once).
    const el = await render({
      anchor: { title: "Staff Engineer", company: "Acme" },
      projectExample: { status: "ready", title: "Payments cutover", bullets: ["Did a thing."] },
    });
    const text = el.textContent || "";
    expect(text).not.toContain("Staff Engineer");
    expect(text).not.toContain("Payments cutover");
    expect(text).not.toMatch(/Example projects/i);
  });
});
