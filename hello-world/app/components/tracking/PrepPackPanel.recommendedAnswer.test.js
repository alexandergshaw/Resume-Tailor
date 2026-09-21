// @vitest-environment jsdom
//
// TDD RED hand-off -- N48: the prep pack generates a `recommendedAnswer` for
// every interview stage and the panel never shows it.
//
// Binds to `docs/backlog.yml` id N48 and is specified by
// <scratchpad>/chunks/N43/design-experience.r1.md ss3 (always visible, in
// full, directly under the stage's question list -- no disclosure control, no
// truncation) and ss5 (reading order).
//
// ---------------------------------------------------------------------------
// WHY EVERY BLOCK BELOW IS RED ON HEAD
// ---------------------------------------------------------------------------
// `recommendedAnswer` returns ZERO occurrences in
// `app/components/tracking/PrepPackPanel.js` (canary `questions` -> 10 in the
// same file), while `lib/interviewPrep/prepParse.js` references it twelve
// times: the field is prompted for, returned, shape-validated by
// `normalizeStage`, persisted -- and then discarded at the one place a
// candidate would read it. `StagesSection` (:153-174) reads only `stage.name`
// and `stage.questions`. So every assertion below that the answer's text is
// on screen fails on HEAD because the string is nowhere in the DOM.
//
// The two cases that are ABSENCE assertions ("a stage with no answer renders
// no orphan label", "no disclosure control appears") are written as
// DIFFERENTIALS against a fixture that DOES have an answer, in the same test,
// so neither can pass on HEAD by finding nothing. Nothing in this file is
// vacuous.
//
// ---------------------------------------------------------------------------
// THIS IS THE SAME DEFECT CLASS THE CHUNK KEEPS SHIPPING
// ---------------------------------------------------------------------------
// The names form with no save wiring; the panel with no opening button; N44's
// permanently hidden section headers; and now a populated field with no
// renderer. Each time the mechanism was complete and correct and the LAST HOP
// TO A HUMAN was missing, and each time the suite was fully green. So every
// test below drives the rendered panel and reads what a person would see --
// none of them calls a helper, reads a prop, or asserts that a source file
// contains a string.
//
// ---------------------------------------------------------------------------
// WHAT CANNOT BE ASSERTED HERE, STATED RATHER THAN FAKED
// ---------------------------------------------------------------------------
//   * That the answer is typographically QUIETER than the question list
//     (design ss3's resolution of the wall-of-text risk is a font-size and
//     colour decision). jsdom applies emotion's sx rules, so a value could be
//     read back -- but "smaller than the questions" is a comparison of two
//     `fontSize` values whose units this component mixes, and asserting it
//     would pin a number design ss3 may still tune. It is a review item.
//   * Any rendered geometry, wrap point or overflow. jsdom has no layout and
//     `scrollWidth` is meaningless here, so "not truncated" is asserted as
//     the FULL STRING BEING PRESENT plus the absence of the CSS clamp
//     properties that would truncate it -- never as a measured height.
//   * Whether a screen reader reads the label and the answer as one unit.

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SECTION_LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};
const ALL_SECTIONS = ["aboutYou", "whyRole", "askThem", "stages"];

const STAGE_NAME = "Hiring manager screen";
const STAGE_QUESTIONS = [
  "Walk me through your last platform migration.",
  "How do you handle a release that has to be rolled back?",
];
const SHORT_ANSWER = "Lead with the twelve-service migration and name the rollback you owned.";

// Long-form model prose, the shape design ss3 argues about: several sentences
// well past any plausible truncation point. The LAST sentence is what a
// clamp would eat first, so it is checked on its own below.
const LONG_ANSWER = [
  "Start with the shape of the problem rather than the tooling: the platform served twelve services and three of them shared a database.",
  "Say what you owned personally, then what the team owned, so the interviewer can tell the two apart without asking.",
  "Name one decision you would make differently now, and say why, because a migration story with no regret in it reads as rehearsed.",
  "Close by connecting the work back to this posting's weekly release train, which is the reason the story is relevant at all.",
].join(" ");

const LAST_SENTENCE_OF_LONG_ANSWER =
  "Close by connecting the work back to this posting's weekly release train, which is the reason the story is relevant at all.";

function stage({ name, questions = [], recommendedAnswer = null, support = null }) {
  return { name, questions, recommendedAnswer, support };
}

function pack({ stages = [], claims = [] } = {}) {
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: [{ text: "I led the migration of a twelve-service platform.", support: null }] } },
      whyRole: { answer: { lines: [{ text: "The release cadence here suits me.", support: null }] } },
      askThem: { questions: [{ text: "How does the team decide what ships weekly?", support: null }] },
      stages: { stages },
    },
    claims,
  };
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

