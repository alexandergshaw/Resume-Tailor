// @vitest-environment jsdom
//
// The tracking surface's re-render budget: a page re-render that changes
// nothing about a row must not re-render that row.
//
// WHY THIS EXISTS. Every button on the tracking page is a setState on
// app/page.js, which re-renders the whole page component and, before this pass,
// every tracking row/card with it (nothing was memoized, the handlers were
// rebuilt each render, and the derived props were fresh arrays/objects). jsdom
// cannot time a render, so this proves the MEMOIZATION STRUCTURALLY: it counts
// how many times each row's body actually runs and asserts the count does not
// move when it should not.
//
// THE INSTRUMENT. Every row and card calls `safeExternalHref(app.application_url
// || pos.url)` exactly once per render, unconditionally (ApplicationRow.js,
// ApplicationCard.js). The mock below passes the call through and counts it by
// URL; each fixture application has its own URL, so the count is a per-row
// render count in either layout. The "[control]" tests show the counter moves
// when a row DOES have to re-render, so an unchanged count means "skipped", not
// "the instrument is dead".
//
// THE HOST. A stateful parent that, like app/page.js, hands TrackingTab a FRESH
// closure for every handler on every render. That is the production shape the
// stabilisation has to survive; with plain props instead, a memo would hold
// without proving anything.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, memo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import TrackingTab from "./TrackingTab.js";
import ApplicationCard from "./tracking/ApplicationCard.js";
import ApplicationRow from "./tracking/ApplicationRow.js";
import { makeTheme } from "../theme/index.js";
import { createStageDialogState } from "../../lib/tracking/stages.js";

const renders = vi.hoisted(() => ({ byUrl: new Map() }));

