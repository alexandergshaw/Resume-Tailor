// TDD RED handoff -- the storage contract for N33's two new tables
// (design-reconciled.r2.md ss3.1/ss3.2, RD-N33.1/RD-N33.2): `candidate_identity`
// (PK = user_id, so "two names for one account" is structurally IMPOSSIBLE,
// never merely absent) and `application_trusted_names` (PK = application_id,
// FK to applications, user_id not null).
//
// THE MIGRATION FILE DOES NOT EXIST YET. No binding document commits to a
// filename (design-reconciled.r2.md ss7's own "what I could not verify" list
// does not name one either), so this file searches EVERY migration under
// supabase/migrations/ for the two tables' own CREATE TABLE text, by
// content, rather than guessing a filename -- the same "search by content,
// not by a guessed name" discipline this repo's other absence-searches use.
// Confirmed absent this round: `grep -rln "candidate_identity"
// supabase/migrations` -> 0 files; `grep -rln "application_trusted_names"
// supabase/migrations` -> 0 files; canary `grep -rln "interview_prep_packs"
// supabase/migrations` -> 1 file, confirming the search root/tool are live
// and this absence is real, not a dead grep.
//
// PRECEDENT FOR THIS DISCIPLINE (three found, per this seat's brief):
// lib/interviewPrep/interviewPrepMigrationShape.test.js ("The migration file
// DOES NOT EXIST YET... Every test below is RED because that file... does
// not exist"), lib/applications/statusMigrationShape.test.js (a CHECK
// constraint on an existing table), lib/supabase/
// applicationDigestsMigrationShape.test.js (a whole ALTER TABLE shape). This
// file follows interviewPrepMigrationShape.test.js's own convention most
// closely: it names its limitation ("a source-text parse, not a live-database
// query... CANNOT prove any CHECK/GRANT/RLS policy actually enforces at
// runtime") in the same words, because it is exactly the same limitation.
//
// THE STRUCTURAL PROPERTY UNDER TEST FOR "IMPOSSIBLE, NOT MERELY ABSENT"
// (this seat's brief, item 4): a single-column PRIMARY KEY on `user_id`
// means Postgres itself rejects a second row for the same account at INSERT
// time -- this is a source-text proof that the SCHEMA enforces it, the
// strongest claim available without a live database (which this checkout
// does not have -- [[schema-migration-drift]]).

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

/** Paren-balanced extraction of `create table if not exists public.<name>
 *  ( ... )`, tolerant of the "if not exists" being present or absent (this
 *  repo's own two precedents, interview_prep.sql and tailor_library.sql,
 *  both use "if not exists"; neither form is specified as binding). */
function createTableBlock(stripped, tableName) {
  const anchors = [`create table if not exists public.${tableName}`, `create table public.${tableName}`];
  let anchorIdx = -1;
  for (const a of anchors) {
    anchorIdx = stripped.indexOf(a);
    if (anchorIdx !== -1) break;
  }
  if (anchorIdx === -1) return null;
  const openIdx = stripped.indexOf("(", anchorIdx);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < stripped.length; i += 1) {
    if (stripped[i] === "(") depth += 1;
    else if (stripped[i] === ")") {
      depth -= 1;
      if (depth === 0) return stripped.slice(anchorIdx, i + 1);
    }
  }
  return null;
}

function grantsFor(text, tableName, role) {
  const re = /grant\s+([^;]+?)\s+on table\s+([\w.]+)\s+to\s+(\w+)\s*;/gi;
  const hits = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[2] === `public.${tableName}` && m[3] === role) hits.push(m[1].trim());
  }
  return hits;
}

function policiesFor(text, tableName) {
  const re = new RegExp(`create policy "([^"]+)"\\s+on public\\.${tableName}\\s+for\\s+(select|insert|update|delete)\\s+([^;]+);`, "gi");
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push({ name: m[1], cmd: m[2].toLowerCase(), clause: m[3] });
  return hits;
}

let allMigrationsText = "";
let strippedAll = "";
let migrationFiles = [];

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  allMigrationsText = migrationFiles
    .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n-- ===== next migration file ===== --\n");
  strippedAll = stripSqlComments(allMigrationsText);
});

