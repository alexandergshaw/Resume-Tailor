// @vitest-environment jsdom
//
// `app/copilot/InterviewTypePicker.js` — moved out of `practice/` (chunk A,
// plan row N6). This file is the picker's OWN test file (N13, AC-A8b); it is
// deliberately narrower than `useInterviewType.test.js`'s picker describe
// block, which exercises the same criterion end to end through the store.
// This file's job is the two things that are otherwise uncaught by any gate
// in this chunk (plan §C.7's own words: "nothing in this chunk would catch a
// replacement"):
//
//   * that `TOUCH_MUI_SELECT_SX` is spread ALONGSIDE `TOUCH_FIELD_SX`, never
//     replacing it — the two target different elements
//     (`.MuiInputBase-root` vs `.MuiSelect-select`) and the 44px touch
//     target regresses silently if either is dropped;
//   * that the control stays MUI's non-native `Select` rather than a native
//     `<select>` — settled by UX §3 (the commit boundary matters because
//     every change fires a model call and can destroy a recording) and,
//     again, nothing else in this chunk would catch a silent reversion.
//
// Source-text assertions are the right tool for the second: whether arrow
// keys preview or commit needs a real browser to observe, but WHICH widget is
// rendered is a fact about the file's own text.
//
// The FIRST one is no longer only a source-text fact. The step-9b
// accessibility pass could not settle whether the 44px floor is actually
// REACHED — `TOUCH_MUI_SELECT_SX` and MUI's own rule are a (0,2,0) vs (0,2,0)
// specificity tie, and it flagged that insertion order looked likely to
// favour MUI, leaving the fix inert while reading as correct. The
// "computed cascade" block below settles it by measurement instead: jsdom
// resolves a real cascade, so the constant now has an oracle rather than only
// a spelling check. It found the fix INERT as first written; the doubled
// class in `mobileSx.js`'s selector is what that measurement produced.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import InterviewTypePicker from "./InterviewTypePicker.js";
import { getInterviewType, setInterviewType, __resetInterviewTypeForTests } from "./useInterviewType.js";

// Deliberately NOT `fileURLToPath(new URL(rel, import.meta.url))` — under
// `@vitest-environment jsdom` the global `URL` is jsdom's own class, not
// Node's, and `fileURLToPath` rejects an instance of it with "The URL must
// be of scheme file" even though `import.meta.url` is a valid `file://`
// string (prohibition 27).
const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

function mountPicker(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(
      createElement(InterviewTypePicker, {
        value: getInterviewType(),
        onChange: () => {},
        disabled: false,
        ...props,
      }),
    );
  });
  return container;
}

const helperTextOf = (container) => container.querySelector("p")?.textContent || "";

beforeEach(() => {
  window.localStorage.clear();
  __resetInterviewTypeForTests();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  vi.restoreAllMocks();
  window.localStorage.clear();
  __resetInterviewTypeForTests();
});

describe("InterviewTypePicker — mobile sx (§C.7): additive, never a replacement", () => {
  const src = readSource("./InterviewTypePicker.js");

  it("imports both TOUCH_FIELD_SX and TOUCH_MUI_SELECT_SX from ./mobileSx", () => {
    expect(src).toMatch(/import\s*\{[^}]*TOUCH_FIELD_SX[^}]*\}\s*from\s*"\.\/mobileSx"/);
    expect(src).toMatch(/import\s*\{[^}]*TOUCH_MUI_SELECT_SX[^}]*\}\s*from\s*"\.\/mobileSx"/);
  });

  it("spreads both onto the same sx object, TOUCH_MUI_SELECT_SX last", () => {
    // Both must appear in one `sx={{ ... }}` object, and in this order —
    // reordering would let TOUCH_MUI_SELECT_SX's `.MuiSelect-select` rules
    // be overwritten by a later spread of TOUCH_FIELD_SX (they do not
    // collide today, but the order is the contract, not an accident).
    const sxMatch = src.match(/sx=\{\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\}/);
    expect(sxMatch).not.toBeNull();
    const sxBody = sxMatch[1];
    const fieldIndex = sxBody.indexOf("TOUCH_FIELD_SX");
    const selectIndex = sxBody.indexOf("TOUCH_MUI_SELECT_SX");
    expect(fieldIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeGreaterThan(fieldIndex);
  });
});

