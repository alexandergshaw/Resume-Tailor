// @vitest-environment jsdom
//
// AC-T9..T10: THE PROFILE-LIST ENTRY HEADER AND ITS ACCORDION ICON BUTTONS.
//
//   AC-T9   the entry header row is `display: flex; justify-content:
//           space-between`, where the LEFT label box carries neither
//           `minWidth: 0` nor an `overflowWrap`, and the RIGHT button box
//           carries no `flexShrink: 0`. A flex item's automatic minimum size
//           is `min-content`, so a long unbroken `headerLabel(entry)` -- a
//           company or school name, which is exactly what these sections
//           store -- cannot shrink, and the Copy/Remove pair is pushed out of
//           the card. `app/globals.css` sets `html { overflow-x: hidden }`, so
//           what leaves the card is DELETED, not scrollable: the user's own
//           Remove button becomes unreachable rather than merely off-screen.
//   AC-T10  the two accordion-header IconButtons (download-all, copy-all) wrap
//           a 16px SVG in `p: 0.5` (4px a side) -> a 24x24 target, at this
//           repo's 44px bar. These are the only download/copy-all route.
//
// jsdom reads DECLARED values through emotion's real cascade
// (`app/theme/computedStyleAtWidth.js`); it has no layout engine, so:
//
// MANUAL / BROWSER-ONLY -- not simulated by anything below:
//   MC-T8  seed a 50-character space-free `headerLabel` at 375x812 and read
//          `actions.getBoundingClientRect().right -
//          card.getBoundingClientRect().right`. POSITIVE means Copy/Remove
//          have left the card and are unreachable.
//   MC-T9  `getBoundingClientRect().height` on both accordion icon buttons.
//          Predicted 24 before the fix; required >= 44 after.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";

import ProfileListSection from "./ProfileListSection.js";
import { REFERENCES_SECTION } from "./sectionConfigs.js";
import { makeTheme } from "../../theme/index.js";
import { atWidth } from "../../theme/computedStyleAtWidth.js";
import { MOBILE_TAP_MIN } from "../../theme/mobileSx.js";

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

// The realistic worst case for this surface, not a synthetic one: German and
// Dutch legal company names routinely run past 40 characters with no space,
// and `headerLabel` for a reference falls back to `company`.
const LONG_LABEL = "Nordwestdeutscheunternehmensberatungsgesellschaft";

const ENTRY = {
  id: "ref-1",
  name: LONG_LABEL,
  title: "Engineering Manager",
  company: LONG_LABEL,
  relationship: "Former manager",
  email: "m@example.com",
  phone: "555-0100",
  notes: "",
};

function makeCtl(overrides = {}) {
  return {
    entries: [ENTRY],
    open: true,
    setOpen: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    copyBlock: vi.fn(),
    copiedId: null,
    formatBlock: () => "block text",
    formatAll: () => "all text",
    copyAll: vi.fn(),
    allCopied: false,
    downloadDocx: vi.fn(),
    downloadError: "",
    ...overrides,
  };
}

async function render(ctl = makeCtl()) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme: makeTheme("light") },
        createElement(ProfileListSection, {
          ctl,
          config: REFERENCES_SECTION,
          renderCopyButton: () => null,
        })
      )
    );
  });
  return ctl;
}

// -------------------------------------------------------------- measurement

const pxOf = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/** The entry card's header row: the label box and the actions box beside it. */
function headerRow() {
  const label = Array.from(container.querySelectorAll("div")).find(
    (node) => (node.textContent || "").trim() === LONG_LABEL && node.children.length === 0
  );
  return { label, actions: label ? label.nextElementSibling : null };
}

// ============================================================================

