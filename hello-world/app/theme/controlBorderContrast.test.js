// @vitest-environment jsdom
//
// WCAG 2.2 SC 1.4.11 (Non-text Contrast) for the borders of MUI's default
// controls. A control's boundary is what tells a user it IS a control, so it
// needs 3:1 against its background.
//
// WHY THIS FILE RENDERS INSTEAD OF READING CONSTANTS
// -------------------------------------------------
// The obvious test -- "assert tokens.light['border-control'] is #738ca5" --
// guards a spelling, not a contrast. This file instead mounts the real MUI
// control under the real theme and reads the colour the jsdom cascade actually
// produces, then measures THAT. There is consequently no expected colour
// anywhere below: the only numbers are 3.0 (the WCAG threshold) and 21 (the
// self-check on the maths). A future palette change that quietly drops a
// border under 3:1 fails here no matter which token or literal caused it.
//
// TWO MEASURED jsdom FACTS THIS FILE DEPENDS ON (both verified before it was
// written, both load-bearing):
//   1. `getComputedStyle(fieldset).borderTopColor` DOES resolve through jsdom
//      29's real cascade over emotion's injected <style> tags -- it returns
//      MUI's own `rgba(0, 0, 0, 0.23)` for an unstyled OutlinedInput.
//   2. `getComputedStyle(button).borderColor` does NOT: MUI declares it as
//      `var(--variant-outlinedBorder, currentColor)` and jsdom never resolves
//      `var()`, reporting a useless `rgb(0, 0, 0)`. But
//      `getComputedStyle(button).getPropertyValue('--variant-outlinedBorder')`
//      DOES return the declared value. So the button is measured through the
//      custom property that feeds its border, not through `borderColor`.
//   3. ToggleButton and Chip are on the FIRST side of that split, measured
//      again before the ToggleButton/Chip block below was written: MUI writes
//      both as plain declarations (`border: 1px solid <literal>`), no `var()`
//      indirection, and `getComputedStyle(el).borderTopColor` returns the real
//      colour. `--variant-outlinedBorder` is the empty string on both. Because
//      that could silently change under a future MUI, the "really being
//      measured" describe below re-proves it on every run rather than trusting
//      this comment.
//
// WHAT THIS FILE ESTABLISHES
//   * For the RESTING state of every outlined <Button> colour the app actually
//     renders, and of the outlined input used by TextField/Select/Autocomplete,
//     the border colour MUI produces clears 3:1 against both stops of the
//     `.main` gradient, in both colour modes -- four grounds in total.
//   * That the app's own `sx` overrides, which sit at a higher specificity than
//     the theme and would otherwise silently escape it, clear 3:1 too.
//   * The same, for a ToggleButton (resting, selected, and first-in-group) and
//     for every colour of INTERACTIVE outlined Chip the app actually renders.
//   * That the premise of the outlined-Paper exemption below still holds: no
//     `<Paper variant="outlined">` in the app is a control.
//
// WHERE THE `divider` LINE WAS AND WAS NOT DRAWN
//   SC 1.4.11 governs "user interface components", and exempts pure decoration.
//   A <Divider> hairline and a container's outline are decoration; a toggle's
//   border and a deletable chip's border are the only thing that says "this is
//   a control". So `palette.divider` was deliberately LEFT at `--border`
//   (1.28:1) -- raising it would darken all 16 <Divider>s, the 10 dialogs using
//   `<DialogContent dividers>` and the 4 `borderColor: "divider"` sx sites for
//   no accessibility gain -- and the CONTROLS were pointed at `--border-control`
//   instead, in the theme, per component:
//     * ToggleButton  -> a control in every one of its 13 uses. Fixed.
//     * outlined Chip -> a control ONLY when clickable or deletable, and MUI
//       marks exactly those with `.MuiChip-clickable` / `.MuiChip-deletable`,
//       so the fix is scoped to them. A static outlined Chip is a label, not a
//       control, and keeps MUI's own grey. (Its border is NOT `divider`: MUI 9
//       draws it from `grey[400]`/`grey[700]`, measured at 1.76:1 / 2.44:1.)
//     * outlined Paper -> a container, not a control; the app's single use is
//       a read-only queue-detail panel. EXEMPT, and left at 1.28:1. The
//       exemption rests on it not being interactive, which is what the last
//       describe in this file checks.
//
// WHAT IT DOES NOT ESTABLISH
//   * Nothing about hover, focus, error or disabled borders. Those are separate
//     MUI rules at a higher specificity; they were left untouched, and a
//     :hover cascade cannot be driven from jsdom anyway.
//   * Nothing about a COLOURED interactive outlined Chip. There is none in the
//     app today, and the colours measured below are derived from source rather
//     than listed -- so the day someone adds `color="warning"` to a deletable
//     chip, it starts being measured here and fails (2.73:1 in light) instead
//     of being quietly restyled. The theme's Chip fix is scoped to
//     `.MuiChip-colorDefault` for exactly that reason.
//   * Nothing about a real browser's rendering. jsdom's cascade is a stand-in;
//     the `var()` gap in fact 2 above is a known divergence from one.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { tokens, MODES } from "./tokens.js";
import { makeTheme } from "./index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Deliberately NOT `new URL("../", import.meta.url)`: under
// `@vitest-environment jsdom` the global `URL` is jsdom's class, which
// `fileURLToPath` rejects. Same fix as themeSystem.test.js:28-34.
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const WCAG_NON_TEXT_MINIMUM = 3;