// ---------------------------------------------------------------------------
// The computed-cascade harness.
//
// jsdom 29's `getComputedStyle` runs a REAL cascade: it parses every
// stylesheet in the document (emotion's included), matches selectors, computes
// specificity with `@bramus/specificity`, and resolves a tie in favour of the
// LATER rule — which is exactly the browser behaviour this measurement is
// about (`node_modules/jsdom/lib/jsdom/living/css/helpers/computed-style.js`,
// `handleProperty`).
//
// The one thing it does NOT do is evaluate media FEATURES: `evaluateMediaList`
// (`living/css/MediaList-impl.js`) returns true only for an empty list or the
// bare media types `all`/`screen`, so EVERY `@media (min-width:Npx)` block is
// skipped. That matters more than it sounds, because MUI wraps BOTH halves of
// a responsive `sx` value in one — the `xs` branch goes inside
// `@media (min-width:0px)`, not at the top level. Measure without accounting
// for that and no `sx` rule applies at all, at any width.
//
// So a width is emulated by rewriting the condition of every media rule that
// WOULD match at that width to `all`, and leaving every other one to evaluate
// false, as it should. Nothing is moved or re-inserted: each rule keeps its
// position in its sheet and its selector keeps its specificity, so the
// insertion order the tie turns on stays the page's own. The rewrite is
// reverted afterwards, so these cases do not depend on each other's order.
//
// THE CACHE BUST IS NOT OPTIONAL, and leaving it out is the trap this
// harness has to close for whoever copies it next. jsdom memoises one
// computed style per element (`Document-impl.js:208`'s `_styleCache`) and
// invalidates it on `insertRule`/`deleteRule`/`replace` (`CSSStyleSheet-impl.js:41`,
// `:50`, `:88`, `:115`), on a style element being parsed or removed
// (`helpers/stylesheets.js:56`, `:114`) and on node insertion
// (`Node-impl.js:243`, `:249`) — and on NOTHING ELSE. A `media.mediaText`
// write goes through `MediaList-impl.js`, which touches no cache at all, so
// the rewrite above is invisible to any element whose style has already been
// read once. That is not hypothetical: run this harness against a component
// that reads its own computed style (`TranscriptView.js:111` does) and it
// reports the pre-rewrite value as if it were the measurement — a fabricated
// failure, which is worse than no harness at all, because it costs the next
// reader a day and then their trust in the harness on the day it is right.
//
// An inserted-and-immediately-deleted empty rule is the cheap invalidation:
// two calls, no rule survives, nothing in the cascade moves. It runs after
// the rewrite AND after the restore, so no call can leave a stale entry
// behind for the next one. `bustsStyleCache` below proves it does its job by
// warming the cache deliberately first.
function bustStyleCache() {
  // Any sheet with an owner node will do — the clear is document-wide.
  // Emotion's are all `<style>` elements, so they qualify.
  const sheet = document.styleSheets[0];
  sheet.insertRule(".jsdom-cache-bust{}", sheet.cssRules.length);
  sheet.deleteRule(sheet.cssRules.length - 1);
}

function measuredAt(width, container, selector) {
  const restore = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue; // a cross-origin sheet has no cssRules; there are none here
    }
    for (const rule of rules) {
      if (rule.constructor.name !== "CSSMediaRule") continue;
      const min = /^\(min-width:\s*(\d+(?:\.\d+)?)px\)$/.exec((rule.conditionText || "").trim());
      if (!min || Number(min[1]) > width) continue;
      restore.push([rule, rule.media.mediaText]);
      rule.media.mediaText = "all";
    }
  }
  bustStyleCache();
  try {
    const style = window.getComputedStyle(container.querySelector(selector));
    return {
      minHeight: style.minHeight,
      display: style.display,
      boxSizing: style.boxSizing,
      alignItems: style.alignItems,
    };
  } finally {
    for (const [rule, mediaText] of restore) rule.media.mediaText = mediaText;
    bustStyleCache();
  }
}