describe("[control] the search root and extractor are live -- a canary before trusting any absence", () => {
  it("finds a real, already-shipped migration directory with more than one file", () => {
    expect(migrationFiles.length).toBeGreaterThan(5);
  });

  it("[canary] the extractor finds interview_prep_packs' own, already-shipped CREATE TABLE block", () => {
    const block = createTableBlock(strippedAll, "interview_prep_packs");
    expect(block, "the extractor could not find a REAL table it is known to contain").not.toBeNull();
    expect(block).toContain("application_id");
  });

  it("[canary] a nonexistent table name is not found -- absence is real, not a broken anchor", () => {
    expect(createTableBlock(strippedAll, "zz_no_such_table_zz")).toBeNull();
  });
});

describe("RED on HEAD -- neither new table exists yet anywhere in supabase/migrations", () => {
  it("candidate_identity has no CREATE TABLE anywhere in this checkout's migrations", () => {
    expect(createTableBlock(strippedAll, "candidate_identity")).toBeNull();
  });

  it("application_trusted_names has no CREATE TABLE anywhere in this checkout's migrations", () => {
    expect(createTableBlock(strippedAll, "application_trusted_names")).toBeNull();
  });
});

describe("candidate_identity -- once per account, structurally IMPOSSIBLE to duplicate (RD-N33.1)", () => {
  const block = () => createTableBlock(strippedAll, "candidate_identity");

  it("the primary key is user_id ALONE -- a single-column PK, the property that makes a second row for the same account an INSERT-time rejection, not merely a convention", () => {
    const b = block();
    expect(b, "candidate_identity does not exist yet").not.toBeNull();
    expect(b).toMatch(/user_id\s+uuid\s+primary\s+key\s+references\s+auth\.users/i);
  });

  it("[the negative this property rules out] the block does NOT declare a composite or multi-column primary key that would allow two rows per account", () => {
    const b = block();
    expect(b).not.toBeNull();
    expect(b).not.toMatch(/primary\s+key\s*\([^)]*,[^)]*\)/i);
  });

  it("references auth.users with ON DELETE CASCADE -- matches tailor_profile's own already-shipped precedent", () => {
    const b = block();
    expect(b).not.toBeNull();
    expect(b).toMatch(/references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i);
  });

  it("RLS is enabled on this table", () => {
    expect(strippedAll).toMatch(/alter\s+table\s+public\.candidate_identity\s+enable\s+row\s+level\s+security/i);
  });

  it("all four commands (select/insert/update/delete) have a policy scoped to auth.uid() = user_id", () => {
    const policies = policiesFor(strippedAll, "candidate_identity");
    const cmds = policies.map((p) => p.cmd);
    for (const cmd of ["select", "insert", "update", "delete"]) {
      expect(cmds, `no ${cmd} policy found on candidate_identity`).toContain(cmd);
    }
    for (const p of policies) {
      expect(p.clause, `${p.name} (${p.cmd}) does not scope to auth.uid() = user_id`).toMatch(/auth\.uid\(\)\s*=\s*user_id/);
    }
  });

  it("authenticated is granted select/insert/update/delete; service_role is granted all; anon is granted NOTHING", () => {
    const authGrants = grantsFor(strippedAll, "candidate_identity", "authenticated");
    expect(authGrants.length).toBeGreaterThan(0);
    const flat = authGrants.join(",").toLowerCase();
    for (const verb of ["select", "insert", "update", "delete"]) expect(flat).toContain(verb);
    expect(grantsFor(strippedAll, "candidate_identity", "service_role")).toEqual(["all"]);
    expect(grantsFor(strippedAll, "candidate_identity", "anon")).toEqual([]);
  });
});

