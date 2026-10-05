import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { tokenizeSource } from "@/lib/sourceScan/tokenizeSource.js";
import { parseModuleSource, resolveSpecifier } from "@/lib/sourceScan/exportGraph.js";

// ---------------------------------------------------------------------------
// N19 -- lib/duplicateApply/ is a PURE core: duplicateApplyVerdict.js:16-17
// promises "no I/O, no network call and no ambient clock/zone read". The
// shipped guard (duplicateApplyPurity.test.js) is a denylist of substrings and
// its LLM_DIR_RE is /lib\/llm/, which matches only the `@/lib/llm/...` alias
// spelling. A relative `../llm/geminiClient.js` import -- live convention in
// this repo (lib/meeting/referenceContract.js, lib/techwatch/lifecycleSearch.js)
// -- passes every assertion there, as do a dynamic relative import, `node:https`,
// `XMLHttpRequest` and `navigator.sendBeacon`. That file is a landed test and
// is left untouched; this sweep is the allowlist-shaped complement, and its
// shape is the one lib/copilot/glossaryMatch.test.js:318 already proves
// (assert what the module imports, not what it must not).
//
// WHAT IS ASSERTED, over a recursive walk of lib/duplicateApply/ (every file
// kind is classified; an unrecognised kind fails loudly instead of being
// skipped):
//   1. IMPORT ALLOWLIST. Each shipped source file's resolved import targets
//      equal a per-file ledger EXACTLY (so a stale entry is as red as a new
//      import). Specifiers are RESOLVED before comparison, so `../llm/x.js`,
//      `@/lib/llm/x.js` and a dynamic `import()` of either are one thing.
//   2. TRANSITIVE CLOSURE. Every module reachable through those imports is
//      read too and must itself import no external (npm or node:) specifier,
//      sit under no lib/llm, lib/supabase, lib/scrape or lib/feed path, and
//      carry none of the network / storage tokens below.
//   3. NO NETWORK / STORAGE / DYNAMIC-CODE TOKENS in real code (comments and
//      string contents are blanked by the shared tokenizer, so a comment that
//      NAMES `fetch(` cannot trip it): fetch, XMLHttpRequest, WebSocket,
//      EventSource, sendBeacon, localStorage, sessionStorage, indexedDB,
//      require, eval, new Function.
//   4. IMPORT ACCOUNTING. Every `import` keyword in real code must be matched
//      by an import edge the parser could read, so a computed `import(name)`
//      -- invisible to any resolver -- is itself a violation.
//   5. NO AMBIENT CLOCK in the directory's own sources (Date.now, no-argument
//      Date(), performance.now, getTimezoneOffset, resolvedOptions).
//
// INSTRUMENT LIMIT: static text only. A deliberately obfuscated call
// (`globalThis["fe" + "tch"]`) is not seen; nothing in this tree does that.
//
// Every detector below is exercised by a PLANTED violation run through the
// SAME audit function the real directory goes through, so a scanner that has
// gone blind cannot look like a clean codebase.
// ---------------------------------------------------------------------------

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SUBJECT_DIR = "lib/duplicateApply";

// The ledger. Keys and values are repo-relative POSIX paths of RESOLVED
// targets. A file absent from this map must import nothing at all -- which is
// the case for four of the six shipped sources today.
const ALLOWED_IMPORTS = {
  "lib/duplicateApply/duplicateApplyVerdict.js": [
    "lib/applications/statusVocabulary.js",
    "lib/duplicateApply/companyIdentity.js",
    "lib/duplicateApply/postingIdentity.js",
    "lib/tracking/stages.js",
  ],
  "lib/duplicateApply/verdictPresentation.js": ["lib/tracking/stages.js"],
};

const SOURCE_EXT_RE = /\.(js|mjs|cjs|jsx|ts|tsx)$/;
const TEST_RE = /\.test\.(js|mjs|cjs|jsx|ts|tsx)$/;

function classify(rel) {
  if (TEST_RE.test(rel)) return "test";
  if (SOURCE_EXT_RE.test(rel)) return "source";
  return "unknown";
}

