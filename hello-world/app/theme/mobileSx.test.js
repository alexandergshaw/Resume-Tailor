// @vitest-environment jsdom
//
// The permanent guard for the responsive `sx` contract (R-299: the move from
// `app/copilot/mobileSx.js` to here, and the collapse of four hand-rolled
// copies under `app/components/preview/` onto it). Four blocks, each closing
// a distinct hole the others cannot see:
//
//   1. DECLARED-VALUE PIN (no DOM) — the spelling-and-drift oracle. Every
//      export's exact shape, pinned against a literal table written out
//      below, so a value change reds here no matter which call site it came
//      from.
//   2. SERIALIZED-CASCADE PIN (jsdom + emotion + the `atWidth` harness) — the
//      `minHeight: 1 -> "100%"` catcher. Block 1 can only see the SOURCE; it
//      would happily pass against `MOBILE_TAP_MIN = 1` misread as a fraction
//      by MUI's sizing transform. This block reads back what the browser
//      would actually compute.
//   3. SHIM RETIREMENT PIN — `app/copilot/mobileSx.js` is GONE, and the call
//      sites that used to come through it now name the contract directly.
//
//      THIS BLOCK USED TO BE A SHIM IDENTITY PIN, and the change is worth
//      recording rather than just making. It asserted that the shim
//      re-exported the SAME objects as this module (`toBe`, never `toEqual`,
//      so a second copy with matching values could not pass), which was the
//      right assertion for exactly as long as there were two paths to one
//      module. The shim's own header called itself "a follow-up chunk, not a
//      permanent arrangement" and named its cost: grepping for
//      "theme/mobileSx" UNDER-COUNTED the contract's real adoption by the 30
//      files that reached it relatively. All 30 now import
//      `@/app/theme/mobileSx` and the shim is deleted, so reference identity
//      through a second path is not a weaker property now -- it is a property
//      with no subject left. Deleting these cases without replacement would
//      have quietly dropped the only guard on the shim's return, so the block
//      keeps its slot and changes its subject: the file must stay gone, and
//      the adoption it was hiding is now counted here in the open.
//   4. NO-COPIES SWEEP — every non-test .js file under app/ (not just the
//      four originally-collapsed ones) is walked for the shape of a
//      hand-rolled copy. This is the assertion that actually stops the
//      copies growing back, and it is an EXTENSION POINT: a new adopter of
//      the contract needs to do nothing to be covered by it. Two exemptions
//      are named individually in block 4 itself (app/theme/mobileSx.js, the
//      contract, and app/components/preview/EditorToolbar.js, a deliberately
//      accepted exception -- see docs/REGRESSION.md R-301) rather than
//      folded silently into a shared list.
//
//      Its third check is now WHOLE-TREE. It used to exempt app/copilot/,
//      because that is where the shim lived and a relative specifier there
//      was legal; with the shim gone there is no file anywhere under app/
//      that may reach this module relatively, and the exemption would have
//      been dead weight that silently re-legalised 30 files.
//
// LIMITS, stated so no future reader over-reads a green run here: jsdom has
// NO layout engine, so nothing below asserts a height, a width, or an
// overflow -- only DECLARED `sx` values (block 1) and the SERIALIZED CSS
// jsdom's own cascade produces from them (block 2). The 36.5px natural
// button height that makes the `sm: "36px" -> "auto"` collapse a no-op at
// every call site is arithmetic from MUI's own source (see R-299's
// regression case in docs/REGRESSION.md), not something any test in this
// repo can measure -- jsdom cannot render a box and read its height back.
// TOUCH_SWITCH_SX and TOUCH_PILL_SX's `::after` boxes are declared-value-only
// for the same family of reason: jsdom's computed styles for pseudo-elements
// are unreliable, so block 2 does not attempt to read them back.
//
// TOUCH_MUI_SELECT_SX is deliberately NOT re-measured in block 2 either. It
// already has a dedicated, better oracle --
// `app/copilot/InterviewTypePicker.test.js`'s "computed cascade" describe --
// which additionally proves the doubled-class specificity fight this
// constant depends on (a (0,2,0) vs (0,2,0) tie that reads back INERT
// against a single class, per that file's own header comment). Re-deriving
// that here would either skip the specificity story or duplicate it; this
// file instead pins TOUCH_MUI_SELECT_SX's declared values (block 1) and
// leaves the measured proof at its one existing home.

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import CloseIcon from "@mui/icons-material/Close";

