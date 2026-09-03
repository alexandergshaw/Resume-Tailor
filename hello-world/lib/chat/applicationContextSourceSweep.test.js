// Two `[src]` sweeps guarding invariants that lib/chat/applicationContext.js
// asserts about itself and cannot enforce from the inside:
//
//   1. It is the ONLY file in the tree that declares MAX_APPLICATIONS,
//      MAX_JD_CHARS or MAX_TAILORED_CHARS. The whole point of moving those
//      three caps out of app/api/chat/route.js is that there is no second copy
//      to drift from -- and "one definition" is a property of the TREE, which
//      no unit test of either file can see. (Red until route.js's copies are
//      deleted; that is the check doing its job, not a broken test.)
//
//   2. Its source never mentions `engine`, `wantsEmbedded` or `readEngine`.
//      The bound is engine-blind BY CONVENTION -- nothing stops a future
//      author adding an `engine` parameter -- so the honest strength of the
//      claim is exactly this sweep, and the module header must say so rather
//      than claiming "by construction". The reason it matters: a client-side
//      engine test returns TRUE where the server returns FALSE, and the
//      assistant silently answers with less. The mechanism is NOT that Next
//      inlines a missing variable as undefined -- `wantsEmbedded` takes
//      `env = process.env` as a default parameter and reads `env.RESUME_ENGINE`
//      / `env.Gemini_LLM_API_Key` off it, which is not a statically analysable
//      `process.env.X` member expression, so build-time substitution never
//      fires on it at all. In a browser bundle `process.env` is simply an
//      empty object, both reads are undefined, and `wantsEmbedded` falls
//      through to `!hasGeminiKey(env)` -- true.
//
// Same four house rules as lib/drive/driveSourceSweep.test.js, whose walker
// and `stripComments` this file copies verbatim (the two sweeps guard
// unrelated invariants; neither should depend on the other's file surviving):
//
//   - Every absence assertion has a paired positive control.
//   - `*.test.js` is excluded from the production sweep.
//   - Comments are stripped before searching -- block comments too, not just
//     lines starting with `//`.
//   - The checker excludes ITSELF by exact resolved path. It has to: this file
//     writes all three cap names and all three engine identifiers in its own
//     patterns, so a sweep that found itself would always be red. Excluding it
//     by the `.test.js` rule instead would be a latent trap -- rename the file
//     without ".test" and the sweep starts matching its own source.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_DIR = path.join(ROOT, "app");
const LIB_DIR = path.join(ROOT, "lib");

const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));

const MODULE_PATH = "lib/chat/applicationContext.js";
const CHATBOT_PATH = "lib/chat/chatbot.js";
const ROUTE_PATH = "app/api/chat/route.js";

// A DECLARATION, not a mention: `import { MAX_JD_CHARS } from ...` must not
// trip this, or the sweep would forbid the very import it exists to require.
const CAP_DECLARATION_RE = /\b(?:const|let|var)\s+MAX_(?:APPLICATIONS|JD_CHARS|TAILORED_CHARS)\s*=/;

// Scope discipline: EXACTLY these three identifiers. A sweep phrased "no file
// may declare a chat cap locally" would trip on MAX_RESUME_CHARS, which is
// declared SEVEN times in this tree at two different values -- 12000 in
// app/api/chat/route.js, lib/copilot/answerContext.js and
// lib/copilot/applicationDocsPrompt.js, and 20000 in app/api/tailor/route.js,
// app/api/extract-employment/route.js, lib/llm/extractEmployment.js and
// lib/llm/tailorForUserHeadless.js. (Counted from the tree on 2026-09-03.
// PLAN-A1 §5.3 says "three same-valued siblings" and names
// lib/experience/pageContext.js:18 as one of them; that file declares
// MAX_CONTEXT_CHARS, and mentions MAX_RESUME_CHARS only in a comment.) Those
// divergent copies are a real problem and they are not this module's. Do not
// widen this sweep to reach them.
const ENGINE_RES = [/\bengine\b/i, /\bwantsEmbedded\b/, /\breadEngine\b/];

let SOURCE_CACHE = null;

function sourceFiles() {
  if (SOURCE_CACHE) return SOURCE_CACHE;
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".js") && path.resolve(full) !== SELF_PATH) found.push(full);
    }
  };
  walk(APP_DIR);
  walk(LIB_DIR);
  SOURCE_CACHE = found.map((f) => [path.relative(ROOT, f).split(path.sep).join("/"), readFileSync(f, "utf8")]);
  return SOURCE_CACHE;
}

// The walk is read ONCE, here, with an explicit budget. A cold full-tree walk
// of app/ + lib/ has measured 14.6s in this repo, which blows vitest's 5s
// default hook timeout -- so a sweep that reads lazily inside the first `it`
// passes warm on a developer's machine and fails on a fresh checkout or in CI.
beforeAll(() => {
  sourceFiles();
}, 60_000);

function isProductionSource(rel) {
  return !rel.endsWith(".test.js");
}

