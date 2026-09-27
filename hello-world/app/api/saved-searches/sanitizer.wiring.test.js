// N60 S2 (4b) -- AC-S5: one sanitizer, imported, no route defines its own copy.
//
// The recurring defect this closes: the chat writer (Part D) becomes the THIRD
// verbatim copy of the sanitizer and the first to drift, so the chat path silently
// accepts a bound the chip path refuses. AC-S5's structural guard is that there is
// exactly ONE definition site, so a future third copy in ANY app/ or lib/ non-test
// file trips this -- a CLASS guard, not an instance one.
//
// This is a deliberate source-text CENSUS (a definition-site sweep), not a prose
// assertion: it counts `function sanitizeX(` DEFINITIONS across the tree. Each
// pattern is canaried against a known positive (the shared module's own source)
// before the count is trusted, so a broken pattern that matches nothing cannot
// pass as "exactly one".
//
// RED ON HEAD: the shared module does not exist (readFileSync throws), the two
// routes still DEFINE the sanitizers locally (census === 2, not 1), `sanitizeEmail`
// still exists twice (census === 2, not 0), and neither route imports the module.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url)); // hello-world/
const SHARED = path.join(ROOT, "lib/savedSearch/savedSearchFields.js");
const CREATE_ROUTE = path.join(ROOT, "app/api/saved-searches/route.js");
const UPDATE_ROUTE = path.join(ROOT, "app/api/saved-searches/[id]/route.js");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

const NON_TEST_FILES = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))];
// Read every file ONCE up front: defCount is called several times and re-reading
// the whole tree per call is both slow and needless.
const SOURCES = new Map(NON_TEST_FILES.map((f) => [f, readFileSync(f, "utf8")]));

// Definition-site census (export-agnostic: an internal helper may be module-private
// and still counts as a definition -- what AC-S5 forbids is a DUPLICATE definition).
function fnDefFiles(name) {
  const re = new RegExp(`\\bfunction\\s+${name}\\s*\\(`);
  return NON_TEST_FILES.filter((f) => re.test(SOURCES.get(f)));
}
function constDefFiles(name) {
  const re = new RegExp(`\\bconst\\s+${name}\\s*=`);
  return NON_TEST_FILES.filter((f) => re.test(SOURCES.get(f)));
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");

describe("AC-S5: exactly one definition site for each saved-search sanitizer", () => {
  it("the shared module exists, defines the sanitizers, and exports the public API", () => {
    const src = readFileSync(SHARED, "utf8");
    // The internal helpers are DEFINED here (export keyword optional).
    expect(/\bfunction\s+sanitizeStringArray\s*\(/.test(src)).toBe(true);
    expect(/\bfunction\s+sanitizeCap\s*\(/.test(src)).toBe(true);
    // The public writers and the account cap ARE exported (the routes import them).
    expect(src).toMatch(/export\s+(const\s+)?function\s+sanitizeSavedSearchCreate|export\s+function\s+sanitizeSavedSearchCreate/);
    expect(src).toMatch(/export\s+function\s+sanitizeSavedSearchPatch/);
    expect(src).toMatch(/export\s+const\s+MAX_SAVED_SEARCHES_PER_ACCOUNT\b/);
  });

  it("sanitizeStringArray is defined in exactly one file: the shared module", () => {
    expect(fnDefFiles("sanitizeStringArray").map(rel)).toEqual([rel(SHARED)]);
  });

  it("sanitizeCap is defined in exactly one file: the shared module", () => {
    expect(fnDefFiles("sanitizeCap").map(rel)).toEqual([rel(SHARED)]);
  });

  it("DEFAULT_DAILY_CAP is defined in exactly one file: the shared module", () => {
    expect(constDefFiles("DEFAULT_DAILY_CAP").map(rel)).toEqual([rel(SHARED)]);
  });

  it("sanitizeEmail is defined nowhere (the recipient override is gone)", () => {
    expect(fnDefFiles("sanitizeEmail").map(rel)).toEqual([]);
  });
});

describe("AC-S5: both saved-search routes import the shared module and define no copies", () => {
  for (const [label, file] of [
    ["POST /api/saved-searches", CREATE_ROUTE],
    ["PUT /api/saved-searches/[id]", UPDATE_ROUTE],
  ]) {
    it(`${label} imports savedSearchFields`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/from\s+["'][^"']*savedSearchFields["']/);
    });
    it(`${label} defines no local sanitizer copy`, () => {
      const src = readFileSync(file, "utf8");
      expect(/\bfunction\s+sanitizeStringArray\s*\(/.test(src)).toBe(false);
      expect(/\bfunction\s+sanitizeCap\s*\(/.test(src)).toBe(false);
      expect(/\bfunction\s+sanitizeEmail\s*\(/.test(src)).toBe(false);
      expect(/\bconst\s+DEFAULT_DAILY_CAP\s*=/.test(src)).toBe(false);
    });
  }
});
