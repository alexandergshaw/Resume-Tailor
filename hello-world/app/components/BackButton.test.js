// @vitest-environment jsdom
//
// PHASE 1 of AC-back-button-r2 — THE CONTROL ITSELF.
//
// Criteria covered here: AC-6, AC-7, AC-8a, AC-8b, AC-B1c, AC-13, AC-14,
// AC-16, AC-17, plus §9.4's "a <button>, never a computed href".
//
// PHASE 2 IS NOT IN SCOPE. Nothing here calls `history.pushState`, registers a
// `popstate` listener, or touches `lib/activityLog`.
//
// ---------------------------------------------------------------------------
// THE FOUR MODES (r2 §6.3) — one control, never a disabled no-op
// ---------------------------------------------------------------------------
//
//   stack non-empty                      Back   "Back to {top.label}"    <button>
//   empty, on /copilot or /library       Exit   "Back to Resume Tailor"  <a href="/">
//   empty, on /, not at the default      Home   "Go to Materials"        <button>
//   empty, on /, at the default surface  Absent  not rendered; a fixed-width spacer holds its place
//
// The Exit mode's anchor is the ONE place an href may appear, and it must be a
// hard-coded LITERAL "/". `app/components/hrefSafety.sweep.test.js:194`
// requires every non-literal href under app/ to be produced by
// `safeExternalHref`, and that sweep's ungated allow-list is frozen at exactly
// two files (`:202-205`) — so `href={computedTarget}` fails a test that
// already ships. `:220-224` classifies literals separately and asks only that
// they start with "/", which "/" satisfies.
//
// ---------------------------------------------------------------------------
// WHY THE aria-label IS ASSERTED SEPARATELY FROM ANY TOOLTIP (r2 §7)
// ---------------------------------------------------------------------------
//
// A MUI `Tooltip` supplies naming props to its child, and this codebase
// already treats "the tooltip is the accessible name" as a defect:
// `SettingsMenu.js:80-89`, the other control in this very header, pairs
// `<Tooltip title="Settings">` with an explicit `aria-label="Settings"` on the
// IconButton. AC-16 pins the same shape here — with the difference that this
// control's name is DYNAMIC (it names the destination), so a static "Back" is
// not enough and is asserted against directly.
//
// ---------------------------------------------------------------------------
// WHAT jsdom CAN AND CANNOT MEASURE HERE
// ---------------------------------------------------------------------------
//
// jsdom has NO layout engine: `getBoundingClientRect()` is all zeros, so
// nothing below asserts geometry, wrapped lines, or real focus traversal.
// DECLARED CSS is readable, through emotion's real cascade, via
// `app/theme/computedStyleAtWidth.js` — that module's header explains why a
// responsive `sx` value needs its media-condition rewrite to be visible at
// all. Every value asserted below is a RESOLVED one ("44px", "0", "auto"),
// never the authored one: in MUI 9's `sx` a bare number is a spacing
// multiplier on some keys and a px length on others, so what was typed is not
// evidence for what renders.
//
// A CONSEQUENCE OF HAVING NO LAYOUT, stated rather than worked around: the
// spacer rule (AC-6) can only be checked if BOTH the control and the spacer
// declare a definite width. jsdom cannot measure a rendered `width: auto`, so
// against an auto-width control the comparison would be "auto" vs "auto" —
// true, and worth nothing. The control therefore owes a declared width; the
// instrument check in AC-6 fails loudly rather than passing quietly if it has
// none.
//
// MC-1 (browser only): whether the extra control pushes AppHeader's
// `flexWrap: "wrap"` row onto a second line at ~320px. AC-17's
// `flex-shrink: 0` is the falsifiable mitigation; the wrap itself needs a real
// browser.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, useState, useEffect, act, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import { SurfaceNavProvider, useSurfaceNav } from "../hooks/useSurfaceNav.js";
import BackButton from "./BackButton.js";
import { makeTheme } from "../theme/index.js";
import { tokens } from "../theme/tokens.js";
import { atWidth } from "../theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "../theme/mobileSx.js";

