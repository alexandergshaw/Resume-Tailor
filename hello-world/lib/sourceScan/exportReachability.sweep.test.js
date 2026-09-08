// "Is this exported thing reachable from anything that ships?", as an
// executable invariant.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// Three defects found by hand in one session, none of which any gate in this
// repo could see:
//
//   1. lib/duplicateApply/duplicateApplyLog.js -- a whole module with a
//      careful header and a green test suite, and NOTHING imported it. The
//      standing "every feature that can carry a log gets one, plus a visible
//      download button" rule was satisfied on paper and not at all for a user,
//      who had no log to read. (Wired up separately; it is reachable today.)
//   2. lib/tracking/applicationDigest.js's `parseDigestAnswer` -- exported,
//      tested, no production caller; the live route uses `buildCitedDigest`.
//   3. app/hooks/useKnowledgeScope.js's `summaryViewFor` -- `export`ed with no
//      importer at all, its six states pinned only indirectly through seven
//      jsdom mounts.
//
// All three had GREEN TESTS. That is the entire point: **a `.test.js` file is
// not a caller.** Reachability here starts from what Next.js actually loads --
// `app/**/page.js`, `app/**/layout.js`, `app/**/route.js` and `middleware.js`
// -- and follows only real imports out of those.
//
// The sibling sweeps (app/components/hrefSafety.sweep.test.js,
// app/components/windowOpenSafety.sweep.test.js,
// app/components/experience/knowledgeSafety.sweep.test.js) prove SAFETY
// properties. This one proves a WIRING property, and it uses the same shared,
// regex-literal-aware stripper they do -- lib/sourceScan/tokenizeSource.js --
// rather than a fourth private copy. One earlier fork of that stripper was
// silently wrong and under-reported real sites with no error at all.
//
// ---------------------------------------------------------------------------
// WHAT THE RESOLVER UNDERSTANDS, AND WHAT IT DOES NOT
// ---------------------------------------------------------------------------
// lib/sourceScan/exportGraph.js's header is the authoritative list and is
// longer than this summary. The short version:
//
//   UNDERSTOOD  every static import form (default, named, aliased, namespace,
//               side-effect, multi-line clauses); every export form
//               (`function`/`async function`/`function*`/`class`/`const`/
//               `let`/`var`, `default`, `export { a as b }`,
//               `export { a } from "s"`, `export * from "s"`,
//               `export * as ns from "s"`); dynamic `import("s")` with a
//               static string, including the `const { a } = await import(...)`
//               destructuring both production sites use; `./`, `../` and `@/`
//               specifiers resolved through `s`, `s.js`, `s.mjs`,
//               `s/index.js`; non-JS specifiers classified as assets rather
//               than silently "unresolved".
//
//   NOT         computed specifiers (`import(`./${x}.js`)`) -- none exist
//               here, and `no local specifier goes unresolved` below is what
//               makes that a checked fact rather than a hope;
//               namespace MEMBER access (`import * as ns` marks EVERY export
//               of that module used -- it can hide a dead export, never invent
//               one); whether an imported binding is actually used in the
//               importer (that is ESLint's `no-unused-vars`, which runs here);
//               `require()` (none in app/ or lib/); runtime/string-keyed
//               registration; anything outside app/ + lib/ + middleware.js.
//
// A `.js` file whose only importer lives under `test/` is therefore correctly
// reported unreachable -- `test/` is not shipping code.
//
// ---------------------------------------------------------------------------
// THE LEDGER, AND WHY IT HAS THREE BUCKETS INSTEAD OF ONE ALLOW-LIST
// ---------------------------------------------------------------------------
// A first run over this tree found 10 unreachable modules and 355 exported
// symbols that no shipping code asks for. An allow-list of 365 undifferentiated
// entries would BURY the findings it exists to surface, which is the exact
// failure mode this sweep must avoid. So the census is split by a MEASURED
// property, not by taste:
//
//   RULE TR-1 (298 symbols)  the export is unused by shipping code, but at
//       least one `.test.js` imports it BY NAME. This repo's dominant
//       convention is to widen a module's export surface so a unit test can
//       pin an internal helper or a threshold constant directly instead of
//       through the public function. Such a symbol has a real consumer, so it
//       is a deliberately widened surface rather than a lost feature. Covered
//       by rule and COUNTED EXACTLY -- not enumerated, because 298 lines of
//       boilerplate is how the 56 below would get lost. Raising that count is
//       a review event: see the assertion's own comment.
//
//   ORPHAN_EXPORTS (56 symbols)  unused by shipping code AND imported by no
//       test anywhere. Nothing in this repository reads these. Each carries
//       its own line and its own stated reason. This is where `summaryViewFor`
//       lands. NOTE the boundary this bucket does NOT police: "unused" here
//       means no OTHER module imports the name. A symbol its own module calls
//       is still listed, and deleting one on the strength of this line alone
//       is how live code gets removed -- read each entry's `why`, and grep,
//       before cutting. docx.js#buildDocxFromUploadedTemplate is the worked
//       example of exactly that near-miss.
//
//   ALLOWED_UNREACHABLE_MODULES (9) / UNWIRED_MODULES (0)  whole files no
//       entry point can reach. The nine are sweep and test infrastructure
//       (including this sweep's own ledger module -- see its self-entry
//       there) and are justified one by one. The findings bucket is empty
//       because all three of its entries were reviewed and deleted -- see
//       the block comment above UNWIRED_MODULES in ./exportReachability.ledger.js.
//
// Every entry in every bucket must carry a reason; the sweep asserts that, so
// "add it to the list" is never the cheap way out. The two module buckets and
// ORPHAN_EXPORTS are matched EXACTLY: a new dead export fails this file on the
// day it is written, and so does a stale entry left behind after something is
// wired up or removed. The buckets themselves are DATA now, in
// ./exportReachability.ledger.js; this file owns the scan and the assertions
// that hold that data to account.
//
// NOTHING IS DELETED OR WIRED UP BY THIS FILE. It is a census.
//
// ---------------------------------------------------------------------------
// A SWEEP THAT FINDS NOTHING BECAUSE ITS SCANNER IS BROKEN IS INDISTINGUISHABLE
// FROM A CLEAN CODEBASE. The bottom of this file therefore carries a positive
// control (known-reachable exports ARE seen reachable, one per resolver
// feature), a false-negative control (a planted unreachable export IS caught),
// a false-positive control (an import or export written inside a comment or a
// string counts for nothing), and a BROKEN-SCANNER MUTANT: the graph is rebuilt
// over the real tree with a parser that returns nothing, and every positive
// control is asserted to go red.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildExportGraph, parseModuleSource, resolveSpecifier, entryKindOf } from "./exportGraph.js";
import { tokenizeSource } from "./tokenizeSource.js";
import {
  ALLOWED_UNREACHABLE_MODULES,
  UNWIRED_MODULES,
  ORPHAN_EXPORTS,
  DESYNCED_STATEMENTS,
} from "./exportReachability.ledger.js";

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// The universe: every production `.js` under app/ and lib/, plus middleware.js.
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

