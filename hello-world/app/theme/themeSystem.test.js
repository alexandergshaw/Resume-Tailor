// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`).
// Every test in this file except the "SettingsMenu actually renders
// DriveButton" describe below is a pure node.js source-text check and does
// not care which environment it runs under; that describe block mounts
// SettingsMenu for real (react-dom/client), which needs jsdom's `document`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { tokens } from "./tokens";

// AccountSection (rendered inside SettingsMenu) calls createClient() from
// this module; stub it so mounting SettingsMenu under jsdom doesn't reach
// for real Supabase env vars. Mirrors
// app/components/experience/AttachmentPanel.download.test.js:25's pattern.
vi.mock("../../lib/supabase/client", () => ({ createClient: vi.fn() }));

import { createClient } from "../../lib/supabase/client";
import SettingsMenu from "../components/SettingsMenu.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Absolute path to the /app directory (this test lives in /app/theme).
// Deliberately NOT `fileURLToPath(new URL("../", import.meta.url))` --
// under `@vitest-environment jsdom` the global `URL` is jsdom's own class,
// not Node's, and `fileURLToPath` rejects an instance of it with "The URL
// must be of scheme file" (measured; see CodeLanguagePicker.test.js:63-66
// for the same fix applied to the same failure).
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
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
    expect(src).toContain("DriveButton");
    expect(src).toContain("AccountSection");
    expect(src).toMatch(/aria-label/);
  });

  it("no component imports the removed ColorModeContext", () => {
    for (const file of componentFiles()) {
      expect(read(file), `${file}`).not.toContain("ColorModeContext");
    }
  });
});

describe("SettingsMenu actually renders DriveButton (not just imports it)", () => {
  // The load-bearing assertion for Wave 5B. DriveButton.js already has 24+
  // tests of its own (app/components/DriveButton.test.js) proving the
  // component works in isolation, and the source-text check above already
  // proves SettingsMenu.js's source merely CONTAINS the string
  // "DriveButton". Neither proves the mount survives: this repo has shipped
  // a component extraction where 27 tests passed against a caller that
  // imported none of the new components -- they sat fully tested and never
  // rendered. So this describe actually opens the settings popover with
  // react-dom and reads what lands in the DOM.

  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    createClient.mockReset();
    createClient.mockReturnValue({
      auth: {
        // Signed-out branch: AccountSection renders a plain "Sign in" link
        // and makes no further Supabase calls -- keeps this file's focus on
        // the Gmail/Drive/Account section wiring, not on auth state.
        getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
    });

    global.fetch = vi.fn((url) => {
      if (url === "/api/gmail/status") {
        return Promise.resolve({ ok: true, json: async () => ({ connected: false }) });
      }
      if (url === "/api/drive/status") {
        return Promise.resolve({ ok: true, json: async () => ({ connected: false, configured: true }) });
      }
      return Promise.reject(new Error(`unexpected fetch in SettingsMenu wiring test: ${url}`));
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  // Opens the popover the same way a user does: focus the gear (jsdom does
  // not move focus on a synthetic MouseEvent, so this can't be skipped),
  // then click it. MUI's Popover has no `keepMounted` here, so its content
  // does not exist in the DOM at all until this fires -- and portals to
  // `document.body` once it does, not into `container`.
  async function openSettings() {
    await act(async () => {
      root.render(createElement(SettingsMenu));
    });
    const gear = container.querySelector('[aria-label="Settings"]');
    expect(gear, "no [aria-label=Settings] gear button rendered").toBeTruthy();
    gear.focus();
    await act(async () => {
      gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The status fetches fire from mount effects inside the just-opened
    // popover; flush their .then() chains before reading the DOM (mirrors
    // DriveButton.test.js's own mount() helper).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  // A Section label renders as a standalone leaf text node (Section wraps
  // just `{label}` in a Box with no child elements) -- so filtering to
  // elements with zero child ELEMENTS and an exact text match can't
  // accidentally match a button whose visible text merely contains a label
  // as a substring (e.g. "Connect Gmail" contains "Gmail" but isn't it).
  function leafTextElements(node) {
    return [...node.querySelectorAll("*")].filter((el) => el.children.length === 0);
  }

  it("before opening, nothing is portalled: document.body and the render target agree", async () => {
    await act(async () => {
      root.render(createElement(SettingsMenu));
    });
    // Tripwire mirroring DriveButton.test.js:181's own portal check: with
    // the popover still closed, the gear IconButton is the only thing on
    // the page, so body text must equal the local container's text.
    expect(document.body.textContent).toBe(container.textContent);
  });

  it("opening Settings mounts a real, visible 'Connect Drive' control -- not merely an import", async () => {
    await openSettings();
    const connect = [...document.body.querySelectorAll("a")].find(
      (el) => el.textContent.trim() === "Connect Drive",
    );
    expect(connect).not.toBeUndefined();
    expect(connect.getAttribute("href")).toBe("/api/drive/connect");
    // And it did NOT land inside `container` -- confirms the portal, and
    // that reading `document.body` above wasn't incidental.
    expect(container.textContent).not.toContain("Connect Drive");
  });

  it("renders exactly the four settings sections, in order, once open -- Google Drive included", async () => {
    await openSettings();
    const expectedSections = ["Appearance", "Gmail", "Google Drive", "Account"];
    // An exact ordered list, not a `>=` count: a lower-bound count can't
    // distinguish "the Google Drive section is missing" from "some other
    // section rendered twice" -- both still satisfy `>= 4`. `toEqual` on the
    // full ordered list catches either.
    const foundSections = leafTextElements(document.body)
      .map((el) => el.textContent.trim())
      .filter((text) => expectedSections.includes(text));
    expect(foundSections).toEqual(expectedSections);
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
