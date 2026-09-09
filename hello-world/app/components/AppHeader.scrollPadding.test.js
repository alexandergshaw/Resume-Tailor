// @vitest-environment jsdom
//
// WCAG 2.4.11 Focus Not Obscured (Minimum) — the app-wide half.
//
// The app header is `position: sticky; top: 0; zIndex: 1100`
// (app/components/AppHeader.js). Anchoring to a fragment therefore scrolls the
// target's top edge to the top of the VIEWPORT, which is UNDER the header —
// unless the root scrollport carries a `scroll-padding-top` at least as tall as
// the header. Before this file, exactly one route had one: `/copilot`, and only
// while `app/copilot/useStickyTop.js` had a sticky strip mounted to write it.
// On `/`, `/library` and `/login` the skip link shipped in 7e3d48c landed
// `#main-content` beneath the header.
//
// ---------------------------------------------------------------------------
// WHAT IS ASSERTED HERE, AND WHAT IS A BROWSER CHECK
// ---------------------------------------------------------------------------
//
// ASSERTED (jsdom, runtime):
//   1. AppHeader PUBLISHES `--app-header-height` on the document root, and its
//      value is the header element's OWN measured rect — proved by stubbing
//      that rect to a distinctive height and reading the number back out. This
//      is the "not a literal" claim: change the header's height and the
//      published value changes with it.
//   2. It re-measures on `window.resize` (the header's `flexWrap: "wrap"` makes
//      its height genuinely width-dependent).
//   3. It removes the property on unmount, so nothing inherits a stale pad.
//   4. On an auth route — where AppHeader returns `null` and there IS no header
//      — it publishes nothing rather than a stale or invented number.
//
// ASSERTED (source/CSS text, the weaker instrument, labelled as such):
//   5. `globals.css` declares `scroll-padding-top` on the ROOT scroller (`html`
//      — globals.css's own `overflow-x` comment records that `<body>` is
//      deliberately not a scroll container) and sources it from that property.
//   6. `layout.js` mounts AppHeader, which is what puts the writer on every
//      route: it is the ROOT layout, so all four routes get it from one mount.
//
// ASSERTED (jsdom, runtime — the copilot non-regression):
//   7. AppHeader writes NEITHER `--sticky-pad`/`--sticky-top` NOR the inline
//      `scrollPaddingTop` that `useStickyTop.js` owns, and with both mounted
//      together all four values coexist at their own correct values.
//
// BROWSER CHECK, not asserted anywhere below:
//   * That the published number equals the header's REAL rendered height at a
//     given viewport width. jsdom has no layout — `getBoundingClientRect()`
//     returns zeros — so every height in this file is injected, never measured.
//     jsdom's CSS parser also REJECTS `padding: 10px clamp(12px, 4vw, 24px)`
//     (AppHeader.js's literal declaration) and reads `paddingTop` back as
//     `"0"`; that is a FAILED INSTRUMENT, not a measurement, so nothing here
//     derives a height from `getComputedStyle`.
//   * That `scroll-padding-top` actually moves the fragment-scroll landing
//     position. jsdom implements no scrolling at all.
//   * That the copilot's INLINE `scrollPaddingTop` still beats the `html` rule
//     in globals.css. That is a cascade fact (an inline style declaration
//     outranks an author stylesheet rule) and jsdom applies no Next-processed
//     stylesheet, so case 7 asserts the falsifiable half instead: that
//     AppHeader never writes that inline property in the first place.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { readFileSync } from "node:fs";
import path from "node:path";

import AppHeader from "./AppHeader.js";
import { SurfaceNavProvider } from "../hooks/useSurfaceNav.js";
import { makeTheme } from "../theme/index.js";
import { useStickyTop } from "../copilot/useStickyTop.js";

// Mutable so the auth-route case can flip it. `vi.hoisted` because the
// `vi.mock` factory is hoisted above the imports and would otherwise read a
// `let` still in its temporal dead zone.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP_DIR = path.join(process.cwd(), "app");
const read = (rel) => readFileSync(path.join(APP_DIR, rel), "utf8");

// The contract name. One string, spelled once, shared by the writer
// (AppHeader.js) and the consumer (globals.css) — a mismatch between the two
// is exactly the silent failure this file exists to catch.
const HEIGHT_PROP = "--app-header-height";

// Same idiom as app/theme/themeSystem.test.js and app/appLandmarks.test.js: a
// source-text claim is defeated by PROSE, and both files this one reads have
// long explanatory comments that name the very tokens being searched for.
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const rootStyle = () => document.documentElement.style;
const published = () => rootStyle().getPropertyValue(HEIGHT_PROP);

// --------------------------------------------------------------- the instrument

// jsdom has no layout, so the ONLY way to prove the published value came off
// the header rather than out of a constant is to inject a distinctive rect and
// read the same number back. Keyed on the element being the app header so
// every other element in the tree keeps jsdom's real (zeroed) rect — the same
// shape app/copilot/dashboard/StickyQuestionStrip.test.js already uses.
const REAL_RECT = Element.prototype.getBoundingClientRect;
let stubbedHeaderHeight = 0;

