// The census of every hand-written visually-hidden clip-rect in the tree, as an
// executable invariant — so a FOURTH copy of the bug fails on the day it is
// typed, in a file nobody has thought to write a render test for yet.
//
// THE RULE: inside an object literal that is a visually-hidden clip-rect, every
// length must carry an explicit unit. MUI's `sx` reinterprets a unitless
// number — `width: 1` becomes "100%" via sizingTransform, `margin: -1` becomes
// -8px via the 8px spacing scale (verified against
// node_modules/@mui/system/styleFunctionSx/defaultSxConfig.js, MUI 9.0.1) — so
// the plain-CSS reading of such an object is not what renders. It renders a
// full-size absolutely positioned element that stays invisible (clip and
// overflow still work) while silently extending the document's scroll width.
// lib/copilot/answerStatus.js's own comment records the measurement.
//
// This has now shipped three times. The first six were fixed in 5258564, and
// the fix included a units test on the shared export — which held, and was
// bypassed anyway, because app/meeting/MeetingInsightList.js and
// app/meeting/MeetingTranscript.js each hand-inlined a fresh copy instead of
// importing it. A test that guards one constant cannot guard a copy of it. This
// file guards the SHAPE.
//
// WHAT THIS SWEEP CANNOT PROVE, stated plainly so nobody mistakes it for
// completeness:
//
//   1. It reads source text, so it cannot see a length that arrives through a
//      variable (`width: HAIRLINE`) or a spread. That is not a hypothetical
//      limit of source scanning in general — it is genuinely tiny HERE, because
//      the object this sweeps is by construction a literal of constants; the
//      three copies in the tree are byte-similar and none uses a variable.
//   2. It is scoped by a fingerprint (`position: "absolute"` near a `clip` /
//      `clipPath`). A visually-hidden style written some other way — a
//      `clip-path: inset(50%)` idiom with no `clip`, or a `.sr-only` class in
//      CSS — is out of its reach. The `clipPath` half of the fingerprint is
//      there because that is the likeliest next spelling.
//   3. It says nothing about what actually renders. That is what
//      app/meeting/meetingVisuallyHidden.test.js does, per component, through
//      jsdom's computed style — the two are complements, and a change that made
//      this sweep vacuous would still fail there for the two meeting files.
//
// The classifier is exercised against planted objects at the bottom, so a sweep
// that silently matched nothing cannot pass.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../sourceScan/tokenizeSource.js";

const ROOTS = [path.join(process.cwd(), "app"), path.join(process.cwd(), "lib")];

