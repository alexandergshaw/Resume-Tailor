// @vitest-environment jsdom
//
// AC-M22 -- THE COMPOSITION TEST, AND IT IS A NEW FILE FOR A STRUCTURAL REASON.
//
// AnswerLines.emphasis.test.js:56-59 mounts NO provider, and AC-M2 routes the
// glossary through CONTEXT precisely so that QuestionFeed.js, practice's
// SampleAnswer.js and dashboard's CopilotDashboard.js need no edit at all. You
// therefore cannot populate the context for a component rendered without its
// provider without editing that file -- so that file stays byte-unmodified and
// keeps exercising the EMPTY-index path (which is AC-M20's job), and this file
// re-asserts every invariant it pins against the MARKED rendering.
//
// THE SEVEN PINNED INVARIANTS, restated here so a reader can check the mapping
// against AnswerLines.emphasis.test.js without opening it:
//
//   1. the emphasised line renders the sentence ONCE -- `label: point`, no cue,
//      no em dash, the cue's words appearing exactly one time
//   2. an UNLABELLED emphasised line is the bare sentence
//   3. exactly ONE <strong>, over the TIGHT span, in the POINT's own case
//   4. one <strong> per emphasised <li>, across a multi-line answer
//   5. the STAR label is OUTSIDE the <strong>
//   6. the label is its own element and computes font-weight 600
//   7. the two non-emphasis branches (bare, and paraphrased cue) are unchanged,
//      the page citation still renders, and a malformed span degrades
//
// AND THE ONE THIS FILE ADDS: `li.textContent` is byte-identical with and
// without marks, in all three branches (AC-M21). That is what makes an upgrade
// landing mid-answer harmless -- a candidate reading the bullet aloud reads
// exactly what they would have read.
//
// NOT ASSERTED HERE -- jsdom has no layout engine. Where the popover is
// positioned, whether it is clipped by the answer pane, and whether a dotted
// underline is visually distinguishable from a link are browser checks, and
// they are written down as such in docs/REGRESSION.md rather than faked.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import AnswerLines from "./AnswerLines.js";
import { GlossaryScope } from "./GlossaryProvider.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const stray of document.querySelectorAll("[data-glossary]")) stray.remove();
});

// AnswerLines.emphasis.test.js's own fixture, byte for byte.
const POINT = "I built and scaled a payments platform.";
const SPAN = { start: POINT.indexOf("built"), end: POINT.indexOf("platform") + "platform".length };

const emphasised = (over) => ({
  label: "",
  cue: "",
  point: POINT,
  pageSource: null,
  emphasis: SPAN,
  ...over,
});

const term = (name, over = {}) => ({
  term: name,
  kind: "explicit",
  category: "tech",
  evidence: `The posting asks for ${name}.`,
  definition: `${name} is the thing this posting expects you to be able to explain without hedging.`,
  provenance: "recalled",
  ...over,
});

const SOURCED = term("payments platform", {
  provenance: "researched",
  source_url: "https://www.postgresql.org/docs/current/tutorial.html",
  source_host: "postgresql.org",
  source_title: "PostgreSQL Tutorial",
});

// "payments platform" occupies [21, 38) of POINT and SPAN is [2, 38), so the
// mark sits ENTIRELY INSIDE the emphasis. That is deliberate: it is the
// hardest case for "the <strong> does not move".
const VOCAB = [SOURCED];

function render(lines, terms = VOCAB) {
  act(() =>
    root.render(
      terms === null
        ? createElement(AnswerLines, { lines })
        : createElement(GlossaryScope, { terms }, createElement(AnswerLines, { lines })),
    ),
  );
  return [...container.querySelectorAll("li")];
}

const marks = (li) => [...li.querySelectorAll("[data-glossary='term']")];