describe("application_trusted_names -- keyed by application_id, one row per application (RD-N33.2)", () => {
  const block = () => createTableBlock(strippedAll, "application_trusted_names");

  it("the primary key is application_id, with a real FK to applications", () => {
    const b = block();
    expect(b, "application_trusted_names does not exist yet").not.toBeNull();
    expect(b).toMatch(/application_id\s+uuid\s+primary\s+key\s+references\s+public\.applications\s*\(\s*id\s*\)/i);
  });

  it("carries a NOT NULL user_id referencing auth.users -- the column N37's ownership defense-in-depth and this exemption's own trust anchor both depend on existing", () => {
    const b = block();
    expect(b).not.toBeNull();
    expect(b).toMatch(/user_id\s+uuid\s+not\s+null\s+references\s+auth\.users/i);
  });

  it("does NOT carry a candidate_name column -- design-reconciled.r2.md ss1's own correction of design-structure.r1.md's original ss1.1 proposal", () => {
    const b = block();
    expect(b).not.toBeNull();
    expect(b).not.toMatch(/\bcandidate_name\b/);
  });

  it("interviewer_names is a text[] with a NOT NULL default of an empty array", () => {
    const b = block();
    expect(b).not.toBeNull();
    expect(b).toMatch(/interviewer_names\s+text\[\]\s+not\s+null\s+default\s+'\{\}'/i);
  });

  it("has an index on user_id (the tracking-list read pattern this table's own precedent, interview_prep_packs, does not need but this one's per-account lookups do)", () => {
    expect(strippedAll).toMatch(/create\s+index\s+if\s+not\s+exists\s+application_trusted_names_user_idx\s+on\s+public\.application_trusted_names\s*\(\s*user_id\s*\)/i);
  });

  it("RLS is enabled on this table", () => {
    expect(strippedAll).toMatch(/alter\s+table\s+public\.application_trusted_names\s+enable\s+row\s+level\s+security/i);
  });

  it("all four commands have a policy scoped to auth.uid() = user_id", () => {
    const policies = policiesFor(strippedAll, "application_trusted_names");
    const cmds = policies.map((p) => p.cmd);
    for (const cmd of ["select", "insert", "update", "delete"]) {
      expect(cmds, `no ${cmd} policy found on application_trusted_names`).toContain(cmd);
    }
    for (const p of policies) {
      expect(p.clause, `${p.name} (${p.cmd}) does not scope to auth.uid() = user_id`).toMatch(/auth\.uid\(\)\s*=\s*user_id/);
    }
  });

  it("authenticated is granted select/insert/update/delete; service_role is granted all; anon is granted NOTHING", () => {
    const authGrants = grantsFor(strippedAll, "application_trusted_names", "authenticated");
    expect(authGrants.length).toBeGreaterThan(0);
    const flat = authGrants.join(",").toLowerCase();
    for (const verb of ["select", "insert", "update", "delete"]) expect(flat).toContain(verb);
    expect(grantsFor(strippedAll, "application_trusted_names", "service_role")).toEqual(["all"]);
    expect(grantsFor(strippedAll, "application_trusted_names", "anon")).toEqual([]);
  });
});

describe("[positive control on the GRANT/POLICY extractors] proven against interview_prep_packs' own already-shipped text, so a clean result above is not a dead regex", () => {
  it("grantsFor finds interview_prep_packs' real authenticated grant -- NOTE: tailor_profile's own grant (RD-N33.1's PK-on-user_id precedent) is issued through a PL/pgSQL loop (`execute format('grant ... to authenticated', t)`, tailor_library.sql:103-121, confirmed this round), not a literal statement, so it is a real table to CITE for the PK shape but not a usable canary for THIS regex; interview_prep_packs uses the literal, non-looped grant style design-reconciled.r2.md ss3.1/ss3.2 specify for the new tables, so it is the correct canary here", () => {
    const hits = grantsFor(strippedAll, "interview_prep_packs", "authenticated");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("policiesFor finds interview_prep_packs' real select policy, scoped to auth.uid() = user_id", () => {
    const policies = policiesFor(strippedAll, "interview_prep_packs");
    const select = policies.find((p) => p.cmd === "select");
    expect(select, "no select policy found on the known-good interview_prep_packs table").toBeDefined();
    expect(select.clause).toMatch(/auth\.uid\(\)\s*=\s*user_id/);
  });

  it("[canary] a nonexistent table/role pair yields no grants -- absence is real, not a broken anchor", () => {
    expect(grantsFor(strippedAll, "candidate_identity", "zz_no_such_role_zz")).toEqual([]);
  });
});