const rel = (full) => path.relative(ROOT, full).split(path.sep).join("/");

const PRODUCTION = new Map();
const TEST_FILES = new Map();
for (const dir of ["app", "lib", "test"]) {
  for (const full of walk(path.join(ROOT, dir))) {
    const r = rel(full);
    const src = readFileSync(full, "utf8");
    if (r.endsWith(".test.js") || r.startsWith("test/")) TEST_FILES.set(r, src);
    else PRODUCTION.set(r, src);
  }
}
PRODUCTION.set("middleware.js", readFileSync(path.join(ROOT, "middleware.js"), "utf8"));

const GRAPH = buildExportGraph({ files: PRODUCTION });
const DEAD_KEYS = new Set(GRAPH.deadExports.map((d) => `${d.file}#${d.name}`));

/** Which exported names does any test file import from this module? */
function testImportIndex(files) {
  const index = new Map();
  const fileSet = new Set(PRODUCTION.keys());
  for (const [from, src] of files) {
    for (const edge of parseModuleSource(src).imports) {
      const r = resolveSpecifier(edge.spec, from, fileSet);
      if (r.kind !== "module") continue;
      const add = (name) => {
        const key = `${r.file}#${name}`;
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(from);
      };
      if (edge.namespace) add("*");
      for (const name of edge.names) add(name);
    }
  }
  return index;
}
const TEST_IMPORTS = testImportIndex(TEST_FILES);
const importedByATest = (file, name) => TEST_IMPORTS.has(`${file}#${name}`) || TEST_IMPORTS.has(`${file}#*`);

// Symbols in a module shipping code DOES reach, that shipping code never asks
// for. (Exports of a wholly unreachable module are reported at module
// granularity instead, by the two module ledgers.)
const UNUSED_IN_SHIPPING_MODULES = GRAPH.deadExports.filter((d) => d.reason === "unused-export");
const TEST_REFERENCED = UNUSED_IN_SHIPPING_MODULES.filter((d) => importedByATest(d.file, d.name));
const ORPHANS = UNUSED_IN_SHIPPING_MODULES.filter((d) => !importedByATest(d.file, d.name));

// ---------------------------------------------------------------------------
// LEDGERS 1-3 (ALLOWED_UNREACHABLE_MODULES, UNWIRED_MODULES, ORPHAN_EXPORTS)
// now live in ./exportReachability.ledger.js, imported above. They moved
// there, verbatim, to bring this file under the repo's 1000-line cap -- see
// that module's own header for the full description of what each bucket
// means and why there are three of them instead of one undifferentiated
// allow-list. Nothing about what this file scans or asserts changed: the
// ledgers are still matched EXACTLY against the live scan below, in both
// directions, by the same assertions that always checked them.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers shared by the assertions and the controls.
// ---------------------------------------------------------------------------
const keyOf = (e) => `${e.file}#${e.name}`;
const sorted = (xs) => [...xs].sort();

