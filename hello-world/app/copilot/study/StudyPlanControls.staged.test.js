// @vitest-environment jsdom
//
// N157 SC-D wave D-b (step 4b TDD seat) -- the customization controls POST-PLAN,
// driven through the REAL StudyPlanClient shell: the STAGED-until-rebuild rule,
// the draft lifecycle (per application, per stored base, survives UI churn,
// retired by a success, kept by a failure), and the last-included Skip guard.
// Binds to docs/loop/N157.SC-D.design.r1.md sections 3.3, 3.7, 3.9 and the
// DES-N157-D4..D10, D15 ledger rows.
//
// REACHABILITY. The panel is reached the way a learner reaches it once a plan
// exists: open the real "Plan outline", open the real "Plan settings"
// disclosure, operate the real controls, and drive the real "Rebuild plan". Knob
// effects are read from the POST /api/study-plan BODY, never component state.
//
// RED ON HEAD: the D-b modules and the four C-c wiring edits do not exist, so the
// "Plan settings" disclosure is not in the DOM and every test reds at the "open
// the panel" step. The staged tests additionally red because a knob change today
// has no effect at all (there is no draft and no dirty note).
//
// THE MUTANT THIS FILE IS BUILT TO KILL (watched in tests.r1.md): the
// SKIP-LAST-AREA mutant -- the control stops disabling the Skip toggle of the
// last included area (or the model stops refusing it), which lets a learner
// build a plan with every area excluded (NO_CARDS_ERROR). The last-included test
// reds because that toggle is no longer disabled. The no-op control is the
// unmutated reference.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { GRADE } from "@/lib/studyPlan/studyWalkthroughModel.js";
import { itemKey, normalizePlan } from "@/lib/studyPlan/studyPlanSchema.js";
import { RATIO_PRESETS } from "@/lib/studyPlan/studyPlanKnobs.js";
import { REBUILD_CONFIRM_WINDOW_MS } from "./StudyPlanOverview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---- seams --------------------------------------------------------------
let engineValue = "gemini";
vi.mock("@/app/settings/engine", () => ({
  useEngine: () => ({ engine: engineValue, setEngine: () => {} }),
  readEngine: () => engineValue,
}));

let postings = [];
const fetchPracticePostings = vi.fn();
vi.mock("@/lib/copilot/postings", () => ({ fetchPracticePostings: (...a) => fetchPracticePostings(...a) }));

// Records keyed by applicationId, so an application switch reads a DIFFERENT
// stored record (draft isolation). The reader merges the last knobs POSTed for
// that application, modelling the server persisting a successful rebuild's knobs
// (a preserved/failed rebuild never reloads, so it never sees this merge).
let recordsById = {};
let lastPosted = {};
const writer = vi.fn(async () => ({ written: true, error: null }));
const bindStudyPlan = vi.fn((id) => ({
  reader: async () => {
    const rec = recordsById[id] ?? EMPTY_RECORD;
    return lastPosted[id] ? { ...rec, knobs: lastPosted[id] } : rec;
  },
  writer,
}));
vi.mock("@/lib/studyPlan/studyPlanBrowser.js", () => ({ bindStudyPlan: (...a) => bindStudyPlan(...a) }));

// ---- fixtures -----------------------------------------------------------
const OPTION_A = { id: "app-A", title: "Staff Engineer", company: "Acme", label: "Staff Engineer - Acme" };
const OPTION_B = { id: "app-B", title: "Platform Lead", company: "Globex", label: "Platform Lead - Globex" };

const A1 = { topicHint: "t1", kind: "new", text: "ALPHA prompt", reveal: "ALPHA answer", citations: [] };
const B1 = { topicHint: "t2", kind: "new", text: "BRAVO prompt", reveal: "BRAVO answer", citations: [] };

// Two distinct areas; title == area so the label is "Interview process" /
// "Watch-outs" regardless of whether the schema keeps `area`.
const TWO_AREA_PLAN = normalizePlan({
  engine: "gemini",
  provenance: { research: "complete", unsourcedTopicIds: [] },
  modules: [
    {
      id: "m1",
      title: "Module One",
      topics: [
        { id: "t1", title: "Interview process", area: "Interview process", items: [A1] },
        { id: "t2", title: "Watch-outs", area: "Watch-outs", items: [B1] },
      ],
    },
  ],
});

const EMPTY_RECORD = { status: null, plan: null, knobs: null, progress: null, cachedResearch: null, researchedAt: null, engine: null, error: null };
function readyRecord(overrides) {
  return {
    status: "ready",
    plan: TWO_AREA_PLAN,
    knobs: null, // defaults as the base
    progress: null,
    cachedResearch: null,
    researchedAt: null,
    engine: "gemini",
    error: null,
    ...overrides,
  };
}
const PROGRESS_DONE1 = { seen: { [itemKey(A1)]: { grade: GRADE.GOT_IT, revealedAt: "2026-01-01T00:00:00.000Z" } } };
const MOSTLY_NEW = RATIO_PRESETS.find((p) => p.id === "mostly-new");