// --------------------------------------------------------------------------
// Colour maths. sRGB relative luminance per WCAG 2.2, and simple-alpha
// compositing of a translucent border over an opaque ground.
// --------------------------------------------------------------------------

function parseColor(value) {
  const css = String(value).trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css);
  if (hexMatch) {
    const h = hexMatch[1];
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return {
      rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)),
      alpha: 1,
    };
  }
  const fnMatch = /^rgba?\(([^)]+)\)$/i.exec(css);
  if (fnMatch) {
    const parts = fnMatch[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        rgb: parts.slice(0, 3),
        alpha: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1,
      };
    }
  }
  throw new Error(`cannot parse colour: ${JSON.stringify(value)}`);
}

function composite(color, groundHex) {
  const { rgb, alpha } = parseColor(color);
  const ground = parseColor(groundHex).rgb;
  return rgb.map((channel, i) => channel * alpha + ground[i] * (1 - alpha));
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(rgbA, rgbB) {
  const a = relativeLuminance(rgbA);
  const b = relativeLuminance(rgbB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Contrast of a (possibly translucent) border colour against an opaque ground.
function contrastOnGround(color, groundHex) {
  return contrast(composite(color, groundHex), parseColor(groundHex).rgb);
}

// --------------------------------------------------------------------------
// The grounds -- read out of page.module.css rather than assumed.
//
// `.main` is a gradient between two token stops, so a control sits on a RANGE
// of colours, not one. Relative luminance is monotonic along a linear sRGB
// gradient (every channel interpolates linearly and luminance increases with
// every channel), so the two endpoints bound the whole range: clearing 3:1 at
// both stops clears it everywhere between them.
// --------------------------------------------------------------------------

function gradientStopTokens() {
  const css = readFileSync(join(APP_DIR, "page.module.css"), "utf8");
  const main = /\.main\s*\{([^}]*)\}/.exec(css);
  if (!main) throw new Error("could not find `.main` in page.module.css");
  const background = /background:\s*linear-gradient\(([^;]*)\);/.exec(main[1]);
  if (!background) throw new Error("`.main` no longer uses a linear-gradient background");
  const names = [...background[1].matchAll(/var\(\s*--([a-z0-9-]+)\s*\)/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error("`.main` gradient references no tokens");
  return names;
}

const GROUND_TOKENS = gradientStopTokens();
const groundsFor = (mode) => GROUND_TOKENS.map((name) => ({ name, hex: tokens[mode][name] }));

// --------------------------------------------------------------------------
// Rendering helpers.
// --------------------------------------------------------------------------

async function renderUnderTheme(mode, element) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(ThemeProvider, { theme: makeTheme(mode) }, element));
  });
  return {
    host,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

// --------------------------------------------------------------------------
// Which outlined-Button colours does the app actually render? Derived from
// source so the guard cannot go stale: introduce `color="warning"` on an
// outlined Button and this file starts measuring warning too.
// --------------------------------------------------------------------------

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && !entry.name.includes(".test.")) out.push(full);
    }
  })(APP_DIR);
  return out;
}

