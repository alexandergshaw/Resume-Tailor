// @vitest-environment jsdom
//
// WCAG 2.2 SC 2.4.7 (Focus Visible) and SC 1.4.11 (Non-text Contrast) for the
// app's KEYBOARD focus indicator.
//
// THE DEFECT THIS FILE FALSIFIES
// ------------------------------
// MUI's ButtonBase resets `outline: 0` on every control it renders
// (`node_modules/@mui/material/ButtonBase/ButtonBase.js`, whose own comment
// reads "We disable the focus ring for mouse, touch and keyboard users"), and
// this app defines no replacement: `app/globals.css` contains zero `focus`,
// `outline` or `:focus-visible` occurrences, and `app/theme/index.js` carries
// no `MuiButtonBase` override. Three consequences, all measured here:
//
//   * A `<TableSortLabel>` — the tracking table's four column-sort headers —
//     sets `disableRipple: true` and defines no `.Mui-focusVisible` style, so
//     a keyboard-focused sort header paints NOTHING AT ALL.
//   * MUI's only built-in focus visual for a contained `<Button>` is
//     `.Mui-focusVisible { boxShadow: shadows[6] }`, and the app's GLOBAL
//     `MuiButton.defaultProps.disableElevation` (theme/index.js) overrides it
//     to `boxShadow: 'none'`. See the "why not boxShadow" describe below,
//     which measures that override rather than asserting it from source.
//   * Everything else (IconButton, Tab, MenuItem, ListItemButton, Checkbox,
//     Switch, clickable Chip) is left with whatever MUI happens to ship —
//     for most of them, only the TouchRipple.
//
// THE FIX THIS FILE EXPECTS: exactly one theme rule,
// `MuiButtonBase.styleOverrides.root["&.Mui-focusVisible"]`, painting the same
// ring the app already uses elsewhere — 2px solid `--accent`, offset 2px.
// ONE DELIBERATE EXCEPTION: `Tab` additionally carries
// `MuiTab.styleOverrides.root["&.Mui-focusVisible"].outlineOffset = "-2px"`,
// because `Tabs.js`'s own `overflow: hidden` (TabsRoot/TabsScroller) clips an
// outward ring to invisibility on every Tab in the app — see the SURFACES
// entry and the offset override table below.
//
// ==========================================================================
// FIVE HARNESS FACTS, ALL MEASURED BEFORE THIS FILE WAS WRITTEN. Each one is
// load-bearing; getting any of them wrong yields a green test beside a
// missing ring.
// ==========================================================================
//
// 1. jsdom DOES NOT IMPLEMENT THE `outline` SHORTHAND. Declaring
//    `outline: "2px solid #0d4a8f"` reads back as
//    `outlineWidth: "medium", outlineStyle: "none", outlineColor: "rgba(0,0,0,0)"`
//    — indistinguishable from no ring. The FOUR LONGHANDS
//    (`outlineWidth` / `outlineStyle` / `outlineColor` / `outlineOffset`) all
//    resolve correctly. This is the same trap `knowledgePanelStyles.js`
//    already records at its header ("jsdom's CSS parser drops the shorthand
//    entirely, so an implementation written with it makes its own falsifier
//    read back 'none'"), independently re-measured here. The acceptance
//    criteria therefore MANDATE the longhands in the theme; this is not a
//    style preference, it is the only form that is machine-checkable.
//
// 2. jsdom DOES NOT RESOLVE `var()`. `outlineColor: "var(--accent)"` reads
//    back as the literal string `"var(--accent)"`. `theme/index.js` already
//    works in real hex from `tokens[mode]` for exactly this reason (every
//    palette entry, `--border-control` on MuiOutlinedInput/MuiToggleButton),
//    so the criteria require `t.accent`, not `var(--accent)`. Same token,
//    same rendered colour, measurable. The "comes from the live cascade"
//    describe below re-proves this on every run rather than trusting it.
//
// 3. THE RING IS PROVED WITHOUT EVER FOCUSING ANYTHING. `knowledgePanelStyles.js`
//    records `:focus-visible` as "measurably flaky in this harness — five true
//    and five false over ten identical runs". So no assertion here touches a
//    focus pseudo-class. Instead each control is measured twice: at REST
//    (no class, no focus) and with MUI's own `Mui-focusVisible` class added by
//    hand. That pair is fully deterministic and is a strictly BETTER
//    discriminator than focusing would be — it fails an implementation keyed
//    on bare `&:focus` (the ring would not appear without focus) exactly as it
//    fails one keyed on nothing at all (the ring would appear at rest).
//
// 4. ONE `MuiButtonBase` RULE REALLY DOES REACH ALL OF THEM, INCLUDING THE
//    NON-NATIVE ROOTS. Measured across eleven surfaces, six of which do not
//    render a `<button>`: TableSortLabel is a `<span>`, MenuItem an `<li>`,
//    ListItemButton a `<div>`, clickable Chip a `<div>`, Checkbox and Switch
//    `<span>`s. All eleven carry `.MuiButtonBase-root`, and the theme override
//    lands at (0,2,0) — beating ButtonBase's own `outline: 0` at (0,1,0) — on
//    every one. The SURFACES table below re-proves that every run.
//
// 5. `Mui-focusVisible` IS MUI'S CLASS, NOT A CSS PSEUDO. The criteria require
//    the rule be keyed on it rather than on `&:focus-visible` because it is
//    the only selector MUI guarantees on the six non-native roots above, and
//    because MUI's own components already key their focus visuals on it.
//    WHICH INPUT MODALITY SETS THAT CLASS IS MUI'S CONTRACT, NOT THIS FILE'S:
//    `useIsFocusVisible` adds it on keyboard focus and withholds it on a mouse
//    click. jsdom adds it on any `.focus()` call, so this file cannot and does
//    not claim to prove the mouse/keyboard split.
//
// ==========================================================================
// BROWSER-ONLY — NOT TESTED HERE, AND NOT CLAIMED. jsdom has no layout engine.
// Verify these by hand in Chrome and Firefox, in BOTH themes:
//   B1. Click a Button with the MOUSE — no ring must appear. Tab to it — the
//       ring must appear. (Fact 5: MUI owns this; jsdom cannot see it.)
//   B2. `outline-offset: 2px` puts the ring OUTSIDE the control, so on a
//       contained primary Button the accent ring is separated from the accent
//       fill by 2px of the container's own background. Confirm the ring is not
//       clipped by an `overflow: hidden` ancestor (Table cells, Accordion
//       summaries, Tabs' own TabsRoot/TabsScroller, the StatusBar dock) and is
//       not occluded by the sticky AppHeader or the fixed dock (audit K-12, a
//       separate chunk). Tab is the one surface this file measures at a
//       DIFFERENT (inset, "-2px") offset for exactly this reason — confirm in
//       a real browser that the inset ring is fully visible (all four edges)
//       on NavTabs, DocumentPreviewDialog, LibraryEditor and /login, where the
//       outward ring above would otherwise be clipped away.
//   B3. `--paper-bg` (#ffffff in BOTH themes) is the one app surface where the
//       dark-mode accent ring measures 2.93:1, under the 3:1 bar. It is
//       exempt only while it holds no control: its three sites
//       (DocumentPreviewDialog's preview page, CompanyResearchDialog's letter
//       preview, MfaSetupDialog's QR) are all read-only. Confirm no focusable
//       control has been placed on a paper surface.
//   B4. The six deliberate rings the app already owns (SpeakerChip,
//       PageTreeItem, knowledgePanelStyles' FOCUS_SX, CopyDocumentControl,
//       DocumentPreviewDialog's editor, page.module.css `.dupFlagAction`) must
//       not double up into two concentric rings. The three that sit on a
//       ButtonBase declare the SAME 2px/2px accent ring, which is why they
//       coincide rather than stack — the "agrees with the ring the app already
//       owns" describe below is the static half of that check.
// ==========================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import TableSortLabel from "@mui/material/TableSortLabel";
import MenuList from "@mui/material/MenuList";
import MenuItem from "@mui/material/MenuItem";
import ListItemButton from "@mui/material/ListItemButton";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import { tokens, MODES } from "./tokens.js";
import { makeTheme } from "./index.js";
import { FOCUS_SX } from "../components/experience/knowledgePanelStyles.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Deliberately NOT `new URL("../", import.meta.url)`: under jsdom the global
// `URL` is jsdom's class and `fileURLToPath` rejects it. Same fix as
// themeSystem.test.js and controlBorderContrast.test.js.
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const WCAG_NON_TEXT_MINIMUM = 3;

