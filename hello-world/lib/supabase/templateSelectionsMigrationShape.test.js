// N151a (4b) — T1: the DDL shape of the template_selections migration. A
// source-text parse, NOT a live-database query (no live Supabase is reachable
// from this checkout, so this proves the repo's own declaration is internally
// consistent, not that it was applied). Modeled directly on
// applicationProjectPoolMigrationShape.test.js and its disciplines: every
// absence assertion is paired with a positive control on the SAME extractor,
// every parse is anchored on a statement (not a bare identifier in prose), and
// the migration is located BY CONTENT (the create-table statement), not by an
// exact stamp — so the implementer may pick any stamp strictly later than the
// current latest (20261008000000) without breaking this test.
//
// RED on HEAD: no migration creates public.template_selections, so the locator
// below finds no file and the [control] test fails loudly (toEqual([null])),
// and createBlock is null so every shape assertion throws. GREEN once Step 1
// lands 20261008010000_n151a_template_selections.sql.
//
// The property that matters most (R1, SILENT): the template_id FK must be
// `on delete set null`. A CASCADE there would delete the selection row when a
// template is deleted (loses the "fall back to native rendering" contract,
// design §6.2 / ST-10); a RESTRICT would make a template delete fail. The
// `on delete set null` literal is asserted on the template_id column line
// specifically, so a CASCADE mutant on THAT fk reds while user_id's legitimate
// `on delete cascade` is untouched. The N64 migration is the positive control
// that both discriminators (set-null vs cascade) actually fire on real DDL.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "../sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const TABLE = "public.template_selections";

// The N64 migration legitimately carries RLS, four owner-scoped policies,
// grants, a `on delete cascade` fk (user_id) AND two `on delete set null` fks
// (the applications.*_template_id columns). It is the positive control for
// every pattern below AND proves the set-null/cascade discriminators are not
// dead regexes.
const CONTROL_NAME = "20260930000000_n64_saved_templates.sql";

// The verified current-latest stamp (plan F15). The new migration must sort
// strictly after it.
const LATEST_STAMP = 20261008000000;

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