// Slice out the props of every `<Name ...>` opening tag, brace-aware so a
// `sx={{ ... }}` containing a `>` does not end the tag early.
function openingTags(source, name) {
  const tags = [];
  const re = new RegExp(`<${name}[\\s/>]`, "g");
  let match;
  while ((match = re.exec(source))) {
    let i = match.index + name.length + 1;
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
      i += 1;
    }
    tags.push({
      props: source.slice(match.index, i),
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return tags;
}

function outlinedButtonTags() {
  const tags = [];
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const tag of openingTags(source, "Button")) {
      if (!/variant\s*=\s*"outlined"/.test(tag.props)) continue;
      tags.push({
        file: file.slice(APP_DIR.length + 1).replace(/\\/g, "/"),
        line: tag.line,
        // MUI's default when `color` is omitted.
        color: (/color\s*=\s*"(\w+)"/.exec(tag.props) || [, "primary"])[1],
        // A literal `borderColor: "var(--token)"` in the tag's own `sx`.
        localBorderToken: (/borderColor:\s*"var\(--([a-z0-9-]+)\)"/.exec(tag.props) || [])[1],
      });
    }
  }
  return tags;
}

const OUTLINED_BUTTON_TAGS = outlinedButtonTags();
// `color="inherit"` borders with `currentColor` -- the text colour, which is
// governed by text contrast (SC 1.4.3), not by this rule.
const OUTLINED_BUTTON_COLORS = [
  ...new Set(OUTLINED_BUTTON_TAGS.map((t) => t.color).filter((c) => c !== "inherit")),
].sort();

// ==========================================================================

describe("contrast maths (self-check)", () => {
  it("agrees with the two ratios WCAG fixes by definition", () => {
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });

  it("composites a translucent colour over its ground before measuring", () => {
    // 50% black on white is #808080-ish, nowhere near black's 21:1.
    expect(contrastOnGround("rgba(0, 0, 0, 0.5)", "#ffffff")).toBeLessThan(21);
    expect(contrastOnGround("rgba(0, 0, 0, 1)", "#ffffff")).toBeCloseTo(21, 5);
  });
});

