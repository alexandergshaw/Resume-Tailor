// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N50 TDD RED hand-off -- the prep panel's HIERARCHY: reading order, emphasis,
// outline, section groups. AC-N50.1, .2 (re-keyed, plan.r2.md T11), .3, .5,
// .6, .7, the Ruling-2 strip placement (H-9), the history disclosure's
// keyboard shape, and the S1 extraction's wiring (W-1).
// Binds to <scratchpad>/chunks/N50/ac.r1.md; specified by plan.r2.md sections
// 2.1 and 6 (H-1, H-2, H-3, H-4, H-6, H-9, W-1).
// ---------------------------------------------------------------------------
//
// SIBLING FILES (N50): PrepPackPanel.hierarchyGuards.test.js holds the
// visibility, type-rank and non-regression guards (H-5, H-7, AC-N50.9-.14,
// .17, .19); PrepPackPanel.queueDisplay.test.js holds the N53 display
// contract; the dialog-mounted halves live in AppViewDialog.prep*.test.js in
// this directory. The maximal state is test/helpers/prepMaximalFixture.js,
// never restated here. The DOM instruments are test/helpers/
// prepPanelInstruments.js, canaried in their own test file.
//
// EVERY CASE MOUNTS THE REAL PANEL and reads what a person would meet, in DOM
// order -- which is also screen-reader order and phone scroll order. Where a
// person acts (opening the names editor), the test clicks the real control.
//
// WHY THE NEW CASES ARE RED ON HEAD (each case's own comment says which):
//   * NamesStrip renders FIRST, so its Edit/Add buttons precede every section
//     heading (AC-N50.1), and in the absent state four "Regenerate {section}"
//     buttons and "Download prep log" precede the generate button (AC-N50.2).
//   * The whole-pack Regenerate is `contained` on a finished pack (AC-N50.3),
//     and so is the names editor's Save (plan T5).
//   * Stage names are bold <div>s, not headings (AC-N50.5).
//   * askThem renders before stages (AC-N50.6).
//   * No role="group" exists; SectionActions renders BETWEEN section wrappers
//     (AC-N50.7).
//   * No <summary> exists (history is 36 always-visible rows).
//   * SectionActions still lives inside PrepPackPanel.js (W-1).
//
// RULING 2 (orchestrator, adopted in plan.r2.md section 0.3): in the ABSENT
// state the names strip goes BEFORE the generate button. That contradicts
// AC-N50.2's literal "first interactive element", so H-2 is re-keyed per
// plan T11: generate is the first interactive element OUTSIDE the names strip.
// If the AC owner reverses Ruling 2, restore H-2's literal clause and flip
// H-9(a) in the same edit (plan T11 states the paired change).
//
// WHAT THIS FILE CANNOT ASSERT, stated rather than faked:
//   * That Enter/Space toggles the <summary>: jsdom does not implement it
//     (plan-probe F7, measured). The keyboard case asserts the DOM
//     precondition -- a native <summary>, tabIndex 0 -- and nothing more.
//   * Geometry of any kind (tap-target size, wrap, 375px overflow): 8b/9b.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PrepPackPanel from "./PrepPackPanel.js";
import { maximalPanelProps, maximalPack } from "@/test/helpers/prepMaximalFixture.js";
import {
  norm,
  controlName,
  accessibleName,
  headingElements,
  headingLevel,
  interactiveBefore,
  follows,
  groupNameOf,
} from "@/test/helpers/prepPanelInstruments.js";
import { stripLineComments } from "@/test/helpers/stripComments.js";

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

