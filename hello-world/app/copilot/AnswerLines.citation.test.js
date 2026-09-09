// @vitest-environment jsdom
//
// COMPOSITION. Three chunks now share one renderer: the emphasis span, the
// expansion disclosure, and this citation reveal. This file asserts, against
// the REAL AnswerLines, that this chunk fits between the other two without
// moving anything either of them pins.
//
// The three invariants it is written against, each owned by a file this chunk
// may not touch:
//
//   * AnswerLines.emphasis.test.js counts `li.querySelectorAll("strong")` with
//     a DESCENDANT selector and pins it at exactly 1 on the emphasis branch and
//     0 on the bare branch. So this chunk emits no <strong>/<b>/<em> anywhere,
//     and portals its panel out of every <li>.
//   * AnswerLines.expansion.test.js:152 and :516 pin `li.querySelectorAll(
//     "button")` at exactly 1. A {id, title}-only citation must therefore
//     render NO control — which is what the PAGE tier's "return the entry
//     unchanged" rule buys.
//   * AnswerLines.expansion.test.js:311-325 pins DOM order inside the <li> as
//     citation < control < panel.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

import AnswerLines from "./AnswerLines.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINES_SRC = readFileSync(path.join(process.cwd(), "app/copilot/AnswerLines.js"), "utf8");
const CITATION_SRC = readFileSync(path.join(process.cwd(), "app/copilot/CitationDetail.js"), "utf8");

const POINT = "I rebuilt the ledger after the settlement outage was finally contained.";
const BARE_SOURCE = { id: "p1", title: "Payments migration" };
const LOCATED_SOURCE = {
  id: "p2",
  title: "Management Experience",
  located: true,
  section: "Automating compatibility checks",
  quote: "- Built a service that ran compatibility checks against every partner release",
  quoteTruncated: false,
  outline: ["Automating compatibility checks"],
  outlineMore: 0,
};

