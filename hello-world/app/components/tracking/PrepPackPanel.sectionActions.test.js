// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N45/N46 step S10, panel half: the per-section regenerate affordance and the
// per-section version history, ON the four headers N44 already ships.
// AC-N45.1, AC-N46.1, AC-UX.1, AC-UX.3, AC-UX.6, and the standing a11y and
// explicit-margin rules.
// ---------------------------------------------------------------------------
//
// SEPARATE FILE, deliberately. `PrepPackPanel.test.js` owns N33's read
// surface, `PrepPackPanel.generate.test.js` owns N29's whole-pack control,
// `PrepPackPanel.sectionHeaders.test.js` owns N44's headers, and
// `PrepPackPanel.citationStates.test.js` owns N43/N48's citation apparatus.
// Nothing in any of them is edited by this round.
//
// THIS FILE IS THE PROP-CONTRACT HALF. It renders the panel directly and
// exercises the props S10 must add. It is NOT the reachability test -- a
// component that calls `onRegenerateSection` when clicked proves nothing about
// whether anything ever passes that prop. The reachability tests are
// AppViewDialog.prepSectionRegenerate.reachability.test.js and
// AppViewDialog.prepRestore.reachability.test.js, which mount the real dialog
// and read the real network. Both halves are needed and neither substitutes
// for the other: this one pins the component's contract and its a11y; those
// pin that a human can get to it.
//
// N50 IS ALREADY OPEN on this panel (it needs a hierarchy pass, and this
// chunk is named in that entry as one of the things the pass must absorb).
// So this file requires the MINIMUM surface the AC demands -- a control per
// section, a list of a section's earlier versions, and a restore action -- and
// deliberately specifies no revision browser, no diff view, no compare mode
// and no placement. Where the list lives, and whether it sits behind a
// disclosure, is the experience seat's to decide; AC-UX.3's "at most one
// activation" is checked in the reachability file, not dictated here.
//
// PROPS THIS FILE BINDS (the plan named the step, not the shape):
//   onRegenerateSection(section)        -- one section's regenerate action
//   onRestoreRevision(section, revision)-- restore a specific stored revision
//   sectionRevisions: {section: [{revision, engine, restoredFrom, createdAt}]}
//   liveRevisions:    {section: revision}
//   generatingSections: string[]        -- sections with an attempt in flight
// All five are ADDITIVE and default to empty, so every existing call site and
// every landed test of this component keeps working unchanged.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import Box from "@mui/material/Box";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// PrepPackPanel.js:83, verbatim and in its own key order.
const SECTION_NAMES = ["aboutYou", "whyRole", "askThem", "stages"];
const SECTION_LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};

const READY_PACK = {
  version: 1,
  sections: {
    aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches.", support: null }] } },
    whyRole: { answer: { lines: [{ text: "This role matches my background.", support: null }] } },
    askThem: { questions: [{ text: "How is this team's work measured?", support: null }] },
    stages: {
      stages: [
        { name: "Screen", questions: ["Walk me through a project."], recommendedAnswer: "Lead with impact.", support: null },
      ],
    },
  },
  claims: [],
};

