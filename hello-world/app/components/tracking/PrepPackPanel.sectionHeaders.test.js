// @vitest-environment jsdom
//
// TDD RED hand-off -- N44: the prep-pack modal shows PRESET section headers
// ALWAYS, so all four sections appear even when they have nothing in them.
// Binds to <scratchpad>/chunks/N44/ac.r1.md (AC-N44.1..10) and is specified
// by <scratchpad>/chunks/N44/design-experience.r1.md.
//
// SEPARATE FILE, deliberately. `PrepPackPanel.test.js` (335 lines) owns
// AC-N33's read-surface behaviour and `PrepPackPanel.generate.test.js` (230
// lines) owns N29's Generate control; this file owns N44's always-present
// headers and their empty state. Nothing in either sibling file is edited by
// this round -- verified by reading every assertion in both.
//
// WHY EACH BLOCK BELOW IS RED ON HEAD (two independent gates, per
// ac.r1.md ss0 -- a fix that closes only one leaves the other state category
// broken):
//   * `absent` (pack === null): the OUTER gate, `{hasPack ? <PackSections/>
//     : null}` (PrepPackPanel.js:384, `hasPack = !!pack` at :377), never
//     invokes PackSections at all. Zero headings.
//   * `running`/`ready`(empty)/`partial`(empty)/`failed`/`unavailable` (pack
//     is the normalized all-empty object a real GET returns): `hasPack` is
//     true and PackSections runs, but each of AnswerSection/AskThemSection/
//     StagesSection returns null at its own length check (:121, :135, :151)
//     BEFORE emitting a heading. Zero headings.
// Every case below asserts the heading population FIRST, so no case can pass
// vacuously by finding zero sections and then looping over nothing.
//
// IDIOM: createRoot + act + direct DOM reads, per this component's own two
// existing test files (no @testing-library in this repo -- see
// PrepPackPanel.test.js:33-38 for why). `SECTION_LABELS` is module-private in
// PrepPackPanel.js (:81-86); its four strings are restated as literals below
// rather than exported for a test, because adding an export purely so a test
// can reach something is forbidden and would move
// lib/sourceScan/exportReachability.sweep.test.js. Restating them also pins
// the exact copy, which an import would not.
//
// WHAT THIS FILE CANNOT ASSERT, stated rather than faked:
//   * Rendered height / line wrap. jsdom has no faithful layout, so
//     AC-N44.10 is checked structurally (no button, link, image, input, or
//     44px touch-target floor inside an empty section; short text), exactly
//     as that criterion itself specifies -- never as a pixel measurement.
//   * Whether a screen reader actually announces an empty `<ul>` as "list, 0
//     items". What is asserted is the DOM precondition for that announcement
//     (no list element, empty or otherwise, and no childless element inside
//     an empty section body).
//   * Colour contrast of the empty-state text. No instrument here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import Box from "@mui/material/Box";

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

/** Renders an arbitrary local element tree into the same harness. Used ONLY
 *  by the instrument-canary block below, never to stand in for the component
 *  under test. */
async function renderFixture(element) {
  await act(async () => {
    root.render(element);
  });
  return container;
}

// PrepPackPanel.js:81-86, verbatim, in the file's own key order -- which is
// also `prepPack.js:34`'s SECTION_NAMES order and the only order
// `route.js:647`'s `Array.from(completeSections(pack))` can ever emit.
const SECTION_NAMES = ["aboutYou", "whyRole", "askThem", "stages"];
const SECTION_LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};
const LABELS_IN_ORDER = SECTION_NAMES.map((n) => SECTION_LABELS[n]);

// The shape `readPrepPack` returns for every state except `absent`: the claim
// row's `pack` defaults to `'{}'::jsonb`, and `normalizePack({}, ...)` turns
// that into a truthy object with four empty sections (ac.r1.md ss0). This is
// why `hasPack` is already true for five of the six states, and why the inner
// length checks -- not the outer gate -- are what hide the headers there.
function emptyNormalizedPack() {
  return {
    version: undefined,
    sections: {
      aboutYou: { answer: { lines: [] } },
      whyRole: { answer: { lines: [] } },
      askThem: { questions: [] },
      stages: { stages: [] },
    },
    claims: [],
  };
}

const READY_PACK = {
  version: 1,
  sections: {
    aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches." }] } },
    whyRole: { answer: { lines: [{ text: "This role matches my background." }] } },
    askThem: { questions: [{ text: "How is this team's work measured?" }] },
    stages: {
      stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }],
    },
  },
  claims: [],
};

