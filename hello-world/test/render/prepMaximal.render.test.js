// @vitest-environment jsdom
//
// N50 / AC-N50.18(b): the render instrument that lets 8b LOOK at the maximal
// state whole -- the prep panel over test/helpers/prepMaximalFixture.js,
// inside the app's own MUI theme and app/globals.css tokens.
//
// Always: a smoke render with a validity flag (non-empty text, four section
// headings), so a render that silently produced nothing can never be judged.
//
// Only when PREP_RENDER_OUT is set (a directory path): it writes two
// standalone HTML pages for the browser pane --
//   prep-maximal.html       the maximal state with both N53 transients
//   prep-maximal-idle.html  the maximal IDLE state (every history disclosure)
// Each page carries the theme tokens (themeCssText()), app/globals.css, the
// emotion <style> rules jsdom collected, the panel's own outerHTML, and
// data-theme="light". Open them at 375x812 and at >=1024 wide. Before judging
// anything in the pane, check `document.body.innerText.length > 0`: a hidden
// pane stops compositing and every rect reads 0 -- a failed instrument is
// INVALID, not clean (AC-N50.18(b)).
//
// Example (PowerShell, from hello-world/):
//   $env:PREP_RENDER_OUT = "<scratchpad>/n50-render"; npx vitest run test/render/prepMaximal.render.test.js
//
// GREEN ON HEAD by design: this is an instrument, not an acceptance test. It
// renders whatever the panel is today; 8b is where the judgement happens.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ThemeProvider } from "@mui/material/styles";
import { makeTheme, themeCssText } from "@/app/theme";
import PrepPackPanel from "@/app/components/tracking/PrepPackPanel.js";
import { maximalPanelProps } from "@/test/helpers/prepMaximalFixture.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderThemed(props) {
  await act(async () => root.render(createElement(ThemeProvider, { theme: makeTheme("light") }, createElement(PrepPackPanel, props))));
  return container;
}

/** Every CSS rule emotion injected into this document: from the <style>
 *  text when emotion writes text nodes, from the CSSOM when it inserts rules. */
function emotionCss() {
  return [...document.querySelectorAll("style[data-emotion]")]
    .map((tag) => {
      if (tag.textContent && tag.textContent.trim()) return tag.textContent;
      try {
        return [...tag.sheet.cssRules].map((rule) => rule.cssText).join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");
}

function standalonePage(title, bodyHtml) {
  const globals = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  return [
    "<!doctype html>",
    '<html lang="en" data-theme="light">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style id="theme-tokens">${themeCssText()}</style>`,
    `<style id="globals">${globals}</style>`,
    `<style id="emotion">${emotionCss()}</style>`,
    "</head>",
    // globals.css styles <body> itself (the app backdrop); the panel sits on a
    // dialog-coloured surface, as it does inside AppViewDialog's content.
    "<body>",
    `<main style="max-width:900px;margin:16px auto;padding:16px;background:var(--bg-surface);color:var(--text-primary)">${bodyHtml}</main>`,
    "</body>",
    "</html>",
  ].join("\n");
}

const VARIANTS = [
  ["prep-maximal.html", "Prep panel, maximal", () => maximalPanelProps()],
  ["prep-maximal-idle.html", "Prep panel, maximal idle", () => maximalPanelProps({ transients: false })],
];

describe("AC-N50.18(b) -- the maximal state renders inside the app theme, and can be written out for 8b", () => {
  for (const [file, title, props] of VARIANTS) {
    it(`[${file}] renders non-empty, with four section headings (the validity flag), and writes the page when PREP_RENDER_OUT is set`, async () => {
      const el = await renderThemed(props());
      expect((el.textContent || "").length, "an empty render is an invalid instrument, not a clean one").toBeGreaterThan(0);
      expect(el.querySelectorAll("h3")).toHaveLength(4);
      expect(emotionCss().length, "the emotion rules were not collected, so the page would render unstyled").toBeGreaterThan(0);
      const out = process.env.PREP_RENDER_OUT;
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, file), standalonePage(title, el.innerHTML), "utf8");
      }
    });
  }
});