// `usePathname` decides Exit vs Home (r2 §6.3). `vi.hoisted` so the mock
// factory never reads an uninitialised binding.
const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULT_SURFACE = { mainTab: "applying", activeSection: "url" };
const FOCUS_VISIBLE_CLASS = "Mui-focusVisible";

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
  route.pathname = "/";
  freshRoot();
});

afterEach(async () => {
  await dropRoot();
});

// ---------------------------------------------------------------------- harness

/** Stands in for app/page.js: owns the two surface fields and routes through the hook. */
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
  return createElement(
    Fragment,
    null,
    createElement("span", { "data-testid": "main-tab" }, mainTab),
    createElement("span", { "data-testid": "active-section" }, activeSection),
  );
}

/**
 * Mounts the control the way `app/layout.js` does: provider above, control a
 * SIBLING of the surface owner. `host: false` reproduces `/copilot` and
 * `/library`, where no page.js exists to register a surface at all — which is
 * exactly the dead end AC-7 closes (r2 §2.1).
 */
async function mount({ host = true } = {}) {
  const apiRef = { current: null };
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(
          SurfaceNavProvider,
          null,
          createElement(BackButton),
          host ? createElement(SurfaceHost, { apiRef }) : null,
        ),
      ),
    );
  });
  return apiRef;
}

/** Unmount and start over inside one `it`, for cases that iterate surfaces. */
async function remount() {
  await dropRoot();
  freshRoot();
  return mount();
}

const control = () => container.querySelector('[data-testid="back-control"]');
const spacer = () => container.querySelector('[data-testid="back-control-spacer"]');
const labelOf = () => (control() ? control().getAttribute("aria-label") : null);

function requireControl(why) {
  const node = control();
  expect(
    node,
    `${why}\nNo [data-testid="back-control"] in the DOM. A failed instrument is INVALID, never a zero.`,
  ).toBeTruthy();
  return node;
}

/** Declared box at one emulated width. Resolved values only. */
function boxAt(node, width) {
  return atWidth(width, () => {
    const style = window.getComputedStyle(node);
    return {
      width: style.width,
      minWidth: style.minWidth,
      minHeight: style.minHeight,
      flexShrink: style.flexShrink,
    };
  });
}

const pxOf = (value) => Number.parseFloat(value) || 0;
const isDefiniteLength = (value) => /^\d+(\.\d+)?px$/.test(String(value));

/** Normalise "#0d4a8f" / "rgb(13, 74, 143)" to a comparable triple. */
function rgbOf(value) {
  const css = String(value).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(",");
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(css);
  if (fn) return fn[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number).join(",");
  return css;
}

// ==========================================================================
// AC-8a / AC-8b / AC-B1c — the accessible name is the promise
// ==========================================================================

describe("AC-8a — the name says where back goes, and changes with the stack top", () => {
  it("a static \"Back\" is not enough: the label follows the top of the stack", async () => {
    const apiRef = await mount();

    await act(async () => apiRef.current.nav.goMainTab("library"));
    expect(
      labelOf(),
      "one entry, holding {mainTab: applying} — the control must name Materials, not \"Back\"",
    ).toBe("Back to Materials");

    await act(async () => apiRef.current.nav.goMainTab("feed"));
    expect(
      labelOf(),
      "the stack top is now {mainTab: library}. A name that did not move is a static string dressed " +
        "up as a promise.",
    ).toBe("Back to Library");
  });

  it("names every top-level surface by the label its own tab carries", async () => {
    // page.js:2834-2840's tab list, verbatim. A label invented here would read
    // as a different place than the tab the user actually clicked. The
    // manualApplying row carries its section too, per AC-B1c — page.js owns
    // `activeSection`, so it is restorable and may be promised.
    const cases = [
      ["applying", "Back to Materials"],
      ["manualApplying", "Back to Manual Applying › Posting URL"],
      ["feed", "Back to Auto Applying"],
      ["interviewing", "Back to Tracking"],
      ["copilot", "Back to Interview Copilot"],
      ["library", "Back to Library"],
      ["experience", "Back to Professional Experience"],
    ];
    for (const [value, expected] of cases) {
      const apiRef = await remount();
      if (value !== "applying") {
        await act(async () => apiRef.current.nav.goMainTab(value));
      }
      // One more hop, so the stack TOP is the surface under test.
      await act(async () => apiRef.current.nav.goMainTab(value === "feed" ? "library" : "feed"));
      expect(labelOf(), `stack top = ${value}`).toBe(expected);
    }
  });
});

