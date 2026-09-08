import { alpha, createTheme } from "@mui/material/styles";
import { tokens } from "./tokens";

// MUI draws an outlined button's resting border at 50% of the button's own
// colour, which measures 2.17–2.57:1 against this app's backgrounds — under
// the 3:1 that WCAG 2.2 SC 1.4.11 asks of a control's boundary. 0.75 is the
// lowest step that clears it for every colour the app actually renders
// (worst case 3.33:1, on a dark error button over `--bg-soft`) while staying
// a TINT rather than the solid colour: MUI's own hover rule takes the border
// to a full-strength 1.0, and that step stays plainly visible.
const OUTLINED_BORDER_ALPHA = 0.75;

// Palette colours whose outlined border clears 3:1 at the alpha above, paired
// with the token each comes from. Every entry here genuinely meets the bar —
// the list is not "colours we styled", it is "colours we verified".
//
// Two deliberate absences:
//   * `inherit` borders with `currentColor`, so its contrast is the text's
//     problem (SC 1.4.3), not this rule's.
//   * `warning` CANNOT clear 3:1 by thinning its transparency: `--warning`
//     is only 4.57:1 against `--bg-soft` at FULL opacity in light mode, so
//     0.75 leaves it at 2.97:1. Listing it would style the border without
//     fixing it. No outlined button uses `color="warning"` today, and
//     ./controlBorderContrast.test.js derives the colours it measures from
//     source — so the day someone adds one, it fails there and gets a real
//     answer (a lighter warning token) instead of a cosmetic one.
const OUTLINED_BUTTON_COLORS = [
  ["primary", "accent"],
  ["error", "danger"],
  ["success", "success"],
];

export { tokens, themeCssText, noFlashScript, THEME_STORAGE_KEY, MODES, DEFAULT_MODE } from "./tokens";