function baseProps(overrides = {}) {
  return {
    applicationId: "app-1",
    pack: null,
    status: null,
    completeSections: [],
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

// The six states ac.r1.md names, each paired with the `status` value the GET
// route actually sends. `absent` is the only one whose real `pack` is null.
const STATES = [
  { state: "absent", status: null },
  { state: "running", status: "running" },
  { state: "ready", status: "ready" },
  { state: "partial", status: "partial" },
  { state: "failed", status: "failed" },
  { state: "unavailable", status: "unavailable" },
];

// ---------------------------------------------------------------------------
// Instruments. Each one is canaried in the first describe block below against
// a local fixture with a KNOWN answer, because a resolver that silently
// returns "" or [] would make every assertion in this file pass for the wrong
// reason.
// ---------------------------------------------------------------------------

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

/** Visible text of a subtree, with `aria-hidden="true"`, `display:none` and
 *  `visibility:hidden` subtrees excluded -- the parts of the accessible-name
 *  computation that can actually differ in jsdom. */
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

/** The element's ACCESSIBLE NAME, not its `textContent`: `aria-labelledby`
 *  wins over `aria-label`, which wins over visible content. This is the
 *  assertion shape ac.r1.md ss7 flags as new to this repo -- nothing here
 *  currently computes an accessible name, and a bare
 *  `querySelectorAll("h3").length` would pass for a heading that had been
 *  relabelled, aria-hidden, or decorated with a "(2 items)" suffix. */
function accessibleName(el) {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby && labelledby.trim()) {
    return labelledby
      .trim()
      .split(/\s+/)
      .map((id) => {
        const target = el.ownerDocument.getElementById(id);
        return target ? visibleText(target) : "";
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label != null && label.trim()) return label.trim();
  return visibleText(el).replace(/\s+/g, " ").trim();
}

/** Every element that EXPOSES THE HEADING ROLE, by native tag or by an
 *  explicit `role="heading"` -- and excluding an `h3` whose `role` has been
 *  overridden to something else, or that sits behind `aria-hidden`, neither
 *  of which a tag-name count would notice. Returned in DOM order. */
function headingElements(el) {
  return [...el.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter((node) => {
    if (node.getAttribute("aria-hidden") === "true") return false;
    const role = (node.getAttribute("role") || "").trim();
    if (role) return role.split(/\s+/)[0] === "heading";
    return HEADING_TAGS.includes(node.tagName.toLowerCase());
  });
}

/** `aria-level` if present, else the native level, else ARIA's own default of
 *  2 for a `role="heading"` with no level. */
function headingLevel(node) {
  const explicit = (node.getAttribute("aria-level") || "").trim();
  if (/^[1-9]\d*$/.test(explicit)) return Number(explicit);
  const match = /^h([1-6])$/.exec(node.tagName.toLowerCase());
  if (match) return Number(match[1]);
  return 2;
}

/** The section wrapper a heading belongs to, and the body nodes beneath it.
 *  Structural assumption, stated because it is one: `Section`
 *  (PrepPackPanel.js:108-117) puts the heading and the section body as
 *  siblings inside one wrapper `Box`. If a build changes that nesting, these
 *  helpers return the wrong body and the assertions fail LOUDLY rather than
 *  silently passing. */
function sectionWrapper(headingEl) {
  return headingEl.parentElement;
}
function sectionBodyNodes(headingEl) {
  return [...sectionWrapper(headingEl).children].filter((child) => child !== headingEl);
}
function sectionBodyText(headingEl) {
  return sectionBodyNodes(headingEl)
    .map((node) => node.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
function sectionBodyElements(headingEl) {
  const out = [];
  for (const node of sectionBodyNodes(headingEl)) {
    out.push(node, ...node.querySelectorAll("*"));
  }
  return out;
}

/** Map of accessible name -> heading element, for the four labels. */
function headingByLabel(el) {
  const map = new Map();
  for (const node of headingElements(el)) map.set(accessibleName(node), node);
  return map;
}

// --- AC-N44.9's instrument -------------------------------------------------
// Tags whose USER-AGENT default vertical margin is non-zero, so leaving the
// margin unstated hands the spacing to the browser. This is the exact defect
// class `070e1ec` fixed in lib/document/docxPreview.js days before this item
// (an unstyled list inheriting `margin: 1em 0`), generalized here per the
// standing rule that followed it (`da05af1`).
//
// MEASURED, not assumed (probe run this round in an isolated copy of this
// tree): jsdom's `getComputedStyle` DOES apply emotion's injected `sx` rules
// -- `sx={{ mb: 2 }}` reads back `"16px"` -- but jsdom does NOT apply a
// user-agent default stylesheet, so an UNDECLARED margin reads back as `"0"`
// with no unit while a DECLARED one always carries a unit (`"0px"`, `"4px"`).
// That unit is the discriminator, and it is why this guard tests for the
// PRESENCE OF A DECLARATION rather than for the value `0`: in jsdom the
// inherited-1em defect is invisible as a computed value, exactly as it was
// invisible to the 14,330-test suite that shipped it.
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

function verticalMargins(node) {
  const style = node.ownerDocument.defaultView.getComputedStyle(node);
  return { marginTop: style.marginTop, marginBottom: style.marginBottom };
}
function isDeclaredLength(value) {
  return typeof value === "string" && DECLARED_LENGTH.test(value.trim());
}
/** Every element in `el` whose tag has a non-zero UA default vertical margin
 *  but which declares no explicit one. An empty array is the passing state. */
function unpinnedVerticalMargins(el) {
  return [...el.querySelectorAll(UA_MARGIN_SELECTOR)]
    .map((node) => ({ tag: node.tagName.toLowerCase(), text: (node.textContent || "").slice(0, 40), ...verticalMargins(node) }))
    .filter((row) => !isDeclaredLength(row.marginTop) || !isDeclaredLength(row.marginBottom));
}

// ---------------------------------------------------------------------------

describe("INSTRUMENT CANARIES -- these prove the helpers above discriminate; they are NOT N44 coverage and they pass on HEAD", () => {
  it("accessibleName prefers aria-labelledby, then aria-label, then visible content, and drops aria-hidden subtrees", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("span", { id: "lbl" }, "Named by reference"),
        createElement("h3", { "aria-labelledby": "lbl" }, "ignored content"),
        createElement("h3", { "aria-label": "Named by label" }, "also ignored"),
        createElement(
          "h3",
          null,
          "Visible ",
          createElement("span", { "aria-hidden": "true" }, "(hidden decoration)"),
          "name",
        ),
      ),
    );
    const names = headingElements(el).map(accessibleName);
    expect(names).toEqual(["Named by reference", "Named by label", "Visible name"]);
  });

  it("headingElements counts by ROLE, not by tag -- a role-overridden h3 is excluded, a div[role=heading] is included, an aria-hidden h3 is excluded", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("h3", null, "real heading"),
        createElement("h3", { role: "presentation" }, "not a heading any more"),
        createElement("h3", { "aria-hidden": "true" }, "hidden from the outline"),
        createElement("div", { role: "heading", "aria-level": "4" }, "aria heading"),
      ),
    );
    const found = headingElements(el);
    expect(found.map(accessibleName)).toEqual(["real heading", "aria heading"]);
    expect(found.map(headingLevel)).toEqual([3, 4]);
  });

  it("the margin guard fires on an element that states no vertical margin, and stays silent on one that states it -- measured against a local fixture, not against the component", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement(Box, { component: "p", sx: { m: 0 } }, "pinned"),
        createElement(Box, { component: "p", sx: { mb: 1 } }, "bottom only, top left to the browser"),
        createElement(Box, { component: "p" }, "nothing stated at all"),
        createElement(Box, { sx: {} }, "a div is not in the guarded class"),
      ),
    );
    const flagged = unpinnedVerticalMargins(el).map((row) => row.text);
    expect(flagged).toEqual(["bottom only, top left to the browser", "nothing stated at all"]);
    // And the discriminator itself, stated outright so a future jsdom upgrade
    // that starts applying a UA stylesheet breaks HERE rather than silently
    // turning the guard into a no-op.
    const paragraphs = [...el.querySelectorAll("p")];
    expect(verticalMargins(paragraphs[0]).marginTop).toBe("0px");
    expect(isDeclaredLength(verticalMargins(paragraphs[2]).marginTop)).toBe(false);
  });
});