import { makeTheme } from "./index.js";
import { atWidth } from "./computedStyleAtWidth.js";
import * as viaTheme from "./mobileSx.js";
import {
  MOBILE_TAP_MIN,
  TOUCH_TARGET_SX,
  TOUCH_SWITCH_SX,
  TOUCH_PILL_SX,
  TOUCH_FIELD_SX,
  TOUCH_NATIVE_SELECT_SX,
  TOUCH_MUI_SELECT_SX,
  TOUCH_ICON_SX,
  WRAP_ROW_SX,
  BREAK_LONG_WORDS_SX,
  PHONE_PANE_SX,
} from "./mobileSx.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

// --------------------------------------------------------------------------
// Block 1 -- declared-value pin (no DOM).
// --------------------------------------------------------------------------

describe("app/theme/mobileSx.js -- declared-value pin (AC-1, AC-3)", () => {
  it("exports exactly these 11 names, no more, no fewer", () => {
    expect(Object.keys(viaTheme).sort()).toEqual(
      [
        "MOBILE_TAP_MIN",
        "TOUCH_TARGET_SX",
        "TOUCH_SWITCH_SX",
        "TOUCH_PILL_SX",
        "TOUCH_FIELD_SX",
        "TOUCH_NATIVE_SELECT_SX",
        "TOUCH_MUI_SELECT_SX",
        "TOUCH_ICON_SX",
        "WRAP_ROW_SX",
        "BREAK_LONG_WORDS_SX",
        "PHONE_PANE_SX",
      ].sort(),
    );
  });

  it("MOBILE_TAP_MIN is the bare number 44, and only enters the module that way", () => {
    expect(MOBILE_TAP_MIN).toBe(44);
    // The repo's own recorded scar: a bare `44` surviving MUI's sizingTransform
    // untouched is what makes MOBILE_TAP_MIN safe to use as a number at all
    // (see mobileSx.js's own module header and R-162's regression case). If a
    // `"44px"` STRING LITERAL ever creeps back into an sx value, it means
    // someone stopped routing through the shared constant. Checked as the
    // exact quoted token, not the bare substring "44px" -- several comments
    // in this file legitimately discuss "44px" in prose (e.g. "the 44px
    // minimum"), and a substring check would false-positive on those.
    expect(readSource("./mobileSx.js")).not.toContain('"44px"');
  });

  // Every export, pinned against a literal table. Any value change --
  // including one that only touches an `sm`/`md` branch -- reds here.
  it("every export deep-equals its literal table", () => {
    expect(TOUCH_TARGET_SX).toEqual({ minHeight: { xs: 44, sm: "auto" } });

    expect(TOUCH_SWITCH_SX).toEqual({
      "& .MuiSwitch-switchBase::after": {
        content: '""',
        position: "absolute",
        top: { xs: -10, sm: "auto" },
        bottom: { xs: -10, sm: "auto" },
        left: { xs: -10, sm: "auto" },
        right: { xs: -10, sm: "auto" },
      },
    });

    expect(TOUCH_PILL_SX).toEqual({
      position: "relative",
      "&::after": {
        content: '""',
        position: "absolute",
        left: 0,
        right: 0,
        top: { xs: -12, sm: "auto" },
        bottom: { xs: -12, sm: "auto" },
      },
    });

    expect(TOUCH_FIELD_SX).toEqual({
      "& .MuiInputBase-root": { minHeight: { xs: 44, sm: "auto" } },
    });

    expect(TOUCH_NATIVE_SELECT_SX).toEqual({
      "& select": {
        boxSizing: { xs: "border-box", sm: "content-box" },
        minHeight: { xs: 44, sm: "auto" },
      },
    });

    expect(TOUCH_MUI_SELECT_SX).toEqual({
      "& .MuiSelect-select.MuiSelect-select": {
        minHeight: { xs: 44, sm: "1.4375em" },
        display: { xs: "flex", sm: "block" },
        boxSizing: { xs: "border-box", sm: "content-box" },
        alignItems: { xs: "center", sm: "normal" },
      },
    });

    expect(TOUCH_ICON_SX).toEqual({
      minWidth: { xs: 44, sm: "auto" },
      minHeight: { xs: 44, sm: "auto" },
    });

    expect(WRAP_ROW_SX).toEqual({ flexWrap: "wrap", rowGap: 1 });

    expect(BREAK_LONG_WORDS_SX).toEqual({ overflowWrap: "anywhere" });

    expect(PHONE_PANE_SX).toEqual({
      minHeight: { xs: "auto", md: 340 },
      maxHeight: { xs: "none", md: "62vh" },
      overflowY: { xs: "visible", md: "auto" },
    });
  });

  it("uses no breakpoint key outside xs/sm/md, anywhere in the module", () => {
    const seen = new Set();
    const BREAKPOINT_KEY = /^(xs|sm|md|lg|xl)$/;
    (function walk(value) {
      if (!value || typeof value !== "object") return;
      for (const [key, val] of Object.entries(value)) {
        if (BREAKPOINT_KEY.test(key)) seen.add(key);
        walk(val);
      }
    })(viaTheme);
    expect([...seen].sort()).toEqual(["md", "sm", "xs"]);
  });

  it("every sm branch is one of the module's own permitted 'unchanged' values -- never 0, undefined, or a px string", () => {
    // The codified form of the module's own header rule, and the check that
    // would have caught the four collapsed copies' `sm: "36px"` (and the
    // repo's recorded `SpeakerChip` scar, `sm: 0`) had they ever lived here.
    const PERMITTED = new Set([
      "auto",
      "none",
      "visible",
      "content-box",
      "normal",
      "block",
      "1.4375em",
    ]);
    const smValues = [];
    (function walk(value) {
      if (!value || typeof value !== "object") return;
      for (const [key, val] of Object.entries(value)) {
        if (key === "sm") smValues.push(val);
        else walk(val);
      }
    })(viaTheme);
    expect(smValues.length).toBeGreaterThan(0); // the walk itself must find some
    for (const value of smValues) {
      expect(PERMITTED.has(value), `unexpected sm branch: ${JSON.stringify(value)}`).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// Block 2 -- serialized-cascade pin (jsdom + emotion + atWidth).
// --------------------------------------------------------------------------

const mounted = [];

function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, element));
  });
  return container;
}

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
});

