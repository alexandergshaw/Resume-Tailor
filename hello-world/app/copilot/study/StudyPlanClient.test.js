// @vitest-environment jsdom
//
// N157 SC-C sub-chunk C-c (4b TDD seat) -- the integration SHELL (StudyPlanClient):
// the create-time lifecycle state machine, the ONE live region, the required
// application picker, and the end-to-end preserve-last-good (PD-1). Binds to
// docs/loop/N157.SC-C.design.r2.md section 4.1 (state table S0-S9), 4.2
// (two-phase create), 4.3 (preserve-last-good, Layer 2 display), section 6 (one
// role=status region), the pinned strings of section 7, and ledger DES-N157-C7,
// C8, C13, C14, C15 (live region), C10 (Layer-2 display half).
//
// HOW IT IS DRIVEN (reachability is first-class). The real shell is mounted and
// driven the way a user drives it: the posting is chosen through the real
// PostingPicker (keyboard-open + click the option), and "Create study plan" is a
// real click. The ONLY seams stubbed are the ones outside the browser: the
// engine store, the posting loader, the Supabase binding (studyPlanBrowser's
// reader/writer), and globalThis.fetch. The orchestration under test
// (studyPlanBuild + studyPlanBuildClient + ensureStudyDigest) runs for real, so
// a direct-handler shortcut cannot satisfy these.
//
// RED on HEAD: app/copilot/study/StudyPlanClient.js does not exist yet, so the
// import throws and every `it` reds -- the honest greenfield red.
//
// THE MUTANT THIS FILE IS BUILT TO KILL (watched in tests.r1.md): the
// blank-good-plan mutant -- on a failed (preserved) rebuild, drop the displayed
// plan (reload/clear lastGood, or render the failure state without the plan).
// The last test reds when that lands: the card text vanishes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { normalizePlan } from "@/lib/studyPlan/studyPlanSchema.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---- controllable seams -------------------------------------------------
let engineValue = "gemini";
vi.mock("@/app/settings/engine", () => ({
  useEngine: () => ({ engine: engineValue, setEngine: () => {} }),
  readEngine: () => engineValue,
}));

const fetchPracticePostings = vi.fn();
vi.mock("@/lib/copilot/postings", () => ({ fetchPracticePostings: (...a) => fetchPracticePostings(...a) }));

// The Supabase binding is stubbed: a controllable reader and a writer spy. The
// shell must reach Supabase ONLY through this module (section 5.6).
const reader = vi.fn(async () => readerResult);
const writer = vi.fn(async () => ({ written: true, error: null }));
const bindStudyPlan = vi.fn(() => ({ reader, writer }));
vi.mock("@/lib/studyPlan/studyPlanBrowser.js", () => ({ bindStudyPlan: (...a) => bindStudyPlan(...a) }));

// ---- fixtures -----------------------------------------------------------
const OPTION = { id: "app-7", title: "Staff Engineer", company: "Acme", label: "Staff Engineer — Acme" };

const READY_PLAN = normalizePlan({
  engine: "gemini",
  provenance: { research: "complete" },
  modules: [{ id: "m1", title: "Module One", topics: [{ id: "t1", title: "Topic One", items: [{ topicHint: "t1", kind: "new", text: "ALPHA prompt", reveal: "ALPHA answer", citations: [] }] }] }],
});
const EMPTY_RECORD = { status: null, plan: null, knobs: null, progress: null, cachedResearch: null, researchedAt: null, engine: null, error: null };
const READY_RECORD = { status: "ready", plan: READY_PLAN, knobs: null, progress: null, cachedResearch: null, researchedAt: null, engine: "gemini", error: null };

let readerResult = EMPTY_RECORD;

// ---- fetch stub ---------------------------------------------------------
let digestResponder;
let planResponder;
let digestGate; // when set, the digest fetch waits on it before resolving

function response(json, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => json };
}

function installFetch() {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/application-digest")) {
      if (digestGate) await digestGate.promise;
      return digestResponder();
    }
    if (u.includes("/api/study-plan")) return planResponder();
    throw new Error("unexpected fetch: " + u);
  });
  return globalThis.fetch;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

// ---- store resets (module-scope stores persist across tests) ------------
let resetBuild;
let resetProgress;
let StudyPlanClient;
let container;
let root;
let originalFetch;

