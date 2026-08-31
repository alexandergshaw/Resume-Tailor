// Two `[src]` sweeps that Wave 2's own comments claimed already existed and
// did not (WAVE2-SEAMS.md MINOR-9):
//
//   1. `lib/drive/driveMime.js:6-8` -- "no file other than this one may
//      contain the literal `application/vnd.google-apps.` substring".
//   2. `lib/drive/driveClient.js:1-2` -- "the ONLY module in this repo
//      permitted to call `drive.files.*` ... enforced elsewhere by an
//      `[src]` sweep".
//
// Both invariants held by luck, not enforcement, before this file existed.
// Same discipline as `lib/supabase/driveMigrationShape.test.js`'s own
// `[src]` sweep (which this file otherwise duplicates the walker for, on
// purpose -- the two sweeps guard unrelated invariants and neither should
// depend on the other's test file continuing to exist):
//
//   - Every absence assertion has a paired positive control.
//   - Test files (`*.test.js`) are excluded -- they legitimately quote both
//     the MIME substring and `drive.files.*` call shapes to describe or
//     assert against the real thing (driveClient.test.js's fake, and
//     driveClient.wire.test.js's real wire calls, both need to write
//     `drive.files.update(...)` etc. in an actual test).
//   - Comment-only content is stripped before searching -- NOT just lines
//     starting with `//`. `lib/drive/driveWireProbe.js` documents this exact
//     hazard in a `/** ... */` JSDoc block (` * ... drive.files.*.`), so a
//     stripper that only recognised `//` would flag prose as a violation
//     and go red against correct code -- precisely the failure this file's
//     own header was warned about.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_DIR = path.join(ROOT, "app");
const LIB_DIR = path.join(ROOT, "lib");

// This file itself quotes both the MIME substring and `drive.files.` inside
// prose (this header, and the pattern literals below) -- it is the checker,
// not a caller, so it must exclude itself by exact resolved path.
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));

const DRIVE_MIME_PATH = "lib/drive/driveMime.js";
const DRIVE_CLIENT_PATH = "lib/drive/driveClient.js";

const MIME_SUBSTRING = "application/vnd.google-apps.";
const DRIVE_FILES_CALL_RE = /\bdrive\.files\.\w+\(/;

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

// Budget matches driveMigrationShape.test.js's own measured cold-cache walk
// of the same app/+lib/ tree.
beforeAll(() => {
  sourceFiles();
}, 60_000);

function isProductionSource(rel) {
  return !rel.endsWith(".test.js");
}

// Strips BOTH block comments (`/* ... */`, including JSDoc `/** ... */`)
// and whole lines whose trimmed content starts with `//`. Block comments
// are blanked character-by-character (newlines preserved) rather than
// deleted outright, so line numbers and any code sharing a line with a
// comment's closing `*/` are undisturbed.
function stripComments(src) {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlockComments
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

describe("[src] sweep infrastructure", () => {
  it("[control] the sweep walks a populated tree and reaches both guarded modules", () => {
    const swept = sourceFiles().map(([rel]) => rel);
    expect(swept.length).toBeGreaterThan(100);
    expect(swept).toContain(DRIVE_MIME_PATH);
    expect(swept).toContain(DRIVE_CLIENT_PATH);
    expect(swept).not.toContain("lib/drive/driveSourceSweep.test.js");
  });

  it("[canary] stripComments blanks a // line and a JSDoc block line, but leaves real code intact", () => {
    expect(stripComments("// mentions drive.files.get( here")).not.toContain("drive.files.get(");
    expect(stripComments("/**\n * drive.files.get( in prose\n */")).not.toContain("drive.files.get(");
    expect(stripComments('const x = drive.files.get({ fileId });')).toContain("drive.files.get(");
  });

  it("[canary] isProductionSource excludes .test.js and nothing else", () => {
    expect(isProductionSource("lib/drive/driveClient.test.js")).toBe(false);
    expect(isProductionSource("lib/drive/driveClient.wire.test.js")).toBe(false);
    expect(isProductionSource("lib/drive/driveClient.js")).toBe(true);
  });

  it("[pinned] driveWireProbe.js DOES mention drive.files.* in a JSDoc block, in prose only -- proving the block-comment strip is load-bearing, not vacuous", () => {
    const probe = sourceFiles().find(([rel]) => rel === "lib/drive/driveWireProbe.js");
    expect(probe).toBeDefined();
    // Raw source contains it (a `//`-only stripper would wrongly flag this
    // file as a violation of sweep 2 below)...
    expect(probe[1]).toMatch(DRIVE_FILES_CALL_RE);
    // ...but with block comments stripped, it's gone: the file never issues
    // the call itself, it only describes `driveClient.js`'s callers in prose.
    expect(stripComments(probe[1])).not.toMatch(DRIVE_FILES_CALL_RE);
  });
});

// ---------------------------------------------------------------------------
// 1. MIME-substring sweep -- driveMime.js:6-8
// ---------------------------------------------------------------------------

describe("[src] no file other than driveMime.js names a vnd.google-apps MIME type", () => {
  it("the literal substring appears in driveMime.js (positive control for the sweep below)", () => {
    const [, src] = sourceFiles().find(([rel]) => rel === DRIVE_MIME_PATH);
    expect(src).toContain(MIME_SUBSTRING);
  });

  it("no other production source file under app/ or lib/ contains the substring, in code or in comments", () => {
    const offenders = sourceFiles()
      .filter(([rel]) => isProductionSource(rel) && rel !== DRIVE_MIME_PATH)
      .filter(([, src]) => src.includes(MIME_SUBSTRING))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. drive.files.* call-site sweep -- driveClient.js:1-2
// ---------------------------------------------------------------------------

describe("[src] driveClient.js is the only module that calls drive.files.*", () => {
  it("driveClient.js genuinely calls drive.files.* (positive control for the sweep below)", () => {
    const [, src] = sourceFiles().find(([rel]) => rel === DRIVE_CLIENT_PATH);
    expect(src).toMatch(DRIVE_FILES_CALL_RE);
  });

  it("no other production source file under app/ or lib/ calls drive.files.* outside a comment", () => {
    const offenders = sourceFiles()
      .filter(([rel]) => isProductionSource(rel) && rel !== DRIVE_CLIENT_PATH)
      .filter(([, src]) => DRIVE_FILES_CALL_RE.test(stripComments(src)))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });
});
