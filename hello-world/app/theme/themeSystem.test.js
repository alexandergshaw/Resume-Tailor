import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tokens } from "./tokens";

// Absolute path to the /app directory (this test lives in /app/theme).
const APP_DIR = fileURLToPath(new URL("../", import.meta.url));
const COMPONENTS_DIR = join(APP_DIR, "components");

// CSS variables that are legitimately NOT design tokens (injected by next/font).
const NON_TOKEN_VARS = new Set(["font-manrope", "font-source-serif"]);
const DEFINED_TOKENS = new Set(Object.keys(tokens.light));

const read = (p) => readFileSync(p, "utf8");
const componentFiles = () =>
  readdirSync(COMPONENTS_DIR)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => join(COMPONENTS_DIR, f));

// Files that participate in the token system and were swept clean of literals.
const sweptJsFiles = () => [...componentFiles(), join(APP_DIR, "page.js")];
const cssFiles = () => [join(APP_DIR, "globals.css"), join(APP_DIR, "page.module.css")];

// Drop comments so documentation placeholders like `var(--token)` in a comment
// aren't mistaken for real references. Keeps `https://` intact.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function varRefs(source) {
  const names = [];
  const re = /var\(\s*--([a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(stripComments(source)))) names.push(m[1]);
  return names;
}

describe("token reference integrity", () => {
  it("every var(--token) used in components/pages is a defined token", () => {
    const offenders = [];
    for (const file of [...sweptJsFiles(), ...cssFiles()]) {
      const src = read(file);
      for (const name of varRefs(src)) {
        if (DEFINED_TOKENS.has(name) || NON_TOKEN_VARS.has(name)) continue;
        offenders.push(`${file.split(/[\\/]/).pop()} -> --${name}`);
      }
    }
    expect(offenders, `undefined CSS vars referenced:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no legacy aliases (--muted / --error) remain anywhere", () => {
    for (const file of [...sweptJsFiles(), ...cssFiles()]) {
      const src = read(file);
      expect(src, `${file} uses var(--muted)`).not.toMatch(/var\(\s*--muted\b/);
      expect(src, `${file} uses var(--error)`).not.toMatch(/var\(\s*--error\b/);
    }
  });
});

describe("no hardcoded hex reintroduced", () => {
  // Any #rgb/#rrggbb outside an &#entity; components + page.js were fully swept.
  const HEX = /(?<!&)#[0-9a-fA-F]{3,8}\b/;

  it("component files use tokens, not hex literals", () => {
    const offenders = [];
    for (const file of componentFiles()) {
      const src = read(file);
      src.split("\n").forEach((line, i) => {
        if (HEX.test(line)) offenders.push(`${file.split(/[\\/]/).pop()}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, `hex literals found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("page.js uses tokens, not hex literals", () => {
    const src = read(join(APP_DIR, "page.js"));
    const offenders = src
      .split("\n")
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => HEX.test(line))
      .map(({ line, i }) => `page.js:${i + 1}  ${line.trim()}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("globals.css references tokens only (no palette hex)", () => {
    const src = read(join(APP_DIR, "globals.css"));
    expect(src).not.toMatch(HEX);
    expect(src).toContain("var(--app-background)");
    expect(src).toContain("var(--text-primary)");
  });
});

describe("wiring", () => {
  it("layout.js injects the token CSS and the no-flash script", () => {
    const src = read(join(APP_DIR, "layout.js"));
    expect(src).toContain("themeCssText");
    expect(src).toContain("noFlashScript");
    expect(src).toMatch(/id="theme-tokens"/);
    expect(src).toContain("suppressHydrationWarning");
  });

  it("layout.js mounts the app header", () => {
    const src = read(join(APP_DIR, "layout.js"));
    expect(src).toContain("AppHeader");
  });

  it("AppHeader carries the engine picker + settings menu and hides on auth routes", () => {
    const src = read(join(COMPONENTS_DIR, "AppHeader.js"));
    expect(src).toContain("EngineSelect");
    expect(src).toContain("SettingsMenu");
    expect(src).toContain("usePathname");
    expect(src).toMatch(/\/login/);
  });

  it("Providers wires the color mode into the MUI theme", () => {
    const src = read(join(COMPONENTS_DIR, "Providers.js"));
    expect(src).toContain("useColorMode");
    expect(src).toContain("makeTheme");
    expect(src).toContain("ThemeProvider");
  });

  it("SettingsMenu wires the color mode and collapses the bar controls", () => {
    const src = read(join(COMPONENTS_DIR, "SettingsMenu.js"));
    expect(src).toContain("useColorMode");
    expect(src).toContain("GmailButton");
    expect(src).toContain("AccountSection");
    expect(src).toMatch(/aria-label/);
  });

  it("no component imports the removed ColorModeContext", () => {
    for (const file of componentFiles()) {
      expect(read(file), `${file}`).not.toContain("ColorModeContext");
    }
  });
});

describe("document paper stays theme-independent", () => {
  it("the preview dialogs render on constant paper tokens", () => {
    for (const name of ["DocumentPreviewDialog.js", "CompanyResearchDialog.js"]) {
      const src = read(join(COMPONENTS_DIR, name));
      expect(src, `${name} paper-bg`).toContain("var(--paper-bg)");
      expect(src, `${name} paper-ink`).toContain("var(--paper-ink)");
    }
  });
});