// Matched against `codeMask`: comments, regex literals and string contents are
// blanked, so only real code can register. `\bfetch\b` does not match
// `fetchSomething`.
const CODE_TOKEN_RES = [
  ["network call (fetch/XMLHttpRequest/WebSocket/EventSource/sendBeacon)", /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/],
  ["browser storage (localStorage/sessionStorage/indexedDB)", /\b(localStorage|sessionStorage|indexedDB)\b/],
  ["require()", /\brequire\b/],
  ["eval / new Function", /\beval\b|\bnew\s+Function\b/],
];
const CLOCK_RE = /\bDate\s*\.\s*now\b|\bDate\s*\(\s*\)|\bperformance\s*\.\s*now\b|\bgetTimezoneOffset\b|\bresolvedOptions\b/;
const IMPORT_KEYWORD_RE = /\bimport\b(?!\s*\.\s*meta\b)/g;
const FORBIDDEN_PATH_RE = /^lib\/(llm|supabase|scrape|feed)\//;

const toRel = (abs) => path.relative(APP_ROOT, abs).split(path.sep).join("/");

function walk(dirAbs, out = []) {
  for (const ent of readdirSync(dirAbs, { withFileTypes: true })) {
    const full = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(toRel(full));
  }
  return out;
}

function diskUniverse() {
  const isFile = (rel) => statSync(path.join(APP_ROOT, rel), { throwIfNoEntry: false })?.isFile() === true;
  return {
    // resolveSpecifier only ever calls `.has` on its file set.
    has: isFile,
    read: (rel) => (isFile(rel) ? readFileSync(path.join(APP_ROOT, rel), "utf8") : null),
  };
}

function virtualUniverse(filesByRel) {
  const map = new Map(Object.entries(filesByRel));
  return { has: (rel) => map.has(rel), read: (rel) => (map.has(rel) ? map.get(rel) : null) };
}

function assetTarget(spec, fromRel) {
  return spec.startsWith("@/")
    ? path.posix.normalize(spec.slice(2))
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
}

/**
 * Audit `files` (Map of repo-relative path -> source) against `ledger`.
 * Returns the violations as strings, plus what it reached, so a control can
 * assert the traversal went past the first hop.
 */
function audit({ files, universe, ledger }) {
  const violations = [];
  const direct = new Set(files.keys());
  const closure = new Map(files);
  const queue = [...files.keys()];
  const directTargets = new Map();

  while (queue.length) {
    const rel = queue.pop();
    const src = closure.get(rel);
    const isDirect = direct.has(rel);
    const where = isDirect ? rel : `${rel} (reached transitively)`;
    let tokens;
    let parsed;
    try {
      tokens = tokenizeSource(src, { label: rel });
      parsed = parseModuleSource(src);
    } catch (err) {
      violations.push(`${where}: could not be read -- ${err.message}`);
      continue;
    }
    const { codeMask } = tokens;

    for (const [label, re] of CODE_TOKEN_RES) {
      if (re.test(codeMask)) violations.push(`${where}: contains ${label}`);
    }
    if (isDirect && CLOCK_RE.test(codeMask)) violations.push(`${where}: reads the ambient clock/zone`);

    const keywordCount = (codeMask.match(IMPORT_KEYWORD_RE) || []).length;
    const edgeCount = parsed.imports.filter((e) => !e.reexport && !e.reexportStar).length;
    if (keywordCount !== edgeCount) {
      violations.push(`${where}: ${keywordCount} import keyword(s) in code but ${edgeCount} readable import edge(s) -- a computed or unparseable specifier`);
    }

    const targets = new Set();
    for (const edge of parsed.imports) {
      const r = resolveSpecifier(edge.spec, rel, universe);
      if (r.kind === "external") {
        violations.push(`${where}: imports external specifier "${edge.spec}"`);
        targets.add(edge.spec);
        continue;
      }
      if (r.kind === "unresolved") {
        violations.push(`${where}: import "${edge.spec}" does not resolve to a file`);
        targets.add(`unresolved:${edge.spec}`);
        continue;
      }
      const target = r.kind === "module" ? r.file : assetTarget(edge.spec, rel);
      targets.add(target);
      if (FORBIDDEN_PATH_RE.test(target)) violations.push(`${where}: imports ${target} (forbidden path family)`);
      if (r.kind === "module" && !closure.has(target)) {
        const targetSrc = universe.read(target);
        if (targetSrc === null) {
          violations.push(`${where}: import "${edge.spec}" resolved to ${target} but it could not be read`);
        } else {
          closure.set(target, targetSrc);
          queue.push(target);
        }
      }
    }
    if (isDirect) directTargets.set(rel, [...targets].sort());
  }

  for (const rel of direct) {
    const actual = directTargets.get(rel) || [];
    const expected = [...(ledger[rel] || [])].sort();
    const added = actual.filter((t) => !expected.includes(t));
    const stale = expected.filter((t) => !actual.includes(t));
    if (added.length) violations.push(`${rel}: imports not on the allowlist: ${added.join(", ")}`);
    if (stale.length) violations.push(`${rel}: allowlist names imports the file no longer has: ${stale.join(", ")}`);
  }
  for (const rel of Object.keys(ledger)) {
    if (!direct.has(rel)) violations.push(`${rel}: allowlist names a file that is not in the scanned set`);
  }

  return { violations, closure: [...closure.keys()].sort() };
}

