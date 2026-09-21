// @vitest-environment jsdom
//
// TDD RED hand-off -- N43, part 2 of 2: the states that produce NO citation
// apparatus, the one-marker-per-stage rule, and the explicit-margin class
// guard over everything this chunk adds.
//
// Split from `PrepPackPanel.citations.test.js` (which owns the cited and
// cited-but-unsafe states, the hrefs, the accessible names and the
// numbering) to stay well inside the 1000-line ceiling. The two files share
// no state and duplicate only their harness, which is this repo's own
// convention across `PrepPackPanel.test.js` /
// `PrepPackPanel.generate.test.js` / `PrepPackPanel.sectionHeaders.test.js`.
//
// Binds to <scratchpad>/chunks/N43/ac.r1.md AC-N43.3/.4/.5/.6/.7(a), and is
// specified by <scratchpad>/chunks/N43/design-experience.r1.md ss2, ss2a,
// ss4, ss8.
//
// ---------------------------------------------------------------------------
// RED ON HEAD, AND THE VACUOUS CASES DISCLOSED RATHER THAN COUNTED
// ---------------------------------------------------------------------------
// RED: every block whose name starts "state 3", "stage marker" or "explicit
// margins". Each asserts a POSITIVE artefact that HEAD does not render --
// the pack-level disclosure, the single stage marker, the per-section source
// list -- before it constrains anything.
//
// VACUOUS ON HEAD, stated plainly and NOT counted as coverage: the
// "state 2" block below (a legitimately uncited item renders nothing
// citation-shaped). HEAD renders nothing citation-shaped ANYWHERE, so those
// assertions pass today for the wrong reason. They are written now because
// they are the over-fire control the cited assertions need, and they become
// live the moment any marker exists. This is the same disclosure shape
// AC-N44.2 used for the identical situation. Where a case in that block CAN
// be made live today it is, by pairing the negative with a positive in the
// SAME render (a build that renders nothing fails the positive half).
//
// ---------------------------------------------------------------------------
// WHAT CANNOT BE ASSERTED HERE
// ---------------------------------------------------------------------------
//   * That a screen reader announces the disclosure sentence before the
//     sections. What is asserted is DOM order, which is its precondition.
//   * Any rendered geometry. jsdom has no layout; the margin guard below
//     tests for the PRESENCE OF A DECLARATION, never for a pixel value.
//   * The exact copy of the disclosure. design-experience.r1.md ss9 gates its
//     wording on an owner measurement that has not run, so every assertion
//     below is differential (this state says MORE than that one) or
//     structural (it is prose, not a list), never a string match.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SPECIFIER = "./PrepPackPanel.js";
let modPromise;
function load() {
  if (!modPromise) modPromise = import(SPECIFIER);
  return modPromise;
}

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

async function render(props) {
  const mod = await load();
  const PrepPackPanel = mod.default;
  await act(async () => {
    root.render(createElement(PrepPackPanel, props));
  });
  return container;
}

async function renderFixture(element) {
  await act(async () => {
    root.render(element);
  });
  return container;
}

/** Renders into a SECOND, throwaway root so two fixtures can be compared
 *  without unmounting the primary one. Returns the detached container. */
async function renderAside(props) {
  const mod = await load();
  const PrepPackPanel = mod.default;
  const aside = document.createElement("div");
  document.body.appendChild(aside);
  const asideRoot = createRoot(aside);
  await act(async () => {
    asideRoot.render(createElement(PrepPackPanel, props));
  });
  const text = norm(visibleText(aside));
  const aboveSections = textAboveSections(aside);
  const counts = {
    listItems: aside.querySelectorAll("li").length,
    hrefs: aside.querySelectorAll("[href]").length,
    markers: aside.querySelectorAll("[data-citation-marker]").length,
    buttons: aside.querySelectorAll("button").length,
  };
  await act(async () => asideRoot.unmount());
  aside.remove();
  return { text, aboveSections, counts };
}

// ---------------------------------------------------------------------------
// Fixtures (PrepPackPanel.js:81-86's labels restated, not imported)
// ---------------------------------------------------------------------------
const SECTION_LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};
const ALL_SECTIONS = ["aboutYou", "whyRole", "askThem", "stages"];

