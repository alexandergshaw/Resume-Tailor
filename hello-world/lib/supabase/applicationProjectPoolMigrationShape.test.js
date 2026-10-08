// N143 seam 1 (T1). The DDL shape of the application_project_pool migration —
// a source-text parse, not a live-database query (no live Supabase is reachable
// from this checkout, so this proves the repo's own declaration is internally
// consistent, not that it was applied). Modeled on
// applicationDigestsMigrationShape.test.js and its disciplines: every absence
// assertion is paired with a positive control on the SAME extractor, and every
// parse is anchored on a statement, not a bare identifier in prose.
//
// RED on HEAD: no migration creates public.application_project_pool, so the
// locator below finds no file and the control test fails loudly. The migration
// is located BY CONTENT (the create-table statement), not by an exact stamp, so
// the implementer may pick any stamp strictly later than the current latest
// (20260930000000) without breaking this test.
//
// The property that matters most (R-I): the status CHECK must admit all three
// of 'pending', 'ready', 'failed'. 'pending' is an ACTIVELY WRITTEN state here
// (the prewarm route writes it before the model call); a CHECK of only
// ('ready','failed') makes that write violate the constraint — the whole upsert
// fails, no row is written, and the cost gate re-fires a billed generation on
// every load. A CHECK missing 'pending' must red here.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "../sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const TABLE = "public.application_project_pool";

// The migration that created application_digests — the positive control for
// the RLS/policy/grant/cascade assertions, since it legitimately has them all.
const CONTROL_NAME = "20260817000000_application_digests.sql";

function createTableStatement(sql, table) {
  const stripped = stripSqlComments(sql);
  const anchor = `create table if not exists ${table}`;
  const idx = stripped.indexOf(anchor);
  if (idx === -1) return null;
  const tail = stripped.slice(idx);
  const semi = tail.indexOf(";");
  if (semi === -1) return null;
  return tail.slice(0, semi + 1);
}

function countOccurrences(haystack, needle) {
  const re = new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : needle.flags + "g");
  return (haystack.match(re) || []).length;
}

let migrationFiles = null;
let migrationName = null;
let raw = null;
let stripped = null;
let createBlock = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  // Locate by content, not stamp: the one migration that creates this table.
  migrationName =
    migrationFiles.find((f) =>
      createTableStatement(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"), TABLE),
    ) || null;
  if (migrationName) {
    raw = readFileSync(path.join(MIGRATIONS_DIR, migrationName), "utf8");
    stripped = stripSqlComments(raw);
    createBlock = createTableStatement(raw, TABLE);
  }
});

