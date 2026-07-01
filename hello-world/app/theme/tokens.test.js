import { describe, it, expect } from "vitest";
import {
  tokens,
  MODES,
  DEFAULT_MODE,
  THEME_STORAGE_KEY,
  themeCssText,
  noFlashScript,
} from "./tokens";

// Tokens that intentionally stay identical in light and dark (the document
// "paper" surface mirrors a printed page).
const CONSTANT_TOKENS = ["paper-bg", "paper-ink", "paper-border"];

// A representative set of tokens every consumer relies on. Not exhaustive — the
// key-parity test below covers the full set — but guards against silent removal.
const REQUIRED_TOKENS = [
  "bg-canvas",
  "bg-surface",
  "bg-soft",
  "surface-2",
  "text-primary",
  "text-secondary",
  "text-muted",
  "border",
  "border-strong",
  "accent",
  "accent-hover",
  "accent-contrast",
  "accent-soft",
  "danger",
  "danger-hover",
  "danger-soft",
  "success",
  "success-soft",
  "warning",
  "warning-soft",
  "shadow",
  "shadow-soft",
  "app-background",
  ...CONSTANT_TOKENS,
];

const isColorish = (v) => /^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\(/.test(v);

describe("tokens: structure", () => {
  it("exposes light and dark token maps", () => {
    expect(tokens).toBeTypeOf("object");
    expect(tokens.light).toBeTypeOf("object");
    expect(tokens.dark).toBeTypeOf("object");
  });

  it("light and dark declare the exact same set of keys", () => {
    const lightKeys = Object.keys(tokens.light).sort();
    const darkKeys = Object.keys(tokens.dark).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it("includes every required token in both modes", () => {
    for (const key of REQUIRED_TOKENS) {
      expect(tokens.light, `light missing ${key}`).toHaveProperty(key);
      expect(tokens.dark, `dark missing ${key}`).toHaveProperty(key);
    }
  });

  it("every token value is a non-empty string in both modes", () => {
    for (const mode of ["light", "dark"]) {
      for (const [key, value] of Object.entries(tokens[mode])) {
        expect(typeof value, `${mode}.${key} type`).toBe("string");
        expect(value.trim().length, `${mode}.${key} empty`).toBeGreaterThan(0);
      }
    }
  });

  it("pure color tokens are valid hex/rgb values", () => {
    // Everything except composite tokens (gradients/shadows) should be a color.
    const composite = new Set(["shadow", "shadow-soft", "app-background"]);
    for (const mode of ["light", "dark"]) {
      for (const [key, value] of Object.entries(tokens[mode])) {
        if (composite.has(key)) continue;
        expect(isColorish(value), `${mode}.${key}=${value} not colorish`).toBe(true);
      }
    }
  });

  it("app-background is a gradient stack in both modes", () => {
    expect(tokens.light["app-background"]).toContain("radial-gradient");
    expect(tokens.dark["app-background"]).toContain("radial-gradient");
  });

  it("shadow tokens are box-shadow strings", () => {
    for (const mode of ["light", "dark"]) {
      expect(tokens[mode].shadow).toMatch(/rgba?\(/);
      expect(tokens[mode]["shadow-soft"]).toMatch(/rgba?\(/);
    }
  });
});

describe("tokens: light vs dark", () => {
  it("keeps constant (paper) tokens identical across modes", () => {
    for (const key of CONSTANT_TOKENS) {
      expect(tokens.dark[key]).toBe(tokens.light[key]);
    }
  });

  it("flips mode-dependent tokens between light and dark", () => {
    for (const key of ["bg-canvas", "bg-surface", "text-primary", "accent", "border"]) {
      expect(tokens.dark[key], `${key} should differ in dark`).not.toBe(tokens.light[key]);
    }
  });

  it("uses a bright accent in dark mode and a deep accent in light", () => {
    expect(tokens.light.accent.toLowerCase()).toBe("#0d4a8f");
    expect(tokens.dark.accent.toLowerCase()).toBe("#4c9be8");
  });
});

describe("tokens: exports", () => {
  it("MODES lists light and dark", () => {
    expect(MODES).toEqual(["light", "dark"]);
  });

  it("DEFAULT_MODE is light and is a valid mode", () => {
    expect(DEFAULT_MODE).toBe("light");
    expect(MODES).toContain(DEFAULT_MODE);
  });

  it("THEME_STORAGE_KEY is a stable non-empty string", () => {
    expect(typeof THEME_STORAGE_KEY).toBe("string");
    expect(THEME_STORAGE_KEY.length).toBeGreaterThan(0);
    expect(THEME_STORAGE_KEY).toBe("resume-tailor-theme");
  });
});

describe("themeCssText()", () => {
  const css = themeCssText();

  it("returns a non-empty string", () => {
    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(0);
  });

  it("emits a :root block and a dark override block", () => {
    expect(css).toContain(":root {");
    expect(css).toContain(':root[data-theme="dark"] {');
  });

  it("declares every light token as a CSS variable in :root", () => {
    for (const key of Object.keys(tokens.light)) {
      expect(css, `missing --${key}`).toContain(`--${key}:`);
    }
  });

  it("declares each token with its exact light value", () => {
    expect(css).toContain(`--accent: ${tokens.light.accent};`);
    expect(css).toContain(`--border: ${tokens.light.border};`);
    expect(css).toContain(`--paper-bg: ${tokens.light["paper-bg"]};`);
  });

  it("overrides mode-dependent tokens in the dark block with dark values", () => {
    const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));
    expect(darkBlock).toContain(`--accent: ${tokens.dark.accent};`);
    expect(darkBlock).toContain(`--bg-canvas: ${tokens.dark["bg-canvas"]};`);
  });

  it("does NOT redeclare constant (paper) tokens in the dark block", () => {
    const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));
    for (const key of CONSTANT_TOKENS) {
      expect(darkBlock, `--${key} should not be in dark block`).not.toContain(`--${key}:`);
    }
  });

  it("is well-formed: balanced braces", () => {
    const open = (css.match(/{/g) || []).length;
    const close = (css.match(/}/g) || []).length;
    expect(open).toBe(2);
    expect(close).toBe(2);
  });

  it("every declaration line is a valid CSS custom property", () => {
    const decls = css
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("--"));
    expect(decls.length).toBeGreaterThan(0);
    for (const line of decls) {
      expect(line, `bad declaration: ${line}`).toMatch(/^--[a-z0-9-]+:\s.+;$/);
    }
  });
});

describe("noFlashScript", () => {
  it("is a self-invoking function string", () => {
    expect(typeof noFlashScript).toBe("string");
    expect(noFlashScript.startsWith("(function(){")).toBe(true);
    expect(noFlashScript.trimEnd().endsWith("})();")).toBe(true);
  });

  it("reads the persisted mode from the storage key", () => {
    expect(noFlashScript).toContain(THEME_STORAGE_KEY);
    expect(noFlashScript).toContain("localStorage.getItem");
  });

  it("falls back to the system color-scheme preference", () => {
    expect(noFlashScript).toContain("prefers-color-scheme: dark");
    expect(noFlashScript).toContain("matchMedia");
  });

  it("applies the mode to <html data-theme>", () => {
    expect(noFlashScript).toContain("setAttribute");
    expect(noFlashScript).toContain("data-theme");
    expect(noFlashScript).toContain("documentElement");
  });

  it("guards everything in a try/catch and knows both modes", () => {
    expect(noFlashScript).toContain("try");
    expect(noFlashScript).toContain("catch");
    expect(noFlashScript).toContain("'dark'");
    expect(noFlashScript).toContain("'light'");
  });
});