// ---------------------------------------------------------------------------
// The seven pinned invariants, re-asserted against the MARKED rendering
// ---------------------------------------------------------------------------
describe("AC-M22 -- every invariant AnswerLines.emphasis.test.js pins still holds WITH marks", () => {
  it("1. renders exactly `label: point`, once, with no em dash", () => {
    const [li] = render([emphasised({ label: "Action" })]);
    expect(marks(li)).toHaveLength(1); // not vacuous: the glossary really is on
    expect(li.textContent).toBe(`Action: ${POINT}`);
    expect(li.textContent).not.toMatch(/ — /);
    expect(li.textContent.match(/built and scaled/gi)).toHaveLength(1);
  });

  it("2. an UNLABELLED emphasised line is the bare sentence", () => {
    const [li] = render([emphasised()]);
    expect(marks(li)).toHaveLength(1);
    expect(li.textContent).toBe(POINT);
  });

  it("3. bolds exactly the TIGHT span, using the POINT's own characters", () => {
    const [li] = render([emphasised({ label: "Action" })]);
    const strongs = li.querySelectorAll("strong");
    expect(strongs).toHaveLength(1);
    // The mark is INSIDE this run. If the marker had split the string around
    // the emphasis boundary, or re-cased or re-spaced anything, this is the
    // assertion that would move.
    expect(strongs[0].textContent).toBe("built and scaled a payments platform");
    expect(strongs[0].querySelectorAll("[data-glossary='term']")).toHaveLength(1);
  });

  it("4. exactly ONE <strong> per emphasised <li>", () => {
    const lis = render([
      emphasised({ label: "Situation" }),
      emphasised({ label: "Action" }),
      emphasised({ label: "Result" }),
    ]);
    for (const li of lis) {
      expect(li.querySelectorAll("strong")).toHaveLength(1);
      expect(marks(li)).toHaveLength(1);
    }
  });

  it("5. the STAR label is OUTSIDE the <strong>", () => {
    const [li] = render([emphasised({ label: "Action" })]);
    const strong = li.querySelector("strong");
    expect(strong.textContent).not.toMatch(/Action/);
    expect(strong.textContent.includes(":")).toBe(false);
    expect(li.innerHTML).not.toMatch(/<strong>[^<]*Result:/);
  });

  it("6. the label is its own element carrying font-weight 600", () => {
    const [li] = render([emphasised({ label: "Action" })]);
    const labelNodes = [...li.querySelectorAll("*")].filter(
      (el) => el.tagName !== "STRONG" && /^Action/.test(el.textContent.trim()) && !el.querySelector("strong"),
    );
    expect(labelNodes.length).toBeGreaterThan(0);
    expect(labelNodes.map((el) => getComputedStyle(el).fontWeight)).toContain("600");
  });

  it("7. the two non-emphasis branches, the citation and a malformed span all survive", () => {
    const [bare] = render([
      { label: "Task", cue: "", point: "State the payments platform goal you owned.", pageSource: null, emphasis: null },
    ]);
    expect(marks(bare)).toHaveLength(1);
    expect(bare.textContent).toBe("Task: State the payments platform goal you owned.");
    expect(bare.querySelectorAll("strong")).toHaveLength(0);

    const [cued] = render([
      {
        label: "Action",
        cue: "Ledger overhaul",
        point: "I rebuilt the payments platform ledger.",
        pageSource: null,
        emphasis: null,
      },
    ]);
    expect(cued.textContent).toBe("Action: Ledger overhaul — I rebuilt the payments platform ledger.");
    const cuedStrongs = cued.querySelectorAll("strong");
    expect(cuedStrongs).toHaveLength(1);
    expect(cuedStrongs[0].textContent).toBe("Action: Ledger overhaul");
    // The cue is NOT part of `line.point`, so nothing in the cue's <strong>
    // may ever be marked -- the marks belong to the point and to nothing else.
    expect(cuedStrongs[0].querySelectorAll("[data-glossary]")).toHaveLength(0);
    expect(marks(cued)).toHaveLength(1);

    const [cited] = render([emphasised({ pageSource: { id: "pg-1", title: "Ledger Rebuild" } })]);
    expect(cited.textContent).toContain("From your Ledger Rebuild page.");
    expect(cited.querySelectorAll("strong")).toHaveLength(1);

    for (const bad of [{ start: -1, end: 5 }, { start: 5, end: 4 }, { start: 0, end: 9999 }]) {
      const [li] = render([emphasised({ emphasis: bad })]);
      expect(li.textContent).toBe(POINT);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-M21 / AC-T7 / AC-M20 -- the text does not move, and neither does the DOM
// when the glossary is empty
// ---------------------------------------------------------------------------
describe("AC-M21 -- li.textContent is byte-identical with and without marks", () => {
  const LINES = [
    emphasised({ label: "Situation" }),
    { label: "Action", cue: "Ledger overhaul", point: "I rebuilt the payments platform ledger.", pageSource: null, emphasis: null },
    { label: "", cue: "", point: "The payments platform closed the books nightly.", pageSource: null, emphasis: null },
  ];

  it("in all three branches at once", () => {
    const before = render(LINES, null).map((li) => li.textContent);
    const after = render(LINES).map((li) => li.textContent);
    expect(after).toEqual(before);
    expect(render(LINES).flatMap(marks).length).toBeGreaterThan(0); // not vacuous
  });
});

describe("AC-M20 / AC-T7 -- an empty glossary changes nothing at all", () => {
  const LINES = [
    emphasised({ label: "Situation", pageSource: { id: "pg-1", title: "Ledger Rebuild" } }),
    { label: "Action", cue: "Ledger overhaul", point: "I rebuilt the settlement ledger.", pageSource: null, emphasis: null },
    { label: "", cue: "", point: "It closed the books nightly.", pageSource: null, emphasis: null },
  ];

  it("renders innerHTML byte-identical to a render with NO provider mounted", () => {
    const withoutProvider = render(LINES, null)[0].parentElement.innerHTML;
    const withEmptyIndex = render(LINES, [])[0].parentElement.innerHTML;
    expect(withEmptyIndex).toBe(withoutProvider);
  });

  it("a render with no provider does not throw and yields zero buttons", () => {
    const lis = render(LINES, null);
    expect(lis).toHaveLength(3);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("[data-glossary]")).toHaveLength(0);
  });

  it("a term that occurs in NO line adds nothing", () => {
    const unrelated = render(LINES, [term("transaction wraparound")])[0].parentElement.innerHTML;
    expect(unrelated).toBe(render(LINES, null)[0].parentElement.innerHTML);
  });
});

// ---------------------------------------------------------------------------
// AC-M7 / AC-M8 through the RENDER, not through the matcher
// ---------------------------------------------------------------------------
describe("AC-M7 / AC-M8 -- the straddle drop, in the DOM", () => {
  const POINT2 = "I built the payments platform and the settlement ledger.";

  it("drops a mark that crosses the emphasis boundary rather than splitting it", () => {
    const line = {
      label: "",
      cue: "",
      point: POINT2,
      pageSource: null,
      emphasis: { start: POINT2.indexOf("platform"), end: POINT2.length - 1 },
    };
    const [li] = render([line], [term("payments platform"), term("settlement ledger")]);
    expect(marks(li).map((b) => b.textContent)).toEqual(["settlement ledger"]);
    expect(li.textContent).toBe(POINT2);
    const strong = li.querySelector("strong");
    expect(strong.textContent).toBe(POINT2.slice(line.emphasis.start, line.emphasis.end));
    // ONE <strong>, and it is exactly the span -- the straddling mark did not
    // move, extend or duplicate it.
    expect(li.querySelectorAll("strong")).toHaveLength(1);
  });

  it("drop-then-cap: three candidates, one straddling, leaves TWO", () => {
    const point = "The message queue, the payments platform and the settlement ledger all shipped.";
    const [li] = render(
      [{ label: "", cue: "", point, pageSource: null, emphasis: { start: point.indexOf("platform"), end: point.length - 1 } }],
      [term("message queue"), term("payments platform"), term("settlement ledger")],
    );
    expect(marks(li).map((b) => b.textContent)).toEqual(["message queue", "settlement ledger"]);
    expect(li.textContent).toBe(point);
  });
});

// ---------------------------------------------------------------------------
// One sourced and one unsourced term on the SAME line
// ---------------------------------------------------------------------------
describe("provenance never reaches the <li>", () => {
  const POINT3 = "I built the payments platform on a message queue.";
  const LINE = { label: "Action", cue: "", point: POINT3, pageSource: null, emphasis: null };

  it("marks a sourced and an unsourced term identically", () => {
    const [li] = render([LINE], [SOURCED, term("message queue")]);
    const buttons = marks(li);
    expect(buttons.map((b) => b.textContent)).toEqual(["payments platform", "message queue"]);
    // Identical attribute surface: nothing on the <li> says which of the two
    // has a source. The card says it; the sentence does not.
    const shape = (b) => [...b.attributes].map((a) => a.name).sort().join(",");
    expect(shape(buttons[0])).toBe(shape(buttons[1]));
    expect(li.innerHTML).not.toMatch(/postgresql|source_url|source_host|PostgreSQL Tutorial/i);
    expect(li.textContent).toBe(`Action: ${POINT3}`);
  });

  it("adds exactly one button per mark and no more", () => {
    const [li] = render([LINE], [SOURCED, term("message queue")]);
    expect(li.querySelectorAll("button")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The citation chunk's trip-wire, made real
// ---------------------------------------------------------------------------
describe("the glossary never marks the citation line", () => {
  it("[data-citation] [data-glossary] stays empty even when the point IS marked", () => {
    // AnswerLines.citation.test.js:204 asserts exactly this and is vacuous
    // until a glossary ships. Here the assertion is live: the same <li> holds
    // a marked point AND a citation naming a page whose title contains a
    // stored term.
    const [li] = render(
      [
        {
          label: "",
          cue: "",
          point: "I built the payments platform.",
          pageSource: { id: "pg-1", title: "Payments platform migration" },
          emphasis: null,
        },
      ],
      [term("payments platform")],
    );
    expect(marks(li)).toHaveLength(1); // not vacuous
    expect(li.querySelectorAll("[data-citation] [data-glossary]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-citation] [data-glossary]")).toHaveLength(0);
    // And the citation's own sentence is untouched, term-shaped title and all.
    expect(li.textContent).toContain("From your Payments platform migration page.");
  });

  it("and that selector really can find a mark inside a citation", () => {
    // THE NON-VACUITY PROOF FOR THE SELECTOR ITSELF. The assertion above is a
    // trip-wire, and a trip-wire whose selector is subtly wrong reads as
    // coverage forever. Proving the OTHER half -- that a glossary node nested
    // inside a citation node WOULD be found -- cannot be done by mutating
    // AnswerLines.js, because the only way to nest one there is to edit
    // CitationDetail.js, which this chunk may not touch. So the selector is
    // exercised directly against a planted DOM.
    //
    // (Mutating AnswerLines.js to render a GlossaryTerm as a SIBLING of the
    // citation was also run, and it turns four assertions in
    // AnswerLines.citation.test.js and two here red -- so the region is
    // guarded from both directions.)
    const planted = document.createElement("div");
    planted.innerHTML = '<span data-citation="panel"><button data-glossary="term">x</button></span>';
    document.body.appendChild(planted);
    expect(planted.querySelectorAll("[data-citation] [data-glossary]")).toHaveLength(1);
    planted.remove();
  });
});