// The ring the app already paints, in the app's own vocabulary. Every value
// here is read back off a rendered control below; none is a magic number:
// `RING_WIDTH`/`RING_OFFSET` are cross-checked against the exported `FOCUS_SX`
// so the theme and the knowledge panel cannot drift apart, and the colour is
// cross-checked against `tokens[mode].accent` so no new colour can appear.
const RING_WIDTH = "2px";
const RING_STYLE = "solid";
const RING_OFFSET = "2px";

// MUI's focus-visible class. Not a pseudo-class — see harness fact 5.
const FOCUS_VISIBLE_CLASS = "Mui-focusVisible";

// --------------------------------------------------------------------------
// Colour maths — sRGB relative luminance per WCAG 2.2, plus simple-alpha
// compositing. Same implementation as controlBorderContrast.test.js; kept
// local so neither file's guard depends on the other still existing.
// --------------------------------------------------------------------------

function parseColor(value) {
  const css = String(value).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const full =
      hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return { rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)), alpha: 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(css);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        rgb: parts.slice(0, 3),
        alpha: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1,
      };
    }
  }
  throw new Error(`cannot parse colour: ${JSON.stringify(value)}`);
}

const isColor = (value) => {
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
};

function composite(color, ground) {
  const { rgb, alpha } = parseColor(color);
  const base = parseColor(ground).rgb;
  return rgb.map((channel, i) => channel * alpha + base[i] * (1 - alpha));
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const contrastOnGround = (color, ground) =>
  contrast(composite(color, ground), parseColor(ground).rgb);

const sameColor = (a, b) =>
  parseColor(a).rgb.every((channel, i) => Math.round(channel) === Math.round(parseColor(b).rgb[i]));

// --------------------------------------------------------------------------
// THE GROUNDS: every surface a focus ring can appear on, in both themes.
//
// Derived from the token table by NAME PATTERN rather than listed, so a new
// surface token starts being measured the day it is added:
//   * `bg-*`      — the app's four background layers
//   * `surface-*` — the deeper wells
//   * `*-soft`    — the tinted status/accent fills (non-colour values such as
//                   `shadow-soft` are filtered out by `isColor`)
// Plus both stops of `.main`'s gradient, read out of page.module.css, which is
// where most of the app's controls actually sit. Those happen to be
// `--bg-surface` and `--bg-soft`; reading them anyway means a change to the
// gradient cannot slip past this file.
//
// TWO DELIBERATE EXCLUSIONS:
//   * `--paper-bg` matches neither pattern (it is not a `bg-*` layer and not a
//     `*-soft` fill), which is convenient but not the reason it is out. It is
//     out because it is #ffffff in BOTH themes, so the DARK accent ring
//     measures 2.93:1 on it — the single failing ground in the whole palette.
//     Its three sites are read-only print surfaces holding no control, so
//     SC 1.4.11 has nothing to apply to. That exemption is a PREMISE, not a
//     fact: see manual check B3.
//   * A filled button's OWN background (`--accent` at 1.00:1 under an accent
//     ring, `--danger` 1.35:1, `--success` 1.71:1, `--warning` 1.80:1). The
//     ring never touches it: `outline-offset: 2px` places the ring's inner
//     edge 2px clear of the control's border box, so both of the ring's
//     neighbours are the CONTAINER's background, which is a ground above. That
//     is what makes an accent ring legal on an accent-filled button, and it is
//     why the offset assertion below is not cosmetic.
// --------------------------------------------------------------------------

function gradientStopTokens() {
  const css = readFileSync(join(APP_DIR, "page.module.css"), "utf8");
  const main = /\.main\s*\{([^}]*)\}/.exec(css);
  if (!main) throw new Error("could not find `.main` in page.module.css");
  const background = /background:\s*linear-gradient\(([^;]*)\);/.exec(main[1]);
  if (!background) throw new Error("`.main` no longer uses a linear-gradient background");
  return [...background[1].matchAll(/var\(\s*--([a-z0-9-]+)\s*\)/g)].map((m) => m[1]);
}

