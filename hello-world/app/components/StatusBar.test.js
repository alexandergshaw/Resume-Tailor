// @vitest-environment jsdom
//
// The createRoot + act idiom (no @testing-library/react in this repo) --
// same as app/components/DriveButton.test.js and
// app/components/JobDescriptionTab.test.js.
//
// LIVE DEFECT under test: StatusBar's "Go to card" menu item
// (StatusBar.js's goToCard, ~line 89) sends every job whose id does not
// start with "url-" or "manual-" -- i.e. every Live Feed (`feed-`) or job
// -search-sourced tracked job -- to `setActiveSection("search")`. There has
// been no `"search"` section in the app's NavTabs since commit e8c6427
// deleted JobSearchTab.js (the component that used to own it and the only
// place `job-card-${id}` DOM ids were ever rendered); a whole-tree grep
// confirms `job-card-` now appears nowhere outside this file. `activeSection`
// also survives a reload via localStorage (app/page.js:276,303), so one click
// leaves the app on a dead tab across restarts, and it was ALSO sending the
// url/manual case to `setMainTab("applying")`, which today renders the
// Materials tab (ApplyingControls), not the url/manual/screenshots section
// tabs at all -- those moved under `mainTab === "manualApplying"`
// (app/page.js:2774-2790). Both mistakes are exercised below.
//
// Fix under test: a url-/manual- job (the only tracked-job shapes with a
// real owning section today) routes to `setMainTab("manualApplying")` +
// the matching `activeSection`; every other job shape (feed-/search-
// sourced) has no reachable card anywhere in the current UI, so the "Go to
// card" menu item is not offered for it at all, rather than silently
// selecting a section that does not exist.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import StatusBar from "./StatusBar.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  // MUI's useMediaQuery (via app/hooks/useResponsive's useIsMobile) feature-
  // detects matchMedia; jsdom has none. Stub a desktop viewport so the bar
  // renders its horizontal (non-"vertical") branch deterministically -- same
  // stub as app/components/ChatPanel.clear.test.js.
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
    trackedJobs: [job("url-https://example.com/posting"), job("manual-1"), job("feed-42")],
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

// Opens the Nth tracked job's "More actions" (⋯) menu -- mirroring how a
// real user reaches "Go to card". Indexed rather than matched by CSS class
// (this component's chip classes come from a `.module.css` import, whose
// generated names are an implementation detail not worth depending on here)
// -- chips render in `trackedJobs` order, one "More actions" button each, so
// the index into `baseProps().trackedJobs` is unambiguous.
async function openMenuForJobIndex(index) {
  const buttons = [...container.querySelectorAll('button[aria-label="More actions"]')];
  const button = buttons[index];
  if (!button) throw new Error(`No "More actions" button at index ${index} (found ${buttons.length})`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// MUI's Menu/MenuItem portal into document.body (a Modal/Popper), not into
// our local `container` -- so menu items must be searched for there.
function findMenuItem(text) {
  return [...document.body.querySelectorAll('li[role="menuitem"]')].find(
    (el) => el.textContent.trim() === text,
  ) || null;
}

describe("StatusBar — Go to card (live navigation defect)", () => {
  it("for a URL-sourced job, routes to a mainTab/activeSection pair that actually exists in the app's rendered tabs", async () => {
    const props = baseProps();
    await render(props);
    // trackedJobs[0] is the "url-…" job (see baseProps).
    await openMenuForJobIndex(0);

    const goToCard = findMenuItem("Go to card");
    expect(goToCard).not.toBeNull();

    await act(async () => {
      goToCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The url/manual/screenshots section tabs (app/page.js:2781-2790) render
    // ONLY under mainTab === "manualApplying" (app/page.js:2774) -- NOT under
    // "applying", which today renders the unrelated Materials tab
    // (ApplyingControls, app/page.js:2739-2769). Sending "applying" strands
    // the user exactly like the dead "search" section does.
    expect(props.setMainTab).toHaveBeenCalledWith("manualApplying");
    // The rendered section tabs are exactly {url, manual, screenshots}
    // (app/page.js:2786-2788) -- assert against a member of that literal set.
    expect(props.setActiveSection).toHaveBeenCalledWith("url");
  });

  it("for a manual-sourced job, routes to activeSection 'manual' under mainTab 'manualApplying'", async () => {
    const props = baseProps();
    await render(props);
    // trackedJobs[1] is the "manual-…" job (see baseProps).
    await openMenuForJobIndex(1);

    const goToCard = findMenuItem("Go to card");
    expect(goToCard).not.toBeNull();

    await act(async () => {
      goToCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.setMainTab).toHaveBeenCalledWith("manualApplying");
    expect(props.setActiveSection).toHaveBeenCalledWith("manual");
  });

  it("does not offer 'Go to card' for a Live Feed job (feed-*) -- there is no section left that renders such a card", async () => {
    const props = baseProps();
    await render(props);
    // trackedJobs[2] is the "feed-…" job (see baseProps).
    await openMenuForJobIndex(2);

    // Before the fix this item is always rendered and would have sent
    // setActiveSection("search") -- a value NavTabs never renders
    // (app/page.js:2786-2788 has no "search" entry) and that
    // survives across a reload via the activeSection localStorage round-trip
    // (app/page.js:276,303). The correct behaviour is to not offer a menu
    // item that cannot go anywhere real.
    expect(findMenuItem("Go to card")).toBeNull();
    expect(props.setActiveSection).not.toHaveBeenCalledWith("search");
  });
});