vi.mock("@/lib/url/safeExternalHref", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    safeExternalHref: (value) => {
      renders.byUrl.set(value, (renders.byUrl.get(value) || 0) + 1);
      return actual.safeExternalHref(value);
    },
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let host;
let calls;

function mockMatchMedia(matches) {
  window.matchMedia = vi.fn((query) => ({
    matches,
    media: String(query),
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

beforeEach(() => {
  renders.byUrl.clear();
  calls = { edit: [], preview: [], stageError: [], stageDialog: [] };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------ fixtures

const IDS = ["a1", "a2", "a3"];
const urlOf = (id) => `https://jobs.example.com/apply/${id}`;

function makeApp(id, overrides = {}) {
  return {
    id,
    status: "applied",
    applied_at: "2026-01-05T00:00:00.000Z",
    application_url: urlOf(id),
    positions: {
      id: `pos-${id}`,
      external_id: `ext-${id}`,
      company: `Company ${id}`,
      title: `Engineer ${id}`,
      url: null,
      description: `Build things at ${id}.`,
    },
    generated_resumes: { content: `Resume ${id}`, content_lines: [`Resume ${id}`], docx_path: `r/${id}.docx` },
    generated_cover_letters: null,
    ...overrides,
  };
}

const NO_STAGES = {};
const NO_CLASSIFICATIONS = {};
const NO_DIGESTS = {};
const NO_RESEARCHING = new Set();
const RESUME_FILE = { name: "base-resume.docx" };
const IS_DOCX_RESUME = () => true;
const APP_DIALOG_CLOSED = { open: false, rowIndex: null, kind: "jd" };

// A stateful stand-in for app/page.js. Everything TrackingTab receives that is
// DATA is state (stable until a test changes it); everything that is a HANDLER
// is a fresh closure per render, exactly as page.js and its hooks produce.
function Host() {
  const [tick, setTick] = useState(0);
  const [apps, setApps] = useState(() => IDS.map((id) => makeApp(id)));
  const [appDialog, setAppDialogState] = useState(APP_DIALOG_CLOSED);
  const [stages, setStages] = useState(NO_STAGES);
  const [classifications, setClassifications] = useState(NO_CLASSIFICATIONS);
  const [digests, setDigests] = useState(NO_DIGESTS);
  const [highlighted, setHighlighted] = useState(null);
  host = { setTick, setApps, setStages, setClassifications, setDigests, setHighlighted };

  return createElement(TrackingTab, {
    currentUser: { id: "u1" },
    applicationLoading: false,
    applicationError: "",
    applicationData: apps,
    visibleApplicationData: apps,
    applicationStages: stages,
    interviewSearch: "",
    setInterviewSearch: () => {},
    interviewSort: { field: null, dir: "asc" },
    setInterviewSort: () => {},
    companyColWidth: 140,
    roleColWidth: 180,
    resumeFile: RESUME_FILE,
    openAddApplicationDialog: () => {},
    toggleInterviewSort: () => {},
    sortLabelSx: () => ({}),
    startColResize: () => {},
    askAiAbout: () => {},
    buildApplicationContextString: () => `context ${tick}`,
    buildStageContextString: () => "stage context",
    openCommsInAppDialog: () => {},
    openAddCommunicationDialog: () => {},
    openEditApplicationDialog: (app) => calls.edit.push({ id: app.id, tick }),
    openApplicationPreview: (app) => calls.preview.push({ id: app.id, tick }),
    handleDeleteApplication: () => {},
    setAppDialog: (next) => setAppDialogState(next),
    setStageError: (value) => calls.stageError.push(value),
    setStageDialog: (value) => calls.stageDialog.push(value),
    // A module-level import in app/page.js (lib/document/docx), so stable in
    // production: it is called while a row RENDERS, which is why TrackingTab
    // passes it through rather than wrapping it (see useStableHandlers).
    isDocxResume: IS_DOCX_RESUME,
    downloadDocxFiles: async () => "",
    getDownloadFileNameForTitle: () => "name.docx",
    stageDialog: { open: false },
    stageError: "",
    stageSaving: false,
    handleSaveStage: () => {},
    communicationsDialog: { open: false, items: [] },
    setCommunicationsDialog: () => {},
    addCommunicationDialog: { open: false, body: "", files: [], kind: "email", subject: "", direction: "outbound", occurred_at: "" },
    setAddCommunicationDialog: () => {},
    communicationError: "",
    setCommunicationError: () => {},
    communicationSaving: false,
    handleSaveCommunication: () => {},
    editAppDialog: { open: false },
    setEditAppDialog: () => {},
    editAppSaving: false,
    editAppError: "",
    editAppResumeFile: null,
    setEditAppResumeFile: () => {},
    handleSaveEditApplication: () => {},
    addAppDialog: { open: false },
    setAddAppDialog: () => {},
    addAppSaving: false,
    addAppError: "",
    addAppResumeFile: null,
    setAddAppResumeFile: () => {},
    handleSaveAddApplication: () => {},
    appDialog,
    loadCommunicationsForApp: () => {},
    highlightedAppId: highlighted,
    emailClassificationsByAppId: classifications,
    digestsById: digests,
    researchingIds: NO_RESEARCHING,
    researchOne: () => {},
  });
}

async function mount(compact) {
  mockMatchMedia(compact);
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(Host)));
  });
}

const count = (id) => renders.byUrl.get(urlOf(id)) || 0;
const snapshot = () => Object.fromEntries(IDS.map((id) => [id, count(id)]));
const rowOf = (id) => container.querySelector(`[data-app-id="${id}"]`);
const buttonsIn = (node) => Array.from(node.querySelectorAll("button"));
const buttonNamed = (node, text) => buttonsIn(node).find((b) => (b.textContent || "").trim() === text);
const text = (node) => (node.textContent || "").replace(/\s+/g, " ").trim();
const run = (fn) => act(async () => { fn(); });
const click = (node) =>
  act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

// ------------------------------------------------------------ the instrument

describe("[control] the render counter is live", () => {
  it("counts every row once on mount, in both layouts", async () => {
    await mount(false);
    for (const id of IDS) expect(count(id), `desktop row ${id}`).toBeGreaterThan(0);
    await act(async () => root.unmount());
    root = createRoot(container);
    renders.byUrl.clear();
    await mount(true);
    for (const id of IDS) expect(count(id), `card ${id}`).toBeGreaterThan(0);
  });

  it("is moved by a parent re-render when the child is NOT stable (a memo fed a fresh closure)", async () => {
    let seen = 0;
    const Child = memo(function Child() {
      seen += 1;
      return null;
    });
    const STABLE_HANDLER = () => {};
    let bump;
    function Parent({ stable }) {
      const [, set] = useState(0);
      bump = () => set((n) => n + 1);
      const fixed = stable ? STABLE_HANDLER : () => {};
      return createElement(Child, { onThing: fixed });
    }
    await act(async () => root.render(createElement(Parent, { stable: true })));
    await act(async () => bump());
    expect(seen, "a stable prop must skip").toBe(1);
    seen = 0;
    await act(async () => root.render(createElement(Parent, { stable: false })));
    await act(async () => bump());
    expect(seen, "a fresh closure per render must re-render the memo").toBeGreaterThan(1);
  });

  it("every row component is a React.memo", () => {
    expect(ApplicationRow.$$typeof).toBe(Symbol.for("react.memo"));
    expect(ApplicationCard.$$typeof).toBe(Symbol.for("react.memo"));
  });
});

// ------------------------------------------------------------ the budget

describe.each([
  ["desktop table rows", false],
  ["compact cards", true],
])("%s: an unrelated page re-render re-renders no row", (_label, compact) => {
  it("a page re-render with a fresh closure for every handler leaves every count unchanged", async () => {
    await mount(compact);
    const before = snapshot();
    await run(() => host.setTick((n) => n + 1));
    await run(() => host.setTick((n) => n + 1));
    expect(snapshot()).toEqual(before);
  });

  it("opening a dialog from one row's button re-renders no row", async () => {
    await mount(compact);
    const before = snapshot();
    const open = compact ? buttonNamed(rowOf("a1"), "JD") : buttonNamed(rowOf("a1"), "View full");
    expect(open, "no JD button on row a1").toBeTruthy();
    await click(open);
    expect(document.body.querySelector('[role="dialog"]'), "the click did not reach setAppDialog").toBeTruthy();
    expect(snapshot()).toEqual(before);
  });

  it("[control] changing ONE row's data re-renders that row and no other", async () => {
    await mount(compact);
    const before = snapshot();
    await run(() =>
      host.setApps((list) =>
        list.map((a) => (a.id === "a2" ? { ...a, positions: { ...a.positions, company: "Globex" } } : a)),
      ),
    );
    expect(count("a2")).toBeGreaterThan(before.a2);
    expect(count("a1")).toBe(before.a1);
    expect(count("a3")).toBe(before.a3);
    expect(text(rowOf("a2"))).toContain("Globex");
  });

  it("[control] a fresh digestsById object DOES re-render every row (renderDigestCell depends on it)", async () => {
    await mount(compact);
    const before = snapshot();
    await run(() => host.setDigests((d) => ({ ...d })));
    for (const id of IDS) expect(count(id), `row ${id}`).toBeGreaterThan(before[id]);
  });

  it("a click handler always runs the LATEST function, not the one from first render", async () => {
    await mount(compact);
    await run(() => host.setTick((n) => n + 1));
    await run(() => host.setTick((n) => n + 1));
    await run(() => host.setTick((n) => n + 1));
    await click(buttonNamed(rowOf("a2"), "Edit"));
    expect(calls.edit).toEqual([{ id: "a2", tick: 3 }]);
    await click(buttonNamed(rowOf("a3"), "View/Edit"));
    expect(calls.preview).toEqual([{ id: "a3", tick: 3 }]);
  });
});

// The stage chip is the one row control whose handler moved (the desktop row
// now calls TrackingTab's openStageDialog; the card builds the same state
// itself). Both must hand the stage dialog the same state, including the
// stage-type default for a stage that has none.
describe.each([
  ["desktop table rows", false],
  ["compact cards", true],
])("%s: the stage chip opens the stage dialog", (_label, compact) => {
  it("clears the error and opens it on that stage, defaulting the type", async () => {
    await mount(compact);
    await run(() =>
      host.setStages({
        a3: [{
          id: "s1",
          stage_name: "Onsite loop",
          stage_type: null,
          outcome: "passed",
          scheduled_at: null,
          duration_minutes: 45,
          interviewer_names: ["Ann", "Bo"],
          notes: "Bring a laptop",
        }],
      }),
    );
    const chip = Array.from(rowOf("a3").querySelectorAll('[role="button"]')).find((el) => text(el).includes("Onsite loop"));
    expect(chip, "no stage chip on row a3").toBeTruthy();
    await click(chip);
    expect(calls.stageError).toEqual([""]);
    expect(calls.stageDialog).toEqual([
      createStageDialogState({
        open: true,
        applicationId: "a3",
        stageId: "s1",
        stageName: "Onsite loop",
        stageType: "phone_screen",
        scheduledAt: "",
        durationMinutes: "45",
        outcome: "passed",
        interviewerNames: "Ann, Bo",
        notes: "Bring a laptop",
      }),
    ]);
    expect(calls.edit, "the chip click leaked to the row's edit handler").toEqual([]);
  });
});

// A change to one row's own slice reaches that row's DOM and leaves the others
// alone. Desktop only: the phone card takes the whole stages / classification /
// highlight maps (its prop interface is pinned by ApplicationCard.viewEdit.test),
// so for it a change to either map re-renders every card by design.
describe("desktop rows take their own slice, and show it", () => {
  it("a stage added to row a3 appears there and re-renders only a3", async () => {
    await mount(false);
    const before = snapshot();
    await run(() =>
      host.setStages({ a3: [{ id: "s1", stage_name: "Onsite loop", stage_type: "onsite", outcome: "pending" }] }),
    );
    expect(text(rowOf("a3"))).toContain("Onsite loop");
    expect(text(rowOf("a1"))).not.toContain("Onsite loop");
    expect(count("a3")).toBeGreaterThan(before.a3);
    expect(count("a1")).toBe(before.a1);
    expect(count("a2")).toBe(before.a2);
  });

  it("an email classification on row a1 shows its pill there and re-renders only a1", async () => {
    await mount(false);
    const before = snapshot();
    expect(text(rowOf("a1"))).not.toContain("Interview");
    await run(() => host.setClassifications({ a1: "interview" }));
    expect(text(rowOf("a1"))).toContain("Interview");
    expect(count("a1")).toBeGreaterThan(before.a1);
    expect(count("a2")).toBe(before.a2);
    expect(count("a3")).toBe(before.a3);
  });

  it("highlighting row a2 re-renders a2 only", async () => {
    await mount(false);
    const before = snapshot();
    await run(() => host.setHighlighted("a2"));
    expect(count("a2")).toBeGreaterThan(before.a2);
    expect(count("a1")).toBe(before.a1);
    expect(count("a3")).toBe(before.a3);
  });

  it("a digest landing on a2 replaces its Research button there", async () => {
    await mount(false);
    expect(buttonNamed(rowOf("a2"), "Research")).toBeTruthy();
    await run(() => host.setDigests({ a2: { status: "ready", markdown: "Globex is hiring for platform work." } }));
    expect(buttonNamed(rowOf("a2"), "Research")).toBeUndefined();
    expect(buttonNamed(rowOf("a1"), "Research")).toBeTruthy();
  });
});