const SURFACE_TOKEN = /^(bg-|surface-)|-soft$/;

function groundsFor(mode) {
  const t = tokens[mode];
  const names = [
    ...new Set([
      ...Object.keys(t).filter((name) => SURFACE_TOKEN.test(name) && isColor(t[name])),
      ...gradientStopTokens(),
    ]),
  ].sort();
  // A translucent `*-soft` fill (dark mode declares four as rgba) is itself
  // painted over the app's paper colour, so composite it before using it as
  // an opaque ground.
  return names.map((name) => {
    const rgb = composite(t[name], t["bg-surface"]).map(Math.round);
    return { name, declared: t[name], hex: `rgb(${rgb.join(", ")})` };
  });
}

// --------------------------------------------------------------------------
// Rendering. Every surface below is a real MUI control under the app's REAL
// theme — no probe theme, no stubbed styles.
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

const noop = () => {};

// Eleven controls. Six of them do NOT render a `<button>` — see harness
// fact 4 — which is the whole point of measuring them separately rather than
// trusting that "a theme rule on MuiButtonBase reaches everything".
const SURFACES = [
  { name: "Button variant=contained", el: () => createElement(Button, { variant: "contained" }, "Ground truth") },
  { name: "Button variant=outlined", el: () => createElement(Button, { variant: "outlined" }, "Ground truth") },
  { name: "Button variant=text", el: () => createElement(Button, null, "Ground truth") },
  { name: "IconButton", el: () => createElement(IconButton, { "aria-label": "Ground truth" }, "i") },
  // Tab rings INSET ("-2px"), not outward like the other ten -- see the
  // module header's "ONE DELIBERATE EXCEPTION" note. Tabs.js's own
  // TabsRoot/TabsScroller `overflow: hidden` clips anything painted outside
  // the border box, so this is the one surface where the app-wide +2px offset
  // would be invisible rather than merely untested.
  { name: "Tab", el: () => createElement(Tabs, { value: 0 }, createElement(Tab, { label: "Ground truth" })), offset: "-2px" },
  // The audit's K-2, and the only control in the app that currently paints
  // NOTHING on focus: `disableRipple: true` with no `.Mui-focusVisible` style
  // of its own. Its root is a <span>.
  { name: "TableSortLabel (disableRipple, <span> root)", el: () => createElement(TableSortLabel, { active: true }, "Ground truth") },
  { name: "MenuItem (<li> root)", el: () => createElement(MenuList, null, createElement(MenuItem, null, "Ground truth")) },
  { name: "ListItemButton (<div> root)", el: () => createElement(ListItemButton, null, "Ground truth") },
  { name: "Checkbox (<span> root)", el: () => createElement(Checkbox, null) },
  { name: "Chip clickable (<div> root)", el: () => createElement(Chip, { label: "Ground truth", onClick: noop }) },
  { name: "Switch (<span> root)", el: () => createElement(Switch, null) },
];

