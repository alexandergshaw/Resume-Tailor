// @vitest-environment jsdom
//
// N157 SC-D wave D-b (step 4b TDD seat) -- the customization CONTROLS, driven
// PRE-PLAN through the REAL StudyPlanClient shell (the create step, S3). Binds
// to docs/loop/N157.SC-D.design.r1.md sections 3.1-3.10 and 6, the DES-N157-D*
// ledger, and the SHIPPED D-a pieces (lib/studyPlan/studyPlanKnobs.js +
// STUDY_COPY.knobs) plus @/app/theme/mobileSx tokens.
//
// WHY THROUGH THE SHELL, NOT THE COMPONENT IN ISOLATION (reachability is a
// first-class test here). This repo has shipped a form with no save wiring and a
// panel with no opening button past a green suite because every test called the
// mechanism directly. So the controls are reached the way a learner reaches
// them: mount the REAL shell, pick the posting through the REAL PostingPicker,
// open the REAL "Customize your plan" disclosure by click, operate the REAL
// controls, and click the REAL "Create study plan". Every knob assertion reads
// the actual POST /api/study-plan BODY -- never component state, never a handler
// spy -- so a draft that updates state but never reaches the wire still reds.
// The orchestration under test (useStudyKnobs + StudyPlanControls + the four
// C-c wiring edits + studyPlanBuild.run + requestStudyPlanBuild) runs for real.
//
// RED ON HEAD, and WHY (each `it`): the D-b modules do not exist yet
// (useStudyKnobs.js, StudyPlanControls.js) and the shell is not wired to render
// the panel or to send `knobs: effective`, so:
//   * the disclosure button "Customize your plan" is NOT in the DOM -> every
//     panel/control test reds at the "open the panel" step;
//   * the zero-touch create sends `knobs: record.knobs ?? undefined` = undefined,
//     so the POST body has no `knobs` key -> the zero-touch test reds on a
//     POSITIVE assertion (body.knobs deep-equals normalizeKnobs(null));
//   * STUDY_COPY.notice.gemini does not yet carry the PD-SD-3 egress sentence
//     -> the egress test reds.
// None are vacuous: each asserts the PRESENCE of a behaviour, not the absence of
// an unbuilt feature.
//
// THE MUTANT THIS FILE IS BUILT TO KILL (watched in tests.r1.md): the
// WHOLE-KNOBS / WRONG-SHAPE emit -- a build whose emitted knobs carry a field
// the schema drops (an extra pace.hoursPerDay) or an unnormalized value. The
// "assembled knobs match the schema shape" test reds because the wire body stops
// being normalizer-stable. The no-op control is the unmutated reference, which
// stays green.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "@/app/theme/mobileSx.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { fillStudyCopy } from "@/lib/studyPlan/studyPlanNotices.js";
import { normalizeKnobs } from "@/lib/studyPlan/studyPlanSchema.js";
import { DIGEST_SECTIONS } from "@/lib/tracking/applicationDigest.js";
import { MAX_PLAN_DAYS, RATIO_PRESETS } from "@/lib/studyPlan/studyPlanKnobs.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---- controllable seams (the only stubs; everything else runs for real) ---
let engineValue = "gemini";
vi.mock("@/app/settings/engine", () => ({
  useEngine: () => ({ engine: engineValue, setEngine: () => {} }),
  readEngine: () => engineValue,
}));

const fetchPracticePostings = vi.fn();
vi.mock("@/lib/copilot/postings", () => ({ fetchPracticePostings: (...a) => fetchPracticePostings(...a) }));

let readerResult;
const reader = vi.fn(async () => readerResult);
const writer = vi.fn(async () => ({ written: true, error: null }));
vi.mock("@/lib/studyPlan/studyPlanBrowser.js", () => ({ bindStudyPlan: () => ({ reader, writer }) }));

