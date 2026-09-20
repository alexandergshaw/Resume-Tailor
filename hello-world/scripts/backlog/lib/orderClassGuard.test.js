// CLASS-LEVEL guards for backlog N31 ("the backlog's hand-set priority order never reaches any of
// its consumers, because every one re-sorts by numeric id"). The per-call-site tests in
// pick.test.js, renderMarkdown.test.js and wave.test.js each prove ONE of the 8 fixed call sites
// cannot regress silently. This file proves something narrower but different: that the DEFECT
// CLASS -- any consumer, existing or not-yet-written, choosing to sort backlog items by id again
// -- cannot land with every test green.
//
// Two independent instruments, of two different kinds, each with a stated blind spot (per
// [[loop-traps-search]]'s "test the class, not the instances").
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listAllFiles } from "./listFiles.mjs";
import { parseBacklogYaml } from "./yamlLite.mjs";
import { renderMarkdown } from "./renderMarkdown.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // .../hello-world/scripts/backlog/lib
const BACKLOG_SCRIPTS_ROOT = join(HERE, ".."); // .../hello-world/scripts/backlog

/**
 * True if `text` contains an import of `compareIds` from a relative "idOrder" module specifier.
 * Matches both `./idOrder.mjs` and `../lib/idOrder.mjs` shaped specifiers, tolerant of single or
 * double quotes and of other named imports sharing the same `{ ... }` clause.
 */
function importsCompareIds(text) {
  return /import\s*\{[^}]*\bcompareIds\b[^}]*\}\s*from\s*["'][^"']*idOrder(\.mjs)?["']/.test(text);
}

describe("CLASS GUARD (N31), instrument 1: no production source re-adopts compareIds", () => {
  it("canary: importsCompareIds() detects a known-positive import shape and rejects a known-negative one", () => {
    // Proves the detector itself works before trusting a clean sweep below -- an instrument that
    // never matches anything is indistinguishable from a broken one without this.
    expect(importsCompareIds('import { compareIds } from "./idOrder.mjs";')).toBe(true);
    expect(importsCompareIds('import { compareIds } from "../lib/idOrder.mjs";')).toBe(true);
    expect(importsCompareIds("import { compareIds } from './idOrder.mjs';")).toBe(true);
    expect(importsCompareIds('import { isBlocked } from "./blocked.mjs";')).toBe(false);
    expect(importsCompareIds('import { compareIds } from "./somethingElse.mjs";')).toBe(false);
  });

  it("no non-test .mjs file under scripts/backlog (other than idOrder.mjs itself) imports compareIds", () => {
    const files = listAllFiles(BACKLOG_SCRIPTS_ROOT).filter(
      (f) => f.endsWith(".mjs") && !f.endsWith(".test.js") && f !== "lib/idOrder.mjs",
    );
    expect(files.length).toBeGreaterThan(0); // canary that the file listing itself is not empty/broken

    const offenders = [];
    for (const rel of files) {
      const text = readFileSync(join(BACKLOG_SCRIPTS_ROOT, rel), "utf8");
      if (importsCompareIds(text)) offenders.push(rel);
    }

    // Resists vacuity: this fails on HEAD (before the N31 fix) because pick.mjs, renderMarkdown.mjs
    // and lib/wave.mjs all import compareIds today. After the fix, reintroducing a sort at ANY of
    // the 8 removed call sites -- or a brand-new fifth "what's next" consumer reaching for
    // compareIds out of habit, per this repo's own N31 history -- requires re-adding this import
    // and fails here, without needing to know the offending file's name in advance.
    //
    // WHAT THIS CANNOT CATCH: a future consumer that reimplements numeric-vs-lexical id ordering
    // WITHOUT calling compareIds by name -- an inline comparator, a copy-pasted regex, or a
    // `Number(id.replace(/\D/g, ""))` sort -- reproduces the identical user-visible defect and
    // this sweep says nothing about it, because it is a source-text check for one specific name,
    // never a behavioral one. It also cannot catch a rebuild through an id-keyed intermediate
    // object (`Object.values()` reordering) -- that hazard has no ".sort(" or "compareIds" text to
    // find at all; it is covered instead by yamlLite.test.js's literal-order assertion.
    expect(offenders).toEqual([]);
  });
});