// Read the outline longhands off a control's ButtonBase root, first at rest
// and then with MUI's focus-visible class applied by hand. Harness fact 3:
// nothing is focused, so nothing here depends on a flaky focus pseudo-class.
async function measure(mode, surface) {
  const { host, cleanup } = await renderUnderTheme(mode, surface.el());
  try {
    const node = host.querySelector(".MuiButtonBase-root");
    expect(node, `${surface.name}: rendered no .MuiButtonBase-root`).toBeTruthy();
    const read = () => {
      const cs = getComputedStyle(node);
      return {
        width: cs.outlineWidth,
        style: cs.outlineStyle,
        color: cs.outlineColor,
        offset: cs.outlineOffset,
        boxShadow: cs.boxShadow,
        borderRadius: cs.borderRadius,
      };
    };
    const resting = read();
    node.classList.add(FOCUS_VISIBLE_CLASS);
    return { tag: node.tagName, resting, focusVisible: read() };
  } finally {
    cleanup();
  }
}

// ==========================================================================

describe("contrast maths (self-check)", () => {
  it("agrees with the two ratios WCAG fixes by definition", () => {
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });

  it("composites a translucent colour over its ground before measuring", () => {
    expect(contrastOnGround("rgba(0, 0, 0, 0.5)", "#ffffff")).toBeLessThan(21);
    expect(contrastOnGround("rgba(0, 0, 0, 1)", "#ffffff")).toBeCloseTo(21, 5);
  });
});

