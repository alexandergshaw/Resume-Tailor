// @vitest-environment jsdom
//
// N33/N25's prep pack read surface (`app/components/tracking/PrepPackPanel.js`,
// wired into `AppViewDialog.js`'s `kind === "prep"` branch) had a complete
// consumer -- fetch effect, all six `status` renders, `onSaveNames`,
// `onDownloadLog` -- and ZERO producers: no call anywhere in non-test code
// ever set `appDialog.kind` to `"prep"`. `PrepPackPanel.test.js` renders the
// panel directly and `AppViewDialog.wiring.test.js` calls `saveTrustedNames`
// directly, so neither could have caught this -- both bypass the one thing
// that was actually missing, a door into the dialog.
//
// This file drives the door itself: it mounts the real `TrackingTab`, in
// BOTH the desktop table and the phone card layout (`isCompact`), clicks the
// control a candidate would actually click, and asserts `setAppDialog` was
// called with `kind: "prep"` -- never by calling `setAppDialog` or any
// dialog-state setter directly. A version of this file with the button
// removed was run and confirmed to fail (see the implementer's report); this
// is the guard that stays.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import TrackingTab from "./TrackingTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let compact = false;

beforeEach(() => {
  compact = false;
  // Same mock shape as TrackingTab.keyboard.test.js / TrackingTab.touch.test.js:
  // `useIsTablet()` is `theme.breakpoints.down("md")`, a max-width query.
  window.matchMedia = vi.fn((query) => ({
    matches: /max-width/.test(String(query)) ? compact : false,
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

const APP = {
  id: "app-1",
  status: "applied",
  applied_at: "2026-01-05T00:00:00.000Z",
  application_url: null,
  positions: {
    id: "pos-1",
    company: "Stripe",
    title: "Frontend Engineer",
    url: null,
    description: "Build payment surfaces.",
  },
  generated_resumes: null,
};

function baseProps(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    applicationLoading: false,
    applicationError: "",
    applicationData: [APP],
    visibleApplicationData: [APP],
    applicationStages: {},
    interviewSearch: "",
    setInterviewSearch: vi.fn(),
    interviewSort: { field: null, dir: "asc" },
    setInterviewSort: vi.fn(),
    companyColWidth: 140,
    roleColWidth: 180,
    resumeFile: null,
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
    isDocxResume: () => false,
    downloadDocxFiles: vi.fn(async () => ""),
    getDownloadFileNameForTitle: () => "Stripe - Frontend Engineer.docx",
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
}

function accessibleName(node) {
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}

function controlsNamed(pattern) {
  return Array.from(container.querySelectorAll('button, [role="button"]')).filter((node) =>
    pattern.test(accessibleName(node))
  );
}

describe("the interview prep pack has a door in the desktop table", () => {
  it("[control] a control named Prep/Interview Prep exists in the row", async () => {
    compact = false;
    await render(baseProps());
    const controls = controlsNamed(/prep/i);
    expect(controls.length, "no control mentioning 'prep' rendered in the desktop table").toBeGreaterThan(0);
  });

  it("clicking it opens the row dialog with kind \"prep\", driven through the UI, not a setter call", async () => {
    compact = false;
    const props = baseProps();
    await render(props);
    const control = controlsNamed(/prep/i)[0];
    expect(control).toBeTruthy();

    await act(async () => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(props.setAppDialog).toHaveBeenCalledWith(
      expect.objectContaining({ open: true, kind: "prep" })
    );
  });
});

describe("the interview prep pack has a door in the phone card layout", () => {
  it("[control] a control named Prep exists on the card", async () => {
    compact = true;
    await render(baseProps());
    const controls = controlsNamed(/^prep$/i);
    expect(controls.length, "no control named 'Prep' rendered in the phone card").toBeGreaterThan(0);
  });

  it("clicking it opens the row dialog with kind \"prep\", driven through the UI, not a setter call", async () => {
    compact = true;
    const props = baseProps();
    await render(props);
    const control = controlsNamed(/^prep$/i)[0];
    expect(control).toBeTruthy();

    await act(async () => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(props.setAppDialog).toHaveBeenCalledWith(
      expect.objectContaining({ open: true, kind: "prep" })
    );
  });
});