const CLAIM_A = {
  id: "claim-a",
  text: "Acme opened a Dublin engineering hub in March 2026.",
  sourceUrl: "https://newsroom.example.com/acme/dublin-hub",
};
const CLAIM_B = {
  id: "claim-b",
  text: "Acme moved its platform team to a weekly release train.",
  sourceUrl: "https://press.example.org/acme/release-train",
};

// The forbidden-vocabulary rule DigestPanel.js's own COPY header states, and
// AC-N43.5 re-imposes here: the panel may say what it found, never that it
// checked whether the found thing is true.
const OVERCLAIM_WORDS = ["verified", "verify", "fact-check", "fact check", "confirmed", "confirms", "proven"];

function cite(claim) {
  return { kind: "claim", claimId: claim.id };
}

function pack({ aboutYou = [], whyRole = [], askThem = [], stages = [], claims, ...rest } = {}) {
  const out = {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: aboutYou } },
      whyRole: { answer: { lines: whyRole } },
      askThem: { questions: askThem },
      stages: { stages },
    },
    ...rest,
  };
  if (claims !== undefined) out.claims = claims;
  return out;
}

function stage({ name, questions = [], recommendedAnswer = null, support = null }) {
  return { name, questions, recommendedAnswer, support };
}

function baseProps(overrides = {}) {
  return {
    applicationId: "app-1",
    pack: null,
    status: "ready",
    completeSections: ALL_SECTIONS,
    attemptsExhausted: false,
    candidateName: null,
    interviewerNames: [],
    error: null,
    onDownloadLog: vi.fn(),
    onSaveNames: vi.fn(),
    generating: false,
    triggerMessage: null,
    onGenerateNow: vi.fn(),
    hasDescription: true,
    ...overrides,
  };
}

/** Identical CONTENT in every fixture below, so the only thing that varies
 *  between a control and its state is the citation data itself. */
const BODY = {
  aboutYou: [{ text: "I led the migration of a twelve-service platform." }],
  whyRole: [{ text: "The release cadence here matches how I like to work." }],
  askThem: [{ text: "How does the platform team decide what ships weekly?" }],
  stages: [
    stage({
      name: "Hiring manager screen",
      questions: ["Walk me through your last platform migration."],
      recommendedAnswer: null,
    }),
  ],
};

function bodyWith({ claims, support = null }) {
  return pack({
    claims,
    aboutYou: [{ ...BODY.aboutYou[0], support }],
    whyRole: [{ ...BODY.whyRole[0], support: null }],
    askThem: [{ ...BODY.askThem[0], support: null }],
    stages: [{ ...BODY.stages[0], support: null }],
  });
}

// The embedded / no-LLM engine's pack, by construction: claims: [] and every
// support null, unconditionally (lib/interviewPrep/prepPack.js:228-280). A
// permanent, legitimate "nothing to cite" state, never a defect.
const EMBEDDED_PACK = { ...bodyWith({ claims: [] }), templateOrigin: "embedded-template" };

// A legacy (pre-N16) pack: no `claims` key ever existed for it, and only
// `stages` survives `completeSections` (AC-N33.15's own fixture shape).
const LEGACY_PACK = pack({ stages: BODY.stages });
const LEGACY_SECTIONS = ["stages"];

// ---------------------------------------------------------------------------
// Instruments (canaried below)
// ---------------------------------------------------------------------------

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

function visibleText(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";
  const view = node.ownerDocument.defaultView;
  const style = view.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return "";
  let out = "";
  for (const child of node.childNodes) out += visibleText(child);
  return out;
}

function norm(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function accessibleName(el) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby && labelledby.trim()) {
    return norm(
      labelledby
        .trim()
        .split(/\s+/)
        .map((id) => {
          const target = el.ownerDocument.getElementById(id);
          return target ? visibleText(target) : "";
        })
        .join(" ")
    );
  }
  const label = el.getAttribute("aria-label");
  if (label != null && label.trim()) return label.trim();
  return norm(visibleText(el));
}