describe("AC-8b — the Home mode never claims the user was somewhere they were not", () => {
  it("reads \"Go to Materials\", and does not start with \"Back to\"", async () => {
    const apiRef = await mount();
    // Home mode: empty stack, on "/", away from the default surface. Reached
    // here through the RAW setter, which is what page.js:303's localStorage
    // rehydration does — a restore, not a navigation, so no entry.
    await act(async () => apiRef.current.setMainTab("library"));

    const name = labelOf();
    expect(
      name,
      "r1 called this mode \"Up\" and labelled it \"Up to {parent}\". There is no hierarchy among the " +
        "seven mainTab values — they are siblings — so \"up\" was a claim the app cannot support.",
    ).toBe("Go to Materials");
    expect(
      name.startsWith("Back to"),
      "with an empty stack the user has no recorded previous surface, so \"Back to\" would be a lie",
    ).toBe(false);
  });
});

describe("AC-B1c — the label promises exactly what the descriptor can restore", () => {
  it("a Library entry names Library and no sub-tab", async () => {
    const apiRef = await mount();
    await act(async () => apiRef.current.nav.goMainTab("library"));
    await act(async () => apiRef.current.nav.goMainTab("applying"));

    const name = labelOf();
    expect(name).toBe("Back to Library");
    expect(
      name.includes("›"),
      "`libraryTab` lives in LibraryEditor.js:28, inside a component page.js unmounts on every tab " +
        "change (r2 §4), so naming a library sub-tab would promise what the back press cannot deliver",
    ).toBe(false);
  });

  it("a Manual Applying entry DOES name its section, because page.js owns it", async () => {
    const apiRef = await mount();
    await act(async () => {
      apiRef.current.nav.goMainTab("manualApplying");
      apiRef.current.nav.goSection("manual");
    });
    await act(async () => apiRef.current.nav.goMainTab("feed"));

    expect(
      labelOf(),
      "`activeSection` is page.js:154's own state, so it IS restorable and therefore MAY be promised. " +
        "That is the proof r2 §4's line is drawn on a real property and not on convenience.",
    ).toBe("Back to Manual Applying › Job Description");
  });

  it("names the other two sections by their own tab labels", async () => {
    // page.js:2891-2893.
    const sections = [
      ["url", "Posting URL"],
      ["screenshots", "Screenshots"],
    ];
    for (const [value, label] of sections) {
      const apiRef = await remount();
      await act(async () => {
        apiRef.current.nav.goMainTab("manualApplying");
        apiRef.current.nav.goSection(value);
      });
      await act(async () => apiRef.current.nav.goMainTab("feed"));
      expect(labelOf()).toBe(`Back to Manual Applying › ${label}`);
    }
  });
});

// ==========================================================================
// AC-6 — the Absent case and its spacer
// ==========================================================================

