// @vitest-environment jsdom
//
// AC-T6..T8: THE RESEARCH PANEL'S TOUCH TARGETS AND ITS CITATION MARKER.
//
// `DigestPanel` renders inside `AppViewDialog`, which is `fullScreen` on
// mobile, so this panel IS the phone's research surface -- not a desktop
// affordance that happens to be reachable. Two defects:
//
//   AC-T6  every control in the panel's action row is `size="small"` with no
//          height override (~30.75px), including the destructive "Replace
//          research" sitting one 8px gap from "Keep what I have". This file
//          imports nothing from the shared touch contract today.
//   AC-T7  the citation marker is an inline anchor with `lineHeight: 0`,
//          `fontSize: 0.75em` of a 14px panel and `padding: 0.5em 0.15em`.
//          `min-width`/`min-height` do not apply to a non-replaced INLINE box
//          at all, so its hit area is whatever the line box happens to give
//          it -- roughly 10x21px, and genuinely underivable from the source
//          because `line-height: 0` makes the content box height indeterminate.
//   AC-T8  `ITEM_SX` grants no `overflowWrap`, so a long unbroken source title
//          on the REFUSED-URL branch (which is not inside the `a:not(...)`
//          rule `PANEL_SX` carries) is clipped by `html { overflow-x: hidden }`.
//
// THE 24px DECISION, STATED RATHER THAN SPLIT. This repo's bar is 44px
// (`MOBILE_TAP_MIN`), and every other control in these criteria is held to it.
// The citation marker is the one place that number is refused, deliberately: it
// is a superscript footnote number INSIDE flowing prose, and a 44px inline box
// would either blow the line height of every paragraph containing one or
// overlap the lines above and below (the same hazard `TOUCH_PILL_SX`'s own
// comment documents -- an overlay that extends past its line steals taps from
// whatever sits there). WCAG 2.5.8 AA's 24x24 minimum is the number this
// criterion asks for, and the marker is additionally covered by the standard's
// "inline" exception. 24 is asserted here as a floor, not a target: an
// implementation that reaches further without breaking the paragraph is
// welcome to.
//
// MANUAL / BROWSER-ONLY -- not simulated by anything below:
//   MC-T5  `a[data-citation-marker]` in an open digest dialog at 375x812:
//          `getBoundingClientRect()` `{width, height}`, both >= 24. This is
//          the single most valuable measurement in the tracking audit,
//          because `line-height: 0` means NO arithmetic over the source
//          predicts it. This file asserts the declared properties that make a
//          box exist at all; only a browser reports the box.
//   MC-T6  that raising the marker's box does not change the prose's line
//          spacing or make two markers on adjacent lines overlap.
//   MC-T7  rendered heights of the action-row buttons at 375px.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import DigestPanel from "./DigestPanel.js";
import { markdownStamp } from "../../../lib/tracking/renderCitedMarkdown.js";
import { makeTheme } from "../../theme/index.js";
import { atWidth } from "../../theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "../../theme/mobileSx.js";

const WCAG_MIN = 24;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});

// ------------------------------------------------------------------ fixtures

const REUTERS = "https://www.reuters.com/business/nimbus-series-c";
const TECHCRUNCH = "https://techcrunch.com/nimbus-depots";
const MD = "Nimbus raised a Series C. It runs depots in twelve cities.";

function outcomeFor(markdown, { placed = 0, annotations = placed } = {}) {
  const stamp = markdownStamp(markdown);
  return {
    version: 1,
    surface: "interactions",
    searched: true,
    truncated: false,
    residueClean: true,
    counts: {
      annotations,
      urlsUsable: annotations,
      spansUsable: placed,
      splicesSafe: placed,
      placed,
    },
    refused: { count: 0, reasons: {}, spanReasons: {} },
    len: stamp.len,
    hash: stamp.hash,
    previous: null,
  };
}