function headingElements(el) {
  return [...el.querySelectorAll(HEADING_SELECTOR)].filter((node) => {
    if (node.getAttribute("aria-hidden") === "true") return false;
    const role = (node.getAttribute("role") || "").trim();
    if (role) return role.split(/\s+/)[0] === "heading";
    return HEADING_TAGS.includes(node.tagName.toLowerCase());
  });
}

function markers(el) {
  return [...el.querySelectorAll("[data-citation-marker]")];
}

function markerNumber(marker) {
  const fromAttr = (marker.getAttribute("data-citation-marker") || "").trim();
  const fromText = norm(visibleText(marker)).replace(/[^\d]/g, "");
  if (!/^\d+$/.test(fromAttr)) return null;
  if (fromText !== fromAttr) return null;
  return Number(fromAttr);
}

function sourceHeadingFor(el, section) {
  const want = `Sources for ${SECTION_LABELS[section]}`;
  return headingElements(el).find((node) => accessibleName(node) === want) || null;
}
function sourceListFor(el, section) {
  const heading = sourceHeadingFor(el, section);
  if (!heading || !heading.parentElement) return null;
  return heading.parentElement.querySelector("ol");
}
function sectionRoot(el, section) {
  const heading = headingElements(el).find((node) => accessibleName(node) === SECTION_LABELS[section]);
  return heading ? heading.parentElement : null;
}
function sectionMarkers(el, section) {
  const scope = sectionRoot(el, section);
  if (!scope) return [];
  const list = sourceListFor(el, section);
  return markers(scope).filter((marker) => !(list && list.contains(marker)));
}
function ancestorWhoseTextIs(node, want) {
  const target = norm(want);
  let cursor = node.parentElement;
  while (cursor) {
    if (norm(visibleText(cursor)) === target) return cursor;
    cursor = cursor.parentElement;
  }
  return null;
}

/** Visible text of everything that precedes `stop` in document order. The
 *  instrument for "this prose is ABOVE the sections", which is the DOM
 *  precondition for a screen reader meeting it first. */
function textBefore(rootEl, stop) {
  let out = "";
  const walk = (node) => {
    if (node === stop) return true;
    if (node.nodeType === 3) {
      out += node.nodeValue || "";
      return false;
    }
    if (node.nodeType !== 1) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    for (const child of node.childNodes) if (walk(child)) return true;
    return false;
  };
  walk(rootEl);
  return norm(out);
}

/** The panel text that precedes the FIRST section heading, or null when that
 *  heading is absent (which would make any comparison meaningless). */
function textAboveSections(el) {
  const heading = headingElements(el).find((node) => accessibleName(node) === SECTION_LABELS.aboutYou);
  return heading ? textBefore(el, heading) : null;
}

/** The stage QUESTION list items -- every `<li>` in the stages section that
 *  is not part of that section's own source list. */
function stageQuestionItems(el) {
  const scope = sectionRoot(el, "stages");
  if (!scope) return [];
  const list = sourceListFor(el, "stages");
  return [...scope.querySelectorAll("li")].filter((li) => !(list && list.contains(li)));
}

// --- the explicit-margin class guard's instrument --------------------------
// The rule landed in `070e1ec` and caught a second instance hours later in
// N44: an element whose vertical margin is left unstated is styled by the
// browser's user-agent stylesheet, silently and differently per environment.
//
// MEASURED, not assumed (the measurement is N44's, re-checked by this file's
// own canary below): jsdom's getComputedStyle DOES apply emotion's injected
// `sx` rules, and does NOT apply a UA default stylesheet -- so an UNDECLARED
// margin reads back as bare "0" while a DECLARED one always carries a unit.
// The unit is the discriminator, which is why this guard tests for the
// PRESENCE OF A DECLARATION rather than for a value.
const UA_VERTICAL_MARGIN_TAGS = [
  "p",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "figure",
  "pre",
  "dl",
  "dd",
  "menu",
];
const UA_MARGIN_SELECTOR = UA_VERTICAL_MARGIN_TAGS.join(",");
const DECLARED_LENGTH = /^-?\d*\.?\d+(px|em|rem|%|vh|vw|pt|ex|ch)$/;