describe("AC-N44.1 -- all four section headings render in every state, for BOTH pack shapes a real GET can deliver", () => {
  for (const { state, status } of STATES) {
    it(`[${state} / pack=null -- the OUTER hasPack gate at PrepPackPanel.js:377,384] renders all four headings in fixed order`, async () => {
      const el = await render(baseProps({ pack: null, status, completeSections: [] }));
      expect(headingElements(el).map(accessibleName)).toEqual(LABELS_IN_ORDER);
    });

    it(`[${state} / pack=normalized-empty -- the INNER per-section length gates at :121,:135,:151] renders all four headings in fixed order`, async () => {
      const el = await render(baseProps({ pack: emptyNormalizedPack(), status, completeSections: [] }));
      expect(headingElements(el).map(accessibleName)).toEqual(LABELS_IN_ORDER);
    });
  }

  it("[the discriminating case the AC excludes from the fixture set, kept here as a CONTROL] a full ready pack already shows four headings today -- so a build that merely followed content would pass THIS and fail every case above", async () => {
    const el = await render(
      baseProps({ pack: READY_PACK, status: "ready", completeSections: [...SECTION_NAMES] }),
    );
    expect(headingElements(el).map(accessibleName)).toEqual(LABELS_IN_ORDER);
    // The control's point: this one is GREEN on HEAD. If it were ever red at
    // the same time as the cases above, the failure is a fixture defect, not
    // the N44 gap.
  });
});

describe("AC-N44.2 -- heading order is the fixed schema order, never completeSections' own array order", () => {
  // DISCLOSURE: the ORDERING half of this criterion is not independently red
  // on HEAD -- PackSections (:178-188) already checks the four names in fixed
  // source order and never iterates `completeSections`. It is red here only
  // because four headings do not exist yet. Its real job is as a
  // NON-REGRESSION guard against a `completeSections.map(renderSection)`
  // rewrite, which is a plausible way to make AC-N44.1 pass.
  it("a scrambled completeSections (stages first, whyRole and askThem absent) still yields aboutYou, whyRole, askThem, stages in DOM order", async () => {
    const el = await render(
      baseProps({ pack: READY_PACK, status: "partial", completeSections: ["stages", "aboutYou"] }),
    );
    expect(headingElements(el).map(accessibleName)).toEqual(LABELS_IN_ORDER);
  });

  it("the two sections that DO have content still render it, in their canonical slots -- so the order above is not achieved by dropping content", async () => {
    const el = await render(
      baseProps({ pack: READY_PACK, status: "partial", completeSections: ["stages", "aboutYou"] }),
    );
    const byLabel = headingByLabel(el);
    expect(sectionBodyText(byLabel.get(SECTION_LABELS.aboutYou))).toContain("I led three cross-functional launches.");
    expect(sectionBodyText(byLabel.get(SECTION_LABELS.stages))).toContain("Tell me about yourself.");
  });
});

