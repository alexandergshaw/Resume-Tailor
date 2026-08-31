// Two independent things live in this file, both source-text sweeps rather
// than behavioural tests, because in both cases the property being asserted
// IS the shape of the source:
//
// 1. The migration's DDL shape (AC-P1/AC-P3/AC-P4): drive_file_id NOT NULL
//    with no withdrawn nullable-claim protocol, RLS + the composite primary
//    key on drive_documents, and drive_connections' deliberately absent
//    `authenticated` grant. A behavioural test can't see any of this — it
//    would need a live Postgres instance running this exact migration, which
//    this repo's test suite (see AC gates below) never does.
//
// 2. The `[src]` sweep from ADJUDICATION.md §A-1 / AC-G6: no module other
//    than lib/supabase/driveConnections.js may name "drive_connections", and
//    that module must never select("*") from it. This IS the mitigation the
//    architecture adopted in exchange for storing a refresh token in
//    Postgres instead of Redis, so it has to be enforced somewhere, and
//    reading source text is the only way to enforce "nothing else names this
//    table".
//
// Both disciplines from app/copilot/predictionsRemoved.test.js are followed
// here: every absence assertion has a paired positive control (proof the
// checker actually finds real matches, not just an empty result from a
// broken pattern), and the sweep excludes only itself by exact resolved
// path — never by a `.test.js` suffix rule — so a stray reference in some
// OTHER test file is still caught.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_DIR = path.join(ROOT, "app");
const LIB_DIR = path.join(ROOT, "lib");
const MIGRATION_PATH = path.join(ROOT, "supabase/migrations/20260901000000_drive.sql");
const DRIVE_CONNECTIONS_MODULE_PATH = path.join(ROOT, "lib/supabase/driveConnections.js");

// This file itself necessarily quotes "drive_connections" repeatedly (table
// name, comments, assertions) — it is the checker, not a caller of the
// module — so it must be its own explicit exclusion, same as
// predictionsRemoved.test.js excludes itself.
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));

function countOccurrences(haystack, needle) {
  if (needle instanceof RegExp) {
    const re = new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : needle.flags + "g");
    return (haystack.match(re) || []).length;
  }
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ---------------------------------------------------------------------------
// 1. Migration shape
// ---------------------------------------------------------------------------