const SECTION_REVISIONS = {
  aboutYou: [
    { revision: 3, engine: "gemini", restoredFrom: null, createdAt: "2026-09-03T00:00:00.000Z" },
    { revision: 2, engine: "gemini", restoredFrom: 1, createdAt: "2026-09-02T00:00:00.000Z" },
    { revision: 1, engine: "embedded", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" },
  ],
  whyRole: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
  askThem: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
  stages: [{ revision: 1, engine: "gemini", restoredFrom: null, createdAt: "2026-09-01T00:00:00.000Z" }],
};

function baseProps(overrides = {}) {
  return {
    pack: READY_PACK,
    status: "ready",
    completeSections: [...SECTION_NAMES],
    candidateName: null,
    interviewerNames: [],
    onDownloadLog: vi.fn(),
    onSaveNames: vi.fn(),
    generating: false,
    triggerMessage: null,
    onGenerateNow: vi.fn(),
    hasDescription: true,
    onRegenerateSection: vi.fn(),
    onRestoreRevision: vi.fn(),
    sectionRevisions: SECTION_REVISIONS,
    liveRevisions: { aboutYou: 3, whyRole: 1, askThem: 1, stages: 1 },
    generatingSections: [],
    ...overrides,
  };
}

function accessibleName(node) {
  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => node.ownerDocument.getElementById(id))
      .filter(Boolean)
      .map((el) => el.textContent || "");
    if (parts.length) return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  const label = node.getAttribute("aria-label");
  if (label) return label.replace(/\s+/g, " ").trim();
  const clone = node.cloneNode(true);
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function buttons(el) {
  return [...el.querySelectorAll('button, [role="button"]')];
}

function sectionControl(el, section) {
  return buttons(el).find((node) => {
    const name = accessibleName(node);
    return /regenerate/i.test(name) && name.includes(SECTION_LABELS[section]);
  });
}

function restoreControls(el, section) {
  return buttons(el)
    .map((node) => ({ node, name: accessibleName(node) }))
    .filter((row) => /restore/i.test(row.name) && row.name.includes(SECTION_LABELS[section]));
}

function revisionInName(name) {
  const digits = name.match(/\d+/g) || [];
  return digits.length ? Number(digits[digits.length - 1]) : null;
}

function click(node) {
  return act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// --- the explicit-margin instrument ----------------------------------------
// Rebuilt from PrepPackPanel.sectionHeaders.test.js:276-324's own measured
// discriminator (a private copy, not an import: importing a .test.js
// re-executes its whole suite). MEASURED there and re-asserted below: jsdom
// applies emotion's injected `sx` rules, so `sx={{mb: 2}}` reads back "16px",
// but jsdom applies NO user-agent stylesheet, so an UNDECLARED margin reads
// back as bare "0" with no unit. The unit is the discriminator -- which is why
// this guard tests for the PRESENCE OF A DECLARATION, never for the value.
// The inherited-`1em` defect is invisible as a computed value in jsdom, which
// is exactly how it passed a 14,330-test suite and put a visible gap in the
// owner's real document.
const UA_VERTICAL_MARGIN_TAGS = ["p", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "figure", "pre", "dl", "dd", "menu"];
const UA_MARGIN_SELECTOR = UA_VERTICAL_MARGIN_TAGS.join(",");
const DECLARED_LENGTH = /^-?\d*\.?\d+(px|em|rem|%|vh|vw|pt|ex|ch)$/;

function verticalMargins(node) {
  const style = node.ownerDocument.defaultView.getComputedStyle(node);
  return { marginTop: style.marginTop, marginBottom: style.marginBottom };
}
function isDeclaredLength(value) {
  return typeof value === "string" && DECLARED_LENGTH.test(value.trim());
}
function unpinnedVerticalMargins(el) {
  return [...el.querySelectorAll(UA_MARGIN_SELECTOR)]
    .map((node) => ({ tag: node.tagName.toLowerCase(), text: (node.textContent || "").slice(0, 40), ...verticalMargins(node) }))
    .filter((row) => !isDeclaredLength(row.marginTop) || !isDeclaredLength(row.marginBottom));
}

// ---------------------------------------------------------------------------

describe("INSTRUMENT CANARIES -- these prove the helpers discriminate; they are NOT N45/N46 coverage", () => {
  it("the margin guard fires on a NEW element that states no vertical margin and stays silent on one that does", async () => {
    // The standing rule says to prove a class guard against a NEW member added
    // for the purpose, never against the element whose bug motivated it. The
    // `figure` below is that new member: no element of that tag exists
    // anywhere in this panel today, so the guard has never seen one, and it
    // must still bite.
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement(Box, { component: "p", sx: { m: 0 } }, "pinned"),
        createElement(Box, { component: "figure", sx: {} }, "a brand-new figure nobody pinned"),
        createElement(Box, { component: "figure", sx: { my: 0 } }, "a brand-new figure that IS pinned"),
        createElement(Box, { component: "p", sx: { mb: 1 } }, "bottom only, top left to the browser"),
        createElement(Box, { sx: {} }, "a div is not in the guarded class"),
      ),
    );
    expect(unpinnedVerticalMargins(el).map((row) => row.text)).toEqual([
      "a brand-new figure nobody pinned",
      "bottom only, top left to the browser",
    ]);
    // The discriminator itself, stated outright so a jsdom upgrade that starts
    // applying a UA stylesheet breaks HERE rather than silently turning this
    // guard into a no-op.
    const figures = [...el.querySelectorAll("figure")];
    expect(isDeclaredLength(verticalMargins(figures[0]).marginTop)).toBe(false);
    expect(verticalMargins(figures[1]).marginTop).toBe("0px");
  });

  it("accessibleName prefers aria-label over content and ignores a `title` attribute entirely", async () => {
    // The Tooltip trap: MUI's Tooltip supplies a `title`, which is NOT a
    // control's accessible name. A control whose only label is a tooltip reads
    // as unnamed, so this helper must never see one.
    const el = await renderFixture(
      createElement(
        "div",
        null,
        createElement("button", { "aria-label": "Named by label" }, "ignored"),
        createElement("button", { title: "Only a tooltip" }, ""),
        createElement("button", null, "Named by content"),
      ),
    );
    expect(buttons(el).map(accessibleName)).toEqual(["Named by label", "", "Named by content"]);
  });
});

