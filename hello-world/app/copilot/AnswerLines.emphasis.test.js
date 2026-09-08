// @vitest-environment jsdom
//
// AC-bullet-truncation r10 — AC-C.2, AC-C.7, AC-C.8, AC-C.9's render half.
// R-324. FAILING TESTS for the render layer of the cue fix.
//
// THE CONTRACT THIS FILE PINS. AnswerLines receives lib/copilot/answerPoints.js's
// line objects, now carrying `emphasis: { start, end } | null` (character
// offsets into `line.point`), and renders:
//
//   emphasis set   ->  {label at weight 600}{point, with point.slice(start,end)
//                      wrapped in exactly ONE <strong>}.  NO cue, NO em dash.
//   cue set        ->  today's two-part form, byte-identical.
//   neither        ->  today's no-cue branch, byte-identical (no <strong>).
//
// WHY THE LABEL LEAVES THE BOLD (r10 §6.2). AnswerLines.js:91-94 wraps
// `{label}: {cue}` in <strong> today, so the STAR label is INSIDE the current
// bold. AC-C.7 permits exactly one <strong> per line and the emphasis span is
// now inside the sentence, so the label cannot stay in it — 1,314 of the
// corpus's 3,137 cued lines change this way. The label keeps a weight of its
// own instead (AC-C.8), because answerCues.js:130-133 calls it "the
// navigation": it is how a candidate mid-interview finds the Result beat
// without reading four sentences.
//
// WHAT IS **NOT** ASSERTED HERE, AND WHY — jsdom HAS NO LAYOUT ENGINE.
// getBoundingClientRect() returns zeroes and there are no font metrics, so:
//   * That weight 600 is VISIBLY lighter than <strong> on screen (AC-C.8's own
//     text says this is not measurable here). Only the two declared values are
//     asserted.
//   * That any bullet occupies fewer wrapped lines, or is narrower, after the
//     cue is removed. Nothing in this repo can see that. r10 §16.1 says the
//     design's proxy is word count, and the word counts live in the pure tests.
//   * r10 also records that MUI's <strong> computes to "bolder" in jsdom, not
//     "700" — so the emphasised run is asserted BY TAG, never by weight.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AnswerLines from "./AnswerLines.js";

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
});

function render(lines) {
  act(() => root.render(createElement(AnswerLines, { lines })));
  return [...container.querySelectorAll("li")];
}

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

describe("AC-C.2 — the rendered line is the sentence, once", () => {
  it("renders exactly `label: point` — the cue's words appear ONE time", () => {
    const [li] = render([emphasised({ label: "Action" })]);
    expect(li.textContent).toBe(`Action: ${POINT}`);
    // The defect, stated as a negative so a regression is caught by name:
    // "Built and scaled a payments platform — I built and scaled a payments
    // platform." must not be reachable.
    expect(li.textContent).not.toMatch(/ — /);
    expect(li.textContent.match(/built and scaled/gi)).toHaveLength(1);
  });

  it("renders an UNLABELLED emphasised line as the bare sentence", () => {
    const [li] = render([emphasised()]);
    expect(li.textContent).toBe(POINT);
  });

  it("bolds exactly the TIGHT span, using the POINT's own characters", () => {
    const [li] = render([emphasised({ label: "Action" })]);
    const strongs = li.querySelectorAll("strong");
    expect(strongs).toHaveLength(1);
    // The point's own case — not `tidy`'s capitalised cue. This is the
    // 1,008 practice lines whose bold changes case (r10 §6.2).
    expect(strongs[0].textContent).toBe("built and scaled a payments platform");
    expect(li.textContent.includes(strongs[0].textContent)).toBe(true);
  });
});

describe("AC-C.7 / AC-C.8 — one <strong>, and the label is not in it", () => {
  it("exactly ONE <strong> per emphasised <li>", () => {
    const lis = render([
      emphasised({ label: "Situation" }),
      emphasised({ label: "Action" }),
      emphasised({ label: "Result" }),
    ]);
    for (const li of lis) expect(li.querySelectorAll("strong")).toHaveLength(1);
  });

  it("the STAR label is OUTSIDE the <strong>", () => {
    const [li] = render([emphasised({ label: "Action" })]);
    const strong = li.querySelector("strong");
    expect(strong.textContent).not.toMatch(/Action/);
    expect(strong.textContent.includes(":")).toBe(false);
  });

  it("the label keeps a weight of its own: a node computing font-weight 600", () => {
    const [li] = render([emphasised({ label: "Action" })]);
    const labelNodes = [...li.querySelectorAll("*")].filter(
      (el) => el.tagName !== "STRONG" && /^Action/.test(el.textContent.trim()) && !el.querySelector("strong"),
    );
    expect(labelNodes.length, "the label must be its own element so it can carry a weight").toBeGreaterThan(0);
    const weights = labelNodes.map((el) => getComputedStyle(el).fontWeight);
    // r10 AC-C.8: sx={{ fontWeight: 600 }} reads back as exactly "600" in
    // jsdom, whereas <strong> reads back "bolder". Asserting 600 here is the
    // half that IS measurable; "visibly distinct" is not, and is not claimed.
    expect(weights, `label weights seen: ${JSON.stringify(weights)}`).toContain("600");
  });

  it("an emphasised line is NOT rendered with the label glued into the bold", () => {
    const [li] = render([emphasised({ label: "Result" })]);
    expect(li.innerHTML).not.toMatch(/<strong>[^<]*Result:/);
  });
});

describe("AC-C.2 (iii)/(iv) — the two branches that must not regress", () => {
  it("a line with NO cue and NO emphasis renders exactly as it does today", () => {
    const [li] = render([{ label: "Task", cue: "", point: "State the goal you owned.", pageSource: null, emphasis: null }]);
    expect(li.textContent).toBe("Task: State the goal you owned.");
    expect(li.querySelectorAll("strong")).toHaveLength(0);
  });

  it("a PARAPHRASED cue still renders in the old two-part form, byte-identical", () => {
    // AC-G.2: the Gemini path is untouched. A model cue that genuinely
    // paraphrases has no run to locate, keeps `cue`, and must render exactly
    // as it does today — label inside the bold, em dash, then the point.
    const [li] = render([
      { label: "Action", cue: "Ledger overhaul", point: "I rebuilt the settlement ledger.", pageSource: null, emphasis: null },
    ]);
    expect(li.textContent).toBe("Action: Ledger overhaul — I rebuilt the settlement ledger.");
    const strongs = li.querySelectorAll("strong");
    expect(strongs).toHaveLength(1);
    expect(strongs[0].textContent).toBe("Action: Ledger overhaul");
  });

  it("the page citation still renders under an emphasised line (AC-6.3, R-335)", () => {
    const [li] = render([emphasised({ pageSource: { id: "pg-1", title: "Ledger Rebuild" } })]);
    expect(li.textContent).toContain("From your Ledger Rebuild page.");
    expect(li.querySelectorAll("strong")).toHaveLength(1);
  });

  it("tolerates a malformed emphasis span rather than rendering a broken line", () => {
    // Defensive: the render layer must not produce a partial or duplicated
    // sentence if the span is out of range.
    for (const bad of [{ start: -1, end: 5 }, { start: 5, end: 4 }, { start: 0, end: 9999 }]) {
      const [li] = render([emphasised({ emphasis: bad })]);
      expect(li.textContent).toBe(POINT);
    }
    // NOT VACUOUS: without this, "ignore `emphasis` entirely" passes the loop
    // above on every input. A VALID span must still produce the emphasis.
    const [ok] = render([emphasised()]);
    expect(ok.querySelectorAll("strong")).toHaveLength(1);
  });
});
