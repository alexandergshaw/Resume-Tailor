// @vitest-environment jsdom
//
// U5 (plan §4) — TrackingTab placement of the Gmail notice (M4). Binds AC-6.
//
// Gmail connection is ONE-PER-ACCOUNT, not per-application. The Connect/Reconnect
// affordance must therefore be a SINGLE surface-level notice, rendered once by
// TrackingTab above the list — never threaded into each ApplicationCard, which
// would show N identical Connect controls and cry wolf N times on one blip.
//
// This drives the REAL join (TrackingTab rendered with the gmailConnection prop
// the way page.js will pass it), not a source-text grep — a stronger instrument
// than the wiring-grep the design also lists. On HEAD, TrackingTab ignores the
// unknown prop and renders no Connect control, so the "exactly one" assertion
// gets zero and fails RED for the right reason: the notice is not wired in.
//
// SCOPE NOTE (flagged, not covered here): the page.js -> TrackingTab prop wiring
// is Step D and lands in a later round. This file covers only that TrackingTab,
// given the prop, renders the notice once. The two apps below are what make the
// per-account/per-card distinction testable: a per-card notice would render TWO.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import TrackingTab from "./TrackingTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  // TrackingTab uses useIsTablet() (breakpoints.down("md")); pin desktop so the
  // notice's placement is judged in one stable layout.
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

function makeApp(id, company, title) {
  return {
    id,
    status: "applied",
    applied_at: "2026-01-05T00:00:00.000Z",
    application_url: null,
    positions: { id: `pos-${id}`, company, title, url: null, description: "desc" },
    generated_resumes: { content: "R", content_lines: ["R"], docx_path: `resumes/${id}.docx` },
  };
}

// TWO applications, so a notice rendered per-ApplicationCard would appear twice
// while the correct one-per-account notice appears once.
const APPS = [makeApp("app-1", "Stripe", "Frontend Engineer"), makeApp("app-2", "Acme", "Backend Engineer")];

function baseProps(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    applicationLoading: false,
    applicationError: "",
    applicationData: APPS,
    visibleApplicationData: APPS,
    applicationStages: {},
    interviewSearch: "",
    setInterviewSearch: vi.fn(),
    interviewSort: { field: null, dir: "asc" },
    companyColWidth: 140,
    roleColWidth: 180,
    resumeFile: { name: "base-resume.docx" },
    openAddApplicationDialog: vi.fn(),
    toggleInterviewSort: vi.fn(),
    setInterviewSort: vi.fn(),
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
    getDownloadFileNameForTitle: () => "file.docx",
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
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(TrackingTab, props));
  });
  return container;
}

function connectControls() {
  return Array.from(container.querySelectorAll("a[href]")).filter(
    (a) => (a.getAttribute("href") || "") === "/api/gmail/connect",
  );
}

describe("TrackingTab — the Gmail notice renders ONCE per account, above the list (AC-6)", () => {
  it("renders exactly one Connect control for not_connected, with two applications present", async () => {
    // RED on HEAD: the prop is ignored, no Connect control renders -> length 0.
    // The two-app fixture is the discriminator: a per-ApplicationCard notice would
    // render two, which is the cry-wolf regression this pins against.
    await render(baseProps({ gmailConnection: { cause: "not_connected" } }));
    expect(connectControls()).toHaveLength(1);
  });

  it("CONTROL: renders NO Connect control when gmailConnection is null (not always-on)", async () => {
    // Passes on HEAD too; its job is to fail any build that renders the notice
    // unconditionally. Together with the test above it pins that the notice is
    // driven by the cause, not hardwired.
    await render(baseProps({ gmailConnection: null }));
    expect(connectControls()).toHaveLength(0);
  });

  it("CONTROL: temporarily_unavailable renders no Connect control at the surface", async () => {
    await render(baseProps({ gmailConnection: { cause: "temporarily_unavailable" } }));
    expect(connectControls()).toHaveLength(0);
  });
});
