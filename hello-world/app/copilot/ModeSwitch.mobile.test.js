// @vitest-environment jsdom
//
// MOBILE-G F-03 — RE-MEASURED AND NOT REPRODUCED. This file exists to record
// that, and to pin the two properties the disproof actually rests on, so the
// finding cannot quietly come back true.
//
// THE CLAIM was that this three-way `ToggleButtonGroup` is the same
// min-content-floor construct `SessionSetup.js:239-282` stacks below `sm`,
// and that at 320px it overflows a root box whose content width is 296px
// (`p: { xs: 1.5 }` = 12px gutters, CopilotClient.js:564) — invisibly, because
// `app/globals.css` sets `html { overflow-x: hidden }`, so the "Speak as"
// button would be deleted with no scrollbar and no way to reach that mode.
// MOBILE-G ranked it MAJOR on a HAND ESTIMATE of 275-285px and said outright:
// "Measure at 320 before ranking this a BLOCKER."
//
// THE MEASUREMENT (Chrome, Manrope loaded, this component's own serialized
// emotion CSS and its own DOM, `min-width` media rules forced to match the
// emulated width so no desktop branch leaked in):
//
//     viewport  content width  group width  scrollW/clientW  clearance
//     320       296px          263.97px     264 / 264        22.03px inside
//     375       351px          263.97px     264 / 264        36.31px inside
//     430       406px          263.97px     264 / 264        91.31px inside
//
// Per-button: 109.06 / 76.61 / 80.30px, each 44.00px tall at `xs` (the
// TOUCH_TARGET_SX floor, confirmed applying). `scrollWidth === clientWidth`
// at every width: the group never overflows itself either. At 320 the group
// wraps onto its OWN line below the "Mode:" label (row height 72.02px vs
// 44.00px at 375+), which is what buys it the full 296px in the first place.
// The estimate was 11-21px high; the group fits, with margin, at every width
// this app targets. Stacking it would have cost ~100px of vertical space at
// the top of every phone screen to fix nothing.
//
// SO: no layout change. What IS changed is that the wrap the measurement
// depends on now reaches the app-wide contract (`WRAP_ROW_SX`) by reference
// instead of being a hand-written `{ flexWrap: "wrap", rowGap: 1 }` that
// happens to hold the same values today. The two assertions below are the
// load-bearing halves of the disproof:
//
//   1. the row wraps, at every width (not phone-scoped) — without this the
//      group shares a line with the label and the 320px case really would be
//      317px of content in a 296px box;
//   2. all three buttons meet the 44px tap floor at `xs` and give it back at
//      `sm` — the floor is what the group's height budget was measured with.
//
// jsdom has no layout, so nothing below re-measures a width. The clearance
// figures above are a browser check, recorded, not asserted.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import ModeSwitch from "./ModeSwitch.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, "ModeSwitch.js"), "utf8");
// Comment lines stripped before any "this token must be absent" check.
// app/theme/mobileSx.test.js records why: that file's own `"44px"` ban had to
// be narrowed to an exact quoted token because comments there legitimately
// discuss "the 44px minimum" in prose. Same shape here — the header below
// explains what `{ flexWrap: "wrap", rowGap: 1 }` used to be written as, and
// a raw substring check reds on that explanation.
const CODE = SOURCE.split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

let container;
let root;

async function render() {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(ModeSwitch, { value: "live", onChange: () => {} }),
      ),
    );
  });
}

const row = () => container.querySelector(".MuiStack-root");
const toggles = () => [...container.querySelectorAll(".MuiToggleButton-root")];

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

describe("F-03: the mode row wraps through the shared contract", () => {
  it("[control] all three modes are rendered — the thing that would be deleted if the group did clip", async () => {
    await render();
    expect(toggles().map((b) => b.textContent)).toEqual(["Live interview", "Practice", "Speak as"]);
  });

  it("reaches WRAP_ROW_SX by the module specifier, not by a hand-written copy of its values", async () => {
    // A hand-rolled `{ flexWrap: "wrap", rowGap: 1 }` is invisible to
    // app/theme/mobileSx.test.js's no-copies sweep, which only walks for
    // `const TOUCH_*` names and 38..48 `xs` floors. This is the assertion
    // that keeps THIS row on the contract.
    expect(CODE).toMatch(/import\s*\{[^}]*\bWRAP_ROW_SX\b[^}]*\}\s*from\s*["'][^"']*mobileSx["']/);
    expect(CODE).toMatch(/\.\.\.WRAP_ROW_SX/);
    expect(CODE).not.toMatch(/flexWrap:\s*"wrap"/);
  });

  it("the row wraps at every width — WRAP_ROW_SX is deliberately not phone-scoped", async () => {
    await render();
    const readAt = (width) =>
      atWidth(width, () => {
        const style = window.getComputedStyle(row());
        return { flexWrap: style.flexWrap, rowGap: style.rowGap };
      });
    // theme.spacing(1) = 8px, matching WRAP_ROW_SX's own pin in
    // app/theme/mobileSx.test.js.
    expect(readAt(375)).toEqual({ flexWrap: "wrap", rowGap: "8px" });
    expect(readAt(1000)).toEqual({ flexWrap: "wrap", rowGap: "8px" });
  });

  it("every mode button carries the 44px tap floor at xs and gives it back at sm", async () => {
    await render();
    const heightsAt = (width) =>
      atWidth(width, () => toggles().map((b) => window.getComputedStyle(b).minHeight));
    expect(heightsAt(375)).toEqual(["44px", "44px", "44px"]);
    expect(heightsAt(1000)).toEqual(["auto", "auto", "auto"]);
  });
});
