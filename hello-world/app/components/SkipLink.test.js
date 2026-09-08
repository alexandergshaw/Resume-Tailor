// @vitest-environment jsdom
//
// THE SKIP LINK — the app's first tab stop, and the dock's second target.
//
// Owner's request: "i should be able to navigate the entire app very cleanly
// with only mouse and keyboard". Two of the three remaining blockers meet
// here:
//
//   1. There was no skip link anywhere in the app. A keyboard user landing on
//      any route had to walk the whole header on every navigation, and had no
//      way at all to jump past it.
//   3. The bottom dock (`.floatingToolbar`, `position: fixed; bottom: 0`) is
//      permanently on screen but is the LAST thing in the DOM, so its per-job
//      controls sit behind every focusable in the active tab — measured at
//      roughly 230 Tab presses with 20 tracked applications. The second link
//      below is the ruled mechanism: one Tab, one Enter, from page load.
//
// ---------------------------------------------------------------------------
// WHY layout.js AND NOT AppHeader — a live test forces this
// ---------------------------------------------------------------------------
//
// `AppHeader.backButton.test.js`'s §3 asserts the back control is
// `header.firstElementChild`, and its AC-15 asserts the control is
// `focusablesIn(headerEl())[0]`. Both are scoped to the HEADER's subtree, so a
// skip link mounted before `<AppHeader/>` in `app/layout.js` leaves both
// green while still being first in the document. A skip link mounted INSIDE
// the header would break both. That is the whole reason for the mount point,
// and `appLandmarks.test.js` pins the layout.js ordering that makes it true.
//
// (Reported, not edited: that file's AC-15 comment at :222-224 says "there is
// no skip link anywhere in app/, so the header's first focusable IS the
// document's first tab stop". The ASSERTION is header-scoped and still holds;
// only the prose justification is now stale.)
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE DELIBERATELY DOES NOT CLAIM TO PROVE
// ---------------------------------------------------------------------------
//
// **jsdom has no layout engine and cannot observe real sequential focus
// traversal.** `getBoundingClientRect()` returns zeros and there is no
// `Tab` implementation. So "first in tab order" is NOT asserted by pressing
// Tab — it is asserted as the two things that are actually machine-checkable
// here and that together imply it:
//
//   (a) DOM order — the link precedes every other focusable in a tree mounted
//       in layout.js's own order; and
//   (b) the absence of any positive `tabIndex` anywhere in that tree, which is
//       the only thing that could reorder traversal away from DOM order.
//
// MUI's ButtonBase renders a LITERAL `tabindex="0"` on every control
// (`tabIndex={disabled ? -1 : tabIndex}`, default 0), so asserting the
// attribute is ABSENT would reject a correct implementation. The falsifiable
// claim is that no value is positive and none is -1. Same reading as
// AppHeader.backButton.test.js:227-249, and the instrument case below records
// the zero-layout fact rather than letting a reader assume otherwise.
//
// BROWSER ONLY, never asserted here:
//   - that the link is visually hidden until focused and visible once focused
//     (a `getComputedStyle` on a `:focus` rule needs real focus + layout);
//   - that activating it actually scrolls and moves the caret to the target;
//   - that the revealed link is not painted under the sticky header.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import SkipLink from "./SkipLink.js";
import AppHeader from "./AppHeader.js";
import { SurfaceNavProvider } from "../hooks/useSurfaceNav.js";
import { makeTheme } from "../theme/index.js";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The two ids the whole feature is wired on. Every route's landmark and both
// hrefs must agree on these; appLandmarks.test.js pins the other half.
const MAIN_ID = "main-content";
const DOCK_ID = "job-dock";

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  for (const node of Array.from(document.querySelectorAll(`#${DOCK_ID}`))) node.remove();
  vi.restoreAllMocks();
});

async function mountSkipLink() {
  await act(async () => {
    root.render(createElement(SkipLink));
  });
}

/** Mirrors app/layout.js: SkipLink, then AppHeader, then the route's content. */
async function mountLayoutOrder() {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(
          SurfaceNavProvider,
          null,
          createElement(SkipLink),
          createElement(AppHeader),
          createElement("main", { id: MAIN_ID, tabIndex: -1 }, createElement("button", null, "In main")),
        ),
      ),
    );
  });
}

/** Everything in `node` a keyboard can sequentially land on. */
function focusablesIn(node) {
  return Array.from(
    node.querySelectorAll('button, a[href], input, select, textarea, [tabindex], [role="combobox"]'),
  ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("tabindex") !== "-1");
}

const skipLinks = () => Array.from(container.querySelectorAll("a[href^='#']"));
const mainLink = () => container.querySelector(`a[href="#${MAIN_ID}"]`);
const dockLink = () => container.querySelector(`a[href="#${DOCK_ID}"]`);

/** Puts a stand-in dock in the document, the way StatusBar's fixed dock does. */
function addDock() {
  const el = document.createElement("section");
  el.id = DOCK_ID;
  document.body.appendChild(el);
  return el;
}

// ============================================================ the instrument

describe("[instrument] what this environment can and cannot see", () => {
  it("has no layout, so no case below may claim to have observed traversal", () => {
    expect(document.createElement("div").getBoundingClientRect().height).toBe(0);
  });

  it("HAS MutationObserver, which is what the dock-presence gate is built on", () => {
    // If this ever regresses to undefined, the dock link's gate would silently
    // never update and its cases below would be vacuous rather than failing.
    expect(typeof MutationObserver).toBe("function");
  });
});

