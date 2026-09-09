// @vitest-environment jsdom
//
// MOBILE-G F-07 — the `compact` self-view's height cap has an `xs` key and no
// upper bound, so it applies at EVERY width (`xs` compiles to
// `@media (min-width:0px)`). That is the repo's recorded hazard: a breakpoint
// key of `undefined` — or simply absent — does not switch a rule off.
//
// It is inert today only because `PracticeClient.js:815-819` mounts the
// compact instance solely below `md`, a caller-side invariant enforced by a
// comment (CameraPreview.js:11-17) rather than by the style. `RoleDrillClient`
// is now a second caller passing `compact` (MOBILE-G F-06), which is exactly
// the situation the sibling branch's own `md` key was written for; a third
// caller that passes `compact` at `md`+ would silently get a 26vh desktop cap.
//
// jsdom has no layout: nothing here measures a rendered height. What it reads
// back is the SERIALIZED cascade — which breakpoint each declaration lands
// under, resolved through `atWidth` the way a browser would. The rendered
// heights were measured in a real browser and are recorded in
// roles/RoleDrillClient.mobile.test.js's header, next to the change they
// justify.

import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import CameraPreview from "./CameraPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

function mount(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(CameraPreview, props)),
    );
  });
  // hasVideo + cameraOff takes the "Camera off" branch, which renders the
  // same panelSx on a Box that is trivial to find. The video branch carries
  // the identical panelSx (CameraPreview.js:96).
  return [...container.querySelectorAll("div")].find((el) => el.textContent === "Camera off");
}

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
});

const OFF = { stream: null, hasVideo: true, cameraOff: true };

// The LAST declaration wins, so getComputedStyle reports the `dvh` half of
// each fallback pair. The `vh` half is checked separately below by reading
// the rule text, because a computed read can only ever see the winner.
const maxHeightAt = (panel, width) =>
  atWidth(width, () => window.getComputedStyle(panel).maxHeight);

// The RAW text emotion inserted for `el`'s own class, whitespace stripped.
//
// Read from the `<style>` node's textContent, NOT through CSSOM, and that
// distinction is the whole reason this helper exists. A fallback pair is two
// declarations of the SAME property in one rule; jsdom's CSSStyleDeclaration
// keeps exactly one value per property, so by the time a rule has been parsed
// into `cssRules` the `26vh` half is already gone and `rule.cssText` reports
// only `max-height: 26dvh`. Asserting the pair through CSSOM therefore fails
// against correct source — a fabricated failure, not a measurement. The style
// element's own text is the pre-parse record, and emotion runs unminified
// here, so it still carries both.
function rawCssFor(el) {
  const cssClass = [...el.classList].find((c) => c.startsWith("css-"));
  if (!cssClass) return "";
  return [...document.querySelectorAll("style")]
    .map((s) => s.textContent || "")
    .filter((text) => text.includes(cssClass))
    .join("\n")
    .replace(/\s+/g, "");
}

describe("F-07: the compact cap is bounded above, like its non-compact sibling", () => {
  it("[positive control] the NON-compact branch is already bounded — 45dvh on a phone, 62vh at md+", () => {
    // This is the shape the compact branch has to match. If this control ever
    // reds, the sibling regressed and the assertion below is measuring
    // against a moved target.
    const panel = mount(OFF);
    expect(maxHeightAt(panel, 375)).toBe("45dvh");
    expect(maxHeightAt(panel, 1000)).toBe("62vh");
  });

  it("the compact branch caps at 26dvh on a phone", () => {
    const panel = mount({ ...OFF, compact: true });
    expect(maxHeightAt(panel, 375)).toBe("26dvh");
  });

  it("the compact branch releases its cap at md+, instead of applying the phone cap to every width", () => {
    const panel = mount({ ...OFF, compact: true });
    expect(maxHeightAt(panel, 1000)).toBe("none");
  });

  it("[instrument control] the NON-compact branch's own vh/dvh pair is visible to rawCssFor", () => {
    // The sibling already ships the pair this helper has to be able to see.
    // If it cannot find THAT, its verdict on the compact branch is worthless.
    const text = rawCssFor(mount(OFF));
    expect(text, "instrument found no emotion CSS at all").not.toBe("");
    expect(text).toContain("max-height:45vh");
    expect(text).toContain("max-height:45dvh");
  });

  it("the compact cap keeps its vh/dvh fallback PAIR — both declarations, dvh last", () => {
    // Hazard 4: the two-element array must stay nested UNDER a breakpoint key
    // so MUI emits `max-height:26vh; max-height:26dvh` as stacked
    // declarations for that one breakpoint. Passed at the top level instead,
    // the array is read as one value per breakpoint and the `vh` fallback is
    // silently lost on browsers without `dvh`.
    const text = rawCssFor(mount({ ...OFF, compact: true }));
    const vh = text.indexOf("max-height:26vh");
    const dvh = text.indexOf("max-height:26dvh");
    expect(vh, "the 26vh fallback declaration is gone").toBeGreaterThan(-1);
    expect(dvh, "the 26dvh declaration is gone").toBeGreaterThan(-1);
    expect(dvh, "dvh must come after vh or it can never win").toBeGreaterThan(vh);
  });
});