function oneStagePack(recommendedAnswer) {
  return pack({ stages: [stage({ name: STAGE_NAME, questions: STAGE_QUESTIONS, recommendedAnswer })] });
}

// ---------------------------------------------------------------------------
// Instruments (canaried below)
// ---------------------------------------------------------------------------

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

function visibleText(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";
  if (node.hasAttribute("hidden")) return "";
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

function stagesRoot(el) {
  const heading = headingElements(el).find((node) => accessibleName(node) === SECTION_LABELS.stages);
  return heading ? heading.parentElement : null;
}

/** The deepest elements whose own visible text is exactly `text`. The answer
 *  "host" -- the element the answer prose actually lives in. */
function hostsOfText(el, text) {
  const want = norm(text);
  return [...el.querySelectorAll("*")].filter((node) => norm(visibleText(node)) === want);
}

/** Does `node` or any ancestor up to `stop` hide it from a reader without a
 *  click? `visibleText` already drops display/visibility/aria-hidden/hidden;
 *  this catches the OTHER shape -- a collapsible whose trigger is collapsed. */
function collapsedBehindAControl(node, stop) {
  let cursor = node;
  while (cursor && cursor !== stop) {
    const tag = cursor.tagName.toLowerCase();
    if (tag === "details" && !cursor.hasAttribute("open")) return true;
    if (cursor.getAttribute("aria-expanded") === "false") return true;
    cursor = cursor.parentElement;
  }
  return false;
}

/** `text` with each of `parts` removed once, renormalized. Used instead of a
 *  string equality against a hand-joined expectation because `visibleText`
 *  CONCATENATES adjacent text nodes with no separator -- so "what is left
 *  over after the content I know about" is the robust way to ask whether a
 *  build added a label, caption or placeholder of its own. */
function residueAfterRemoving(text, parts) {
  let out = norm(text);
  for (const part of parts) out = out.replace(norm(part), " ");
  return norm(out);
}

/** The CSS properties that silently eat the end of a string. */
function clampProperties(node) {
  const style = node.ownerDocument.defaultView.getComputedStyle(node);
  return {
    textOverflow: style.textOverflow,
    lineClamp: style.getPropertyValue("-webkit-line-clamp") || style.getPropertyValue("line-clamp"),
  };
}

// ---------------------------------------------------------------------------

describe("INSTRUMENT CANARIES -- not N48 coverage; these pass on HEAD", () => {
  it("visibleText drops a [hidden] subtree and an aria-hidden one, and keeps ordinary prose", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("span", null, "shown "),
        createElement("span", { hidden: true }, "hidden-attr "),
        createElement("span", { "aria-hidden": "true" }, "aria-hidden "),
        createElement("span", { style: { display: "none" } }, "display-none")
      )
    );
    expect(norm(visibleText(el))).toBe("shown");
  });

  it("collapsedBehindAControl fires on a closed <details> and on aria-expanded=false, not on plain prose", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("details", { id: "shut" }, createElement("p", { id: "inside" }, "buried")),
        createElement("details", { id: "open", open: true }, createElement("p", { id: "visible" }, "shown")),
        createElement("div", { "aria-expanded": "false" }, createElement("p", { id: "collapsed" }, "also buried")),
        createElement("p", { id: "plain" }, "plain prose")
      )
    );
    const by = (id) => el.querySelector(`#${id}`);
    expect(collapsedBehindAControl(by("inside"), el)).toBe(true);
    expect(collapsedBehindAControl(by("visible"), el)).toBe(false);
    expect(collapsedBehindAControl(by("collapsed"), el)).toBe(true);
    expect(collapsedBehindAControl(by("plain"), el)).toBe(false);
  });

  it("clampProperties reads back a declared ellipsis and an undeclared one differently", async () => {
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("p", { id: "clamped", style: { textOverflow: "ellipsis", overflow: "hidden" } }, "cut"),
        createElement("p", { id: "whole" }, "kept")
      )
    );
    expect(clampProperties(el.querySelector("#clamped")).textOverflow).toBe("ellipsis");
    expect(clampProperties(el.querySelector("#whole")).textOverflow).not.toBe("ellipsis");
  });

  it("hostsOfText finds the element whose own text is the string, and nothing when it is absent", async () => {
    const el = await renderFixture(
      createElement("div", null, createElement("p", null, "needle"), createElement("p", null, "hay"))
    );
    expect(hostsOfText(el, "needle")).toHaveLength(1);
    expect(hostsOfText(el, "not here")).toHaveLength(0);
  });

  it("residueAfterRemoving returns empty for known content and surfaces anything extra", () => {
    expect(residueAfterRemoving("StageOneQuestion one.", ["StageOne", "Question one."])).toBe("");
    expect(residueAfterRemoving("StageOneSuggested answer:Question one.", ["StageOne", "Question one."])).toBe(
      "Suggested answer:"
    );
  });
});

