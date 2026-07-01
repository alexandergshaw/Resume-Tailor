import { describe, it, expect } from "vitest";
import defaultTheme, {
  makeTheme,
  tokens,
  themeCssText,
  noFlashScript,
  THEME_STORAGE_KEY,
  MODES,
  DEFAULT_MODE,
} from "./index";

describe("makeTheme(mode): palette", () => {
  for (const mode of ["light", "dark"]) {
    describe(`${mode} mode`, () => {
      const theme = makeTheme(mode);
      const t = tokens[mode];

      it("sets palette.mode", () => {
        expect(theme.palette.mode).toBe(mode);
      });

      it("maps primary to the accent tokens", () => {
        expect(theme.palette.primary.main).toBe(t.accent);
        expect(theme.palette.primary.dark).toBe(t["accent-hover"]);
        expect(theme.palette.primary.contrastText).toBe(t["accent-contrast"]);
      });

      it("maps error to the danger tokens", () => {
        expect(theme.palette.error.main).toBe(t.danger);
        expect(theme.palette.error.dark).toBe(t["danger-hover"]);
      });

      it("maps success and warning", () => {
        expect(theme.palette.success.main).toBe(t.success);
        expect(theme.palette.warning.main).toBe(t.warning);
      });

      it("maps backgrounds to canvas/surface", () => {
        expect(theme.palette.background.default).toBe(t["bg-canvas"]);
        expect(theme.palette.background.paper).toBe(t["bg-surface"]);
      });

      it("maps text roles", () => {
        expect(theme.palette.text.primary).toBe(t["text-primary"]);
        expect(theme.palette.text.secondary).toBe(t["text-secondary"]);
        expect(theme.palette.text.disabled).toBe(t["text-muted"]);
      });

      it("maps divider to the border token", () => {
        expect(theme.palette.divider).toBe(t.border);
      });
    });
  }

  it("produces distinct accents for light vs dark", () => {
    expect(makeTheme("light").palette.primary.main).not.toBe(
      makeTheme("dark").palette.primary.main,
    );
  });
});

describe("makeTheme(mode): non-palette config", () => {
  const theme = makeTheme("light");

  it("declares the explicit breakpoint scale", () => {
    expect(theme.breakpoints.values).toMatchObject({
      xs: 0,
      sm: 600,
      md: 900,
      lg: 1200,
      xl: 1536,
    });
  });

  it("sets a rounded shape radius", () => {
    expect(theme.shape.borderRadius).toBe(8);
  });

  it("uses the Manrope CSS-variable font stack", () => {
    expect(theme.typography.fontFamily).toContain("--font-manrope");
  });
});

describe("makeTheme(mode): component defaults", () => {
  const c = makeTheme("light").components;

  it("disables Button elevation and uppercase", () => {
    expect(c.MuiButton.defaultProps.disableElevation).toBe(true);
    expect(c.MuiButton.styleOverrides.root.textTransform).toBe("none");
  });

  it("removes uppercase from Tab and ToggleButton", () => {
    expect(c.MuiTab.styleOverrides.root.textTransform).toBe("none");
    expect(c.MuiToggleButton.styleOverrides.root.textTransform).toBe("none");
  });

  it("keeps Dialog paper scrolling", () => {
    expect(c.MuiDialog.defaultProps.scroll).toBe("paper");
  });
});

describe("makeTheme(mode): defaults & robustness", () => {
  it("defaults to light when called with no argument", () => {
    const theme = makeTheme();
    expect(theme.palette.mode).toBe("light");
    expect(theme.palette.primary.main).toBe(tokens.light.accent);
  });

  it("falls back to light token colors for an unknown mode", () => {
    const theme = makeTheme("chartreuse");
    expect(theme.palette.primary.main).toBe(tokens.light.accent);
    expect(theme.palette.background.default).toBe(tokens.light["bg-canvas"]);
  });

  it("returns a fresh theme object each call", () => {
    expect(makeTheme("light")).not.toBe(makeTheme("light"));
  });
});

describe("theme index: default export & re-exports", () => {
  it("default export is a ready-made light theme", () => {
    expect(defaultTheme.palette.mode).toBe("light");
    expect(defaultTheme.palette.primary.main).toBe(tokens.light.accent);
  });

  it("re-exports the token helpers", () => {
    expect(themeCssText).toBeTypeOf("function");
    expect(typeof noFlashScript).toBe("string");
    expect(THEME_STORAGE_KEY).toBe("resume-tailor-theme");
    expect(MODES).toEqual(["light", "dark"]);
    expect(DEFAULT_MODE).toBe("light");
    expect(tokens).toBeTypeOf("object");
  });

  it("palette accent agrees with the injected CSS variable value", () => {
    const css = themeCssText();
    expect(css).toContain(`--accent: ${makeTheme("light").palette.primary.main};`);
  });
});
