// N151a (4b) — T12: the client resolver resolveDefaultTemplateFile(userId, kind)
// and its four egress surfaces stay UNCHANGED (design §4.2 / ST-6 / PL-9 / R14).
// N151a makes the resolver selection-aware entirely inside the ROUTE; the client
// signature and every call site must NOT move. A source-text census (comments
// stripped with the shared tokenizer, per the loop-traps rule).
//
// This is a REGRESSION GUARD: it is GREEN on HEAD (the call sites already match)
// and goes RED only if the arity changes or a surface is added/removed. The
// mutation it is built to catch: changing the resolver to arity 3 (a call site
// passing a third argument). No-op control it must survive: reformatting the
// call sites (the parser is whitespace-tolerant). Disclosed as green-on-HEAD in
// tests.r1.md.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../sourceScan/tokenizeSource.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SYMBOL = "resolveDefaultTemplateFile";

// The four egress surfaces and their expected resolve-call counts (plan F9,
// re-verified this session): post-gen + feed/auto download (page.js, 2 each),
// Drive save (useDriveDocuments.js, 2), in-modal preview (useDocumentPreview.js, 1).
const SURFACES = [
  { file: "app/page.js", calls: 4 },
  { file: "app/hooks/useDriveDocuments.js", calls: 2 },
  { file: "app/hooks/useDocumentPreview.js", calls: 1 },
];
const TOTAL_CALLS = SURFACES.reduce((n, s) => n + s.calls, 0);

// Extract the argument list of every `SYMBOL(` call, balancing parens so a
// `currentUser?.id` style argument is not truncated. Returns one arg-string per
// call. Call sites here contain no nested parens in their args; the balancer is
// defensive.
function callArgStrings(src) {
  const out = [];
  const needle = `${SYMBOL}(`;
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    let depth = 0;
    let j = i + needle.length - 1; // at the "("
    let start = j + 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(start, j));
    i = j + 1;
  }
  return out;
}

// Top-level argument count: commas not inside nested parens/brackets/braces.
function arityOf(argString) {
  if (argString.trim() === "") return 0;
  let depth = 0;
  let commas = 0;
  for (const c of argString) {
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) commas++;
  }
  return commas + 1;
}

function strippedOf(file) {
  return stripComments(readFileSync(path.join(ROOT, file), "utf8"));
}

describe("[src] resolver surfaces are arity-2 and unchanged (T12 / R14)", () => {
  it("[canary] the call parser reads arity and the stripper hides a commented call", () => {
    expect(callArgStrings(`${SYMBOL}(a, "resume")`).map(arityOf)).toEqual([2]);
    expect(callArgStrings(`${SYMBOL}(a, b, c)`).map(arityOf)).toEqual([3]);
    // A commented-out call must not be counted after stripping.
    const commented = stripComments(`const x = 1; // ${SYMBOL}(a, b, c)\n`);
    expect(callArgStrings(commented)).toHaveLength(0);
    // But a real call survives stripping.
    const real = stripComments(`const f = ${SYMBOL}(a, "cover"); // note\n`);
    expect(callArgStrings(real).map(arityOf)).toEqual([2]);
  });

  for (const { file, calls } of SURFACES) {
    it(`${file}: imports ${SYMBOL} and calls it exactly ${calls}x, every call arity 2`, () => {
      const src = strippedOf(file);
      expect(src, `${file} does not import ${SYMBOL}`).toMatch(
        new RegExp(`import[\\s\\S]*?\\b${SYMBOL}\\b[\\s\\S]*?from`),
      );
      const args = callArgStrings(src);
      expect(args.length, `${file} call count drifted`).toBe(calls);
      for (const a of args) {
        expect(arityOf(a), `an ${SYMBOL} call in ${file} is not arity 2: (${a.trim()})`).toBe(2);
      }
    });
  }

  it(`there are exactly ${TOTAL_CALLS} resolver calls across the surfaces (no surface added or dropped)`, () => {
    const total = SURFACES.reduce((n, { file }) => n + callArgStrings(strippedOf(file)).length, 0);
    expect(total).toBe(TOTAL_CALLS);
  });
});

// WHAT THIS CANNOT CATCH: a source-text census pins the CALL SHAPE, not runtime
// behaviour — the selection-awareness itself is proven at the route (T8). It
// also cannot see a call site that renames the symbol (anchored by symbol, per
// the design's blast-radius note).
