// @vitest-environment jsdom
//
// PHASE 1 of AC-back-button-r2 — THE MOUNT POINT AND WHAT IT COSTS.
//
// Criteria covered here: AC-15, AC-20, and §3's ruling that the control is the
// FIRST flex child of `app/components/AppHeader.js`'s `<header>`.
//
// PHASE 2 IS NOT IN SCOPE. Nothing here calls `history.pushState`, registers a
// `popstate` listener, or touches `lib/activityLog`.
//
// ---------------------------------------------------------------------------
// §3 — WHY THIS FILE AND NOT `NavTabs`
// ---------------------------------------------------------------------------
//
// The user said "the navigation bar at the top of the screen". `AppHeader` is
// the only candidate that is literally at the top: `position: sticky; top: 0;
// zIndex: 1100` (AppHeader.js:18-20), first element in `<body>`
// (layout.js:34-37), pinned while the page scrolls. `NavTabs size="main"`
// (page.js:2829-2842) sits inside `<main>` BELOW an `<h1>` and a subtitle and
// scrolls out of view — and, decisively, does not exist on `/copilot` or
// `/library`, so a control mounted there could not fix the dead end AC-7
// closes.
//
// The brand `<span>` carries `marginRight: "auto"` (AppHeader.js:33), so a new
// FIRST child sits hard left and the brand keeps its position. That is what
// "on the left of the navigation bar" means here, and it is asserted as DOM
// order — jsdom has no layout, so nothing below claims to measure a pixel
// position.
//
// ---------------------------------------------------------------------------
// AC-20 — MC-1 PROMOTED FROM "BROWSER ONLY"
// ---------------------------------------------------------------------------
//
// `app/copilot/useStickyTop.js` debits the header's height from the copilot
// question strip's budget, and refuses to host a sticky strip at all below a
// threshold. Growing the header moves that threshold. r2 §9.6 derives the
// band; this file re-derives it from the SOURCE OF THE NUMBERS rather than
// restating it:
//
//   floor    = STRIP_FLOOR_PX 64 + STRIP_FLOOR_REM 4.25 x 16   = 132px
//   hosting  = floor + STRIP_GUTTER_PX 12 <= STRIP_MAX_SHARE 0.60 x availPx
//            => availPx >= 240, where availPx = viewportH - headerH
//   today    headerH 61 (useStickyTop.test.js:103)             => viewportH >= 301
//   after    headerH 65 = 44 content + 20 padding + 1 border   => viewportH >= 305
//
// The 44 is READ OFF THE RENDERED CONTROL, not assumed, so a control that is
// taller than the touch floor moves the measured header height and fails the
// band. The 20 and the 1 are read out of AppHeader.js's own declared padding
// and border.
//
// WHY THOSE TWO ARE READ FROM SOURCE AND NOT FROM `getComputedStyle`:
// MEASURED, in this environment, before this file was written. jsdom's CSS
// parser REJECTS `padding: 10px clamp(12px, 4vw, 24px)` outright — the exact
// string at AppHeader.js:24 — and reads `paddingTop` back as `"0"`, with
// `borderBottomWidth` as `"medium"`. A computed-style derivation would
// therefore silently compute a 44px header and report a band that does not
// exist. That is a failed instrument, not a zero, so this file does not use
// it.
//
// MC-1 (still browser only): AppHeader.js:28 sets `flexWrap: "wrap"`, so at
// ~320px the extra control may push the header to a second row — a ~54px
// delta that no jsdom test can see. BackButton.test.js's AC-17
// (`flex-shrink: 0`) is the falsifiable mitigation.
// MC-2 (still browser only): real sequential focus traversal. AC-15 below pins
// DOM order and the absence of `tabIndex`, which is the falsifiable half.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, useState, useEffect, act, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { readFileSync } from "node:fs";
import path from "node:path";

import AppHeader from "./AppHeader.js";
import { SurfaceNavProvider, useSurfaceNav } from "../hooks/useSurfaceNav.js";
import { makeTheme } from "../theme/index.js";
import { atWidth } from "../theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "../theme/mobileSx.js";
import { useStickyTop } from "../copilot/useStickyTop.js";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP_DIR = path.join(process.cwd(), "app");
const DEFAULT_SURFACE = { mainTab: "applying", activeSection: "url" };

let container;
let root;

function freshRoot() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}