describe("InterviewTypePicker — computed cascade: the 44px floor is actually REACHED", () => {
  // Each case still mounts its own picker: the cache bust makes a second read
  // of one element honest, but two widths measured against one element in one
  // case would read as a test of the harness rather than of the constant.

  it("the harness busts jsdom's style cache — a read taken before the rewrite must not stick", () => {
    // THE HARNESS'S OWN ORACLE, and the reason it is written as a
    // before/after on ONE element rather than as a single reading.
    //
    // `.MuiInputBase-root`'s min-height is the right probe because the media
    // rewrite is the ONLY thing that can move it: `TOUCH_FIELD_SX` lives
    // entirely inside `@media (min-width:0px)`, and jsdom evaluates no media
    // feature, so with the rewrite absent the element falls back to
    // min-height's initial value.
    const container = mountPicker();
    const probe = container.querySelector(".MuiInputBase-root");

    // Warm the cache deliberately, exactly as a component that measures
    // itself during render would (`TranscriptView.js:111`).
    expect(window.getComputedStyle(probe).minHeight).toBe("auto");

    // Same element, same document, cache now warm. Without a real
    // invalidation this reads back `auto` and every measurement in this
    // block becomes a fossil of whatever happened to be read first — the
    // shape that fabricates a blocker rather than finding one.
    expect(measuredAt(375, container, ".MuiInputBase-root").minHeight).toBe("44px");

    // And the restore path busts too, so the next call starts clean.
    expect(window.getComputedStyle(probe).minHeight).toBe("auto");
  });

  it("on a phone, the select's own display element clears MOBILE_TAP_MIN", () => {
    const container = mountPicker();
    const inputBase = measuredAt(375, container, ".MuiInputBase-root");
    const select = measuredAt(375, container, ".MuiSelect-select");

    // POSITIVE CONTROL, and it has to come first: TOUCH_FIELD_SX has no
    // competing MUI rule, so if the harness were seeing no emotion rules at
    // all this would read `auto` and every assertion below would be vacuous.
    expect(inputBase.minHeight).toBe("44px");

    // THE MEASUREMENT. Against the plain `& .MuiSelect-select` selector this
    // read back `1.4375em` — MUI's own (0,2,0) rule winning the tie on
    // insertion order, i.e. the touch-target fix present in the source and
    // inert on the page, with the ~2px dead band per edge still there.
    expect(select.minHeight).toBe("44px");

    // The other three keys exist so the label sits centred in the taller box
    // rather than at the top of it. They win on their own merits (MUI sets
    // display/box-sizing from a single-class rule), but a regression that
    // dropped them would leave a 44px box with its text against the top edge.
    expect(select.display).toBe("flex");
    expect(select.alignItems).toBe("center");
    expect(select.boxSizing).toBe("border-box");
  });

  it("at `sm` and up, every property is back to exactly what MUI renders", () => {
    // The other half of this module's rule, and it is now load-bearing: with
    // the specificity raised, the `sm` branch WINS rather than losing
    // harmlessly, so it has to restate MUI's own values exactly. These four
    // are what the same element computes with TOUCH_MUI_SELECT_SX absent.
    const container = mountPicker();
    const select = measuredAt(900, container, ".MuiSelect-select");

    expect(select.minHeight).toBe("1.4375em"); // SelectInput.js:89
    expect(select.display).toBe("block"); // InputBase.js:157
    expect(select.boxSizing).toBe("content-box"); // InputBase.js:150
    expect(select.alignItems).toBe("normal"); // nobody sets it; CSS initial
  });

  it("at `sm` and up, TOUCH_FIELD_SX also stands down", () => {
    const container = mountPicker();
    // `auto` is min-height's own initial value — the desktop control keeps
    // the mouse-driven height it already had.
    expect(measuredAt(900, container, ".MuiInputBase-root").minHeight).toBe("auto");
  });
});

describe("InterviewTypePicker — stays MUI's non-native Select (D15)", () => {
  it("does not render a native <select> element", () => {
    const container = mountPicker();
    expect(container.querySelector("select")).toBeNull();
  });

  it("never passes slotProps.select.native (the native-select escape hatch RolePicker/MicPicker use)", () => {
    const src = readSource("./InterviewTypePicker.js");
    expect(src).not.toMatch(/native:\s*true/);
    expect(src).not.toMatch(/slotProps/);
  });
});

describe("InterviewTypePicker — storage-blocked helper text (AC-A8b, contract 10)", () => {
  it("shows only the blurb while storage is healthy", () => {
    const container = mountPicker();
    const text = helperTextOf(container);
    expect(text).toContain("A mix of behavioral, technical, and role-fit questions");
    expect(text).not.toMatch(/not saved/i);
  });

  it("appends the storage-blocked sentence once a write has failed, without dropping the blurb", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => {
      setInterviewType("technical");
    });

    const container = mountPicker();
    const text = helperTextOf(container);
    expect(text).toContain("Coding and problem-solving questions");
    expect(text).toMatch(/not saved/i);
    expect(text).toMatch(/blocking stored settings/i);
  });

  it("keeps the control's accessible name (AC-A24)", () => {
    const container = mountPicker();
    expect(container.textContent).toContain("Interview type");
  });

  it("does not take value/persistence as props — only value, onChange, disabled", () => {
    // AC-G2-C-2 / §C.8: the selected value and its persistence live in
    // useInterviewType; the component reads only the storage-blocked FACT
    // for itself. A prop-drilled blocked flag would defeat contract 10.
    const src = readSource("./InterviewTypePicker.js");
    expect(src).toMatch(/useInterviewTypeStorageBlocked/);
    expect(src).toMatch(/export default function InterviewTypePicker\(\s*\{\s*value,\s*onChange,\s*disabled\s*\}\s*\)/);
  });
});