// ---------------------------------------------------------------------------
// N48 -- the answer reaches the candidate
// ---------------------------------------------------------------------------

describe("N48: a stage's recommendedAnswer is rendered to the candidate", () => {
  it("the answer text appears in the stages section at all", async () => {
    const el = await render(baseProps({ pack: oneStagePack(SHORT_ANSWER) }));
    const scope = stagesRoot(el);
    expect(scope, "the Interview stages section must render").toBeTruthy();
    // The questions already render on HEAD; the answer is what does not.
    expect(norm(visibleText(scope))).toContain(STAGE_QUESTIONS[0]);
    expect(
      norm(visibleText(scope)),
      "N48: the model generated this, the candidate paid for it, and the panel throws it away"
    ).toContain(SHORT_ANSWER);
  });

  it("every stage that has one shows its OWN answer -- not just the first stage's", async () => {
    const answers = ["First stage answer about migrations.", "Second stage answer about rollbacks.", "Third stage answer about mentoring."];
    const el = await render(
      baseProps({
        pack: pack({
          stages: answers.map((answer, i) =>
            stage({ name: `Stage ${i + 1}`, questions: [`Question for stage ${i + 1}.`], recommendedAnswer: answer })
          ),
        }),
      })
    );
    const text = norm(visibleText(stagesRoot(el)));
    for (const answer of answers) expect(text, "a loop that renders only stages[0] fails here").toContain(answer);
  });

  it("is visible on first paint -- no click, no disclosure control, nothing collapsed", async () => {
    const el = await render(baseProps({ pack: oneStagePack(LONG_ANSWER) }));
    const scope = stagesRoot(el);
    const hosts = hostsOfText(scope, LONG_ANSWER);
    expect(hosts.length, "the answer must be on screen without any interaction").toBeGreaterThan(0);
    for (const host of hosts) expect(collapsedBehindAControl(host, scope)).toBe(false);
    expect(scope.querySelectorAll("details")).toHaveLength(0);
    expect(scope.querySelectorAll("[aria-expanded]")).toHaveLength(0);
  });

  it("adds no control of its own: a stage WITH an answer has the same buttons as the same stage without one", async () => {
    // The minimize-clicks half of design ss3, as a differential. The
    // with-answer render is asserted to actually contain the answer first,
    // so this cannot pass on HEAD by both sides rendering nothing.
    const withAnswer = await render(baseProps({ pack: oneStagePack(LONG_ANSWER) }));
    expect(norm(visibleText(withAnswer))).toContain(LONG_ANSWER);
    // `summary` and `[aria-expanded]` are in this census deliberately: a
    // <details>/<summary> disclosure adds no <button>, so a button-only
    // count would miss the single most likely wrong build.
    const controlCensus = (el) => ({
      buttons: el.querySelectorAll("button").length,
      links: el.querySelectorAll("a[href]").length,
      inputs: el.querySelectorAll("input,select,textarea").length,
      disclosures: el.querySelectorAll("details,summary,[aria-expanded]").length,
    });
    const withCount = controlCensus(withAnswer);

    const without = await render(baseProps({ pack: oneStagePack(null) }));
    expect(norm(visibleText(without))).not.toContain(LONG_ANSWER);
    const withoutCount = controlCensus(without);

    expect(withCount, "a 'Show suggested answer' toggle is exactly what ss3 rejects").toEqual(withoutCount);
  });

  it("renders in FULL -- long prose is not truncated, and no clamp property is set on it", async () => {
    const el = await render(baseProps({ pack: oneStagePack(LONG_ANSWER) }));
    const scope = stagesRoot(el);
    const text = norm(visibleText(scope));
    expect(text, "the whole answer, not a prefix").toContain(LONG_ANSWER);
    // The last sentence, checked on its own: a clamp eats the end first, and
    // a `toContain(LONG_ANSWER)` that failed for the wrong reason would not
    // say which end was lost.
    expect(text).toContain(LAST_SENTENCE_OF_LONG_ANSWER);
    expect(text).not.toContain("…");
    expect(text).not.toContain("...");

    for (const host of hostsOfText(scope, LONG_ANSWER)) {
      const clamp = clampProperties(host);
      expect(clamp.textOverflow, "an ellipsis on the answer silently deletes model output").not.toBe("ellipsis");
      expect(clamp.lineClamp.trim()).toBe("");
    }
  });

  it("follows the stage's question list rather than preceding it (design ss5's reading order)", async () => {
    const el = await render(baseProps({ pack: oneStagePack(SHORT_ANSWER) }));
    const scope = stagesRoot(el);
    const flat = norm(visibleText(scope));
    const lastQuestionAt = flat.indexOf(STAGE_QUESTIONS[STAGE_QUESTIONS.length - 1]);
    const answerAt = flat.indexOf(SHORT_ANSWER);
    expect(lastQuestionAt, "both must be present before their order means anything").toBeGreaterThanOrEqual(0);
    expect(answerAt).toBeGreaterThanOrEqual(0);
    expect(answerAt, "the candidate reads what they will be asked, then what to say").toBeGreaterThan(lastQuestionAt);
  });

  it("is plain text, never markdown: asterisks stay asterisks and a bare URL does not become a link", async () => {
    // AC-N43.11: the Pack contract's `recommendedAnswer` is a plain string
    // (prepParse.js:56-64) and this panel renders plain React children. A
    // build that routes it through MarkdownPreview would both add a coupling
    // the schema does not need and turn model-authored text into an anchor.
    const raw = "Mention **the rollback** and the write-up at https://notes.example.com/rollback for detail.";
    const el = await render(baseProps({ pack: oneStagePack(raw) }));
    const scope = stagesRoot(el);
    expect(norm(visibleText(scope)), "the literal string, asterisks included").toContain(raw);
    expect(scope.querySelectorAll("strong,em,b,i")).toHaveLength(0);
    expect(scope.querySelectorAll("[href]"), "model prose must never produce an href here").toHaveLength(0);
  });
});