async function render(props) {
  await act(async () => root.render(createElement(PrepPackPanel, props)));
  return container.firstElementChild;
}
async function renderFixture(element) {
  await act(async () => root.render(element));
  return container;
}
function click(node) {
  return act(async () => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

// PrepPackPanel.js SECTION_LABELS, restated (module-private there; exporting it
// for a test would move lib/sourceScan/exportReachability.sweep.test.js).
const LABELS = {
  aboutYou: "Tell me about yourself",
  whyRole: "Why this role",
  askThem: "Questions to ask them",
  stages: "Interview stages",
};
// AC-N50.6: the interview's own order.
const DISPLAY_ORDER = ["aboutYou", "whyRole", "stages", "askThem"];
const ALL = ["aboutYou", "whyRole", "askThem", "stages"];

const SMALL_PACK = {
  version: 1,
  sections: {
    aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches.", support: null }] } },
    whyRole: { answer: { lines: [{ text: "This role matches my background.", support: null }] } },
    askThem: { questions: [{ text: "How is this team's work measured?", support: null }] },
    stages: { stages: [{ name: "Screen", questions: ["Walk me through a project."], recommendedAnswer: null, support: null }] },
  },
  claims: [],
};

function smallProps(overrides = {}) {
  return {
    pack: SMALL_PACK,
    status: "ready",
    completeSections: [...ALL],
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
    ...overrides,
  };
}
const absentProps = (overrides = {}) => smallProps({ pack: null, status: null, completeSections: [], ...overrides });

const buttons = (el) => [...el.querySelectorAll('button, [role="button"]')];
const buttonNamed = (el, re) => buttons(el).find((b) => re.test(controlName(b)));
const sectionHeadingsOf = (el) => headingElements(el).filter((h) => headingLevel(h) === 3);
const generateButton = (el) => buttonNamed(el, /^prepare me for this interview$/i);
const wholePackRegenerate = (el) => buttonNamed(el, /^regenerate$/i);
const groups = (el) => [...el.querySelectorAll('[role="group"]')];
const groupFor = (el, section) => groups(el).find((g) => accessibleName(g) === LABELS[section]);
const namesOf = (nodes) => nodes.map((n) => `<${n.tagName.toLowerCase()}> ${controlName(n)}`);
const sectionScopedControls = (el) =>
  buttons(el).filter((b) => ALL.some((s) => controlName(b).includes(LABELS[s])) && !/^regenerate$/i.test(controlName(b)));

// ---------------------------------------------------------------------------
// H-3's outline walker (AC-N50.5, plan M4): EVERY heading in the panel must be
// one of three things, and no level may skip. Canaried below.
// ---------------------------------------------------------------------------
function outlineViolations(el, stageNames) {
  const hs = headingElements(el);
  if (hs.length === 0) return ["no headings at all"];
  const out = [];
  if (headingLevel(hs[0]) !== 3) out.push(`the outline opens at h${headingLevel(hs[0])}, not h3`);
  hs.forEach((h, i) => {
    const level = headingLevel(h);
    const name = accessibleName(h);
    if (i > 0 && level > headingLevel(hs[i - 1]) + 1) out.push(`level skipped: h${headingLevel(hs[i - 1])} -> h${level} ("${name}")`);
    if (level === 3) {
      if (!Object.values(LABELS).includes(name)) out.push(`an h3 that is not a section heading: "${name}"`);
      return;
    }
    if (level === 4) {
      const isStage = groupNameOf(h) === LABELS.stages && stageNames.includes(norm(h.textContent));
      const isSources = name.startsWith("Sources for ") && groupNameOf(h) === name.slice("Sources for ".length);
      if (!isStage && !isSources) out.push(`an h4 that is neither a stage in the stages group nor its own section's sources: "${name}" (group "${groupNameOf(h)}")`);
      return;
    }
    out.push(`a heading at a level the outline does not allow: h${level} "${name}"`);
  });
  return out;
}

describe("INSTRUMENT CANARIES (this file) -- they pass on HEAD and prove the walker bites", () => {
  it("outlineViolations accepts a well-formed outline and rejects a skipped level and a stray h4", async () => {
    const good = await renderFixture(
      createElement(
        "div",
        null,
        createElement("div", { role: "group", "aria-label": LABELS.stages }, createElement("h3", null, LABELS.stages), createElement("h4", null, "Screen")),
      ),
    );
    expect(outlineViolations(good, ["Screen"])).toEqual([]);
    const skipped = await renderFixture(
      createElement(
        "div",
        null,
        createElement("div", { role: "group", "aria-label": LABELS.stages }, createElement("h3", null, LABELS.stages), createElement("h5", null, "Stage"), createElement("h4", null, "Screen")),
      ),
    );
    const v = outlineViolations(skipped, ["Screen"]);
    expect(v.some((m) => /level skipped: h3 -> h5/.test(m))).toBe(true);
    expect(v.some((m) => /h5/.test(m) && /does not allow/.test(m))).toBe(true);
    const stray = await renderFixture(createElement("div", null, createElement("h3", null, LABELS.aboutYou), createElement("h4", null, "Screen")));
    expect(outlineViolations(stray, ["Screen"])).toHaveLength(1);
  });
});

describe("AC-N50.1 -- once a pack exists, nothing interactive precedes the first section heading", () => {
  // RED ON HEAD: NamesStrip renders first, so its "Add"/"Edit" buttons precede
  // the first h3 in every one of these states. Scoped to the panel root (plan
  // T9): in a dialog mount the DialogTitle's Previous/Next come first, and
  // that is not this criterion.
  const STATES = [
    ["ready", () => smallProps()],
    ["partial", () => smallProps({ status: "partial", completeSections: ["aboutYou", "stages"] })],
    ["failed-with-pack", () => smallProps({ status: "failed" })],
    ["maximal (transients)", () => maximalPanelProps()],
    ["maximal (idle)", () => maximalPanelProps({ transients: false })],
  ];
  for (const [state, props] of STATES) {
    it(`[${state}] no button, link, input, summary or focusable element precedes the first section heading`, async () => {
      const el = await render(props());
      const first = sectionHeadingsOf(el)[0];
      expect(first, "no section heading rendered at all").toBeTruthy();
      expect(namesOf(interactiveBefore(el, first))).toEqual([]);
    });
  }
});

describe("AC-N50.2 (re-keyed per plan T11 while Ruling 2 stands) -- the absent state's one obvious first action", () => {
  for (const status of [null, "failed"]) {
    it(`[pack=null, status=${status}] no per-section generate control renders -- there is no section to regenerate`, async () => {
      // RED ON HEAD: four "Regenerate {section}" buttons render for sections
      // that never existed. Keyed on `pack` null, never on `status`.
      const el = await render(absentProps({ status }));
      expect(generateButton(el), "positive control: the whole-pack generate button renders").toBeTruthy();
      const sectionScoped = buttons(el).filter((b) => /generat/i.test(controlName(b)) && ALL.some((s) => controlName(b).includes(LABELS[s])));
      expect(namesOf(sectionScoped)).toEqual([]);
      expect(el.querySelectorAll("summary"), "no history disclosure either: nothing to disclose").toHaveLength(0);
    });

    it(`[pack=null, status=${status}] the generate button is the first interactive element outside the names strip, and the only contained control`, async () => {
      // RED ON HEAD: the strip carries no data-testid hook (plan PL-N50.26),
      // and on HEAD four section buttons and "Download prep log" precede the
      // generate button. The "only contained" half is a GUARD, green on HEAD.
      const el = await render(absentProps({ status }));
      const gen = generateButton(el);
      expect(gen).toBeTruthy();
      expect([...el.querySelectorAll(".MuiButton-contained")]).toEqual([gen]);
      const strip = el.querySelector('[data-testid="names-strip"]');
      expect(strip, "the names strip carries no data-testid=\"names-strip\" hook").toBeTruthy();
      expect(namesOf(interactiveBefore(el, gen).filter((n) => !strip.contains(n)))).toEqual([]);
    });
  }
});

describe("H-9 (Ruling 2) -- where the names strip sits, in each state", () => {
  it("(a) [absent] the strip precedes generate, nothing outside it precedes generate, and Download follows generate", async () => {
    // RED ON HEAD: no strip hook, and HEAD renders Download BEFORE generate in
    // the same row (plan T10). Kills MO-1 (strip after generate) and the
    // Download-first mutant.
    const el = await render(absentProps());
    const gen = generateButton(el);
    const download = buttonNamed(el, /download prep log/i);
    expect(gen).toBeTruthy();
    expect(download).toBeTruthy();
    const strip = el.querySelector('[data-testid="names-strip"]');
    expect(strip, "no names-strip hook").toBeTruthy();
    expect(follows(strip, gen), "the strip must come BEFORE generate while there is no pack").toBe(true);
    expect(namesOf(interactiveBefore(el, gen).filter((n) => !strip.contains(n)))).toEqual([]);
    expect(follows(gen, download), "Download prep log must follow the generate button").toBe(true);
  });

  it("(b) [pack present] the strip and the whole-pack Regenerate both follow the LAST section group, and nothing interactive precedes the first h3", async () => {
    // RED ON HEAD: no groups, no strip hook, strip first.
    const el = await render(maximalPanelProps({ transients: false }));
    const g = groups(el);
    expect(g.map(accessibleName)).toEqual(DISPLAY_ORDER.map((s) => LABELS[s]));
    const strip = el.querySelector('[data-testid="names-strip"]');
    expect(strip, "no names-strip hook").toBeTruthy();
    expect(follows(g[3], strip)).toBe(true);
    expect(g[3].contains(strip)).toBe(false);
    const regen = wholePackRegenerate(el);
    expect(regen).toBeTruthy();
    expect(follows(g[3], regen) && !g[3].contains(regen), "AC-N50.3 position half").toBe(true);
    expect(namesOf(interactiveBefore(el, sectionHeadingsOf(el)[0]))).toEqual([]);
  });

  it("(c) [absent -> first pack lands mid-edit] the names editor a candidate opened survives the strip moving", async () => {
    // GUARD, GREEN ON HEAD and disclosed as such: HEAD never moves the strip,
    // so it cannot lose the editor. This case bites only once the strip has
    // two slots -- it kills MK (the strip element unkeyed, measured in the
    // reference tree). The control is found by name so it runs on HEAD too.
    const first = await render(absentProps());
    const opener = buttonNamed(first, /^(add|edit)$/i);
    expect(opener, "no Add/Edit control on the names strip").toBeTruthy();
    await click(opener);
    expect(container.querySelector('input[aria-label="Your name"]'), "the real click did not open the editor").toBeTruthy();
    await render(smallProps());
    expect(container.querySelector('input[aria-label="Your name"]'), "the editor was lost when the first pack landed").toBeTruthy();
  });
});

describe("AC-N50.3 -- a finished pack's loudest control is not the one that clears it", () => {
  it("[canary, green on HEAD] the class reader is live: the absent-state generate button DOES carry MuiButton-contained", async () => {
    const el = await render(absentProps());
    expect(generateButton(el).classList.contains("MuiButton-contained")).toBe(true);
  });

  it("[maximal, view state] no control in the panel uses contained emphasis", async () => {
    // RED ON HEAD: the whole-pack Regenerate is the panel's one contained button.
    const el = await render(maximalPanelProps({ transients: false }));
    expect(wholePackRegenerate(el), "positive control: the whole-pack Regenerate renders").toBeTruthy();
    expect(namesOf([...el.querySelectorAll(".MuiButton-contained")])).toEqual([]);
  });

  it("[maximal, names EDIT state opened by a real click] still no contained control (the Save button, plan T5)", async () => {
    // RED ON HEAD twice over: the whole-pack Regenerate AND the editor's Save.
    const el = await render(maximalPanelProps({ transients: false }));
    const edit = buttonNamed(el, /^edit$/i);
    expect(edit, "no Edit control on the names strip").toBeTruthy();
    await click(edit);
    expect(buttonNamed(el, /^save$/i), "the editor did not open").toBeTruthy();
    expect(namesOf([...el.querySelectorAll(".MuiButton-contained")])).toEqual([]);
  });
});

describe("AC-N50.5 (H-3, H-4) -- the outline a screen reader walks is the outline the eye sees", () => {
  const stageNames = () => maximalPack().sections.stages.stages.map((s) => s.name);

  it("[maximal] every heading is a section h3, a stage h4 inside the stages group, or a 'Sources for' h4 inside its own group; no level is skipped", async () => {
    // RED ON HEAD: stage names are <div>s, and no group exists for any
    // "Sources for" h4 to sit in.
    const el = await render(maximalPanelProps());
    expect(outlineViolations(el, stageNames())).toEqual([]);
    expect(sectionHeadingsOf(el)).toHaveLength(4);
  });

  it("[maximal] every named stage IS a level-4 heading, one per stage, inside the Interview stages group", async () => {
    const el = await render(maximalPanelProps());
    const stageHeadings = headingElements(el).filter((h) => headingLevel(h) === 4 && stageNames().includes(norm(h.textContent)));
    expect(stageHeadings.map((h) => norm(h.textContent))).toEqual(stageNames());
    for (const h of stageHeadings) expect(groupNameOf(h)).toBe(LABELS.stages);
  });

  it("H-4 (R3): a stage heading's name is exactly the stage name -- the citation marker is a sibling AFTER it, never inside it", async () => {
    // RED ON HEAD: no stage heading exists. A marker inside the h4 would fold
    // "Source n: {claim}" into the heading's own accessible name.
    const el = await render(maximalPanelProps());
    for (const name of stageNames()) {
      const h4 = headingElements(el).find((h) => headingLevel(h) === 4 && norm(h.textContent) === name);
      expect(h4, `no h4 for stage "${name}"`).toBeTruthy();
      expect(h4.querySelector("[data-citation-marker]"), `the marker is inside "${name}"'s heading`).toBe(null);
      expect(accessibleName(h4)).toBe(name);
      const marker = h4.parentElement.querySelector("[data-citation-marker]");
      expect(marker, `stage "${name}" lost its citation marker`).toBeTruthy();
      expect(follows(h4, marker)).toBe(true);
    }
  });
});

describe("AC-N50.6 -- sections follow the interview's own order", () => {
  it("[maximal] Tell me about yourself, Why this role, Interview stages, Questions to ask them", async () => {
    // RED ON HEAD: stages renders fourth, after askThem.
    const el = await render(maximalPanelProps());
    expect(sectionHeadingsOf(el).map(accessibleName)).toEqual(DISPLAY_ORDER.map((s) => LABELS[s]));
  });

  it("the order is independent of completeSections' own array order (AC-N44.2's invariance survives)", async () => {
    const el = await render(maximalPanelProps({}, { status: "partial", completeSections: ["askThem", "stages", "whyRole", "aboutYou"] }));
    expect(sectionHeadingsOf(el).map(accessibleName)).toEqual(DISPLAY_ORDER.map((s) => LABELS[s]));
  });
});

describe("AC-N50.7 -- each section is ONE named group that owns everything about it", () => {
  it("[maximal] exactly four role=group elements, named exactly by their section labels, each holding its own h3", async () => {
    // RED ON HEAD: no group exists.
    const el = await render(maximalPanelProps());
    expect(groups(el).map(accessibleName)).toEqual(DISPLAY_ORDER.map((s) => LABELS[s]));
    for (const section of ALL) {
      const h3 = sectionHeadingsOf(el).find((h) => accessibleName(h) === LABELS[section]);
      expect(groupNameOf(h3)).toBe(LABELS[section]);
    }
  });

  it("[maximal idle] every section's content, source list, regenerate control, history disclosure and restore controls sit inside THAT section's group", async () => {
    const el = await render(maximalPanelProps({ transients: false }));
    const s = maximalPack().sections;
    const contentBySection = {
      aboutYou: s.aboutYou.answer.lines.map((l) => l.text),
      whyRole: s.whyRole.answer.lines.map((l) => l.text),
      askThem: s.askThem.questions.map((q) => q.text),
      stages: s.stages.stages.flatMap((st) => [st.name, ...st.questions, st.recommendedAnswer]),
    };
    for (const section of ALL) {
      const group = groupFor(el, section);
      expect(group, `no group for ${section}`).toBeTruthy();
      for (const text of contentBySection[section]) expect(norm(group.textContent), `${section} content outside its group`).toContain(text);
      const sources = headingElements(group).find((h) => accessibleName(h) === `Sources for ${LABELS[section]}`);
      expect(sources, `${section}'s source list is outside its group`).toBeTruthy();
      const regen = buttons(group).find((b) => /regenerate/i.test(controlName(b)) && controlName(b).includes(LABELS[section]));
      expect(regen, `${section}'s regenerate control is outside its group`).toBeTruthy();
      expect(group.querySelectorAll("summary"), `${section}'s history disclosure`).toHaveLength(1);
      const restores = buttons(group).filter((b) => /restore/i.test(controlName(b)) && controlName(b).includes(LABELS[section]));
      expect(restores.length, `${section}'s restore controls`).toBeGreaterThan(0);
    }
  });

  it("[maximal, both variants] no section-scoped control sits outside its own group, and none sits in another section's", async () => {
    for (const props of [maximalPanelProps(), maximalPanelProps({ transients: false })]) {
      const el = await render(props);
      const scoped = sectionScopedControls(el);
      expect(scoped.length, "positive control: section-scoped controls render").toBeGreaterThan(0);
      const misplaced = scoped
        .map((b) => ({ name: controlName(b), group: groupNameOf(b) }))
        .filter((row) => !row.name.includes(row.group) || row.group === "");
      expect(misplaced).toEqual([]);
      for (const summary of el.querySelectorAll("summary")) expect(controlName(summary)).toContain(groupNameOf(summary) || "NO GROUP");
    }
  });

  it("[maximal, transients] the in-progress and the waiting line each sit in their own section's group and name it", async () => {
    // RED ON HEAD: there is no group, no role=status region, and no waiting
    // state at all (AC-N50.15(b)).
    const el = await render(maximalPanelProps());
    for (const section of ["whyRole", "askThem"]) {
      const group = groupFor(el, section);
      expect(group, `no group for ${section}`).toBeTruthy();
      const status = group.querySelector('[role="status"]');
      expect(status, `${section} has no role=status region`).toBeTruthy();
      expect(norm(status.textContent)).toContain(LABELS[section]);
    }
  });
});

describe("the history disclosure is keyboard-reachable by construction", () => {
  it("[maximal idle] one native <summary> per section with restorable versions, tabIndex 0, named with the section label and a history word", async () => {
    // RED ON HEAD: no <summary> exists. Enter/Space activation is NOT
    // simulated: jsdom does not toggle a <details> on a key event (plan-probe
    // F7, measured), so a keyboard test here would test jsdom, not the panel.
    // The native element is what gives a real browser that behaviour for free.
    const el = await render(maximalPanelProps({ transients: false }));
    const summaries = [...el.querySelectorAll("summary")];
    expect(summaries.map(groupNameOf)).toEqual(DISPLAY_ORDER.map((s) => LABELS[s]));
    for (const summary of summaries) {
      expect(summary.parentElement.tagName.toLowerCase()).toBe("details");
      expect(summary.parentElement.firstElementChild).toBe(summary);
      expect(summary.tabIndex).toBe(0);
      expect(controlName(summary)).toMatch(/version|history|earlier|previous/i);
      expect(controlName(summary)).toContain(groupNameOf(summary));
    }
  });
});

describe("W-1 -- the S1 extraction is WIRED, not merely written (source-text wiring check)", () => {
  // A source-text test, deliberately: the property IS the shape of the source
  // (loop-traps-tests, "gate the CHANGE, not only the pieces"). Comments are
  // stripped first so a comment citing the component can neither satisfy nor
  // defeat it. No line-count assertion (plan section 6).
  const SOURCE = readFileSync(join(process.cwd(), "app", "components", "tracking", "PrepPackPanel.js"), "utf8");
  const CODE = stripLineComments(SOURCE);

  it("[canary] the read is live and the stripper keeps code: the file's own PackSections function is found", () => {
    expect(CODE).toMatch(/function PackSections\s*\(/);
    expect(stripLineComments("// import X from \"./PrepSectionActions\"\nconst y = 1;")).not.toMatch(/PrepSectionActions/);
  });

  it("PrepPackPanel.js imports ./PrepSectionActions and renders <PrepSectionActions, and no longer defines SectionActions itself", () => {
    // RED ON HEAD: SectionActions is still a local function.
    expect(CODE).toMatch(/import\s+PrepSectionActions\s+from\s+["']\.\/PrepSectionActions(\.js)?["']/);
    expect(CODE).toMatch(/<PrepSectionActions\b/);
    expect(CODE).not.toMatch(/function\s+SectionActions\s*\(/);
  });
});
