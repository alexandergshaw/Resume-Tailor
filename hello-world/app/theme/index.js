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
        styleOverrides: { root: { textTransform: "none" } },
      },
      MuiTab: {
        styleOverrides: { root: { textTransform: "none" } },
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
