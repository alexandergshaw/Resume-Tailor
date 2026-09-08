// @vitest-environment jsdom
//
// The job feed's mobile-portrait pass (surface E). Four defects, all in
// LiveFeedTab.js, all reachable at 375x812 -- M3, N6, N11 below, plus this
// tab's own three sub-44px controls (last describe block).
//
// KNOWN UNFIXED, AND IT GATES M3: the "Filters" button that opens the sheet
// M3 introduces is itself clipped off screen at 375px, because TabHeader.js:22
// pins its actions wrapper with `flex-shrink: 0`. Measured in a real browser
// against a faithful re-creation of TabHeader.js:22 + FeedToolbar.js:39 in a
// 303px box: the toolbar lays out 511px wide and the Feed/Queue toggle,
// Filters and Autofill profile all end past the content edge (right = 339,
// 399, 511), unreachable because `html { overflow-x: hidden }` clips rather
// than scrolls. Relaxing that one rule to `flex-shrink: 1; min-width: 0;
// width: 100%` brought it to 303px across six rows with nothing clipped.
// TabHeader.js is out of this file set and must be fixed by whoever owns it,
// or none of M3 is reachable on a phone.
//
//   M3  Opening "Filters" expands an inline <Collapse> holding the saved-search
//       strip, the per-search email-alert cards, the removable filter chips,
//       five search fields and six stacked Autocompletes. At the 303px content
//       box this surface actually gets (`.page` + `.main` padding, see
//       app/page.module.css:1-16) that is a multi-thousand-pixel panel with no
//       "done" affordance, rendered ABOVE the feed list in normal flow -- so
//       the feed itself is pushed entirely off screen and the only way back is
//       to scroll up to the Filters button again.
//
//   N6  `window.prompt()` named a saved search. Several mobile in-app browsers
//       (Instagram / Facebook / LinkedIn webviews) suppress it outright: it
//       returns null and the save silently does nothing, with no error and no
//       feedback. It is also the one modal in this app that cannot be styled,
//       cannot be escaped by the app, and does not respect the dialog
//       conventions every other surface here now follows.
//
//   N11 The autofill Snackbar is `anchorOrigin={{ vertical: "bottom" }}`. MUI
//       pins that to `bottom: 8px` below `sm` (Snackbar.js:66-71) and gives it
//       `zIndex: snackbar` (1400), while the tracking dock is
//       `position: fixed; bottom: 0; z-index: 1000` (page.module.css:307) and
//       the chat FAB rests at `bottom: 24` with a 56px Fab (app/page.js:215,
//       ChatFab.js:151-153). So the toast lands on top of both for its six
//       seconds -- covering the dock's controls and the FAB.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE CAN AND CANNOT PROVE -- read before adding to it.
//
// jsdom HAS NO LAYOUT. `getBoundingClientRect()` is all zeros. NOTHING here
// asserts geometry, and no case may be added that appears to: such a case
// passes vacuously and defends the defect. Even in a real browser the
// instrument has to be per-element rects compared against the parent's, never
// `document.scrollWidth` -- `app/globals.css:23`'s `html { overflow-x: hidden }`
// clips the overflow rather than making it scrollable.
//
// What is asserted instead:
//
//   REAL BEHAVIOUR      Which DOM tree the filter panel is rendered into, that
//                       `window.prompt` is not called, that a named control
//                       exists and does what it says. DOM facts, exact.
//   STRUCTURAL PROXY    "the panel no longer pushes the feed off screen" is
//                       tested as "the panel is not a flow sibling inside
//                       `section.tabPanel` any more". That is the mechanism
//                       causing the displacement, and it is checkable; the
//                       displacement itself is not.
//   DECLARED-VALUE      The Snackbar's computed `bottom` at an emulated 375px
//   PROXY               and 1200px, via app/theme/computedStyleAtWidth.js.
//                       Proxy for "the toast clears the FAB and the dock".
//
//   STILL A BROWSER CHECK, at 375x812 -- listed in this file's report, not
//   fakeable here:
//     1. every element under `section [class*=tabPanel] *` satisfies
//        `el.getBoundingClientRect().right <= parent.getBoundingClientRect().right + 1`
//     2. the open filter sheet's own content scrolls (DialogContent
//        `scrollHeight > clientHeight`) rather than the Paper
//     3. the Snackbar's rect does not intersect the FAB's or the dock's
//     4. the on-screen keyboard does not cover the saved-search name field

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import Box from "@mui/material/Box";
import theme from "../theme/index.js";
import { atWidth } from "../theme/computedStyleAtWidth.js";
import LiveFeedTab from "./LiveFeedTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport emulation -----------------------------------------------------
// Same two-instrument split as app/components/FormDialog.mobile.test.js, and
// for the same reason: `useIsMobile()` is `useMediaQuery(down("sm"))`, which
// asks `window.matchMedia` a `(max-width:599.95px)` question and never touches
// a stylesheet, while a responsive `sx` value compiles to `min-width` media
// rules that only `atWidth` can make visible to jsdom's cascade. Neither
// instrument can stand in for the other.
const PHONE = 375;
const DESKTOP = 1200;
let viewportWidth = PHONE;

