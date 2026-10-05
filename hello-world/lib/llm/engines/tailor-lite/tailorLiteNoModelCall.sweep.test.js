import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { tokenizeSource } from "@/lib/sourceScan/tokenizeSource.js";
import { parseModuleSource, resolveSpecifier } from "@/lib/sourceScan/exportGraph.js";

// ---------------------------------------------------------------------------
// N20 -- lib/llm/engines/tailor-lite/ is the embedded, deterministic backend:
// `wantsEmbedded` (lib/llm/featureEngine.js) routes 20 routes to it with "no
// LLM call", and engine.js:105-110 states the contract in its own words --
// "Tailoring stays deterministic and AI-free -- only reading the posting from
// a URL touches the network". Nothing kept that true: no test under lib/llm/
// reads a source file, so a `getGeminiClient()` import or a stray `fetch(` in
// any of these modules would ship green.
//
// WHAT IS ASSERTED, over a recursive walk of lib/llm/engines/tailor-lite/
// (every file kind is classified; an unrecognised kind fails loudly instead of
// being skipped):
//   1. OUT-OF-DIRECTORY IMPORT LEDGER. Imports that stay inside the directory
//      are free. Every import that LEAVES it (an npm package or a repo module)
//      must appear in EXTERNAL_EDGES, and the ledger must match EXACTLY, so a
//      new edge and a stale entry are both red. Specifiers are RESOLVED first,
//      so `../geminiEngine.js`, `@/lib/llm/engines/geminiEngine.js` and a
//      dynamic `import()` of either are one thing.
//   2. TRANSITIVE CLOSURE. Every module reachable through those edges is read
//      too. The npm packages anywhere in that closure must be on
//      CLOSURE_EXTERNALS; no closure file may sit under lib/llm/ other than
//      this directory and the pure postingMeta.js; none may name a model
//      endpoint, a model API-key variable or the SDK client.
//   3. NO NETWORK TOKENS in this directory's own real code: fetch,
//      XMLHttpRequest, WebSocket, EventSource, sendBeacon, require, eval,
//      new Function. Comments and string contents are blanked by the shared
//      tokenizer, so a comment that NAMES `fetch(` cannot trip it, and
//      `fetchUrlContent(` is not `fetch`.
//   4. THE NETWORK SURFACE IS PINNED. The one sanctioned egress is
//      lib/scrape/fetchUrlContent.js (reading a posting from a URL). The set
//      of closure files that carry a raw network token must equal exactly that.
//   5. IMPORT ACCOUNTING. Every `import` keyword in real code must be matched
//      by an import edge the parser could read, so a computed `import(name)`
//      is itself a violation.
//
// The ledger names the SANCTIONED edges honestly. Two of them are network
// edges by design and are neither model calls nor "no network": reading the
// posting from a URL (fetchUrlContent) and persisting the per-user library
// (Supabase + the Redis cache behind jobCache). The sweep exists so a THIRD
// cannot appear unreviewed, and so none of them can grow a model call.
//
// INSTRUMENT LIMIT: static text only. A deliberately obfuscated call
// (`globalThis["fe" + "tch"]`) is not seen; nothing in this tree does that.
//
// Every detector below is exercised by a PLANTED violation run through the
// SAME audit function the real directory goes through, so a scanner that has
// gone blind cannot look like a clean codebase.
// ---------------------------------------------------------------------------

const APP_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SUBJECT_DIR = "lib/llm/engines/tailor-lite";
const SELF_REL = `${SUBJECT_DIR}/tailorLiteNoModelCall.sweep.test.js`;

// Edges that LEAVE the directory, keyed by importing file, valued by the
// RESOLVED target (a repo-relative path, or the bare npm specifier). A file not
// listed here must not leave the directory at all.
const EXTERNAL_EDGES = {
  // .docx zip handling.
  [`${SUBJECT_DIR}/coverLetterTemplate.js`]: ["jszip"],
  [`${SUBJECT_DIR}/defaultTemplate.js`]: ["jszip"],
  [`${SUBJECT_DIR}/docxModel.js`]: ["jszip"],
  // postingMeta.js is pure text parsing; fetchUrlContent.js is THE sanctioned
  // network edge (read a posting from a URL).
  [`${SUBJECT_DIR}/engine.js`]: ["lib/llm/postingMeta.js", "lib/scrape/fetchUrlContent.js"],
  // Per-user library persistence (rows) and its cache -- storage, not a model.
  [`${SUBJECT_DIR}/library/apiSupport.js`]: ["lib/supabase/server.js"],
  [`${SUBJECT_DIR}/library/loadLibrary.js`]: ["lib/cache/jobCache.js", "lib/supabase/admin.js"],
  [`${SUBJECT_DIR}/library/seed.js`]: ["lib/supabase/admin.js"],
  [`${SUBJECT_DIR}/library/suggest.js`]: ["lib/llm/postingMeta.js"],
};

