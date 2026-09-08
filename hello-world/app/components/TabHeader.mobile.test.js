// @vitest-environment jsdom
//
// TabHeader's actions slot is the row that carries every tab's controls -- the
// Feed/Queue toggle, "Filters", "Autofill profile", and their equivalents on
// eight other tabs (`grep -n "<TabHeader" app`). It declared `flexShrink: 0`
// unconditionally, which on a phone is not a cosmetic problem: the row cannot
// shrink, its parent's `flexWrap: "wrap"` cannot help once the row ITSELF is
// wider than the viewport, and `html { overflow-x: hidden }` (app/globals.css)
// means the part that hangs off the right edge is CLIPPED AND UNREACHABLE
// rather than scrollable. Measured in a real browser against a faithful
// re-creation at 303px, the feed's toolbar laid out 511px wide with the
// Feed/Queue toggle, Filters and Autofill profile ending at right = 339, 399
// and 511 -- so "Filters" was off screen, and the mobile filter sheet it opens
// was unreachable at 375px.
//
// INSTRUMENT NOTE: jsdom has no layout, so none of the above is measurable
// here -- `getBoundingClientRect()` returns zeros and a test asserting overflow
// would pass vacuously and defend the defect. What IS measurable is the
// DECLARED cascade, via `atWidth`, which rewrites the `min-width` media
// conditions MUI compiles every responsive `sx` value into. So these cases pin
// the three declarations that make wrapping possible, and the browser check
// stays a browser check.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import Button from "@mui/material/Button";
import theme from "../theme/index.js";
import { atWidth } from "../theme/computedStyleAtWidth.js";
import TabHeader from "./TabHeader.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PHONE = 375;
const DESKTOP = 1200;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// Three controls, matching the feed toolbar's own shape closely enough that the
// actions row is the widest thing in the header.
async function mountHeader() {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme },
        createElement(TabHeader, {
          title: "Live feed",
          description: "Jobs matched against your profile.",
          actions: [
            createElement(Button, { key: "a" }, "Feed / Queue"),
            createElement(Button, { key: "b" }, "Filters"),
            createElement(Button, { key: "c" }, "Autofill profile"),
          ],
        }),
      ),
    );
  });
}

// The actions slot is the header root's last element child; the title/description
// block is the first. Queried structurally rather than by a test id so the
// component keeps no test-only markup.
function actionsRow() {
  return container.firstElementChild.lastElementChild;
}

describe("TabHeader actions row on a phone", () => {
  it("[instrument] mounts, and the actions row is a distinct element from the title block", async () => {
    // Without this, every assertion below could be reading the title block --
    // or `null` -- and still 'pass' by reading undefined.
    await mountHeader();
    const rootBox = container.firstElementChild;
    expect(rootBox.children.length, "TabHeader should render a title block AND an actions block").toBe(2);
    expect(actionsRow()).not.toBe(rootBox.firstElementChild);
    expect(actionsRow().textContent).toContain("Filters");
  });

  it("lets the actions row shrink on a phone instead of overflowing off screen", async () => {
    await mountHeader();
    const row = actionsRow();
    expect(
      atWidth(PHONE, () => window.getComputedStyle(row).flexShrink),
      "flexShrink:0 on a phone is what pins the actions row wider than the viewport. Because " +
        "app/globals.css sets html{overflow-x:hidden}, the overhang is clipped and unreachable, " +
        "not scrollable -- so a control that lands past the edge cannot be tapped at all.",
    ).not.toBe("0");
  });

  it("gives the actions row its own full-width line on a phone", async () => {
    await mountHeader();
    const row = actionsRow();
    expect(
      atWidth(PHONE, () => window.getComputedStyle(row).width),
      "the parent's flexWrap only helps if the actions row takes a line of its own; at auto width " +
        "it stays beside the title and keeps the same overflow.",
    ).toBe("100%");
  });

  it("allows the row to shrink below its content width on a phone", async () => {
    await mountHeader();
    const row = actionsRow();
    // A flex item's default `min-width:auto` floors it at max-content, so
    // flexShrink alone does not let it narrow. Both are required.
    expect(atWidth(PHONE, () => window.getComputedStyle(row).minWidth)).toBe("0px");
  });

  it("GUARD (passes before the fix too): desktop keeps the row unshrunk and beside the title", async () => {
    // This is a control, not a claim. It must hold both before and after the
    // change -- if it ever goes red, the phone fix leaked into desktop layout.
    await mountHeader();
    const row = actionsRow();
    expect(atWidth(DESKTOP, () => window.getComputedStyle(row).flexShrink)).toBe("0");
    expect(atWidth(DESKTOP, () => window.getComputedStyle(row).width)).toBe("auto");
  });
});