describe("AC-N44.3 -- THE criterion: the heading appears, the withheld content does not, and the empty branch structurally CANNOT see it", () => {
  // The fixture here is the REAL, already-reachable divergence ac.r1.md ss0
  // found, not a synthetic prop: `normalizeStage` (prepParse.js, documented at
  // prepPack.js:44-53) deliberately KEEPS a stage entry whose name and
  // recommendedAnswer were nulled and whose questions[] was emptied, so
  // `pack.sections.stages.stages` is a length-1 array; meanwhile
  // `stageHasUsableContent`/`sectionIsNonEmpty` (prepPack.js:55-61, :70-76)
  // exclude "stages" from `completeSections`. StagesSection's own check
  // (:151) only tests `stages.length === 0`, so it WOULD render this entry --
  // and emit `<ul>` with zero `<li>` children (:157-165) -- if anything ever
  // reached it.
  function contentlessStagesPack() {
    return {
      version: 1,
      sections: {
        aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches." }] } },
        whyRole: { answer: { lines: [] } },
        askThem: { questions: [] },
        stages: { stages: [{ name: null, questions: [], recommendedAnswer: null, support: null }] },
      },
      claims: [],
    };
  }

  it("[reachable stages case] the 'Interview stages' heading renders, and no list markup is emitted anywhere in the panel", async () => {
    const el = await render(
      baseProps({ pack: contentlessStagesPack(), status: "partial", completeSections: ["aboutYou"] }),
    );
    // Heading half -- RED today: the excluded section renders nothing at all.
    const byLabel = headingByLabel(el);
    expect(headingElements(el)).toHaveLength(4);
    expect(byLabel.has(SECTION_LABELS.stages)).toBe(true);
    // Structure half -- GREEN today and it must STAY green. A build that made
    // the heading appear by deleting PackSections' `complete.has()` gate would
    // flip this half red while turning the half above green.
    expect(el.querySelectorAll("ul")).toHaveLength(0);
    expect(el.querySelectorAll("ol")).toHaveLength(0);
    expect(el.querySelectorAll("li")).toHaveLength(0);
    expect(el.querySelectorAll('[role="list"],[role="listitem"]')).toHaveLength(0);
  });

  it("[adversarial: the same stage carries real question text while completeSections deliberately still excludes it] the heading renders and the text appears nowhere", async () => {
    const pack = contentlessStagesPack();
    pack.sections.stages.stages[0].questions = ["UNIQUE_CANARY_STRING_314"];
    pack.sections.stages.stages[0].name = "UNIQUE_CANARY_STAGE_NAME_314";
    const el = await render(baseProps({ pack, status: "partial", completeSections: ["aboutYou"] }));
    expect(headingElements(el).map(accessibleName)).toEqual(LABELS_IN_ORDER);
    expect(el.textContent).not.toContain("UNIQUE_CANARY_STRING_314");
    expect(el.textContent).not.toContain("UNIQUE_CANARY_STAGE_NAME_314");
    expect(el.querySelectorAll("ul,ol,li")).toHaveLength(0);
    // CANARY on this instrument: the same string IS found when the section is
    // included, so `not.toContain` is not passing because the fixture never
    // carried the string in the first place.
    const included = await render(baseProps({ pack, status: "partial", completeSections: ["aboutYou", "stages"] }));
    expect(included.textContent).toContain("UNIQUE_CANARY_STRING_314");
  });

  it("[synthetic companion, whyRole] an excluded answer section with real lines renders its heading and leaks none of its text", async () => {
    const pack = {
      version: 1,
      sections: {
        aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches." }] } },
        whyRole: { answer: { lines: [{ text: "UNIQUE_CANARY_WHYROLE_772" }] } },
        askThem: { questions: [{ text: "UNIQUE_CANARY_ASKTHEM_772" }] },
        stages: { stages: [] },
      },
      claims: [],
    };
    const el = await render(baseProps({ pack, status: "partial", completeSections: ["aboutYou"] }));
    expect(headingElements(el).map(accessibleName)).toEqual(LABELS_IN_ORDER);
    expect(el.textContent).not.toContain("UNIQUE_CANARY_WHYROLE_772");
    expect(el.textContent).not.toContain("UNIQUE_CANARY_ASKTHEM_772");
  });

  it("[the property that makes a leak IMPOSSIBLE, not merely absent] an excluded section's rendered output is byte-identical for two wildly different pack contents", async () => {
    // design-experience.r1.md ss2.3 makes this structural: `EmptySection`
    // takes only `name`, never `pack`, so the empty branch has no binding it
    // could read content from. That claim is not checkable from a string
    // search; it IS checkable as an INVARIANCE property -- vary everything the
    // excluded sections carry, hold `completeSections` fixed, and the DOM must
    // not move by a single byte. This catches a leak of a COUNT, a LENGTH, a
    // truncated preview or any other derived hint, none of which a
    // `not.toContain` on one canary string would catch.
    const thin = {
      version: 1,
      sections: {
        aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches." }] } },
        whyRole: { answer: { lines: [] } },
        askThem: { questions: [] },
        stages: { stages: [{ name: null, questions: [], recommendedAnswer: null, support: null }] },
      },
      claims: [],
    };
    const fat = {
      version: 1,
      sections: {
        aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches." }] } },
        whyRole: { answer: { lines: [{ text: "AAA" }, { text: "BBB" }, { text: "CCC" }] } },
        askThem: { questions: [{ text: "Q1" }, { text: "Q2" }, { text: "Q3" }, { text: "Q4" }] },
        stages: {
          stages: [
            { name: "Screen", questions: ["s1", "s2"], recommendedAnswer: "long answer", support: null },
            { name: "Onsite", questions: ["s3"], recommendedAnswer: "another", support: null },
          ],
        },
      },
      claims: [{ id: "c1", text: "a claim" }],
    };
    const props = { status: "partial", completeSections: ["aboutYou"] };
    const thinHtml = (await render(baseProps({ ...props, pack: thin }))).innerHTML;
    const fatHtml = (await render(baseProps({ ...props, pack: fat }))).innerHTML;
    // Red half: four headings must exist at all. Without this the invariance
    // assertion below would pass vacuously on HEAD, where BOTH renders show
    // zero excluded sections and are therefore trivially identical.
    expect(headingElements(container).map(accessibleName)).toEqual(LABELS_IN_ORDER);
    expect(thinHtml).toBe(fatHtml);
  });

  it("[CONTROL for the invariance test above -- passes on HEAD, and proves the comparison can fire] the SAME two packs render DIFFERENTLY once the sections are included", async () => {
    const thin = {
      version: 1,
      sections: {
        aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches." }] } },
        whyRole: { answer: { lines: [{ text: "one line" }] } },
        askThem: { questions: [{ text: "one question" }] },
        stages: { stages: [{ name: "Screen", questions: ["s1"], recommendedAnswer: "a", support: null }] },
      },
      claims: [],
    };
    const fat = JSON.parse(JSON.stringify(thin));
    fat.sections.whyRole.answer.lines = [{ text: "AAA" }, { text: "BBB" }, { text: "CCC" }];
    fat.sections.askThem.questions = [{ text: "Q1" }, { text: "Q2" }];
    fat.sections.stages.stages.push({ name: "Onsite", questions: ["s3"], recommendedAnswer: "b", support: null });
    const props = { status: "ready", completeSections: [...SECTION_NAMES] };
    const thinHtml = (await render(baseProps({ ...props, pack: thin }))).innerHTML;
    const fatHtml = (await render(baseProps({ ...props, pack: fat }))).innerHTML;
    expect(thinHtml).not.toBe(fatHtml);
  });
});

