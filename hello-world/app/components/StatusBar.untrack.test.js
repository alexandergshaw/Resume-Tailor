// @vitest-environment jsdom
//
// The VISIBLE half of the chip-untrack fix. The bug report was "clicking
// remove on the tailored chips doesn't actually remove the jobs"; the fix
// makes the chip always go, and makes the refusal of the underlying DELETE
// audible instead of silent. This file covers the surface that says so.
//
// Every fixture runs the REAL `presentUntrackOutcome`
// (lib/applications/untrackChip.js) to build the `untrackNotice` prop rather
// than hand-typing a `{ tone, sentence }` shape — same rule
// StatusBar.dupFlag.test.js sets for the duplicate banner: if this file typed
// its own copy, a passing suite would prove nothing about whether StatusBar
// renders the presentation module's output verbatim.
//
// Structural assertions use `data-untrack-*` attributes, never CSS-module
// class names or getComputedStyle — Vitest applies no CSS-module styles in
// jsdom, and the CSS-module import proxy fabricates a hashed name for ANY
// property access, so a className assertion is self-satisfying. Same V-9
// ruling StatusBar.dupFlag.test.js records.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import StatusBar from "./StatusBar.js";
import { presentUntrackOutcome } from "../../lib/applications/untrackChip.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APPLIED_AT = "2026-07-04T15:32:11.000Z";
const CHIP = { id: "gh-1", title: "Senior Engineer", company: "Acme", url: "" };

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

function baseProps(overrides = {}) {
  return {
    trackedJobs: [CHIP],
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
    setHighlightedJobId: vi.fn(),
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

const keptNotice = (status, appliedAt = null) =>
  presentUntrackOutcome({ deleted: false, kept: { status, appliedAt }, unknown: false }, CHIP);

const banner = () => container.querySelector('[data-untrack-flag="banner"]');
const action = (name) => container.querySelector(`[data-untrack-action="${name}"]`);

describe("StatusBar — the untrack notice", () => {
  it("renders nothing when there is no notice (the deleted case leaves no trace)", async () => {
    await render(baseProps({ untrackNotice: null }));
    expect(banner()).toBeNull();
  });

  it("renders the presentation module's sentence verbatim, with its tone", async () => {
    const notice = keptNotice("applied", APPLIED_AT);
    await render(baseProps({ untrackNotice: notice }));

    const el = banner();
    expect(el).not.toBeNull();
    expect(el.getAttribute("data-untrack-tone")).toBe("info");
    expect(el.textContent).toContain(notice.sentence);
    expect(el.textContent).toContain(notice.kicker);
  });

  it("offers one click to the row it just told the user about", async () => {
    const notice = keptNotice("applied", APPLIED_AT);
    const props = baseProps({ untrackNotice: notice, onOpenApplications: vi.fn() });
    await render(props);

    const open = action("open-applications");
    expect(open).not.toBeNull();
    await act(async () => {
      open.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The seed is the presentation module's own value, forwarded verbatim.
    expect(props.onOpenApplications).toHaveBeenCalledWith(notice.searchSeed);
  });

  it("offers NO Tracking link when Tracking would not list the row", async () => {
    const notice = keptNotice("auto_tailored");
    await render(baseProps({ untrackNotice: notice, onOpenApplications: vi.fn() }));

    expect(banner().getAttribute("data-untrack-tone")).toBe("warning");
    // A link to a tab that filters this row out reads as "it is gone".
    expect(action("open-applications")).toBeNull();
  });

  it("can be dismissed", async () => {
    const props = baseProps({ untrackNotice: keptNotice("applied", APPLIED_AT), onUntrackNoticeDismiss: vi.fn() });
    await render(props);

    await act(async () => {
      action("dismiss").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onUntrackNoticeDismiss).toHaveBeenCalledTimes(1);
  });

  it("SURVIVES AN EMPTY DOCK — removing the last chip is when it matters most", async () => {
    // StatusBar's empty-dock early return unmounts the whole toolbar. A notice
    // nested below that return would be destroyed by exactly the action that
    // raises it (the same S-11 trap the duplicate-check log control records).
    await render(baseProps({ trackedJobs: [], untrackNotice: keptNotice("applied", APPLIED_AT) }));
    expect(banner()).not.toBeNull();
  });

  it("still renders nothing at all when the dock is empty and there is no notice", async () => {
    await render(baseProps({ trackedJobs: [], untrackNotice: null }));
    expect(container.innerHTML).toBe("");
  });

  it("the Remove menu item still calls handleUntrackJob with the chip's id", async () => {
    const props = baseProps();
    await render(props);

    const more = container.querySelector('button[aria-label="More actions"]');
    await act(async () => {
      more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const remove = [...document.body.querySelectorAll('li[role="menuitem"]')].find(
      (el) => el.textContent.trim() === "Remove",
    );
    expect(remove).toBeTruthy();
    await act(async () => {
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.handleUntrackJob).toHaveBeenCalledWith(CHIP.id);
  });
});
