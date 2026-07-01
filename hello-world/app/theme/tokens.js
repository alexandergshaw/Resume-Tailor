// ---------------------------------------------------------------------------
// Design tokens — the single source of truth for the app's color system.
//
// Every color used across the app derives from the maps below. The SAME values
// feed two consumers so they can never drift apart:
//   1. CSS custom properties (`--accent`, `--danger`, …) injected once, SSR-side,
//      in the root layout. Anything styling via `var(--token)` (globals.css, MUI
//      `sx`, plain style) resolves to these and flips automatically with the mode.
//   2. The MUI theme palette (see ./index.js), which needs real hex values (not
//      `var()`) because MUI derives hover/active/alpha variants from them.
//
// To add or change a color, edit it HERE and nowhere else. Keys are CSS variable
// names without the leading `--`. `light` and `dark` MUST share the same keys.
// ---------------------------------------------------------------------------

// Light theme (the app's original look, promoted to tokens).
const light = {
  // Backgrounds / surfaces
  "bg-canvas": "#edf2f7", // app backdrop
  "bg-surface": "#ffffff", // cards, dialogs, menus (MUI "paper")
  "bg-soft": "#f5f8fc", // soft fills, hovers, toolbars
  "surface-2": "#eef3f9", // slightly deeper soft fill (dialog content wells)

  // Text
  "text-primary": "#122033",
  "text-secondary": "#445a73",
  "text-muted": "#667f99",

  // Lines
  border: "#d2deea",
  "border-strong": "#aebfd1",

  // Brand accent
  accent: "#0d4a8f",
  "accent-hover": "#0a3b72",
  "accent-contrast": "#ffffff",
  "accent-soft": "#e3f2fd", // tinted background for accent chips/wells

  // Status — danger / error
  danger: "#b4232d",
  "danger-hover": "#8f1a22",
  "danger-soft": "#ffebee",

  // Status — success
  success: "#2e7d32",
  "success-soft": "#e8f5e9",

  // Status — warning
  warning: "#9a6700",
  "warning-soft": "#fff6e0",

  // Effects
  shadow: "0 20px 50px -28px rgba(17, 34, 51, 0.4)",
  "shadow-soft": "0 1px 6px rgba(17, 34, 51, 0.12)",

  // Full app background (radial accents over the canvas).
  "app-background":
    "radial-gradient(circle at 18% 14%, #dbe7f2 0%, transparent 36%), radial-gradient(circle at 88% 82%, #d4e2ef 0%, transparent 33%), #edf2f7",
};

// Dark theme — a deep blue-grey scale that keeps the same brand hue, brightened
// so the accent stays legible on dark surfaces.
const dark = {
  "bg-canvas": "#0e1621",
  "bg-surface": "#16202c",
  "bg-soft": "#1c2735",
  "surface-2": "#202d3d",

  "text-primary": "#e6edf5",
  "text-secondary": "#a9bacb",
  "text-muted": "#7d90a4",

  border: "#2a394a",
  "border-strong": "#3a4d63",

  accent: "#4c9be8",
  "accent-hover": "#6fb0ee",
  "accent-contrast": "#08131f",
  "accent-soft": "rgba(76, 155, 232, 0.16)",

  danger: "#f2646d",
  "danger-hover": "#f78a91",
  "danger-soft": "rgba(242, 100, 109, 0.16)",

  success: "#6cc070",
  "success-soft": "rgba(108, 192, 112, 0.16)",

  warning: "#d9a441",
  "warning-soft": "rgba(217, 164, 65, 0.16)",

  shadow: "0 20px 50px -28px rgba(0, 0, 0, 0.65)",
  "shadow-soft": "0 1px 6px rgba(0, 0, 0, 0.45)",

  "app-background":
    "radial-gradient(circle at 18% 14%, #17263a 0%, transparent 40%), radial-gradient(circle at 88% 82%, #142033 0%, transparent 36%), #0e1621",
};

// Mode-independent tokens. The document preview renders like a printed page, so
// its "paper" stays white with dark ink in BOTH themes (like a doc viewer).
const constant = {
  "paper-bg": "#ffffff",
  "paper-ink": "#1a1a1a",
  "paper-border": "#e0e0e0",
};

export const tokens = {
  light: { ...light, ...constant },
  dark: { ...dark, ...constant },
};

export const MODES = ["light", "dark"];
export const DEFAULT_MODE = "light";

// Serialize one mode's tokens as CSS custom-property declarations.
function declarations(map) {
  return Object.entries(map)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");
}

// The full stylesheet text injected once (SSR) into the document head:
//   :root                     -> light values (default)
//   :root[data-theme="dark"]  -> dark overrides
// Constant tokens live in :root only (they don't change between modes).
export function themeCssText() {
  return [
    `:root {\n${declarations(tokens.light)}\n}`,
    `:root[data-theme="dark"] {\n${declarations(dark)}\n}`,
  ].join("\n\n");
}

// Small inline script (runs before paint) that applies the persisted or
// system-preferred mode to <html data-theme> so there is no light/dark flash.
export const THEME_STORAGE_KEY = "resume-tailor-theme";
export const noFlashScript = `(function(){try{var k='${THEME_STORAGE_KEY}';var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