describe("AC-N45.1 (panel) -- every section carries its own regenerate control", () => {
  it("renders one control per section, each named for the section it regenerates", async () => {
    const el = await render(baseProps());
    const missing = SECTION_NAMES.filter((section) => !sectionControl(el, section));
    expect(missing, `sections with no per-section regenerate control: ${missing.join(", ")}`).toEqual([]);
  });

  it("activating one calls onRegenerateSection with THAT section, exactly once", async () => {
    const onRegenerateSection = vi.fn();
    const el = await render(baseProps({ onRegenerateSection }));
    const control = sectionControl(el, "askThem");
    expect(control, "no per-section control for askThem").toBeTruthy();
    await click(control);
    expect(onRegenerateSection.mock.calls).toEqual([["askThem"]]);
  });

  it("[discrimination control] each control passes its OWN section name", async () => {
    const onRegenerateSection = vi.fn();
    const el = await render(baseProps({ onRegenerateSection }));
    for (const section of SECTION_NAMES) {
      const control = sectionControl(el, section);
      expect(control, `no per-section control for ${section}`).toBeTruthy();
      await click(control);
    }
    expect(onRegenerateSection.mock.calls.map(([s]) => s)).toEqual(SECTION_NAMES);
  });

  it("an EMPTY section still carries its control -- a section with nothing in it is the one you most want to regenerate", async () => {
    // N44 renders all four headers whatever `completeSections` says. A control
    // gated on content would be missing exactly where it is most useful, and
    // N44's backlog entry names the per-section controls as the reason its
    // headers exist at all.
    const el = await render(baseProps({ completeSections: ["aboutYou"] }));
    expect(sectionControl(el, "stages"), "the empty 'Interview stages' section carries no regenerate control").toBeTruthy();
  });

  it("while THAT section is regenerating its control is replaced, not disabled, and the other three stay usable", async () => {
    // DX section 8's standing a11y rule, already honoured by GenerateControl
    // (PrepPackPanel.js:499-506): never a disabled Button -- a blocked state
    // replaces the control rather than leaving something that looks
    // interactive and silently does nothing.
    const onRegenerateSection = vi.fn();
    const el = await render(baseProps({ onRegenerateSection, generatingSections: ["askThem"] }));
    expect(sectionControl(el, "askThem")).toBeUndefined();
    expect(el.querySelectorAll("button[disabled], [aria-disabled='true']")).toHaveLength(0);

    const other = sectionControl(el, "whyRole");
    expect(other, "regenerating one section disabled the others").toBeTruthy();
    await click(other);
    expect(onRegenerateSection.mock.calls).toEqual([["whyRole"]]);
  });

  it("no per-section control renders when there is no job description to generate from", async () => {
    const el = await render(baseProps({ hasDescription: false }));
    const present = SECTION_NAMES.filter((section) => sectionControl(el, section));
    expect(present, `controls rendered with no job description: ${present.join(", ")}`).toEqual([]);
  });
});

