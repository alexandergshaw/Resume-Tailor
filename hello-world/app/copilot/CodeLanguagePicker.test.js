// @vitest-environment jsdom
//
// `app/copilot/CodeLanguagePicker.js` — the presentational sibling of
// `InterviewTypePicker`, and the owner of OPTION Z's half of the storage
// sentence.
//
// Written BEFORE the implementation exists (step 4b): the whole file fails on
// the missing `./CodeLanguagePicker.js` and `./useCodeLanguage.js` modules
// until wave 3 lands.
//
// OPTION Z, AND WHY ITS PRECEDENCE IS THE LOAD-BEARING THING HERE. The
// reconciliation's original ruling — move the storage sentence up to the
// surface and let neither picker own it — was WITHDRAWN, because carrying it
// out would have reversed a deliberate chunk-A decision that is pinned by
// `InterviewTypePicker.test.js:325-326` under the comment "A prop-drilled
// blocked flag would defeat contract 10". So `InterviewTypePicker` is
// untouched, and the precedence lives here instead: **this picker renders the
// sentence only when the LANGUAGE store is blocked and the INTERVIEW-TYPE
// store is not.** Exactly one sentence per surface, by construction rather
// than by coordination.
//
// That makes two assertions non-negotiable, and neither is obvious:
//
//   * THE MATRIX NEEDS ITS POSITIVE CONTROLS. "This picker says nothing when
//     both stores are blocked" is satisfied by a picker that never says
//     anything at all — which is the third option the ruling explicitly
//     rejected (it leaves a quota failure on a language write undisclosed,
//     which AC-C4 exists to prevent). So every row that asserts silence here
//     also asserts that the OTHER picker is speaking.
//   * THE TWO CONTROLS' TEXT MUST MATCH. The exact string exists in exactly
//     one place in the tree — inside a template literal at
//     `InterviewTypePicker.js:41` — and §D-29 forbids touching that file. So
//     the sentence is DERIVED from what that picker actually renders and
//     compared against what this one renders, rather than two literals being
//     eyeballed for sameness.
//
// The blocked flag is per-instance (`choiceStore.js`'s FD-1 block), so
// blocking one store and not the other needs a KEY-SELECTIVE throwing spy —
// a blanket `Storage.prototype.setItem` throw cannot express three of the
// four rows below.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import CodeLanguagePicker from "./CodeLanguagePicker.js";
import InterviewTypePicker from "./InterviewTypePicker.js";
import { CONTROL_OPTIONS } from "@/lib/copilot/codeLanguages";
import {
  CODE_LANGUAGE_STORAGE_KEY,
  setCodeLanguage,
  __resetCodeLanguageForTests,
} from "./useCodeLanguage.js";
import {
  INTERVIEW_TYPE_STORAGE_KEY,
  setInterviewType,
  __resetInterviewTypeForTests,
} from "./useInterviewType.js";

// Deliberately NOT `fileURLToPath(new URL(rel, import.meta.url))` — under
// `@vitest-environment jsdom` the global `URL` is jsdom's own class, not
// Node's, and `fileURLToPath` rejects an instance of it with "The URL must be
// of scheme file".
const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// §B.5's fourth, conditional row, pinned verbatim because the plan had to pin
// it: its only occurrence in the tree is inside a template literal in a file
// chunk C may not open. A PERIOD, not an em dash — `·` and `—` are silent at
// default screen-reader punctuation settings.
const STORAGE_SENTENCE = "Not saved. This browser is blocking stored settings.";

// §B.5's two rows, both pinned verbatim (`plan-chunk-c.md:408-417`).
const AUTO_ROW =
  "Pseudocode unless a specific language is set, named in your question, or found in the posting.";
const EXPLICIT_ROW = "Preferred for code answers; a language named in the question wins.";

const mounted = [];

function mount(Component, props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Component, { onChange: () => {}, disabled: false, ...props }));
  });
  return container;
}

const helperTextOf = (container) => container.querySelector("p")?.textContent || "";

// MUI's non-native Select renders its options into a Popover that exists only
// while the menu is open. Measured against the shipped sibling
// (`InterviewTypePicker`) in this exact jsdom setup: a bubbling `mousedown` on
// the `role="combobox"` element opens it and yields seven `role="option"`
// nodes in registry order, and `HTMLElement.click()` on one of them fires the
// component's `onChange` with that option's value. A dispatched `MouseEvent`
// "click" does NOT — hence `.click()`.
function openMenu(container) {
  const combobox = container.querySelector('[role="combobox"]');
  expect(combobox, "no role=combobox rendered").toBeTruthy();
  act(() => {
    combobox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  });
  return Array.from(document.querySelectorAll('[role="option"]'));
}