function fakeApi() {
  const open = new Set();
  return {
    get: () => ({ status: "idle", subBullets: [], caption: "", code: null }),
    isOpen: (line) => open.has(line.point),
    toggle: (line) => (open.has(line.point) ? open.delete(line.point) : open.add(line.point)),
    retry: () => {},
  };
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(lines, expansion) {
  await act(async () => {
    root.render(createElement(AnswerLines, { lines, expansion }));
  });
  return container;
}

const line = (pageSource, extra = {}) => ({
  label: "Situation",
  cue: "",
  point: POINT,
  emphasis: { start: 53, end: 70 },
  pageSource,
  ...extra,
});

// ---------------------------------------------------------------------------
// AC-CH.14 — a bare citation is byte-identical to today
// ---------------------------------------------------------------------------
describe("a {id, title} citation renders exactly as it did before this feature", () => {
  it("adds no control, no attribute and no character", async () => {
    // MUTATION PROOF: render the control unconditionally; the button count goes
    // red here AND AnswerLines.expansion.test.js:152 goes red with it.
    const el = await render([line(BARE_SOURCE)]);
    const li = el.querySelector("li");
    expect(li.textContent).toBe(`Situation: ${POINT}From your Payments migration page.`);
    expect(li.querySelectorAll("button")).toHaveLength(0);
    expect(li.querySelectorAll("[data-citation]")).toHaveLength(0);
    expect(li.querySelectorAll("strong")).toHaveLength(1); // the emphasis branch's own
  });

  it("keeps the bare branch at zero <strong>", async () => {
    const el = await render([line(BARE_SOURCE, { emphasis: null, cue: "" })]);
    expect(el.querySelector("li").querySelectorAll("strong")).toHaveLength(0);
  });

  it("still renders nothing at all for a line with no page source", async () => {
    const el = await render([line(null, { emphasis: null, label: "", cue: "" })]);
    expect(el.querySelector("li").children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-CH.18 — the section rides the sentence
// ---------------------------------------------------------------------------
describe("an enriched citation names its section in the sentence", () => {
  it("reads 'From your X page, under Y.' and never with a dash or an ellipsis", async () => {
    const el = await render([line(LOCATED_SOURCE)]);
    const li = el.querySelector("li");
    expect(li.textContent).toContain(
      "From your Management Experience page, under Automating compatibility checks.",
    );
    expect(li.textContent).not.toContain("—");
    expect(li.textContent).not.toContain("…");
    expect(li.querySelectorAll("strong")).toHaveLength(1);
  });

  it("keeps the citation before the expansion control, and the panel out of the <li>", async () => {
    const el = await render([line(LOCATED_SOURCE)], fakeApi());
    const li = el.querySelector("li");
    const kids = [...li.children];
    const citationAt = kids.findIndex((k) => k.textContent.startsWith("From your Management Experience"));
    const controlAt = kids.findIndex((k) => k.getAttribute("data-expansion") === "control");
    expect(citationAt).toBeGreaterThan(-1);
    expect(citationAt).toBeLessThan(controlAt);

    const citationButton = li.querySelector("[data-citation='control']");
    await act(async () => citationButton.click());
    const panel = document.querySelector("[data-citation='panel']");
    expect(panel).not.toBeNull();
    expect(li.contains(panel)).toBe(false);
    expect(panel.closest("li")).toBe(null);
    // The expansion chunk's own exclusion helper strips [data-expansion]; this
    // chunk's nodes must never carry that attribute or `bare(li)` would eat them.
    expect(li.querySelectorAll("[data-citation][data-expansion]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-citation] strong, [data-citation] b, [data-citation] em")).toHaveLength(0);
  });

  it("adds exactly one button to a <li> whose citation is enriched", async () => {
    const el = await render([line(LOCATED_SOURCE)]);
    expect(el.querySelector("li").querySelectorAll("button")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-CH.15 / AC-CH.17 — the diff to AnswerLines.js, and what neither file does
// ---------------------------------------------------------------------------
describe("the diff to AnswerLines.js is one import and one sentinel region", () => {
  it("puts the whole change between /* citation:start */ and /* citation:end */", () => {
    expect(LINES_SRC).toContain("/* citation:start */");
    expect(LINES_SRC).toContain("/* citation:end */");
    const slice = LINES_SRC.slice(
      LINES_SRC.indexOf("/* citation:start */"),
      LINES_SRC.indexOf("/* citation:end */"),
    );
    expect(slice.length).toBeGreaterThan(20);
    expect(slice).not.toContain("sx=");
    expect(slice).not.toContain("strong");
    expect(slice).not.toContain("useState");
  });

  it("leaves the expansion region and the point render alone", () => {
    const expansionSlice = LINES_SRC.slice(
      LINES_SRC.indexOf("/* expansion:start */"),
      LINES_SRC.indexOf("/* expansion:end */"),
    );
    expect(expansionSlice).toContain("<ExpansionPanel line={line} api={expansion} />");
    expect(expansionSlice).not.toContain("Citation");
    // The one expression that produces the <li>'s single <strong>.
    expect(LINES_SRC).toContain("<strong>{line.point.slice(span.start, span.end)}</strong>");
  });

  it("neither file scrolls anything into view", () => {
    expect(LINES_SRC).not.toContain("scrollIntoView");
    expect(CITATION_SRC).not.toContain("scrollIntoView");
  });
});

// ---------------------------------------------------------------------------
// AC-CH.16 — the contract owed to the queued glossary chunk
// ---------------------------------------------------------------------------
describe("the glossary must never mark inside the citation", () => {
  it("finds no glossary mark inside a citation, open or closed", async () => {
    // VACUOUSLY TRUE TODAY, and deliberately so — it is a trip-wire, not a
    // measurement. The glossary chunk marks posting jargon inside `line.point`;
    // the page title and the candidate's own heading are THEIR words, and a
    // glossary mark inside this region would nest an interactive definition
    // affordance inside this feature's disclosure button — invalid HTML and
    // unusable by keyboard.
    const el = await render([line(LOCATED_SOURCE)]);
    await act(async () => el.querySelector("[data-citation='control']").click());
    expect(document.querySelectorAll("[data-citation='panel']")).toHaveLength(1); // not vacuous by accident
    expect(document.querySelectorAll("[data-citation] [data-glossary]")).toHaveLength(0);
  });
});
