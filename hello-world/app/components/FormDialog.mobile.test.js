// @vitest-environment jsdom
//
// FormDialog is 115 lines and is the parent of NINE dialogs (AddApp, EditApp,
// Stage, AddCommunication, AutofillProfile, SlotReview, BatchTailor,
// experience/DeletePage, experience/BulkActionsBar). Two mobile defects live
// in it, so all nine inherit both:
//
//   C-1  A `<Box component="form">` sits BETWEEN the Dialog Paper and
//        DialogTitle/DialogContent/DialogActions. MUI's Paper is
//        `display:flex; flex-direction:column` (Dialog.js:120-129) and its
//        DialogContent is `flex:1 1 auto; overflow-y:auto`
//        (DialogContent.js:41-46) -- but a plain block wrapper in between
//        breaks the chain: the Paper's flex column now has exactly one child
//        of `height:auto`, DialogContent's `flex` is inert, and the PAPER
//        scrolls instead of the content, carrying DialogActions below the
//        fold. On a fullScreen phone Paper that puts Cancel/Save off-screen.
//
//   C-2  There is no close (X) affordance, and `fullScreen` sets the Paper to
//        `margin:0; width:100%; height:100%` (Dialog.js:189-197) so there is
//        no backdrop pixel left to tap. A phone has no Escape key. With C-1
//        that leaves a long form with NO reachable exit at all.
//
//   C-3  While `busy`, `requestClose` returns early -- killing Escape AND
//        backdrop -- and Cancel is `disabled={busy}`. Zero exits for the
//        whole request. `allowCloseWhileBusy` defaults false and no caller in
//        the repo passes it (grep: 0 hits outside FormDialog.js). Cancel's own
//        `disabled={busy}` outlived the rest of this fix by one round: it was
//        the one VISIBLE affordance still saying "you cannot leave" after
//        Escape, the backdrop and the phone close control all worked again.
//
//   C-14 BatchTailorDialog passes THREE action buttons and no `actionsSx`;
//        MUI's DialogActions declares no `flex-wrap` and no vertical spacing
//        at all -- only a horizontal `marginLeft: 8` between siblings
//        (DialogActions.js:37-43) -- so a wrapped row would sit flush against
//        the one above it without an explicit row gap.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE CAN AND CANNOT PROVE -- read before adding to it.
//
// jsdom HAS NO LAYOUT. `getBoundingClientRect()` returns zeros, `scrollHeight`
// equals `clientHeight` equals 0, and no box is ever laid out. So NOTHING here
// asserts geometry. There is no "the action row is above the fold" test in
// this file and there must never be one -- it would be a fabricated pass.
//
// What jsdom DOES do (jsdom 29) is run a real CSS cascade: it parses emotion's
// injected sheets, matches selectors, computes specificity and resolves ties by
// insertion order. So DECLARED values are honestly measurable, and this file
// asserts those as PROXIES for the layout they cause:
//
//   DECLARED-VALUE PROXY   the flex chain from Paper to DialogContent
//                          (display/flex-direction/flex-grow/min-height).
//                          Proxy for: DialogContent scrolls itself and the
//                          action row stays pinned to the Paper's bottom.
//   DECLARED-VALUE PROXY   DialogActions' computed `flex-wrap` AND `row-gap`.
//                          Proxy for: three buttons wrap instead of squeezing,
//                          onto rows that don't sit flush against each other.
//   REAL BEHAVIOUR         presence, accessible name, enabled-ness, tab
//                          reachability and click/Escape wiring of the exits.
//                          These are DOM facts, not geometry, and are exact.
//
//   STILL A MANUAL BROWSER CHECK, at 375x812, after the fix:
//     1. `document.querySelector('.MuiDialogActions-root')
//         .getBoundingClientRect().bottom <= window.innerHeight`  -> true
//     2. `document.querySelector('.MuiDialogContent-root')`
//         has `scrollHeight > clientHeight`                        -> true
//     3. the close control's rect is inside the viewport at rest (no scroll)
//     4. the three BatchTailor buttons occupy <= 2 rows and none is clipped
//
// Written BEFORE the fix. Every case below except the five explicitly marked
// "GUARD (passes before the fix)" fails against the current source.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import Button from "@mui/material/Button";
import theme from "../theme/index.js";
import { atWidth } from "../theme/computedStyleAtWidth.js";
import FormDialog from "./FormDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport emulation -----------------------------------------------------
// MUI's useMediaQuery (through app/hooks/useResponsive) feature-detects
// matchMedia; jsdom has none at all. This stub answers the real query string
// MUI builds, so `useIsMobile()` (= `down("sm")` = `(max-width:599.95px)`)
// resolves against a settable width instead of being permanently false.
const PHONE = 375;
const DESKTOP = 1200;
let viewportWidth = PHONE;