describe("SC 2.4.7 — every MUI control paints a keyboard focus ring", () => {
  for (const mode of MODES) {
    for (const surface of SURFACES) {
      it(`${surface.name} rings in ${mode}`, async () => {
        const m = await measure(mode, surface);
        expect(
          m.focusVisible.style,
          `${surface.name} <${m.tag}> in ${mode}: no outline style when .${FOCUS_VISIBLE_CLASS} is set ` +
            `(got "${m.focusVisible.style}"). MUI's ButtonBase resets outline:0 on every control; ` +
            `the theme must put one back. NOTE: jsdom drops the \`outline\` SHORTHAND — if the fix ` +
            `used it, this reads "none" even though a browser would paint. Use the four longhands.`
        ).toBe(RING_STYLE);
        expect(m.focusVisible.width, `${surface.name} in ${mode}: outline-width`).toBe(RING_WIDTH);
        const expectedOffset = surface.offset ?? RING_OFFSET;
        expect(
          m.focusVisible.offset,
          expectedOffset === RING_OFFSET
            ? `${surface.name} in ${mode}: outline-offset. 2px is what keeps the accent ring clear of an ` +
              `accent-filled button — at offset 0 the ring would sit ON the fill at 1.00:1.`
            : `${surface.name} in ${mode}: outline-offset. Tab rings INSET (-2px), not outward like every ` +
              `other surface here — Tabs' own TabsRoot/TabsScroller \`overflow: hidden\` clips an outward ` +
              `ring to invisibility, so this surface needs the opposite sign.`
        ).toBe(expectedOffset);
      });
    }
  }
});

describe("the ring is keyboard-gated, not painted on every click", () => {
  // The `:focus` / `:focus-visible` distinction, expressed WITHOUT touching a
  // focus pseudo-class (harness fact 3). A rule keyed on bare `&:focus` fails
  // the second assertion — the ring would need focus, which is never given
  // here. A rule with no gate at all fails the first.
  for (const mode of MODES) {
    it(`a resting control has no ring in ${mode}`, async () => {
      const offenders = [];
      for (const surface of SURFACES) {
        const m = await measure(mode, surface);
        if (m.resting.style !== "none") {
          offenders.push(`${surface.name}: outline-style "${m.resting.style}" at rest`);
        }
      }
      expect(
        offenders,
        `a control that is neither focused nor marked .${FOCUS_VISIBLE_CLASS} must paint no ring; ` +
          `an ungated rule rings on every mouse click:\n${offenders.join("\n")}`
      ).toEqual([]);
    });

    it(`the ring is keyed on MUI's ${FOCUS_VISIBLE_CLASS} class in ${mode}`, async () => {
      // Adding the class alone — with nothing focused — must be enough. This
      // is what rules out `&:focus` and `&:focus-visible`: both need focus,
      // which this test deliberately never gives.
      const m = await measure(mode, SURFACES[0]);
      expect(
        m.focusVisible.style,
        `adding .${FOCUS_VISIBLE_CLASS} to an UNFOCUSED control produced no ring. The rule must be ` +
          `keyed on that class, not on a focus pseudo-class: it is the only selector MUI guarantees ` +
          `on its six non-native ButtonBase roots (TableSortLabel <span>, MenuItem <li>, ` +
          `ListItemButton <div>, Chip <div>, Checkbox/Switch <span>).`
      ).toBe(RING_STYLE);
    });
  }
});

