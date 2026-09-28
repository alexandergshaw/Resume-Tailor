// N60 SECOND CHUNK -- Step B (4b TDD) -- AC2-C3 part (ii) + part (iii)-source +
// AC2-C5 + the model-reach POSITIVE guard.
//
// These are DELIBERATE source-text / import-graph CENSUSES (the reachability-census
// exception to the "source CONTAINS a string is zero-power" rule), each canaried
// against a known positive so a broken pattern that matches nothing cannot pass. No
// route module is imported here, so this file COLLECTS and RUNS on HEAD -- every
// assertion is RED because the route file is absent, which is the honest reason, not
// a collection error.
//
// WHY THESE ARE THE DURABLE DEFENCE (brief / AC2-C3): the behavioural tests prove
// TODAY's route omits the flag. A source-scan that the route never CALLS the
// permissive sanitizers (which DO carry the flag) is what stops a later
// convenience edit quietly swapping `sanitizeChatDerivedSavedSearch` for
// `sanitizeSavedSearchCreate` -- a swap that would pass no behavioural test the day
// it is made if the author also relaxed those, but cannot pass this scan.

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseModuleSource, resolveSpecifier } from "@/lib/sourceScan/exportGraph";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url)); // hello-world/
const APPLY_ROUTE = path.join(ROOT, "app/api/feed-config/apply/route.js");
const SAVED_SEARCH_ROUTE = path.join(ROOT, "app/api/saved-searches/route.js"); // known positive
const SHARED_SANITIZER = path.join(ROOT, "lib/savedSearch/savedSearchFields.js"); // known positive
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

// Comment-strip so a rule ABOUT an identifier is not read as a use of it (the AC2-C3
// text itself names the flag). Block comments + whole-line // comments, the
// conservative idiom adoption.test.js:297 uses.
function codeOf(file) {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("AC2-C3 part (ii): the apply route never calls the permissive sanitizers", () => {
  it("[canary] the scan DOES flag a route that calls sanitizeSavedSearchCreate", () => {
    // The shipped saved-searches route calls sanitizeSavedSearchCreate. If this
    // canary ever stops matching, the pattern is broken and the guard below is a
    // rubber stamp -- so prove the pattern discriminates before trusting it.
    const known = codeOf(SAVED_SEARCH_ROUTE);
    expect(/\bsanitizeSavedSearchCreate\b/.test(known)).toBe(true);
  });

  it("the apply route calls neither sanitizeSavedSearchCreate nor sanitizeSavedSearchPatch", () => {
    expect(existsSync(APPLY_ROUTE), "app/api/feed-config/apply/route.js does not exist yet").toBe(true);
    const code = codeOf(APPLY_ROUTE);
    // Both DELIBERATELY accept auto_tailor_enabled (savedSearchFields.js:77,113-114),
    // so a route that reused either would be able to switch on unattended spend.
    expect(/\bsanitizeSavedSearchCreate\b/.test(code)).toBe(false);
    expect(/\bsanitizeSavedSearchPatch\b/.test(code)).toBe(false);
    // ...and it DOES call the safe one (positive: proves it sanitizes at all, so the
    // two negatives above are not passing because the route sanitizes nothing).
    expect(/\bsanitizeChatDerivedSavedSearch\b/.test(code)).toBe(true);
  });
});

describe("AC2-C3 part (iii)-source: the apply route never names the enable flag in its source", () => {
  it("[canary] the scan DOES flag the shared module, which names the flag", () => {
    const known = codeOf(SHARED_SANITIZER);
    expect(/auto_tailor_enabled|autoTailorEnabled/.test(known)).toBe(true);
  });

  it("the apply route source never mentions auto_tailor_enabled / autoTailorEnabled", () => {
    expect(existsSync(APPLY_ROUTE), "app/api/feed-config/apply/route.js does not exist yet").toBe(true);
    const code = codeOf(APPLY_ROUTE);
    expect(/auto_tailor_enabled|autoTailorEnabled/.test(code)).toBe(false);
  });
});

describe("AC2-C5: one configuration record -- the route targets saved_searches, no second store", () => {
  it("the apply route references saved_searches and no parallel feed-config table", () => {
    expect(existsSync(APPLY_ROUTE), "app/api/feed-config/apply/route.js does not exist yet").toBe(true);
    const code = codeOf(APPLY_ROUTE);
    expect(/saved_searches/.test(code)).toBe(true);
    // No `.from("feed_config...")` or similarly-named parallel store.
    expect(/\.from\(\s*["'`]feed[_-]?config/i.test(code)).toBe(false);
  });

  it("no migration creates a parallel feed-config table (canaried census)", () => {
    // This chunk adds NO migration; saved_searches already carries every column.
    // A source-text census over supabase/migrations, canaried against a known
    // `create table` so an empty match cannot masquerade as "no such table".
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    const bodies = files.map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"));
    const anyCreateTable = bodies.some((b) => /create\s+table/i.test(b));
    expect(anyCreateTable, "canary: expected at least one create-table in migrations").toBe(true);
    // No migration creates a feed_config / chat-config table.
    const parallelStore = bodies.some((b) =>
      /create\s+table[^;]*\b(feed[_-]?config|chat[_-]?config|feed_config_searches)\b/i.test(b),
    );
    expect(parallelStore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2-S6 tail (this seat's positive half): the apply route reaches NO model module.
// A route that transitively imports lib/llm silently becomes a spender; the
// adoption.test.js sweep only fires on THREE model modules, so a path avoiding them
// leaves the net green and the route unlisted. This asserts the negative DIRECTLY,
// so the guard is live rather than assumed. Machinery mirrors adoption.test.js's
// reachesModel BFS over the repo's own export-graph primitives.
// ---------------------------------------------------------------------------
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

// Cache the per-file import parse (adoption.test.js:383 idiom): without it a BFS
// re-parses every file it visits on every reachesModel call, which pushes a
// whole-tree scan past the 5000ms default under load (the documented flake).
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

describe("AC2-S6 (positive guard): the apply route does NOT reach a model module", () => {
  const APPLY_REL = "app/api/feed-config/apply/route.js";

  // Warm the file map once, off the clock of any single assertion, with a generous
  // budget -- the whole-tree read is the heavy part and must not be charged to the
  // first test as a timeout (the tokenizeSource / coverBytePaths load artifact).
  beforeAll(() => {
    fileMap();
  }, 60000);

  it("[canary] the target model modules exist (else reachesModel is vacuously false)", () => {
    const files = fileMap();
    for (const mod of MODEL_MODULES) expect(files.has(mod), `${mod} missing from file map`).toBe(true);
  });

  it("[positive control] reachesModel is TRUE for a known transitive spender (cron/tailor)", () => {
    // Proves the BFS can detect reach at all -- a detector that never returns true
    // would make the apply-route assertion below meaningless.
    expect(reachesModel("app/api/cron/tailor/route.js")).toBe(true);
  }, 30000);

  it("the apply route exists and reaches no model module", () => {
    // Non-vacuity: assert the route is on disk FIRST. On HEAD it is absent, so
    // fileMap().has(...) is false and this is RED for the honest reason -- not a
    // false "reaches no model" that is true only because the file does not exist.
    expect(fileMap().has(APPLY_REL), "apply route does not exist yet").toBe(true);
    expect(reachesModel(APPLY_REL)).toBe(false);
  }, 30000);
});
