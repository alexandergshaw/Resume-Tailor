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
//
// WHAT THIS FILE ESTABLISHES
//   * For the RESTING state of every outlined <Button> colour the app actually
//     renders, and of the outlined input used by TextField/Select/Autocomplete,
//     the border colour MUI produces clears 3:1 against both stops of the
//     `.main` gradient, in both colour modes -- four grounds in total.
//   * That the app's own `sx` overrides, which sit at a higher specificity than
//     the theme and would otherwise silently escape it, clear 3:1 too.
//
// WHAT IT DOES NOT ESTABLISH
//   * Nothing about hover, focus, error or disabled borders. Those are separate
//     MUI rules at a higher specificity; they were left untouched, and a
//     :hover cascade cannot be driven from jsdom anyway.
//   * Nothing about controls whose border comes from `palette.divider`
//     (ToggleButton, outlined Chip, outlined Paper). Those measure 1.28:1 and
//     are a real defect, but changing `divider` moves every Divider in the app
//     and was deliberately left out of this change's blast radius.
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