describe("AC-N44.7 -- the heading outline: exactly four, one level, exact accessible names, stable across states", () => {
  it("every state exposes exactly four heading-role elements at one consistent level", async () => {
    const levelsByState = new Map();
    for (const { state, status } of STATES) {
      const pack = state === "ready" ? READY_PACK : emptyNormalizedPack();
      const completeSections = state === "ready" ? [...SECTION_NAMES] : [];
      const el = await render(baseProps({ pack, status, completeSections }));
      const headings = headingElements(el);
      expect(headings, `state ${state} did not expose four headings`).toHaveLength(4);
      const levels = new Set(headings.map(headingLevel));
      expect(levels.size, `state ${state} mixed heading levels: ${[...levels]}`).toBe(1);
      levelsByState.set(state, [...levels][0]);
    }
    // The same level in EVERY state, not merely a consistent level within each
    // one -- the outline must not re-nest itself between two fetches.
    expect(new Set(levelsByState.values()).size, `levels differed by state: ${JSON.stringify([...levelsByState])}`).toBe(1);
  });

  it("each heading's ACCESSIBLE NAME equals its SECTION_LABELS string exactly, with no status decoration folded in, in every state", async () => {
    for (const { state, status } of STATES) {
      for (const pack of [null, emptyNormalizedPack()]) {
        const el = await render(baseProps({ pack, status, completeSections: [] }));
        expect(headingElements(el).map(accessibleName), `state ${state}, pack ${pack ? "empty-object" : "null"}`).toEqual(
          LABELS_IN_ORDER,
        );
      }
    }
  });

  it("a populated section and an empty section expose the SAME heading name and level for the same section -- one heading implementation, not two", async () => {
    const populated = await render(
      baseProps({ pack: READY_PACK, status: "ready", completeSections: [...SECTION_NAMES] }),
    );
    const populatedRows = headingElements(populated).map((node) => [accessibleName(node), headingLevel(node), node.tagName.toLowerCase()]);
    const empty = await render(baseProps({ pack: emptyNormalizedPack(), status: "failed", completeSections: [] }));
    const emptyRows = headingElements(empty).map((node) => [accessibleName(node), headingLevel(node), node.tagName.toLowerCase()]);
    expect(emptyRows).toEqual(populatedRows);
  });
});