describe("AC-6 — at the home surface the control is absent and a spacer holds its place", () => {
  it("renders no control at {applying, url} with an empty stack", async () => {
    await mount();
    expect(
      control(),
      "r2 §6.3: hiding beats disabling. A disabled MUI IconButton carries `disabled` and drops out of " +
        "the tab order, contradicting AC-15, and a permanently dead control at the home surface is noise.",
    ).toBeNull();
    expect(
      spacer(),
      "AppHeader is `display: flex` with `gap: 10px` and the brand carries `marginRight: auto` " +
        "(AppHeader.js:21,23,33), so adding and removing a leading child shifts the title horizontally " +
        "on every navigation. The spacer is mandatory, not decorative.",
    ).toBeTruthy();
  });

  it("the spacer declares the same box the control does, at xs and at sm", async () => {
    // Measured across two mounts because the two never coexist: absent-mode
    // renders the spacer, every other mode renders the control.
    await mount();
    const spacerBox = { xs: boxAt(spacer(), 375), sm: boxAt(spacer(), 1000) };

    const apiRef = await remount();
    await act(async () => apiRef.current.setMainTab("library")); // Home mode
    const node = requireControl("the Home mode must render a control to measure against");
    const controlBox = { xs: boxAt(node, 375), sm: boxAt(node, 1000) };

    expect(
      isDefiniteLength(controlBox.sm.width),
      `the control's declared width read back as ${JSON.stringify(controlBox.sm.width)}. jsdom has no ` +
        `layout, so an indefinite width cannot be compared against the spacer's at all — the ` +
        `comparison would be "auto" vs "auto" and would hold whether or not the spacer matches. The ` +
        `control therefore owes a declared width. A failed instrument is INVALID, never a pass.`,
    ).toBe(true);

    expect(spacerBox.sm.width, "spacer width differs from the control's at sm").toBe(controlBox.sm.width);
    expect(spacerBox.xs.width, "spacer width differs from the control's at xs").toBe(controlBox.xs.width);
    expect(spacerBox.xs.minWidth, "spacer min-width differs from the control's at xs").toBe(controlBox.xs.minWidth);
    expect(spacerBox.sm.minWidth, "spacer min-width differs from the control's at sm").toBe(controlBox.sm.minWidth);
  });

  it("the spacer is inert: no accessible name, no role, no tab stop, no text", async () => {
    await mount();
    const node = spacer();
    expect(node.getAttribute("aria-label"), "a named spacer is a second control to a screen reader").toBeNull();
    expect(node.getAttribute("role")).toBeNull();
    expect(node.hasAttribute("tabindex")).toBe(false);
    expect((node.textContent || "").trim()).toBe("");
  });
});

// ==========================================================================
// AC-7 — the /copilot and /library dead end (r2 §2.1, §9.4)
// ==========================================================================

describe("AC-7 — on a sub-route the control is a literal href=\"/\" anchor", () => {
  for (const pathname of ["/copilot", "/library"]) {
    it(`exits to the app from ${pathname}`, async () => {
      route.pathname = pathname;
      await mount({ host: false });

      const node = requireControl(
        `${pathname} renders a bare component and no NavTabs (page.js's tab strip does not exist ` +
          `there), so before this feature no in-app control returned to "/". That is a live dead end.`,
      );
      expect(node.tagName, "an exit that leaves the document must be a real anchor").toBe("A");
      expect(
        node.getAttribute("href"),
        "hrefSafety.sweep.test.js:220-224 classifies a hard-coded literal href separately and requires " +
          "only that it start with \"/\". Anything computed fails :194 against a frozen two-file allow-list.",
      ).toBe("/");
      expect(labelOf()).toBe("Back to Resume Tailor");
    });
  }

  it("the Back and Home modes carry no href at all", async () => {
    // §9.4's other half: the two in-app modes must be <button> + onClick, so
    // there is no computed href for the sweep to catch — and no full-document
    // navigation destroying an in-flight batch tailor or a live interview.
    const apiRef = await mount();
    await act(async () => apiRef.current.setMainTab("library")); // Home
    let node = requireControl("Home mode");
    expect(node.tagName).toBe("BUTTON");
    expect(node.hasAttribute("href")).toBe(false);

    await act(async () => apiRef.current.nav.goMainTab("feed")); // Back
    node = requireControl("Back mode");
    expect(node.tagName).toBe("BUTTON");
    expect(node.hasAttribute("href")).toBe(false);
  });
});

// ==========================================================================
// AC-16 — the accessible name survives the tooltip
// ==========================================================================

describe("AC-16 — the name comes from aria-label on the control itself", () => {
  it("is a non-empty aria-label, not a labelledby, and not the icon's text", async () => {
    const apiRef = await mount();
    await act(async () => apiRef.current.nav.goMainTab("library"));
    const node = requireControl("Back mode");

    expect(
      node.getAttribute("aria-label"),
      "SettingsMenu.js:80-89 in this same header is the pattern: an explicit aria-label BESIDE the " +
        "tooltip, never instead of it.",
    ).toBe("Back to Materials");
    expect(
      node.getAttribute("aria-labelledby"),
      "an aria-labelledby would let a tooltip element own the name, which is the trap this criterion exists for",
    ).toBeNull();
    expect(
      (node.textContent || "").trim(),
      "an icon-only control has no text to fall back on, which is what makes the aria-label load-bearing",
    ).toBe("");
  });
});