describe("SC 1.4.11 — ring contrast on every surface it can appear on", () => {
  it("enumerated the app's surfaces from the token table and the .main gradient", () => {
    for (const mode of MODES) {
      const grounds = groundsFor(mode);
      expect(grounds.length, `${mode}: no grounds enumerated`).toBeGreaterThanOrEqual(6);
      for (const name of gradientStopTokens()) {
        expect(grounds.map((g) => g.name), `.main stop --${name} not among the grounds`).toContain(name);
      }
    }
  });

  for (const mode of MODES) {
    for (const ground of groundsFor(mode)) {
      it(`clears 3:1 in ${mode} on --${ground.name}`, async () => {
        const m = await measure(mode, SURFACES[0]);
        expect(
          () => parseColor(m.focusVisible.color),
          `outline-color read back as ${JSON.stringify(m.focusVisible.color)} — jsdom does not ` +
            `resolve var(); declare the colour as tokens[mode].accent, the way the rest of ` +
            `theme/index.js already does.`
        ).not.toThrow();
        const ratio = contrastOnGround(m.focusVisible.color, ground.hex);
        expect(
          ratio,
          `focus ring ${m.focusVisible.color} on --${ground.name} ${ground.declared} ` +
            `(composited ${ground.hex}) in ${mode} = ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(WCAG_NON_TEXT_MINIMUM);
      });
    }
  }
});

describe("the ring really comes from the live cascade", () => {
  // The failure this guards is the one controlBorderContrast.test.js records
  // for borders: if the colour is written as `var(--accent)`, jsdom hands back
  // a constant that cannot vary by mode, and every ratio above becomes
  // meaningless. A colour that genuinely comes from the token table differs
  // between the two modes; an unresolved var() cannot.
  it("the ring colour differs between light and dark", async () => {
    const light = (await measure("light", SURFACES[0])).focusVisible.color;
    const dark = (await measure("dark", SURFACES[0])).focusVisible.color;
    expect(light, "no outline colour resolved at all").not.toBe("");
    expect(light, "jsdom handed back an unresolved var()").not.toMatch(/var\(/);
    expect(
      light,
      `the ring measured the SAME colour in light and dark (${light}). Either it stopped coming ` +
        `from a mode-dependent token, or jsdom is reporting an unresolved var() — in which case ` +
        `every contrast ratio in this file is meaningless.`
    ).not.toBe(dark);
  });
});

describe("no new colour, radius or shadow token", () => {
  for (const mode of MODES) {
    it(`the ring colour is an existing ${mode} token, and it is --accent`, async () => {
      const m = await measure(mode, SURFACES[0]);
      const existing = Object.entries(tokens[mode]).filter(([, v]) => isColor(v));
      const matches = existing.filter(([, v]) => sameColor(v, m.focusVisible.color)).map(([k]) => k);
      expect(
        matches,
        `the ring is ${m.focusVisible.color}, which is not any ${mode} token. The focus ring must ` +
          `reuse --accent; adding a colour would also add a token, and themeSystem.test.js sweeps ` +
          `globals.css against Object.keys(tokens.light).`
      ).not.toEqual([]);
      expect(matches, `the ring should be --accent, not ${matches.join("/")}`).toContain("accent");
    });

    it(`the ring adds no shadow and no radius change in ${mode}`, async () => {
      // GUARD THAT PASSES BEFORE THE FIX, FOR AN UNRELATED REASON: with no
      // theme rule at all, resting and focus-visible are trivially identical.
      // It earns its place only AFTER the fix lands, as the tripwire against
      // someone later "improving" the ring into a glow or a radius change.
      const m = await measure(mode, SURFACES[0]);
      expect(m.focusVisible.boxShadow, "the focus ring must not add a box-shadow").toBe(m.resting.boxShadow);
      expect(m.focusVisible.borderRadius, "the focus ring must not change the radius").toBe(m.resting.borderRadius);
    });
  }
});

describe("agrees with the ring the app already owns", () => {
  // The app's canonical ring is `knowledgePanelStyles.FOCUS_SX`, exported as a
  // VALUE precisely so a criterion about it can be a stable read rather than a
  // flaky focus simulation (that file's own header says so). Comparing the
  // theme's measured ring against it is what stops the app growing a second,
  // subtly different focus style — the outcome the brief rules out.
  //
  // The colours are compared by TOKEN, not by string: FOCUS_SX ships
  // `var(--accent)` because an `sx` object is resolved by the browser, while
  // the theme must ship `tokens[mode].accent` because MUI derives variants
  // from real values and jsdom cannot resolve a var(). Same token either way.
  it("FOCUS_SX is still the four longhands on --accent", () => {
    expect(FOCUS_SX.outlineWidth).toBe(RING_WIDTH);
    expect(FOCUS_SX.outlineStyle).toBe(RING_STYLE);
    expect(FOCUS_SX.outlineOffset).toBe(RING_OFFSET);
    expect(FOCUS_SX.outlineColor).toBe("var(--accent)");
  });

  for (const mode of MODES) {
    it(`the theme's ring matches FOCUS_SX in ${mode}`, async () => {
      const m = await measure(mode, SURFACES[0]);
      expect(m.focusVisible.width, "width disagrees with FOCUS_SX").toBe(FOCUS_SX.outlineWidth);
      expect(m.focusVisible.style, "style disagrees with FOCUS_SX").toBe(FOCUS_SX.outlineStyle);
      expect(m.focusVisible.offset, "offset disagrees with FOCUS_SX").toBe(FOCUS_SX.outlineOffset);
      expect(
        sameColor(m.focusVisible.color, tokens[mode].accent),
        `the theme's ring is ${m.focusVisible.color}; FOCUS_SX paints var(--accent), which is ` +
          `${tokens[mode].accent} in ${mode}. Two different focus colours is the outcome this ` +
          `chunk exists to avoid.`
      ).toBe(true);
    });
  }
});

describe("why the ring is an outline and not a box-shadow", () => {
  // GUARD THAT PASSES BEFORE THE FIX, FOR AN UNRELATED REASON — labelled as
  // such rather than counted as coverage. It measures MUI, not the app's fix.
  //
  // It records the audit's K-3 as a live measurement: MUI's ONLY built-in
  // focus visual for a contained Button is `.Mui-focusVisible { boxShadow:
  // shadows[6] }`, and the app's global `MuiButton.defaultProps.disableElevation`
  // selects a MUI variant that overrides it to `boxShadow: 'none'`. So the
  // app's primary buttons have had their one MUI focus visual switched off,
  // and any future attempt to deliver the ring through `boxShadow` would be
  // switched off the same way. The outline channel is untouched by that
  // variant, which is why the criteria mandate it.
  for (const mode of MODES) {
    it(`disableElevation still suppresses the contained Button's focus shadow in ${mode}`, async () => {
      const m = await measure(mode, SURFACES[0]);
      expect(
        m.focusVisible.boxShadow,
        `MUI's shadows[6] focus visual survived disableElevation (got ${JSON.stringify(m.focusVisible.boxShadow)}). ` +
          `If that ever changes, revisit whether the outline rule is still the only channel available.`
      ).toBe("none");
    });
  }
});