/**
 * A reachable export, as this sweep defines it: the module ships, the scanner
 * SAW the symbol, and nothing reported it dead. All three clauses matter --
 * dropping the middle one is what lets a scanner that returns nothing pass
 * every positive control vacuously.
 */
function isReachableExport(graph, file, name) {
  if (!graph.shipping.has(file)) return false;
  const names = (graph.exportsByFile.get(file) || []).map((e) => e.name);
  if (!names.includes(name)) return false;
  return !graph.deadExports.some((d) => d.file === file && d.name === name);
}

// ---------------------------------------------------------------------------
// THE SCANNER'S OWN BLIND SPOT, MADE VISIBLE.
//
// Every `import`/`export` this scanner accepts is confirmed against
// tokenizeSource()'s `codeMask` view, so a statement written inside a comment
// or a template literal cannot register. The other side of that check is a
// blind spot: if the tokenizer wrongly believes a region is string data, a REAL
// statement there is silently dropped -- the module's export surface shrinks
// and a dead export in it can never be reported. That is an under-report with
// no error, which is the precise failure this repo already shipped once.
//
// So the rejected statements are enumerated rather than trusted, against
// DESYNCED_STATEMENTS (imported above from ./exportReachability.ledger.js,
// where its full history now lives -- moved verbatim along with the other
// three ledgers to bring this file under the line cap). Anything the
// codeMask check throws away must be on that list with a reason; it is
// empty today, which the assertions below turn into a live guard rather
// than a hope.
// ---------------------------------------------------------------------------

/** Line-start import/export tokens the codeMask confirmation threw away. */
function rejectedStatements(files) {
  const out = [];
  for (const [file, src] of files) {
    const { codeMask } = tokenizeSource(src);
    const re = /(^|\n)([^\S\n]*)(import|export)\b/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const at = m.index + m[1].length + m[2].length;
      if (codeMask.slice(at, at + m[3].length) === m[3]) continue;
      const text = src.slice(at, at + 120).split("\n")[0];
      const named = /^(?:import|export)\s+(?:async\s+)?(?:function|class|const|let|var|default)?\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(text);
      out.push({ file, name: named ? named[1] : text.trim().slice(0, 40), line: src.slice(0, at).split("\n").length });
    }
  }
  return out;
}

