// The FOURTH-CALL-SITE instrument -- design-reconciled.r2.md ss4.4 / SEC ss3.3.
//
// WHY THIS FILE EXISTS, NOT ANOTHER BEHAVIOURAL FIXTURE. A test that plants a
// stored name and asserts the THREE known call sites correctly exempt it
// (./nameExemptionThreading.test.js does exactly that) can never, by
// construction, catch a FUTURE FOURTH call site added somewhere else in the
// tree -- a runtime test only exercises call sites it already knows to
// invoke. This repo has already paid for that exact gap twice, in the SAME
// wave this chunk's brief points at: docs/backlog.yml's N19/N20 entries
// (lib/duplicateApply/duplicateApplyPurity.test.js, confirmed to exist by
// Glob this round) found a DENYLIST of forbidden import patterns with a hole
// -- the fix that entry names is an ALLOWLIST source-text sweep, the exact
// shape this file copies (lib/sourceScan/exportReachability.sweep.test.js is
// the other precedent, also confirmed to exist by Glob this round).
//
// TWO INDEPENDENT PROPERTIES, per design-reconciled.r2.md ss4.3's reviewer
// property:
//   1. CENSUS -- every call to normalizePack(/countRefusedLines( anywhere in
//      app/+lib/ (production code, never a .test.js file) is at one of the
//      four hand-maintained, known-safe locations. A fifth call site
//      anywhere else fails this exactly, on the day it is written.
//   2. THREADING -- each of those four call sites passes a THIRD argument
//      (storedNames) that is not simply absent and is not one of the
//      forbidden literal expressions ("pack", "parsed", "parsed.pack",
//      "body") design-reconciled.r2.md ss4.3 names by name -- the shapes a
//      value descending from the model's own reply or the request body
//      would take. THIS IS RED TODAY: none of the four calls pass a third
//      argument at all (confirmed by direct read, this round, of route.js
//      and prepStore.js).
//
// refusesLine is NOT exported by prepParse.js (confirmed this round: no
// `export` keyword on its declaration, prepParse.js:350) -- it has ZERO
// possible external call sites by construction, so the "future fifth call
// site" risk this file exists to catch does not apply to it at all. Its own
// two internal callers (normalizeDroppingList, normalizeStage) live inside
// the same file and are reviewable in one read; this file's own structural
// test below pins that non-exported fact so a future export of it is a
// deliberate, visible act.
//
// CANARY, so a zero result from the real-tree scan is not a dead scanner:
// this file's own [control] census test below is asserted to find a
// NON-EMPTY set of real call sites (>= 4) before it is asserted to equal the
// allowlist -- a scanner that matches nothing would pass the "equals []"
// shape of a broken test vacuously; asserting a positive count first rules
// that out. A second, independent canary: this file's OWN prose above
// mentions "normalizePack(" and "countRefusedLines(" many times in comments;
// the extractor strips comments before scanning (verified against a planted
// fixture below), so this file's own header cannot inflate its own count.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));

/** Strips /* *‍/ and // comments, same discipline as
 *  lib/duplicateApply/duplicateApplyPurity.test.js's own stripComments --
 *  naive quote tracking, sufficient for this repo's own source style. */
function stripComments(src) {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      let inString = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) {
          if (ch === "\\") {
            i += 1;
            continue;
          }
          if (ch === inString) inString = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch;
          continue;
        }
        if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Every production `.js` file under app/ and lib/ (never a .test.js, never
 *  this sweep's own path) -- the same universe convention
 *  exportReachability.sweep.test.js uses. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js") && path.resolve(full) !== SELF_PATH) {
      out.push(full);
    }
  }
  return out;
}

/** True when the identifier at `matchIndex` is a FUNCTION DECLARATION
 *  (`function normalizePack(` / `export function normalizePack(`), never a
 *  CALL -- a naive `\bname\s*\(` regex matches both, and prepParse.js's own
 *  `export function normalizePack(pack) {` would otherwise be misreported
 *  as an extra call site inside its own defining file. */
function isDeclaration(strippedSrc, matchIndex) {
  const before = strippedSrc.slice(Math.max(0, matchIndex - 40), matchIndex);
  return /function\s*$/.test(before);
}

/** Paren-balanced extraction of every `fnName(...)` call's own argument-list
 *  text, over an already comment-stripped source string. Anchored on a word
 *  boundary so a differently-named identifier ending in the same letters
 *  (e.g. a hypothetical `myNormalizePack(`) can never match, and a function
 *  DECLARATION (isDeclaration above) is skipped rather than counted as a
 *  call. */