function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) {
    matched = true;
    if (width > Number(max[1])) return false;
  }
  if (min) {
    matched = true;
    if (width < Number(min[1])) return false;
  }
  return matched;
}

window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

// --- network ----------------------------------------------------------------
const PROFILE = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };
const POSTING = {
  id: "p1",
  title: "Staff Engineer",
  company: "Analytical Engines",
  location: "London",
  url: "https://example.com/jobs/p1",
  source: "greenhouse",
  posted_at: "2026-09-01T00:00:00.000Z",
};

let feedItems;
let postedSavedSearches;

const json = (body) => Promise.resolve({ ok: true, json: async () => body });

function installFetch() {
  postedSavedSearches = [];
  global.fetch = vi.fn((url, init = {}) => {
    const u = String(url);
    if (u.startsWith("/api/auto-apply-queue")) return json({ items: [] });
    if (u.startsWith("/api/user-profile")) return json({ profile: PROFILE });
    if (u.startsWith("/api/saved-searches/unviewed-counts")) return json({ counts: {} });
    if (u.startsWith("/api/saved-searches")) {
      const body = init.body ? JSON.parse(init.body) : {};
      postedSavedSearches.push(body);
      return json({ search: { id: "srv-1", name: body.name, job_keywords: body.jobKeywords || [] } });
    }
    if (u.startsWith("/api/feed")) {
      return json({
        items: feedItems,
        nextCursor: null,
        lastUpdatedAt: "2026-09-07T12:00:00.000Z",
        sourceHealth: {},
      });
    }
    return json({});
  });
}

// --- mount ------------------------------------------------------------------
let container;
let root;
let savedSearchesState;

function props(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    savedSearches: savedSearchesState,
    setSavedSearches: (updater) => {
      savedSearchesState =
        typeof updater === "function" ? updater(savedSearchesState) : updater;
    },
    setSavedSearchAutoTailor: () => {},
    deleteSavedSearch: () => {},
    GREENHOUSE_COMPANIES: [],
    COMPANY_CATEGORIES: [],
    onTailor: async () => "",
    canTailor: true,
    ...overrides,
  };
}

async function mount(overrides) {
  await act(async () => {
    root.render(
      createElement(ThemeProvider, { theme }, createElement(LiveFeedTab, props(overrides))),
    );
  });
  // The initial /api/feed load is behind a 300ms debounce (LiveFeedTab.js's
  // "Initial load + reload when filters change"). Real timers, not fake ones:
  // the component also owns a 30s tick and a 60s auto-refresh, and advancing a
  // fake clock past those re-enters the fetch path mid-assertion.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

beforeEach(() => {
  viewportWidth = PHONE;
  feedItems = [];
  savedSearchesState = [];
  window.localStorage.clear();
  installFetch();
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
  delete global.fetch;
});

// --- locators ---------------------------------------------------------------
// The saved-search strip's "+ Save current feed search" tile is the panel's
// most distinctive node and is rendered ONLY inside the filter panel, so
// "where is this element" answers "where is the panel" without depending on
// any class name this change introduces.
const panelProbe = () =>
  document.querySelector('[role="button"][title="Save current search controls"]');

const tabSection = () => container.querySelector("section");

const buttons = () => Array.from(document.querySelectorAll("button"));

function accessibleName(el) {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();
  return (el.textContent || "").trim();
}

const named = (re) => buttons().find((b) => re.test(accessibleName(b)));

// On a phone the filter panel is ITSELF a dialog, so once the naming dialog
// opens there are two, and `document.querySelector('[role="dialog"] input')`
// silently answers with the sheet's first search field instead. MUI portals
// each modal to the end of <body> as it opens, so the most recently opened one
// is the last in DOM order; every case using this also asserts it is not the
// sheet, so a wrong answer here cannot pass unnoticed.
function topDialog() {
  const all = Array.from(document.querySelectorAll('[role="dialog"]'));
  return all.length > 0 ? all[all.length - 1] : null;
}

async function click(el) {
  await act(async () => {
    el.click();
  });
}

// MUI keeps a closing Dialog's children mounted for the length of its exit
// transition, so "did it close" cannot be read on the same tick as the click.
// Real timers (see mount()) -- 500ms comfortably outclasses MUI's ~195-225ms
// Fade. This waits for the transition; it does not paper over a panel that
// stays open, which would still be present after it.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
}