// Only for the `window.matchMedia` stub below -- NOT the computed-cascade
// harness (see the `atWidth` import). `useIsMobile()`/`useIsTablet()` call
// `useMediaQuery(theme.breakpoints.down(...))` directly, which asks
// `matchMedia` a `(max-width:...)` query rather than going through any `sx`
// value, so this stub has to understand `max-width` as well as `min-width`.
function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) {
    matched = true;
    if (width > Number(max[1])) return false;
  }
  if (min) {
    matched = true;
    if (width < Number(min[1])) return false;
  }
  return matched;
}

window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

// The computed-cascade harness itself (rewrite every matching `@media`
// rule to `all`, bust jsdom's style cache, read, restore) lives at
// `app/theme/computedStyleAtWidth.js` -- imported above as `atWidth` -- so
// this file does not carry a second copy of it. That module only rewrites
// `(min-width:Npx)` rules, which is deliberately narrower than `queryMatches`
// above: every responsive `sx` value MUI resolves (here and in
// `app/theme/mobileSx.test.js`) is compiled through
// `@mui/system/breakpoints`'s `handleBreakpoints`, which calls
// `breakpoints.up()` for every key -- never `breakpoints.down()` -- so no
// `sx`-driven stylesheet rule this file's cascade ever touches is a
// `max-width` rule. `useIsMobile()`'s own `max-width` query never reaches a
// stylesheet at all; it is answered directly by the `matchMedia` stub above.

// `flex: 1 1 auto` is a shorthand; jsdom's computed style may expose it as the
// shorthand, as the three longhands, or as both. Read whichever is populated so
// the assertion is about the declared VALUE, not about which spelling the
// implementer used.
function flexGrowOf(style) {
  const longhand = Number.parseFloat(style.flexGrow);
  if (Number.isFinite(longhand)) return longhand;
  const shorthand = (style.flex || "").trim();
  if (!shorthand) return NaN;
  if (shorthand === "auto") return 1;
  if (shorthand === "none") return 0;
  return Number.parseFloat(shorthand);
}

// --- mount helpers ----------------------------------------------------------
let container;
let root;