// ==========================================================================
// AC-13 — the keyboard focus ring (declared CSS, four longhands)
// ==========================================================================

describe("AC-13 — the control inherits the app's focus ring", () => {
  it("paints the four outline longhands when .Mui-focusVisible is set", async () => {
    // `app/theme/index.js:94-105` gives every `MuiButtonBase` root the ring as
    // FOUR LONGHANDS, because jsdom does not implement the `outline` shorthand
    // and reads it back as "none" (that file's comment at :88-90 records why).
    // So this measures the longhands — and it measures them on a control that
    // is a real ButtonBase, because a hand-rolled `<button>` inherits the rule
    // from nothing and would ship with no keyboard focus indicator at all.
    const apiRef = await mount();
    await act(async () => apiRef.current.nav.goMainTab("library"));
    const node = requireControl("Back mode");

    expect(
      node.classList.contains("MuiButtonBase-root"),
      "the control must be a MUI ButtonBase (IconButton). MUI's ButtonBase resets `outline: 0` on " +
        "everything it renders and the theme's `.Mui-focusVisible` rule is what puts a ring back.",
    ).toBe(true);

    const resting = window.getComputedStyle(node).outlineStyle;
    node.classList.add(FOCUS_VISIBLE_CLASS);
    const style = window.getComputedStyle(node);

    expect(resting, "a control that is not focus-visible must paint no ring").toBe("none");
    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineWidth).toBe("2px");
    expect(style.outlineOffset).toBe("2px");
    expect(style.outlineColor, "jsdom handed back an unresolved var()").not.toMatch(/var\(/);
    expect(
      rgbOf(style.outlineColor),
      "the ring must be the app's --accent, which is what themeSystem.test.js's no-new-token sweep " +
        "and focusVisible.test.js's contrast maths both assume",
    ).toBe(rgbOf(tokens.light.accent));
  });
});

// ==========================================================================
// AC-14 / AC-17 — the 44px touch floor and the no-shrink rule
// ==========================================================================

describe("AC-14 — the control clears the 44px touch floor on phones", () => {
  it("min-width and min-height are >= 44px at xs and `auto` at sm", async () => {
    const apiRef = await mount();
    await act(async () => apiRef.current.nav.goMainTab("library"));
    const node = requireControl("Back mode");

    const xs = boxAt(node, 375);
    const sm = boxAt(node, 1000);

    expect(pxOf(xs.minWidth), `min-width at 375px was ${xs.minWidth}`).toBeGreaterThanOrEqual(MOBILE_TAP_MIN);
    expect(pxOf(xs.minHeight), `min-height at 375px was ${xs.minHeight}`).toBeGreaterThanOrEqual(MOBILE_TAP_MIN);
    expect(
      sm.minWidth,
      "the `sm` branch must be min-width's OWN initial value, `auto` — never a plausible-looking 0. " +
        "app/theme/mobileSx.js's header records the regression that rule exists for (SpeakerChip's " +
        "`minWidth: { xs: 44, sm: 0 }` removed a flex item's shrink floor).",
    ).toBe("auto");
    expect(sm.minHeight).toBe("auto");
  });
});

describe("AC-17 — the control refuses to shrink", () => {
  it("declares flex-shrink: 0 at both widths", async () => {
    // AppHeader.js:28 sets `flexWrap: "wrap"`. Without this the control is the
    // first thing a narrow phone compresses, and a compressed 44px target is
    // no longer a 44px target.
    const apiRef = await mount();
    await act(async () => apiRef.current.nav.goMainTab("library"));
    const node = requireControl("Back mode");
    expect(boxAt(node, 375).flexShrink).toBe("0");
    expect(boxAt(node, 1000).flexShrink).toBe("0");
  });

  it("the spacer refuses to shrink too, or it cannot hold the place", async () => {
    await mount();
    expect(boxAt(spacer(), 375).flexShrink).toBe("0");
  });
});