async function openFilters() {
  const filters = named(/^filters\b/i);
  expect(filters, "the toolbar's Filters button").toBeTruthy();
  await click(filters);
}

// ---------------------------------------------------------------------------
// HARNESS POSITIVE CONTROL. If any of this fails, every case below is
// measuring nothing and its result is INVALID -- not a zero.
// ---------------------------------------------------------------------------
describe("LiveFeedTab mobile -- harness", () => {
  it("mounts, renders the toolbar, and can open the filter panel at all", async () => {
    await mount();
    expect(tabSection()).toBeTruthy();
    expect(named(/^filters\b/i)).toBeTruthy();
    expect(panelProbe()).toBeNull(); // closed to begin with
    await openFilters();
    expect(panelProbe()).toBeTruthy();
  });

  it("resolves a responsive `bottom` through the computed cascade", async () => {
    // The instrument N11's two cases depend on. jsdom's getComputedStyle
    // implements only a subset of properties properly; proving it round-trips
    // `bottom` from a breakpointed `sx` here means a later "8px" reading is a
    // real measurement rather than an unimplemented property.
    await act(async () => {
      root.render(
        createElement(
          ThemeProvider,
          { theme },
          createElement(Box, {
            "data-testid": "probe",
            sx: { position: "fixed", bottom: { xs: 96, sm: 24 } },
          }),
        ),
      );
    });
    const probe = container.querySelector('[data-testid="probe"]');
    expect(atWidth(PHONE, () => window.getComputedStyle(probe).bottom)).toBe("96px");
    expect(atWidth(DESKTOP, () => window.getComputedStyle(probe).bottom)).toBe("24px");
  });
});