describe("N48: a stage with no recommendedAnswer renders nothing extra", () => {
  // `stagesRoot` is the section WRAPPER, so its visible text starts with the
  // section's own always-visible heading (N44). That heading is known
  // content too, so it is removed alongside the stage's own.
  const STAGE_CONTENT = [SECTION_LABELS.stages, STAGE_NAME, ...STAGE_QUESTIONS];

  it("no orphan label appears for a null answer, while the same stage WITH one shows both", async () => {
    // Differential, so neither half can pass vacuously. First establish what
    // the answer's presence adds...
    const withAnswer = await render(baseProps({ pack: oneStagePack(SHORT_ANSWER) }));
    const withText = norm(visibleText(stagesRoot(withAnswer)));
    expect(withText).toContain(SHORT_ANSWER);
    expect(
      residueAfterRemoving(withText, STAGE_CONTENT),
      "the with-answer render must say strictly more than the stage's own content"
    ).not.toBe("");

    // ...then assert the null case says exactly the stage's own content and
    // no more: no "Suggested answer:" label with nothing under it.
    const without = await render(baseProps({ pack: oneStagePack(null) }));
    expect(residueAfterRemoving(norm(visibleText(stagesRoot(without))), STAGE_CONTENT)).toBe("");
  });

  it("an empty or whitespace-only answer is treated as absent, not as an empty block", async () => {
    // Under-fire control in the same test: the real answer still renders.
    const withAnswer = await render(baseProps({ pack: oneStagePack(SHORT_ANSWER) }));
    expect(norm(visibleText(stagesRoot(withAnswer)))).toContain(SHORT_ANSWER);

    for (const empty of ["", "   ", "\n\t "]) {
      const el = await render(baseProps({ pack: oneStagePack(empty) }));
      expect(
        residueAfterRemoving(norm(visibleText(stagesRoot(el))), STAGE_CONTENT),
        `answer ${JSON.stringify(empty)} must render nothing`
      ).toBe("");
    }
  });

  it("a pack of mixed stages labels only the stage that has something to label", async () => {
    const ANSWER = "Answer for the screen.";
    const el = await render(
      baseProps({
        pack: pack({
          stages: [
            stage({ name: "Screen", questions: ["Q1."], recommendedAnswer: ANSWER }),
            stage({ name: "Panel", questions: ["Q2."], recommendedAnswer: null }),
          ],
        }),
      })
    );
    const mixed = norm(visibleText(stagesRoot(el)));
    // Under-fire control: the answered stage really does render its answer.
    expect(mixed).toContain(ANSWER);

    // WITHOUT pinning the label's wording (design ss3 drafts "Suggested
    // answer:"), the answerless stage must contribute no prose of its own:
    // the residue after removing every known string is identical to the
    // residue of a pack whose only stage is the answered one.
    const onlyAnswered = await render(
      baseProps({ pack: pack({ stages: [stage({ name: "Screen", questions: ["Q1."], recommendedAnswer: ANSWER })] }) })
    );
    const known = [SECTION_LABELS.stages, "Screen", "Q1.", ANSWER];
    const soloResidue = residueAfterRemoving(norm(visibleText(stagesRoot(onlyAnswered))), known);
    const mixedResidue = residueAfterRemoving(mixed, [...known, "Panel", "Q2."]);
    expect(mixedResidue, "the answerless stage must add no label, caption or placeholder").toBe(soloResidue);
  });
});