describe("AC-T9 -- a long entry label shrinks and wraps instead of evicting the row's buttons", () => {
  it("[control] the header row renders a label box and a sibling actions box", async () => {
    await render();
    const { label, actions } = headerRow();
    expect(label, "no label box for the entry header").toBeTruthy();
    expect(actions, "no actions box beside the label").toBeTruthy();
    expect((actions.textContent || "").replace(/\s+/g, "")).toBe("CopyRemove");
  });

  it("the label box can shrink below its min-content size", async () => {
    // A flex item's `min-width` defaults to `auto`, i.e. min-content -- the
    // single longest unbreakable token. Without `min-width: 0` the label
    // simply refuses to get smaller and pushes its siblings out.
    await render();
    const { label } = headerRow();
    const minWidth = atWidth(375, () => window.getComputedStyle(label).minWidth);
    expect(minWidth, "the label box keeps its min-content floor").toMatch(/^0(px)?$/);
  });

  it("the label box breaks a long unbroken token", async () => {
    await render();
    const { label } = headerRow();
    expect(atWidth(375, () => window.getComputedStyle(label).overflowWrap)).toBe("anywhere");
  });

  it("the actions box refuses to shrink, and wraps rather than overflowing", async () => {
    // The other half: `flex-shrink: 0` keeps Copy/Remove at their real width
    // once the label can give ground, and `flex-wrap: wrap` lets the pair drop
    // to its own line at the narrowest widths rather than leaving the card.
    await render();
    const { actions } = headerRow();
    const declared = atWidth(375, () => {
      const style = window.getComputedStyle(actions);
      return { flexShrink: style.flexShrink, flexWrap: style.flexWrap };
    });
    expect(declared.flexShrink, "the actions box is still shrinkable").toBe("0");
    expect(declared.flexWrap, "the actions box cannot wrap").toBe("wrap");
  });
});

describe("AC-T10 -- the accordion header's download-all and copy-all reach the 44px floor", () => {
  const headerIconButtons = () =>
    Array.from(container.querySelectorAll(".MuiAccordionSummary-root button"));

  it("[control] both header icon buttons render and are enabled when there is content", async () => {
    await render();
    const buttons = headerIconButtons();
    expect(buttons.map((node) => node.getAttribute("aria-label"))).toEqual([
      REFERENCES_SECTION.downloadTitle,
      REFERENCES_SECTION.copyAllTitle,
    ]);
    expect(buttons.every((node) => node.disabled === false)).toBe(true);
  });

  it("both declare a >= 44px box at 375px", async () => {
    await render();
    const offenders = atWidth(375, () =>
      headerIconButtons()
        .map((node) => {
          const style = window.getComputedStyle(node);
          return {
            label: node.getAttribute("aria-label"),
            w: pxOf(style.minWidth),
            h: pxOf(style.minHeight),
          };
        })
        .filter((m) => m.w < MOBILE_TAP_MIN || m.h < MOBILE_TAP_MIN)
        .map((m) => `${m.label} ${m.w}x${m.h}`)
    );
    expect(offenders).toEqual([]);
  });
});

describe("GUARDS (all pass before the fix)", () => {
  it("Copy and Remove still reach their handlers", async () => {
    const ctl = await render();
    const buttons = Array.from(container.querySelectorAll("button"));
    const copy = buttons.find((node) => (node.textContent || "").trim() === "Copy");
    const remove = buttons.find((node) => (node.textContent || "").trim() === "Remove");
    expect(copy).toBeTruthy();
    expect(remove).toBeTruthy();
    await act(async () => {
      copy.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(ctl.copyBlock).toHaveBeenCalledWith(ENTRY);
    expect(ctl.remove).toHaveBeenCalledWith("ref-1");
  });

  it("the accordion header's icon buttons still stop their clicks from toggling the panel", async () => {
    // Both are wrapped in a `<span onClick={stopPropagation}>` inside the
    // AccordionSummary. A target-size fix that restructures the wrapper would
    // make Download collapse the section it just downloaded from.
    const ctl = await render();
    const download = container.querySelector(
      `.MuiAccordionSummary-root button[aria-label="${REFERENCES_SECTION.downloadTitle}"]`
    );
    await act(async () => {
      download.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(ctl.downloadDocx).toHaveBeenCalledTimes(1);
    expect(ctl.setOpen).not.toHaveBeenCalled();
  });

  it("the two-column field grid stays a single column on phones", async () => {
    // `gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }` is already correct
    // (both keys defined, so `sm` genuinely overrides). Pinned so a wrapping
    // fix does not disturb it.
    await render();
    const grid = Array.from(container.querySelectorAll("div")).find(
      (node) => window.getComputedStyle(node).display === "grid"
    );
    expect(grid, "no grid container in the entry card").toBeTruthy();
    expect(atWidth(375, () => window.getComputedStyle(grid).gridTemplateColumns)).toBe("1fr");
    expect(atWidth(1000, () => window.getComputedStyle(grid).gridTemplateColumns)).toBe("1fr 1fr");
  });
});