// ---------------------------------------------------------------------------
// M3 -- the filter panel must stop displacing the feed on a phone.
// REAL BEHAVIOUR + STRUCTURAL PROXY.
// ---------------------------------------------------------------------------
describe("LiveFeedTab mobile -- M3: the filter panel is a sheet, not an inline wall", () => {
  it("renders the open panel inside a modal dialog on a phone", async () => {
    await mount();
    await openFilters();
    const probe = panelProbe();
    expect(probe).toBeTruthy();
    expect(probe.closest('[role="dialog"]')).toBeTruthy();
  });

  it("keeps the open panel out of the tab's own flow, so the feed is not pushed down", async () => {
    // STRUCTURAL PROXY, stated honestly: this asserts the MECHANISM of the
    // displacement (a multi-thousand-pixel block rendered above the list in
    // normal flow), not the displacement itself, which needs layout.
    await mount();
    await openFilters();
    expect(panelProbe()).toBeTruthy();
    expect(tabSection().contains(panelProbe())).toBe(false);
  });

  it("gives the phone sheet a control that dismisses it and returns the user to the feed", async () => {
    await mount();
    await openFilters();
    expect(panelProbe()).toBeTruthy();
    const dialog = panelProbe().closest('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const dismiss = Array.from(dialog.querySelectorAll("button")).find((b) =>
      /close|show results|done/i.test(accessibleName(b)),
    );
    expect(dismiss, "a dismiss control inside the filter sheet").toBeTruthy();
    expect(dismiss.disabled).toBe(false);
    await click(dismiss);
    await settle();
    expect(panelProbe()).toBeNull();
  });

  it("GUARD (passes before the fix): desktop keeps the panel inline, in no dialog", async () => {
    // The desktop layout must not change. Without this, "put it in a dialog"
    // that fires at every width also satisfies the three cases above.
    viewportWidth = DESKTOP;
    await mount();
    await openFilters();
    const probe = panelProbe();
    expect(probe).toBeTruthy();
    expect(probe.closest('[role="dialog"]')).toBeNull();
    expect(tabSection().contains(probe)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// N6 -- naming a saved search must not go through window.prompt.
// REAL BEHAVIOUR.
// ---------------------------------------------------------------------------
describe("LiveFeedTab mobile -- N6: naming a saved search without window.prompt", () => {
  it("never calls window.prompt", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Typed into the OS modal");
    await mount();
    await openFilters();
    await click(panelProbe());
    expect(prompt).not.toHaveBeenCalled();
  });

  it("opens an in-page dialog carrying an editable, pre-filled name field", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null); // the webview behaviour N6 is about
    await mount({ savedSearches: [] });
    await openFilters();
    await click(panelProbe());

    const dialog = topDialog();
    expect(dialog).toBeTruthy();
    expect(dialog.contains(panelProbe()), "the naming dialog, not the filter sheet").toBe(false);
    const field = dialog.querySelector("input");
    expect(field, "a text field to name the search").toBeTruthy();
    // Pre-filled with the same default the prompt used to offer, so the common
    // case is one tap and not a typing job on a phone keyboard.
    expect(field.value.trim()).not.toBe("");
  });

  it("saves under the name the user typed", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    await mount();
    await openFilters();
    await click(panelProbe());

    const dialog = topDialog();
    expect(dialog).toBeTruthy();
    expect(dialog.contains(panelProbe())).toBe(false);
    const field = dialog.querySelector("input");
    expect(field).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(field, "Backend roles, London");
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });

    const save = Array.from(dialog.querySelectorAll("button")).find((b) =>
      /^save$/i.test(accessibleName(b)),
    );
    expect(save, "the dialog's Save action").toBeTruthy();
    await click(save);

    expect(postedSavedSearches.map((b) => b.name)).toContain("Backend roles, London");
    expect(savedSearchesState.map((s) => s.name)).toContain("Backend roles, London");
  });

  it("floors the name field itself to the 44px touch minimum on a phone only", async () => {
    // DECLARED-VALUE PROXY. `size="small"` trims an input's padding to about
    // 40px of real target -- under the minimum, on the one control of this
    // change a phone user actually has to hit and type into.
    vi.spyOn(window, "prompt").mockReturnValue(null);
    await mount();
    await openFilters();
    await click(panelProbe());

    const dialog = topDialog();
    expect(dialog.contains(panelProbe())).toBe(false);
    const inputRoot = dialog.querySelector(".MuiInputBase-root");
    expect(inputRoot, "the name field's input surface").toBeTruthy();
    expect(atWidth(PHONE, () => window.getComputedStyle(inputRoot).minHeight)).toBe("44px");
    expect(atWidth(DESKTOP, () => window.getComputedStyle(inputRoot).minHeight)).toBe("auto");
  });

  it("saves nothing when the naming dialog is dismissed", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    await mount();
    await openFilters();
    await click(panelProbe());

    const dialog = topDialog();
    expect(dialog).toBeTruthy();
    expect(dialog.contains(panelProbe())).toBe(false);
    const cancel = Array.from(dialog.querySelectorAll("button")).find((b) =>
      /cancel|close/i.test(accessibleName(b)),
    );
    expect(cancel, "a way out of the naming dialog").toBeTruthy();
    await click(cancel);
    await settle();

    expect(postedSavedSearches).toHaveLength(0);
    expect(savedSearchesState).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// N11 -- the autofill toast must clear the chat FAB and the tracking dock.
// DECLARED-VALUE PROXY.
// ---------------------------------------------------------------------------
describe("LiveFeedTab mobile -- N11: the toast does not land on the FAB or the dock", () => {
  async function openToast() {
    feedItems = [POSTING];
    const opened = { closed: false, focus() {}, resizeTo() {}, moveTo() {} };
    vi.spyOn(window, "open").mockReturnValue(opened);
    // openPostingBeside also docks the CURRENT window; jsdom implements
    // neither method and logs "Not implemented" to the shared suite output for
    // each call. Stubbed for quiet, not to change what is exercised.
    vi.spyOn(window, "resizeTo").mockImplementation(() => {});
    vi.spyOn(window, "moveTo").mockImplementation(() => {});
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => {} },
    });
    await mount();
    const autofill = named(/^auto fill/i);
    expect(autofill, "the card's Auto Fill control").toBeTruthy();
    await click(autofill);
    const snackbar = document.querySelector(".MuiSnackbar-root");
    expect(snackbar, "the autofill snackbar").toBeTruthy();
    return snackbar;
  }

  it("sits above the FAB's 80px resting envelope on a phone", async () => {
    const snackbar = await openToast();
    const bottom = atWidth(PHONE, () => window.getComputedStyle(snackbar).bottom);
    // The FAB rests at bottom:24 and is 56px tall, so it occupies 24..80px.
    // Anything at or below 80 overlaps it; MUI's own phone default is 8px.
    expect(Number.parseFloat(bottom)).toBeGreaterThanOrEqual(88);
  });

  it("GUARD (passes before the fix): desktop keeps MUI's own 24px offset", async () => {
    viewportWidth = DESKTOP;
    const snackbar = await openToast();
    const bottom = atWidth(DESKTOP, () => window.getComputedStyle(snackbar).bottom);
    expect(bottom).toBe("24px");
  });
});

