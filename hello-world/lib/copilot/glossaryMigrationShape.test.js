// R-338, R-340 / AC-S1, AC-S2, AC-S6 -- the DDL shape of
// 20260908010000_position_glossaries.sql.
//
// A source-text parse, not a live-database query. No Supabase project is
// reachable from this checkout, so this file can only prove the repo's OWN
// declaration is internally consistent; it CANNOT prove the migration was
// applied. Precedent: applicationDigestsMigrationShape.test.js,
// experienceKnowledgeMigrationShape.test.js, positionsPolicyMigrationShape.test.js.
//
// THE PROPERTY THAT MATTERS MOST HERE IS AN ABSENCE, and an absence is exactly
// what a shape test gets wrong by passing vacuously. `position_glossaries` has
// NO user_id -- it is keyed on `position_id`, and `public.positions` is a shared
// catalogue with no owner column -- so no row-ownership predicate can be written
// over it and none should be attempted. The denial of user writes IS THE ABSENCE
// OF ANY INSERT/UPDATE/DELETE POLICY, mirroring the positions hardening that
// shipped the same day; a `with check` would be strictly weaker, because it
// constrains the CALLER's role and says nothing about the ROW's content. So
// every absence assertion below is paired with a positive control proving the
// checker finds the real thing where it exists.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "../sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const NAME = "20260908010000_position_glossaries.sql";
const HARDENING = "20260908000000_positions_policy_hardening.sql";
// A sibling that legitimately declares several policies, so "exactly one policy"
// on the file under test cannot be an artifact of a broken counter.
const MULTI_POLICY_CONTROL = "20260812000000_experience_pages.sql";

let sql = "";
let raw = "";
let hardening = "";
let control = "";

beforeAll(() => {
  raw = readFileSync(path.join(MIGRATIONS, NAME), "utf8");
  sql = stripSqlComments(raw).toLowerCase();
  hardening = stripSqlComments(readFileSync(path.join(MIGRATIONS, HARDENING), "utf8")).toLowerCase();
  control = stripSqlComments(readFileSync(path.join(MIGRATIONS, MULTI_POLICY_CONTROL), "utf8")).toLowerCase();
});

const count = (haystack, re) => (haystack.match(new RegExp(re.source, `${re.flags}g`)) || []).length;

describe("the table", () => {
  it("keys on position_id, cascading from positions", () => {
    expect(sql).toMatch(/create table if not exists public\.position_glossaries/);
    expect(sql).toMatch(/position_id\s+uuid\s+primary key\s+references\s+public\.positions\s*\(\s*id\s*\)\s+on delete cascade/);
  });

  it("has NO user_id column, and the checker can see one when it exists", () => {
    expect(sql).not.toMatch(/^\s*user_id\s/m);
    expect(control).toMatch(/user_id/); // positive control
  });

  it("declares `status` with NO default", () => {
    // application_digests defaults its status to 'ready' and that is safe there
    // because no invariant rides on the value. Here 'ready' carries a CHECK, and
    // a default would let an insert that omitted the column produce a 'ready'
    // row over zero terms that satisfies every constraint.
    expect(sql).toMatch(/\n\s*status\s+text not null,/);
    expect(sql).not.toMatch(/status\s+text not null default/);
    // Positive control: the file DOES use `default` for other columns.
    expect(sql).toMatch(/terms\s+jsonb not null default '\[\]'::jsonb/);
  });

  it("declares the scheduling, spend and observability columns", () => {
    for (const column of [
      "research_cursor",
      "research_total",
      "lease_until",
      "queued_at",
      "last_generation_at",
      "model_calls_fingerprint",
      "model_calls_total",
      "research_batches",
      "unsearched_batches",
      "malformed_batches",
      "stage_counts",
      "refusal_reasons",
      "usage_totals",
      "posting_fingerprint",
    ]) {
      expect({ column, present: new RegExp(`\\n\\s*${column}\\s`).test(sql) }).toEqual({
        column,
        present: true,
      });
    }
  });

  it("declares research_pending as a STORED generated column", () => {
    // PostgREST cannot compare two columns in a filter, so
    // `research_cursor < research_total` is not expressible as a query
    // predicate. The worker's queue read needs it as a column, and a generated
    // one cannot drift from the pair it is derived from.
    expect(sql).toMatch(
      /research_pending\s+boolean\s+generated always as \(\s*research_cursor\s*<\s*research_total\s*\) stored/,
    );
  });
});