function rectFor(height) {
  return { height, width: 0, top: 0, bottom: height, left: 0, right: 0, x: 0, y: 0 };
}

let container;
let root;

beforeEach(() => {
  nav.pathname = "/";
  stubbedHeaderHeight = 0;
  Element.prototype.getBoundingClientRect = function patchedRect() {
    if (this.nodeType === 1 && this.hasAttribute("data-app-header")) {
      return rectFor(stubbedHeaderHeight);
    }
    return REAL_RECT.call(this);
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  Element.prototype.getBoundingClientRect = REAL_RECT;
  rootStyle().removeProperty(HEIGHT_PROP);
  rootStyle().removeProperty("--sticky-top");
  rootStyle().removeProperty("--sticky-pad");
  rootStyle().scrollPaddingTop = "";
});

async function mountHeader(extraChild) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(SurfaceNavProvider, null, createElement(AppHeader), extraChild ?? null),
      ),
    );
  });
}

const headerEl = () => container.querySelector("[data-app-header]");

// ============================================================ 1-4: the writer

describe("AppHeader publishes its own measured height as a custom property", () => {
  it("[instrument] this environment still has no layout and no ResizeObserver", () => {
    expect(document.createElement("div").getBoundingClientRect().height).toBe(0);
    expect(typeof ResizeObserver).toBe("undefined");
  });

  it("publishes the header's OWN rect height, not a constant", async () => {
    // 137 is deliberately not any real header height (61 today, 65 after the
    // back button): a value that matched a plausible literal could not tell a
    // measurement apart from a hard-coded guess.
    stubbedHeaderHeight = 137;
    await mountHeader();

    const header = headerEl();
    expect(
      header,
      "[instrument] AppHeader rendered no [data-app-header] element — nothing below measures anything",
    ).toBeTruthy();
    expect(
      header.getBoundingClientRect().height,
      "[instrument] the rect stub did not take effect, so a matching published value would prove nothing. " +
        "A failed instrument is INVALID, never its zero value.",
    ).toBe(137);

    expect(
      published(),
      `AppHeader must publish ${HEIGHT_PROP} from its own getBoundingClientRect(). This is the ` +
        "provenance claim: the header's height is not a closed-form function of anything available in " +
        "CSS (padding: 10px clamp(12px, 4vw, 24px) scales only horizontally, and flexWrap: wrap lets the " +
        "row break), so the value has to come off the rendered element.",
    ).toBe("137px");
  });

  it("re-measures when the viewport resizes, because flexWrap makes the height width-dependent", async () => {
    stubbedHeaderHeight = 137;
    await mountHeader();
    expect(published(), "[instrument] the first measurement never landed").toBe("137px");

    // A wrapped header is ~54px taller (AppHeader.backButton.test.js's MC-1).
    stubbedHeaderHeight = 191;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(
      published(),
      "a header that wraps to a second row at ~320px must republish, or the scroll-padding under-pads by " +
        "a whole row exactly where the header is tallest",
    ).toBe("191px");
  });

  it("removes the property on unmount, leaving no stale pad behind", async () => {
    stubbedHeaderHeight = 137;
    await mountHeader();
    expect(published(), "[instrument] nothing was published, so removal proves nothing").toBe("137px");

    await act(async () => {
      root.unmount();
    });
    expect(
      published(),
      `${HEIGHT_PROP} must be removed on unmount so the fallback (0px) takes over, exactly as ` +
        "app/copilot/useStickyTop.js removes its own two properties",
    ).toBe("");
  });

  it("withdraws the property when navigation reaches an auth route and the header disappears", async () => {
    // Deliberately NOT "mount on /login and observe nothing": that case passes
    // on a build with no writer at all. The falsifiable claim is that a writer
    // which HAS published then withdraws when its header stops rendering.
    stubbedHeaderHeight = 137;
    await mountHeader();
    expect(published(), "[instrument] nothing was published on /, so withdrawal proves nothing").toBe(
      "137px",
    );

    nav.pathname = "/login";
    await mountHeader();

    expect(
      headerEl(),
      "[instrument] AppHeader must return null on /login for this case to mean anything",
    ).toBeNull();
    expect(
      published(),
      "with no header on the page there is nothing to be occluded by; a stale number here would pad the " +
        "login surface against a header that does not exist",
    ).toBe("");
  });
});

// ================================================= 5-6: the consumer and the wiring