describe("the scanner's blind spot is enumerated, not trusted", () => {
  it("throws away exactly the statements on the desync ledger, and no others", () => {
    const rejected = rejectedStatements(PRODUCTION);
    expect(sorted(rejected.map(keyOf)), "a real import/export was silently dropped by the codeMask check").toEqual(
      sorted(DESYNCED_STATEMENTS.map(keyOf)),
    );
  });

  it("keeps a stated reason on every dropped statement", () => {
    for (const entry of DESYNCED_STATEMENTS) {
      expect(entry.why.length, `${keyOf(entry)} is excused with no reason`).toBeGreaterThan(60);
    }
  });

  it("reads the shape that used to defeat it, and sees straight through it now", () => {
    // The regression test for the fix. docx.js:358 still carries the nested
    // template (so this is a real fixture, not a hypothetical), and all three
    // exports the desync used to hide are now visible as real code.
    const src = readFileSync(path.join(ROOT, "lib/document/docx.js"), "utf8");
    expect(src).toMatch(/\$\{runProps \? `<w:rPr>\$\{runProps\}<\/w:rPr>` : ""\}/);
    const { codeMask } = tokenizeSource(src);
    for (const name of ["buildMinimalistDocx", "downloadMinimalistDocx", "resolveDocumentBlob"]) {
      expect(codeMask, `${name} is invisible to the scanner again`).toContain(
        `export async function ${name}`,
      );
    }
    // And the tokenizer refuses to hand back a view it could not parse,
    // rather than blanking a region and letting this sweep report clean.
    expect(() => tokenizeSource("const a = `never closed;\n")).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("the scan actually ran", () => {
  it("reads a real, whole tree rather than an empty one", () => {
    // Lower bounds, so ordinary growth does not fail this file for the wrong
    // reason -- but zero, or a tenth of the tree, must be impossible.
    expect(PRODUCTION.size).toBeGreaterThanOrEqual(550);
    expect(TEST_FILES.size).toBeGreaterThanOrEqual(500);
    const totalExports = [...GRAPH.exportsByFile.values()].reduce((n, list) => n + list.length, 0);
    expect(totalExports).toBeGreaterThanOrEqual(1500);
  });

  it("starts from the Next.js entry points, and from all of them", () => {
    expect(GRAPH.entries.length).toBeGreaterThanOrEqual(80);
    expect(GRAPH.entries).toContain("middleware.js");
    expect(GRAPH.entries).toContain("app/layout.js");
    expect(GRAPH.entries).toContain("app/page.js");
    expect(GRAPH.entries).toContain("app/copilot/page.js");
    expect(GRAPH.entries).toContain("app/api/tailor/route.js");
    // Every entry the walker found is an entry the graph started from.
    const walked = [...PRODUCTION.keys()].filter((r) => entryKindOf(r) !== null);
    expect(sorted(GRAPH.entries)).toEqual(sorted(walked));
  });

  it("reaches nearly the whole tree, so a broken BFS cannot look like a clean one", () => {
    expect(GRAPH.shipping.size).toBeGreaterThanOrEqual(500);
  });

  it("leaves no local specifier unresolved", () => {
    // THE load-bearing guard. A resolver that silently fails to resolve `./x`
    // drops the edge, and everything behind that edge looks dead -- a sweep
    // that cries wolf on real, wired code. If this ever fails, the resolver is
    // wrong, not the code.
    expect(
      GRAPH.unresolved.map((u) => `${u.file}:${u.line} -> ${u.spec}`),
      "a relative or @/-aliased specifier did not resolve to a file in the universe",
    ).toEqual([]);
    // …and it is empty because everything resolved, not because nothing was
    // read. Without this line a scanner that parses nothing passes here.
    expect(parseModuleSource(PRODUCTION.get("app/layout.js")).imports.length).toBeGreaterThan(3);
  });
});

describe("every module is reachable from something that ships, or is on a ledger with a reason", () => {
  it("matches the two module ledgers exactly", () => {
    const ledgered = sorted([
      ...ALLOWED_UNREACHABLE_MODULES.map((e) => e.file),
      ...UNWIRED_MODULES.map((e) => e.file),
    ]);
    // EXACT, in both directions. A newly orphaned module fails here on the day
    // it is written; so does a ledger entry left behind after something is
    // wired up, which keeps the census honest instead of merely permissive.
    expect(sorted(GRAPH.unreachableModules)).toEqual(ledgered);
  });

  it("keeps a stated reason on every allow-listed module", () => {
    for (const entry of ALLOWED_UNREACHABLE_MODULES) {
      expect(entry.why.length, `${entry.file} is allow-listed with no real reason`).toBeGreaterThan(40);
    }
    expect(ALLOWED_UNREACHABLE_MODULES).toHaveLength(9);
  });

  it("keeps the unwired-feature findings visible and described", () => {
    // These are NOT allow-listed. They are findings held in a named bucket so
    // that they cannot quietly become "just how it is". Wiring one up (or
    // removing it) fails the exact match above, which is the prompt to delete
    // its line here.
    //
    // The three ORIGINAL findings were all acted on -- deleted, not wired. The
    // two that replaced them, the shared rate limiter and its store, were acted
    // on the other way: WIRED. app/api/copilot/ask/route.js imports
    // createRateLimiter/identify/rateLimitHeaders at module scope, which made
    // both modules reachable from shipping code and failed the exact match
    // above until their lines were deleted -- the prompt working as designed,
    // in the direction this bucket was actually built for.
    expect(UNWIRED_MODULES.map((e) => e.file)).toEqual([]);
    for (const entry of UNWIRED_MODULES) {
      expect(entry.finding.length, `${entry.file} is recorded as unwired with no description`).toBeGreaterThan(60);
    }
  });

  it("does not let a test file count as a caller", () => {
    // The property the whole sweep rests on. It used to be asserted against
    // UNWIRED_MODULES; that bucket is now empty, and a `for` over an empty
    // array asserts nothing. So it is asserted against the allow-listed
    // unreachable modules instead -- every one of them is a probe or harness
    // that tests DO import, and each is still classified unreachable. Same
    // property, on data that cannot empty out from under it.
    expect(ALLOWED_UNREACHABLE_MODULES.length).toBeGreaterThan(0);
    for (const { file } of ALLOWED_UNREACHABLE_MODULES) {
      expect(GRAPH.shipping.has(file)).toBe(false);
      const importers = [...TEST_IMPORTS.entries()]
        .filter(([key]) => key.startsWith(`${file}#`))
        .flatMap(([, from]) => [...from]);
      expect(importers.length, `${file} was expected to have at least one test importer`).toBeGreaterThan(0);
    }
  });
});

describe("every export of a shipping module is asked for, or is on a ledger with a reason", () => {
  it("matches the orphan ledger exactly", () => {
    expect(sorted(ORPHANS.map(keyOf))).toEqual(sorted(ORPHAN_EXPORTS.map(keyOf)));
  });

  it("keeps a stated reason on every orphan", () => {
    // An entry with no reason is how a real finding gets buried. The length
    // floor is deliberately high enough that a placeholder cannot satisfy it.
    for (const entry of ORPHAN_EXPORTS) {
      expect(entry.why.length, `${keyOf(entry)} is on the ledger with no real reason`).toBeGreaterThan(60);
    }
    // 56 -> 56, and the SAME TOTAL HIDES TWO OPPOSITE MOVEMENTS. Do not read
    // this as "nothing happened".
    //
    //   -2  selectQueueCandidates.js#matchesIncludedCompany and
    //       upsertInterviewStage.js#deleteInterviewStage were acted on and
    //       DELETED. Both were referenced nowhere -- not by shipping code, not
    //       by a test, not even inside their own module -- which is what their
    //       entries said and what a by-name and by-path grep of the whole repo
    //       confirmed before the cut.
    //   +2  knowledgeBase.js#SEPARATOR and tailorContext.js#SEPARATOR MIGRATED
    //       IN from rule TR-1's bucket. Neither symbol changed. Their sole
    //       importer was lib/experience/untrustedText.test.js, and deleting
    //       that unreachable module's suite took the last outside reader of
    //       both with it. This is the census working: a deletion elsewhere
    //       demoted two exports, and the split moved even though the total
    //       did not.
    //
    // The third symbol reviewed alongside the two deletions,
    // docx.js#buildDocxFromUploadedTemplate, turned out to be LIVE and was
    // kept (see its corrected entry above), so it still occupies a line here.
    // 56 -> 64: the bullet-truncation chunk's eight, all added with reasons.
    // SEVEN of them are read by a test and are here only because that read goes
    // through a dynamic `await load()` this static index cannot follow -- so
    // unlike every entry above them, "nothing in this repository reads these"
    // is NOT true of the seven, and the bucket's headline claim is weaker for
    // them than for the rest. That is stated on each entry rather than left for
    // someone to discover by deleting one. The eighth,
    // answerLocal.js#groundingCandidates, is the ordinary shape: read inside its
    // own module, with the `export` keyword the only surplus part.
    expect(ORPHAN_EXPORTS).toHaveLength(64);
  });

  it("[RULE TR-1] counts the exports whose only consumer is a test, exactly", () => {
    // Raising this number means someone widened a module's export surface and
    // only a test consumed the new symbol. That is usually this repo's normal
    // whitebox-unit-test convention -- and it is ALSO exactly what
    // duplicateApplyLog.js, parseDigestAnswer and summaryViewFor looked like
    // the day before a human noticed. So it is a review event, not a warning:
    // check the new export is a helper being pinned, not a feature that was
    // built and never connected, then update the number.
    //
    // 299 -> 300, and NOT because the tree grew. This number was pinned at
    // 299 while the comment beside it said "the true figure is 300:
    // docx.js's buildMinimalistDocx belongs here too and is invisible to the
    // scan". Fixing tokenizeSource.js's nested-template desync made that one
    // export visible, so the scanner now counts what the comment already
    // knew. The other two exports the desync hid (downloadMinimalistDocx,
    // resolveDocumentBlob) were hand-checked as genuinely reachable and land
    // in neither bucket, which is why this moves by exactly one.
    //
    // 300 -> 298, and this number FELL, which is the direction the comment
    // above never anticipated. Deleting the three unwired modules could not
    // touch this bucket directly -- their own exports were filed as
    // `unreachable-module` (exportGraph.js:412), never as `unused-export`.
    // What moved it was the deleted TESTS: lib/experience/untrustedText.test.js
    // was the only file in the repo importing knowledgeBase.js#SEPARATOR and
    // tailorContext.js#SEPARATOR, so both exports lost their sole consumer and
    // were demoted into the orphan ledger. Deleting a test can lower this
    // count by demoting an export it alone kept alive; that is worth knowing
    // before anyone reads a drop here as "we wired something up".
    //
    // 298 -> 303, and every one of the five is a widened surface, not a lost
    // feature. Four belong to the session-wide activity log
    // (lib/activityLog/), whose five modules ARE all reached from shipping
    // code -- app/layout.js -> AppHeader -> SettingsMenu -> ActivityLogButton
    // and SettingsMenu -> activityInstrumentation -- so none of them is on
    // either module ledger; these are the four symbols beside that live path
    // that only a test asks for:
    //
    //   activityRedaction.js#REDACTED       the marker string the planted-
    //       secret suite asserts against, rather than re-spelling "[redacted]"
    //       in eight places.
    //   appActivityLog.js#createActivityLog the pure factory. The singleton
    //       beside it (recordActivity/attachActivitySection/
    //       activityLogSnapshot) is what ships; the factory exists so the
    //       recorder can be tested with an injected clock and without touching
    //       a module-level global, which is this repo's own reason for the
    //       `now = Date.now` idiom.
    //   appActivityLog.js#ACTIVITY_LOG_SCHEMA and #MAX_ACTIVITY_SECTIONS
    //       constants the suites pin directly instead of hard-coding 1 and 16.
    //       (MAX_ACTIVITY_EVENTS beside them is NOT here: activityLogDocument.js
    //       imports it to print the cap in the drop notice.)
    //
    // The fifth, lib/applications/untrackChip.js#isHiddenFromTracking, is not
    // this feature's: it arrived with the untrack-chip work landing in the same
    // tree (app/hooks/useUntrackChip.js, app/components/StatusBar.js) and is
    // counted here only because this number is a whole-tree census.
    //
    // 303 -> 304, and the ONE symbol is
    // lib/rateLimit/index.js#clientIpFromHeaders. It is not a new export and it
    // did not change: it moved BUCKETS. While lib/rateLimit was unwired, every
    // one of its exports was classified `unreachable-module` and reported by
    // the module ledger above instead of here (exportGraph.js:412). Wiring the
    // limiter into app/api/copilot/ask/route.js -- the event that emptied
    // UNWIRED_MODULES two cases up -- made the module reachable, which
    // reclassified all four of its exports as ordinary `unused-export`
    // candidates, and this is the one of the four that no shipping code asks
    // for. The check this comment's own instructions ask for was made: it is a
    // HELPER BEING PINNED, not a feature built and never connected --
    // `identify()` applies it on every call (index.js:265), and the reason it
    // is exported is that four cases in rateLimit.test.js drive the
    // forged-x-forwarded-for defence directly (rotating the attacker-controlled
    // left-hand entries, and the too-short-chain refusal), which cannot be
    // reached through `identify` alone. The other three -- createRateLimiter,
    // identify, rateLimitHeaders -- are all imported by the route and land in
    // neither bucket.
    //
    // ORPHANS is unchanged at 56, and nothing from the ask feature itself
    // appears in either half: every export of app/api/copilot/ask/route.js,
    // lib/copilot/askContext.js, askPrompt.js, askLocal.js, askTracking.js and
    // app/copilot/dashboard/AskAiBox.js is consumed by shipping code.
    // UNCHANGED at 304 across the bullet-truncation chunk, and that is worth a
    // sentence because the chunk DID add eight test-only exports. They landed in
    // the ORPHAN half instead, for two different reasons, both recorded on that
    // ledger: six are read through a DYNAMIC `await load()` in
    // lib/copilot/pointLength.test.js (a deliberate pattern so those cases could
    // fail before the module existed), and this index is built from STATIC
    // imports only, so the edge is real but invisible here. The eighth,
    // answerLocal.js#groundingCandidates, is called inside its own module.
    // Neither is a bucket move of the kind this number tracks.
    expect(TEST_REFERENCED.length).toBe(304);
    // A classifier that swept everything into this bucket would make the
    // orphan ledger vacuous, so pin the split rather than only the total.
    expect(UNUSED_IN_SHIPPING_MODULES.length).toBe(TEST_REFERENCED.length + ORPHANS.length);
    // 356 -> 354: exactly the two orphan symbols that were deleted
    // (matchesIncludedCompany, deleteInterviewStage). The two SEPARATORs
    // crossed from one half of the split to the other, which is invisible in
    // this total by construction -- 300 + 56 and 298 + 56 differ by the two
    // deletions alone.
    // 354 -> 359: exactly the five above, with ORPHAN_EXPORTS unmoved at 56.
    // The activity log deliberately contributes ZERO orphans -- two constants
    // it started with (MAX_ACTIVITY_FIELD_CHARS, truncateField in
    // activityRedaction.js) were caught by this very assertion on their first
    // run and un-exported, because both are applied inside that module and read
    // nowhere else.
    // 359 -> 360: the single reclassified clientIpFromHeaders described above,
    // with ORPHAN_EXPORTS again unmoved at 56 -- 304 + 56. This total moving by
    // exactly one, in step with TEST_REFERENCED and with the orphan half
    // frozen, is what says the change was a bucket move rather than a new
    // export surface.
    // 360 -> 368: the bullet-truncation chunk's eight, ALL of them in the orphan
    // half -- 304 + 64. Note which way this went, because the first reading of
    // it was wrong: the eight look like rule TR-1's shape (a widened surface a
    // suite pins directly) and they were briefly recorded as such, but TR-1's
    // index follows STATIC imports only and seven of the eight are read through
    // a dynamic `await load()`. The census reported them as orphans, which is
    // what this file's numbers actually say; the enumerated ledger is what
    // carries the truth that a test does read them.
    expect(UNUSED_IN_SHIPPING_MODULES.length).toBe(368);
  });

  it("still reports the two symbol-level cases this sweep was built for", () => {
    // Case 3: no importer at all -- an orphan.
    expect(ORPHANS.map(keyOf)).toContain("app/hooks/useKnowledgeScope.js#summaryViewFor");
    // Case 2: exported, tested, no production caller -- rule TR-1's bucket.
    // Naming it here means TR-1 can never be mistaken for "these are all fine".
    expect(TEST_REFERENCED.map(keyOf)).toContain("lib/tracking/applicationDigest.js#parseDigestAnswer");
    // …while the thing the live route DOES call is seen as reachable. (It
    // lives one module over, in digestCitations.js -- which is the point:
    // parseDigestAnswer was superseded, not merely uncalled.)
    expect(isReachableExport(GRAPH, "lib/tracking/digestCitations.js", "buildCitedDigest")).toBe(true);
  });

  it("never reports a framework contract as dead", () => {
    // A route's GET, a page's default, middleware's config: consumed by
    // Next.js, not by an import. Reporting those would drown everything else.
    const frameworkNoise = GRAPH.deadExports.filter(
      (d) => entryKindOf(d.file) !== null && ["default", "GET", "POST", "PATCH", "DELETE", "runtime", "config", "metadata"].includes(d.name),
    );
    expect(frameworkNoise.map(keyOf)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 1 -- POSITIVE. Real repo symbols that ARE reachable, one per resolver
// feature. If the scanner stops seeing these, every assertion above is passing
// vacuously.
// ---------------------------------------------------------------------------
const POSITIVE_CONTROLS = [
  { file: "lib/url/safeExternalHref.js", name: "safeExternalHref", feature: "plain named import, several hops from an entry point" },
  { file: "app/settings/engine.js", name: "useEngine", feature: "imported by both relative and @/-aliased specifiers" },
  { file: "lib/supabase/middleware.js", name: "updateSession", feature: "reached from middleware.js, not from app/" },
  { file: "app/components/AppHeader.js", name: "default", feature: "a default export used only as a JSX element" },
  { file: "lib/gmail/emailUtils.js", name: "matchMessagesToApplications", feature: "reached ONLY by `const { … } = await import(…)` in app/page.js" },
  { file: "lib/supabase/writePosition.js", name: "writePositionMerged", feature: "reached only by a dynamic import inside lib/" },
  { file: "app/theme/tokens.js", name: "tokens", feature: "reached only through `export { … } from` in app/theme/index.js" },
  { file: "lib/copilot/stt/index.js", name: "createSttStream", feature: "specifier resolved through a directory's index.js" },
  { file: "lib/llm/engines/index.js", name: "getEngine", feature: "a barrel module reached by directory specifier" },
  { file: "lib/copilot/answerClient.js", name: "draftAnswer", feature: "module namespace-imported by app/copilot/useDraftAnswer.js" },
];

describe("[positive control] known-reachable exports are seen as reachable", () => {
  for (const { file, name, feature } of POSITIVE_CONTROLS) {
    it(`sees ${file}#${name} (${feature})`, () => {
      expect(isReachableExport(GRAPH, file, name), `${file}#${name} vanished -- the scanner is broken`).toBe(true);
    });
  }

  it("proves the namespace-import control really is a namespace import", () => {
    // Otherwise the answerClient row above would pass for the wrong reason.
    const src = readFileSync(path.join(ROOT, "app/copilot/useDraftAnswer.js"), "utf8");
    expect(src).toMatch(/import \* as answerClientModule from "@\/lib\/copilot\/answerClient"/);
  });

  it("proves the dynamic-import control really is a dynamic import", () => {
    const src = readFileSync(path.join(ROOT, "app/page.js"), "utf8");
    expect(src).toMatch(/const \{ matchMessagesToApplications, classifyMessage \} = await import\(/);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 2 -- FALSE NEGATIVE. A synthetic project carrying a planted
// unreachable module and a planted unused export. Both must be caught.
// ---------------------------------------------------------------------------
const PLANTED = new Map([
  [
    "app/page.js",
    `import { used } from "@/lib/planted/live.js";
     import Widget from "./Widget.js";
     import "./side-effect.js";
     export const runtime = "nodejs";
     export default function Page() { return <Widget value={used()} />; }`,
  ],
  ["app/Widget.js", `export default function Widget() { return null; }\nexport const WIDGET_LIMIT = 3;`],
  ["app/side-effect.js", `globalThis.__planted = 1;`],
  [
    "lib/planted/live.js",
    `export function used() { return 1; }
     export function neverCalled() { return 2; }`,
  ],
  ["lib/planted/orphanModule.js", `export function alsoNeverCalled() { return 3; }`],
]);

describe("[false-negative control] planted dead code is caught", () => {
  const g = buildExportGraph({ files: PLANTED });
  const keys = g.deadExports.map(keyOf);

  it("catches an exported function in a live module that nothing imports", () => {
    expect(keys).toContain("lib/planted/live.js#neverCalled");
  });

  it("catches a whole module no entry point reaches", () => {
    expect(g.unreachableModules).toContain("lib/planted/orphanModule.js");
    expect(keys).toContain("lib/planted/orphanModule.js#alsoNeverCalled");
  });

  it("catches an unused export beside a used default in the SAME file", () => {
    // The summaryViewFor shape: the module ships, its default is rendered, and
    // one named export beside it is reached by nothing.
    expect(keys).toContain("app/Widget.js#WIDGET_LIMIT");
    expect(keys).not.toContain("app/Widget.js#default");
  });

  it("does not mistake the live export, the entry's default, or segment config for dead code", () => {
    expect(keys).not.toContain("lib/planted/live.js#used");
    expect(keys).not.toContain("app/page.js#default");
    expect(keys).not.toContain("app/page.js#runtime");
  });

  it("keeps a side-effect-only import's module reachable", () => {
    expect(g.shipping.has("app/side-effect.js")).toBe(true);
    expect(g.unreachableModules).not.toContain("app/side-effect.js");
  });
});

// ---------------------------------------------------------------------------
// CONTROL 3 -- FALSE POSITIVE. An import or an export written inside a comment,
// a string or a template literal is not code and must count for nothing --
// neither as an edge that keeps something alive, nor as a symbol to report.
// ---------------------------------------------------------------------------
const COMMENTED = new Map([
  [
    "app/page.js",
    `// import { ghost } from "@/lib/ghost/onlyInAComment.js";
     /* export function alsoAGhost() {}
        import Ghost from "./Ghost.js"; */
     const prose = "import { stringGhost } from './nowhere.js'";
     const tpl = \`export function templateGhost() {}\`;
     const re = /[\\\\/:*?"<>|]/g;
     import { real } from "@/lib/ghost/real.js";
     export default function Page() { return real(prose, tpl, re); }`,
  ],
  ["lib/ghost/real.js", `export function real() { return 1; }\nexport function unreferenced() { return 2; }`],
  ["lib/ghost/onlyInAComment.js", `export function ghost() { return 3; }`],
]);

describe("[false-positive control] an import or export inside a comment or a string counts for nothing", () => {
  const g = buildExportGraph({ files: COMMENTED });
  const keys = g.deadExports.map(keyOf);

  it("does not let a commented-out import keep a module alive", () => {
    expect(g.unreachableModules).toContain("lib/ghost/onlyInAComment.js");
  });

  it("does not invent exports out of a comment or a template literal", () => {
    expect(keys).not.toContain("app/page.js#alsoAGhost");
    expect(keys).not.toContain("app/page.js#templateGhost");
  });

  it("still finds the real import that follows a regex literal containing a quote", () => {
    // The measured shape that silently blanked a real site out of a shipped
    // sweep: `/[\\/:*?"<>|]/g`. If the shared tokenizer regressed, the `real`
    // edge would disappear and lib/ghost/real.js would look unreachable.
    expect(g.shipping.has("lib/ghost/real.js")).toBe(true);
    expect(keys).not.toContain("lib/ghost/real.js#real");
    expect(keys).toContain("lib/ghost/real.js#unreferenced");
  });

  it("[real file] does not count the import statements quoted inside this repo's own prose", () => {
    // The strongest available false-positive control: eslint.config.mjs is not
    // in the universe, but lib/sourceScan/exportGraph.js's own header quotes
    // `import * as ns from "m"` and `export { a } from "s"` in a block comment.
    // Neither may register as an edge.
    const src = readFileSync(path.join(ROOT, "lib/sourceScan/exportGraph.js"), "utf8");
    expect(src).toContain('export { a } from "s"');
    const parsed = parseModuleSource(src);
    expect(parsed.imports.map((i) => i.spec)).toEqual(["node:path", "./tokenizeSource.js"]);
  });
});

// ---------------------------------------------------------------------------
// CONTROL 4 -- THE BROKEN-SCANNER MUTANT. Rebuild the graph over the REAL tree
// with a parser that returns nothing, and prove the sweep goes red. A scanner
// that finds nothing must never be mistaken for a clean codebase.
// ---------------------------------------------------------------------------
describe("[mutant] a scanner that returns nothing fails every control", () => {
  const BLIND = () => ({ imports: [], exports: [] });
  const mutant = buildExportGraph({ files: PRODUCTION, parse: BLIND });

  for (const { file, name } of POSITIVE_CONTROLS) {
    it(`turns the positive control ${file}#${name} red`, () => {
      expect(isReachableExport(mutant, file, name)).toBe(false);
    });
  }

  it("turns the module ledger red", () => {
    const ledgered = sorted([
      ...ALLOWED_UNREACHABLE_MODULES.map((e) => e.file),
      ...UNWIRED_MODULES.map((e) => e.file),
    ]);
    expect(sorted(mutant.unreachableModules)).not.toEqual(ledgered);
    // With no import edges, everything but the 83 entry files falls out of the
    // shipping set -- the opposite of a quiet pass.
    expect(mutant.unreachableModules.length).toBeGreaterThan(400);
  });

  it("turns the orphan ledger and rule TR-1's count red", () => {
    const mutantUnused = mutant.deadExports.filter((d) => d.reason === "unused-export");
    expect(mutantUnused).toHaveLength(0);
    expect(mutantUnused.length).not.toBe(355);
    expect(sorted(mutantUnused.map(keyOf))).not.toEqual(sorted(ORPHAN_EXPORTS.map(keyOf)));
  });

  it("turns the false-negative control red", () => {
    const blindPlanted = buildExportGraph({ files: PLANTED, parse: BLIND });
    expect(blindPlanted.deadExports.map(keyOf)).not.toContain("lib/planted/live.js#neverCalled");
  });
});