// Strips BOTH block comments (`/* ... */`, including JSDoc) and whole lines
// whose trimmed content starts with `//`. Block comments are blanked
// character-by-character (newlines preserved) rather than deleted, so line
// numbers are undisturbed.
function stripComments(src) {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlockComments
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

function sourceOf(rel) {
  const entry = sourceFiles().find(([r]) => r === rel);
  expect(entry, `${rel} was not found in the swept tree`).toBeDefined();
  return entry[1];
}

describe("[src] sweep infrastructure", () => {
  it("[control] the sweep walks a populated tree and reaches the files it guards", () => {
    const swept = sourceFiles().map(([rel]) => rel);
    expect(swept.length).toBeGreaterThan(100);
    expect(swept).toContain(ROUTE_PATH);
    expect(swept).toContain(CHATBOT_PATH);
    expect(swept).not.toContain("lib/chat/applicationContextSourceSweep.test.js");
  });

  it("[canary] the cap pattern matches a declaration and NOT an import of the same name", () => {
    expect(CAP_DECLARATION_RE.test("const MAX_JD_CHARS = 1500;")).toBe(true);
    expect(CAP_DECLARATION_RE.test("  const MAX_APPLICATIONS = 25;")).toBe(true);
    expect(CAP_DECLARATION_RE.test("let MAX_TAILORED_CHARS = 2000")).toBe(true);
    expect(CAP_DECLARATION_RE.test('import { MAX_JD_CHARS } from "@/lib/chat/applicationContext";')).toBe(false);
    expect(CAP_DECLARATION_RE.test("truncate(app.jobDescription, MAX_JD_CHARS)")).toBe(false);
  });

  it("[canary] stripComments blanks a // line and a JSDoc block line, but leaves real code intact", () => {
    expect(stripComments("// this module is engine-blind by convention")).not.toMatch(/\bengine\b/i);
    expect(stripComments("/**\n * never reads the engine field\n */")).not.toMatch(/\bengine\b/i);
    expect(stripComments("const e = wantsEmbedded(body.engine);")).toMatch(/\bwantsEmbedded\b/);
  });

  it("[canary] isProductionSource excludes .test.js and nothing else", () => {
    expect(isProductionSource("lib/chat/applicationContext.test.js")).toBe(false);
    expect(isProductionSource("lib/chat/applicationContext.js")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1. One definition of the three caps, tree-wide.
// ---------------------------------------------------------------------------

describe("[src] lib/chat/applicationContext.js is the only file that declares the three chat caps", () => {
  it("[control] the module itself declares all three", () => {
    const src = sourceOf(MODULE_PATH);
    expect(src).toMatch(/\b(?:const|let|var)\s+MAX_APPLICATIONS\s*=/);
    expect(src).toMatch(/\b(?:const|let|var)\s+MAX_JD_CHARS\s*=/);
    expect(src).toMatch(/\b(?:const|let|var)\s+MAX_TAILORED_CHARS\s*=/);
  });

  it("no other production file under app/ or lib/ declares any of them", () => {
    const offenders = sourceFiles()
      .filter(([rel]) => isProductionSource(rel) && rel !== MODULE_PATH)
      .filter(([, src]) => CAP_DECLARATION_RE.test(stripComments(src)))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  it("[control] the route still USES the caps -- deleting them is not the same as deleting the feature", () => {
    // Paired positive control for the absence above. An empty offender list is
    // also what a tree in which the whole applications block was deleted looks
    // like; this is what says the block is still rendered from the shared
    // definitions.
    const route = stripComments(sourceOf(ROUTE_PATH));
    expect(route).toMatch(/from\s+["']@\/lib\/chat\/applicationContext["']/);
    expect(route).toMatch(/renderApplicationsSection/);
    const chatbot = stripComments(sourceOf(CHATBOT_PATH));
    expect(chatbot).toMatch(/from\s+["']@\/lib\/chat\/applicationContext["']/);
    expect(chatbot).toMatch(/projectApplicationsForRequest/);
  });
});

// ---------------------------------------------------------------------------
// 2. The module cannot see the engine.
// ---------------------------------------------------------------------------

describe("[src] lib/chat/applicationContext.js never mentions the engine", () => {
  it("its source (comments stripped) contains none of engine / wantsEmbedded / readEngine", () => {
    const stripped = stripComments(sourceOf(MODULE_PATH));
    for (const re of ENGINE_RES) {
      expect(stripped, `applicationContext.js mentions ${re} outside a comment`).not.toMatch(re);
    }
  });

  it("[control] the same three patterns DO match the two files that legitimately read the engine", () => {
    // Without this, a sweep whose matcher was quietly broken (or whose target
    // file went missing) reports a clean tree forever.
    const chatbot = stripComments(sourceOf(CHATBOT_PATH));
    const route = stripComments(sourceOf(ROUTE_PATH));
    expect(chatbot).toMatch(/\breadEngine\b/);
    expect(chatbot).toMatch(/\bengine\b/i);
    expect(route).toMatch(/\bwantsEmbedded\b/);
    expect(route).toMatch(/\bengine\b/i);
  });

  it("[control] the module has no imports at all", () => {
    // The other half of engine-blindness, and the reason it is a leaf: it must
    // import neither chatbot.js (which pulls "use client" + localStorage
    // transitively via @/app/settings/engine) nor route.js (which a client
    // bundle cannot import at all).
    const stripped = stripComments(sourceOf(MODULE_PATH));
    expect(stripped).not.toMatch(/^\s*import\s/m);
    expect(stripped).not.toMatch(/\brequire\s*\(/);
  });
});