// Lengths `sx` rescales on this shape. `padding` and `border` are excluded on
// purpose: every copy writes them as bare `0`, and 0 is unitless in CSS by
// definition — demanding "0px" would be demanding a style, not a correctness
// property.
const LENGTH_KEYS = ["width", "height", "maxWidth", "maxHeight", "minWidth", "minHeight", "margin", "top", "left"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

/** Extract the balanced `{...}` starting at `open`, inclusive of the braces. */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/**
 * Every visually-hidden clip-rect object literal in one source.
 *
 * Fingerprint: an object literal containing BOTH an absolute position and a
 * clip. That pair is what makes an element a screen-reader-only overlay, and it
 * is what makes its declared size load-bearing rather than cosmetic — an
 * absolutely positioned box inside an unpositioned ancestor resolves against
 * the initial containing block and escapes that ancestor's `overflow: hidden`,
 * so "100%" means 100% of the page.
 *
 * Returns [{ body, line, offenders: [{ key, value }] }].
 */
export function findHiddenClipRects(rawSrc) {
  const src = stripComments(rawSrc);
  const found = [];
  // Every `{` is a candidate; the fingerprint does the filtering. Cheap enough
  // on a tree this size, and it means the sweep does not depend on how the
  // object is introduced (`const x =`, an inline `sx={{...}}`, a property of a
  // larger styles module — all three shapes exist in this repo).
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== "{") continue;
    const body = balanced(src, i);
    if (body.length > 2000) continue;
    if (!/position:\s*["']absolute["']/.test(body)) continue;
    if (!/\bclip(Path)?:/.test(body)) continue;
    // Only the innermost matching literal, so an enclosing object that merely
    // contains one is not reported as a second site.
    if (/\{[^{}]*position:\s*["']absolute["'][^{}]*\}/.test(body) && !/^\{[^{}]*\}$/.test(body)) continue;
    const offenders = [];
    for (const key of LENGTH_KEYS) {
      const m = new RegExp(`(^|[,{\\s])${key}:\\s*([^,}\\n]+)`).exec(body);
      if (!m) continue;
      const value = m[2].trim();
      if (/^["'`]/.test(value)) continue; // a string: carries its own unit, and the render test checks the unit
      if (value === "0") continue; // unitless zero is unitless in CSS too
      offenders.push({ key, value });
    }
    found.push({ body, line: src.slice(0, i).split("\n").length, offenders });
    i += body.length - 1;
  }
  return found;
}

const SITES = ROOTS.flatMap((rootDir) =>
  walk(rootDir).flatMap((file) => {
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    return findHiddenClipRects(readFileSync(file, "utf8")).map((site) => ({ ...site, file: rel }));
  }),
);

describe("every visually-hidden clip-rect in the tree expresses its lengths with a unit", () => {
  it("finds the sites at all, so an empty sweep cannot pass", () => {
    // Enumerated by hand when this file was written: seven, across
    // lib/copilot/answerStatus.js (the shared one), ChatPanel,
    // ExperienceTab, knowledgePanelStyles, TechWatchPanel's inline sx, and the
    // two meeting copies. A lower bound, so a legitimate new region does not
    // fail this file for the wrong reason — but zero must be impossible.
    expect(SITES.length, `found ${SITES.length} clip-rect literals`).toBeGreaterThanOrEqual(7);
  });

  for (const site of SITES) {
    it(`${site.file}:${site.line} writes no unitless length`, () => {
      expect(
        site.offenders.map((o) => `${o.key}: ${o.value}`),
        `${site.file}:${site.line} passes unitless lengths to sx, which rescales them ` +
          `(width/height 0..1 -> a percentage, margin -> the 8px spacing scale). ` +
          `Import lib/copilot/answerStatus.js's visuallyHidden instead of writing a fourth copy.`,
      ).toEqual([]);
    });
  }
});

describe("the classifier itself", () => {
  const bad = `const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};`;

  const good = bad.replace("width: 1,", 'width: "1px",').replace("height: 1,", 'height: "1px",').replace("margin: -1,", 'margin: "-1px",');

  it("reports a planted plain-CSS clip-rect as failing the rule", () => {
    // The positive control for the whole file: if this shape stopped being
    // detected, every generated case above would pass vacuously.
    const [site] = findHiddenClipRects(bad);
    expect(site).toBeTruthy();
    expect(site.offenders.map((o) => o.key).sort()).toEqual(["height", "margin", "width"]);
  });

  it("accepts the unit-bearing version", () => {
    const [site] = findHiddenClipRects(good);
    expect(site).toBeTruthy();
    expect(site.offenders).toEqual([]);
  });

  it("does not treat a bare 0 padding as unitless-length bug", () => {
    // `padding: 0` and `border: 0` are correct in every copy. A rule that
    // flagged them would be pressure to churn correct code, and the first
    // person to hit it would widen the exemption rather than read it.
    expect(findHiddenClipRects(good)[0].offenders).toEqual([]);
    expect(findHiddenClipRects(good.replace('margin: "-1px",', "margin: 0,"))[0].offenders).toEqual([]);
  });

  it("matches an inline sx literal, not just a named constant", () => {
    // app/components/experience/TechWatchPanel.js writes it inline, so a
    // classifier keyed on `const visuallyHidden =` would miss a whole shape.
    const src = '<Box sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} />';
    const [site] = findHiddenClipRects(src);
    expect(site).toBeTruthy();
    expect(site.offenders.map((o) => o.key).sort()).toEqual(["height", "width"]);
  });

  it("ignores an absolutely positioned object that is not a clip-rect", () => {
    // A `position: absolute` overlay with a real 100% width is ordinary,
    // correct MUI. The clip is what narrows this sweep to screen-reader-only
    // regions, where a percentage can only ever be a mistake.
    expect(findHiddenClipRects('const overlay = { position: "absolute", inset: 0, width: 1 };')).toEqual([]);
  });

  it("ignores a clip-rect written inside a comment", () => {
    // Several files in this tree explain the bug in prose, quoting the broken
    // object. Counting that prose as a site would fail the very files that
    // documented the fix.
    const src = `// const visuallyHidden = { position: "absolute", width: 1, clip: "rect(0 0 0 0)" };\nconst x = 1;`;
    expect(findHiddenClipRects(src)).toEqual([]);
  });

  it("reports the outermost literal once, not once per nested brace", () => {
    const [site, ...rest] = findHiddenClipRects(bad);
    expect(rest).toEqual([]);
    expect(site.body.startsWith("{")).toBe(true);
  });
});