beforeEach(() => {
  viewportWidth = PHONE;
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

async function mount(props) {
  await act(async () => {
    root.render(
      createElement(
        ThemeProvider,
        { theme },
        createElement(FormDialog, { open: true, title: "Add application", ...props }, "body"),
      ),
    );
  });
}

const paper = () => document.querySelector(".MuiDialog-paper");
const content = () => document.querySelector(".MuiDialogContent-root");
const actionsRow = () => document.querySelector(".MuiDialogActions-root");
const backdrop = () => document.querySelector(".MuiBackdrop-root");

// Every element strictly between the Paper and `el`. Deliberately generic: it
// does not care whether the wrapper is a form, a Box, one element or three, or
// whether the implementer instead hoists the form onto the Paper itself (in
// which case there is nothing between them and the Paper's own MUI flex column
// already does the job). It asserts the CHAIN, not a chosen structure.
function chainToPaper(el) {
  const out = [];
  let node = el?.parentElement;
  while (node && !node.classList.contains("MuiDialog-paper")) {
    out.push(node);
    node = node.parentElement;
  }
  return node ? out : []; // no Paper ancestor found -> nothing to assert
}

// The one exit control this file is about: a button whose ACCESSIBLE NAME says
// "close". Not a class, not a test id, not a source string.
function closeControl() {
  const buttons = Array.from(document.querySelectorAll(".MuiDialog-root button"));
  return (
    buttons.find((b) => /close/i.test(b.getAttribute("aria-label") || "")) ||
    buttons.find((b) => /close/i.test((b.textContent || "").trim())) ||
    null
  );
}

async function pressEscape() {
  const target = document.querySelector(".MuiDialog-root");
  await act(async () => {
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

// MUI's Modal only treats this as a backdrop click (and calls `onClose`) when
// `event.target === event.currentTarget` -- i.e. the click landed on the
// backdrop element itself, not on something inside it. `.click()` on the
// backdrop node directly satisfies that.
async function clickBackdrop() {
  await act(async () => {
    backdrop().click();
  });
}

// ---------------------------------------------------------------------------
// C-1 -- the wrapper must not break the Paper's flex column.
// DECLARED-VALUE PROXY for "DialogContent scrolls itself, actions stay pinned".
// ---------------------------------------------------------------------------
describe("FormDialog -- C-1: DialogContent, not the Paper, is what scrolls", () => {
  it("keeps every element between the Paper and DialogContent a filling flex column", async () => {
    await mount({});
    const links = chainToPaper(content());
    expect(paper()).toBeTruthy();
    expect(content()).toBeTruthy();
    atWidth(PHONE, () => {
      for (const el of links) {
        const s = window.getComputedStyle(el);
        // A block wrapper here gives DialogContent no flex parent at all, so
        // its `flex:1 1 auto` is inert and the Paper scrolls in its place.
        expect(s.display).toBe("flex");
        expect(s.flexDirection).toBe("column");
        // Without `flex-grow`, the wrapper is content-height inside the Paper
        // and never hands its own height down to DialogContent.
        expect(flexGrowOf(s)).toBeGreaterThanOrEqual(1);
        // `min-height:auto` on a flex item refuses to shrink below content
        // height -- the single most common cause of "the content will not
        // scroll, the container grows instead".
        expect(["0px", "0", "0%"]).toContain(s.minHeight);
      }
    });
  });

  it("keeps the action row in the same flex column, so it can be pinned rather than scrolled away", async () => {
    await mount({});
    expect(actionsRow()).toBeTruthy();
    const links = chainToPaper(actionsRow());
    atWidth(PHONE, () => {
      for (const el of links) {
        const s = window.getComputedStyle(el);
        expect(s.display).toBe("flex");
        expect(s.flexDirection).toBe("column");
      }
    });
  });

  it("GUARD (passes before the fix): DialogContent still declares its own scroll", async () => {
    // MUI gives this for free (DialogContent.js:41-46). It is here so a later
    // change that sets `overflow: visible` or `flex: none` on the content --
    // the other way to reintroduce C-1 -- is caught.
    await mount({});
    atWidth(PHONE, () => {
      const s = window.getComputedStyle(content());
      expect(s.overflowY).toBe("auto");
      expect(flexGrowOf(s)).toBeGreaterThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// C-2 -- a visible, reachable exit on a fullScreen phone dialog.
// REAL BEHAVIOUR (DOM facts, not geometry).
// ---------------------------------------------------------------------------
describe("FormDialog -- C-2: there is an exit on a phone", () => {
  it("renders a control whose accessible name is 'Close' when the dialog is fullScreen", async () => {
    await mount({});
    const btn = closeControl();
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.disabled).toBe(false);
    // Hidden from the a11y tree is the same as absent for a screen reader.
    expect(btn.closest("[aria-hidden='true']")).toBeNull();
  });

  it("closes the dialog when that control is activated", async () => {
    let closed = 0;
    await mount({ onClose: () => { closed += 1; } });
    const btn = closeControl();
    expect(btn).toBeTruthy();
    await act(async () => {
      btn.click();
    });
    expect(closed).toBe(1);
  });

  it("puts the close control outside the scrolling content region and in the tab order", async () => {
    await mount({});
    const btn = closeControl();
    expect(btn).toBeTruthy();
    // DECLARED-VALUE PROXY for "reachable at rest": a control inside
    // DialogContent can be scrolled out of sight; one in the title bar cannot.
    // (The real geometry is manual check #3 in this file's header.)
    expect(content().contains(btn)).toBe(false);
    expect(document.querySelector(".MuiDialog-paper").contains(btn)).toBe(true);
    // Tab-reachable: a real button with no negative tabindex, inside the
    // dialog's focus trap.
    expect(btn.getAttribute("tabindex")).not.toBe("-1");
  });
});

// ---------------------------------------------------------------------------
// No title -- the close control must not depend on one existing.
// REAL BEHAVIOUR. mount()'s default hardcodes a title, so no case above this
// one can ever reach the `title == null` branch. A caller that passes no
// title is one prop away from FormDialog's own C-2 trap: on a fullScreen
// phone dialog there is still no backdrop pixel and no Escape key, so the
// close control cannot be conditioned on `title` without reopening it for
// that caller. DECIDED: the close control renders whenever the dialog is
// fullScreen, title or no title; on desktop, no title still means no title
// bar at all, because desktop already has a backdrop and Escape and an empty
// title bar would add nothing.
// ---------------------------------------------------------------------------
describe("FormDialog -- no title", () => {
  it("still renders a reachable 'Close' control on a phone when no title is given", async () => {
    await mount({ title: undefined });
    const btn = closeControl();
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.disabled).toBe(false);
  });

  it("closes the dialog when that control is activated, with no title", async () => {
    let closed = 0;
    await mount({ title: undefined, onClose: () => { closed += 1; } });
    const btn = closeControl();
    expect(btn).toBeTruthy();
    await act(async () => {
      btn.click();
    });
    expect(closed).toBe(1);
  });

  it("renders no title bar at all on desktop when no title is given", async () => {
    viewportWidth = DESKTOP;
    await mount({ title: undefined });
    expect(document.querySelector(".MuiDialogTitle-root")).toBeNull();
  });

  it("does not put the close control inside a heading when there is no title", async () => {
    // With no title text, MUI's DialogTitle would otherwise still emit an
    // <h2> (its own component:"h2" default) whose only content is the close
    // IconButton -- an empty/malformed heading, not a real title (axe's
    // empty-heading rule). FormDialog forces `component="div"` in exactly
    // this case, so the title bar keeps its box and styling but stops being
    // a heading at all.
    await mount({ title: undefined });
    const bar = document.querySelector(".MuiDialogTitle-root");
    expect(bar).toBeTruthy();
    expect(bar.tagName).toBe("DIV");
    const headings = document.querySelectorAll(".MuiDialog-root h1, .MuiDialog-root h2, .MuiDialog-root h3, .MuiDialog-root h4, .MuiDialog-root h5, .MuiDialog-root h6");
    expect(headings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C-3 -- busy must not remove every exit.
// REAL BEHAVIOUR.
// ---------------------------------------------------------------------------
describe("FormDialog -- C-3: a hung save does not trap the user", () => {
  it("still closes on Escape while busy", async () => {
    let closed = 0;
    await mount({ busy: true, onClose: () => { closed += 1; } });
    await pressEscape();
    expect(closed).toBe(1);
  });

  it("keeps the close control live while busy", async () => {
    let closed = 0;
    await mount({ busy: true, onClose: () => { closed += 1; } });
    const btn = closeControl();
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    await act(async () => {
      btn.click();
    });
    expect(closed).toBe(1);
  });

  it("GUARD (passes before the fix): the primary action is still blocked while busy", async () => {
    // Letting the user OUT must not also let them submit twice.
    let submits = 0;
    await mount({ busy: true, onSubmit: () => { submits += 1; } });
    const save = Array.from(document.querySelectorAll(".MuiDialogActions-root button")).at(-1);
    expect(save.disabled).toBe(true);
    await act(async () => {
      save.click();
    });
    expect(submits).toBe(0);
  });

  it("keeps the Cancel button itself enabled and working while busy", async () => {
    // FormDialog.js's own comment says "only the submit itself stays
    // blocked" -- Cancel used to be `disabled={busy}` anyway, the one
    // VISIBLE affordance left saying "you cannot leave" beside Escape, the
    // backdrop and the phone close control, all of which already work.
    let closed = 0;
    await mount({ busy: true, onClose: () => { closed += 1; } });
    const buttons = Array.from(document.querySelectorAll(".MuiDialogActions-root button"));
    const cancel = buttons[0];
    expect(cancel.textContent.trim()).toBe("Cancel");
    expect(cancel.disabled).toBe(false);
    await act(async () => {
      cancel.click();
    });
    expect(closed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C-14 -- the action row wraps by default.
// DECLARED-VALUE PROXY for "three buttons do not squeeze to 121px".
// ---------------------------------------------------------------------------
describe("FormDialog -- C-14: a three-button action row wraps", () => {
  it("declares flex-wrap:wrap AND a row gap on the actions row with no actionsSx from the caller", async () => {
    // BatchTailorDialog passes three buttons and no actionsSx; MUI's
    // DialogActions declares no flex-wrap and no vertical spacing at all
    // (only a horizontal `marginLeft: 8` between siblings), so a wrapped
    // second row would sit flush against the first without the shared
    // `WRAP_ROW_SX` contract's `rowGap`.
    await mount({
      actions: createElement(
        "div",
        null,
        createElement(Button, { key: "a" }, "Cancel"),
        createElement(Button, { key: "b" }, "Tailor only (no download)"),
        createElement(Button, { key: "c" }, "Tailor & download"),
      ),
    });
    atWidth(PHONE, () => {
      const style = window.getComputedStyle(actionsRow());
      expect(style.flexWrap).toBe("wrap");
      expect(style.rowGap).toBe("8px"); // WRAP_ROW_SX's rowGap: 1 === theme.spacing(1)
    });
  });

  it("still wraps with a row gap when the caller passes an unrelated actionsSx", async () => {
    await mount({ actionsSx: { px: 2 } });
    atWidth(PHONE, () => {
      const style = window.getComputedStyle(actionsRow());
      expect(style.flexWrap).toBe("wrap");
      expect(style.rowGap).toBe("8px");
    });
  });

  it("GUARD (passes before the fix): a caller's own flex-wrap still wins", async () => {
    // Guards the merge ORDER: a default spread after the caller's sx would
    // silently override SlotReviewDialog/CompanyResearchDialog's explicit
    // values. Passes today only because there is no default at all.
    await mount({ actionsSx: { flexWrap: "nowrap" } });
    atWidth(PHONE, () => {
      expect(window.getComputedStyle(actionsRow()).flexWrap).toBe("nowrap");
    });
  });
});

// ---------------------------------------------------------------------------
// Keyboard path. Mostly MUI-provided; these lock in what must not regress, plus
// the one keyboard claim the fix actually changes (Escape on desktop while
// busy -- the same C-3 lock, from the mouse-and-keyboard side).
// ---------------------------------------------------------------------------
describe("FormDialog -- keyboard", () => {
  it("GUARD (passes before the fix): Escape closes when not busy, and focus starts inside the dialog", async () => {
    let closed = 0;
    await mount({ onClose: () => { closed += 1; } });
    expect(document.querySelector(".MuiDialog-paper").contains(document.activeElement)).toBe(true);
    await pressEscape();
    expect(closed).toBe(1);
  });

  it("GUARD (passes before the fix): focus returns to the opener when the dialog closes", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);
    await mount({});
    expect(document.activeElement).not.toBe(opener);
    await act(async () => {
      root.render(createElement(ThemeProvider, { theme }, createElement(FormDialog, { open: false })));
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("is escapable with the keyboard on a desktop viewport while busy too", async () => {
    viewportWidth = DESKTOP;
    let closed = 0;
    await mount({ busy: true, onClose: () => { closed += 1; } });
    await pressEscape();
    expect(closed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Backdrop click (AC-formdialog-mobile #20: desktop must still close by
// Escape, by backdrop click, and by Cancel). `requestClose` no longer has a
// busy gate at all (see FormDialog.js's own comment on `allowCloseWhileBusy`
// being removed), which is a real behaviour change on the backdrop-click
// path -- nothing above this describe exercises a backdrop click on either
// viewport.
// ---------------------------------------------------------------------------
describe("FormDialog -- backdrop click", () => {
  it("closes on a desktop viewport when idle", async () => {
    viewportWidth = DESKTOP;
    let closed = 0;
    await mount({ onClose: () => { closed += 1; } });
    await clickBackdrop();
    expect(closed).toBe(1);
  });

  it("still closes on a desktop viewport while busy -- the busy gate was removed", async () => {
    viewportWidth = DESKTOP;
    let closed = 0;
    await mount({ busy: true, onClose: () => { closed += 1; } });
    await clickBackdrop();
    expect(closed).toBe(1);
  });

  // Deliberately NO "closes on a phone viewport too" case here. This file's
  // own C-2 premise (header, line 17-19) is that a fullScreen Paper is
  // `margin:0; width:100%; height:100%`, leaving no backdrop pixel left to
  // tap -- so a real user on a phone can never produce this click. A case
  // that mounted on PHONE and called `clickBackdrop()` used to live here and
  // was green only because jsdom does no hit testing and `.click()` on the
  // backdrop node fires regardless of what visually covers it. That is
  // exactly the fabricated pass the header at line 33-36 forbids ("there is
  // no 'the action row is above the fold' test in this file and there must
  // never be one"), so it was deleted rather than kept for a false sense of
  // coverage. The two cases above (desktop, idle and busy) are the real
  // backdrop-click coverage AC-formdialog-mobile #20 asks for.
});
