// The duplicate-application flag's CSS block (3-plan-dupapply.md §2.6 / Wave
// 3A; craft rulings in 1e-aesthetics-dupapply.md §9.3) is a source-text
// artifact, not a computable one: vitest.config.js sets no `css` option, so
// Vitest's `css: false` default applies NO CSS-module style at all in jsdom
// -- getComputedStyle on a CSS-module class returns the browser defaults
// (measured by the 1e pass: backgroundColor "rgba(0,0,0,0)", position
// "static", colour "rgb(0,0,0)"), and `styles.dupFlagX` from the CSS-module
// import proxy is a SELF-SATISFYING string that exists whether or not the
// class is ever declared. Neither is an honest instrument here. This file
// therefore reads app/page.module.css as text (same idiom as
// app/copilot/answerLineContrast.test.js) and checks the two things that
// live only at the source level: (1) contrast math on the literal colours
// the block declares, and (2) the zero-motion / zero-var(--) / correct-
// selector-set properties 1e's ruling requires.
//
// Every ratio below is asserted against BOTH a WCAG floor (so a future
// colour change that keeps the pair passing is not flagged) and the exact
// literal 1e adopted (so a change that swaps in a DIFFERENT passing colour
// -- silently deviating from the "verbatim, unchanged" ruling -- is still
// caught). Either assertion alone would miss one of those two mutations.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(path.join(process.cwd(), "app/page.module.css"), "utf8");

// ---------------------------------------------------------------------------
// Contrast maths -- WCAG relative luminance / ratio, opaque hex only (every
// colour this block declares is a solid #rrggbb; no alpha compositing is
// needed here, unlike dup-contrast.mjs's dock/theme survey). Same 0.03928
// linearisation threshold as the existing repo precedent
// (app/copilot/answerLineContrast.test.js), so a reviewer comparing the two
// files sees the same formula.
// ---------------------------------------------------------------------------
function channels(hex) {
  const h = String(hex).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255);
}
function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_FLOOR = 4.5; // WCAG 1.4.3 -- nothing in this notice is "large text"
const NONTEXT_FLOOR = 3.0; // WCAG 1.4.11 -- glyphs, borders, focus rings