async function dropRoot() {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

beforeEach(() => {
  freshRoot();
});

afterEach(async () => {
  await dropRoot();
  for (const node of Array.from(document.querySelectorAll("[data-app-header]"))) node.remove();
  document.documentElement.style.removeProperty("--sticky-top");
  document.documentElement.style.removeProperty("--sticky-pad");
  document.documentElement.style.scrollPaddingTop = "";
});

// ---------------------------------------------------------------------- harness

/** Stands in for app/page.js, mounted as AppHeader's SIBLING the way layout.js does. */
function SurfaceHost({ apiRef }) {
  const [mainTab, setMainTab] = useState(DEFAULT_SURFACE.mainTab);
  const [activeSection, setActiveSection] = useState(DEFAULT_SURFACE.activeSection);
  const nav = useSurfaceNav({ mainTab, setMainTab, activeSection, setActiveSection });
  // Published from an effect, not the render body: assigning `apiRef.current`
  // during render trips react-hooks/refs. No dependency array, so every render
  // republishes; every read below is inside `act()`, which flushes effects first.
  useEffect(() => {
    apiRef.current = { nav, setMainTab, setActiveSection };
  }, [apiRef, nav, setMainTab, setActiveSection]);
  return createElement("span", { "data-testid": "main-tab" }, mainTab);
}

async function mountHeaderTree() {
  const apiRef = { current: null };
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(
          SurfaceNavProvider,
          null,
          createElement(AppHeader),
          createElement(SurfaceHost, { apiRef }),
        ),
      ),
    );
  });
  return apiRef;
}

const headerEl = () => container.querySelector("[data-app-header]");
const control = () => container.querySelector('[data-testid="back-control"]');
const spacer = () => container.querySelector('[data-testid="back-control-spacer"]');

/** Everything in the header a keyboard can land on. */
function focusablesIn(node) {
  return Array.from(
    node.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex], [role="combobox"]',
    ),
  ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("tabindex") !== "-1");
}

// ============================================================== §3 — the slot

describe("§3 — the control is the first flex child of the sticky header", () => {
  it("sits before the brand, in both the present and the absent state", async () => {
    const apiRef = await mountHeaderTree();
    const header = headerEl();
    expect(
      header,
      "[instrument] AppHeader rendered no [data-app-header] element — nothing below can be measured",
    ).toBeTruthy();

    // Absent state (default surface, empty stack): the spacer holds the slot.
    expect(
      header.firstElementChild,
      "at the default surface the header's first child must be the spacer, so the brand does not " +
        "slide left the moment the control disappears",
    ).toBe(spacer());

    // Home mode: the control itself takes the slot.
    await act(async () => apiRef.current.setMainTab("library"));
    expect(
      header.firstElementChild,
      "the control must be the header's FIRST child. The brand carries `marginRight: auto` " +
        "(AppHeader.js:33), so anything placed after it is no longer hard left.",
    ).toBe(control());

    expect(
      (header.textContent || "").includes("Resume Tailor"),
      "the brand must still be in the header — the control is added beside it, never instead of it",
    ).toBe(true);
  });

  it("the header still renders its two existing controls beside the new one", async () => {
    // themeSystem.test.js:136-142 asserts AppHeader.js still mentions
    // EngineSelect and SettingsMenu; this is the runtime half — a refactor
    // that hoists the back button by displacing the engine picker fails here.
    const apiRef = await mountHeaderTree();
    await act(async () => apiRef.current.setMainTab("library"));
    const names = focusablesIn(headerEl()).map((el) => el.getAttribute("aria-label"));
    expect(names).toContain("Tailoring engine");
    expect(names).toContain("Settings");
  });
});

// ============================================================ AC-15 — tab order

describe("AC-15 — the control is the document's first tab stop, with no tabIndex of its own", () => {
  it("is first among the header's focusables, and there is more than one", async () => {
    const apiRef = await mountHeaderTree();
    await act(async () => apiRef.current.setMainTab("library"));

    const focusables = focusablesIn(headerEl());
    expect(
      focusables.length,
      "[instrument] fewer than two focusables in the header, so \"first\" would be meaningless",
    ).toBeGreaterThanOrEqual(2);
    expect(
      focusables[0],
      "layout.js:34-37 puts <Providers> (no DOM) then <AppHeader /> first in <body>, and there is no " +
        "skip link anywhere in app/, so the header's first focusable IS the document's first tab stop",
    ).toBe(control());
  });

  it("carries no tabIndex that moves it out of the natural order", async () => {
    // MEASURED, not assumed: MUI's ButtonBase renders `tabIndex={disabled ? -1
    // : tabIndex}` with a default of 0, so EVERY control in this header —
    // SettingsMenu's included — carries a literal `tabindex="0"`. Asserting
    // the attribute is absent would therefore reject the correct
    // implementation. "0" IS the natural order; the falsifiable claim is that
    // the value is never positive (which would reorder the whole document) and
    // never -1 (which would remove the control from the keyboard entirely,
    // exactly the outcome r2 §6.3 rejects `disabled` for).
    const apiRef = await mountHeaderTree();
    await act(async () => apiRef.current.setMainTab("library"));
    const raw = control().getAttribute("tabindex");
    expect(raw === null || raw === "0", `tabindex was ${JSON.stringify(raw)}`).toBe(true);

    const others = focusablesIn(headerEl())
      .filter((el) => el !== control())
      .map((el) => el.getAttribute("tabindex"));
    expect(
      others.every((value) => value === null || value === "0"),
      `another header control carries a non-natural tabindex (${others.join(", ")}), so "first in the ` +
        `tab order" would no longer follow from DOM order`,
    ).toBe(true);
  });

  it("the spacer never becomes a tab stop when the control is absent", async () => {
    await mountHeaderTree();
    expect(control(), "[instrument] this case needs the ABSENT state").toBeNull();
    expect(
      focusablesIn(headerEl()).some((el) => el === spacer()),
      "hiding the control must not leave a focusable husk in its place",
    ).toBe(false);
  });
});

