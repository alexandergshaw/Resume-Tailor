// The live scan exportReachability.sweep.test.js checks its ledgers
// against -- reading the real tree, building the export graph once, and
// indexing which exports a test file (as opposed to shipping code) reaches.
// Split out, verbatim, to bring that file under the repo's 1000-line cap --
// same shape and same reason as exportReachability.ledger.js's own split
// (see that module's header). A plain `.js` and not a `.test.js`, so
// importing it does not replay a describe tree: this file plants no `it()`
// of its own, only the scanner state several describe blocks in the sweep
// read from. It is unreachable from anything that ships, for the same
// reason as its sibling sweep-infrastructure modules -- see this file's own
// entry on ALLOWED_UNREACHABLE_MODULES.
//
// N49 (2026-09-23): extracted when a routine ledger addition (four more
// UNWIRED_MODULES entries) tipped exportReachability.sweep.test.js from
// 1070 to 1082 lines; it was already over the repo's 1000-line convention
// before that change, from ordinary growth of the TR-1 historical
// commentary the sweep test itself carries. Nothing about what is scanned
// or how it is indexed changed in the move.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildExportGraph, parseModuleSource, resolveSpecifier } from "./exportGraph.js";
import { tokenizeSource } from "./tokenizeSource.js";

export const ROOT = process.cwd();

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

export const PRODUCTION = new Map();
export const TEST_FILES = new Map();
for (const dir of ["app", "lib", "test"]) {
  for (const full of walk(path.join(ROOT, dir))) {
    const r = rel(full);
    const src = readFileSync(full, "utf8");
    if (r.endsWith(".test.js") || r.startsWith("test/")) TEST_FILES.set(r, src);
    else PRODUCTION.set(r, src);
  }
}
PRODUCTION.set("middleware.js", readFileSync(path.join(ROOT, "middleware.js"), "utf8"));

export const GRAPH = buildExportGraph({ files: PRODUCTION });
export const DEAD_KEYS = new Set(GRAPH.deadExports.map((d) => `${d.file}#${d.name}`));

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
export const TEST_IMPORTS = testImportIndex(TEST_FILES);
export const importedByATest = (file, name) => TEST_IMPORTS.has(`${file}#${name}`) || TEST_IMPORTS.has(`${file}#*`);

// Symbols in a module shipping code DOES reach, that shipping code never asks
// for. (Exports of a wholly unreachable module are reported at module
// granularity instead, by the two module ledgers.)
export const UNUSED_IN_SHIPPING_MODULES = GRAPH.deadExports.filter((d) => d.reason === "unused-export");
export const TEST_REFERENCED = UNUSED_IN_SHIPPING_MODULES.filter((d) => importedByATest(d.file, d.name));
export const ORPHANS = UNUSED_IN_SHIPPING_MODULES.filter((d) => !importedByATest(d.file, d.name));

// ---------------------------------------------------------------------------
// Helpers shared by the sweep's assertions and controls.
// ---------------------------------------------------------------------------
export const keyOf = (e) => `${e.file}#${e.name}`;
export const sorted = (xs) => [...xs].sort();

/**
 * A reachable export, as this sweep defines it: the module ships, the scanner
 * SAW the symbol, and nothing reported it dead. All three clauses matter --
 * dropping the middle one is what lets a scanner that returns nothing pass
 * every positive control vacuously.
 */
export function isReachableExport(graph, file, name) {
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
// DESYNCED_STATEMENTS (exportReachability.ledger.js). Anything the codeMask
// check throws away must be on that list with a reason; it is empty today,
// which the sweep's own assertions turn into a live guard rather than a hope.
// ---------------------------------------------------------------------------

/** Line-start import/export tokens the codeMask confirmation threw away. */
export function rejectedStatements(files) {
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