function shippedSources() {
  const rels = walk(path.join(APP_ROOT, SUBJECT_DIR));
  const unknown = rels.filter((rel) => classify(rel) === "unknown");
  const files = new Map();
  for (const rel of rels) {
    if (classify(rel) !== "source") continue;
    files.set(rel, readFileSync(path.join(APP_ROOT, rel), "utf8"));
  }
  return { rels, unknown, files };
}

const SELF_REL = `${SUBJECT_DIR}/duplicateApplyImportAllowlist.sweep.test.js`;

// A virtual universe in which the LLM client exists, so a planted import of it
// resolves and the closure walk reaches the SDK import behind it.
const LLM_WORLD = {
  "lib/llm/geminiClient.js": 'import { GoogleGenAI } from "@google/genai";\nexport const getGeminiClient = () => new GoogleGenAI({});\n',
  "lib/llm/gemini.js": 'import { GoogleGenAI } from "@google/genai";\nexport const runPrompt = () => new GoogleGenAI({});\n',
  "lib/tracking/stages.js": "export const parseStageInstant = (v) => v;\n",
};
const PLANT = `${SUBJECT_DIR}/planted.js`;

function auditPlanted(src, extraWorld = {}, ledger = {}) {
  return audit({
    files: new Map([[PLANT, src]]),
    universe: virtualUniverse({ ...LLM_WORLD, ...extraWorld }),
    ledger,
  }).violations;
}