// ================================================= AC-20 — the header's height

describe("AC-20 — the header grows by exactly the touch floor, and the sticky band moves 4px", () => {
  /** AppHeader's own declared vertical chrome, read off the literals in its source. */
  function declaredChrome() {
    const src = readFileSync(path.join(APP_DIR, "components/AppHeader.js"), "utf8");
    const padding = /padding:\s*"(\d+(?:\.\d+)?)px\s/.exec(src);
    const border = /borderBottom:\s*"(\d+(?:\.\d+)?)px\s/.exec(src);
    expect(
      padding,
      "could not read AppHeader's declared vertical padding out of its source. jsdom's CSS parser " +
        "rejects `padding: 10px clamp(...)` and reads it back as \"0\", so this derivation cannot fall " +
        "back to getComputedStyle. A failed instrument is INVALID.",
    ).toBeTruthy();
    expect(border, "could not read AppHeader's declared bottom border out of its source").toBeTruthy();
    return { paddingY: Number(padding[1]) * 2, borderY: Number(border[1]) };
  }

  /** The control's own declared content box on a phone. */
  async function controlMinHeightAtXs() {
    const apiRef = await mountHeaderTree();
    await act(async () => apiRef.current.setMainTab("library"));
    const node = control();
    expect(node, "[instrument] no control to measure").toBeTruthy();
    const value = atWidth(375, () => window.getComputedStyle(node).minHeight);
    return Number.parseFloat(value) || 0;
  }

  it("[instrument] this environment still has no ResizeObserver and no layout", () => {
    expect(typeof ResizeObserver).toBe("undefined");
    expect(document.createElement("div").getBoundingClientRect().height).toBe(0);
  });

  it("the measured header height is 65px: 44 content + 20 padding + 1 border", async () => {
    const { paddingY, borderY } = declaredChrome();
    const contentH = await controlMinHeightAtXs();

    expect(contentH, "the control's declared min-height on a phone").toBe(MOBILE_TAP_MIN);
    expect(paddingY, "AppHeader.js:24 declares `10px` top and bottom").toBe(20);
    expect(borderY, "AppHeader.js:25 declares a 1px bottom border").toBe(1);
    expect(
      contentH + paddingY + borderY,
      "r2 §9.6's whole argument is that the header grows from 61px to 65px and no further. A taller " +
        "control moves the copilot strip's hosting threshold by more than the 4px band below.",
    ).toBe(65);
  });

  it("flips the copilot strip's hosting threshold from 301 to 305, and no further", async () => {
    const { paddingY, borderY } = declaredChrome();
    const headerH = (await controlMinHeightAtXs()) + paddingY + borderY;
    await dropRoot();
    for (const node of Array.from(document.querySelectorAll("[data-app-header]"))) node.remove();
    freshRoot();

    // useStickyTop.test.js:30-42's own instruments: jsdom has no layout, so
    // both inputs to the predicate are injected directly.
    const setViewport = (clientHeight) =>
      Object.defineProperty(document.documentElement, "clientHeight", {
        value: clientHeight,
        configurable: true,
      });
    const stubHeader = (height) => {
      const el = document.createElement("header");
      el.setAttribute("data-app-header", "");
      el.getBoundingClientRect = () => ({ height, top: 0, bottom: height, left: 0, right: 0, width: 0 });
      document.body.appendChild(el);
      return el;
    };

    function Probe() {
      const { stripRef, stickyTop } = useStickyTop();
      return createElement("div", { ref: stripRef, "data-testid": "sticky-top" }, String(stickyTop));
    }

    async function hostableAt(viewportH, height) {
      await dropRoot();
      for (const node of Array.from(document.querySelectorAll("[data-app-header]"))) node.remove();
      freshRoot();
      setViewport(viewportH);
      stubHeader(height);
      await act(async () => {
        root.render(createElement(Probe));
      });
      return container.querySelector('[data-testid="sticky-top"]').textContent !== "null";
    }

    // Today's baseline, from useStickyTop.test.js:103's own figure. Recorded
    // so the band below is a DELTA against a measured "before", not a bare
    // pair of numbers.
    expect(await hostableAt(301, 61), "today's 61px header hosts at viewportH 301").toBe(true);

    expect(
      await hostableAt(304, headerH),
      `at a ${headerH}px header the strip must NOT be hostable at viewportH 304 (availPx 239: the ` +
        `132px floor plus the 12px gutter is 144, past 60% of 239)`,
    ).toBe(false);
    expect(
      await hostableAt(305, headerH),
      `at a ${headerH}px header the strip MUST be hostable at viewportH 305 (availPx 240: 144 <= 144 ` +
        `exactly). Failing here means the header grew by more than 4px and the regression band is ` +
        `wider than r2 §9.6 priced it.`,
    ).toBe(true);
  });
});