// Build a full MUI theme for a color mode ("light" | "dark") from the design
// tokens. The palette uses real hex values (not `var()`) because MUI derives
// hover/active/alpha variants from them; the SAME token values are exposed as
// CSS variables elsewhere, so MUI components and `var(--token)` styling agree.
//
// Breakpoints mirror MUI defaults but are declared explicitly so JS
// (useMediaQuery / sx breakpoint objects) and any CSS stay in agreement:
//   xs 0 · sm 600 · md 900 · lg 1200 · xl 1536
export function makeTheme(mode = "light") {
  const t = tokens[mode] || tokens.light;

  return createTheme({
    breakpoints: {
      values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 },
    },
    shape: { borderRadius: 8 },
    palette: {
      mode,
      primary: {
        main: t.accent,
        dark: t["accent-hover"],
        contrastText: t["accent-contrast"],
      },
      error: { main: t.danger, dark: t["danger-hover"] },
      success: { main: t.success },
      warning: { main: t.warning },
      background: { default: t["bg-canvas"], paper: t["bg-surface"] },
      text: {
        primary: t["text-primary"],
        secondary: t["text-secondary"],
        disabled: t["text-muted"],
      },
      divider: t.border,
    },
    typography: {
      fontFamily: 'var(--font-manrope), "Segoe UI", Arial, sans-serif',
    },
    components: {
      // SC 2.4.7 (Focus Visible). MUI's ButtonBase resets `outline: 0` on
      // every control it renders, and `disableElevation` above overrides
      // Button's only remaining focus visual (`boxShadow`) to `none`, so
      // without this the app has no visible keyboard focus indicator at all.
      // Keyed on MUI's OWN `.Mui-focusVisible` class rather than `&:focus`
      // (rings on every mouse click too) or `&:focus-visible` (unreliable on
      // the six ButtonBase roots that are not a native `<button>`:
      // TableSortLabel <span>, MenuItem <li>, ListItemButton <div>,
      // Chip <div>, Checkbox/Switch <span>) — every one of those still carries
      // `.MuiButtonBase-root`, so this single rule reaches all eleven control
      // types. Matches the app's existing canonical ring
      // (knowledgePanelStyles.FOCUS_SX): 2px solid, 2px offset. The offset
      // keeps the ring clear of a filled button's own background, where an
      // accent-on-accent ring would sit at ~1:1 contrast.
      //
      // Four longhands, never the `outline` shorthand: jsdom does not
      // implement the shorthand and reads it back as `none`. `t.accent`
      // (already resolved to a real hex above), never `var(--accent)`: jsdom
      // does not resolve `var()`, and this app already uses real token
      // values here for the same reason (see MuiOutlinedInput below). No new
      // colour, radius or shadow is introduced — this reuses `--accent`.
      MuiButtonBase: {
        styleOverrides: {
          root: {
            "&.Mui-focusVisible": {
              outlineStyle: "solid",
              outlineWidth: "2px",
              outlineColor: t.accent,
              outlineOffset: "2px",
            },
          },
        },
      },
      // Buttons: no ALL-CAPS and no drop shadow by default — the app's
      // convention, previously repeated as `textTransform: "none"` in ~76 spots.
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { textTransform: "none" } },
        // Raise the resting outlined border to 3:1 (SC 1.4.11). Declared as
        // theme-level `variants` rather than folded into `styleOverrides.root`
        // for two reasons: the value is per-colour, and a flat declaration on
        // `root` would tie on specificity with MUI's own `&:hover` rule and,
        // being appended later, silently beat it — killing the hover state.
        // A variant lands at the same (0,1,0) as MUI's internal one, so the
        // hover rule at (0,2,0) still wins.
        variants: OUTLINED_BUTTON_COLORS.map(([color, token]) => ({
          props: { variant: "outlined", color },
          style: {
            "--variant-outlinedBorder": alpha(t[token], OUTLINED_BORDER_ALPHA),
          },
        })),
      },
      MuiOutlinedInput: {
        // Every TextField, Select and Autocomplete in the app. MUI's default
        // notch is a flat `rgba(0,0,0,.23)` / `rgba(255,255,255,.23)` that
        // measures 1.73–2.12:1 here; `--border-control` is the palette's
        // accessible line colour and, unlike a hardcoded literal, flips with
        // the mode. Scoped to the `notchedOutline` slot so it changes only
        // the RESTING border: MUI sets hover, focus, error and disabled from
        // the root slot with descendant selectors that outrank this one.
        styleOverrides: {
          notchedOutline: { borderColor: t["border-control"] },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            // SC 1.4.11. MUI draws a ToggleButton's border from
            // `palette.divider`, which is `--border` — a 1.28:1 hairline. A
            // ToggleButton has no fill of its own, so that border is the ONLY
            // thing saying "this is a control", and 1.28:1 is not enough.
            //
            // `palette.divider` itself is deliberately NOT raised: it also
            // colours every <Divider>, every `<DialogContent dividers>` seam
            // and the `borderColor: "divider"` sx sites, and a decorative
            // separator is not a user interface component — SC 1.4.11 exempts
            // it. Darkening all of those to fix a toggle would be a worse
            // outcome than fixing the toggle. So the CONTROL is moved to the
            // palette's accessible line colour and the separator is left alone.
            //
            // `borderColor` (not `border`) so the width/style MUI set stay
            // theirs, and on `root` rather than a variant because the border
            // is one colour for resting AND selected — MUI's `.Mui-selected`
            // rule changes only text and background. Two higher-specificity
            // MUI rules still outrank this on purpose: `.Mui-disabled` (a
            // disabled control is exempt from 1.4.11) and
            // ToggleButtonGroup's `borderLeft: 1px solid transparent` on
            // grouped buttons (the seam that stops adjacent borders doubling).
            borderColor: t["border-control"],
          },
        },
      },
      MuiChip: {
        // SC 1.4.11, but only for the chips that ARE controls.
        //
        // An outlined Chip is a control when it is clickable or deletable —
        // MUI renders those as a ButtonBase and stamps them `.MuiChip-clickable`
        // / `.MuiChip-deletable`, so the two cases really are distinguishable
        // here. A static outlined Chip is a LABEL: it has no behaviour, its
        // outline is decoration, and SC 1.4.11 exempts decoration. It keeps
        // MUI's own grey.
        //
        // Scoped to `.MuiChip-colorDefault` as well. A coloured outlined chip
        // draws its border from `alpha(palette[color].main, 0.7)`, which does
        // not clear 3:1 in light mode (success 2.82:1, warning 2.73:1); no
        // INTERACTIVE one exists in the app today, and repainting a future one
        // grey would hide the problem rather than fix it. Leaving it out means
        // ./controlBorderContrast.test.js — which derives the colours it
        // measures from source — fails the day one is added, and gets a real
        // answer. Same discipline as OUTLINED_BUTTON_COLORS above.
        //
        // Class-name selectors rather than an import of `chipClasses`: this
        // module is pulled into the SERVER bundle by app/layout.js (for
        // `themeCssText`), and importing @mui/material/Chip there would drag
        // the whole component in for one string. The names are MUI's public
        // override API, and the test above mounts a real Chip and measures the
        // colour that comes out — so a rename cannot pass silently either way.
        styleOverrides: {
          outlined: {
            "&.MuiChip-colorDefault.MuiChip-clickable, &.MuiChip-colorDefault.MuiChip-deletable": {
              borderColor: t["border-control"],
            },
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            // SC 2.4.7, Tab-specific override of the MuiButtonBase ring above.
            // `Tabs.js`'s own TabsRoot (`overflow: 'hidden'`, :74) and
            // TabsScroller (`overflowX`/`overflowY: 'hidden'`, :118 fixed /
            // :215-216 scrollable) clip anything painted outside a tab's
            // border box -- and neither NavTabs.js nor DocumentPreviewDialog,
            // LibraryEditor or login/page.js leaves vertical padding in that
            // chain to absorb the +2px..+4px band an OUTWARD ring occupies.
            // The result is a ring whose top and bottom edges are clipped
            // away entirely on every Tab in the app. An INSET ring is drawn
            // INSIDE the border box, so no ancestor's `overflow: hidden` can
            // ever clip it. Tab backgrounds here are transparent, so there is
            // no accent-on-accent contrast case the outward offset (see
            // MuiButtonBase above) exists to avoid.
            "&.Mui-focusVisible": { outlineOffset: "-2px" },
          },
        },
      },
      MuiDialog: {
        // Dialogs never exceed the viewport on small screens; individual
        // dialogs opt into fullScreen via the useIsMobile hook.
        defaultProps: { scroll: "paper" },
      },
    },
  });
}

// Default export kept for any consumer expecting a ready-made (light) theme.
const theme = makeTheme("light");
export default theme;