describe("[src] template_selections migration shape (T1)", () => {
  it("[control] exactly one migration creates public.template_selections", () => {
    expect(migrationFiles.length).toBeGreaterThan(20);
    const creators = migrationFiles.filter((f) =>
      createTableStatement(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"), TABLE),
    );
    // RED on HEAD: no such migration -> creators is [] and migrationName is null.
    expect(creators).toEqual([migrationName]);
    expect(createBlock).not.toBeNull();
  });

  it("[canary] createTableStatement returns null on a missing anchor and ignores a comment mention", () => {
    expect(createTableStatement("select 1;", TABLE)).toBeNull();
    expect(createTableStatement(`-- create table if not exists ${TABLE} ( x int );`, TABLE)).toBeNull();
    const real = `create table if not exists ${TABLE} (\n  user_id uuid not null\n);\nselect 1;`;
    expect(createTableStatement(real, TABLE)).toContain("user_id uuid not null");
    expect(createTableStatement(real, TABLE)).not.toContain("select 1");
  });

  it("is stamped strictly later than the current latest migration (20261008000000)", () => {
    expect(migrationName, "no template_selections migration found").not.toBeNull();
    const stamp = Number(String(migrationName).slice(0, 14));
    expect(Number.isFinite(stamp)).toBe(true);
    expect(stamp).toBeGreaterThan(LATEST_STAMP);
  });

  describe("the primary key is (user_id, kind) — at most one selection per kind", () => {
    it("declares a composite primary key on (user_id, kind)", () => {
      // Table-level PK (the two-column form); whitespace-tolerant.
      expect(createBlock).toMatch(/primary key\s*\(\s*user_id\s*,\s*kind\s*\)/i);
    });
  });

  describe("the template_id foreign key is ON DELETE SET NULL — the R1 guard", () => {
    it("declares template_id referencing resume_templates(id) on delete set null", () => {
      // Scoped to the template_id column line: user_id's own fk is legitimately
      // `on delete cascade`, so we must not read that as template_id's rule.
      const line = (createBlock.match(/template_id[^,]*?(?=,\s*\n|\n\s*\w+\s+\w|\)\s*;|\bprimary key\b)/is) || [""])[0];
      expect(line, "no template_id column found in the create block").toMatch(/template_id/i);
      expect(line).toMatch(/references\s+public\.resume_templates\s*\(\s*id\s*\)/i);
      expect(line).toMatch(/on delete set null/i);
      // And it must NOT be cascade/restrict (the CASCADE mutant reds here).
      expect(line).not.toMatch(/on delete cascade/i);
      expect(line).not.toMatch(/on delete restrict/i);
    });

    it("[control] the same set-null / cascade discriminators both fire on the N64 migration", () => {
      // Proves the regexes read real DDL: N64's resume_templates.user_id fk is
      // `on delete cascade`, and its applications.*_template_id fks are
      // `on delete set null`. If either discriminator were a dead regex this
      // control would fail.
      const controlRaw = readFileSync(path.join(MIGRATIONS_DIR, CONTROL_NAME), "utf8");
      const controlStripped = stripSqlComments(controlRaw);
      expect(controlStripped).toMatch(/references\s+auth\.users\s*\(\s*id\s*\)\s+on delete cascade/i);
      expect(controlStripped).toMatch(/references\s+public\.resume_templates\s*\(\s*id\s*\)\s*\n?\s*on delete set null/i);
    });
  });

  describe("the kind column admits resume AND cover (forecloses nothing for cover)", () => {
    it("declares a kind CHECK containing 'resume' and 'cover'", () => {
      const checkMatch = createBlock.match(/kind[\s\S]*?check\s*\(\s*kind\s+in\s*\(([^)]*)\)\s*\)/i);
      expect(checkMatch, "no kind CHECK found").not.toBeNull();
      expect(checkMatch[1]).toMatch(/'resume'/);
      expect(checkMatch[1]).toMatch(/'cover'/);
    });

    it("[control] the kind CHECK does NOT admit 'email' (same exclusion as resume_templates)", () => {
      const checkMatch = createBlock.match(/kind[\s\S]*?check\s*\(\s*kind\s+in\s*\(([^)]*)\)\s*\)/i);
      expect(checkMatch).not.toBeNull();
      expect(checkMatch[1]).not.toMatch(/'email'/);
    });
  });

  describe("RLS, four owner-scoped policies and grants", () => {
    it("enables row level security on template_selections", () => {
      expect(stripped).toMatch(/alter table\s+public\.template_selections\s+enable row level security/i);
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
      expect(stripped).toMatch(/grant select, insert, update, delete on table\s+public\.template_selections to authenticated/i);
      expect(stripped).toMatch(/grant all on table\s+public\.template_selections to service_role/i);
    });
  });

  describe("additive only — no destructive statement, no touch of resume_templates/applications", () => {
    it("declares no drop/delete/update/truncate statement and never alters resume_templates or applications", () => {
      for (const re of [/^drop\b/im, /^delete\b/im, /^update\b/im, /^truncate\b/im]) {
        const withoutDropPolicy = stripped.replace(/drop policy if exists[^;]*;/gi, "");
        expect(withoutDropPolicy).not.toMatch(re);
      }
      // It REFERENCES resume_templates (the fk target) but must not ALTER it,
      // and must not touch applications at all.
      expect(stripped).not.toMatch(/alter table\s+public\.resume_templates/i);
      expect(stripped).not.toMatch(/\bpublic\.applications\b/i);
    });
  });
});

// WHAT THIS CANNOT CATCH: a source-text parse proves the repo's DECLARATION is
// shaped right, never that the live DB applied it (BL-A, owner/1d). It cannot
// see a column TYPE mismatch the regexes don't pin, and the `set null` guard
// catches a WRONG on-delete action, not a template_id fk that is simply absent
// (a missing fk is caught by the "declares template_id referencing" clause).