// ==================================================== blocker 1 — the skip link

describe("blocker 1 — the app has a skip link at all", () => {
  it("renders a navigation landmark with an accessible name of its own", async () => {
    await mountSkipLink();
    const nav = container.querySelector("nav");
    expect(nav, "the skip links must be grouped in their own landmark").not.toBeNull();
    expect(
      nav.getAttribute("aria-label"),
      "an unnamed <nav> is indistinguishable from the app's other navigation in a landmark list",
    ).toBeTruthy();
  });

  it("offers a link to the main landmark, with a LITERAL href", async () => {
    await mountSkipLink();
    const link = mainLink();
    expect(link, `no anchor targeting #${MAIN_ID}`).not.toBeNull();
    expect(
      link.getAttribute("href"),
      "hrefSafety.sweep.test.js only exempts LITERAL hrefs from safeExternalHref — a computed " +
        "href here would be swept into that gate and fail it",
    ).toBe(`#${MAIN_ID}`);
    expect(
      (link.textContent || "").trim().length,
      "the link must have a visible, self-describing name",
    ).toBeGreaterThan(0);
    expect(link.textContent).toMatch(/skip/i);
  });

  it("is the first focusable in the document when mounted in layout.js's order", async () => {
    await mountLayoutOrder();
    const focusables = focusablesIn(container);
    expect(
      focusables.length,
      '[instrument] fewer than two focusables, so "first" would be meaningless',
    ).toBeGreaterThanOrEqual(3);
    expect(
      focusables[0],
      "app/layout.js must render <SkipLink/> BEFORE <AppHeader/>. jsdom cannot press Tab, so this " +
        "is DOM order; the next case supplies the other half (no positive tabIndex).",
    ).toBe(mainLink());
  });

  it("adds no tabIndex that reorders traversal, on itself or anything after it", async () => {
    await mountLayoutOrder();
    const values = focusablesIn(container).map((el) => el.getAttribute("tabindex"));
    expect(
      values.every((v) => v === null || v === "0"),
      `a control carries a non-natural tabindex (${values.join(", ")}), so "first in the tab order" ` +
        "would no longer follow from DOM order. MUI's ButtonBase renders a literal 0; that is the " +
        "natural order and is accepted. Positive values and -1 are not.",
    ).toBe(true);
  });

  it("does not leave the back button behind: AppHeader's own first-focusable contract survives", async () => {
    // The guard for the interaction that made layout.js the only viable mount
    // point. Green before this feature and required to stay green after it.
    await mountLayoutOrder();
    const header = container.querySelector("[data-app-header]");
    expect(header, "[instrument] AppHeader rendered nothing to measure").not.toBeNull();
    expect(
      focusablesIn(header).length,
      "[instrument] the header must still contain its own controls",
    ).toBeGreaterThanOrEqual(2);
    expect(
      container.querySelector("nav")?.contains(header),
      "the skip nav must be a SIBLING of the header, never wrap it — wrapping would put the " +
        "header's controls inside a navigation landmark they do not belong to",
    ).toBe(false);
  });
});

// ================================================= blocker 3 — reaching the dock

describe("blocker 3 — the bottom dock is one Tab and one Enter away, not ~230 Tabs", () => {
  it("offers no dock link when no dock is on the page", async () => {
    await mountSkipLink();
    expect(
      dockLink(),
      "a skip link whose target does not exist is worse than none — it is a tab stop that goes nowhere",
    ).toBeNull();
    expect(skipLinks().length).toBe(1);
  });

  it("offers a dock link, with a LITERAL href, once a dock is present", async () => {
    addDock();
    await mountSkipLink();
    const link = dockLink();
    expect(
      link,
      `no anchor targeting #${DOCK_ID}. The dock is permanently visible but LAST in the DOM; this ` +
        "link is the ruled mechanism for reaching it.",
    ).not.toBeNull();
    expect(link.getAttribute("href")).toBe(`#${DOCK_ID}`);
    expect(link.textContent).toMatch(/skip/i);
  });

  it("picks up a dock that appears AFTER it mounted (the real order: the dock is mounted by a later route render)", async () => {
    await mountSkipLink();
    expect(dockLink(), "[instrument] this case needs the absent state first").toBeNull();

    await act(async () => {
      addDock();
    });
    expect(
      dockLink(),
      "the dock appears when the first job is tracked, long after layout.js mounted this component. " +
        "A one-shot read at mount would leave the link missing for the entire session.",
    ).not.toBeNull();
  });

  it("withdraws the dock link when the dock goes away (Clear all unmounts it)", async () => {
    const dock = addDock();
    await mountSkipLink();
    expect(dockLink(), "[instrument] this case needs the present state first").not.toBeNull();

    await act(async () => {
      dock.remove();
    });
    expect(
      dockLink(),
      '"Clear all" is setTrackedJobs([]) and StatusBar then returns null. The link must not survive ' +
        "its target.",
    ).toBeNull();
  });

  it("keeps the main-content link first when both are showing", async () => {
    addDock();
    await mountSkipLink();
    const links = skipLinks();
    expect(links.length).toBe(2);
    expect(
      links[0],
      "main content is the common case and must stay the first tab stop; the dock is the second",
    ).toBe(mainLink());
  });
});
