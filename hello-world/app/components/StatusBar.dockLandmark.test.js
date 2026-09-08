// @vitest-environment jsdom
//
// BLOCKER 3, the target half — the dock is a named landmark with a stable id.
//
// `.floatingToolbar` is `position: fixed; bottom: 0` (page.module.css:307-320)
// so it is permanently on screen, but app/page.js mounts `<StatusBar>` at
// :3146, AFTER `</main>` and after the chat FAB — dead last in the DOM. Its
// per-job controls therefore sit behind every focusable in the active tab:
// roughly 230 Tab presses with 20 tracked applications (KEYBOARD-audit §3).
//
// THE RULING, and the two options rejected:
//
//   * REJECTED — move the dock earlier in the DOM. DOM position is free of
//     visual consequence here (the dock is `position: fixed`), so this is
//     tempting. But it puts up to 20 chips x ~6 controls in FRONT of the
//     page's own primary action, which today costs 4 Tab presses. That trades
//     a bad number for a worse one on the common path.
//
//   * REJECTED — a keyboard shortcut. Undiscoverable without documentation the
//     app does not have, and any binding risks colliding with the browser's or
//     a screen reader's own. It also fails the standing "no hidden affordance"
//     reading of the minimise-clicks directive.
//
//   * CHOSEN — a second skip link (SkipLink.js) targeting this landmark. From
//     page load it is one Tab and one Enter. It costs a mouse user nothing (it
//     is not rendered visible until focused), costs a keyboard user no extra
//     click on any other path, and needs no new convention. This file owns the
//     TARGET; SkipLink.test.js owns the link and the presence gate that keeps
//     the link from outliving this element.
//
// The landmark is worth having on its own account too: `role="region"` with an
// accessible name puts the dock in the landmarks list, so a screen-reader user
// reaches it by landmark navigation without using the link at all.
//
// BROWSER ONLY (not asserted here): that focus actually lands inside the dock
// after activating the link, and that the focused control is not painted under
// the dock's own fixed edge. jsdom has no layout and no fragment navigation.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import StatusBar from "./StatusBar.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DOCK_ID = "job-dock";

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

const dock = () => container.querySelector(`#${DOCK_ID}`);

/** The landmark contract, applied to whichever of the two docks rendered. */
function expectDockLandmark(label) {
  const el = dock();
  expect(el, `${label}: no element carrying id="${DOCK_ID}" — the skip link would point at nothing`).not.toBeNull();
  const role = el.getAttribute("role") || (el.tagName === "SECTION" ? "region" : null);
  expect(
    role,
    `${label}: the dock must be a landmark. A bare <section> is only a region landmark once it has ` +
      "an accessible name, which the next assertion covers.",
  ).toBe("region");
  expect(
    el.getAttribute("aria-label"),
    `${label}: an unnamed region is not exposed as a landmark at all — the name is what makes it ` +
      "reachable by landmark navigation.",
  ).toBeTruthy();
  expect(
    el.getAttribute("tabindex"),
    `${label}: needs tabindex="-1" so activating the skip link moves the CARET into the dock rather ` +
      "than only scrolling. -1 keeps it out of sequential traversal, so it costs no tab stop.",
  ).toBe("-1");
  return el;
}

// ================================================================= the full dock

describe("the tracked-jobs dock is a named landmark", () => {
  it("carries the id, the region role and a name", async () => {
    await render(baseProps());
    expectDockLandmark("full dock");
  });

  it("the landmark IS the fixed dock, not a wrapper around it", async () => {
    // If the id were put on a new wrapper element, the skip link would land
    // outside the `position: fixed` box and the dock's own scroll container
    // would not be the thing that received focus.
    await render(baseProps());
    const el = dock();
    expect(
      el.className,
      "the id must sit on the .floatingToolbar element itself",
    ).toMatch(/floatingToolbar/);
  });

  it("still contains the job controls it is advertising", async () => {
    await render(baseProps());
    const el = dock();
    expect(
      el.querySelectorAll("button").length,
      "[instrument] a landmark with no controls in it would make the link pointless",
    ).toBeGreaterThan(0);
  });
});

// ====================================================== the log-only early dock

describe("the log-only dock (trackedJobs empty, a log still to reach) is the same landmark", () => {
  it("carries the id, the region role and a name", async () => {
    // StatusBar.js:212-227's early return is a SECOND dock element. Giving the
    // landmark only to the main return would leave the skip link dangling in
    // exactly the state the user reaches by pressing "Clear all".
    await render(baseProps({ trackedJobs: [], onDupeDownloadLog: vi.fn() }));
    expectDockLandmark("log-only dock");
  });
});

// ============================================================ the absent state

describe("no dock, no landmark", () => {
  it("renders nothing at all when there is neither a job nor a log", async () => {
    await render(baseProps({ trackedJobs: [] }));
    expect(
      dock(),
      "StatusBar returns null here. A landmark rendered anyway would keep the skip link alive with " +
        "nothing behind it.",
    ).toBeNull();
    expect(container.textContent).toBe("");
  });
});