describe("[src] application_project_pool migration shape", () => {
  it("[control] exactly one migration creates public.application_project_pool", () => {
    expect(migrationFiles.length).toBeGreaterThan(20);
    const creators = migrationFiles.filter((f) =>
      createTableStatement(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"), TABLE),
    );
    expect(creators).toEqual([migrationName]);
    expect(createBlock).not.toBeNull();
  });

  it("[canary] createTableStatement returns null on a missing anchor and ignores a comment mention", () => {
    expect(createTableStatement("select 1;", TABLE)).toBeNull();
    expect(createTableStatement(`-- create table if not exists ${TABLE} ( x int );`, TABLE)).toBeNull();
    const real = `create table if not exists ${TABLE} (\n  application_id uuid primary key\n);\nselect 1;`;
    expect(createTableStatement(real, TABLE)).toContain("application_id uuid primary key");
    expect(createTableStatement(real, TABLE)).not.toContain("select 1");
  });

  describe("the primary key and cascading foreign keys", () => {
    it("declares application_id as the PK referencing applications(id) on delete cascade", () => {
      expect(createBlock).toMatch(
        /application_id\s+uuid\s+primary key\s+references\s+public\.applications\s*\(\s*id\s*\)\s+on delete cascade/i,
      );
    });

    it("declares user_id not null referencing auth.users(id) on delete cascade", () => {
      expect(createBlock).toMatch(
        /user_id\s+uuid\s+not null\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on delete cascade/i,
      );
    });
  });

  describe("the columns", () => {
    it("declares projects as jsonb with a default", () => {
      expect(createBlock).toMatch(/projects\s+jsonb\s+not null\s+default\s+'\[\]'::jsonb/i);
    });

    it("declares status text not null defaulting to 'pending'", () => {
      expect(createBlock).toMatch(/status\s+text\s+not null\s+default\s+'pending'/i);
    });

    it("declares error, engine and both timestamptz timestamps defaulting to now()", () => {
      expect(createBlock).toMatch(/\berror\s+text\b/i);
      expect(createBlock).toMatch(/\bengine\s+text\b/i);
      expect(createBlock).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
      expect(createBlock).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
    });
  });

  describe("the status CHECK must admit all three states — the R-I guard", () => {
    it("the CHECK set contains 'pending', 'ready' AND 'failed'", () => {
      const checkMatch = createBlock.match(/check\s*\(\s*status\s+in\s*\(([^)]*)\)\s*\)/i);
      expect(checkMatch).not.toBeNull();
      const set = checkMatch[1];
      expect(set).toMatch(/'pending'/);
      expect(set).toMatch(/'ready'/);
      expect(set).toMatch(/'failed'/);
    });

    it("[control] the same extractor finds the digests CHECK, which deliberately omits 'pending'", () => {
      // Proves the extractor reads a real CHECK set (not a dead regex) AND that
      // a missing 'pending' is detectable: the digests table's own CHECK is
      // ('ready','failed') with no 'pending'.
      const controlBlock = createTableStatement(
        readFileSync(path.join(MIGRATIONS_DIR, CONTROL_NAME), "utf8"),
        "public.application_digests",
      );
      const controlCheck = controlBlock.match(/check\s*\(\s*status\s+in\s*\(([^)]*)\)\s*\)/i);
      expect(controlCheck).not.toBeNull();
      expect(controlCheck[1]).not.toMatch(/'pending'/);
      expect(controlCheck[1]).toMatch(/'ready'/);
    });
  });

  describe("index, RLS, policies and grants", () => {
    it("creates a user_id index", () => {
      expect(stripped).toMatch(/create index if not exists[\s\S]*?on\s+public\.application_project_pool\s*\(\s*user_id\s*\)/i);
    });

    it("enables row level security", () => {
      expect(stripped).toMatch(/alter table\s+public\.application_project_pool\s+enable row level security/i);
      // Positive control on the same pattern against the digests migration.
      const controlStripped = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, CONTROL_NAME), "utf8"));
      expect(controlStripped).toMatch(/enable row level security/i);
    });

    it("declares four owner-scoped policies (select/insert/update/delete on auth.uid() = user_id)", () => {
      expect(countOccurrences(stripped, /create policy/gi)).toBe(4);
      expect(stripped).toMatch(/for select\s+using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
      expect(stripped).toMatch(/for insert\s+with check\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
      expect(stripped).toMatch(/for update\s+using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
      expect(stripped).toMatch(/for delete\s+using\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i);
    });

    it("grants to authenticated and service_role", () => {
      expect(stripped).toMatch(/grant select, insert, update, delete on table\s+public\.application_project_pool to authenticated/i);
      expect(stripped).toMatch(/grant all on table\s+public\.application_project_pool to service_role/i);
    });
  });

  describe("additive only — no destructive statement, no touch of applications", () => {
    it("declares no drop/delete/update/truncate/insert statement and never alters public.applications", () => {
      for (const re of [/^drop\b/im, /^delete\b/im, /^update\b/im, /^truncate\b/im, /^insert\b/im]) {
        // `drop policy if exists` is legitimate idempotent setup; exclude it.
        const withoutDropPolicy = stripped.replace(/drop policy if exists[^;]*;/gi, "");
        expect(withoutDropPolicy).not.toMatch(re);
      }
      expect(stripped).not.toMatch(/alter table\s+public\.applications/i);
    });
  });
});