describe("the CHECK constraints", () => {
  it("restricts status to the five values", () => {
    expect(sql).toMatch(
      /check \(status in \('ready', 'partial', 'quotes-only', 'unavailable', 'failed'\)\)/,
    );
  });

  it("restricts truncated_reason to the three, nullable", () => {
    expect(sql).toMatch(/truncated_reason is null or truncated_reason in \('model', 'ceiling', 'bytes'\)/);
  });

  it("constrains 'ready' over the terms ARRAY, not only over a counter", () => {
    // A `recalled_count = 0` check ALONE is defeated by exactly the bug it
    // names: a JS miscount writes status:'ready' AND recalled_count:0 together,
    // from the same array, and the constraint passes while `terms` still
    // contains recalled entries. `jsonb @>` is IMMUTABLE and therefore legal in
    // a CHECK. Falsifiable at apply time: if that is wrong, `supabase db push`
    // raises "functions in check constraint must be marked IMMUTABLE".
    const ready = sql.match(/constraint position_glossaries_ready_is_fully_researched\s+check \([\s\S]*?\)\)\),/);
    expect(ready).not.toBeNull();
    const body = ready[0];
    expect(body).toContain("recalled_count = 0");
    expect(body).toContain("research_cursor >= research_total");
    expect(body).toContain(`not (terms @> '[{"provenance": "recalled"}]'::jsonb)`);
  });

  it("caps both call counters and orders them", () => {
    expect(sql).toMatch(/check \(model_calls_fingerprint <= 42\)/);
    expect(sql).toMatch(/check \(model_calls_total <= 126\)/);
    expect(sql).toMatch(/check \(model_calls_fingerprint <= model_calls_total\)/);
  });

  it("bounds the cursor, and bounds research_total by the derived batch count", () => {
    expect(sql).toMatch(/research_cursor >= 0/);
    expect(sql).toMatch(/research_cursor <= research_total/);
    expect(sql).toMatch(/research_total <= 10/);
  });

  it("caps the term array at 120 using CASE so a non-array raises a violation, not a type error", () => {
    // PostgreSQL does not guarantee left-to-right evaluation of `and` inside a
    // CHECK, so `jsonb_typeof(terms) = 'array' and jsonb_array_length(terms) <= 120`
    // could reach jsonb_array_length on a non-array. `case` DOES guarantee it.
    expect(sql).toMatch(/case when jsonb_typeof\(terms\) = 'array'/);
    expect(sql).toMatch(/then jsonb_array_length\(terms\) <= 120/);
    expect(sql).toMatch(/else false/);
  });

  it("does NOT put a non-immutable function in a CHECK", () => {
    // pg_column_size is not IMMUTABLE and a CHECK containing one is a
    // dump/restore hazard. The byte bound lives in JS, where it can also report
    // WHICH term overflowed.
    expect(sql).not.toContain("pg_column_size");
  });
});

describe("the index", () => {
  it("indexes the worker's queue read on queued_at, partial on research_pending", () => {
    expect(sql).toMatch(
      /create index if not exists position_glossaries_worker_queue_idx[\s\S]*?on public\.position_glossaries \(queued_at\)[\s\S]*?where research_pending/,
    );
  });
});

describe("RLS: SELECT for authenticated only, and NO write policy at all (AC-S1, AC-S2)", () => {
  it("enables row level security", () => {
    expect(sql).toMatch(/alter table public\.position_glossaries enable row level security/);
  });

  it("declares EXACTLY ONE policy, and it is a SELECT policy for `authenticated`", () => {
    expect(count(sql, /create policy/)).toBe(1);
    expect(sql).toMatch(
      /create policy "position_glossaries_select_authenticated" on public\.position_glossaries\s+for select to authenticated using \(true\)/,
    );
    // Positive control: the counter finds several in a file that has several.
    expect(count(control, /create policy/)).toBeGreaterThan(1);
  });

  it("declares ZERO insert, update, delete or all policies -- the denial IS the absence", () => {
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}?for insert/);
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}?for update/);
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}?for delete/);
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}?for all/);
    // Positive control: the matcher DOES find a write policy where one exists.
    expect(control).toMatch(/create policy[\s\S]{0,200}?for insert/);
  });

  it("never writes a WITH CHECK, because a WITH CHECK cannot work on a table with no owner column", () => {
    expect(sql).not.toContain("with check");
  });

  it("declares no service_role policy -- service_role bypasses RLS, so one would never be consulted", () => {
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}?to service_role/);
  });
});

describe("the privilege layer says what the policy layer says", () => {
  it("revokes everything from anon and from authenticated first", () => {
    expect(sql).toMatch(/revoke all on table public\.position_glossaries from anon/);
    expect(sql).toMatch(/revoke all on table public\.position_glossaries from authenticated/);
  });

  it("grants select to authenticated and all to service_role, and grants nothing to anon", () => {
    expect(sql).toMatch(/grant select on table public\.position_glossaries to authenticated/);
    expect(sql).toMatch(/grant all\s+on table public\.position_glossaries to service_role/);
    expect(sql).not.toMatch(/grant [a-z, ]*on table public\.position_glossaries to anon/);
  });

  it("grants authenticated no write privilege", () => {
    expect(sql).not.toMatch(/grant [a-z, ]*insert[a-z, ]*on table public\.position_glossaries to authenticated/);
    expect(sql).not.toMatch(/grant [a-z, ]*update[a-z, ]*on table public\.position_glossaries to authenticated/);
    expect(sql).not.toMatch(/grant all\s+on table public\.position_glossaries to authenticated/);
  });
});

describe("R-340 / AC-S6: the positions-hardening precondition is still in force", () => {
  it("finds the hardening migration on disk, still revoking user writes on positions", () => {
    // This does NOT prove the migration was applied. Nothing in this repository
    // can prove that. It fails loudly if the migration is ever reverted or
    // weakened, which is the half that IS checkable here.
    expect(hardening).toContain(
      "revoke insert, update, delete on table public.positions from authenticated",
    );
  });

  it("finds no UPDATE or ALL policy on positions", () => {
    expect(hardening).not.toMatch(/create policy[\s\S]{0,200}?for update/);
    expect(hardening).not.toMatch(/create policy[\s\S]{0,200}?for all/);
  });
});

describe("the file documents itself", () => {
  it("records in a table comment that writes are service-role only", () => {
    expect(raw.toLowerCase()).toMatch(/comment on table public\.position_glossaries/);
    expect(raw.toLowerCase()).toContain("service-role");
  });
});