function findCalls(strippedSrc, fnName) {
  const calls = [];
  const re = new RegExp(`\\b${fnName}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(strippedSrc))) {
    if (isDeclaration(strippedSrc, m.index)) continue;
    const openIdx = strippedSrc.indexOf("(", m.index);
    let depth = 0;
    let i = openIdx;
    for (; i < strippedSrc.length; i++) {
      if (strippedSrc[i] === "(") depth += 1;
      else if (strippedSrc[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({ index: m.index, argsText: strippedSrc.slice(openIdx + 1, i) });
    re.lastIndex = i + 1;
  }
  return calls;
}

/** Splits a call's argument-list text on TOP-LEVEL commas only, tolerating
 *  nested (), [], {} and simple string literals -- modelled on
 *  test/helpers/supabaseFake.js's splitSelect. */
function splitTopLevelArgs(argsText) {
  if (argsText.trim() === "") return [];
  const out = [];
  let depth = 0;
  let current = "";
  let inString = null;
  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];
    if (inString) {
      current += ch;
      if (ch === "\\") {
        current += argsText[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function relPath(full) {
  return path.relative(ROOT, full).split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// THE ALLOWLIST -- exactly the four known-safe locations, identified by the
// FIRST argument's exact, current source text (stable across the RED->GREEN
// transition, since the fix APPENDS a trailing storedNames argument rather
// than rewriting the existing one).
// ---------------------------------------------------------------------------
const KNOWN_CALL_SITES = [
  { file: "app/api/interview-prep/route.js", fn: "normalizePack", firstArg: "parsed.pack", why: "route.js:455, the model-path pre-write normalization" },
  { file: "app/api/interview-prep/route.js", fn: "countRefusedLines", firstArg: "parsed.pack", why: "route.js:466, logging-only refused-line count" },
  { file: "lib/interviewPrep/prepStore.js", fn: "normalizePack", firstArg: "pack", why: "prepStore.js:377, writePrepPackResult's own normalize-before-write" },
  { file: "lib/interviewPrep/prepStore.js", fn: "normalizePack", firstArg: "packRow.pack ?? null", why: "prepStore.js:188, readPrepPack's own normalize-before-return" },
];
const FORBIDDEN_TRAILING_ARGS = new Set(["pack", "parsed", "parsed.pack", "body"]);

function realCallSites() {
  const files = walk(path.join(ROOT, "app")).concat(walk(path.join(ROOT, "lib")));
  const sites = [];
  for (const full of files) {
    const stripped = stripComments(readFileSync(full, "utf8"));
    for (const fn of ["normalizePack", "countRefusedLines"]) {
      for (const call of findCalls(stripped, fn)) {
        sites.push({ file: relPath(full), fn, args: splitTopLevelArgs(call.argsText) });
      }
    }
  }
  return sites;
}

describe("[control] the extractor sees a real, non-empty set of call sites -- a canary against a dead scanner", () => {
  it("finds at least the four known call sites in the real tree", () => {
    const sites = realCallSites();
    expect(sites.length).toBeGreaterThanOrEqual(4);
  });

  it("[canary] this file's own prose (which names normalizePack/countRefusedLines many times in comments) contributes ZERO call sites -- proves comments are stripped, not merely present", () => {
    const stripped = stripComments(readFileSync(SELF_PATH, "utf8"));
    // The header above deliberately writes "normalizePack(" inside prose;
    // stripComments must remove every line it appears on as a `//` comment,
    // and this file excludes itself from the walk besides.
    const commentOnlyMentions = (readFileSync(SELF_PATH, "utf8").match(/normalizePack\(/g) || []).length;
    expect(commentOnlyMentions).toBeGreaterThan(0); // the canary really is present in the raw file
    expect(findCalls(stripped, "normalizePack").length).toBe(0); // and gone once stripped
  });
});

describe("CENSUS -- every real call site is one of the four known-safe locations, matched in both directions", () => {
  it("[the census itself] the real tree's call sites, reduced to {file, fn, firstArg}, match the allowlist EXACTLY", () => {
    const sites = realCallSites().map((s) => ({ file: s.file, fn: s.fn, firstArg: s.args[0] }));
    const allowlisted = KNOWN_CALL_SITES.map((s) => ({ file: s.file, fn: s.fn, firstArg: s.firstArg }));
    const sortKey = (s) => `${s.file}#${s.fn}#${s.firstArg}`;
    expect(sites.map(sortKey).sort()).toEqual(allowlisted.map(sortKey).sort());
  });

  it("keeps a stated reason on every allowlisted site", () => {
    for (const site of KNOWN_CALL_SITES) {
      expect(site.why.length, `${site.file}#${site.fn} has no stated reason`).toBeGreaterThan(20);
    }
  });
});