// Every npm package reachable anywhere in the closure. jszip: docx zip.
// @supabase/*, next/headers: the library rows. @upstash/redis: jobCache.
const CLOSURE_EXTERNALS = ["@supabase/ssr", "@supabase/supabase-js", "@upstash/redis", "jszip", "next/headers"];

// The only closure files allowed to carry a raw network token.
const SANCTIONED_NETWORK_FILES = ["lib/scrape/fetchUrlContent.js"];

const SOURCE_EXT_RE = /\.(js|mjs|cjs|jsx|ts|tsx)$/;
const TEST_RE = /\.test\.(js|mjs|cjs|jsx|ts|tsx)$/;
const DATA_EXT_RE = /\.(json|md)$/;

function classify(rel) {
  if (TEST_RE.test(rel)) return "test";
  if (SOURCE_EXT_RE.test(rel)) return "source";
  if (DATA_EXT_RE.test(rel)) return "data";
  return "unknown";
}

// Matched against `codeMask` (real code only). `\bfetch\b` does not match
// `fetchUrlContent`.
const NETWORK_RE = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/;
const DIRECT_CODE_TOKEN_RES = [
  ["network call (fetch/XMLHttpRequest/WebSocket/EventSource/sendBeacon)", NETWORK_RE],
  ["require()", /\brequire\b/],
  ["eval / new Function", /\beval\b|\bnew\s+Function\b/],
];
// Matched against `readable` (comments blanked, string contents kept), because
// an endpoint or a key name is a string.
const MODEL_TEXT_RE =
  /generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.anthropic\.com|api\.openai\.com|\b(?:GEMINI|GOOGLE_GENAI|GOOGLE|ANTHROPIC|OPENAI)_API_KEY\b|\bGoogleGenAI\b|\bgetGeminiClient\b|\bgenerateContent(?:Stream)?\b/;
const MODEL_SDK_SPEC_RE =
  /^(@google\/(genai|generative-ai)|@anthropic-ai\/|openai$|@ai-sdk\/|ai$|@langchain\/|langchain$|cohere-ai$|@mistralai\/|groq-sdk$|ollama$|@huggingface\/|replicate$|@aws-sdk\/client-bedrock)/;
const IMPORT_KEYWORD_RE = /\bimport\b(?!\s*\.\s*meta\b)/g;
// Any lib/llm/ file other than this directory and the pure postingMeta.js
// (geminiClient, the engine registry, featureEngine, tailorResume, ...).
const FORBIDDEN_CLOSURE_PATH_RE = /^lib\/llm\/(?!engines\/tailor-lite\/|postingMeta\.js$)/;

const toRel = (abs) => path.relative(APP_ROOT, abs).split(path.sep).join("/");
const inSubject = (rel) => rel.startsWith(`${SUBJECT_DIR}/`);

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
 * Audit `files` (Map of repo-relative path -> source). Returns the violations
 * as strings plus what the traversal reached, so a control can assert it went
 * past the first hop.
 */