// Throws from `setItem` for the named keys ONLY, and lets every other key
// through to the real implementation. A blanket throw would flip both stores'
// flags at once and make three of the four precedence rows unwritable.
function blockKeys(...keys) {
  const blocked = new Set(keys);
  const real = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
    if (blocked.has(key)) throw new Error("QuotaExceededError");
    return real.call(this, key, value);
  });
}

// Attempting a write is what OBSERVES the failure — the flag reports the
// environment, and the store has no reason to look before it is asked to.
function attemptLanguageWrite() {
  act(() => setCodeLanguage("java"));
}
function attemptTypeWrite() {
  act(() => setInterviewType("technical"));
}

beforeEach(() => {
  window.localStorage.clear();
  __resetCodeLanguageForTests();
  __resetInterviewTypeForTests();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  // This repo sets neither `clearMocks` nor `restoreMocks`, and the cases
  // below install a THROWING spy on `Storage.prototype` — one left standing
  // makes every later case believe storage is unwritable.
  vi.restoreAllMocks();
  window.localStorage.clear();
  __resetCodeLanguageForTests();
  __resetInterviewTypeForTests();
});

describe("CodeLanguagePicker — the control itself (AC-C1, CONF-3)", () => {
  it("has the accessible name `Code language`, from exactly one labelling element", () => {
    // ASSERTED THROUGH `aria-labelledby`, NOT by counting `<label>` elements.
    // Measured in this jsdom setup: under MUI v9 a `TextField select` renders
    // its `InputLabel` as a **`<div>`** and the shipped sibling
    // `InterviewTypePicker` therefore contains ZERO `<label>` elements. A
    // `<label>` count of 1 is unsatisfiable by the design this file's own §B.5
    // derivation tells the implementer to mirror, and its only escape —
    // `slotProps={{ inputLabel: { component: "label" } }}` — is banned nine
    // cases below. A test no implementation can pass gets deleted by whoever
    // meets it, and the realistic response (add a bare `<label>` to make the
    // count 1) is worse than either.
    //
    // `aria-labelledby` is what actually names the control, and "exactly one"
    // is the property that case was reaching for.
    const container = mount(CodeLanguagePicker, { value: "auto" });
    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox).toBeTruthy();
    const labelledBy = (combobox.getAttribute("aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
    expect(labelledBy).toHaveLength(1);
    const namer = document.getElementById(labelledBy[0]);
    expect(namer).toBeTruthy();
    expect(namer.textContent.trim()).toBe("Code language");
    // Nothing else claims to name it.
    expect(combobox.getAttribute("aria-label")).toBeNull();
    // And the element that names it is exposed. `aria-labelledby` still
    // resolves and `textContent` still matches when the labeller is
    // `aria-hidden` — while the control's real accessible name is EMPTY to a
    // screen reader. That is a genuine a11y defect the two assertions above
    // cannot see.
    expect(namer.getAttribute("aria-hidden")).toBeNull();
    expect(namer.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("renders the LABEL of the selected value, not its storage slug", () => {
    const container = mount(CodeLanguagePicker, { value: "csharp" });
    expect(container.querySelector(".MuiSelect-select")?.textContent).toBe("C#");
  });

  it("falls back to Auto for a value outside the vocabulary (AC-C4)", () => {
    // Never a select with nothing selected — the same normalization
    // `InterviewTypePicker` does through the shared module.
    const container = mount(CodeLanguagePicker, { value: "retired-language" });
    expect(container.querySelector(".MuiSelect-select")?.textContent).toBe("Auto");
  });

  it("stays MUI's non-native Select (CONF-3)", () => {
    // Every arrow keypress on a NATIVE select fires a cache invalidation and
    // can fire a billed stream; nine options means up to nine of each. A
    // native `<select>` has no commit boundary — HTML assumes the form's
    // submit is it, and this app has no submit.
    const container = mount(CodeLanguagePicker, { value: "auto" });
    expect(container.querySelector("select")).toBeNull();
    const src = readSource("./CodeLanguagePicker.js");
    expect(src).not.toMatch(/native:\s*true/);
  });

  it("RENDERS exactly the nine options, in AC-C1's order — no tenth, no reorder", () => {
    // A source-text `CONTROL_OPTIONS.map(` is satisfied by a SUPERSET:
    // `[...CONTROL_OPTIONS.map((e) => e), { value: "ruby", label: "Ruby" }]`
    // matches it, renders a tenth option, lets the user select it, stores
    // `"ruby"`, and has it silently normalized back to `auto` on the next read
    // — a control that appears to accept a choice and discards it.
    //
    // So the rendered menu is read, not the source. (Measured: the popup does
    // open in jsdom; see `openMenu` above.)
    const container = mount(CodeLanguagePicker, { value: "auto" });
    const options = openMenu(container);
    expect(options.map((o) => o.textContent)).toEqual(CONTROL_OPTIONS.map((o) => o.label));
    expect(options).toHaveLength(9);
  });

  it("takes its options from the shared registry, never a second literal list", () => {
    // The rendered-set case above is the behavioural guard; this is the
    // structural one — a second list is how the control and the resolver drift
    // apart in the first place.
    const src = readSource("./CodeLanguagePicker.js");
    expect(src).toMatch(/import\s*\{[^}]*\bCONTROL_OPTIONS\b[^}]*\}\s*from\s*["']@\/lib\/copilot\/codeLanguages(?:\.js)?["']/);
    expect(src).toMatch(/CONTROL_OPTIONS\s*\.\s*map\s*\(/);
    expect(CONTROL_OPTIONS).toHaveLength(9);
  });

  it("CALLS onChange with the chosen value, EVERY time — not just the first", () => {
    // Sixteen renders in this file and, until this case, not one change fired.
    // `onChange={() => {}}` inside the component renders perfectly, says the
    // right things, sits in the right place, and does nothing when used —
    // and every other assertion here stays green.
    //
    // TWO changes, deliberately: a one-shot latch anywhere between this
    // component and its caller produces a control that accepts the first
    // selection and silently ignores every one after it, which a single-change
    // case cannot distinguish from a working one.
    const onChange = vi.fn();
    const container = mount(CodeLanguagePicker, { value: "auto", onChange });

    const first = openMenu(container);
    act(() => first[CONTROL_OPTIONS.findIndex((o) => o.value === "java")].click());
    const second = openMenu(container);
    act(() => second[CONTROL_OPTIONS.findIndex((o) => o.value === "go")].click());

    expect(onChange).toHaveBeenCalledTimes(2);
    // The CONTROL VALUE, not the label — this is what reaches storage, the
    // request body and the cache key.
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(["java", "go"]);
  });

  it("passes the storage SLUG for C#, not the label", () => {
    // The one row where handing back the rendered text instead of the option
    // value puts a `#` into a localStorage key and a JSON body field.
    const onChange = vi.fn();
    const container = mount(CodeLanguagePicker, { value: "auto", onChange });
    const options = openMenu(container);
    act(() => options[CONTROL_OPTIONS.findIndex((o) => o.value === "csharp")].click());
    expect(onChange).toHaveBeenCalledWith("csharp");
  });

  it("needs none of AC-C5's MUI escape hatches, because `Auto` is not the empty string", () => {
    // AC-C5 is CONTINGENT on `Auto` being encoded as `""`. Under AC-C24b's
    // `"auto"`, `isFilled` is true, the label shrinks normally, and the whole
    // hazard is inert — so the workarounds for it must not be present either,
    // or a later reader will infer the hazard is live.
    const src = readSource("./CodeLanguagePicker.js");
    expect(src).not.toMatch(/displayEmpty/);
    expect(src).not.toMatch(/renderValue/);
    expect(src).not.toMatch(/slotProps/);
  });

  it("takes exactly `{ value, onChange, disabled }` — no focus props, no blocked flag (A-21, D-6)", () => {
    // Option Z's whole shape: this component reads the two storage facts for
    // itself. A prop-drilled flag here would be the design the ruling
    // withdrew, and the focus seam belongs one level up in `CodeLanguageField`
    // — a component cannot defer its own unmount.
    const src = readSource("./CodeLanguagePicker.js");
    expect(src).toMatch(
      /export default function CodeLanguagePicker\(\s*\{\s*value,\s*onChange,\s*disabled\s*\}\s*\)/,
    );
    expect(src).not.toMatch(/\bstorageBlocked\b/);
    expect(src).not.toMatch(/\bonFocus\b/);
    expect(src).not.toMatch(/\bonBlur\b/);
  });

  it("keeps the shared touch sizing, additively (chunk A's convention)", () => {
    const src = readSource("./CodeLanguagePicker.js");
    expect(src).toMatch(/TOUCH_FIELD_SX/);
    expect(src).toMatch(/TOUCH_MUI_SELECT_SX/);
  });
});

// ---------------------------------------------------------------------------
// R-2, finding 5: the computed-cascade harness, ported from
// `InterviewTypePicker.test.js` (see that file's own header comment for the
// full mechanism writeup — jsdom's `getComputedStyle` runs a real cascade
// with real specificity and real insertion-order tie-breaking, it just never
// evaluates a `@media` FEATURE, so a width is emulated by rewriting the
// condition of every matching `min-width` rule to `all` and busting jsdom's
// per-element style cache afterward).
//
// WHY THIS BELONGS HERE AND NOT ONLY ON `InterviewTypePicker`: this picker's
// only prior touch-target coverage was two source-text greps for
// `TOUCH_FIELD_SX` / `TOUCH_MUI_SELECT_SX` ("keeps the shared touch sizing,
// additively" above). `mobileSx.js:151-165` records that the doubled
// `.MuiSelect-select.MuiSelect-select` selector is required PRECISELY
// because the plain, single-class form loses the insertion-order tie to
// MUI's own rule and is entirely inert while every source-text assertion
// stays green — the exact "referenced but inert" shape this repo already
// shipped once. A grep cannot tell a live (0,3,0) selector from a dead
// (0,2,0) one; only a measurement of the actual computed style can. This
// component gets its own copy of the harness (not a shared import) so a
// regression here cannot hide behind `InterviewTypePicker`'s tree passing.
function bustStyleCache() {
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

describe("CodeLanguagePicker — computed cascade: the 44px floor is actually REACHED", () => {
  // Each case still mounts its own picker: the cache bust makes a second read
  // of one element honest, but two widths measured against one element in one
  // case would read as a test of the harness rather than of the constant.

  it("on a phone, both the input base and the select's own display element clear MOBILE_TAP_MIN", () => {
    const container = mount(CodeLanguagePicker, { value: "auto" });
    const inputBase = measuredAt(375, container, ".MuiInputBase-root");
    const select = measuredAt(375, container, ".MuiSelect-select");

    // POSITIVE CONTROL, and it has to come first: TOUCH_FIELD_SX has no
    // competing MUI rule, so if the harness were seeing no emotion rules at
    // all this would read `auto` and the assertion below would be vacuous.
    expect(inputBase.minHeight).toBe("44px");

    // THE MEASUREMENT. Against a plain (undoubled) `& .MuiSelect-select`
    // selector this reads back `1.4375em` — MUI's own (0,2,0) rule winning
    // the insertion-order tie, i.e. the touch-target fix present in the
    // source and entirely inert on the page.
    expect(select.minHeight).toBe("44px");
    expect(select.display).toBe("flex");
    expect(select.alignItems).toBe("center");
    expect(select.boxSizing).toBe("border-box");
  });

  it("at `sm` and up, every property reverts to exactly what MUI itself renders", () => {
    // Load-bearing, not belt-and-braces: with the selector's specificity
    // raised to win outright, the `sm` branch now WINS too, so it has to
    // restate MUI's own values exactly or desktop rendering regresses.
    const container = mount(CodeLanguagePicker, { value: "auto" });
    const select = measuredAt(900, container, ".MuiSelect-select");
    const inputBase = measuredAt(900, container, ".MuiInputBase-root");

    expect(select.minHeight).toBe("1.4375em"); // SelectInput.js:89
    expect(select.display).toBe("block"); // InputBase.js:157
    expect(select.boxSizing).toBe("content-box"); // InputBase.js:150
    expect(select.alignItems).toBe("normal"); // nobody sets it; CSS initial
    // `auto` is min-height's own initial value — the desktop control keeps
    // the mouse-driven height it already had.
    expect(inputBase.minHeight).toBe("auto");
  });
});

describe("CodeLanguagePicker — helper text (§B.5)", () => {
  it("names the explicit-language row verbatim", () => {
    const container = mount(CodeLanguagePicker, { value: "python" });
    expect(helperTextOf(container)).toBe(EXPLICIT_ROW);
  });

  it("names all three precedence sources on the `Auto` row, verbatim", () => {
    // Now asserted by EQUALITY. The plan's earlier three-row table needed a
    // posting the control cannot see; `plan-chunk-c.md:408-417` collapsed it
    // to two rows and pins this one verbatim, so the defect this case used to
    // record is resolved upstream and the scoped assertion no longer buys
    // anything.
    //
    // A leading-substring assertion lets the row be cut back to "Pseudocode
    // unless a specific language is set." — dropping exactly the half that
    // makes the copy honest about what the control does, and leaving a user
    // who set nothing with no idea that their question or the posting can
    // still decide.
    const container = mount(CodeLanguagePicker, { value: "auto" });
    expect(helperTextOf(container)).toBe(AUTO_ROW);
  });
});

describe("CodeLanguagePicker — the storage sentence's precedence (option Z, §0.1 D-6)", () => {
  it("says the SAME sentence the interview-type picker says", () => {
    // Derived, never eyeballed: the exact string lives in exactly one place in
    // the tree (`InterviewTypePicker.js:41`, inside a template literal), and
    // §D-29 forbids opening that file. So it is recovered from what that
    // picker actually RENDERS — healthy versus blocked — and compared against
    // what this one renders. Two controls saying the same thing differently is
    // the visible half of the defect option Z exists to avoid, and the half a
    // precedence rule alone does not close.
    const healthy = helperTextOf(mount(InterviewTypePicker, { value: "technical" }));

    blockKeys(INTERVIEW_TYPE_STORAGE_KEY);
    attemptTypeWrite();
    const blocked = helperTextOf(mount(InterviewTypePicker, { value: "technical" }));

    const derived = blocked.slice(healthy.length).trim();
    // Positive control: the interview-type picker really does append
    // something. Without this the equality below is satisfied by two empty
    // strings.
    expect(derived).not.toBe("");
    expect(derived).toBe(STORAGE_SENTENCE);
  });

  it("appends it when the LANGUAGE store is blocked and the type store is healthy", () => {
    blockKeys(CODE_LANGUAGE_STORAGE_KEY);
    attemptLanguageWrite();

    const container = mount(CodeLanguagePicker, { value: "java" });
    const text = helperTextOf(container);
    // The row COMPOSES with the sentence; it is not replaced by it. A quota
    // failure must not cost the user the explanation of what the control does.
    expect(text).toBe(`${EXPLICIT_ROW} ${STORAGE_SENTENCE}`);
  });

  it("says NOTHING when both stores are blocked — the interview-type picker is already saying it", () => {
    blockKeys(CODE_LANGUAGE_STORAGE_KEY, INTERVIEW_TYPE_STORAGE_KEY);
    attemptLanguageWrite();
    attemptTypeWrite();

    const language = mount(CodeLanguagePicker, { value: "java" });
    const type = mount(InterviewTypePicker, { value: "technical" });

    expect(helperTextOf(language)).not.toContain("blocking stored settings");
    // THE POSITIVE CONTROL. An assertion of absence is satisfied by a dead
    // feature; this is what makes "exactly one sentence per surface" a tested
    // property rather than "this picker never speaks".
    expect(helperTextOf(type)).toContain(STORAGE_SENTENCE);
  });

  it("says nothing when only the TYPE store is blocked", () => {
    blockKeys(INTERVIEW_TYPE_STORAGE_KEY);
    attemptTypeWrite();

    const language = mount(CodeLanguagePicker, { value: "auto" });
    const type = mount(InterviewTypePicker, { value: "technical" });

    expect(helperTextOf(language)).not.toContain("blocking stored settings");
    expect(helperTextOf(type)).toContain(STORAGE_SENTENCE);
  });

  it("says nothing when neither store is blocked", () => {
    const language = mount(CodeLanguagePicker, { value: "auto" });
    const type = mount(InterviewTypePicker, { value: "technical" });
    expect(helperTextOf(language)).not.toContain("blocking stored settings");
    expect(helperTextOf(type)).not.toContain("blocking stored settings");
  });

  it("reads BOTH stores' flags for itself — render-time precedence, no state of its own", () => {
    // §0.1 D-6's table: what makes this NOT the two-latch shape CONF-8 fears
    // is that there is no shared mutable fact to drift and nothing for one
    // side to consume and discard. Two primitive `useSyncExternalStore` reads,
    // decided every render.
    //
    // A later reader who sees "two components both look at storage" and
    // reaches to unify it into a single stateful owner would be reintroducing
    // exactly the shape that produced three seam defects in chunk A.
    const src = readSource("./CodeLanguagePicker.js");
    expect(src).toMatch(/useCodeLanguageStorageBlocked/);
    expect(src).toMatch(/useInterviewTypeStorageBlocked/);
    expect(src).not.toMatch(/\buseState\b/);
    expect(src).not.toMatch(/\buseRef\b/);
  });
});