const CITED = {
  application_id: "app-1",
  status: "ready",
  markdown: MD,
  updated_at: "2026-09-05T12:00:00.000Z",
  researched_at: "2026-09-05T12:00:00.000Z",
  sources: [
    { url: REUTERS, title: "Nimbus raises Series C", start: 0, end: 25 },
    { url: TECHCRUNCH, title: "Nimbus depot network", start: 26, end: 58 },
  ],
  citation_outcome: outcomeFor(MD, { placed: 2 }),
};

// A source whose url is REFUSED by safeExternalHref, so `SourceItem` takes its
// non-anchor branch -- the one `PANEL_SX`'s `a:not([data-citation-marker])`
// rule cannot reach. Its title is a single unbroken token.
const LONG_TITLE = "Nordwestdeutscheunternehmensberatungsgesellschaftsbericht";
const REFUSED = {
  application_id: "app-2",
  status: "ready",
  markdown: MD,
  updated_at: "2026-09-05T12:00:00.000Z",
  researched_at: "2026-09-05T12:00:00.000Z",
  sources: [{ url: "javascript:alert(1)", title: LONG_TITLE }],
  citation_outcome: outcomeFor(MD, { placed: 0, annotations: 1 }),
};

async function render(digest, props = {}) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(DigestPanel, {
          digest,
          nowTs: Date.parse("2026-09-05T13:00:00.000Z"),
          ...props,
        })
      )
    );
  });
}

// -------------------------------------------------------------- measurement

const pxOf = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const name = (node) => (node.textContent || "").replace(/\s+/g, " ").trim();

/** Every control in the panel's action row (the row that owns the buttons). */
const actionButtons = () => Array.from(container.querySelectorAll("button"));

function floorAt(node, width) {
  return atWidth(width, () => pxOf(window.getComputedStyle(node).minHeight));
}

function undersized(nodes, width, min) {
  return nodes
    .filter((node) => floorAt(node, width) < min)
    .map((node) => `${name(node)} ${floorAt(node, width)}px`);
}

// ============================================================================

