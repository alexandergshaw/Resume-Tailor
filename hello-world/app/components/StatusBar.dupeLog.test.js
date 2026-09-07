// @vitest-environment jsdom
//
// THE PRESENCE-AND-WIRING HALF of the duplicate-application log control.
//
// jsdom implements no download at all: no file is written, and `HTMLAnchorElement`
// ignores `download` entirely, so clicking this button can NEVER be shown here to
// produce a file. This file therefore claims exactly two things and no more --
// that the control EXISTS on the surfaces where the standing feature-logs rule
// requires it ("clearly visible", "survives Clear"), and that one click calls the
// handler it was given, once, with no confirmation step in between. What the file
// CONTAINS and what it is CALLED are proven separately, as pure functions, in
// lib/duplicateApply/duplicateApplyLog.download.test.js.
//
// Same createRoot + act idiom as StatusBar.test.js and StatusBar.dupFlag.test.js
// (there is no @testing-library in this repo), and the same V-9 ruling on
// instrumentation: structural assertions go through a `data-dupe-*` attribute,
// never a CSS-module class name (the CSS-module proxy fabricates a hashed name
// for any property access, so a className assertion is self-satisfying), and
// never getComputedStyle (Vitest applies no CSS-module styles in jsdom).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import StatusBar from "./StatusBar.js";
import { presentVerdict } from "../../lib/duplicateApply/verdictPresentation.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
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

function job(id, overrides = {}) {
  return { id, title: `Title for ${id}`, company: "Acme", url: "", ...overrides };
}

function baseProps(overrides = {}) {
  return {
    trackedJobs: [job("url-https://example.com/posting")],
    setTrackedJobs: vi.fn(),
    tailoringMap: {},
    jobResults: [],
    resumeFile: null,
    toolbarScrollRef: { current: null },
    toolbarCanScrollLeft: false,
    toolbarCanScrollRight: false,
    handleToolbarWheel: vi.fn(),
    handleToolbarScroll: vi.fn(),
    scrollToolbar: vi.fn(),
    isDocxResume: vi.fn(() => false),
    getDownloadFileNameForTitle: vi.fn(() => "resume.docx"),
    askAiAbout: vi.fn(),
    buildJobContextString: vi.fn(() => ""),
    setMainTab: vi.fn(),
    setActiveSection: vi.fn(),
    downloadResumeForChipJob: vi.fn(),
    handleToggleApplied: vi.fn(),
    handleIgnoreJob: vi.fn(),
    handleUntrackJob: vi.fn(),
    openResumePreview: vi.fn(),
    openCompanyResearch: vi.fn(),
    onRegenerate: vi.fn(),
    appliedByExternalId: null,
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(StatusBar, props));
  });
}

const logButton = () => container.querySelector('[data-dupe-action="download-log"]');

const HIT = {
  samePosition: {
    verdict: "hit",
    reason: "undated-match",
    route: "url",
    match: { applicationId: "a1", company: "Acme", title: "Staff Engineer", url: "https://example.com/posting", appliedAt: null },
  },
  company: { verdict: "clear", count: 0, undatableCount: 0, futureCount: 0 },
  checkedAt: 1_750_000_000_000,
  diagnostics: { rowsExamined: 3, rowsCounted: 1, rowsState: "ready", windowDays: 30 },
};

function notice(verdict = HIT) {
  return presentVerdict({
    verdict,
    jobId: "url-https://example.com/posting",
    jobTitle: "Staff Engineer",
    candidateCompany: "Acme",
    queueLength: 1,
    timeZone: "UTC",
    statusLabels: {},
  });
}

