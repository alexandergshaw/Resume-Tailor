// @vitest-environment jsdom
//
// N132 AC-11 (desktop parity, incl. COVER-ONLY rows) + AC-1/2/4 on the desktop
// table. The same "View/Edit" control as the mobile card, in the desktop
// resume cell (TrackingTab.js:743-757).
//
// THE SILENT FAILURE THIS GUARDS (plan R-4). The desktop resume cell today is
// `resume?.content ? (...) : "—"` -- a cover-only row (no stored resume,
// a stored cover) renders a literal em-dash and NOTHING else. If the control
// is dropped inside that ternary unchanged, the exact row the feature exists
// to reach (cover-only) still shows just a dash. The AC-11 case below drives a
// cover-only desktop row and requires the control to appear anyway.
//
// RED REASON (on HEAD): the desktop table renders no "View/Edit" control at
// all, and a cover-only row renders "—". After plan Step 5 restructures
// the cell to render on hasPreviewableDocs(app), these go green.
//
// This renders the REAL TrackingTab table (compact=false so the desktop table,
// not the phone cards, mounts) and drives the real control. matchMedia is
// mocked exactly as the sibling TrackingTab.touch.test.js does.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import TrackingTab from "../TrackingTab.js";
import { makeTheme } from "../../theme/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  // compact=false -> useIsTablet() is false -> the desktop <Table> renders.
  window.matchMedia = vi.fn((query) => ({
    matches: false,
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

const RESUME = {
  content: "Alex Shaw\nStaff Engineer",
  content_lines: ["Alex Shaw", "Staff Engineer"],
  docx_path: "resumes/app-1.docx",
};
const COVER = {
  content: "Dear Hiring Manager,\nHello.",
  content_lines: ["Dear Hiring Manager,", "Hello."],
  docx_path: "covers/app-1.docx",
};

function makeApp(overrides = {}) {
  return {
    id: "app-1",
    status: "applied",
    applied_at: "2026-01-05T00:00:00.000Z",
    application_url: "https://jobs.example.com/apply/1",
    positions: {
      id: "pos-1",
      external_id: "job-ext-1",
      company: "Acme",
      title: "Staff Engineer",
      url: null,
      description: "Build things.",
    },
    generated_resumes: RESUME,
    generated_cover_letters: COVER,
    ...overrides,
  };
}

function baseProps(app, overrides = {}) {
  return {
    currentUser: { id: "u1" },
    applicationLoading: false,
    applicationError: "",
    applicationData: [app],
    visibleApplicationData: [app],
    applicationStages: {},
    interviewSearch: "",
    setInterviewSearch: vi.fn(),
    interviewSort: { field: null, dir: "asc" },
    setInterviewSort: vi.fn(),
    companyColWidth: 140,
    roleColWidth: 180,
    resumeFile: { name: "base-resume.docx" },
    openAddApplicationDialog: vi.fn(),
    toggleInterviewSort: vi.fn(),
    sortLabelSx: () => ({}),
    startColResize: vi.fn(),
    askAiAbout: vi.fn(),
    buildApplicationContextString: () => "context",
    buildStageContextString: () => "stage context",
    openCommsInAppDialog: vi.fn(),
    openAddCommunicationDialog: vi.fn(),
    openEditApplicationDialog: vi.fn(),
    handleDeleteApplication: vi.fn(),
    setAppDialog: vi.fn(),
    setStageError: vi.fn(),
    setStageDialog: vi.fn(),
    isDocxResume: () => true,
    downloadDocxFiles: vi.fn(async () => ""),
    getDownloadFileNameForTitle: () => "Acme - Staff Engineer.docx",
    stageDialog: { open: false },
    stageError: "",
    stageSaving: false,
    handleSaveStage: vi.fn(),
    communicationsDialog: { open: false, items: [] },
    setCommunicationsDialog: vi.fn(),
    addCommunicationDialog: { open: false, body: "", files: [], kind: "email", subject: "", direction: "outbound", occurred_at: "" },
    setAddCommunicationDialog: vi.fn(),
    communicationError: "",
    setCommunicationError: vi.fn(),
    communicationSaving: false,
    handleSaveCommunication: vi.fn(),
    editAppDialog: { open: false },
    setEditAppDialog: vi.fn(),
    editAppSaving: false,
    editAppError: "",
    editAppResumeFile: null,
    setEditAppResumeFile: vi.fn(),
    handleSaveEditApplication: vi.fn(),
    addAppDialog: { open: false },
    setAddAppDialog: vi.fn(),
    addAppSaving: false,
    addAppError: "",
    addAppResumeFile: null,
    setAddAppResumeFile: vi.fn(),
    handleSaveAddApplication: vi.fn(),
    appDialog: { open: false, rowIndex: -1, kind: "" },
    loadCommunicationsForApp: vi.fn(),
    highlightedAppId: null,
    emailClassificationsByAppId: {},
    digestsById: {},
    researchingIds: new Set(),
    researchOne: vi.fn(),
    openApplicationPreview: vi.fn(),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(
      createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(TrackingTab, props)),
    );
  });
}

const name = (node) => (node.textContent || "").replace(/\s+/g, " ").trim();
const row = () => container.querySelector("tr[data-app-id], [data-app-id]");
const rowButtons = () => Array.from((row() || container).querySelectorAll("button"));
const viewEditBtn = () => rowButtons().find((b) => name(b) === "View/Edit");
const click = async (node) => {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

// ===========================================================================
// GUARD -- the desktop table (not the phone cards) is what mounted. Without
// this, every assertion below could pass/fail for the wrong layout.
// ===========================================================================

describe("GUARD the desktop table is mounted", () => {
  it("renders a <table>, not the compact card list", async () => {
    await render(baseProps(makeApp()));
    expect(container.querySelector("table"), "desktop table did not mount").toBeTruthy();
    expect(row(), "no application row rendered").toBeTruthy();
  });
});

// ===========================================================================
// AC-11 -- the cover-only desktop row shows the control (R-4).
// ===========================================================================

describe("AC-11 desktop parity including cover-only rows", () => {
  it("cover-only row: renders 'View/Edit' (NOT just the em-dash)", async () => {
    await render(baseProps(makeApp({ generated_resumes: null })));
    // The resume cell today is `resume?.content ? ... : "—"`; this row
    // currently shows only the dash. The control must appear regardless.
    expect(viewEditBtn(), "cover-only desktop row shows no View/Edit control").toBeTruthy();
  });

  it("resume-bearing row: renders 'View/Edit'", async () => {
    await render(baseProps(makeApp()));
    expect(viewEditBtn()).toBeTruthy();
  });

  it("neither resume nor cover: NO 'View/Edit' control", async () => {
    await render(baseProps(makeApp({ generated_resumes: null, generated_cover_letters: null })));
    expect(viewEditBtn()).toBeUndefined();
  });

  it("[power control] the no-docs fixture DOES render it once a cover is present", async () => {
    await render(baseProps(makeApp({ generated_resumes: null, generated_cover_letters: null })));
    expect(viewEditBtn()).toBeUndefined();
    await render(baseProps(makeApp({ generated_resumes: null })));
    expect(viewEditBtn()).toBeTruthy();
  });
});

// ===========================================================================
// AC-4 (reachability) -- the desktop control reaches the same handler.
// ===========================================================================

describe("AC-4 clicking the desktop View/Edit invokes openApplicationPreview(app)", () => {
  it("calls the prop once with the row's app and does not leak to the row's edit handler", async () => {
    const app = makeApp();
    const props = baseProps(app);
    await render(props);
    const btn = viewEditBtn();
    expect(btn, "no desktop View/Edit button").toBeTruthy();

    await click(btn);

    expect(props.openApplicationPreview).toHaveBeenCalledTimes(1);
    expect(props.openApplicationPreview).toHaveBeenCalledWith(app);
    // Control: the <TableRow> onClick opens the edit dialog unless the click
    // lands on a button; a correctly-rendered <button> must not leak to it.
    expect(props.openEditApplicationDialog).not.toHaveBeenCalled();
  });
});