describe("AC-N44.8 -- an empty section announces nothing it does not have", () => {
  it("no empty section body contains a list element, a list role, or a childless element with no text", async () => {
    const el = await render(baseProps({ pack: emptyNormalizedPack(), status: "failed", completeSections: [] }));
    const headings = headingElements(el);
    expect(headings, "no headings rendered, so this case would otherwise pass vacuously").toHaveLength(4);
    for (const heading of headings) {
      const label = accessibleName(heading);
      const elements = sectionBodyElements(heading);
      expect(elements.length, `the "${label}" empty section rendered no body at all`).toBeGreaterThan(0);
      for (const node of elements) {
        const tag = node.tagName.toLowerCase();
        expect(["ul", "ol", "li", "dl", "dd", "dt", "table", "tr", "td"], `"${label}" emitted <${tag}>`).not.toContain(tag);
        const role = (node.getAttribute("role") || "").trim();
        expect(["list", "listitem", "grid", "table", "group"], `"${label}" emitted role=${role}`).not.toContain(role);
        // A rendered-but-empty box (the stage-name `Box` case ac.r1.md names)
        // is a structural artifact even when it shows no text.
        expect((node.textContent || "").trim().length, `"${label}" emitted an empty <${tag}>`).toBeGreaterThan(0);
      }
    }
  });

  it("the reachable contentless-stage pack emits no list structure either -- the exact :157-165 map the AC located", async () => {
    // `aboutYou` carries real lines here, so `completeSections` naming it is
    // not self-contradictory. A fixture that listed a section as complete
    // while leaving its array empty would manufacture the "included + empty"
    // contradiction design-experience.r1.md ss2.4 flags as unreachable today,
    // and would fail for a reason that has nothing to do with this criterion.
    const pack = emptyNormalizedPack();
    pack.sections.aboutYou.answer.lines = [{ text: "I led three cross-functional launches." }];
    pack.sections.stages.stages = [{ name: null, questions: [], recommendedAnswer: null, support: null }];
    const el = await render(baseProps({ pack, status: "partial", completeSections: ["aboutYou"] }));
    expect(headingElements(el)).toHaveLength(4);
    expect(el.querySelectorAll("ul,ol,li")).toHaveLength(0);
  });
});

describe("AC-N44.4 / AC-N44.5 -- the empty state says something true and claims no cause the app cannot know", () => {
  // Pinned by MEANING, never by string equality: an exact-prose assertion on
  // copy is brittle and near-zero-power (it cannot tell a correct rewording
  // from a dishonest one). What is pinned is (a) something is said, (b) it is
  // not a cause the app has no way to know, and (c) it is the SAME thing in
  // every state, which is what makes it honest rather than inferred.
  const BANNED_CAUSE_WORDS = [
    "refused",
    "refusal",
    "gutted",
    "removed",
    "deleted",
    "blocked",
    "detected",
    "flagged",
    "censored",
    "filtered",
    "rejected",
    "error",
  ];
  // Distinctions N45's revisions table would be needed for and that no column
  // in this checkout carries (ac.r1.md ss AC-N44.5: 0 migrations define
  // `interview_prep_section_revisions`/`live_revisions`).
  const UNKNOWABLE_CLAIMS =
    /never (been )?(generated|created|attempted|run)|came back empty|was (generated|restored)|restored from|previous version|earlier version/;
  // A promise about a future attempt would contradict COPY.unavailable's own
  // "trying again won't help until a description is added" (:71-72) in the one
  // state where all four sections would carry the promise at once.
  const FORWARD_PROMISE =
    /will (appear|be added|show|fill|arrive|come)|check back|coming soon|once (you|the|a|it)|after (you|the) (regenerat|generat)|next time/;

  it("every empty section renders non-empty text that is not merely an echo of its own heading", async () => {
    const el = await render(baseProps({ pack: emptyNormalizedPack(), status: "running", completeSections: [] }));
    const headings = headingElements(el);
    expect(headings).toHaveLength(4);
    for (const heading of headings) {
      const label = accessibleName(heading);
      const body = sectionBodyText(heading);
      expect(body.length, `the "${label}" section rendered a heading over nothing`).toBeGreaterThan(3);
      expect(body, `the "${label}" section body merely repeats its heading`).not.toBe(label);
    }
  });

  it("no empty section's text names a cause, distinguishes never-generated from came-back-empty from restored, or promises a future attempt", async () => {
    const el = await render(baseProps({ pack: emptyNormalizedPack(), status: "partial", completeSections: [] }));
    const headings = headingElements(el);
    expect(headings).toHaveLength(4);
    for (const heading of headings) {
      const label = accessibleName(heading);
      const body = sectionBodyText(heading).toLowerCase();
      for (const word of BANNED_CAUSE_WORDS) {
        expect(body, `the "${label}" empty state claims a cause: "${word}"`).not.toContain(word);
      }
      expect(body, `the "${label}" empty state claims a history this schema cannot store`).not.toMatch(UNKNOWABLE_CLAIMS);
      expect(body, `the "${label}" empty state promises a future attempt`).not.toMatch(FORWARD_PROMISE);
    }
    // CANARY on the three matchers, so a regex typo cannot make this pass by
    // matching nothing: each one fires against a string that should trip it.
    expect("this section was refused by the model".includes("refused")).toBe(true);
    expect("this was restored from an earlier version").toMatch(UNKNOWABLE_CLAIMS);
    expect("this will appear after the next run").toMatch(FORWARD_PROMISE);
  });

  it("an empty section's text is IDENTICAL across all six states -- it is keyed by section, never by status, so it cannot be read as a cause", async () => {
    const perState = new Map();
    for (const { state, status } of STATES) {
      const el = await render(baseProps({ pack: emptyNormalizedPack(), status, completeSections: [] }));
      const headings = headingElements(el);
      expect(headings, `state ${state} did not render four headings`).toHaveLength(4);
      perState.set(state, headings.map((h) => `${accessibleName(h)}=${sectionBodyText(h)}`).join(" | "));
    }
    const distinct = new Set(perState.values());
    expect(distinct.size, `the empty-state copy varied by status: ${JSON.stringify([...perState])}`).toBe(1);
  });

  it("the same section's empty text is identical whether it is empty alongside content (partial) or alone (failed)", async () => {
    const partial = await render(
      baseProps({ pack: READY_PACK, status: "partial", completeSections: ["aboutYou", "stages"] }),
    );
    const partialWhyRole = sectionBodyText(headingByLabel(partial).get(SECTION_LABELS.whyRole) || document.createElement("div"));
    const failed = await render(baseProps({ pack: emptyNormalizedPack(), status: "failed", completeSections: [] }));
    const failedWhyRole = sectionBodyText(headingByLabel(failed).get(SECTION_LABELS.whyRole) || document.createElement("div"));
    expect(partialWhyRole.length, "no 'Why this role' heading rendered for the partial pack").toBeGreaterThan(3);
    expect(failedWhyRole).toBe(partialWhyRole);
  });
});