// ---- fixtures -----------------------------------------------------------
const OPTION = { id: "app-7", title: "Staff Engineer", company: "Acme", label: "Staff Engineer - Acme" };
const EMPTY_RECORD = { status: null, plan: null, knobs: null, progress: null, cachedResearch: null, researchedAt: null, engine: null, error: null };

const MOSTLY_NEW = RATIO_PRESETS.find((p) => p.id === "mostly-new");
const EGRESS_SENTENCE = "Any focus or skip choices you set are sent to Gemini with it.";

// ---- fetch stub ---------------------------------------------------------
let fetchMock;
let originalFetch;

function reply(json) {
  return { ok: true, status: 200, json: async () => json };
}

// ---- module-scope store resets ------------------------------------------
let resetBuild;
let resetProgress;
let StudyPlanClient;
let container;
let root;

beforeEach(async () => {
  engineValue = "gemini";
  readerResult = EMPTY_RECORD;
  reader.mockClear();
  writer.mockClear();
  fetchPracticePostings.mockReset();
  fetchPracticePostings.mockResolvedValue([OPTION]);

  originalFetch = globalThis.fetch;
  fetchMock = vi.fn(async (url) => {
    if (String(url).includes("/api/application-digest")) return reply({ digest: { status: "ready" } });
    return reply({ status: "ready", partial: false, reason: null });
  });
  globalThis.fetch = fetchMock;

  ({ resetStudyPlanBuildStore: resetBuild } = await import("@/lib/studyPlan/studyPlanBuild.js"));
  ({ resetStudyPlanProgressStore: resetProgress } = await import("@/lib/studyPlan/studyPlanProgressStore.js"));
  resetBuild();
  resetProgress();
  ({ default: StudyPlanClient } = await import("./StudyPlanClient.js"));

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
  resetBuild();
  resetProgress();
  vi.restoreAllMocks();
});

// ---- driving helpers (the real keyboard+pointer paths) ------------------
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
const text = () => document.body.textContent || "";
const buttonByName = (name) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
async function click(btn) {
  expect(btn, "control not found").toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await flush();
  await flush();
  await flush();
}

