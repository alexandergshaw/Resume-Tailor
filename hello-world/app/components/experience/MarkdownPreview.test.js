// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/components/JobDescriptionTab.test.js and
// app/components/experience/PageTree.test.js are the precedents for
// rendering a whole component here. lib/experience/markdown.js already has
// its own pure-function tests for the token tree; what this file proves is
// the WIRING between that token tree and real DOM output -- heading offset,
// rel on external links, disabled checkboxes, and (this is the reason the
// component never uses dangerouslySetInnerHTML) that hostile input never
// becomes a live script element or a javascript: href in the committed DOM.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import MarkdownPreview from "./MarkdownPreview.js";
import { tokens } from "../../theme/tokens.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(markdown) {
  await act(async () => {
    root.render(createElement(MarkdownPreview, { markdown }));
  });
}

describe("MarkdownPreview -- heading offset", () => {
  // The page's own title is the page's h1. A body `#` heading rendering as
  // h1 would duplicate the top of the outline; a body `###` heading
  // rendering as anything other than h4 would SKIP a level. Both are
  // accessibility-gate failures, so the offset (`#` -> h2, `##` -> h3) is
  // the load-bearing behaviour here, not a style choice.
  it("renders a `#` body heading as h2 and a `##` body heading as h3", async () => {
    await render("# Top\n\n## Sub");
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    const h2 = container.querySelector("h2");
    const h3 = container.querySelector("h3");
    expect(h2).not.toBeNull();
    expect(h2.textContent).toBe("Top");
    expect(h3).not.toBeNull();
    expect(h3.textContent).toBe("Sub");
  });
});

describe("MarkdownPreview -- link rel", () => {
  it("gives an external link rel containing both noopener and noreferrer", async () => {
    await render("[docs](https://example.com/docs)");
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    const rel = link.getAttribute("rel") || "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("does not add rel to a same-origin link (href starting with a single slash)", async () => {
    await render("[internal](/pages/other)");
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/pages/other");
    // The distinction is the entire reason the parser emits an `external`
    // flag in the first place -- a same-origin link must not carry it.
    expect(link.getAttribute("rel")).toBeNull();
    expect(link.getAttribute("target")).toBeNull();
  });
});

describe("MarkdownPreview -- block structure", () => {
  it("renders a bullet list as a real ul/li", async () => {
    await render("- one\n- two");
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders an ordered list as a real ol/li", async () => {
    await render("1. one\n2. two\n3. three");
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol.querySelectorAll("li")).toHaveLength(3);
  });

  it("renders a fenced code block as pre > code", async () => {
    await render("```\nconst x = 1;\n```");
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const code = pre.querySelector("code");
    expect(code).not.toBeNull();
    expect(code.textContent).toBe("const x = 1;");
  });

  it("renders a blockquote as a real blockquote", async () => {
    await render("> quoted text");
    const quote = container.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(quote.textContent).toContain("quoted text");
  });
});

describe("MarkdownPreview -- task list checkboxes", () => {
  it("renders a real, disabled checkbox reflecting the checked state", async () => {
    await render("- [x] done\n- [ ] not done");
    const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    // The preview is read-only: an editable checkbox here would let a user
    // "complete" a task from a view that can never persist the change.
    checkboxes.forEach((box) => expect(box.disabled).toBe(true));
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });
});