describe("AC-N44.6 -- a legacy (pre-N16) pack shows three empty headers as the CORRECT outcome, never a legacy-specific message", () => {
  // The fixture the landed AC-N33.15 test already uses
  // (PrepPackPanel.test.js:186-194), unchanged. Three empty headers here is
  // the honest result the backlog entry names explicitly -- these cases exist
  // so a later round does not "fix" the asymmetry by adding legacy detection
  // that reads the orphaned top-level keys PrepPackPanel.js:20-25 forbids.
  function legacyPack() {
    return {
      tellMeAboutYourself: "orphaned, never rendered",
      whyThisPosition: "also orphaned",
      questionsToAsk: ["orphaned question"],
      sections: {
        stages: {
          stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }],
        },
      },
    };
  }

  it("shows all four headings, the recovered stages content, and none of the orphaned top-level keys", async () => {
    const el = await render(baseProps({ pack: legacyPack(), status: "partial", completeSections: ["stages"] }));
    expect(headingElements(el).map(accessibleName)).toEqual(LABELS_IN_ORDER);
    expect(el.textContent).toContain("Tell me about yourself.");
    expect(el.textContent).not.toContain("orphaned, never rendered");
    expect(el.textContent).not.toContain("also orphaned");
    expect(el.textContent).not.toContain("orphaned question");
  });

  it("the three unresolvable sections use the IDENTICAL generic text a non-legacy pack uses, and say nothing about age or format", async () => {
    const legacy = await render(baseProps({ pack: legacyPack(), status: "partial", completeSections: ["stages"] }));
    const legacyHeadings = headingByLabel(legacy);
    expect(legacyHeadings.size, "the legacy pack did not render four headings").toBe(4);
    const legacyTexts = ["aboutYou", "whyRole", "askThem"].map((name) =>
      sectionBodyText(legacyHeadings.get(SECTION_LABELS[name])),
    );
    for (const text of legacyTexts) {
      expect(text.toLowerCase()).not.toMatch(/legacy|older format|old format|can't be read|cannot be read|unsupported|outdated/);
    }

    // The non-legacy comparison pack: a modern-schema pack whose three
    // sections are empty for an ordinary reason. `completeSections` is left
    // empty rather than naming `stages`, because this fixture's `stages`
    // array is empty too and claiming it complete would be the same
    // self-contradictory shape noted in AC-N44.8's fixture above.
    const modern = await render(baseProps({ pack: emptyNormalizedPack(), status: "partial", completeSections: [] }));
    const modernHeadings = headingByLabel(modern);
    expect(modernHeadings.size, "the modern comparison pack did not render four headings").toBe(4);
    const modernTexts = ["aboutYou", "whyRole", "askThem"].map((name) =>
      sectionBodyText(modernHeadings.get(SECTION_LABELS[name])),
    );
    expect(legacyTexts).toEqual(modernTexts);
  });
});