async function mountAndSelect() {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(StudyPlanClient, null)));
  });
  await flush();
  const input = document.body.querySelector(".MuiAutocomplete-root input");
  await act(async () => {
    input.focus();
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await flush();
  await click(document.body.querySelector('[role="option"]'));
}

// Open the "Customize your plan" disclosure. Returns the panel element the
// disclosure's aria-controls points at (the reachable opening path).
async function openPanel() {
  const disclosure = buttonByName(STUDY_COPY.knobs.disclosureCreate);
  expect(disclosure, "the 'Customize your plan' disclosure is not in the DOM").toBeTruthy();
  await click(disclosure);
  const panelId = disclosure.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  expect(panel, "the disclosure's aria-controls does not resolve to a panel").toBeTruthy();
  return panel;
}

// The MUI-rendered <input> behind a visible <label>, found by that label's text.
function fieldByLabel(labelText) {
  const label = [...document.body.querySelectorAll("label")].find((l) => (l.textContent || "").includes(labelText));
  if (!label) return null;
  return label.control || (label.htmlFor ? document.getElementById(label.htmlFor) : null);
}

// Type into a controlled MUI input through the native value setter (the idiom
// the landed RegenerateControl.test.js / FeedConfigChat.wiring.test.js use), so
// React's onChange fires exactly as a keystroke would.
async function typeInto(input, value) {
  const proto = Object.getPrototypeOf(input);
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
  await act(async () => input.dispatchEvent(new window.Event("input", { bubbles: true })));
  await flush();
}

// The POST body of the one build request (knobs on the wire, parsed).
function planBody() {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/study-plan"));
  expect(call, "no POST /api/study-plan fired -- the build never reached the wire").toBeTruthy();
  return JSON.parse(call[1].body);
}
async function clickCreate() {
  await click(buttonByName(STUDY_COPY.picker.createButton));
}

// An area row carries a label element whose text IS the area name (role=group
// labelled by it); the two toggles are named by their visible text only. Locate
// the row from its label (robust to MUI's ToggleButtonGroup also being role=group).
function areaToggle(panel, area, toggleName) {
  const label = [...panel.querySelectorAll("*")].find((el) => el.children.length === 0 && (el.textContent || "").trim() === area);
  expect(label, `the area label "${area}" was not rendered in the panel`).toBeTruthy();
  const row = label.closest('[role="group"]');
  expect(row, `the "${area}" row is not a labelled group`).toBeTruthy();
  const btn = [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === toggleName);
  expect(btn, `the ${toggleName} toggle for "${area}" was not found`).toBeTruthy();
  return btn;
}

// -------------------------------------------------------------------------
describe("the disclosure (DES-N157-D18): reachable, closed by default, correct semantics", () => {
  it("renders a 'Customize your plan' disclosure that is CLOSED by default (panel absent from the DOM)", async () => {
    await mountAndSelect();
    const disclosure = buttonByName(STUDY_COPY.knobs.disclosureCreate);
    expect(disclosure).toBeTruthy();
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    // Closed => the mix segment is not yet rendered (conditional render, not CSS).
    expect(buttonByName(STUDY_COPY.knobs.mixEven)).toBeFalsy();
    // Create stays the one contained (primary) button at the create step.
    expect(container.querySelectorAll(".MuiButton-contained")).toHaveLength(1);
  });

  it("opening resolves aria-expanded/aria-controls to a role=group panel with one fieldset+legend per knob and NO headings", async () => {
    await mountAndSelect();
    const panel = await openPanel();
    expect(buttonByName(STUDY_COPY.knobs.disclosureCreate).getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("role")).toBe("group");
    expect(panel.getAttribute("aria-label") || panel.getAttribute("aria-labelledby")).toBeTruthy();
    // Days + Mix + Areas are each a fieldset/legend (so heading levels never skip).
    const fieldsets = [...panel.querySelectorAll("fieldset")];
    expect(fieldsets.length).toBeGreaterThanOrEqual(3);
    for (const fs of fieldsets) expect(fs.querySelector("legend")).toBeTruthy();
    // No Tooltip-free heading inside the panel (it mounts under the page's h3).
    expect(panel.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(0);
  });
});

describe("each control writes THROUGH the D-a model to the POST body (DES-N157-D1, reachability S9)", () => {
  it("the mix preset click sends the preset's exact newReviewRatio on the wire", async () => {
    await mountAndSelect();
    await openPanel();
    await click(buttonByName(STUDY_COPY.knobs.mixMostlyNew));
    await clickCreate();
    expect(planBody().knobs.newReviewRatio).toBe(MOSTLY_NEW.value);
  });

  it("the days field commits a VALID whole number to pace.daysUntil (DES-N157-D11)", async () => {
    await mountAndSelect();
    await openPanel();
    const field = fieldByLabel(STUDY_COPY.knobs.daysLegend);
    expect(field, "days field not found").toBeTruthy();
    await typeInto(field, "21");
    await clickCreate();
    expect(planBody().knobs.pace.daysUntil).toBe(21);
  });

  it("the days field REFUSES an invalid value: shows the <max>-slotted error and does NOT silently rewrite it (F9)", async () => {
    await mountAndSelect();
    const panel = await openPanel();
    const field = fieldByLabel(STUDY_COPY.knobs.daysLegend);
    await typeInto(field, "0");
    // The error copy, with the retunable cap filled from the CONSTANT (never a literal).
    expect(panel.textContent).toContain(fillStudyCopy(STUDY_COPY.knobs.daysError, { max: MAX_PLAN_DAYS }));
    await clickCreate();
    // The normalizer never saw "0": the committed value is still the default 7,
    // not the 7 a silent normalizer-rewrite of "0" would ALSO produce by accident.
    // The control shows the error rather than committing, which the error-copy
    // assertion above proves; here we pin the wire stays at the default.
    expect(planBody().knobs.pace.daysUntil).toBe(normalizeKnobs(null).pace.daysUntil);
  });

  it("the per-area Focus toggle writes the AREA LABEL into weakTopicIds (PD-SD-1, DES-N157-D9)", async () => {
    await mountAndSelect();
    const panel = await openPanel();
    await click(areaToggle(panel, "Interview process", STUDY_COPY.knobs.focus));
    await clickCreate();
    const knobs = planBody().knobs;
    expect(knobs.weakTopicIds).toContain("Interview process");
    // It is the label, never a topic id, and it never also lands in excluded.
    expect(knobs.topicScope.excludedAreas).not.toContain("Interview process");
  });
});

describe("zero-click default (DES-N157-D3, minimize-clicks S12)", () => {
  it("with NOTHING opened or touched, Create sends knobs deep-equal to normalizeKnobs(null)", async () => {
    await mountAndSelect();
    await clickCreate();
    // POSITIVE assertion: the body carries the explicit default knobs object, not
    // an omitted key. RED on HEAD because the shell still sends `undefined`.
    expect(planBody().knobs).toEqual(normalizeKnobs(null));
  });

  it("CONTROL: a touched run differs from the zero-touch body (the default assertion is not vacuous)", async () => {
    await mountAndSelect();
    await openPanel();
    await click(buttonByName(STUDY_COPY.knobs.mixMostlyNew));
    await clickCreate();
    expect(planBody().knobs).not.toEqual(normalizeKnobs(null));
  });
});

describe("the assembled knobs match the schema SHAPE on the wire (whole-knobs / wrong-shape canary, DES-N157-D2)", () => {
  it("a mixed customization emits exactly the four keys and a normalizer-STABLE object", async () => {
    await mountAndSelect();
    const panel = await openPanel();
    await click(buttonByName(STUDY_COPY.knobs.mixMostlyNew));
    await typeInto(fieldByLabel(STUDY_COPY.knobs.daysLegend), "21");
    await click(areaToggle(panel, "Interview process", STUDY_COPY.knobs.focus));
    await clickCreate();

    const knobs = planBody().knobs;
    // The whole-knobs / wrong-shape canary: if a control emitted a field the
    // schema drops (an extra pace.hoursPerDay) or an unnormalized value, this
    // JOIN through the REAL normalizer stops being idempotent and reds -- without
    // this test re-implementing one schema rule.
    expect(knobs).toEqual(normalizeKnobs(knobs));
    expect(Object.keys(knobs).sort()).toEqual(["newReviewRatio", "pace", "topicScope", "weakTopicIds"]);
    // ...and every selection is actually present (so the shape check is not
    // passing over an empty default object).
    expect(knobs.newReviewRatio).toBe(MOSTLY_NEW.value);
    expect(knobs.pace.daysUntil).toBe(21);
    expect(knobs.weakTopicIds).toContain("Interview process");
  });
});

describe("topic-scope source: pre-first-plan area options are the digest sections (DES-N157-D8, section 3.8)", () => {
  it("pre-plan the panel lists the DIGEST_SECTIONS (fed in by the shell as seedAreas), and mounts without a plan without crashing", async () => {
    await mountAndSelect();
    const panel = await openPanel();
    for (const section of DIGEST_SECTIONS) {
      expect(panel.textContent, `missing seed area "${section}"`).toContain(section);
    }
    // Each seed area is toggleable: there is a Focus and a Skip control per row.
    expect([...panel.querySelectorAll("button")].filter((b) => b.textContent.trim() === STUDY_COPY.knobs.focus).length).toBe(DIGEST_SECTIONS.length);
  });
});

describe("per-engine honesty (DES-N157-D13; knobEffects)", () => {
  it("gemini shows all four controls and the Gemini caption, not the embedded one", async () => {
    engineValue = "gemini";
    await mountAndSelect();
    const panel = await openPanel();
    expect(panel.textContent).toContain(STUDY_COPY.knobs.geminiCaption);
    expect(panel.textContent).not.toContain(STUDY_COPY.knobs.embeddedCaption);
    // The Gemini-only knobs are present and operable: days field + Focus toggles.
    expect(fieldByLabel(STUDY_COPY.knobs.daysLegend)).toBeTruthy();
    const focusEnabled = [...panel.querySelectorAll("button")].filter((b) => b.textContent.trim() === STUDY_COPY.knobs.focus && !b.disabled);
    expect(focusEnabled.length).toBeGreaterThan(0);
  });

  it("embedded hides/disables the Gemini-only knobs and states the embedded caption", async () => {
    engineValue = "embedded";
    await mountAndSelect();
    const panel = await openPanel();
    expect(panel.textContent).toContain(STUDY_COPY.knobs.embeddedCaption);
    // No OPERABLE Gemini-only knob under embedded: no enabled Focus toggle, and
    // the days field is absent or disabled (knobEffects embedded: pace/weakAreas false).
    const focusEnabled = [...panel.querySelectorAll("button")].filter((b) => b.textContent.trim() === STUDY_COPY.knobs.focus && !b.disabled);
    expect(focusEnabled).toHaveLength(0);
    const days = fieldByLabel(STUDY_COPY.knobs.daysLegend);
    expect(days === null || days.disabled === true).toBe(true);
    // The mix (both engines) stays operable, so a choice is still stored.
    expect([...panel.querySelectorAll("button")].some((b) => b.textContent.trim() === STUDY_COPY.knobs.mixEven && !b.disabled)).toBe(true);
  });
});

describe("egress (PD-SD-3, DES-N157-D16): the Gemini notice names the knob choices, and stays outside the collapsed panel", () => {
  it("the egress notice carries the focus/skip sentence and is visible with the panel BOTH closed and open", async () => {
    await mountAndSelect();
    // Visible before opening the panel (never buried inside the collapsible region).
    expect(text()).toContain(EGRESS_SENTENCE);
    const panel = await openPanel();
    expect(text()).toContain(EGRESS_SENTENCE);
    // ...and it is NOT inside the collapsed panel element.
    expect(panel.textContent).not.toContain(EGRESS_SENTENCE);
  });
});

describe("mobile-first, jsdom-decidable (DES-N157-D19): touch floor + aria from the shared tokens", () => {
  it("the disclosure, a mix segment and an area toggle each meet MOBILE_TAP_MIN at xs and are auto above it", async () => {
    await mountAndSelect();
    const panel = await openPanel();
    const disclosure = buttonByName(STUDY_COPY.knobs.disclosureCreate);
    const segment = buttonByName(STUDY_COPY.knobs.mixEven);
    const toggle = areaToggle(panel, "Interview process", STUDY_COPY.knobs.focus);
    for (const el of [disclosure, segment, toggle]) {
      expect(el, "a control for the touch-floor check is missing").toBeTruthy();
      expect(atWidth(375, () => window.getComputedStyle(el).minHeight)).toBe(`${MOBILE_TAP_MIN}px`);
      expect(atWidth(1000, () => window.getComputedStyle(el).minHeight)).toBe("auto");
    }
  });

  it("the area toggles carry aria-pressed (named by visible text only, no aria-label override)", async () => {
    await mountAndSelect();
    const panel = await openPanel();
    const focus = areaToggle(panel, "Interview process", STUDY_COPY.knobs.focus);
    expect(focus.hasAttribute("aria-pressed")).toBe(true);
    expect(focus.getAttribute("aria-label")).toBeNull();
    await click(focus);
    expect(focus.getAttribute("aria-pressed")).toBe("true");
  });
});