// ---------------------------------------------------------------------------
// This tab's OWN controls against the 44px floor. Everything else on the
// feed's controls belongs to the components that own them (the toolbar, the
// posting card, the saved-search strip, the filter controls) and is out of
// this file set -- these three are rendered by LiveFeedTab.js itself and were
// the only ones left under the minimum here. The name field's case lives in
// the N6 block above, beside the dialog it belongs to.
//
// DECLARED-VALUE PROXY. jsdom cannot measure a tap target (no layout), so what
// is asserted is that the shared contract's declaration reaches the element,
// at the phone width and not above it.
// ---------------------------------------------------------------------------
describe("LiveFeedTab mobile -- the tab's own controls meet the 44px floor", () => {
  it("floors the feed's 'Load more' pagination button on a phone only", async () => {
    // A default-size MUI Button is 14px * 1.75 + 12 = 36.5px tall
    // (Button.js:98,213,231) -- under the iOS HIG minimum, and this is the one
    // control a user has to hit repeatedly to walk the feed.
    feedItems = [POSTING];
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.startsWith("/api/feed")) {
        return json({ items: feedItems, nextCursor: "c2", lastUpdatedAt: null, sourceHealth: {} });
      }
      if (u.startsWith("/api/user-profile")) return json({ profile: PROFILE });
      return json({ items: [], counts: {} });
    });
    await mount();
    const loadMore = named(/load more/i);
    expect(loadMore, "the Load more button").toBeTruthy();
    expect(atWidth(PHONE, () => window.getComputedStyle(loadMore).minHeight)).toBe("44px");
    // `sm: "auto"` is min-height's own initial value, per app/theme/mobileSx.js
    // -- the desktop rendering must be untouched, not merely "different".
    expect(atWidth(DESKTOP, () => window.getComputedStyle(loadMore).minHeight)).toBe("auto");
  });

  it("floors the error Alert's dismiss control on a phone only", async () => {
    // MUI's Alert close button is an `IconButton size="small"`: padding 5 plus
    // a 20px icon = a 30x30 target, and it sits inline with body text where a
    // mis-tap is easy.
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.startsWith("/api/feed")) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
      }
      if (u.startsWith("/api/user-profile")) return json({ profile: PROFILE });
      return json({ items: [], counts: {} });
    });
    await mount();
    const dismiss = document.querySelector(".MuiAlert-root button");
    expect(dismiss, "the error alert's dismiss control").toBeTruthy();
    const phone = atWidth(PHONE, () => {
      const s = window.getComputedStyle(dismiss);
      return [s.minWidth, s.minHeight];
    });
    expect(phone).toEqual(["44px", "44px"]);
    const desktop = atWidth(DESKTOP, () => {
      const s = window.getComputedStyle(dismiss);
      return [s.minWidth, s.minHeight];
    });
    expect(desktop).toEqual(["auto", "auto"]);
  });
});