describe("[purity] lib/duplicateApply/ -- N19 import-allowlist sweep", () => {
  describe("enumeration (a narrow root or wrong glob cannot hide a file)", () => {
    const { rels, unknown, files } = shippedSources();

    it("[control] walks lib/duplicateApply/ recursively and sees the shipped modules by name", () => {
      const names = [...files.keys()].map((rel) => rel.slice(SUBJECT_DIR.length + 1));
      expect(names).toEqual(
        expect.arrayContaining([
          "companyIdentity.js",
          "duplicateApplyLog.js",
          "duplicateApplyLogDocument.js",
          "duplicateApplyVerdict.js",
          "postingIdentity.js",
          "verdictPresentation.js",
        ]),
      );
      expect(files.size).toBeGreaterThanOrEqual(6);
      // Test files are not shipped source, and this very file is a test file.
      expect(files.has(SELF_REL)).toBe(false);
      expect(rels).toContain(SELF_REL);
    });

    it("[control] the walk agrees with a second, independent enumeration (readdirSync recursive)", () => {
      const viaRecursive = readdirSync(path.join(APP_ROOT, SUBJECT_DIR), { recursive: true, withFileTypes: true })
        .filter((ent) => !ent.isDirectory())
        .map((ent) => toRel(path.join(ent.parentPath, ent.name)))
        .sort();
      expect([...rels].sort()).toEqual(viaRecursive);
    });

    it("[control] the walker descends into subdirectories (the shipped guard skipped them)", () => {
      const scratch = mkdtempSync(path.join(tmpdir(), "dupapply-walk-"));
      try {
        mkdirSync(path.join(scratch, "nested", "deeper"), { recursive: true });
        writeFileSync(path.join(scratch, "top.js"), "export const a = 1;\n");
        writeFileSync(path.join(scratch, "nested", "deeper", "hidden.js"), "export const b = 2;\n");
        const found = walk(scratch).map((rel) => path.posix.basename(rel));
        expect(found.sort()).toEqual(["hidden.js", "top.js"]);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });

    it("[control] the file classifier refuses to skip an unrecognised kind", () => {
      expect(classify("lib/duplicateApply/a.js")).toBe("source");
      expect(classify("lib/duplicateApply/a.mjs")).toBe("source");
      expect(classify("lib/duplicateApply/a.test.js")).toBe("test");
      expect(classify("lib/duplicateApply/payload.wasm")).toBe("unknown");
      expect(classify("lib/duplicateApply/run.sh")).toBe("unknown");
      expect(classify("lib/duplicateApply/data.json")).toBe("unknown");
    });

    it("every file under lib/duplicateApply/ is a source file or a test file (no unscanned kind)", () => {
      expect(unknown, `unrecognised file kinds are never scanned: ${unknown.join(", ")}`).toEqual([]);
    });
  });

  describe("real directory", () => {
    const { files } = shippedSources();
    const real = audit({ files, universe: diskUniverse(), ledger: ALLOWED_IMPORTS });

    it("[N19] every shipped source imports exactly its allowlisted modules, and everything they reach is pure", () => {
      expect(real.violations, real.violations.join("\n")).toEqual([]);
    });

    it("[control] the transitive walk went past the first hop (it read the leaf modules, not just this directory)", () => {
      expect(real.closure).toEqual(
        expect.arrayContaining(["lib/tracking/stages.js", "lib/applications/statusVocabulary.js", "lib/duplicateApply/postingIdentity.js"]),
      );
      expect(real.closure.length).toBeGreaterThan(files.size);
    });

    it("the allowlist has no entry for a file that no longer exists", () => {
      for (const rel of Object.keys(ALLOWED_IMPORTS)) expect(files.has(rel), rel).toBe(true);
    });
  });

  describe("[positive control] each detector fires on a planted violation, through the same audit the real directory uses", () => {
    it("the relative `../llm/` spelling the shipped guard misses", () => {
      const v = auditPlanted('import { getGeminiClient } from "../llm/geminiClient.js";\nexport const x = getGeminiClient;\n');
      expect(v.join("\n")).toMatch(/planted\.js: imports not on the allowlist: lib\/llm\/geminiClient\.js/);
      expect(v.join("\n")).toMatch(/forbidden path family/);
      // ...and the closure walk reaches the SDK import behind it.
      expect(v.join("\n")).toMatch(/geminiClient\.js \(reached transitively\): imports external specifier "@google\/genai"/);
    });

    it("the `@/lib/llm/` alias spelling", () => {
      const v = auditPlanted('import { runPrompt } from "@/lib/llm/gemini.js";\nexport const x = runPrompt;\n');
      expect(v.join("\n")).toMatch(/imports not on the allowlist: lib\/llm\/gemini\.js/);
    });

    it("a dynamic relative import", () => {
      const v = auditPlanted('export async function bad() { return import("../llm/geminiClient.js"); }\n');
      expect(v.join("\n")).toMatch(/imports not on the allowlist: lib\/llm\/geminiClient\.js/);
    });

    it("an external / node: specifier", () => {
      const v = auditPlanted('import https from "node:https";\nexport const x = https;\n');
      expect(v.join("\n")).toMatch(/imports external specifier "node:https"/);
      expect(auditPlanted('import { createClient } from "@supabase/supabase-js";\nexport const x = createClient;\n').join("\n")).toMatch(
        /imports external specifier "@supabase\/supabase-js"/,
      );
    });

    it("a computed dynamic import the resolver cannot follow", () => {
      const v = auditPlanted("export async function bad(name) { return import(name); }\n");
      expect(v.join("\n")).toMatch(/1 import keyword\(s\) in code but 0 readable import edge\(s\)/);
    });

    it("fetch, XMLHttpRequest, sendBeacon, WebSocket, EventSource", () => {
      expect(auditPlanted('export const a = () => fetch("https://example.com");\n').join("\n")).toMatch(/network call/);
      expect(auditPlanted("export const b = () => new XMLHttpRequest();\n").join("\n")).toMatch(/network call/);
      expect(auditPlanted('export const c = (d) => navigator.sendBeacon("/x", d);\n').join("\n")).toMatch(/network call/);
      expect(auditPlanted('export const d = () => new WebSocket("wss://x");\n').join("\n")).toMatch(/network call/);
      expect(auditPlanted('export const e = () => new EventSource("/x");\n').join("\n")).toMatch(/network call/);
    });

    it("browser storage, require, eval and new Function", () => {
      expect(auditPlanted('export const a = () => localStorage.getItem("k");\n').join("\n")).toMatch(/browser storage/);
      expect(auditPlanted('export const b = () => sessionStorage.length;\n').join("\n")).toMatch(/browser storage/);
      expect(auditPlanted('export const c = () => require("fs");\n').join("\n")).toMatch(/require\(\)/);
      expect(auditPlanted('export const d = (s) => eval(s);\n').join("\n")).toMatch(/eval \/ new Function/);
      expect(auditPlanted('export const e = (s) => new Function(s);\n').join("\n")).toMatch(/eval \/ new Function/);
    });

    it("an ambient clock read in the directory's own source", () => {
      expect(auditPlanted("export const a = () => Date.now();\n").join("\n")).toMatch(/reads the ambient clock/);
      expect(auditPlanted("export const b = () => new Date();\n").join("\n")).toMatch(/reads the ambient clock/);
      expect(auditPlanted("export const c = () => performance.now();\n").join("\n")).toMatch(/reads the ambient clock/);
      expect(auditPlanted("export const d = () => new Date().getTimezoneOffset();\n").join("\n")).toMatch(/reads the ambient clock/);
    });

    it("a violation hidden one hop away: an allowlisted import whose own module reaches the network or an SDK", () => {
      const ledger = { [PLANT]: ["lib/tracking/stages.js"] };
      const clean = auditPlanted('import { parseStageInstant } from "@/lib/tracking/stages.js";\nexport const x = parseStageInstant;\n', {}, ledger);
      expect(clean).toEqual([]);
      const dirty = auditPlanted(
        'import { parseStageInstant } from "@/lib/tracking/stages.js";\nexport const x = parseStageInstant;\n',
        { "lib/tracking/stages.js": 'import { GoogleGenAI } from "@google/genai";\nexport const parseStageInstant = () => new GoogleGenAI({});\n' },
        ledger,
      );
      expect(dirty.join("\n")).toMatch(/stages\.js \(reached transitively\): imports external specifier "@google\/genai"/);
      const fetching = auditPlanted(
        'import { parseStageInstant } from "@/lib/tracking/stages.js";\nexport const x = parseStageInstant;\n',
        { "lib/tracking/stages.js": 'export const parseStageInstant = () => fetch("/x");\n' },
        ledger,
      );
      expect(fetching.join("\n")).toMatch(/stages\.js \(reached transitively\): contains network call/);
    });

    it("an unresolvable specifier is a violation, never a silent skip", () => {
      const v = auditPlanted('import { x } from "./doesNotExist.js";\nexport const y = x;\n');
      expect(v.join("\n")).toMatch(/does not resolve to a file/);
    });

    it("allowlist drift in both directions: a new import, and a stale ledger entry", () => {
      const ledgerWithStale = { [PLANT]: ["lib/tracking/stages.js"] };
      const stale = auditPlanted("export const x = 1;\n", {}, ledgerWithStale);
      expect(stale.join("\n")).toMatch(/allowlist names imports the file no longer has: lib\/tracking\/stages\.js/);
      const orphan = auditPlanted("export const x = 1;\n", {}, { "lib/duplicateApply/gone.js": [] });
      expect(orphan.join("\n")).toMatch(/gone\.js: allowlist names a file that is not in the scanned set/);
    });
  });

  describe("[false-positive control] documentation is not code", () => {
    it("a comment or a string that NAMES a forbidden pattern is not flagged", () => {
      const src = [
        '// import { getGeminiClient } from "../llm/geminiClient.js";  fetch(...) Date.now() localStorage',
        "/* import x from 'node:https'; new XMLHttpRequest(); navigator.sendBeacon(); require('fs') */",
        'const doc = "fetch( then import(x) then Date.now()";',
        "export const note = `uses fetch(url) and localStorage in prose`;",
        "export const fetchLabel = doc + note;",
      ].join("\n");
      expect(auditPlanted(src)).toEqual([]);
    });

    it("`fetchSomething` is not `fetch`, and `import.meta` is not an import edge", () => {
      expect(auditPlanted("export function fetchRows() { return []; }\nexport const here = import.meta.url;\n")).toEqual([]);
    });

    it("the planted violations above are real code the same scanner flags once uncommented (the discrimination is the tokenizer's, not blindness)", () => {
      const commented = auditPlanted('// export const a = () => fetch("https://example.com");\n');
      const live = auditPlanted('export const a = () => fetch("https://example.com");\n');
      expect(commented).toEqual([]);
      expect(live.length).toBeGreaterThan(0);
    });
  });
});
