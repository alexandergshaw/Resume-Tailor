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
// property, not by taste. (Those first-run figures are history. The counts
// below are the CURRENT pinned values, which the assertions further down
// enforce; the table at the top of ./exportReachability.ledger.md is the
// single place to read them if this prose has fallen behind.)
//
//   RULE TR-1 (424 symbols)  the export is unused by shipping code, but at
//       least one `.test.js` imports it BY NAME. This repo's dominant
//       convention is to widen a module's export surface so a unit test can
//       pin an internal helper or a threshold constant directly instead of
//       through the public function. Such a symbol has a real consumer, so it
//       is a deliberately widened surface rather than a lost feature. Covered
//       by rule and COUNTED EXACTLY -- not enumerated, because hundreds of lines
//       of boilerplate is how the orphans below would get lost. Raising that
//       count is a review event: see the assertion's own comment.
//
//   ORPHAN_EXPORTS (65 symbols)  unused by shipping code AND imported by no
//       test anywhere. Nothing in this repository reads these. Each carries
//       its own line and its own stated reason. This is where `summaryViewFor`
//       lands. NOTE the boundary this bucket does NOT police: "unused" here
//       means no OTHER module imports the name. A symbol its own module calls
//       is still listed, and deleting one on the strength of this line alone
//       is how live code gets removed -- read each entry's `why`, and grep,
//       before cutting. docx.js#buildDocxFromUploadedTemplate is the worked
//       example of exactly that near-miss.
//
//   ALLOWED_UNREACHABLE_MODULES (14) / UNWIRED_MODULES (5)  whole files no
//       entry point can reach. The fourteen are sweep and test infrastructure
//       (including this sweep's own ledger and scan modules -- see their
//       self-entries there) and are justified one by one. The findings bucket
//       holds five modules whose production call sites are later, named steps
//       of the chunk that landed them; its earlier entries were reviewed and
//       deleted or wired up -- see the block comment above UNWIRED_MODULES in
//       ./exportReachability.ledger.js.
//
// Every entry in every bucket must carry a reason; the sweep asserts that, so
// "add it to the list" is never the cheap way out. The two module buckets and
// ORPHAN_EXPORTS are matched EXACTLY: a new dead export fails this file on the
// day it is written, and so does a stale entry left behind after something is
// wired up or removed. The buckets themselves are DATA now, in
// ./exportReachability.ledger.js; this file owns the scan and the assertions
// that hold that data to account.
//
// The per-count derivation history (every chunk's delta, stated by name, for
// each pinned number asserted below) lives in ./exportReachability.ledger.md,
// not here, so this file stays under the repo's 1000-line cap.
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
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildExportGraph, parseModuleSource, entryKindOf } from "./exportGraph.js";
import { tokenizeSource } from "./tokenizeSource.js";
import {
  ALLOWED_UNREACHABLE_MODULES,
  UNWIRED_MODULES,
  ORPHAN_EXPORTS,
  DESYNCED_STATEMENTS,
} from "./exportReachability.ledger.js";
import {
  ROOT,
  PRODUCTION,
  TEST_FILES,
  GRAPH,
  DEAD_KEYS,
  TEST_IMPORTS,
  importedByATest,
  UNUSED_IN_SHIPPING_MODULES,
  TEST_REFERENCED,
  ORPHANS,
  keyOf,
  sorted,
  isReachableExport,
  rejectedStatements,
} from "./exportReachability.scan.js";

// ---------------------------------------------------------------------------
// The scan itself -- reading the real tree, building the export graph once,
// and indexing which exports a test (as opposed to shipping code) reaches --
// now lives in ./exportReachability.scan.js, imported above. It moved there,
// verbatim, to bring this file under the repo's 1000-line cap, the same
// reason ALLOWED_UNREACHABLE_MODULES/UNWIRED_MODULES/ORPHAN_EXPORTS/
// DESYNCED_STATEMENTS moved to ./exportReachability.ledger.js before it.
// Nothing about what this file scans or asserts changed: the same scan is
// still matched EXACTLY against the ledgers below, by the same assertions
// that always checked them.
// ---------------------------------------------------------------------------

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
    // Pinned at 14. Full 9 -> 14 derivation: exportReachability.ledger.md, section 1.
    expect(ALLOWED_UNREACHABLE_MODULES).toHaveLength(14);
  });

  it("keeps the unwired-feature findings visible and described", () => {
    // These are NOT allow-listed. They are findings held in a named bucket so
    // that they cannot quietly become "just how it is". Wiring one up (or
    // removing it) fails the exact match above, which is the prompt to delete
    // its line here. History ([] -> 2 -> 1 -> 5): exportReachability.ledger.md, section 2.
    expect(UNWIRED_MODULES.map((e) => e.file)).toEqual([
      "lib/interviewPrep/prepLog.js",
      "lib/interviewPrep/interviewProcessGrammar.js",
      "lib/interviewPrep/interviewerRoles.js",
      "lib/tracking/citationLineAgreement.js",
      "lib/tracking/digestRoleScreen.js",
    ]);
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
    // Pinned at 65. The same total has hidden opposite movements before, so every
    // delta (56 -> 65) is stated by name in exportReachability.ledger.md, section 3.
    expect(ORPHAN_EXPORTS).toHaveLength(65);
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
    // Pinned at 424. Every movement (299 -> 424) is stated by name in
    // exportReachability.ledger.md, section 4; append the new delta there.
    expect(TEST_REFERENCED.length).toBe(424);
    // A classifier that swept everything into this bucket would make the
    // orphan ledger vacuous, so pin the split rather than only the total.
    expect(UNUSED_IN_SHIPPING_MODULES.length).toBe(TEST_REFERENCED.length + ORPHANS.length);
    // Pinned at 489 = 424 + 65. Every movement (356 -> 489), with which half
    // moved, is stated in exportReachability.ledger.md, section 5.
    expect(UNUSED_IN_SHIPPING_MODULES.length).toBe(489);
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