function audit({ files, universe, ledger, closureExternals }) {
  const violations = [];
  const direct = new Set(files.keys());
  const closure = new Map(files);
  const queue = [...files.keys()];
  const directTargets = new Map();
  const externals = new Set();
  const networkFiles = new Set();

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
    const { readable, codeMask } = tokens;

    // A raw network token is a violation in this directory's own code; in a
    // module it merely reaches, it is recorded so the surface can be pinned.
    if (isDirect) {
      for (const [label, re] of DIRECT_CODE_TOKEN_RES) {
        if (re.test(codeMask)) violations.push(`${where}: contains ${label}`);
      }
    }
    if (NETWORK_RE.test(codeMask)) networkFiles.add(rel);
    if (MODEL_TEXT_RE.test(readable)) violations.push(`${where}: names a model endpoint, API-key variable or SDK client`);

    const keywordCount = (codeMask.match(IMPORT_KEYWORD_RE) || []).length;
    const edgeCount = parsed.imports.filter((e) => !e.reexport && !e.reexportStar).length;
    if (keywordCount !== edgeCount) {
      violations.push(`${where}: ${keywordCount} import keyword(s) in code but ${edgeCount} readable import edge(s) -- a computed or unparseable specifier`);
    }

    const leaving = new Set();
    for (const edge of parsed.imports) {
      const r = resolveSpecifier(edge.spec, rel, universe);
      if (r.kind === "external") {
        externals.add(edge.spec);
        if (MODEL_SDK_SPEC_RE.test(edge.spec)) violations.push(`${where}: imports model SDK "${edge.spec}"`);
        else if (!closureExternals.includes(edge.spec)) violations.push(`${where}: imports "${edge.spec}", not on the closure package allowlist`);
        if (isDirect) leaving.add(edge.spec);
        continue;
      }
      if (r.kind === "unresolved") {
        violations.push(`${where}: import "${edge.spec}" does not resolve to a file`);
        if (isDirect) leaving.add(`unresolved:${edge.spec}`);
        continue;
      }
      const target = r.kind === "module" ? r.file : assetTarget(edge.spec, rel);
      if (r.kind === "asset" && !universe.has(target)) violations.push(`${where}: asset import "${edge.spec}" resolves to ${target}, which does not exist`);
      if (FORBIDDEN_CLOSURE_PATH_RE.test(target)) violations.push(`${where}: imports ${target} (a model-capable lib/llm module)`);
      if (isDirect && !inSubject(target)) leaving.add(target);
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
    if (isDirect) directTargets.set(rel, [...leaving].sort());
  }

  for (const rel of direct) {
    const actual = directTargets.get(rel) || [];
    const expected = [...(ledger[rel] || [])].sort();
    const added = actual.filter((t) => !expected.includes(t));
    const stale = expected.filter((t) => !actual.includes(t));
    if (added.length) violations.push(`${rel}: leaves the directory by imports not on the ledger: ${added.join(", ")}`);
    if (stale.length) violations.push(`${rel}: ledger names imports the file no longer has: ${stale.join(", ")}`);
  }
  for (const rel of Object.keys(ledger)) {
    if (!direct.has(rel)) violations.push(`${rel}: ledger names a file that is not in the scanned set`);
  }

  return {
    violations,
    closure: [...closure.keys()].sort(),
    externals: [...externals].sort(),
    networkFiles: [...networkFiles].sort(),
  };
}

function shippedSources() {
  const rels = walk(path.join(APP_ROOT, SUBJECT_DIR));
  const files = new Map();
  for (const rel of rels) {
    if (classify(rel) !== "source") continue;
    files.set(rel, readFileSync(path.join(APP_ROOT, rel), "utf8"));
  }
  return { rels, unknown: rels.filter((rel) => classify(rel) === "unknown"), files };
}

// A virtual universe in which the model-capable modules exist, so a planted
// import resolves and the closure walk reaches the SDK import behind it.
const MODEL_WORLD = {
  "lib/llm/geminiClient.js": 'import { GoogleGenAI } from "@google/genai";\nexport const getGeminiClient = () => new GoogleGenAI({});\n',
  "lib/llm/engines/geminiEngine.js": 'import { getGeminiClient } from "../geminiClient.js";\nexport const geminiEngine = { client: getGeminiClient };\n',
  "lib/llm/engines/index.js": 'import { geminiEngine } from "./geminiEngine.js";\nexport const engines = { geminiEngine };\n',
  "lib/llm/postingMeta.js": "export const extractPostingMeta = (t) => t;\n",
  "lib/scrape/fetchUrlContent.js": 'export async function fetchUrlContent(u) { return fetch(u); }\n',
};
const PLANT = `${SUBJECT_DIR}/planted.js`;

function auditPlanted(src, { world = {}, ledger = {}, externals = CLOSURE_EXTERNALS } = {}) {
  return audit({
    files: new Map([[PLANT, src]]),
    universe: virtualUniverse({ ...MODEL_WORLD, ...world }),
    ledger,
    closureExternals: externals,
  });
}
const violationsOf = (src, opts) => auditPlanted(src, opts).violations.join("\n");