describe("app/theme/mobileSx.js -- serialized-cascade pin (AC-9)", () => {
  it("TOUCH_TARGET_SX: 44px at 375, back to auto by 700 (the sm branch), still auto at 1000", () => {
    const container = mount(createElement(Button, { sx: TOUCH_TARGET_SX }, "Test"));
    const minHeightAt = (width) =>
      atWidth(width, () => window.getComputedStyle(container.querySelector("button")).minHeight);

    expect(minHeightAt(375)).toBe("44px");
    expect(minHeightAt(700)).toBe("auto");
    expect(minHeightAt(1000)).toBe("auto");
  });

  it("TOUCH_ICON_SX: min-width and min-height both 44px at 375, both auto at 1000", () => {
    const container = mount(
      createElement(IconButton, { sx: TOUCH_ICON_SX, "aria-label": "close" }, createElement(CloseIcon)),
    );
    const readAt = (width) =>
      atWidth(width, () => {
        const style = window.getComputedStyle(container.querySelector("button"));
        return { minWidth: style.minWidth, minHeight: style.minHeight };
      });

    expect(readAt(375)).toEqual({ minWidth: "44px", minHeight: "44px" });
    expect(readAt(1000)).toEqual({ minWidth: "auto", minHeight: "auto" });
  });

  it("WRAP_ROW_SX: not phone-scoped -- flex-wrap/row-gap are identical at 375 and 1000", () => {
    const container = mount(createElement(Box, { sx: WRAP_ROW_SX, "data-testid": "probe" }));
    const readAt = (width) =>
      atWidth(width, () => {
        const style = window.getComputedStyle(container.querySelector('[data-testid="probe"]'));
        return { flexWrap: style.flexWrap, rowGap: style.rowGap };
      });

    const at375 = readAt(375);
    const at1000 = readAt(1000);
    expect(at375).toEqual({ flexWrap: "wrap", rowGap: "8px" }); // theme.spacing(1)
    expect(at1000).toEqual(at375);
  });

  it("BREAK_LONG_WORDS_SX: not phone-scoped -- overflow-wrap is identical at 375 and 1000", () => {
    const container = mount(createElement(Box, { sx: BREAK_LONG_WORDS_SX, "data-testid": "probe" }));
    const readAt = (width) =>
      atWidth(width, () => window.getComputedStyle(container.querySelector('[data-testid="probe"]')).overflowWrap);

    expect(readAt(375)).toBe("anywhere");
    expect(readAt(1000)).toBe("anywhere");
  });

  it("PHONE_PANE_SX: xs values hold through 700 (the deliberate md keying), md values land at 1000", () => {
    const container = mount(createElement(Box, { sx: PHONE_PANE_SX, "data-testid": "probe" }));
    const readAt = (width) =>
      atWidth(width, () => {
        const style = window.getComputedStyle(container.querySelector('[data-testid="probe"]'));
        return { minHeight: style.minHeight, maxHeight: style.maxHeight, overflowY: style.overflowY };
      });

    expect(readAt(375)).toEqual({ minHeight: "auto", maxHeight: "none", overflowY: "visible" });
    // The pin that catches someone "tidying" `md` to `sm`: at 700 the `sm`
    // breakpoint (600) has already switched, but `md` (900) has not, so this
    // must still read the xs/phone values, not the md ones.
    expect(readAt(700)).toEqual({ minHeight: "auto", maxHeight: "none", overflowY: "visible" });
    expect(readAt(1000)).toEqual({ minHeight: "340px", maxHeight: "62vh", overflowY: "auto" });
  });

  it("TOUCH_FIELD_SX: .MuiInputBase-root is 44px at 375, auto at 1000", () => {
    const container = mount(createElement(TextField, { size: "small", sx: TOUCH_FIELD_SX }));
    const minHeightAt = (width) =>
      atWidth(width, () => window.getComputedStyle(container.querySelector(".MuiInputBase-root")).minHeight);

    expect(minHeightAt(375)).toBe("44px");
    expect(minHeightAt(1000)).toBe("auto");
  });

  it("TOUCH_NATIVE_SELECT_SX: the native <select> itself is 44px/border-box at 375, auto/content-box at 1000", () => {
    const container = mount(
      createElement(
        TextField,
        {
          select: true,
          size: "small",
          slotProps: { select: { native: true } },
          sx: { ...TOUCH_FIELD_SX, ...TOUCH_NATIVE_SELECT_SX },
        },
        createElement("option", { value: "a" }, "A"),
      ),
    );
    const readAt = (width) =>
      atWidth(width, () => {
        const style = window.getComputedStyle(container.querySelector("select"));
        return { minHeight: style.minHeight, boxSizing: style.boxSizing };
      });

    expect(readAt(375)).toEqual({ minHeight: "44px", boxSizing: "border-box" });
    expect(readAt(1000)).toEqual({ minHeight: "auto", boxSizing: "content-box" });
  });

  // TOUCH_MUI_SELECT_SX is deliberately NOT re-measured here -- see this
  // file's own header comment. Its declared values are pinned in block 1;
  // its measured, specificity-proving oracle is
  // `app/copilot/InterviewTypePicker.test.js`'s "computed cascade" describe.

  // TOUCH_SWITCH_SX and TOUCH_PILL_SX get declared-value assertions only
  // (block 1) -- jsdom's computed styles for `::after` pseudo-elements are
  // unreliable, so there is no serialized-cascade probe for either here.
});