describe("AC-N46.1 / AC-UX.1 (panel) -- a section's earlier versions and the restore action", () => {
  it("a section with two restorable revisions offers two distinctly-named restore controls", async () => {
    const el = await render(baseProps());
    const controls = restoreControls(el, "aboutYou");
    expect(controls.length, "no restore control rendered for a section with three stored revisions").toBe(2);
    expect(new Set(controls.map((r) => r.name)).size).toBe(2);
    expect(controls.map((r) => revisionInName(r.name)).sort()).toEqual([1, 2]);
  });

  it("activating one calls onRestoreRevision(section, revision) with that exact revision", async () => {
    const onRestoreRevision = vi.fn();
    const el = await render(baseProps({ onRestoreRevision }));
    const target = restoreControls(el, "aboutYou").find((r) => revisionInName(r.name) === 1);
    expect(target, "no restore control identifiably for revision 1").toBeTruthy();
    await click(target.node);
    expect(onRestoreRevision.mock.calls).toEqual([["aboutYou", 1]]);
  });

  it("[over-fire control] the LIVE revision is never offered for restore", async () => {
    const el = await render(baseProps());
    expect(restoreControls(el, "aboutYou").map((r) => revisionInName(r.name))).not.toContain(3);
    expect(restoreControls(el, "whyRole")).toEqual([]);
  });

  it("[under-fire control] a section with no stored revisions at all renders no restore control and does not crash", async () => {
    const el = await render(baseProps({ sectionRevisions: {}, liveRevisions: {} }));
    for (const section of SECTION_NAMES) expect(restoreControls(el, section)).toEqual([]);
    expect(sectionControl(el, "aboutYou"), "the regenerate control vanished along with the history").toBeTruthy();
  });

  it("a revision created by a restore is disclosed as one", async () => {
    const el = await render(baseProps());
    expect((el.textContent || "").toLowerCase()).toMatch(/restored/);
  });
});

describe("a11y -- the new controls are real, named, keyboard-reachable buttons", () => {
  it("every new control is a native <button> with a non-empty accessible name and no tabindex trap", async () => {
    const el = await render(baseProps());
    const newControls = [
      ...SECTION_NAMES.map((section) => sectionControl(el, section)).filter(Boolean),
      ...restoreControls(el, "aboutYou").map((r) => r.node),
    ];
    expect(newControls.length, "no new controls were rendered at all").toBeGreaterThan(0);
    for (const node of newControls) {
      expect(node.tagName.toLowerCase(), `${accessibleName(node)} is not a native button`).toBe("button");
      expect(accessibleName(node).length).toBeGreaterThan(0);
      expect(node.getAttribute("tabindex")).not.toBe("-1");
      expect(node.hasAttribute("disabled")).toBe(false);
      expect(node.getAttribute("aria-disabled")).not.toBe("true");
    }
  });

  it("no control's only label is a tooltip, and no non-native select is introduced", async () => {
    // MUI's Tooltip steals a control's accessible name, and MUI's non-native
    // Select breaks WCAG 2.5.3 -- both recorded traps in this repo. The second
    // half is GREEN ON HEAD (there is no Select in this panel today) and is a
    // control on THIS diff: a revision picker is exactly where one arrives.
    const el = await render(baseProps());
    const named = buttons(el).filter((node) => accessibleName(node).length > 0);
    expect(named.length).toBe(buttons(el).length);
    expect(el.querySelectorAll('[role="combobox"], [role="listbox"]')).toHaveLength(0);
    const selects = [...el.querySelectorAll("select")];
    for (const select of selects) expect(select.tagName.toLowerCase()).toBe("select");
  });
});