describe("THREADING -- RED TODAY: each known-safe call site must pass a storedNames-shaped THIRD argument, never omitted and never a forbidden expression", () => {
  for (const site of KNOWN_CALL_SITES) {
    it(`${site.file} :: ${site.fn}(${site.firstArg}, ...) carries a real third argument that is not one of {pack, parsed, parsed.pack, body}`, () => {
      const sites = realCallSites().filter(
        (s) => s.file === site.file && s.fn === site.fn && s.args[0] === site.firstArg,
      );
      expect(sites.length, `no call to ${site.fn}(${site.firstArg}, ...) found in ${site.file}`).toBeGreaterThan(0);
      for (const found of sites) {
        const trailing = found.args[1];
        expect(trailing, `${site.file}::${site.fn}(${site.firstArg}) has no third argument yet`).toBeTruthy();
        expect(
          FORBIDDEN_TRAILING_ARGS.has(trailing),
          `${site.file}::${site.fn}(${site.firstArg}, ${trailing}) threads a forbidden, model/body-descended expression as storedNames`,
        ).toBe(false);
      }
    });
  }
});

describe("[positive control on the SWEEP MECHANISM ITSELF] a planted fixture proves the census and the forbidden-argument check can both actually fire", () => {
  it("[mutant this kills] a planted fifth call site, in a synthetic file, is detected as extra by the census logic", () => {
    const plantedSrc = `
      import { normalizePack } from "@/lib/interviewPrep/prepParse.js";
      export function suspiciousHelper(pack) {
        return normalizePack(pack, pack.someHostileField);
      }
    `;
    const stripped = stripComments(plantedSrc);
    const calls = findCalls(stripped, "normalizePack").map((c) => splitTopLevelArgs(c.argsText));
    expect(calls).toEqual([["pack", "pack.someHostileField"]]);
    // The allowlist has no entry for firstArg === "pack" alongside this
    // fabricated file path -- a census comparison against the real allowlist
    // would report this as an unlisted, extra call site.
    const matchesAllowlist = KNOWN_CALL_SITES.some((s) => s.file === "app/planted/fake.js");
    expect(matchesAllowlist).toBe(false);
  });

  it("[mutant this kills] a planted call that threads the forbidden literal 'parsed.pack' as storedNames is caught by the forbidden-argument check", () => {
    const plantedSrc = `const x = normalizePack(parsed.pack, parsed.pack);`;
    const calls = findCalls(stripComments(plantedSrc), "normalizePack").map((c) => splitTopLevelArgs(c.argsText));
    expect(calls).toEqual([["parsed.pack", "parsed.pack"]]);
    expect(FORBIDDEN_TRAILING_ARGS.has(calls[0][1])).toBe(true);
  });

  it("[no-op control] a correctly-threaded planted call (storedNames sourced from neither pack/parsed/parsed.pack/body) passes the forbidden-argument check", () => {
    const plantedSrc = `const x = normalizePack(parsed.pack, storedNames);`;
    const calls = findCalls(stripComments(plantedSrc), "normalizePack").map((c) => splitTopLevelArgs(c.argsText));
    expect(FORBIDDEN_TRAILING_ARGS.has(calls[0][1])).toBe(false);
  });

  it("[canary] the paren-balanced extractor is not fooled by nested parens/brackets in the first argument (packRow.pack ?? null, a ternary, or a function call)", () => {
    const plantedSrc = `normalizePack(pack != null ? normalizePack(pack) : pack, [a, b].join(","), storedNames);`;
    const calls = findCalls(stripComments(plantedSrc), "normalizePack");
    // The OUTER call's args must be split into exactly three top-level
    // pieces despite the nested call, array, and string-with-a-comma inside
    // the second argument.
    const outer = calls.find((c) => c.argsText.includes("storedNames"));
    expect(outer).toBeDefined();
    expect(splitTopLevelArgs(outer.argsText).length).toBe(3);
  });
});

describe("structural fact this file's own risk assessment depends on: refusesLine is not exported", () => {
  it("prepParse.js exports no symbol named refusesLine -- it has zero possible EXTERNAL call sites, so this sweep does not need to scan for it outside its own file", async () => {
    const mod = await import("./prepParse.js");
    expect(mod.refusesLine).toBeUndefined();
  });

  it("[canary] the same import DOES expose the functions this sweep is actually responsible for, proving the import itself resolved", async () => {
    const mod = await import("./prepParse.js");
    expect(typeof mod.normalizePack).toBe("function");
    expect(typeof mod.countRefusedLines).toBe("function");
  });
});