beforeEach(async () => {
  engineValue = "gemini";
  readerResult = EMPTY_RECORD;
  digestGate = null;
  digestResponder = () => response({ digest: { status: "ready" } });
  planResponder = () => response({ status: "ready", partial: false, reason: null });

  reader.mockClear();
  writer.mockClear();
  bindStudyPlan.mockClear();
  fetchPracticePostings.mockReset();
  fetchPracticePostings.mockResolvedValue([OPTION]);

  originalFetch = globalThis.fetch;
  installFetch();

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

// ---- helpers ------------------------------------------------------------
async function mount() {
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(StudyPlanClient, null)));
  });
  await flush();
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
const text = () => document.body.textContent || "";
const buttonByName = (name) => [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
async function click(btn) {
  expect(btn, "button not found").toBeTruthy();
  await act(async () => btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await flush();
}

// Pick the one posting through the real Autocomplete: focus, ArrowDown to open
// the listbox, then click the rendered option (a reachable keyboard+pointer path).
async function selectPosting() {
  const input = document.body.querySelector(".MuiAutocomplete-root input") || document.body.querySelector("input");
  await act(async () => {
    input.focus();
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await flush();
  const option = document.body.querySelector('[role="option"]');
  expect(option, "no option rendered to select").toBeTruthy();
  await click(option);
}

// The shell's OWN live region: role=status + aria-live=polite, excluding any
// region MUI's Autocomplete renders inside its own root.
function shellStatusRegions() {
  return [...document.body.querySelectorAll('[role="status"][aria-live="polite"]')].filter((el) => !el.closest(".MuiAutocomplete-root"));
}

// -------------------------------------------------------------------------
describe("S0: an application is REQUIRED (no =\"\" default reaches the store)", () => {
  it("with nothing selected, Create is disabled and names a visible reason via aria-describedby", async () => {
    await mount();
    const create = buttonByName(STUDY_COPY.picker.createButton);
    expect(create).toBeTruthy();
    expect(create.disabled).toBe(true);
    const describedby = create.getAttribute("aria-describedby");
    expect(describedby).toBeTruthy();
    const reason = document.getElementById(describedby);
    expect(reason?.textContent).toBe(STUDY_COPY.picker.disabledCreateReason);
  });

  it("no record load fires while nothing is selected (no blank applicationId reaches the reader)", async () => {
    await mount();
    expect(reader).not.toHaveBeenCalled();
  });
});

describe("S6/one live region: exactly one role=status[aria-live=polite] at the shell, persistent", () => {
  it("is present on first render, before any selection", async () => {
    await mount();
    expect(shellStatusRegions()).toHaveLength(1);
  });

  it("stays a SINGLE region while a build is running, and its text reflects the phase", async () => {
    digestGate = deferred(); // pause in phase 1 so the researching text is observable
    await mount();
    await selectPosting();
    await click(buttonByName(STUDY_COPY.picker.createButton));

    const regions = shellStatusRegions();
    expect(regions).toHaveLength(1);
    // The text updated from empty to the researching status (text change, not a
    // second region) -- the property a per-call announce counter cannot hold.
    expect(regions[0].textContent).toContain("Researching Acme");

    digestGate.resolve();
    await flush();
  });
});

describe("S3 -> S7: the two-phase create, driven through the real UI", () => {
  it("selecting shows the intro + the Gemini egress notice and an enabled Create", async () => {
    await mount();
    await selectPosting();
    expect(text()).toContain("Build a study plan for Staff Engineer at Acme");
    expect(text()).toContain(STUDY_COPY.notice.gemini);
    expect(buttonByName(STUDY_COPY.picker.createButton).disabled).toBe(false);
  });

  it("Create researches (phase 1) THEN builds (phase 2), then renders the walkthrough card", async () => {
    digestGate = deferred();
    await mount();
    await selectPosting();
    const fetchSpy = globalThis.fetch;
    await click(buttonByName(STUDY_COPY.picker.createButton));

    // Phase 1 fired; phase 2 has NOT (ordering).
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/api/application-digest"))).toBe(true);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/api/study-plan"))).toBe(false);

    // The record becomes ready once phase 2 reloads it.
    readerResult = READY_RECORD;
    digestGate.resolve();
    await flush();

    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/api/study-plan"))).toBe(true);
    expect(text()).toContain("ALPHA prompt"); // the walkthrough card is on screen
  });
});

describe("S5: a digest that fails with HTTP 200 + status:failed is surfaced, not crashed (F4)", () => {
  it("shows the research-failed copy and never calls the plan route", async () => {
    digestResponder = () => response({ digest: { status: "failed", error: "No public info found." } });
    await mount();
    await selectPosting();
    const fetchSpy = globalThis.fetch;
    await click(buttonByName(STUDY_COPY.picker.createButton));

    expect(text()).toContain("We couldn't research this company: No public info found.");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/api/study-plan"))).toBe(false);
  });
});

describe("Embedded engine: phase 1 is skipped (it can only 503), phase 2 runs directly (F4)", () => {
  it("creates without ever calling the digest route; a no-research result shows the embedded copy", async () => {
    engineValue = "embedded";
    planResponder = () => response({ status: "unavailable", partial: false, reason: "no-research" });
    await mount();
    await selectPosting();
    const fetchSpy = globalThis.fetch;
    await click(buttonByName(STUDY_COPY.picker.createButton));

    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/api/application-digest"))).toBe(false);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/api/study-plan"))).toBe(true);
    expect(text()).toContain(STUDY_COPY.failure.embeddedNeedsResearch);
  });
});

describe("S8: a failed rebuild NEVER blanks the good plan on screen (PD-1 end-to-end)", () => {
  it("keeps the walkthrough and shows 'Your previous plan is unchanged' above it", async () => {
    readerResult = READY_RECORD; // a good plan already exists
    planResponder = () =>
      response({ status: "unavailable", partial: false, preserved: true, preservedReason: "good-plan", error: "The study plan could not be built." });

    await mount();
    await selectPosting();
    expect(text()).toContain("ALPHA prompt"); // S7 walkthrough

    // The mutant discriminator: a failed rebuild must NOT trigger a reload. A
    // reload replaces the in-memory record wholesale, so on a transient read it
    // blanks the good plan -- the exact silent defect R1/R14 names. We pin that
    // the reader is not called again across the rebuild. (With a preserving
    // server the row is unchanged, so "still shows ALPHA prompt" alone would
    // pass even if a reload fired; this count assertion is what bites.)
    const readsBefore = reader.mock.calls.length;

    // Rebuild from the outline: no progress, so a single click (no arm needed).
    await click(buttonByName(STUDY_COPY.card.outline));
    await click(buttonByName(STUDY_COPY.remedy.rebuildPlan));

    // The plan is STILL shown (not blanked), and the kept-plan alert is above it.
    expect(text()).toContain("ALPHA prompt");
    expect(text()).toContain(STUDY_COPY.failure.rebuildFailedKept);
    // reader was never re-read to blank the plan (Layer 2 display rule).
    expect(reader.mock.calls.length).toBe(readsBefore);
  });
});