describe("the explicit-margin rule -- every block element this chunk adds states its own vertical margin", () => {
  it("the panel in its MAXIMAL state leaves no guarded element's vertical margin to the browser", async () => {
    // Two live defects this week came from an inherited UA default. The
    // maximal state is the one N50's entry says nobody ever looks at: a ready
    // pack, four populated sections, citations, a recommended answer, the
    // names strip, AND now a revision list per section.
    const el = await render(baseProps());
    // UNDER-FIRE CONTROL, and what keeps this case from passing vacuously on
    // HEAD: the guard checks nothing unless the new elements are on screen, so
    // their presence is asserted FIRST. On HEAD this is what makes the case
    // red -- there is no revision list to measure.
    expect(restoreControls(el, "aboutYou").length, "no revision list rendered, so this guard measured nothing").toBeGreaterThan(0);
    expect(sectionControl(el, "aboutYou"), "no per-section control rendered, so this guard measured nothing").toBeTruthy();
    const unpinned = unpinnedVerticalMargins(el);
    expect(unpinned, `elements handing their spacing to the browser: ${JSON.stringify(unpinned)}`).toEqual([]);
  });

  it("WHAT THIS GUARD CANNOT CATCH, stated in its own test: a declared but WRONG value", async () => {
    // It answers "did someone state a margin", never "is the stated margin
    // right". A revision list with `mt: 40` passes. Only a human looking at
    // the rendered panel catches that, which is N50's own review step.
    const el = await renderFixture(createElement(Box, { component: "p", sx: { mt: 40, mb: 0 } }, "absurd but declared"));
    expect(unpinnedVerticalMargins(el)).toEqual([]);
  });
});

describe("AC-UX.6 -- the regenerate caption stops asserting irreversibility once history exists", () => {
  // `import.meta.url` is an http: URL under the jsdom environment, not a
  // file: one (measured this round: `new URL("./x", import.meta.url)` throws
  // "The URL must be of scheme file"). vitest's cwd is `hello-world/`, so the
  // path is resolved from there, and the canary below is what proves the read
  // landed on the real file rather than on nothing.
  const SOURCE = readFileSync(join(process.cwd(), "app", "components", "tracking", "PrepPackPanel.js"), "utf8");

  it("[canary] the source read is live -- the file really does contain the caption this test is about", () => {
    expect(SOURCE.length).toBeGreaterThan(1000);
    expect(SOURCE).toMatch(/Regenerating/);
  });

  it("the literal 'can't be undone' appears NOWHERE in PrepPackPanel.js -- the caption AND the comment quoting the old copy", () => {
    // Measured with Node (never grep -P): today there are exactly TWO
    // occurrences, both with U+0027 -- the live caption at :489 and the
    // comment at :480 quoting the copy it replaced. Fixing only the caption
    // leaves this red, which is deliberate: a comment that still asserts the
    // old, now-false mechanic is how the next reader learns the wrong thing.
    const matches = [...SOURCE.matchAll(/can.{0,1}t be undone/gi)].map((m) => m[0]);
    expect(matches, `still asserts irreversibility ${matches.length} time(s)`).toEqual([]);
  });

  it("the rendered caption does not tell a candidate a failed regeneration is unrecoverable", async () => {
    const el = await render(baseProps());
    const text = (el.textContent || "").replace(/\s+/g, " ");
    expect(text).toMatch(/regenerat/i); // the caption region still says something
    expect(text).not.toMatch(/can.{0,1}t be undone/i);
    expect(text).not.toMatch(/nothing to fall back to/i);
  });
});