describe("AC-T6 -- the research panel's action row meets the 44px touch floor at 375px", () => {
  it("[control] the resting row renders both of its controls", async () => {
    await render(CITED);
    expect(actionButtons().map(name)).toEqual(["Research again", "Download research log"]);
  });

  it("resting state: 'Research again' and 'Download research log'", async () => {
    await render(CITED);
    expect(undersized(actionButtons(), 375, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("confirming state: the destructive 'Replace research' and its 'Keep what I have' pair", async () => {
    // The most consequential pair on the surface: one of these overwrites the
    // only copy of the research with no way back. Both are ~30.75px today,
    // side by side.
    await render(CITED);
    const again = actionButtons().find((node) => name(node) === "Research again");
    expect(again).toBeTruthy();
    await act(async () => {
      again.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const labels = actionButtons().map(name);
    expect(labels).toContain("Keep what I have");
    expect(labels).toContain("Replace research");
    expect(undersized(actionButtons(), 375, MOBILE_TAP_MIN)).toEqual([]);
  });

  it("researching state: the in-flight control", async () => {
    await render(CITED, { researching: true });
    expect(actionButtons().map(name).join(" ")).toMatch(/Researching/);
    expect(undersized(actionButtons(), 375, MOBILE_TAP_MIN)).toEqual([]);
  });
});

describe("AC-T7 -- the citation marker is a tappable box, not a bare inline run", () => {
  it("[control] markers render for a fully cited digest", async () => {
    await render(CITED);
    expect(container.querySelectorAll("a[data-citation-marker]").length).toBe(2);
  });

  it("the marker takes a box that min-width/min-height can actually size", async () => {
    // `min-width`/`min-height` are ignored on a non-replaced INLINE box (CSS
    // Sizing 3), so declaring them on the marker as it stands would look like
    // a fix and change nothing. This is the assertion that catches that.
    await render(CITED);
    const marker = container.querySelector("a[data-citation-marker]");
    const display = atWidth(375, () => window.getComputedStyle(marker).display);
    expect(display, "min-width/min-height are ignored on an inline box").not.toBe("inline");
  });

  it("the marker declares at least WCAG 2.5.8 AA's 24x24 at 375px", async () => {
    // 24, not 44, and the header says why in full.
    await render(CITED);
    const marker = container.querySelector("a[data-citation-marker]");
    const box = atWidth(375, () => {
      const style = window.getComputedStyle(marker);
      return { width: pxOf(style.minWidth), height: pxOf(style.minHeight) };
    });
    expect(box.width).toBeGreaterThanOrEqual(WCAG_MIN);
    expect(box.height).toBeGreaterThanOrEqual(WCAG_MIN);
  });
});

describe("AC-T8 -- a long unbroken source title breaks instead of being clipped", () => {
  it("the refused-URL source item wraps inside its own box", async () => {
    // `PANEL_SX` grants `overflowWrap: anywhere` only to
    // `a:not([data-citation-marker])`. A source whose url was refused renders
    // NO anchor at all -- by design -- so it inherits nothing, and
    // `html { overflow-x: hidden }` deletes the overflow rather than
    // scrolling it.
    await render(REFUSED);
    const item = Array.from(container.querySelectorAll("li")).find((node) =>
      (node.textContent || "").includes(LONG_TITLE)
    );
    expect(item, "the refused source did not render as a list item").toBeTruthy();
    expect(item.querySelector("a"), "the refused url must render no anchor").toBeNull();
    expect(atWidth(375, () => window.getComputedStyle(item).overflowWrap)).toBe("anywhere");
  });
});

describe("GUARDS (all pass before the fix)", () => {
  it("the marker's text is still the bare number -- the brackets stay generated content", async () => {
    // The residue assertions and the renderer's numbering both depend on
    // `textContent` being exactly the digits. A fix that reaches for real
    // bracket characters to pad the box out would break both.
    await render(CITED);
    const markers = Array.from(container.querySelectorAll("a[data-citation-marker]"));
    expect(markers.map((node) => node.textContent)).toEqual(["1", "2"]);
    expect(markers.map((node) => node.getAttribute("data-citation-marker"))).toEqual(["1", "2"]);
  });

  it("the marker still opens its own source in a new tab", async () => {
    await render(CITED);
    const marker = container.querySelector("a[data-citation-marker]");
    expect(marker.getAttribute("href")).toBe(REUTERS);
    expect(marker.getAttribute("target")).toBe("_blank");
    expect(marker.getAttribute("rel")).toBe("noopener noreferrer");
    expect(marker.getAttribute("aria-label")).toMatch(/^Source 1: /);
  });

  it("non-marker anchors keep the wrapping PANEL_SX already gave them", async () => {
    await render(CITED);
    const link = Array.from(container.querySelectorAll("a")).find(
      (node) => !node.hasAttribute("data-citation-marker")
    );
    expect(link).toBeTruthy();
    expect(atWidth(375, () => window.getComputedStyle(link).overflowWrap)).toBe("anywhere");
  });

  it("the action row's controls gain no phone-only floor at 1000px", async () => {
    await render(CITED);
    const grown = actionButtons()
      .filter((node) => floorAt(node, 1000) >= MOBILE_TAP_MIN)
      .map((node) => `${name(node)} ${floorAt(node, 1000)}px`);
    expect(grown).toEqual([]);
  });

  it("'Research again' still reaches its callback through the confirmation", async () => {
    const calls = [];
    await render(CITED, { onResearchAgain: (id) => calls.push(id) });
    const again = actionButtons().find((node) => name(node) === "Research again");
    await act(async () => {
      again.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const replace = actionButtons().find((node) => name(node) === "Replace research");
    expect(replace).toBeTruthy();
    await act(async () => {
      replace.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(calls).toEqual(["app-1"]);
  });
});