describe("AC-N44.9 -- vertical spacing is stated by this component, never inherited from the browser", () => {
  // CLASS GUARD, per the rule landed in `070e1ec`/`da05af1`: the population is
  // every element the panel emits whose TAG has a non-zero user-agent default
  // vertical margin, not just the element N44 adds. On HEAD this already
  // includes the `<h3>` inside `Section` (:111), which states `mb: 0.5` and
  // leaves `margin-top` to the browser's `1em` -- the same defect shape
  // `070e1ec` fixed in a sibling file, and it becomes four times as visible
  // once these headings render in every state.
  //
  // WHAT THIS GUARD CANNOT CATCH: a WRONG value. It proves only that a
  // declaration exists, because jsdom applies no user-agent stylesheet and so
  // cannot show what an omitted declaration would resolve to in a real
  // browser. The specific values that matter are pinned separately below, and
  // the two instruments answer different questions.
  for (const { state, status } of STATES) {
    it(`[${state}] every element with a non-zero UA default vertical margin states both of its vertical margins`, async () => {
      const pack = state === "ready" ? READY_PACK : emptyNormalizedPack();
      const completeSections = state === "ready" ? [...SECTION_NAMES] : [];
      const el = await render(baseProps({ pack, status, completeSections }));
      expect(headingElements(el), `state ${state} rendered no headings, so this guard had nothing to check`).toHaveLength(4);
      expect(unpinnedVerticalMargins(el)).toEqual([]);
    });
  }

  it("[a fully populated pack, where lists and headings both render] the same guard holds", async () => {
    const el = await render(baseProps({ pack: READY_PACK, status: "ready", completeSections: [...SECTION_NAMES] }));
    expect(el.querySelectorAll("ul").length, "no list rendered, so the list half of this guard checked nothing").toBeGreaterThan(0);
    expect(unpinnedVerticalMargins(el)).toEqual([]);
  });

  it("the four headings share one explicit vertical rhythm, and the section wrapper's own gap is the value this file already uses", async () => {
    const el = await render(baseProps({ pack: emptyNormalizedPack(), status: "failed", completeSections: [] }));
    const headings = headingElements(el);
    expect(headings).toHaveLength(4);
    const rhythms = new Set(headings.map((h) => JSON.stringify(verticalMargins(h))));
    expect(rhythms.size, `the four headings did not share one vertical rhythm: ${[...rhythms]}`).toBe(1);
    // The numeric values chosen, pinned -- `Section`'s existing `mb: 0.5` on
    // the heading and `mb: 2` on the wrapper (PrepPackPanel.js:110-111), so an
    // always-present header cannot silently become tighter or looser than the
    // populated sections it sits beside.
    expect(verticalMargins(headings[0]).marginBottom).toBe("4px");
    expect(verticalMargins(sectionWrapper(headings[0])).marginBottom).toBe("16px");
  });

  it("every empty section's body element states both vertical margins explicitly", async () => {
    const el = await render(baseProps({ pack: emptyNormalizedPack(), status: "running", completeSections: [] }));
    const headings = headingElements(el);
    expect(headings).toHaveLength(4);
    for (const heading of headings) {
      const label = accessibleName(heading);
      for (const node of sectionBodyNodes(heading)) {
        const margins = verticalMargins(node);
        expect(isDeclaredLength(margins.marginTop), `"${label}" body <${node.tagName.toLowerCase()}> margin-top: ${margins.marginTop}`).toBe(true);
        expect(isDeclaredLength(margins.marginBottom), `"${label}" body <${node.tagName.toLowerCase()}> margin-bottom: ${margins.marginBottom}`).toBe(true);
      }
    }
  });
});

describe("AC-N44.10 -- three or four simultaneously empty sections stay cheap at phone width", () => {
  // STRUCTURAL, not pixel-based -- jsdom gives no faithful layout, and the
  // criterion itself specifies a structural check. What is asserted is that no
  // empty section adds an interactive control, an image, or a 44px
  // touch-target floor (TOUCH_TARGET_SX, mobileSx.js:42,47), and that its text
  // is a single short phrase rather than a paragraph.
  it("no empty section body contains a button, link, input, image or a 44px touch-target floor", async () => {
    const el = await render(baseProps({ pack: emptyNormalizedPack(), status: "unavailable", completeSections: [] }));
    const headings = headingElements(el);
    expect(headings).toHaveLength(4);
    for (const heading of headings) {
      const label = accessibleName(heading);
      const elements = sectionBodyElements(heading);
      for (const node of elements) {
        const tag = node.tagName.toLowerCase();
        expect(["button", "a", "input", "select", "textarea", "img", "svg"], `"${label}" added <${tag}>`).not.toContain(tag);
        const role = (node.getAttribute("role") || "").trim();
        expect(["button", "link", "menuitem"], `"${label}" added role=${role}`).not.toContain(role);
        const minHeight = node.ownerDocument.defaultView.getComputedStyle(node).minHeight;
        const px = /^(\d*\.?\d+)px$/.exec(minHeight || "");
        expect(px ? Number(px[1]) : 0, `"${label}" body carries a ${minHeight} touch-target floor`).toBeLessThan(44);
      }
    }
  });

  it("each empty section's text is a single short phrase, not a paragraph", async () => {
    const el = await render(baseProps({ pack: null, status: null, completeSections: [] }));
    const headings = headingElements(el);
    expect(headings).toHaveLength(4);
    for (const heading of headings) {
      const label = accessibleName(heading);
      const body = sectionBodyText(heading);
      expect(body.length, `the "${label}" empty state is ${body.length} characters, not a short phrase`).toBeLessThanOrEqual(140);
    }
  });
});