function isDeclaredLength(value) {
  return typeof value === "string" && DECLARED_LENGTH.test(value.trim());
}

/** Every element whose tag has a non-zero UA default vertical margin but
 *  which declares no explicit one. An empty array is the passing state. */
function unpinnedVerticalMargins(el) {
  return [...el.querySelectorAll(UA_MARGIN_SELECTOR)]
    .map((node) => {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      return {
        tag: node.tagName.toLowerCase(),
        text: norm(visibleText(node)).slice(0, 48),
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
      };
    })
    .filter((row) => !isDeclaredLength(row.marginTop) || !isDeclaredLength(row.marginBottom));
}

// ---------------------------------------------------------------------------

describe("INSTRUMENT CANARIES -- not N43 coverage; these pass on HEAD", () => {
  it("unpinnedVerticalMargins bites on a NEW member of the class, and clears when both directions are stated", async () => {
    // Deliberately NOT the element N44 already fixed. The guard must be
    // proved against a fresh member of the class, because a guard proved only
    // on its originating bug is the "tested the easier mutant" trap.
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("h4", { id: "bare" }, "unstyled h4"),
        createElement("ol", { id: "bare-list" }, createElement("li", null, "x")),
        createElement("h4", { id: "pinned", style: { marginTop: "0px", marginBottom: "4px" } }, "styled h4"),
        createElement(
          "ol",
          { id: "pinned-list", style: { marginTop: "0px", marginBottom: "0px", paddingLeft: "20px" } },
          createElement("li", null, "x")
        ),
        // Only ONE direction stated: still a finding, because a UA default
        // on the other direction is exactly what the rule is about.
        createElement("h4", { id: "half", style: { marginBottom: "4px" } }, "half-styled h4")
      )
    );
    const found = unpinnedVerticalMargins(el).map((row) => row.text);
    expect(found).toEqual(["unstyled h4", "x", "half-styled h4"]);
  });

  it("markerNumber and sectionMarkers return empty rather than throwing when nothing is cited", async () => {
    const el = await renderFixture(createElement("div", null, createElement("h3", null, SECTION_LABELS.aboutYou)));
    expect(sectionMarkers(el, "aboutYou")).toEqual([]);
    expect(sourceHeadingFor(el, "aboutYou")).toBe(null);
  });

  it("renderAside returns a text and counts snapshot of a second, independent mount", async () => {
    const a = await renderAside(baseProps({ pack: bodyWith({ claims: [] }) }));
    expect(a.text).toContain(BODY.aboutYou[0].text);
    expect(a.counts.markers).toBe(0);
    // ...and it really did unmount: the primary container is untouched.
    expect(container.childNodes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-N43.4 / .6 -- states 2 and 2b: nothing to cite renders nothing
// ---------------------------------------------------------------------------

describe("N43 state 2 (legitimately uncited) -- VACUOUS ON HEAD where noted; the over-fire control for every cited assertion", () => {
  it("VACUOUS ON HEAD: an embedded-engine pack renders no marker, no source heading, and no link", async () => {
    const el = await render(baseProps({ pack: EMBEDDED_PACK }));
    // The content IS rendered -- so this case at least cannot pass by
    // rendering an empty panel.
    expect(norm(visibleText(el))).toContain(BODY.aboutYou[0].text);
    expect(markers(el), "an engine that never cites must show no citation apparatus").toHaveLength(0);
    expect(el.querySelectorAll("[href]")).toHaveLength(0);
    for (const section of ALL_SECTIONS) expect(sourceHeadingFor(el, section)).toBe(null);
  });

  it("an uncited line renders identically whether or not OTHER lines in the pack are cited", async () => {
    // This is the live half of state 2, and it is RED on HEAD: the cited
    // fixture must differ from the uncited one (it gains a marker and a
    // list), while the UNCITED LINE'S OWN text must be byte-identical in
    // both. HEAD renders both identically, so the first assertion fails.
    const citedSide = bodyWith({ claims: [CLAIM_A], support: cite(CLAIM_A) });
    const plainSide = bodyWith({ claims: [CLAIM_A] });
    const cited = await renderAside(baseProps({ pack: citedSide }));
    const plain = await renderAside(baseProps({ pack: plainSide }));

    expect(cited.counts.markers, "the cited side must actually cite").toBe(1);
    expect(plain.counts.markers, "the uncited side must stay bare").toBe(0);

    // The uncited SECTIONS are identical on both sides: no "uncited" label,
    // no colour word, no extra text anywhere near them.
    const el = await render(baseProps({ pack: citedSide }));
    for (const section of ["whyRole", "askThem"]) {
      const scope = sectionRoot(el, section);
      expect(scope, `${section} must render`).toBeTruthy();
      expect(markers(scope)).toHaveLength(0);
      expect(sourceHeadingFor(el, section)).toBe(null);
    }
  });

  it("AC-N43.6: a legacy pack with no `claims` key renders exactly what the same pack with `claims: []` renders", async () => {
    const legacy = await renderAside(baseProps({ pack: LEGACY_PACK, completeSections: LEGACY_SECTIONS }));
    const emptyClaims = await renderAside(
      baseProps({ pack: { ...LEGACY_PACK, claims: [] }, completeSections: LEGACY_SECTIONS })
    );
    expect(legacy.text, "an absent citation schema is not evidence about anything").toBe(emptyClaims.text);
    expect(legacy.counts).toEqual(emptyClaims.counts);
    expect(legacy.counts.markers).toBe(0);
    // And the same legacy pack must NOT pick up state 3's disclosure -- the
    // assertion that makes this a real negative control rather than a
    // restatement lives in the state-3 block below, which compares against
    // this very text.
  });
});

// ---------------------------------------------------------------------------
// AC-N43.5 / .7(a) -- state 3: citations arrived, none placed
// ---------------------------------------------------------------------------

describe("N43 state 3 (arrived, not placed): disclosed as one pack-level sentence, never as a disguised bibliography", () => {
  it("a pack with claims but no resolved support says MORE than the same pack with no claims at all", async () => {
    const orphaned = await renderAside(baseProps({ pack: bodyWith({ claims: [CLAIM_A, CLAIM_B] }) }));
    const nothing = await renderAside(baseProps({ pack: bodyWith({ claims: [] }) }));

    expect(
      orphaned.text,
      "AC-N43.5: research that produced source material tied to nothing must not read as 'nothing to disclose'"
    ).not.toBe(nothing.text);
    expect(orphaned.text.length).toBeGreaterThan(nothing.text.length);
  });

  it("the disclosure is prose: it adds no list item, no link and no marker", async () => {
    const orphaned = await renderAside(baseProps({ pack: bodyWith({ claims: [CLAIM_A, CLAIM_B] }) }));
    const nothing = await renderAside(baseProps({ pack: bodyWith({ claims: [] }) }));
    // Under-fire control first, so "adds no list item" cannot pass by adding
    // nothing at all.
    expect(orphaned.text).not.toBe(nothing.text);
    expect(orphaned.counts.listItems, "a per-claim bibliography is exactly what the owner ruled out").toBe(
      nothing.counts.listItems
    );
    expect(orphaned.counts.hrefs).toBe(nothing.counts.hrefs);
    expect(orphaned.counts.markers).toBe(0);
  });

  it("AC-N43.7(a): an orphan claim is never rendered as its own numbered, clickable entry -- its text and URL appear nowhere", async () => {
    const el = await render(baseProps({ pack: bodyWith({ claims: [CLAIM_A, CLAIM_B] }) }));
    const text = norm(visibleText(el));
    // Under-fire control: the disclosure itself must be present, which is
    // what makes the three absences below meaningful.
    const nothing = await renderAside(baseProps({ pack: bodyWith({ claims: [] }) }));
    expect(text).not.toBe(nothing.text);

    for (const claim of [CLAIM_A, CLAIM_B]) {
      expect(text, "an unplaced claim may be counted, never quoted").not.toContain(claim.text);
      expect(el.innerHTML, "and its URL must not reach the DOM in any form").not.toContain(claim.sourceUrl);
    }
    for (const section of ALL_SECTIONS) expect(sourceHeadingFor(el, section)).toBe(null);
  });

  it("the disclosure sits above all four sections, where the pack-level status banner already is", async () => {
    const orphaned = await renderAside(baseProps({ pack: bodyWith({ claims: [CLAIM_A, CLAIM_B] }) }));
    const nothing = await renderAside(baseProps({ pack: bodyWith({ claims: [] }) }));
    expect(orphaned.aboveSections, "the aboutYou heading must render, or the comparison is meaningless").not.toBe(
      null
    );
    expect(nothing.aboveSections).not.toBe(null);
    // It is a PACK-LEVEL fact (a claim tied to nothing belongs to no
    // section), so it is disclosed above the sections, not inside one.
    expect(orphaned.aboveSections, "the disclosure belongs above the sections it is about").not.toBe(
      nothing.aboveSections
    );
    expect(orphaned.aboveSections.length).toBeGreaterThan(nothing.aboveSections.length);
  });

  it("a PARTIALLY placed pack still discloses, while the placed claim keeps its own linked entry", async () => {
    const el = await render(
      baseProps({
        pack: pack({
          claims: [CLAIM_A, CLAIM_B],
          aboutYou: [{ ...BODY.aboutYou[0], support: cite(CLAIM_A) }],
          whyRole: BODY.whyRole,
          askThem: BODY.askThem,
          stages: BODY.stages,
        }),
      })
    );
    // The placed claim is fully rendered...
    expect(sectionMarkers(el, "aboutYou")).toHaveLength(1);
    const list = sourceListFor(el, "aboutYou");
    expect(list, "the placed claim keeps its own entry").toBeTruthy();
    expect(norm(visibleText(list))).toContain(CLAIM_A.text);

    // ...the unplaced one is not, anywhere...
    expect(norm(visibleText(el))).not.toContain(CLAIM_B.text);
    expect(el.innerHTML).not.toContain(CLAIM_B.sourceUrl);

    // ...and the panel still says something the fully-placed pack does not.
    const allPlaced = await renderAside(
      baseProps({
        pack: pack({
          claims: [CLAIM_A],
          aboutYou: [{ ...BODY.aboutYou[0], support: cite(CLAIM_A) }],
          whyRole: BODY.whyRole,
          askThem: BODY.askThem,
          stages: BODY.stages,
        }),
      })
    );
    expect(norm(visibleText(el))).not.toBe(allPlaced.text);
  });

  it("a claim carrying NO sourceUrl is not 'source material that arrived' -- only a claim with a URL triggers it", async () => {
    // FOUND BY THE REFERENCE RUN, and pinned here so the implementer does
    // not rediscover it as a broken neighbour: the landed N44 test
    // "an excluded section's rendered output is byte-identical for two
    // wildly different pack contents"
    // (PrepPackPanel.sectionHeaders.test.js:510) compares the WHOLE panel's
    // innerHTML across two packs whose only citation difference is
    // `claims: []` versus `claims: [{ id: "c1", text: "a claim" }]` -- a
    // claim with NO sourceUrl. A disclosure keyed on `claims.length` alone
    // moves that byte comparison and turns a landed, correct test red.
    //
    // The resolution is a domain rule, not an exemption: a "claim" with no
    // source URL is not source material that went unused. It could never
    // have become a citation, so there is nothing about it to disclose.
    const urlless = await renderAside(
      baseProps({ pack: bodyWith({ claims: [{ id: "c-urlless", text: "A claim with nowhere to point." }] }) })
    );
    const none = await renderAside(baseProps({ pack: bodyWith({ claims: [] }) }));
    const withUrl = await renderAside(baseProps({ pack: bodyWith({ claims: [CLAIM_A] }) }));

    // RED half first: a real, unplaced, sourced claim DOES change the panel.
    expect(withUrl.text, "a genuinely unplaced source must still be disclosed").not.toBe(none.text);
    // ...and the URL-less one does not.
    expect(urlless.text, "nothing arrived that could ever have been cited").toBe(none.text);
  });

  it("no state overclaims: the panel never says a source was verified, fact-checked, confirmed or proven", async () => {
    const fixtures = [
      bodyWith({ claims: [CLAIM_A, CLAIM_B] }),
      bodyWith({ claims: [CLAIM_A], support: cite(CLAIM_A) }),
      bodyWith({ claims: [] }),
      EMBEDDED_PACK,
    ];
    let sawCitation = false;
    for (const fixture of fixtures) {
      const el = await render(baseProps({ pack: fixture }));
      sawCitation = sawCitation || markers(el).length > 0;
      const lower = norm(visibleText(el)).toLowerCase();
      for (const word of OVERCLAIM_WORDS) {
        expect(lower, `forbidden vocabulary: "${word}"`).not.toContain(word);
      }
    }
    // Under-fire control: without this, a panel that renders no citation copy
    // at all would pass the whole case. It is what makes this RED on HEAD.
    expect(sawCitation, "at least one fixture above must actually render a citation").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-N43.3 -- ONE marker per stage, attached to the stage NAME
// ---------------------------------------------------------------------------

const STAGE_NAME = "Hiring manager screen";
const STAGE_QUESTIONS = [
  "Walk me through your last platform migration.",
  "How do you handle a release that has to be rolled back?",
  "What would you want to change in your first month?",
];
const STAGE_ANSWER = "Lead with the twelve-service migration and name the rollback you owned.";

function stagesPack({ support = null, recommendedAnswer = STAGE_ANSWER, claims = [CLAIM_A] } = {}) {
  return pack({
    claims,
    stages: [stage({ name: STAGE_NAME, questions: STAGE_QUESTIONS, recommendedAnswer, support })],
  });
}

describe("N43 stage marker: a Stage's ONE shared support produces exactly ONE marker, on the stage name", () => {
  it("a cited stage with THREE questions renders one marker, not three", async () => {
    const el = await render(baseProps({ pack: stagesPack({ support: cite(CLAIM_A) }) }));
    const found = sectionMarkers(el, "stages");
    expect(found, "AC-N43.3: a per-question marker fabricates precision the schema does not have").toHaveLength(1);
    expect(markerNumber(found[0])).toBe(1);

    // The forward guard, stated as its own assertion so the failure message
    // names the wrong build: no question <li> may contain a marker. This is
    // what catches an implementer who copies askThem's correct per-entry
    // pattern onto `stage.questions[]`, where the schema has one shared
    // support and three independent markers would be a fabrication.
    const questionItems = stageQuestionItems(el);
    expect(questionItems.length, "the three stage questions must still render").toBe(3);
    expect(questionItems.map((li) => markers(li).length)).toEqual([0, 0, 0]);
  });

  it("the marker is attached to the stage NAME -- not to a question, and not to the recommended answer", async () => {
    const el = await render(baseProps({ pack: stagesPack({ support: cite(CLAIM_A) }) }));
    const marker = sectionMarkers(el, "stages")[0];
    expect(marker, "no stage marker rendered").toBeTruthy();

    // An ancestor whose ENTIRE visible text is the stage name plus the
    // marker's own digit can contain neither a question nor the answer.
    const owner = ancestorWhoseTextIs(marker, `${STAGE_NAME}${markerNumber(marker)}`);
    expect(owner, `the marker must sit in a box whose only other content is "${STAGE_NAME}"`).not.toBe(null);
    expect(norm(visibleText(owner))).not.toContain(STAGE_QUESTIONS[0]);
    expect(norm(visibleText(owner))).not.toContain(STAGE_ANSWER);

    // And the recommended answer, which N48 renders, carries no marker of
    // its own even though the stage's support nominally covers it.
    const stageScope = sectionRoot(el, "stages");
    const answerHost = [...stageScope.querySelectorAll("*")].filter(
      (node) => norm(visibleText(node)) === norm(STAGE_ANSWER)
    );
    expect(answerHost.length, "N48: the recommended answer must render").toBeGreaterThan(0);
    for (const node of answerHost) expect(markers(node)).toHaveLength(0);
  });

  it("an uncited stage renders zero markers while a cited stage in the same pack renders one", async () => {
    const el = await render(
      baseProps({
        pack: pack({
          claims: [CLAIM_A],
          stages: [
            stage({ name: STAGE_NAME, questions: STAGE_QUESTIONS, support: cite(CLAIM_A) }),
            stage({ name: "Panel interview", questions: ["Tell us about a disagreement with a peer."], support: null }),
          ],
        }),
      })
    );
    const found = sectionMarkers(el, "stages");
    expect(found, "exactly one of the two stages is cited").toHaveLength(1);
    const owner = ancestorWhoseTextIs(found[0], `${STAGE_NAME}${markerNumber(found[0])}`);
    expect(owner, "and it is the cited one").not.toBe(null);
    expect(norm(visibleText(el))).toContain("Panel interview");
  });

  it("the stages section's own source list carries one entry for the stage's claim", async () => {
    const el = await render(baseProps({ pack: stagesPack({ support: cite(CLAIM_A) }) }));
    const list = sourceListFor(el, "stages");
    expect(list, "AC-N43.3: a cited stage must be traceable to its source").toBeTruthy();
    const items = [...list.children].filter((child) => child.tagName.toLowerCase() === "li");
    expect(items).toHaveLength(1);
    expect(norm(visibleText(items[0]))).toContain(CLAIM_A.text);
    expect(items[0].querySelector("a[href]")?.getAttribute("href")).toBe(CLAIM_A.sourceUrl);
  });
});

// ---------------------------------------------------------------------------
// The explicit-margin class guard (design ss8; the `070e1ec` discipline)
// ---------------------------------------------------------------------------

describe("N43/N48 explicit margins: every block element this chunk adds states its own vertical margin", () => {
  it("holds over a pack that renders every new element at once", async () => {
    const el = await render(
      baseProps({
        pack: pack({
          claims: [CLAIM_A, CLAIM_B],
          aboutYou: [{ ...BODY.aboutYou[0], support: cite(CLAIM_A) }],
          whyRole: BODY.whyRole,
          askThem: [{ ...BODY.askThem[0], support: cite(CLAIM_B) }],
          stages: [
            stage({
              name: STAGE_NAME,
              questions: STAGE_QUESTIONS,
              recommendedAnswer: STAGE_ANSWER,
              support: cite(CLAIM_A),
            }),
          ],
        }),
      })
    );
    // UNDER-FIRE CONTROL, and what makes this case RED on HEAD rather than
    // vacuously green: the guard is worthless unless the new elements are
    // actually on screen, so their presence is asserted first.
    expect(sourceListFor(el, "aboutYou"), "the new <ol> must exist for the guard to bite").toBeTruthy();
    expect(sourceHeadingFor(el, "askThem"), "the new <h4> must exist for the guard to bite").toBeTruthy();
    expect(norm(visibleText(el)), "N48's answer block must exist too").toContain(STAGE_ANSWER);

    const unpinned = unpinnedVerticalMargins(el);
    expect(
      unpinned,
      `elements handing their spacing to the browser: ${JSON.stringify(unpinned)}`
    ).toEqual([]);

    // WHAT THIS GUARD CANNOT CATCH, stated in the test itself: it proves a
    // margin was DECLARED, never that the declared value is RIGHT. A build
    // that writes `mb: 5` on the source list passes here and looks wrong on
    // screen. That is why the per-element expectations in the design's ss8
    // table remain a review item, not a substitute for this guard.
  });

  it("also holds in the arrived-but-not-placed state, whose disclosure is a new block of its own", async () => {
    const el = await render(baseProps({ pack: bodyWith({ claims: [CLAIM_A, CLAIM_B] }) }));
    const nothing = await renderAside(baseProps({ pack: bodyWith({ claims: [] }) }));
    expect(norm(visibleText(el)), "the disclosure must be present for this case to mean anything").not.toBe(
      nothing.text
    );
    expect(unpinnedVerticalMargins(el)).toEqual([]);
  });
});
