import { createTheme } from "@mui/material/styles";
import { tokens } from "./tokens";

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