// ---- fetch --------------------------------------------------------------
let fetchMock;
let originalFetch;
let planResponder;
function reply(json) {
  return { ok: true, status: 200, json: async () => json };
}

// ---- store resets -------------------------------------------------------
let resetBuild;
let resetProgress;
let StudyPlanClient;
let container;
let root;

beforeEach(async () => {
  engineValue = "gemini";
  recordsById = { "app-A": readyRecord(), "app-B": readyRecord() };
  lastPosted = {};
  postings = [OPTION_A, OPTION_B];
  planResponder = () => reply({ status: "ready", partial: false, reason: null });

  bindStudyPlan.mockClear();
  writer.mockClear();
  fetchPracticePostings.mockReset();
  fetchPracticePostings.mockResolvedValue(postings);

  originalFetch = globalThis.fetch;
  fetchMock = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes("/api/application-digest")) return reply({ digest: { status: "ready" } });
    if (u.includes("/api/study-plan")) {
      const body = JSON.parse(init.body);
      lastPosted[body.applicationId] = body.knobs;
      return planResponder();
    }
    throw new Error("unexpected fetch " + u);
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
  if (vi.isFakeTimers()) vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- helpers ------------------------------------------------------------
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
const callsToPlan = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/study-plan"));
function lastPlanBody() {
  const calls = callsToPlan();
  expect(calls.length, "no POST /api/study-plan fired").toBeGreaterThan(0);
  return JSON.parse(calls[calls.length - 1][1].body);
}

async function mount() {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(StudyPlanClient, null)));
  });
  await flush();
}
// Choose the posting whose option text includes `fragment` through the real
// Autocomplete keyboard+pointer path.
async function choosePosting(fragment) {
  const input = document.body.querySelector(".MuiAutocomplete-root input");
  await act(async () => {
    input.focus();
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await flush();
  const option = [...document.body.querySelectorAll('[role="option"]')].find((o) => (o.textContent || "").includes(fragment));
  await click(option);
}
async function mountWith(fragment, { progress } = {}) {
  if (progress) {
    recordsById["app-A"] = readyRecord({ progress });
    recordsById["app-B"] = readyRecord({ progress });
  }
  await mount();
  await choosePosting(fragment);
  // S7 reached: the outline toggle is present whichever card is current (with
  // progress the walkthrough opens on the first PENDING card, not necessarily A1).
  expect(buttonByName(STUDY_COPY.card.outline), "the walkthrough (S7) did not render for the ready plan").toBeTruthy();
}

// Open the outline, then the "Plan settings" disclosure; return the panel element.
async function openSettings() {
  await click(buttonByName(STUDY_COPY.card.outline));
  const disclosure = buttonByName(STUDY_COPY.knobs.disclosureOutline);
  expect(disclosure, "the 'Plan settings' disclosure is not in the DOM").toBeTruthy();
  await click(disclosure);
  const panelId = disclosure.getAttribute("aria-controls");
  const panel = panelId ? document.getElementById(panelId) : null;
  expect(panel, "the 'Plan settings' aria-controls does not resolve to a panel").toBeTruthy();
  return panel;
}
// The toggle named `name` in the area row labelled `area`. Located from the area
// LABEL element (robust to MUI's ToggleButtonGroup also carrying role=group).
function areaToggle(panel, area, name) {
  const label = [...panel.querySelectorAll("*")].find((el) => el.children.length === 0 && (el.textContent || "").trim() === area);
  const row = label ? label.closest('[role="group"]') : null;
  return row ? [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === name) ?? null : null;
}
const dirty = () => text().includes(STUDY_COPY.knobs.dirtyNote);

// -------------------------------------------------------------------------
describe("a knob change after a plan exists is STAGED, never auto-rebuilt (DES-N157-D7, OD-SD-3)", () => {
  it("changing the mix shows the dirty note and fires NO build; the explicit Rebuild then carries the CHANGED knobs", async () => {
    await mountWith("Acme"); // done === 0, so Rebuild is a single click
    const panel = await openSettings();
    expect(dirty()).toBe(false);

    await click([...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === STUDY_COPY.knobs.mixMostlyNew));

    // Staged: the note appears and NOTHING was sent.
    expect(dirty()).toBe(true);
    expect(callsToPlan()).toHaveLength(0);

    // CONTROL + draft-carried: the explicit Rebuild fires exactly one build, with
    // the changed ratio -- so "no fetch" above is staging, not a dead control.
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    expect(callsToPlan()).toHaveLength(1);
    expect(lastPlanBody().knobs.newReviewRatio).toBe(MOSTLY_NEW.value);
  });

  it("with progress, a staged change does NOT bypass the armed window: one tap only ARMS (no build), and it reverts on its own", async () => {
    await mountWith("Acme", { progress: PROGRESS_DONE1 }); // done === 1 -> armed rebuild
    const panel = await openSettings();
    await click([...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === STUDY_COPY.knobs.mixMostlyNew));
    expect(dirty()).toBe(true);

    vi.useFakeTimers();
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    // First tap armed; it did NOT rebuild (the one-tap-doesn't-rebuild guard).
    expect(buttonByName(STUDY_COPY.remedy.confirmRebuild)).toBeTruthy();
    expect(callsToPlan()).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REBUILD_CONFIRM_WINDOW_MS);
    });
    expect(buttonByName(STUDY_COPY.remedy.confirmRebuild)).toBeFalsy();
    expect(callsToPlan()).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe("the last included area cannot be skipped (DES-N157-D10; skip-last-area mutant)", () => {
  it("after skipping one of two areas, the other area's Skip is disabled with a visible aria-describedby reason", async () => {
    await mountWith("Acme");
    const panel = await openSettings();

    // Skip "Interview process" -> only "Watch-outs" remains included.
    await click(areaToggle(panel, "Interview process", STUDY_COPY.knobs.skip));

    const lastSkip = areaToggle(panel, "Watch-outs", STUDY_COPY.knobs.skip);
    expect(lastSkip, "the last area's Skip toggle was not found").toBeTruthy();
    expect(lastSkip.disabled).toBe(true);
    // The reason is a VISIBLE node (never an aria-label), resolved by aria-describedby.
    const describedby = lastSkip.getAttribute("aria-describedby");
    expect(describedby, "no aria-describedby on the blocked Skip").toBeTruthy();
    const reason = describedby.split(/\s+/).map((id) => document.getElementById(id)).find(Boolean);
    expect(reason?.textContent).toContain(STUDY_COPY.knobs.lastIncludedReason);
  });

  it("a Skip that IS allowed writes the area label into topicScope.excludedAreas on the next rebuild", async () => {
    await mountWith("Acme");
    const panel = await openSettings();
    await click(areaToggle(panel, "Interview process", STUDY_COPY.knobs.skip));
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    expect(lastPlanBody().knobs.topicScope.excludedAreas).toContain("Interview process");
  });
});

describe("the draft survives UI churn but is per-application and per-stored-base (DES-N157-D5, D6)", () => {
  it("survives closing and reopening the Plan settings disclosure", async () => {
    await mountWith("Acme");
    let panel = await openSettings();
    await click([...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === STUDY_COPY.knobs.mixMostlyNew));
    expect(dirty()).toBe(true);

    // Close the "Plan settings" disclosure, then reopen it.
    await click(buttonByName(STUDY_COPY.knobs.disclosureOutline));
    await click(buttonByName(STUDY_COPY.knobs.disclosureOutline));
    expect(dirty()).toBe(true); // the draft outlived the churn
  });

  it("is dropped when the user switches to another application and back (one slot; wrong-company-plan guard)", async () => {
    await mountWith("Acme");
    const panel = await openSettings();
    await click([...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === STUDY_COPY.knobs.mixMostlyNew));
    expect(dirty()).toBe(true);

    // Switch to Globex: its own base, no dirty note carried across.
    await choosePosting("Globex");
    await openSettings();
    expect(dirty()).toBe(false);

    // Back to Acme: the single draft slot was taken by Globex, so Acme is clean.
    await choosePosting("Acme");
    await openSettings();
    expect(dirty()).toBe(false);
  });

  it("is RETIRED by a successful rebuild (the stored base now equals the draft)", async () => {
    await mountWith("Acme");
    const panel = await openSettings();
    await click([...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === STUDY_COPY.knobs.mixMostlyNew));
    expect(dirty()).toBe(true);

    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan)); // ready: reload reads back the posted knobs
    // The reload makes base == the changed knobs, so the draft retires itself.
    expect(dirty()).toBe(false);
    expect(lastPlanBody().knobs.newReviewRatio).toBe(MOSTLY_NEW.value);
  });

  it("is KEPT by a preserved rebuild, and 'Try again' re-sends what the learner set", async () => {
    await mountWith("Acme");
    const panel = await openSettings();
    await click([...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === STUDY_COPY.knobs.mixMostlyNew));

    // A preserved failure: the server withholds the write, so no reload fires and
    // the stored base is unchanged -> the draft stays valid.
    planResponder = () => reply({ status: "unavailable", partial: false, preserved: true, preservedReason: "good-plan", error: "The study plan could not be built." });
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));
    expect(callsToPlan()).toHaveLength(1);
    expect(dirty()).toBe(true); // draft kept across the failure

    // Try again (from the kept-plan alert) re-sends the SAME changed knobs.
    planResponder = () => reply({ status: "ready", partial: false, reason: null });
    await click(buttonByName(STUDY_COPY.failure.tryAgain));
    expect(callsToPlan()).toHaveLength(2);
    expect(lastPlanBody().knobs.newReviewRatio).toBe(MOSTLY_NEW.value);
  });
});
