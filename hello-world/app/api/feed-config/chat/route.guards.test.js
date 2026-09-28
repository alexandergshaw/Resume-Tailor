// N60 SECOND CHUNK -- Step C (4b TDD) -- AC2-S6's POSITIVE half: the chat route
// is a VISIBLE, LISTED, bounded model spender.
//
// These are DELIBERATE import-graph / source-text CENSUSES (the reachability
// exception to the "source CONTAINS a string is zero-power" rule), each canaried
// against a known positive so a broken pattern that matches nothing cannot pass.
// No route module is imported here, so this file COLLECTS and RUNS on HEAD --
// every substantive assertion is RED because the chat route is absent (and,
// separately, unlisted), which is the honest reason.
//
// WHY THIS FILE, and not just adoption.test.js's sweep: the checker's note is
// exact -- lib/rateLimit/adoption.test.js's sweep only FIRES on a route that
// transitively reaches lib/llm/{geminiClient,extractEmployment,engines}. A route
// that spends while INVISIBLE to that net (imports a model helper the sweep does
// not key on, or is quietly kept out of BOUNDED) is the failure mode. So this
// asserts the net is LIVE for THIS route directly:
//   (1) reachesModel(chatRoute) === true    -- the deriver really does reach a model.
//   (2) the route is listed in adoption.test.js's BOUNDED table (not DEFERRED)
//       -- it is bounded, not merely accounted-for-and-postponed.
// Both go green only when the implementer lands the route AND lists it, which is
// exactly the review moment a new spender deserves.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseModuleSource, resolveSpecifier } from "@/lib/sourceScan/exportGraph";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url)); // hello-world/
const CHAT_REL = "app/api/feed-config/chat/route.js";
const ADOPTION = path.join(ROOT, "lib/rateLimit/adoption.test.js");

// The three modules the transitive rate-limit sweep keys on (adoption.test.js:358).
const MODEL_MODULES = new Set([
  "lib/llm/geminiClient.js",
  "lib/llm/extractEmployment.js",
  "lib/llm/engines/index.js",
]);

function walkJs(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkJs(full, found);
    else if (full.endsWith(".js")) found.push(full);
  }
  return found;
}

let FILE_MAP = null;
function fileMap() {
  if (FILE_MAP) return FILE_MAP;
  const map = new Map();
  for (const abs of [...walkJs(path.join(ROOT, "lib")), ...walkJs(path.join(ROOT, "app"))]) {
    map.set(path.relative(ROOT, abs).split(path.sep).join("/"), readFileSync(abs, "utf8"));
  }
  FILE_MAP = map;
  return map;
}

// Per-file import parse cache (adoption.test.js:383 idiom): without it the BFS
// re-parses every file it visits, pushing a whole-tree scan past the 5000ms
// default under load (the documented tokenizeSource/coverBytePaths flake).
let PARSE_CACHE = null;
function importsOf(rel) {
  if (!PARSE_CACHE) PARSE_CACHE = new Map();
  if (PARSE_CACHE.has(rel)) return PARSE_CACHE.get(rel);
  const src = fileMap().get(rel);
  let imports = [];
  if (src !== undefined) {
    try {
      imports = parseModuleSource(src).imports;
    } catch {
      imports = [];
    }
  }
  PARSE_CACHE.set(rel, imports);
  return imports;
}

function reachesModel(start) {
  const files = fileMap();
  const fileSet = new Set(files.keys());
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.pop();
    for (const edge of importsOf(cur)) {
      const r = resolveSpecifier(edge.spec, cur, fileSet);
      if (r.kind !== "module") continue;
      if (MODEL_MODULES.has(r.file)) return true;
      if (!seen.has(r.file)) {
        seen.add(r.file);
        queue.push(r.file);
      }
    }
  }
  return false;
}

// Slice a top-level `const NAME = [ ... ];` array body out of a source file, so
// membership can be tested against BOUNDED vs DEFERRED separately.
function arrayBody(source, name) {
  const start = source.indexOf(`const ${name} = [`);
  if (start === -1) return "";
  const end = source.indexOf("\n];", start);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

describe("AC2-S6 (positive guard): the chat route reaches a model module", () => {
  // Warm the whole-tree read once, off the clock of any single assertion.
  beforeAll(() => {
    fileMap();
  }, 60000);

  it("[canary] the target model modules exist (else reachesModel is vacuously false)", () => {
    const files = fileMap();
    for (const mod of MODEL_MODULES) expect(files.has(mod), `${mod} missing from file map`).toBe(true);
  });

  it("[positive control] reachesModel is TRUE for a known transitive spender (cron/tailor)", () => {
    // Proves the BFS can detect reach at all; without this the assertion below
    // could pass because the detector never returns true.
    expect(reachesModel("app/api/cron/tailor/route.js")).toBe(true);
  }, 30000);

  it("the chat route exists and DOES reach a model module", () => {
    // Non-vacuity: assert the route is on disk FIRST. On HEAD it is absent, so
    // this is RED for the honest reason -- not a false "reaches no model".
    expect(fileMap().has(CHAT_REL), "chat route does not exist yet").toBe(true);
    expect(reachesModel(CHAT_REL)).toBe(true);
  }, 30000);
});

describe("AC2-S6 (positive guard): the chat route is BOUNDED, not deferred or unlisted", () => {
  it("[canary] a known bounded route (interview-prep) is in adoption.test.js's BOUNDED array", () => {
    const src = readFileSync(ADOPTION, "utf8");
    expect(arrayBody(src, "BOUNDED")).toContain("app/api/interview-prep/route.js");
  });

  it("the chat route is listed in BOUNDED and NOT in DEFERRED", () => {
    // The sweep in adoption.test.js goes red if the route reaches a model and is
    // absent from BOUNDED u DEFERRED; this second witness insists it is
    // specifically BOUNDED (an LLM call on a user-triggered path must be bounded,
    // never merely deferred). RED until the implementer adds the entry.
    const src = readFileSync(ADOPTION, "utf8");
    expect(arrayBody(src, "BOUNDED")).toContain(CHAT_REL);
    expect(arrayBody(src, "DEFERRED")).not.toContain(CHAT_REL);
  });
});