// --------------------------------------------------------------------------
// Block 3 -- shim retirement pin. See this file's header for what this block
// used to assert and why that property no longer has a subject.
// --------------------------------------------------------------------------

const SHIM_PATH = join(HERE, "..", "copilot", "mobileSx.js");

describe("app/copilot/mobileSx.js -- the re-export shim is retired (AC-4, AC-5)", () => {
  it("the shim file is gone", () => {
    expect(existsSync(SHIM_PATH)).toBe(false);
  });

  it("[positive control] the existence check can see a file that IS there", () => {
    // Without this, a typo in SHIM_PATH -- a wrong directory, a dropped
    // ".js" -- would make the assertion above pass for the wrong reason and
    // keep passing on the day someone restores the shim.
    expect(existsSync(join(HERE, "mobileSx.js"))).toBe(true);
    expect(existsSync(join(HERE, "..", "copilot", "AnswerLines.js"))).toBe(true);
  });

  it("the call sites that used to come through it now name the contract directly", () => {
    // The adoption number the shim's own header said it was hiding: it
    // reported "grepping for theme/mobileSx UNDER-COUNTS the contract's real
    // adoption by 30 files, because they come through here". Counted here in
    // the open instead, so retiring the shim cannot silently be followed by
    // re-hiding those call sites behind another indirection.
    //
    // A LOWER BOUND, deliberately, and 30 is not an arbitrary floor -- it is
    // the exact number the shim's header claimed. New adopters under
    // app/copilot/ should not have to edit this line; a call site that stops
    // importing the contract, or starts reaching it by some other route,
    // should. The exact-zero half of this property (nothing reaches it
    // relatively any more) is block 4's third check, now whole-tree.
    const importers = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith(".js") || /\.(test|spec)\.js$/.test(full)) continue;
        if (/from\s*["']@\/app\/theme\/mobileSx["']/.test(readFileSync(full, "utf8"))) {
          importers.push(relative(HERE, full).split(sep).join("/"));
        }
      }
    })(join(HERE, "..", "copilot"));
    expect(importers.length, `only ${importers.length} app/copilot importers found`).toBeGreaterThanOrEqual(30);
  });
});