describe("CLASS GUARD (N31), instrument 2: order survives end-to-end, from raw YAML bytes to rendered markdown", () => {
  it("a synthetic backlog.yml with non-ascending ids in all three sections renders every table in FILE order", () => {
    // Deliberately non-monotonic in every namespace at once (N9,N30,N1 / D9,D2 / V9,V2), so this
    // single test exercises parseBacklogYaml's array order AND all three of renderMarkdown's sort
    // sites (n, d, v) together, from raw text through to the final markdown string -- not through
    // any intermediate function's return value.
    const text = [
      '- id: "N9"',
      '  state: "actionable"',
      '  title: "T9"',
      '  owed_by: "o9"',
      '  evidence: ["e9"]',
      '  blocked_reason: null',
      '  instrument: null',
      '  owns: null',
      '  verify: null',
      '  verify_proof: null',
      '  blocked_by: []',
      '- id: "N30"',
      '  state: "actionable"',
      '  title: "T30"',
      '  owed_by: "o30"',
      '  evidence: ["e30"]',
      '  blocked_reason: null',
      '  instrument: null',
      '  owns: null',
      '  verify: null',
      '  verify_proof: null',
      '  blocked_by: []',
      '- id: "N1"',
      '  state: "actionable"',
      '  title: "T1"',
      '  owed_by: "o1"',
      '  evidence: ["e1"]',
      '  blocked_reason: null',
      '  instrument: null',
      '  owns: null',
      '  verify: null',
      '  verify_proof: null',
      '  blocked_by: []',
      '- id: "D9"',
      '  state: "owner"',
      '  title: "Q9"',
      '  owed_by: null',
      '  evidence: []',
      '  blocked_reason: "bd9"',
      '  instrument: null',
      '  owns: null',
      '  verify: null',
      '  verify_proof: null',
      '  blocked_by: []',
      '- id: "D2"',
      '  state: "owner"',
      '  title: "Q2"',
      '  owed_by: null',
      '  evidence: []',
      '  blocked_reason: "bd2"',
      '  instrument: null',
      '  owns: null',
      '  verify: null',
      '  verify_proof: null',
      '  blocked_by: []',
      '- id: "V9"',
      '  state: "verification"',
      '  title: "R9"',
      '  owed_by: null',
      '  evidence: []',
      '  blocked_reason: null',
      '  instrument: "i9"',
      '  owns: null',
      '  verify: null',
      '  verify_proof: null',
      '  blocked_by: []',
      '- id: "V2"',
      '  state: "verification"',
      '  title: "R2"',
      '  owed_by: null',
      '  evidence: []',
      '  blocked_reason: null',
      '  instrument: "i2"',
      '  owns: null',
      '  verify: null',
      '  verify_proof: null',
      '  blocked_by: []',
    ].join("\n");

    const items = parseBacklogYaml(text);
    // Sanity: the parser itself did not reorder anything (already covered directly by
    // yamlLite.test.js; re-asserted here so a failure below is attributable to renderMarkdown, not
    // to a parse-time surprise in this test's own fixture).
    expect(items.map((it) => it.id)).toEqual(["N9", "N30", "N1", "D9", "D2", "V9", "V2"]);

    const md = renderMarkdown(items);
    const nOrder = [...md.matchAll(/^\| (N\d+) \|/gm)].map((m) => m[1]);
    const dOrder = [...md.matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]);
    const vOrder = [...md.matchAll(/^\| (V\d+) \|/gm)].map((m) => m[1]);

    // Resists vacuity: HEAD's `.sort(compareIds)` at renderMarkdown.mjs:28/29/30 would emit
    // ["N1","N9","N30"], ["D2","D9"], ["V2","V9"] here -- the reverse of two of the three, and a
    // different order for the first.
    expect(nOrder).toEqual(["N9", "N30", "N1"]);
    expect(dOrder).toEqual(["D9", "D2"]);
    expect(vOrder).toEqual(["V9", "V2"]);
  });
});