// ---------------------------------------------------------------------------
// Source readers. `declAfter` locates a literal marker (a selector or the
// start of a compound-selector's shared declaration block) and pulls one
// property's value out of the FIRST `{ ... }` block that follows it -- exact
// mirror of scratchpad/dup-contrast.mjs's own `cssDecl` method (read the
// declaration out of source, never hand-type a colour into the test).
// ---------------------------------------------------------------------------
function declAfter(marker, prop) {
  const i = CSS.indexOf(marker);
  if (i < 0) throw new Error(`marker not found in app/page.module.css: ${JSON.stringify(marker)}`);
  const braceOpen = CSS.indexOf("{", i);
  const braceClose = CSS.indexOf("}", braceOpen);
  if (braceOpen < 0 || braceClose < 0) throw new Error(`no block found after marker: ${JSON.stringify(marker)}`);
  const block = CSS.slice(braceOpen, braceClose);
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`, "i");
  const m = re.exec(block);
  if (!m) throw new Error(`property "${prop}" not found in block after ${JSON.stringify(marker)}: ${block}`);
  return m[1].trim();
}

function lastToken(decl) {
  return decl.trim().split(/\s+/).pop();
}

describe("app/page.module.css — duplicate-application flag block exists with the required selectors", () => {
  it("declares every class and attribute selector the DOM sketch depends on", () => {
    for (const marker of [
      ".dupFlag {",
      ".dupFlagSignal {",
      ".dupFlagGlyph {",
      ".dupFlagKicker {",
      ".dupFlagSentence {",
      ".dupFlagEvidence {",
      ".dupFlagRow ",
      ".dupFlagRowMain {",
      ".dupFlagRowMeta {",
      ".dupFlagActions {",
      ".dupFlagQueue",
      ".dupFlagAction {",
      ".dupFlagActionQuiet {",
      '[data-dupe-severity="hit"]',
      '[data-dupe-severity="indeterminate"]',
      '[data-dupe-severity="unavailable"]',
      ".dupFlagAction:focus-visible {",
    ]) {
      expect(CSS.includes(marker), `missing selector/marker: ${marker}`).toBe(true);
    }
  });

  it("carries a mobile tap-target rule (MOBILE_TAP_MIN = 44) for the notice's controls, distinct from useIsMobile()'s 600px breakpoint", () => {
    // 640px is the DOCK's own existing breakpoint (the shipped
    // `@media (max-width: 640px)` block a few lines below this one), not the
    // 600px useIsMobile() uses elsewhere in this same file -- 1e's ruling is
    // consistency WITHIN the dock block, not a repo-wide breakpoint change.
    const mobileBlockStart = CSS.indexOf("@media (max-width: 640px)", CSS.indexOf(".dupFlagAction {"));
    expect(mobileBlockStart).toBeGreaterThan(-1);
    const mobileBlockEnd = CSS.indexOf("}", CSS.indexOf("{", mobileBlockStart));
    const mobileBlock = CSS.slice(mobileBlockStart, mobileBlockEnd);
    expect(mobileBlock).toContain(".dupFlagAction");
    expect(mobileBlock).toMatch(/min-height:\s*44px/);
  });

  it("keeps the notice's controls clear of the FAB above 640px", () => {
    const desktopBlockStart = CSS.indexOf("@media (min-width: 641px)");
    expect(desktopBlockStart).toBeGreaterThan(-1);
    const desktopBlockEnd = CSS.indexOf("}", CSS.indexOf("{", desktopBlockStart));
    const desktopBlock = CSS.slice(desktopBlockStart, desktopBlockEnd);
    expect(desktopBlock).toContain(".dupFlagActions");
    expect(desktopBlock).toMatch(/padding-right:\s*100px/);
  });
});

describe("app/page.module.css — the flag block introduces NO motion and NO theming", () => {
  // Scoped to the flag's OWN block, not the whole file: the file's pre-
  // existing chip/arrow rules already carry `transition` (V-6.1 census: 10
  // pre-existing transitions in this file, 4 in the dock) and that is not
  // this feature's to remove. Only the NEW block is asserted motion-free.
  function ownBlock() {
    const start = CSS.indexOf(".dupFlag {");
    expect(start, "the .dupFlag block was not found at all").toBeGreaterThan(-1);
    // The block runs to the end of the file's dock section appendix -- take
    // everything from .dupFlag { to the end of the last @media rule this
    // feature owns (.dupFlagActions padding-right), or EOF if that marker is
    // missing (keeps this readable as a failure rather than throwing).
    const tailMarker = CSS.indexOf("padding-right: 100px", start);
    const end = tailMarker > -1 ? CSS.indexOf("}", CSS.indexOf("}", tailMarker) + 1) : CSS.length;
    return CSS.slice(start, end + 1);
  }

  it("has zero transition, animation, @keyframes and box-shadow declarations (V-6.2 ruling: no motion, no reduced-motion problem to honour)", () => {
    const block = ownBlock();
    expect(block).not.toMatch(/\btransition\s*:/);
    expect(block).not.toMatch(/\banimation\s*:/);
    expect(block).not.toMatch(/@keyframes/);
    expect(block).not.toMatch(/box-shadow\s*:/);
  });

  it("has zero var(--…) tokens (the dock is a closed, theme-independent palette -- 1e X-6)", () => {
    const block = ownBlock();
    expect(block).not.toMatch(/var\(--/);
  });

  it("introduces no new border-radius or opacity-dimmed state (reuses .toolbarClear's 7px; V-2.4's ruling against a tint/well/dim)", () => {
    const block = ownBlock();
    const radii = [...block.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const r of radii) expect(r).toBe("7px");
    expect(block).not.toMatch(/opacity\s*:/);
  });
});

describe("app/page.module.css — severity is legible WITHOUT colour (four independent channels)", () => {
  it("channel 1 (shape): distinct glyph colour rules exist per severity, keyed to the DOM's data-dupe-severity attribute, not to a class name alone", () => {
    // The colour itself is re-verified in the contrast suite below; this
    // case is about the SELECTOR shape -- severity must be expressed as an
    // attribute selector a screen-reader-independent, colour-independent
    // instrument (data-dupe-severity) can key off, not a bare class that
    // conflates "is a signal line" with "is a hit".
    expect(CSS).toMatch(/\[data-dupe-severity="hit"\]\s*\.dupFlagKicker,?\s*\n?\[data-dupe-severity="hit"\]\s*\.dupFlagGlyph/);
    expect(CSS).toMatch(/\[data-dupe-severity="indeterminate"\]\s*\.dupFlagKicker/);
    expect(CSS).toMatch(/\[data-dupe-severity="unavailable"\]\s*\.dupFlagKicker/);
  });

  it("channel 2 (weight): the hit sentence is bold (600); the base sentence and indeterminate/unavailable share the base weight (no severity rule overrides it)", () => {
    expect(declAfter(".dupFlagSentence {", "font-size")).toBe("0.82rem");
    const hitWeight = declAfter('[data-dupe-severity="hit"] .dupFlagSentence', "font-weight");
    expect(hitWeight).toBe("600");
    // No indeterminate/unavailable override exists for the sentence weight --
    // confirmed by there being exactly ONE `.dupFlagSentence` weight
    // override in the whole file (the hit rule above).
    const weightOverrides = (CSS.match(/\.dupFlagSentence\s*\{[^}]*font-weight/g) || []).length
      + (CSS.match(/\.dupFlagSentence\s*\{[^}]*\}[^{]*font-weight[^{]*\.dupFlagSentence/g) || []).length;
    const sentenceWeightRules = [...CSS.matchAll(/\.dupFlagSentence[^{]*\{[^}]*font-weight\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(sentenceWeightRules).toEqual(["600"]);
  });

  it("channel 3 (kicker word / weight): the kicker is always bold, uppercase, letter-spaced -- the word itself is the presentation module's copy, not this file's", () => {
    expect(declAfter(".dupFlagKicker {", "font-weight")).toBe("700");
    expect(declAfter(".dupFlagKicker {", "text-transform")).toBe("uppercase");
  });

  it("channel 4 (order): `.dupFlag` never reorders its own signal children by severity in CSS -- DOM order is the ordering channel, owned by verdictPresentation.js's signalRank, not by a CSS `order` override on `.dupFlagSignal`", () => {
    // Guard FIRST: a missing selector must fail this case, not vacuously
    // pass it. `CSS.indexOf(...)` returning -1 fed straight into `.slice()`
    // silently produces a nonsense (or empty) substring that trivially
    // satisfies `not.toMatch` below -- caught during this file's own RED-run
    // review, before implementation.
    const start = CSS.indexOf(".dupFlagSignal {");
    expect(start, "the .dupFlagSignal block was not found at all").toBeGreaterThan(-1);
    const end = CSS.indexOf("}", start);
    const block = CSS.slice(start, end);
    expect(block).not.toMatch(/\border\s*:/);
  });
});

describe("app/page.module.css — contrast on the dock ground (#1c2333), measured from source", () => {
  const DOCK = declAfter(".floatingToolbar {", "background");

  it("reads the dock ground as the literal 1e measured against", () => {
    expect(DOCK).toBe("#1c2333");
  });

  it("F1 kicker HIT colour clears the TEXT floor and is the exact adopted literal (#fde68a, ~12.61:1)", () => {
    const c = declAfter('[data-dupe-severity="hit"] .dupFlagKicker,', "color");
    expect(c).toBe("#fde68a");
    expect(contrast(c, DOCK)).toBeGreaterThanOrEqual(TEXT_FLOOR);
    expect(contrast(c, DOCK)).toBeCloseTo(12.61, 1);
  });

  it("F2 kicker INDETERMINATE/UNAVAILABLE colour clears the TEXT floor and is the exact adopted literal (#7a8faf, ~4.77:1)", () => {
    const c = declAfter('[data-dupe-severity="indeterminate"] .dupFlagKicker,', "color");
    expect(c).toBe("#7a8faf");
    expect(contrast(c, DOCK)).toBeGreaterThanOrEqual(TEXT_FLOOR);
    expect(contrast(c, DOCK)).toBeCloseTo(4.77, 1);
  });

  it("F3 sentence colour clears the TEXT floor (#c0d0ee, ~10.09:1)", () => {
    const c = declAfter(".dupFlagSentence {", "color");
    expect(c).toBe("#c0d0ee");
    expect(contrast(c, DOCK)).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  it("F4/F5 evidence row primary and meta colours clear the TEXT floor", () => {
    const main = declAfter(".dupFlagRowMain {", "color");
    const meta = declAfter(".dupFlagRowMeta {", "color");
    expect(main).toBe("#c0d0ee");
    expect(meta).toBe("#7a8faf");
    expect(contrast(main, DOCK)).toBeGreaterThanOrEqual(TEXT_FLOOR);
    expect(contrast(meta, DOCK)).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  it("F9 control border clears the NON-TEXT floor and is explicitly #7a8faf, NOT .toolbarClear's #2e3a4e (which measures 1.37:1 on this ground)", () => {
    const border = lastToken(declAfter(".dupFlagAction {", "border"));
    expect(border).toBe("#7a8faf");
    expect(contrast(border, DOCK)).toBeGreaterThanOrEqual(NONTEXT_FLOOR);
    const clearBorder = lastToken(declAfter(".toolbarClear {", "border"));
    expect(contrast(clearBorder, DOCK)).toBeLessThan(NONTEXT_FLOOR);
  });

  it("F10/F11 control label colours clear the TEXT floor", () => {
    const navigate = declAfter(".dupFlagAction {", "color");
    const dismiss = declAfter(".dupFlagActionQuiet {", "color");
    expect(navigate).toBe("#c0d0ee");
    expect(dismiss).toBe("#7a8faf");
    expect(contrast(navigate, DOCK)).toBeGreaterThanOrEqual(TEXT_FLOOR);
    expect(contrast(dismiss, DOCK)).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });

  it("F12 the hover rule changes BOTH background and colour (a background-only hover leaves #7a8faf on #243049 at 4.00:1, below the 4.5 floor -- F12x, rejected)", () => {
    const hoverStart = CSS.indexOf(".dupFlagAction:hover");
    expect(hoverStart).toBeGreaterThan(-1);
    const hoverEnd = CSS.indexOf("}", hoverStart);
    const hoverBlock = CSS.slice(hoverStart, hoverEnd);
    const bg = /background\s*:\s*([^;]+);/.exec(hoverBlock)?.[1]?.trim();
    const color = /color\s*:\s*([^;]+);/.exec(hoverBlock)?.[1]?.trim();
    expect(bg).toBe("#243049");
    expect(color).toBe("#c0d0ee");
    expect(contrast(color, bg)).toBeGreaterThanOrEqual(TEXT_FLOOR);
    // The rejected alternative, pinned as a regression guard: kept CONSTANT
    // (never changed) the dismiss/meta colour over the hover fill measures
    // BELOW floor -- if this ever measured >= 4.5 the F12x rejection
    // reasoning (recorded in 1e-aesthetics-dupapply.md §5.2) would need
    // re-litigating, so the boundary is asserted, not assumed.
    const dismissColor = declAfter(".dupFlagActionQuiet {", "color");
    expect(contrast(dismissColor, bg)).toBeLessThan(TEXT_FLOOR);
  });

  it("F14/F15 the focus ring is #c0d0ee and clears the NON-TEXT floor on both the dock and the control's own hover fill", () => {
    const focusStart = CSS.indexOf(".dupFlagAction:focus-visible");
    const focusEnd = CSS.indexOf("}", focusStart);
    const focusBlock = CSS.slice(focusStart, focusEnd);
    const outline = /outline\s*:\s*([^;]+);/.exec(focusBlock)?.[1]?.trim();
    expect(outline).toMatch(/^2px solid #c0d0ee$/);
    const ring = lastToken(outline);
    expect(contrast(ring, DOCK)).toBeGreaterThanOrEqual(NONTEXT_FLOOR);
    expect(contrast(ring, "#243049")).toBeGreaterThanOrEqual(NONTEXT_FLOOR);
  });

  it("the border/separator colour #7a8faf is the only line colour in this palette that clears 3:1 on the dock -- the two obvious chip-border reuses both fail", () => {
    // Regression guard for the rejected alternatives 1e measured (§5.2):
    // reusing .toolbarChip's own border (#354d6e) or its hover border
    // (#4a6488) both fail 3:1 on the dock. If one of these ever measured
    // >= 3.0 the "only" claim in this feature's own CSS comment would be
    // false and the comment would need updating.
    const chipBorder = lastToken(declAfter(".toolbarChip {", "border"));
    const chipHoverBorder = declAfter(".toolbarChip:hover {", "border-color");
    expect(contrast(chipBorder, DOCK)).toBeLessThan(NONTEXT_FLOOR);
    expect(contrast(chipHoverBorder, DOCK)).toBeLessThan(NONTEXT_FLOOR);
    expect(contrast("#7a8faf", DOCK)).toBeGreaterThanOrEqual(NONTEXT_FLOOR);
  });
});