describe("the grounds are the app's real ones", () => {
  it("takes both stops of the `.main` gradient from page.module.css", () => {
    expect(GROUND_TOKENS.length).toBeGreaterThanOrEqual(2);
    for (const name of GROUND_TOKENS) {
      for (const mode of MODES) {
        expect(tokens[mode][name], `--${name} missing from ${mode} tokens`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe("SC 1.4.11 — outlined input border (TextField / Select / Autocomplete)", () => {
  for (const mode of MODES) {
    for (const ground of groundsFor(mode)) {
      it(`clears 3:1 in ${mode} on --${ground.name}`, async () => {
        const { host, cleanup } = await renderUnderTheme(
          mode,
          createElement(TextField, { label: "Ground truth" })
        );
        try {
          const fieldset = host.querySelector("fieldset");
          expect(fieldset, "OutlinedInput rendered no notched outline").toBeTruthy();
          const rendered = getComputedStyle(fieldset).borderTopColor;
          const ratio = contrastOnGround(rendered, ground.hex);
          expect(
            ratio,
            `outlined input border ${rendered} on --${ground.name} ${ground.hex} = ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(WCAG_NON_TEXT_MINIMUM);
        } finally {
          cleanup();
        }
      });
    }
  }
});

describe("SC 1.4.11 — outlined Button border", () => {
  it("found outlined buttons to measure", () => {
    expect(OUTLINED_BUTTON_TAGS.length).toBeGreaterThan(0);
    expect(OUTLINED_BUTTON_COLORS.length).toBeGreaterThan(0);
  });

  for (const mode of MODES) {
    for (const color of OUTLINED_BUTTON_COLORS) {
      for (const ground of groundsFor(mode)) {
        it(`clears 3:1 for color="${color}" in ${mode} on --${ground.name}`, async () => {
          const { host, cleanup } = await renderUnderTheme(
            mode,
            createElement(Button, { variant: "outlined", color }, "Ground truth")
          );
          try {
            const button = host.querySelector("button");
            expect(button, "no button rendered").toBeTruthy();
            // Read the custom property, not `borderColor`: MUI declares the
            // border as `var(--variant-outlinedBorder, currentColor)` and jsdom
            // does not resolve `var()`.
            const rendered = getComputedStyle(button)
              .getPropertyValue("--variant-outlinedBorder")
              .trim();
            expect(rendered, "--variant-outlinedBorder was not declared").not.toBe("");
            const ratio = contrastOnGround(rendered, ground.hex);
            expect(
              ratio,
              `outlined ${color} button border ${rendered} on --${ground.name} ${ground.hex} = ${ratio.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(WCAG_NON_TEXT_MINIMUM);
          } finally {
            cleanup();
          }
        });
      }
    }
  }
});

describe("SC 1.4.11 — `sx` overrides that outrank the theme", () => {
  // An `sx` borderColor on the element itself beats anything the theme sets for
  // that slot, so these sites do not inherit the theme fix and have to be
  // measured on their own.
  const overrides = OUTLINED_BUTTON_TAGS.filter((t) => t.localBorderToken);

  it("found the local overrides", () => {
    expect(overrides.length).toBeGreaterThan(0);
  });

  for (const mode of MODES) {
    it(`every locally pinned outlined-button border clears 3:1 in ${mode}`, () => {
      const failures = [];
      for (const tag of overrides) {
        const hex = tokens[mode][tag.localBorderToken];
        if (!hex) {
          failures.push(`${tag.file}:${tag.line} pins undefined token --${tag.localBorderToken}`);
          continue;
        }
        for (const ground of groundsFor(mode)) {
          const ratio = contrastOnGround(hex, ground.hex);
          if (ratio < WCAG_NON_TEXT_MINIMUM) {
            failures.push(
              `${tag.file}:${tag.line} --${tag.localBorderToken} ${hex} on --${ground.name} ${ground.hex} = ${ratio.toFixed(2)}:1`
            );
          }
        }
      }
      expect(failures, `outlined-button borders below 3:1 in ${mode}:\n${failures.join("\n")}`).toEqual([]);
    });
  }
});

// ==========================================================================
// ToggleButton and Chip: the controls MUI draws from a LINE colour rather than
// from their own palette colour.
// ==========================================================================

// Read the top border specifically, not the `borderColor` shorthand. A
// ToggleButton inside a horizontal ToggleButtonGroup has its LEFT border set
// to `transparent` on purpose (the previous button's right border serves as
// the seam), so `borderColor` comes back as a four-value string with a
// meaningless component in it. The top edge always carries the control's real
// boundary colour. Same channel the OutlinedInput above is measured through.
async function measureBorderTopColor(mode, surface) {
  const { host, cleanup } = await renderUnderTheme(mode, surface.element());
  try {
    const node = host.querySelector(surface.selector);
    expect(node, `${surface.name}: nothing matched ${surface.selector}`).toBeTruthy();
    return getComputedStyle(node).borderTopColor;
  } finally {
    cleanup();
  }
}

// --------------------------------------------------------------------------
// Which Chips does the app actually render, and which of them are CONTROLS?
//
// Derived from source for the same reason the outlined-Button colours are: a
// listed set goes stale silently. `onDelete`/`onClick`/`clickable` are what
// make MUI render a Chip as a ButtonBase and stamp it `.MuiChip-clickable` /
// `.MuiChip-deletable`; Autocomplete's `getTagProps` spread supplies an
// `onDelete`, so it counts too. The predicate errs toward calling a chip
// interactive -- a false positive only adds a surface to measure.
// --------------------------------------------------------------------------

const CHIP_INTERACTIVE = /onDelete\s*=|onClick\s*=|getTagProps|\bclickable\b/;

function chipTagsIn(source, file) {
  return openingTags(source, "Chip").map((tag) => ({
    file,
    line: tag.line,
    variant: (/variant\s*=\s*"(\w+)"/.exec(tag.props) || [, "filled"])[1],
    // MUI's default when `color` is omitted.
    color: (/color\s*=\s*"(\w+)"/.exec(tag.props) || [, "default"])[1],
    // `color={expr}` — a colour decided at runtime, which no static read can
    // resolve to something renderable here.
    dynamicColor: /color\s*=\s*\{/.test(tag.props),
    interactive: CHIP_INTERACTIVE.test(tag.props),
  }));
}

function chipTags() {
  const out = [];
  for (const file of sourceFiles()) {
    out.push(
      ...chipTagsIn(readFileSync(file, "utf8"), file.slice(APP_DIR.length + 1).replace(/\\/g, "/"))
    );
  }
  return out;
}

const INTERACTIVE_OUTLINED_CHIPS = chipTags().filter((t) => t.variant === "outlined" && t.interactive);
const INTERACTIVE_OUTLINED_CHIP_COLORS = [
  ...new Set(INTERACTIVE_OUTLINED_CHIPS.filter((t) => !t.dynamicColor).map((t) => t.color)),
].sort();

const noop = () => {};

// Every control surface measured below. A ToggleButton is measured standalone
// AND as the first button of a horizontal group, because the group's own
// stylesheet targets its children at a HIGHER specificity than the theme's
// component override and could swallow the fix without the standalone case
// noticing.
const CONTROL_SURFACES = [
  {
    name: "ToggleButton (resting)",
    selector: "button",
    element: () => createElement(ToggleButton, { value: "measured" }, "Ground truth"),
  },
  {
    name: "ToggleButton (selected)",
    selector: "button",
    element: () => createElement(ToggleButton, { value: "measured", selected: true }, "Ground truth"),
  },
  {
    name: "ToggleButton (first in a horizontal group)",
    selector: ".MuiToggleButtonGroup-firstButton",
    element: () =>
      createElement(
        ToggleButtonGroup,
        { value: "measured", exclusive: true },
        createElement(ToggleButton, { value: "measured" }, "Ground truth"),
        createElement(ToggleButton, { value: "other" }, "Other")
      ),
  },
  ...INTERACTIVE_OUTLINED_CHIP_COLORS.flatMap((color) => [
    {
      name: `outlined Chip color="${color}" (deletable)`,
      selector: ".MuiChip-root",
      element: () =>
        createElement(Chip, { variant: "outlined", color, label: "Ground truth", onDelete: noop }),
    },
    {
      name: `outlined Chip color="${color}" (clickable)`,
      selector: ".MuiChip-root",
      element: () =>
        createElement(Chip, { variant: "outlined", color, label: "Ground truth", onClick: noop }),
    },
  ]),
];

describe("the Chip enumeration reads real tags", () => {
  it("pulls variant, colour and interactivity out of an opening tag", () => {
    const source = [
      `<Chip variant="outlined" label="a" onDelete={fn} />`,
      `<Chip label="b" />`,
      `<Chip variant="outlined" color="success" sx={{ w: x > y }} label="c" />`,
      `<Chip variant="outlined" color={dynamic} label="d" onClick={fn} />`,
      `<ChipsInput label="not a Chip" />`,
    ].join("\n");
    expect(
      chipTagsIn(source, "synthetic.js").map((t) => [t.variant, t.color, t.dynamicColor, t.interactive])
    ).toEqual([
      ["outlined", "default", false, true],
      ["filled", "default", false, false],
      ["outlined", "success", false, false],
      ["outlined", "default", true, true],
    ]);
  });

  it("found interactive outlined chips in the app to measure", () => {
    expect(INTERACTIVE_OUTLINED_CHIPS.length).toBeGreaterThan(0);
    expect(INTERACTIVE_OUTLINED_CHIP_COLORS.length).toBeGreaterThan(0);
  });

  it("has no interactive outlined chip whose colour is decided at runtime", () => {
    // Such a chip cannot be rendered here at the colour it will really have,
    // so it would escape the measurement entirely. Give it a literal `color=`
    // (or split the branches) so this file can see it.
    const dynamic = INTERACTIVE_OUTLINED_CHIPS.filter((t) => t.dynamicColor).map(
      (t) => `${t.file}:${t.line}`
    );
    expect(dynamic, `unmeasurable interactive outlined chips:\n${dynamic.join("\n")}`).toEqual([]);
  });
});

describe("SC 1.4.11 — ToggleButton and interactive outlined Chip borders", () => {
  it("has surfaces to measure", () => {
    expect(CONTROL_SURFACES.length).toBeGreaterThanOrEqual(5);
  });

  for (const surface of CONTROL_SURFACES) {
    for (const mode of MODES) {
      for (const ground of groundsFor(mode)) {
        it(`${surface.name} clears 3:1 in ${mode} on --${ground.name}`, async () => {
          const rendered = await measureBorderTopColor(mode, surface);
          const ratio = contrastOnGround(rendered, ground.hex);
          expect(
            ratio,
            `${surface.name} border ${rendered} on --${ground.name} ${ground.hex} = ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(WCAG_NON_TEXT_MINIMUM);
        });
      }
    }
  }
});

describe("the borders above are really being measured", () => {
  // The failure mode this guards is the one documented at the top of the file:
  // if MUI moves either component behind `var(--something)`, jsdom stops
  // resolving it and `borderTopColor` collapses to a constant `rgb(0, 0, 0)`
  // — which would sail through the light-mode assertions above at 20:1 and
  // prove nothing. A theme colour that genuinely comes from the cascade
  // differs between the two modes; an unresolved `var()` cannot.
  for (const surface of CONTROL_SURFACES) {
    it(`${surface.name}'s border comes from the live cascade`, async () => {
      const light = await measureBorderTopColor("light", surface);
      const dark = await measureBorderTopColor("dark", surface);
      expect(light, `${surface.name}: no border colour resolved at all`).not.toBe("");
      expect(light, `${surface.name}: jsdom handed back an unresolved var()`).not.toMatch(/var\(/);
      expect(
        light,
        `${surface.name} measured the SAME colour in light and dark (${light}). ` +
          `Either the border stopped coming from a mode-dependent token, or jsdom ` +
          `is reporting an unresolved var() constant — in which case every ratio ` +
          `above is meaningless.`
      ).not.toBe(dark);
      // And the value is something the maths can actually read.
      expect(() => parseColor(light)).not.toThrow();
      expect(() => parseColor(dark)).not.toThrow();
    });
  }
});

// ==========================================================================
// The outlined-Paper exemption.
//
// `<Paper variant="outlined">` keeps `palette.divider` and measures 1.28:1.
// That is deliberate: SC 1.4.11 applies to "user interface components", and a
// panel that only holds read-only content is not one — its outline is
// decoration, which the SC explicitly exempts. The whole exemption rests on
// that premise, so the premise is what gets asserted: the moment an outlined
// Paper becomes clickable, focusable or role="button", it IS a control and
// this fails, forcing a real ruling instead of an inherited one.
// ==========================================================================

const PAPER_INTERACTIVE = /onClick\s*=|onKeyDown\s*=|onKeyUp\s*=|role\s*=\s*"button"|component\s*=\s*"button"|tabIndex/;

function outlinedPaperTagsIn(source, file) {
  return openingTags(source, "Paper")
    .filter((tag) => /variant\s*=\s*"outlined"/.test(tag.props))
    .map((tag) => ({ file, line: tag.line, interactive: PAPER_INTERACTIVE.test(tag.props) }));
}

function outlinedPaperTags() {
  const out = [];
  for (const file of sourceFiles()) {
    out.push(
      ...outlinedPaperTagsIn(readFileSync(file, "utf8"), file.slice(APP_DIR.length + 1).replace(/\\/g, "/"))
    );
  }
  return out;
}

describe("the outlined-Paper exemption's premise", () => {
  it("spots an interactive outlined Paper when there is one", () => {
    const source = [
      `<Paper variant="outlined" sx={{ p: 2 }}>static</Paper>`,
      `<Paper variant="outlined" onClick={fn}>a control</Paper>`,
      `<Paper elevation={1} onClick={fn}>not outlined</Paper>`,
    ].join("\n");
    expect(outlinedPaperTagsIn(source, "synthetic.js").map((t) => t.interactive)).toEqual([false, true]);
  });

  it("found outlined Papers in the app to check", () => {
    expect(outlinedPaperTags().length).toBeGreaterThan(0);
  });

  it("none of the app's outlined Papers is a control", () => {
    const controls = outlinedPaperTags()
      .filter((t) => t.interactive)
      .map((t) => `${t.file}:${t.line}`);
    expect(
      controls,
      `outlined Paper is exempt from SC 1.4.11 only while it is a container. ` +
        `These are controls and need a 3:1 boundary:\n${controls.join("\n")}`
    ).toEqual([]);
  });
});
