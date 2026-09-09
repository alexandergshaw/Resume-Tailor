// @vitest-environment jsdom
//
// The Retry button in SampleAnswer's error Alert, measured.
//
// It was reported during the copilot mobile pass and not fixed: an
// `<Alert action={<Button color="inherit" size="small">}>` whose button carries
// no `sx` at all, so it renders at MUI's natural `size="small"` height
// (~30.75px) and misses the 44px touch floor every other control in this file
// already meets. Its two siblings twelve lines above it -- the show/hide toggle
// and Regenerate -- both spread TOUCH_TARGET_SX; this one was missed because it
// lives inside a slot rather than in the Stack with them.
//
// WHAT IS MEASURED, AND WHAT IS NOT. jsdom has no layout engine, so nothing
// here reads a rendered height -- the ~30.75px figure above is MUI's own
// arithmetic and is not observable in this process. What `atWidth` reads back
// is the SERIALIZED cascade: which breakpoint each declaration lands under,
// resolved the way a browser would resolve it. That is the property that
// actually regressed here (a floor that is absent, or present but keyed to the
// wrong breakpoint), and it is the property this file pins. See
// app/theme/computedStyleAtWidth.js's header for why a naive
// `getComputedStyle` in jsdom reads nothing at all from a responsive `sx`.
//
// The 1000px read is not decoration. `min-height: 44px` applied at EVERY width
// would also satisfy a 375-only assertion while silently growing this button on
// desktop; the pair is what says the rule is phone-scoped, which is the whole
// contract TOUCH_TARGET_SX carries (`{ xs: 44, sm: "auto" }`).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import { makeTheme } from "@/app/theme/index.js";
import { atWidth } from "@/app/theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "@/app/theme/mobileSx";
import SampleAnswer from "./SampleAnswer.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SRC = readFileSync(path.join(process.cwd(), "app/copilot/practice/SampleAnswer.js"), "utf8");

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

async function render(props) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(SampleAnswer, {
          visible: true,
          status: "error",
          points: [],
          cues: [],
          buzzwords: [],
          anchor: null,
          idealProject: null,
          pageSources: [],
          grounding: null,
          error: "The drafter did not answer.",
          isEmbedded: false,
          onToggle: () => {},
          onRetry: () => {},
          onRegenerate: () => {},
          ...props,
        }),
      ),
    );
  });
}

const retry = () => container.querySelector(".MuiAlert-action button");
const toggle = () =>
  [...container.querySelectorAll("button")].find((b) => /sample answer/i.test(b.textContent));

const minHeightAt = (el, width) => atWidth(width, () => window.getComputedStyle(el).minHeight);

describe("SampleAnswer -- the error Alert's Retry clears the touch floor", () => {
  it("[control] the error branch really does render a Retry inside the Alert's action slot", async () => {
    // Without this, every measurement below could be reading a button that is
    // not the one under test -- or `querySelector` could be returning null and
    // the assertions never running at all.
    await render();
    expect(retry()).not.toBeNull();
    expect(retry().textContent).toBe("Retry");
    expect(container.querySelector(".MuiAlert-root")).not.toBeNull();
  });

  it("[control] the instrument reads a real floor off a control that already has one", async () => {
    // The show/hide toggle in the Stack above the panel spreads TOUCH_TARGET_SX
    // today. If this read ever returns something other than 44px/auto the
    // harness is broken and the Retry assertions below mean nothing -- so the
    // failure this file reports would be fabricated rather than measured.
    await render();
    expect(minHeightAt(toggle(), 375)).toBe(`${MOBILE_TAP_MIN}px`);
    expect(minHeightAt(toggle(), 1000)).toBe("auto");
  });

  it("is 44px tall on a phone and untouched at desktop width", async () => {
    await render();
    expect(minHeightAt(retry(), 375)).toBe(`${MOBILE_TAP_MIN}px`);
    expect(minHeightAt(retry(), 1000)).toBe("auto");
  });

  it("takes the floor from the shared contract rather than hand-rolling one", () => {
    // A literal `minHeight: 44` or `"44px"` would satisfy the measurement above
    // while re-introducing exactly the drift the shared module exists to end.
    // `minHeight` is the precise token to forbid: TOUCH_TARGET_SX is spread, so
    // a correct SampleAnswer.js never spells that property itself, and any
    // hand-rolled floor -- whatever number it used -- must.
    expect(SRC).toContain("TOUCH_TARGET_SX");
    expect(SRC).toContain('from "@/app/theme/mobileSx"');
    expect(SRC).not.toContain("minHeight");
    // The QUOTED token, not the bare substring "44px" -- this file's fix
    // carries a comment that legitimately says the button "missed the 44px
    // floor", and a substring check false-positives on prose like that. Same
    // ruling, for the same reason, as app/theme/mobileSx.test.js block 1's
    // own `not.toContain('"44px"')`; see that module's header.
    expect(SRC).not.toContain('"44px"');
  });
});

describe("SampleAnswer -- the Alert action slot's own left offset", () => {
  // MUI gives `.MuiAlert-action` `margin-left: auto` and `padding-left: 16px`
  // (Alert.js's AlertAction slot), which pins the action to the right edge and
  // reserves 16px in front of it. At the 320px floor this app targets, that
  // combination is what squeezes the message column to a few characters per
  // line once the action is a real 44px target.
  //
  // The treatment is NOT invented here. ExpansionPanel.js:239-243 already hit
  // this exact slot in this exact directory and solved it, and its comment
  // records the measurement AND the trap: the two slot styles have to go
  // through `slotProps`, because a nested selector on the root -- including the
  // doubled-ampersand form that usually out-ranks MUI's own class rule -- did
  // not apply to this slot at all. This block pins the same three treatments
  // that precedent says are only effective together.
  it("does not let the action slot reserve space or push itself to the right edge", async () => {
    await render();
    const action = container.querySelector(".MuiAlert-action");
    const style = window.getComputedStyle(action);
    expect(style.marginLeft).toBe("0px");
    expect(style.paddingLeft).toBe("0px");
  });

  it("lets the message shrink and the row wrap, which the offset fix alone does not achieve", async () => {
    await render();
    expect(window.getComputedStyle(container.querySelector(".MuiAlert-message")).minWidth).toBe("0px");
    expect(window.getComputedStyle(container.querySelector(".MuiAlert-root")).flexWrap).toBe("wrap");
  });
});