// --------------------------------------------------------------------------
// Block 4 -- no-copies sweep, as an EXTENSION POINT (AC-6, AC-7, F-1).
//
// The previous version of this block hardcoded four filenames, so it could
// only catch a copy in a file someone already remembered to add to that
// list -- which is exactly why a fifth copy in EditorToolbar.js was
// invisible to it, and why a wrong relative import in FormDialog.js needed
// a human reviewer to catch. This version instead walks every non-test .js
// file under app/ and checks each one for the SHAPE of a hand-rolled copy,
// so a new adopter of the shared contract is covered automatically, with no
// list to remember to update.
//
// Three checks, one per way a copy has actually shown up in this repo:
//   1. no file declares its own `const TOUCH_*` constant,
//   2. no file hand-rolls the touch-target NUMBER itself -- a `minWidth`/
//      `minHeight` whose `xs` branch is a bare number in the 38..48 range,
//      or the literal string `"44px"`,
//   3. NO file under app/ reaches the module by a RELATIVE specifier. This
//      check used to exempt app/copilot/, because the temporary shim lived
//      there and 30 files legitimately reached it as "./mobileSx". With the
//      shim deleted and all 30 rewritten to "@/app/theme/mobileSx", the
//      exemption had nothing left to protect and was removed -- a relative
//      specifier anywhere now means either the shim is back or someone has
//      added a second one. The defect this originally caught is unchanged
//      and still covered: a human had to spot by eye that FormDialog.js
//      briefly imported "../copilot/mobileSx".
//
// EXEMPTIONS -- each named individually, with its own reason, rather than a
// silent filename folded into a shared list:
//   - app/theme/mobileSx.js: this module IS the shared contract. It is
//     expected to declare TOUCH_* constants and to use the literal 44 (as
//     MOBILE_TAP_MIN) -- exempt from checks 1 and 2 by definition.
//   - app/components/preview/EditorToolbar.js: a DELIBERATELY ACCEPTED
//     exception (docs/REGRESSION.md R-301; see the file's own comment at
//     EditorToolbar.js:26-28). Its ten `size="small"` formatting controls
//     are single-row and `flexShrink: 0`; their 40px `xs` floor already
//     clears WCAG SC 2.5.8 (24x24, AA), and adopting the shared contract's
//     `sm: "auto"` would SHRINK them at desktop (they are `size="small"`,
//     natural height ~30.75px, unlike the default-size buttons the other
//     four collapsed call sites use) rather than being a no-op the way it
//     was for those four. Exempt from check 2 ONLY -- it still may not
//     declare a `const TOUCH_*` name or reach the module by a relative path.
describe("app/ -- no file outside the shared contract hand-rolls the touch-target rule (AC-6, AC-7, F-1)", () => {
  const APP_DIR = join(HERE, "..");
  const SELF_PATH = fileURLToPath(import.meta.url);

  // Paths below are relative to APP_DIR (i.e. without the leading "app/"
  // segment), matching the `rel` field `files()` produces.
  const MOBILESX_REL = "theme/mobileSx.js";
  const EDITOR_TOOLBAR_REL = "components/preview/EditorToolbar.js";

  let FILES = null;

  function walk(dir, out) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, out);
        continue;
      }
      if (!full.endsWith(".js")) continue;
      if (/\.(test|spec)\.js$/.test(full)) continue;
      if (full === SELF_PATH) continue;
      out.push(full);
    }
  }

  function files() {
    if (FILES) return FILES;
    const found = [];
    walk(APP_DIR, found);
    FILES = found.map((full) => ({
      rel: relative(APP_DIR, full).split(sep).join("/"),
      full,
      src: readFileSync(full, "utf8"),
    }));
    return FILES;
  }

  beforeAll(() => {
    files();
  });

  const TOUCH_CONST_RE = /\bconst\s+TOUCH_[A-Z_]+\b/;
  const XS_FLOOR_RE = /min(?:Width|Height):\s*\{\s*xs:\s*(\d+)/g;
  const RELATIVE_MOBILESX_IMPORT_RE = /from\s*["']\.{1,2}\/[^"']*mobileSx[^"']*["']/;

  function hasHandRolledFloor(src) {
    if (src.includes('"44px"')) return true;
    XS_FLOOR_RE.lastIndex = 0;
    let m;
    while ((m = XS_FLOOR_RE.exec(src))) {
      const n = Number(m[1]);
      if (n >= 38 && n <= 48) return true;
    }
    return false;
  }

  it("[control] the walk finds a populated app/ tree and reaches the known files", () => {
    const rels = files().map((f) => f.rel);
    expect(rels.length).toBeGreaterThan(100);
    expect(rels).toContain(MOBILESX_REL);
    expect(rels).toContain(EDITOR_TOOLBAR_REL);
    // The walk still descends into app/copilot/ -- which matters more now
    // than it did when this line named the shim, because check 3 below no
    // longer exempts that directory and would report a false CLEAN if the
    // walk stopped reaching it.
    expect(rels).toContain("copilot/AnswerLines.js");
    expect(rels).not.toContain("copilot/mobileSx.js");
  });

  it("[positive control] app/theme/mobileSx.js DOES declare TOUCH_* constants -- proving check 1 below isn't vacuous", () => {
    const mod = files().find((f) => f.rel === MOBILESX_REL);
    expect(mod).toBeDefined();
    expect(TOUCH_CONST_RE.test(mod.src)).toBe(true);
  });

  it("no file other than app/theme/mobileSx.js declares its own TOUCH_* constant", () => {
    const offenders = files()
      .filter((f) => f.rel !== MOBILESX_REL)
      .filter((f) => TOUCH_CONST_RE.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("[positive control] EditorToolbar.js DOES still carry the touch-target-range xs floor its exemption is named for -- proving the exemption isn't stale", () => {
    const editorToolbar = files().find((f) => f.rel === EDITOR_TOOLBAR_REL);
    expect(editorToolbar).toBeDefined();
    expect(hasHandRolledFloor(editorToolbar.src)).toBe(true);
  });

  it('no file, other than the named EditorToolbar.js exemption, hand-rolls a 38..48 xs floor or the literal "44px"', () => {
    const offenders = files()
      .filter((f) => f.rel !== MOBILESX_REL && f.rel !== EDITOR_TOOLBAR_REL)
      .filter((f) => hasHandRolledFloor(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("[positive control] the relative-specifier regex matches the shape it is hunting -- proving check 3 below isn't vacuous", () => {
    // Checks 1 and 2 each have a real file that still trips them, so a broken
    // regex shows up immediately. Check 3 is now expected to match NOTHING in
    // the whole tree, which is precisely the state in which a regex that
    // matches nothing at all looks identical to a clean tree. These are the
    // exact specifiers the 30 retired call sites used, plus the cross-
    // directory form FormDialog.js once had.
    for (const shape of [
      'import { TOUCH_TARGET_SX } from "./mobileSx";',
      'import { TOUCH_TARGET_SX } from "../mobileSx";',
      'import { TOUCH_TARGET_SX } from "../copilot/mobileSx";',
      "import { TOUCH_TARGET_SX } from '../../theme/mobileSx.js';",
    ]) {
      expect(RELATIVE_MOBILESX_IMPORT_RE.test(shape), `missed: ${shape}`).toBe(true);
    }
    // …and does not fire on the specifier every call site is supposed to use.
    expect(RELATIVE_MOBILESX_IMPORT_RE.test('import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";')).toBe(false);
  });

  it("no file anywhere under app/ reaches mobileSx by a relative import specifier", () => {
    const offenders = files()
      .filter((f) => RELATIVE_MOBILESX_IMPORT_RE.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  // The four originally-collapsed call sites, still asserted by name: this
  // sweep generalises AC-6/AC-7, it does not retire the specific claim they
  // made.
  it("the four originally-collapsed preview files still import the shared contract", () => {
    for (const name of ["CopyDocumentControl.js", "DriveOverwriteDialog.js", "DriveActions.js", "DriveResultRegion.js"]) {
      const f = files().find((x) => x.rel === `components/preview/${name}`);
      expect(f, `${name} not found by the walk`).toBeDefined();
      expect(f.src).toContain("@/app/theme/mobileSx");
    }
  });
});
