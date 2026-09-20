// @vitest-environment jsdom
//
// The coordinator's own named defect (plan.r1.md §0.6, design-experience.r1.md
// §6): AppViewDialog.js:112's mount-effect guard, `|| prepById[dApp.id])
// return`, means a cached snapshot is NEVER refetched once it exists --
// including a stale `status: "running"` left behind by an automatic B1/B3
// trigger nobody in this session is watching. Once no button is EVER shown
// while `status === "running"` (AC-N29.10), that stale snapshot permanently
// disables the new manual control for the rest of the page session, with no
// recovery short of a hard reload. Fixed by tracking "the id last fetched
// fresh for, since the dialog was last opened" and resetting that tracker
// on close (plan.r1.md step 7 item 2).
//
// `AppViewDialog` is a fully CONTROLLED component -- `appDialog` is owned by
// the caller (page.js) and this file has no internal open/kind state of its
// own (confirmed by direct read: no `useState` for appDialog anywhere in
// AppViewDialog.js). So this file drives the fix the same way the real
// parent does: by re-rendering with a new `appDialog` prop value, exactly
// as page.js would after applying whatever `setAppDialog` was called with.
// This is NOT a substitute for AC-N29.12's own real-DOM-click bar (that
// bar governs the GENERATE control's wiring specifically, per its own
// text) -- it is the correct instrument for a prop-driven effect's
// dependency behaviour, matching how `PrepPackPanel.test.js` already
// re-renders with new props to exercise state transitions.
//
// RED ON HEAD: the guard at AppViewDialog.js:112 checks `prepById[dApp.id]`
// presence, never dialog-open/close -- so case 1 below (reopen refetches)
// fails against HEAD (a second GET never fires); case 2 (no-refetch-on-
// mere-page-flip) already PASSES against HEAD today, by accident, since
// the CURRENT guard also blocks a page-flip refetch -- kept here as an
// explicit regression control so a fix that over-corrects (refetching on
// every kind change) is caught, not merely a fix that never refetches at
// all.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AppViewDialog from "./AppViewDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
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
  generated_resumes: { content: "Resume content." },
};

function baseProps(overrides = {}) {
  return {
    appDialog: { open: true, rowIndex: 0, kind: "prep" },
    setAppDialog: vi.fn(),
    applicationData: [APP],
    communicationsDialog: { open: false, items: [] },
    loadCommunicationsForApp: vi.fn(),
    openAddCommunicationDialog: vi.fn(),
    digestsById: {},
    researchingIds: new Set(),
    researchOne: vi.fn(),
    ...overrides,
  };
}

async function renderWith(props) {
  await act(async () => {
    root.render(createElement(AppViewDialog, props));
  });
}

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function getCallCount(fetchMock) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/interview-prep?applicationId=")).length;
}

describe("AppViewDialog reopen-refetch fix (AC-N29 dialog reopen defect)", () => {
  it("a stale 'running' snapshot is refetched when the SAME row's prep page is closed and reopened, and the fresh 'ready' content is eventually shown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      pack: null,
      status: "running",
      attemptsExhausted: false,
      completeSections: [],
      events: [],
      candidateName: null,
      interviewerNames: [],
      error: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const props = baseProps();
    await renderWith(props);
    await flush();
    expect(getCallCount(fetchMock), "the initial mount must fetch once").toBe(1);
    expect(document.body.textContent.toLowerCase()).toMatch(/generat/); // the running banner

    // Close the dialog -- the same prop shape page.js's own Close handler
    // produces (AppViewDialog.js's DialogActions Close button).
    await renderWith(baseProps({ appDialog: { open: false, rowIndex: 0, kind: "prep" } }));
    await flush();

    // While closed, the pack finished generating (an automatic trigger, or
    // this same manual control from another tab) -- the NEXT GET must
    // reflect that, once we reopen.
    fetchMock.mockResolvedValue(jsonResponse({
      pack: { version: 1, sections: {} },
      status: "ready",
      attemptsExhausted: false,
      completeSections: [],
      events: [],
      candidateName: null,
      interviewerNames: [],
      error: null,
    }));

    // Reopen the SAME row's prep page.
    await renderWith(baseProps({ appDialog: { open: true, rowIndex: 0, kind: "prep" } }));
    await flush();

    expect(getCallCount(fetchMock), "reopening the dialog for the same row must issue a fresh GET, not reuse the stale cached snapshot").toBe(2);
    expect(document.body.textContent.toLowerCase()).toMatch(/ready/);
    expect(document.body.textContent.toLowerCase()).not.toMatch(/generating your interview prep pack now/);
  });

  it("[regression control] navigating away to another page and back via the SAME open dialog does NOT refetch -- the fix must not over-correct into refetching on every kind change", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      pack: { version: 1, sections: {} },
      status: "ready",
      attemptsExhausted: false,
      completeSections: [],
      events: [],
      candidateName: null,
      interviewerNames: [],
      error: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const props = baseProps({ appDialog: { open: true, rowIndex: 0, kind: "prep" } });
    await renderWith(props);
    await flush();
    expect(getCallCount(fetchMock)).toBe(1);

    // Navigate to another page WITHOUT closing (open stays true throughout)
    // -- the exact shape the chevron buttons produce via setAppDialog.
    await renderWith(baseProps({ appDialog: { open: true, rowIndex: 0, kind: "jd" } }));
    await flush();
    await renderWith(baseProps({ appDialog: { open: true, rowIndex: 0, kind: "resume" } }));
    await flush();
    // Back to "prep", still never having closed.
    await renderWith(baseProps({ appDialog: { open: true, rowIndex: 0, kind: "prep" } }));
    await flush();

    expect(getCallCount(fetchMock), "paging between kinds within one open session must not refetch the prep pack").toBe(1);
  });
});