// ---------------------------------------------------------------------------
// PRESENCE. The rule is "clearly visible" and "survives Clear" -- so the three
// cases that matter are the three where a banner-nested button would be gone.
// ---------------------------------------------------------------------------
describe("StatusBar -- the duplicate-check log control is present wherever the log is", () => {
  it("renders when a log exists, even with NO banner on screen -- the silent case the log exists to explain", async () => {
    await render(baseProps({ dupeNotice: null, onDupeDownloadLog: vi.fn() }));
    expect(container.querySelector('[data-dupe-flag="banner"]')).toBeNull();
    expect(logButton()).not.toBeNull();
  });

  it("renders alongside a banner when there is one", async () => {
    await render(baseProps({ dupeNotice: notice(), onDupeDownloadLog: vi.fn() }));
    expect(container.querySelector('[data-dupe-flag="banner"]')).not.toBeNull();
    expect(logButton()).not.toBeNull();
  });

  it("SURVIVES CLEAR: still renders after 'Clear all' has emptied trackedJobs, when the dock would otherwise be gone entirely", async () => {
    // "Clear all" is `setTrackedJobs([])` and nothing else, and StatusBar's own
    // early return then unmounts the whole dock. A control nested in that dock
    // (or in the banner) would be destroyed by exactly the action the standing
    // feature-logs rule says the log must survive.
    await render(baseProps({ trackedJobs: [], dupeNotice: null, onDupeDownloadLog: vi.fn() }));
    expect(logButton()).not.toBeNull();
  });

  it("[control] with no log and no tracked jobs, the dock is still empty -- the button is the ONLY thing that keeps it alive", async () => {
    await render(baseProps({ trackedJobs: [], dupeNotice: null, onDupeDownloadLog: null }));
    expect(container.textContent).toBe("");
    expect(logButton()).toBeNull();
  });

  it("is absent before any check has run -- an always-present control that downloads nothing is worse than no control", async () => {
    await render(baseProps({ dupeNotice: null, onDupeDownloadLog: null }));
    expect(logButton()).toBeNull();
    // Positive control: the dock itself did render, so the assertion above is
    // about the button and not about an empty component.
    expect(container.textContent).toContain("Generated");
  });

  it("is not nested inside the banner, so dismissing the banner cannot take it away", async () => {
    await render(baseProps({ dupeNotice: notice(), onDupeDownloadLog: vi.fn() }));
    const banner = container.querySelector('[data-dupe-flag="banner"]');
    expect(banner).not.toBeNull();
    expect(banner.contains(logButton())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VISIBILITY, as far as a DOM without CSS can honestly speak to it: the control
// is a real, focusable button carrying a readable text label -- never an icon,
// a title-only affordance, or an item hidden behind the "More actions" menu.
// ---------------------------------------------------------------------------
describe("StatusBar -- the log control is a plainly labelled button, not a hidden affordance", () => {
  it("is a <button>, in the tab order, with a visible text label naming what it downloads", async () => {
    await render(baseProps({ dupeNotice: null, onDupeDownloadLog: vi.fn() }));
    const el = logButton();
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.textContent.trim().length).toBeGreaterThan(0);
    expect(el.textContent).toMatch(/log/i);
  });

  it("is not inside the per-job 'More actions' menu -- it is a surface-level control", async () => {
    await render(baseProps({ dupeNotice: null, onDupeDownloadLog: vi.fn() }));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(logButton()).not.toBeNull();
  });

  it("has no MUI Tooltip wrapper stealing its accessible name (the name is its own text)", async () => {
    await render(baseProps({ dupeNotice: null, onDupeDownloadLog: vi.fn() }));
    const el = logButton();
    expect(el.getAttribute("aria-label")).toBeNull();
    expect(el.getAttribute("aria-labelledby")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WIRING. One click, straight through, no confirmation.
// ---------------------------------------------------------------------------
describe("StatusBar -- one click calls the handler once", () => {
  it("calls onDupeDownloadLog exactly once per click, with no arguments derived here", async () => {
    const onDupeDownloadLog = vi.fn();
    await render(baseProps({ dupeNotice: null, onDupeDownloadLog }));
    await act(async () => {
      logButton().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(onDupeDownloadLog).toHaveBeenCalledTimes(1);
  });

  it("shows no confirmation dialog and asks no question -- the click IS the action", async () => {
    const onDupeDownloadLog = vi.fn();
    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;
    await render(baseProps({ trackedJobs: [], dupeNotice: null, onDupeDownloadLog }));
    await act(async () => {
      logButton().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(onDupeDownloadLog).toHaveBeenCalledTimes(1);
  });

  it("clicking it does not dismiss the banner or open the applications tab", async () => {
    const onDupeDismiss = vi.fn();
    const onOpenApplications = vi.fn();
    await render(baseProps({ dupeNotice: notice(), onDupeDownloadLog: vi.fn(), onDupeDismiss, onOpenApplications }));
    await act(async () => {
      logButton().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(onDupeDismiss).not.toHaveBeenCalled();
    expect(onOpenApplications).not.toHaveBeenCalled();
  });

  it("three clicks are three downloads -- the control does not disable itself after one use", async () => {
    const onDupeDownloadLog = vi.fn();
    await render(baseProps({ dupeNotice: null, onDupeDownloadLog }));
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        logButton().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });
    }
    expect(onDupeDownloadLog).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// The no-notice render must stay byte-identical to what it was, exactly as
// S-15.5 required of the banner itself: this control must not become a second
// way for the dupe feature to disturb a dock that has nothing to say.
// ---------------------------------------------------------------------------
describe("StatusBar -- a dock with no log renders as it always did", () => {
  it("renders the same DOM with onDupeDownloadLog absent as with it explicitly null", async () => {
    await render(baseProps({ dupeNotice: null }));
    const withoutProp = container.innerHTML;
    await act(async () => {
      root.render(createElement(StatusBar, baseProps({ dupeNotice: null, onDupeDownloadLog: null })));
    });
    expect(container.innerHTML).toBe(withoutProp);
  });

  it("the ordinary 'Clear all' control is still present and still only clears tracked jobs", async () => {
    const setTrackedJobs = vi.fn();
    await render(baseProps({ dupeNotice: null, onDupeDownloadLog: vi.fn(), setTrackedJobs }));
    const clear = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Clear all");
    expect(clear).toBeDefined();
    await act(async () => {
      clear.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(setTrackedJobs).toHaveBeenCalledTimes(1);
    expect(setTrackedJobs).toHaveBeenCalledWith([]);
  });
});