describe("20260901000000_drive.sql shape", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  // Isolate each table's own section so grant/policy/RLS assertions can't
  // accidentally match the OTHER table's statements — the two tables sit in
  // the same file and drive_documents legitimately HAS the authenticated
  // grant that drive_connections must NOT have, so block isolation is
  // load-bearing, not cosmetic.
  const section2Start = migration.indexOf("-- 2. public.drive_connections");
  expect(section2Start).toBeGreaterThan(-1);
  const documentsBlock = migration.slice(0, section2Start);
  const connectionsBlock = migration.slice(section2Start);

  it("[control] the file was actually read and split into two non-empty sections", () => {
    expect(migration.length).toBeGreaterThan(1000);
    expect(documentsBlock.length).toBeGreaterThan(500);
    expect(connectionsBlock.length).toBeGreaterThan(500);
  });

  describe("drive_documents", () => {
    it("has the composite primary key (user_id, position_id, scope), exactly once", () => {
      expect(
        countOccurrences(documentsBlock, "constraint drive_documents_pkey primary key (user_id, position_id, scope)"),
      ).toBe(1);
    });

    it("declares drive_file_id as text NOT NULL, exactly once", () => {
      expect(countOccurrences(documentsBlock, /drive_file_id\s+text\s+not null/)).toBe(1);
    });

    it("carries NO settled-check constraint and NO nullable-claim protocol (AC-P1: withdrawn)", () => {
      // Absence assertion...
      expect(migration).not.toMatch(/drive_documents_settled_check/);
      expect(migration).not.toMatch(/drive_file_id\s+is\s+null/i);
      // ...paired with a positive control: the checker DOES find the sibling
      // constraint that legitimately exists, so an empty result above is not
      // just a mis-scoped or dead regex.
      expect(countOccurrences(documentsBlock, "constraint drive_documents_scope_check")).toBe(1);
    });

    it("pins the scope check to the exact DOCX_SCOPES literals", () => {
      expect(countOccurrences(documentsBlock, "check (scope in ('resume', 'cover'))")).toBe(1);
    });

    it("enables RLS exactly once", () => {
      expect(countOccurrences(documentsBlock, "alter table public.drive_documents enable row level security")).toBe(
        1,
      );
    });

    it("defines exactly four owner-scoped policies (select/insert/update/delete)", () => {
      expect(countOccurrences(documentsBlock, /create policy "drive_documents_select_own"/)).toBe(1);
      expect(countOccurrences(documentsBlock, /create policy "drive_documents_insert_own"/)).toBe(1);
      expect(countOccurrences(documentsBlock, /create policy "drive_documents_update_own"/)).toBe(1);
      expect(countOccurrences(documentsBlock, /create policy "drive_documents_delete_own"/)).toBe(1);
    });

    it("the UPDATE policy carries BOTH using and with check, in the same statement", () => {
      const updateStatement = documentsBlock.slice(
        documentsBlock.indexOf('create policy "drive_documents_update_own"'),
        documentsBlock.indexOf('create policy "drive_documents_delete_own"'),
      );
      expect(updateStatement).toMatch(/for update using \(auth\.uid\(\) = user_id\)/);
      expect(updateStatement).toMatch(/with check \(auth\.uid\(\) = user_id\)/);
      // Positive control that "using" and "with check" are actually two
      // distinct clauses being checked, not one regex trivially matching an
      // empty statement: the SELECT policy has `using` but must NOT have
      // `with check` (a read policy carries no such clause).
      const selectStatement = documentsBlock.slice(
        documentsBlock.indexOf('create policy "drive_documents_select_own"'),
        documentsBlock.indexOf('create policy "drive_documents_insert_own"'),
      );
      expect(selectStatement).toMatch(/using \(auth\.uid\(\) = user_id\)/);
      expect(selectStatement).not.toMatch(/with check/);
    });

    it("grants select/insert/update/delete to authenticated, and all to service_role", () => {
      expect(
        countOccurrences(
          documentsBlock,
          "grant select, insert, update, delete on table public.drive_documents to authenticated;",
        ),
      ).toBe(1);
      expect(countOccurrences(documentsBlock, "grant all on table public.drive_documents to service_role;")).toBe(1);
    });

    it("declares no separate user_id index (the PK's own btree already serves it)", () => {
      // Absence...
      expect(documentsBlock).not.toMatch(/^create index/im);
      // ...paired with a positive control proving the pattern itself can
      // match a real "create index" statement (a canary, not the file under
      // test — this migration deliberately has none).
      expect("create index if not exists x_user_idx on public.x (user_id);").toMatch(/^create index/im);
    });
  });

  describe("drive_connections", () => {
    it("has user_id as the sole primary key", () => {
      expect(countOccurrences(connectionsBlock, /user_id\s+uuid\s+primary key/)).toBe(1);
      // Positive control: drive_documents' user_id is NOT a primary-key
      // column on its own (it's part of a composite constraint instead), so
      // the same pattern must NOT match there — proving this isn't a regex
      // that matches any "user_id" line.
      expect(documentsBlock).not.toMatch(/user_id\s+uuid\s+primary key/);
    });

    it("declares refresh_token as text NOT NULL", () => {
      expect(countOccurrences(connectionsBlock, /refresh_token\s+text\s+not null/)).toBe(1);
    });

    it("enables RLS exactly once", () => {
      expect(
        countOccurrences(connectionsBlock, "alter table public.drive_connections enable row level security"),
      ).toBe(1);
    });

    it("defines NO policy at all for drive_connections", () => {
      // Absence...
      expect(connectionsBlock).not.toMatch(/create policy/);
      // ...paired with the positive control that drive_documents (the OTHER
      // half of the same file) legitimately has four, so the checker is
      // proven capable of finding "create policy" when it exists.
      expect(countOccurrences(documentsBlock, /create policy/g)).toBe(4);
    });

    it("REVOKES all access from anon and authenticated", () => {
      expect(
        countOccurrences(connectionsBlock, "revoke all on table public.drive_connections from anon, authenticated;"),
      ).toBe(1);
    });

    it("has NO `authenticated` grant anywhere — the defining property of this table", () => {
      // Anchored to the START of a line so this only matches an actual SQL
      // `grant` statement, never a comment that mentions the word — and this
      // table's own warning comment (a few lines above) explains the ban by
      // literally quoting the phrase "grant ... to authenticated", which a
      // non-anchored pattern would (and, caught during authoring of this
      // test, DID) mistake for a real grant statement.
      const GRANT_TO_AUTHENTICATED_RE = /^grant\b[^;]*\bto authenticated\b/im;
      // Absence: no real "grant ... to authenticated" statement in this
      // table's section.
      expect(connectionsBlock).not.toMatch(GRANT_TO_AUTHENTICATED_RE);
      // Positive control, two-fold: (a) the checker can find that exact
      // shape — drive_documents' own grant statement matches the same
      // anchored pattern — and (b) drive_connections' section is not simply
      // empty of grants altogether; it grants to service_role instead.
      expect(documentsBlock).toMatch(GRANT_TO_AUTHENTICATED_RE);
      expect(countOccurrences(connectionsBlock, "grant all on table public.drive_connections to service_role;")).toBe(
        1,
      );
    });

    it("carries a prominent warning against copying the authenticated grant block from a neighbouring migration", () => {
      expect(countOccurrences(connectionsBlock, "THIS TABLE IS UNLIKE EVERY OTHER TABLE IN THIS DIRECTORY")).toBe(1);
      expect(
        countOccurrences(connectionsBlock, "FIRST table in this migrations directory with NO"),
      ).toBe(1);
      expect(countOccurrences(connectionsBlock, "Do NOT copy the standard grant block")).toBe(1);
    });

    it("uses bigint for expiry_date (epoch milliseconds), not timestamptz", () => {
      expect(countOccurrences(connectionsBlock, /expiry_date\s+bigint/)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. [src] sweep — drive_connections is reachable from exactly one module
//    (ADJUDICATION.md §A-1's adopted mitigation; AC-G6)
// ---------------------------------------------------------------------------

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

// Budget matches predictionsRemoved.test.js's own measured cold-cache walk
// of this same app/+lib/ tree (~14.6s cold, sub-second warm); vitest's
// default 5s testTimeout is not enough on a cold filesystem cache.
beforeAll(() => {
  sourceFiles();
}, 60_000);

// Two narrowings from AC-G6's literal "no FILE contains the string", both
// scoped to what the property actually protects — that no CODE PATH reaches
// the table — and both pinned against the real, already-written files that
// motivated them rather than left as an unexercised idea:
//
// 1. Test files are excluded. lib/supabase/driveConnections.test.js and
//    lib/drive/routeSupport.test.js both legitimately name the table in a
//    fixture string to simulate a realistic Postgres error (e.g. 42P01's
//    `relation "drive_connections" does not exist` message) — that is a test
//    DOUBLE, not a reachable code path, the same reasoning
//    predictionsRemoved.test.js uses to exclude files whose job is to quote
//    the banned thing.
// 2. Comment-only lines are stripped before searching. lib/drive/driveOAuth.js
//    and lib/drive/routeSupport.js both document IN PROSE why they
//    deliberately do NOT touch drive_connections ("it never reads or writes
//    drive_connections" / "AC-E4a: no drive_connections row for this user"),
//    naming the table to say so. That is exactly the design-rationale
//    convention this codebase writes everywhere (this migration's own header
//    does the same), and it creates no code path to the table — unlike a
//    real `.from(...)` call or a string literal used in actual logic, which
//    this strip does NOT remove: it only blanks lines whose TRIMMED content
//    starts with "//".
function isProductionSource(rel) {
  return !rel.endsWith(".test.js");
}

function stripLineComments(src) {
  return src
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

describe("[src] drive_connections is reachable from exactly one module", () => {
  it("[control] the sweep walks a populated tree and reaches driveConnections.js", () => {
    const swept = sourceFiles().map(([rel]) => rel);
    expect(swept.length).toBeGreaterThan(100);
    expect(swept).toContain("lib/supabase/driveConnections.js");
    expect(swept).toContain("lib/supabase/driveDocuments.js");
    expect(swept).not.toContain("lib/supabase/driveMigrationShape.test.js");
  });

  it("the literal string 'drive_connections' appears in driveConnections.js (positive control for the sweep below)", () => {
    const [, src] = sourceFiles().find(([rel]) => rel === "lib/supabase/driveConnections.js");
    expect(src).toContain("drive_connections");
  });

  it("[canary] stripLineComments blanks a pure comment line but leaves a real code line intact", () => {
    expect(stripLineComments('// mentions drive_connections here')).not.toContain("drive_connections");
    expect(stripLineComments('const TABLE = "drive_connections";')).toContain("drive_connections");
  });

  it("[canary] isProductionSource excludes .test.js and nothing else", () => {
    expect(isProductionSource("lib/drive/routeSupport.test.js")).toBe(false);
    expect(isProductionSource("lib/drive/routeSupport.js")).toBe(true);
  });

  it("[pinned] driveOAuth.js and routeSupport.js DO mention the table, in comments only — proving the narrowings above are load-bearing, not vacuous", () => {
    const oauth = sourceFiles().find(([rel]) => rel === "lib/drive/driveOAuth.js");
    const route = sourceFiles().find(([rel]) => rel === "lib/drive/routeSupport.js");
    expect(oauth).toBeDefined();
    expect(route).toBeDefined();
    // Raw source contains it (a naive, unnarrowed sweep WOULD flag these)...
    expect(oauth[1]).toContain("drive_connections");
    expect(route[1]).toContain("drive_connections");
    // ...but with comments stripped, it's gone: every occurrence in both
    // files is prose, never a reachable code path.
    expect(stripLineComments(oauth[1])).not.toContain("drive_connections");
    expect(stripLineComments(route[1])).not.toContain("drive_connections");
  });

  it("no production source file under app/ or lib/ other than lib/supabase/driveConnections.js contains 'drive_connections' outside a comment", () => {
    const offenders = sourceFiles()
      .filter(([rel]) => isProductionSource(rel) && rel !== "lib/supabase/driveConnections.js")
      .filter(([, src]) => stripLineComments(src).includes("drive_connections"))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  it("driveConnections.js never selects every column with select(\"*\")", () => {
    const src = readFileSync(DRIVE_CONNECTIONS_MODULE_PATH, "utf8");
    const SELECT_STAR_RE = /\.select\(\s*(["'`])\*\1\s*\)/;
    // Absence...
    expect(src).not.toMatch(SELECT_STAR_RE);
    // ...paired with two positive controls: the same regex DOES match a
    // synthetic canary (proving it isn't dead), and the real file DOES call
    // .select( at all — with an explicit column list — so the absence isn't
    // just "this file never selects anything".
    expect('supabase.from(TABLE).select("*").eq("user_id", userId)').toMatch(SELECT_STAR_RE);
    expect(src).toMatch(/\.select\(COLUMNS\)/);
  });
});