describe("[purity] lib/llm/engines/tailor-lite/ -- N20 no-model-call sweep", () => {
  describe("enumeration (a narrow root or wrong glob cannot hide a file)", () => {
    const { rels, unknown, files } = shippedSources();

    it("[control] walks lib/llm/engines/tailor-lite/ recursively and sees the shipped modules, including the library/ subdirectory", () => {
      const names = [...files.keys()].map((rel) => rel.slice(SUBJECT_DIR.length + 1));
      expect(names).toEqual(
        expect.arrayContaining([
          "engine.js",
          "index.js",
          "keywords.js",
          "strategy.js",
          "library/loadLibrary.js",
          "library/seed.js",
          "library/apiSupport.js",
          "library/crudRoute.js",
        ]),
      );
      expect(files.size).toBeGreaterThanOrEqual(20);
      // Test files are not shipped source, and this very file is a test file.
      expect(files.has(SELF_REL)).toBe(false);
      expect(rels).toContain(SELF_REL);
      // The bundled data is walked and classified too, not skipped.
      expect(rels.filter((rel) => classify(rel) === "data").length).toBeGreaterThanOrEqual(5);
    });

    it("[control] the walk agrees with a second, independent enumeration (readdirSync recursive)", () => {
      const viaRecursive = readdirSync(path.join(APP_ROOT, SUBJECT_DIR), { recursive: true, withFileTypes: true })
        .filter((ent) => !ent.isDirectory())
        .map((ent) => toRel(path.join(ent.parentPath, ent.name)))
        .sort();
      expect([...rels].sort()).toEqual(viaRecursive);
    });

    it("[control] the walker descends into subdirectories", () => {
      const scratch = mkdtempSync(path.join(tmpdir(), "tailorlite-walk-"));
      try {
        mkdirSync(path.join(scratch, "nested", "deeper"), { recursive: true });
        writeFileSync(path.join(scratch, "top.js"), "export const a = 1;\n");
        writeFileSync(path.join(scratch, "nested", "deeper", "hidden.js"), "export const b = 2;\n");
        expect(walk(scratch).map((rel) => path.posix.basename(rel)).sort()).toEqual(["hidden.js", "top.js"]);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });

    it("[control] the file classifier refuses to skip an unrecognised kind", () => {
      expect(classify(`${SUBJECT_DIR}/a.js`)).toBe("source");
      expect(classify(`${SUBJECT_DIR}/a.mjs`)).toBe("source");
      expect(classify(`${SUBJECT_DIR}/a.test.js`)).toBe("test");
      expect(classify(`${SUBJECT_DIR}/data/x.json`)).toBe("data");
      expect(classify(`${SUBJECT_DIR}/library/README.md`)).toBe("data");
      expect(classify(`${SUBJECT_DIR}/payload.wasm`)).toBe("unknown");
      expect(classify(`${SUBJECT_DIR}/run.sh`)).toBe("unknown");
    });

    it("every file under lib/llm/engines/tailor-lite/ is source, a test, or bundled data (no unscanned kind)", () => {
      expect(unknown, `unrecognised file kinds are never scanned: ${unknown.join(", ")}`).toEqual([]);
    });
  });

  describe("real directory", () => {
    const { files } = shippedSources();
    const real = audit({ files, universe: diskUniverse(), ledger: EXTERNAL_EDGES, closureExternals: CLOSURE_EXTERNALS });

    it("[N20] no tailor-lite module calls a model, makes an unsanctioned network call, or imports outside its ledger", () => {
      expect(real.violations, real.violations.join("\n")).toEqual([]);
    });

    it("[control] the transitive walk went past the first hop (it read the sanctioned modules and the one behind jobCache)", () => {
      expect(real.closure).toEqual(
        expect.arrayContaining([
          "lib/llm/postingMeta.js",
          "lib/scrape/fetchUrlContent.js",
          "lib/supabase/admin.js",
          "lib/supabase/server.js",
          "lib/cache/jobCache.js",
          "lib/cache/redisClient.js",
        ]),
      );
    });

    it("the npm packages in the closure are exactly the allowlisted set (no stale entry, no new package)", () => {
      expect(real.externals).toEqual([...CLOSURE_EXTERNALS].sort());
    });

    it("the network surface is pinned: the only closure file with a raw network token is the posting reader", () => {
      expect(real.networkFiles).toEqual(SANCTIONED_NETWORK_FILES);
    });

    it("the ledger has no entry for a file that no longer exists", () => {
      for (const rel of Object.keys(EXTERNAL_EDGES)) expect(files.has(rel), rel).toBe(true);
    });
  });

  describe("[positive control] each detector fires on a planted violation, through the same audit the real directory uses", () => {
    it("a model SDK import, and the closure walk reaches it through a clean-looking relative import", () => {
      expect(violationsOf('import { GoogleGenAI } from "@google/genai";\nexport const x = GoogleGenAI;\n')).toMatch(/imports model SDK "@google\/genai"/);
      const viaClient = violationsOf('import { getGeminiClient } from "../../geminiClient.js";\nexport const x = getGeminiClient;\n');
      expect(viaClient).toMatch(/imports lib\/llm\/geminiClient\.js \(a model-capable lib\/llm module\)/);
      expect(viaClient).toMatch(/geminiClient\.js \(reached transitively\): imports model SDK "@google\/genai"/);
      expect(viaClient).toMatch(/leaves the directory by imports not on the ledger: lib\/llm\/geminiClient\.js/);
    });

    it("the alias spelling, a sibling engine, and the engine registry (which imports the Gemini engine)", () => {
      expect(violationsOf('import { geminiEngine } from "@/lib/llm/engines/geminiEngine.js";\nexport const x = geminiEngine;\n')).toMatch(
        /imports lib\/llm\/engines\/geminiEngine\.js \(a model-capable lib\/llm module\)/,
      );
      expect(violationsOf('import { geminiEngine } from "../geminiEngine.js";\nexport const x = geminiEngine;\n')).toMatch(
        /imports lib\/llm\/engines\/geminiEngine\.js \(a model-capable lib\/llm module\)/,
      );
      expect(violationsOf('import { engines } from "../index.js";\nexport const x = engines;\n')).toMatch(
        /imports lib\/llm\/engines\/index\.js \(a model-capable lib\/llm module\)/,
      );
    });

    it("a dynamic relative import of a model module, and a computed dynamic import the resolver cannot follow", () => {
      expect(violationsOf('export async function bad() { return import("../../geminiClient.js"); }\n')).toMatch(/imports lib\/llm\/geminiClient\.js/);
      expect(violationsOf("export async function bad(name) { return import(name); }\n")).toMatch(
        /1 import keyword\(s\) in code but 0 readable import edge\(s\)/,
      );
    });

    it("an npm package that is not on the closure allowlist, and a node: network module", () => {
      expect(violationsOf('import https from "node:https";\nexport const x = https;\n')).toMatch(/imports "node:https", not on the closure package allowlist/);
      expect(violationsOf('import OpenAI from "openai";\nexport const x = OpenAI;\n')).toMatch(/imports model SDK "openai"/);
      expect(violationsOf('import Anthropic from "@anthropic-ai/sdk";\nexport const x = Anthropic;\n')).toMatch(/imports model SDK "@anthropic-ai\/sdk"/);
    });

    it("fetch, XMLHttpRequest, sendBeacon, WebSocket, EventSource in the directory's own code", () => {
      expect(violationsOf('export const a = () => fetch("https://example.com");\n')).toMatch(/network call/);
      expect(violationsOf("export const b = () => new XMLHttpRequest();\n")).toMatch(/network call/);
      expect(violationsOf('export const c = (d) => navigator.sendBeacon("/x", d);\n')).toMatch(/network call/);
      expect(violationsOf('export const d = () => new WebSocket("wss://x");\n')).toMatch(/network call/);
      expect(violationsOf('export const e = () => new EventSource("/x");\n')).toMatch(/network call/);
      expect(violationsOf('export const f = () => globalThis.fetch("/x");\n')).toMatch(/network call/);
    });

    it("require, eval and new Function", () => {
      expect(violationsOf('export const a = () => require("fs");\n')).toMatch(/require\(\)/);
      expect(violationsOf("export const b = (s) => eval(s);\n")).toMatch(/eval \/ new Function/);
      expect(violationsOf("export const c = (s) => new Function(s);\n")).toMatch(/eval \/ new Function/);
    });

    it("a model endpoint, API-key variable or SDK client NAMED in a string, with no import and no fetch", () => {
      expect(violationsOf('export const u = "https://generativelanguage.googleapis.com/v1beta/models";\n')).toMatch(/names a model endpoint/);
      expect(violationsOf('export const k = process.env.GEMINI_API_KEY;\n')).toMatch(/names a model endpoint/);
      expect(violationsOf('export const k = process.env.ANTHROPIC_API_KEY;\n')).toMatch(/names a model endpoint/);
      expect(violationsOf('export const u = "https://api.openai.com/v1/chat";\n')).toMatch(/names a model endpoint/);
    });

    it("a violation hidden one hop away: a LEDGERED import whose own module reaches an SDK, a model endpoint or an unsanctioned fetch", () => {
      const src = 'import { extractPostingMeta } from "@/lib/llm/postingMeta.js";\nexport const x = extractPostingMeta;\n';
      const ledger = { [PLANT]: ["lib/llm/postingMeta.js"] };
      expect(violationsOf(src, { ledger })).toBe("");
      expect(violationsOf(src, { ledger, world: { "lib/llm/postingMeta.js": 'import { GoogleGenAI } from "@google/genai";\nexport const extractPostingMeta = () => GoogleGenAI;\n' } })).toMatch(
        /postingMeta\.js \(reached transitively\): imports model SDK "@google\/genai"/,
      );
      expect(violationsOf(src, { ledger, world: { "lib/llm/postingMeta.js": 'export const extractPostingMeta = () => "https://api.anthropic.com/v1/messages";\n' } })).toMatch(
        /postingMeta\.js \(reached transitively\): names a model endpoint/,
      );
      // An unsanctioned fetch in a closure file is not a violation of the
      // per-file rules (the posting reader legitimately has one) -- it is what
      // the pinned network surface catches.
      const fetching = auditPlanted(src, { ledger, world: { "lib/llm/postingMeta.js": 'export const extractPostingMeta = () => fetch("/x");\n' } });
      expect(fetching.networkFiles).toEqual(["lib/llm/postingMeta.js"]);
      expect(fetching.networkFiles).not.toEqual(SANCTIONED_NETWORK_FILES);
    });

    it("a new repo edge that leaves the directory, and a stale ledger entry", () => {
      const fresh = violationsOf('import { x } from "@/lib/scrape/fetchUrlContent.js";\nexport const y = x;\n');
      expect(fresh).toMatch(/leaves the directory by imports not on the ledger: lib\/scrape\/fetchUrlContent\.js/);
      const stale = violationsOf("export const x = 1;\n", { ledger: { [PLANT]: ["lib/scrape/fetchUrlContent.js"] } });
      expect(stale).toMatch(/ledger names imports the file no longer has: lib\/scrape\/fetchUrlContent\.js/);
      expect(violationsOf("export const x = 1;\n", { ledger: { [`${SUBJECT_DIR}/gone.js`]: [] } })).toMatch(/gone\.js: ledger names a file that is not in the scanned set/);
    });

    it("an unresolvable specifier and a missing bundled asset are violations, never a silent skip", () => {
      expect(violationsOf('import { x } from "./doesNotExist.js";\nexport const y = x;\n')).toMatch(/does not resolve to a file/);
      expect(violationsOf('import data from "./data/missing.json";\nexport const y = data;\n')).toMatch(/does not exist/);
    });

    it("in-directory imports are free: a clean planted module with a relative sibling import passes", () => {
      const sibling = `${SUBJECT_DIR}/sibling.js`;
      expect(violationsOf('import { s } from "./sibling.js";\nexport const x = s;\n', { world: { [sibling]: "export const s = 1;\n" } })).toBe("");
    });
  });

  describe("[false-positive control] documentation and look-alikes are not code", () => {
    it("a comment or a string that NAMES a forbidden pattern is not flagged by the code-token rules", () => {
      const src = [
        '// import { getGeminiClient } from "../geminiClient.js";  fetch(...) XMLHttpRequest',
        "/* import x from 'node:https'; navigator.sendBeacon(); require('fs'); */",
        'const doc = "fetch( then import(x) then eval(y)";',
        "export const note = `uses fetch(url) and new WebSocket in prose`;",
        "export const joined = doc + note;",
      ].join("\n");
      expect(violationsOf(src)).toBe("");
    });

    it("`fetchUrlContent(...)` is not `fetch`, and `import.meta` is not an import edge", () => {
      expect(violationsOf("export async function load(u) { return fetchUrlContent(u); }\nexport const here = import.meta.url;\n")).toBe("");
    });

    it("the same planted code, uncommented, IS flagged (the discrimination is the tokenizer's, not blindness)", () => {
      expect(violationsOf('// export const a = () => fetch("https://example.com");\n')).toBe("");
      expect(violationsOf('export const a = () => fetch("https://example.com");\n')).not.toBe("");
    });
  });
});