describe("the declaration that consumes it", () => {
  // SOURCE-READ, and the weaker of this file's two instruments: it proves the
  // CSS is declared, not that a browser scrolls to the padded position.
  function ruleContaining(css, property) {
    for (const [, selector, block] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (block.includes(property)) return { selector: selector.trim(), block };
    }
    return null;
  }

  it("globals.css pads the ROOT scrollport, sourced from the published property", () => {
    const css = stripComments(read("globals.css"));
    const rule = ruleContaining(css, "scroll-padding-top");
    expect(
      rule,
      "globals.css declares no scroll-padding-top at all, so on /, /library and /login a fragment " +
        "target still lands under the sticky header (WCAG 2.4.11)",
    ).toBeTruthy();
    expect(
      rule.selector,
      "the padding must sit on `html`. globals.css's own overflow-x comment records that <body> is " +
        "deliberately NOT a scroll container, so <html> is the scrollport a fragment navigation moves.",
    ).toBe("html");
    expect(
      rule.block,
      `the value must be traceable to the header via ${HEIGHT_PROP} — a literal here would be wrong at ` +
        "every width the header wraps at",
    ).toContain(`var(${HEIGHT_PROP}`);
  });

  it("its only fallback is 0px — the identity, not a guessed header height", () => {
    const css = stripComments(read("globals.css"));
    const fallback = new RegExp(`var\\(\\s*${HEIGHT_PROP}\\s*,\\s*([^)]*)\\)`).exec(css);
    expect(fallback, `no var(${HEIGHT_PROP}, …) reference in globals.css`).toBeTruthy();
    expect(
      fallback[1].trim(),
      "the pre-measurement fallback must be 0px: that is today's behaviour exactly, so the SSR/first-paint " +
        "window can only under-pad (the status quo), never over-pad against a header height nobody measured",
    ).toBe("0px");
  });
});

describe("the wiring reaches every route", () => {
  it("the writer lives in the component the ROOT layout mounts, so one mount serves all four routes", () => {
    // Two halves. The layout half is a PRECONDITION that already held at HEAD
    // and is labelled `[instrument]` rather than dressed up as a new claim; the
    // AppHeader half is what actually fails without this change. Together they
    // are the "every route" argument: the root layout renders <AppHeader /> for
    // /, /copilot, /library and /login alike, and AppHeader is where the
    // publisher lives — so there is no route-by-route wiring to forget.
    const layout = stripComments(read("layout.js"));
    expect(layout, "[instrument] layout.js does not render <AppHeader />").toMatch(/<AppHeader\s*\/>/);
    expect(layout, "[instrument] layout.js is not the document-level layout").toMatch(/<body\b/);

    const header = stripComments(read("components/AppHeader.js"));
    expect(
      header,
      `AppHeader.js must be the publisher of ${HEIGHT_PROP}. Putting the measurement anywhere else — a ` +
        "per-route hook, page.js — is what left three of four routes unpadded in the first place.",
    ).toContain(HEIGHT_PROP);
    expect(
      header,
      "and it must MEASURE, not assert. A published literal would be wrong at every width the header wraps at.",
    ).toContain("getBoundingClientRect");
  });
});

// ========================================== 7: the copilot's writer is untouched

describe("the copilot's sticky writer keeps sole ownership of its own properties", () => {
  function Probe() {
    const { stripRef } = useStickyTop();
    return createElement("div", { ref: stripRef, "data-testid": "strip" });
  }

  it("AppHeader alone writes neither --sticky-pad, --sticky-top nor the inline scroll-padding", async () => {
    stubbedHeaderHeight = 137;
    await mountHeader();
    expect(published(), "[instrument] AppHeader published nothing, so the checks below are vacuous").toBe(
      "137px",
    );

    expect(
      rootStyle().getPropertyValue("--sticky-top"),
      "AppHeader must not redefine a property app/copilot/useStickyTop.js owns",
    ).toBe("");
    expect(
      rootStyle().getPropertyValue("--sticky-pad"),
      "--sticky-pad means header + STRIP height. AppHeader's header-only value is strictly smaller, so a " +
        "second writer on that name would under-pad /copilot exactly where the strip occludes.",
    ).toBe("");
    expect(
      rootStyle().scrollPaddingTop,
      "AppHeader must express the padding in CSS, not as an inline style on the same element " +
        "useStickyTop.js writes — two inline writers on one property is a last-one-wins race",
    ).toBe("");
  });

  // MEASURED under mutation, and recorded because it bounds what this case can
// prove: giving AppHeader a second write to `--sticky-pad` and to the inline
  // `scrollPaddingTop` leaves this case GREEN, because AppHeader's layout effect
  // happens to run before the strip's and its values are simply overwritten.
  // That is the race, not an absence of one — which is exactly why the
  // ownership case above is the deterministic guard and this one is the
  // coexistence check it cannot replace.
  it("mounted together, all four values coexist at their own correct values", async () => {
    stubbedHeaderHeight = 137;
    await mountHeader(createElement(Probe));

    expect(
      container.querySelector('[data-testid="strip"]'),
      "[instrument] the sticky-strip probe never mounted",
    ).toBeTruthy();

    // useStickyTop's own contract, unchanged: header height on --sticky-top,
    // header + strip on --sticky-pad (the strip's rect is a real jsdom rect,
    // so its height is 0 here), and the inline scroll-padding pointing at it.
    expect(rootStyle().getPropertyValue("--sticky-top")).toBe("137px");
    expect(rootStyle().getPropertyValue("--sticky-pad")).toBe("137px");
    expect(
      rootStyle().scrollPaddingTop,
      "the copilot's inline scroll-padding must survive AppHeader mounting beside it",
    ).toBe("var(--sticky-pad, 0px)");

    expect(
      published(),
      "and the app-wide property is published alongside it, from the same header, without either " +
        "writer clobbering the other",
    ).toBe("137px");
  });
});