describe("MarkdownPreview -- hostile input", () => {
  it("shows a literal <script> tag as visible text and creates no script element", async () => {
    await render("Look: <script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    // The second half matters as much as the first: a renderer that simply
    // dropped the tag (rather than treating it as literal text) would also
    // produce no script element, but would also silently delete content the
    // user typed.
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("never lets a javascript: URL survive into a rendered href", async () => {
    await render("[click me](javascript:alert(1))");
    expect(container.innerHTML).not.toMatch(/href="javascript:/i);
    // A blocked link keeps its label as inert text rather than vanishing.
    expect(container.textContent).toContain("click me");
  });
});

// --- Dark-mode contrast of the code block, blockquote rule and hr --------
//
// This app expresses theme as `<html data-theme="dark">`, not
// `prefers-color-scheme` (that media feature is used exactly once in the
// whole repo, only to SEED the attribute -- app/theme/tokens.js:135 -- and
// there is no CSS media query for it anywhere). A plain color literal in an
// `sx` prop therefore never flips: it paints the same RGB in both modes.
//
// That is provable from source and from the real token values without
// rendering anything: jsdom never resolves `var()` (a var() reference
// round-trips as the literal string "var(--x)", not the color it names), so
// mounting the component and reading getComputedStyle here would either see
// the un-resolved var() string or (for a plain rgba() literal) a color that
// is real but tells us nothing about which theme it was "meant" for, since
// it's the same color in both. So this suite reads the actual declaration
// out of the component's source text and resolves it against the actual hex
// values in app/theme/tokens.js -- the single source both the CSS vars and
// the MUI palette are generated from -- and computes contrast the way WCAG
// defines it (relative luminance).
//
// What this proves: the source DECLARES a color that, under the app's real
// design tokens, computes to materially better contrast against the app's
// real dark-mode grounds than a mode-frozen literal ever can. What it does
// NOT prove: that a browser paints it that way pixel-for-pixel (that needs a
// real rendering/paint engine, which jsdom is not) -- nor does it assert
// full WCAG 1.4.11 (3:1) compliance, which the existing --border /
// --border-strong tokens themselves cannot reach for a hairline divider
// (see app/copilot/AnswerAids.js's own documented 1.28:1 / 1.76:1 ceiling
// for the same two tokens) -- that is a token-value question for
// app/theme/, out of this file's scope.
function srgbToLinear(c) {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}
function relativeLuminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(rgbA, rgbB) {
  const [l1, l2] = [relativeLuminance(rgbA), relativeLuminance(rgbB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
// The exact composite a browser performs for a literal `rgba(0,0,0,a)` over
// whatever sits behind it -- and the reason a black-based overlay can never
// be fixed for a dark ground by raising the alpha: blending toward black can
// only ever DARKEN an already-dark background, never separate from it.
function blendBlackOver(groundRgb, alpha) {
  return groundRgb.map((c) => c * (1 - alpha));
}

function resolveColorExpr(expr) {
  const rgba = expr.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (rgba) {
    const [, r, g, b, a] = rgba.map(Number);
    return { kind: "alpha-black", r, g, b, a };
  }
  const token = expr.match(/var\(--([a-z0-9-]+)/);
  if (token) return { kind: "token", name: token[1] };
  throw new Error(`MarkdownPreview.test.js does not know how to resolve color expression: "${expr}"`);
}

// The effective color a declaration paints against `groundHex` in `mode`.
function effectiveRgb(decl, groundHex, mode) {
  if (decl.kind === "alpha-black") return blendBlackOver(hexToRgb(groundHex), decl.a);
  const hex = tokens[mode][decl.name];
  if (!hex) throw new Error(`unknown design token --${decl.name} for mode "${mode}"`);
  return hexToRgb(hex);
}

const SRC_PATH = path.join(process.cwd(), "app", "components", "experience", "MarkdownPreview.js");
const SRC = readFileSync(SRC_PATH, "utf8");

// renderInline() has its OWN `case "code":` arm (inline `<code>` spans), so
// searching the whole file for `case "code":` finds that one first. Scope
// the search to renderBlock()'s own body -- the function that owns the
// block-level code/quote/hr arms this suite cares about.
const RENDER_BLOCK_START = SRC.indexOf("function renderBlock(token, key, renderLink) {");
const RENDER_BLOCK_END = SRC.indexOf("function renderBlocks(tokens, keyPrefix, renderLink) {");
if (RENDER_BLOCK_START === -1 || RENDER_BLOCK_END === -1 || RENDER_BLOCK_END <= RENDER_BLOCK_START) {
  throw new Error(`could not locate renderBlock()'s source region in ${SRC_PATH}`);
}
const RENDER_BLOCK_SRC = SRC.slice(RENDER_BLOCK_START, RENDER_BLOCK_END);

// Isolates one `case` arm's body (up to the next `case`/`default` at the
// switch's own indent) so the property regex below can't wander into a
// different arm and read the wrong literal.
function armBody(caseLabel) {
  const re = new RegExp(`case "${caseLabel}":[\\s\\S]*?(?=\\n    case |\\n    default)`);
  const m = RENDER_BLOCK_SRC.match(re);
  if (!m) throw new Error(`could not locate a \`case "${caseLabel}":\` arm inside renderBlock() in ${SRC_PATH}`);
  return m[0];
}
function declFor(caseLabel, propName) {
  const prop = armBody(caseLabel).match(new RegExp(`${propName}:\\s*"([^"]+)"`));
  if (!prop) throw new Error(`could not find "${propName}" inside the "${caseLabel}" arm`);
  return resolveColorExpr(prop[1]);
}

// The three sites named in the defect report, each keyed to the exact
// renderBlock() case it comes from.
const SITES = {
  "code block background (case \"code\", bgcolor)": declFor("code", "bgcolor"),
  "blockquote left border (case \"quote\", borderLeft)": declFor("quote", "borderLeft"),
  "hr rule (case \"hr\", borderTop)": declFor("hr", "borderTop"),
};

// The real grounds this renders on: app/page.module.css's `.main` is a
// gradient between these two tokens (bg-surface at the top, bg-soft at the
// bottom -- page.module.css:15), and ExperienceTab.js adds no background of
// its own (confirmed by reading it), so either stop can sit directly behind
// the element depending on scroll position.
const DARK_GROUNDS = { "bg-surface": tokens.dark["bg-surface"], "bg-soft": tokens.dark["bg-soft"] };

// Comfortably ABOVE every pre-fix literal's best dark-ground ratio (measured
// max across the three sites: 1.098, the blockquote's 20%-alpha black
// against dark bg-soft) and comfortably BELOW every candidate fix's worst
// ratio (measured min: 1.282, --border against dark bg-soft) -- chosen so
// this threshold cannot pass or fail by accident in either direction.
const MIN_DARK_CONTRAST = 1.2;

describe("MarkdownPreview -- dark-mode contrast (the three literals)", () => {
  for (const [label, decl] of Object.entries(SITES)) {
    it(`${label}: is not a mode-frozen rgba(0,0,0,...) literal`, () => {
      // This alone would only prove the literal's ABSENCE, not that
      // anything is legible -- it is paired below with the actual computed
      // ratio, which is the assertion that carries the defect.
      expect(decl.kind).toBe("token");
    });

    it(`${label}: computes to at least ${MIN_DARK_CONTRAST}:1 against both real dark grounds`, () => {
      const ratios = Object.entries(DARK_GROUNDS).map(([groundName, groundHex]) => ({
        groundName,
        ratio: contrastRatio(effectiveRgb(decl, groundHex, "dark"), hexToRgb(groundHex)),
      }));
      const worst = Math.min(...ratios.map((r) => r.ratio));
      expect(worst, `ratios against dark grounds: ${JSON.stringify(ratios)}`).toBeGreaterThanOrEqual(
        MIN_DARK_CONTRAST
      );
    });
  }
});
