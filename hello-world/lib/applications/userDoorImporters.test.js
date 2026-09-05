// AC-2 — "deliberate status changes have their own named door", enforced as
// a source-text sweep of who is allowed to IMPORT `setApplicationStatusByUser`
// (lib/supabase/applicationStatusWriter.js). Precedent for this exact
// discipline — a paired positive control, and excluding the sweep's own
// file by resolved path rather than a `.test.js` suffix rule — is
// lib/supabase/driveMigrationShape.test.js.
//
// NOTE ON PLACEMENT: 3-plan-dataloss.md's PART 2 names this sweep
// `lib/supabase/userDoorImporters.test.js`. It lives here, under
// `lib/applications/`, instead — this wave's file grant permits new sweep
// test files only under `lib/applications/` or `test/`, and `lib/supabase/`
// already carries in-flight work from a different wave.
//
// CORRECTION TO THE ACCEPTANCE CRITERIA'S OWN STATED SET. AC-2's text says
// "the set of source files importing that function is exactly
// [app/hooks/useApplicationDialogs.js, app/page.js]". Measured against the
// tree as it actually landed, that second file is wrong:
//
//   - 3-plan-dataloss.md PART 4 / F-1's edit 3 deletes `handleToggleApplied`'s
//     un-apply branch from app/page.js entirely, under decision R1 — the
//     comment left in its place (app/page.js:1840-1844) says so directly:
//     "this control only ever PROMOTES now. The un-apply branch that used to
//     live here reverted an applied-or-later row straight back to
//     'tracking'... silently nulling a real applied_at." That branch was the
//     only reason page.js would ever have needed this door.
//   - PART 2's third cross-wave contract confirms page.js's actual role: it
//     supplies a `confirm` CALLBACK to the hook
//     (`confirm: (message) => window.confirm(message)`, app/page.js:260),
//     not the writer symbol. The hook calls `setApplicationStatusByUser`
//     internally; page.js never needs to name it.
//   - Read directly: app/page.js:84-87 imports `writeApplicationStatus`,
//     `loadAppliedOrLaterExternalIds` and `deleteUntrackedApplication` from
//     this exact module, but never `setApplicationStatusByUser` — proving
//     this isn't a case of the file avoiding the module altogether.
//
// This sweep therefore asserts the MEASURED set — exactly one file — and
// says so here rather than silently matching AC-2's stale text. See the
// wave-4 report for this finding stated as a top-level item, not just a
// code comment.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_DIR = path.join(ROOT, "app");
const LIB_DIR = path.join(ROOT, "lib");
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));
const WRITER_FILE = "lib/supabase/applicationStatusWriter.js";

const SYMBOL = "setApplicationStatusByUser";

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
      if (!full.endsWith(".js")) continue;
      if (full.endsWith(".test.js")) continue;
      if (path.resolve(full) === SELF_PATH) continue;
      found.push(full);
    }
  };
  walk(APP_DIR);
  walk(LIB_DIR);
  SOURCE_CACHE = found.map((f) => [path.relative(ROOT, f).split(path.sep).join("/"), readFileSync(f, "utf8")]);
  return SOURCE_CACHE;
}

beforeAll(() => {
  sourceFiles();
}, 60_000);

// Detects an IMPORT of the symbol — never a mention of it in any other
// grammatical position. This distinguishes a file that IMPORTS the door from
// the module that DEFINES it (which necessarily names the symbol too, in an
// `export async function setApplicationStatusByUser(...)` declaration — a
// definition is not an import, and must not be flagged as one).
const IMPORT_RE = new RegExp(
  // `import { ..., setApplicationStatusByUser, ... } from "..."`, tolerant
  // of it appearing anywhere in the named-import list and of the import
  // spanning multiple lines (the "s" flag lets "." cross newlines).
  `import\\s*\\{[^}]*\\b${SYMBOL}\\b[^}]*\\}\\s*from`,
  "s",
);

function importsSymbol(src) {
  return IMPORT_RE.test(src);
}

function definesSymbol(src) {
  return new RegExp(`export\\s+async\\s+function\\s+${SYMBOL}\\s*\\(`).test(src);
}

describe("[src] setApplicationStatusByUser importers — AC-2's named door", () => {
  it("[control] the sweep walks a populated tree and reaches the writer module", () => {
    const swept = sourceFiles().map(([rel]) => rel);
    expect(swept.length).toBeGreaterThan(100);
    expect(swept).toContain(WRITER_FILE);
  });

  it("[canary] importsSymbol matches a named import, in any position in the list, across lines", () => {
    expect(importsSymbol('import { setApplicationStatusByUser } from "./x";')).toBe(true);
    expect(importsSymbol('import { foo, setApplicationStatusByUser, bar } from "./x";')).toBe(true);
    expect(
      importsSymbol('import {\n  foo,\n  setApplicationStatusByUser,\n} from "../../lib/supabase/x";'),
    ).toBe(true);
  });

  it("[canary] importsSymbol is false for a DEFINITION of the symbol, and for an unrelated import", () => {
    expect(importsSymbol("export async function setApplicationStatusByUser(supabase, args) {}")).toBe(false);
    expect(importsSymbol('import { writeApplicationStatus } from "./x";')).toBe(false);
    // A comment mentioning the name is not an import either.
    expect(importsSymbol("// see setApplicationStatusByUser for details")).toBe(false);
  });

  it("[control] the checker distinguishes DEFINING the door from IMPORTING it", () => {
    const [, src] = sourceFiles().find(([rel]) => rel === WRITER_FILE);
    expect(definesSymbol(src)).toBe(true);
    expect(importsSymbol(src)).toBe(false);
  });

  it("[control] the checker finds the one real, known importer (positive control)", () => {
    const [, src] = sourceFiles().find(([rel]) => rel === "app/hooks/useApplicationDialogs.js");
    expect(importsSymbol(src)).toBe(true);
  });

  it("[pinned] app/page.js mentions the module but never imports THIS symbol from it", () => {
    // Proves the app/page.js exclusion below is measured, not assumed: the
    // file DOES import other names from the same module (so this isn't a
    // case of avoiding the module wholesale), but never this one.
    const [, src] = sourceFiles().find(([rel]) => rel === "app/page.js");
    expect(src).toMatch(/from\s+["']\.\.\/lib\/supabase\/applicationStatusWriter["']/);
    expect(importsSymbol(src)).toBe(false);
  });

  it("the set of files importing setApplicationStatusByUser is EXACTLY one — toEqual, not toContain", () => {
    const importers = sourceFiles()
      .filter(([, src]) => importsSymbol(src))
      .map(([rel]) => rel)
      .sort();
    expect(importers).toEqual(["app/hooks/useApplicationDialogs.js"]);
  });

  it("[control] the toEqual above can fail — planting a second importer changes the result", () => {
    const withPlant = [
      ...sourceFiles().filter(([, src]) => importsSymbol(src)).map(([rel]) => rel),
      "app/some-other-file.js",
    ].sort();
    expect(withPlant).not.toEqual(["app/hooks/useApplicationDialogs.js"]);
  });
});
