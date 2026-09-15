// The IP3 migration's DDL shape -- a source-text parse, not a live-database
// query. No live Supabase project is reachable from this checkout
// ([[schema-migration-drift]], [[windows-shell-environment]]), so this file
// can only prove the repo's OWN declared SQL is internally consistent; it
// CANNOT prove any CHECK, GRANT or RLS policy actually enforces at runtime,
// and it cannot prove claim_prep_pack_slot's body behaves as specified
// against real Postgres. Every describe block below says this again at the
// point it matters, per this seat's brief: "name its limitation in the test
// itself, so a later reader does not mistake it for a runtime assertion."
//
// The migration file DOES NOT EXIST YET (plan.r1.md §1: a new file,
// `<TIMESTAMP>_interview_prep.sql`, timestamp chosen at implementation time).
// Every test below is RED because that file, and lib/interviewPrep/
// prepContract.js's PREP_REASON_VALUES export, do not exist in this
// checkout -- not because a fixture is malformed.
//
// SPLIT UNDER BACKLOG N12 -- THIS FILE IS NOW EXPLICITLY HISTORICAL. A
// follow-up migration (20260915000000_interview_prep_spend_lockdown.sql)
// converts claim_prep_pack_slot to SECURITY DEFINER and narrows
// interview_prep_spend's grants further, which would otherwise leave this
// file's own spend-grant and SECURITY INVOKER assertions green while
// asserting the exact opposite of the shipped schema. Every property below
// that a LATER migration can change now lives instead in
// lib/interviewPrep/interviewPrepEffectiveSchema.test.js, which replays
// every migration file in order rather than reading this one file's text.
// This file keeps its original job -- pinning what
// 20260914000000_interview_prep.sql itself, byte for byte, still says --
// and each block a later migration supersedes is retitled below to say so.
//
// FIRST OBLIGATION OF THIS SEAT (rulings.md R-IP3-61): 1-0-contract.r8.md's
// own Functions table still shows claim_prep_pack_slot's stale, pre-fix
// 4-parameter signature. The 3-parameter form -- (p_application_id uuid,
// p_lease_token uuid, p_lease_until timestamptz), NO p_user_id -- is
// AUTHORITATIVE. The GRANT test below asserts the 3-parameter form and
// explicitly refuses the stale 4-parameter form.
//
// PRECEDENT FOR PARSING MIGRATION SQL IN A TEST:
// lib/applications/statusMigrationShape.test.js (a CHECK constraint),
// lib/supabase/applicationDigestsMigrationShape.test.js (a whole ALTER TABLE
// shape). Both disciplines are followed here: every absence assertion is
// paired with a positive control, and every parse is anchored on a real
// statement, never a bare identifier that also appears in prose.
//
// WHY THE EXTRACTOR ANCHORS ON "constraint <name>", NOT "add constraint
// <name>". supabase/migrations/20260908010000_position_glossaries.sql --
// the CASE-guarded precedent design-structure.r1.md §4.1 cites for
// ready_is_complete's own shape -- declares every one of its CHECKs INLINE,
// inside `create table (...)`, as `constraint <name> check (...)`, never as
// a separate `alter table ... add constraint` statement (that shape is for
// retrofitting an EXISTING table, e.g. applications_status_check). IP3's
// migration creates three BRAND NEW tables, so the inline shape is the one
// the real file will very likely use. Anchoring on the bare "constraint
// <name>" substring matches BOTH the inline and the ALTER-style spelling,
// so this file does not assume one over the other.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";
import { PREP_REASON_VALUES } from "@/lib/interviewPrep/prepContract.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

// The independently-authored, ALREADY-SHIPPED migration this file's own
// extractor is canaried against, so a clean result against the not-yet-built
// IP3 migration cannot be mistaken for a broken parser that finds nothing
// anywhere.
const CANARY_MIGRATION = "20260908010000_position_glossaries.sql";
const CANARY_CONSTRAINT = "position_glossaries_status_check";
const CANARY_VALUES = ["ready", "partial", "quotes-only", "unavailable", "failed"];

/** Paren-balanced extraction of `constraint <name> check ( ... )`, whichever
 *  of the two real spellings this repo uses. Returns null if the anchor, the
 *  "check" keyword after it, or a balanced closing paren is not found -- so
 *  "not found" is distinguishable from "found an empty clause". */
function constraintClause(stripped, name) {
  const anchorIdx = stripped.indexOf(`constraint ${name}`);
  if (anchorIdx === -1) return null;
  const checkIdx = stripped.indexOf("check", anchorIdx);
  if (checkIdx === -1) return null;
  const openIdx = stripped.indexOf("(", checkIdx);
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

function quotedValues(text) {
  const values = [];
  const re = /'([^']*)'/g;
  let m;
  while ((m = re.exec(text))) values.push(m[1]);
  return values;
}

/** Every `interview_prep_*`/`interview_stages` table identifier a
 *  plpgsql function body references via FROM / INSERT INTO / UPDATE. This is
 *  the K2-RPC instrument (design-operate.r1.md §3b): the ONLY way to see
 *  inside an RPC body without a live Postgres connection -- test/helpers/
 *  supabaseMock.js's `rpc` spy records `[fn, args]` with NO table identifier
 *  anywhere (verified directly by this chunk's reuse survey and design
 *  seats), so a runtime spy is structurally blind to what this function
 *  actually touches. THIS TEST NEVER PROVES THE FUNCTION ENFORCES ANYTHING
 *  AT RUNTIME -- it proves only that the DECLARED SQL text does not
 *  reference a forbidden table. */
function referencedTables(body) {
  const tables = new Set();
  const patterns = [
    /\bfrom\s+(interview_prep_\w+|interview_stages)\b/gi,
    /\binsert\s+into\s+(interview_prep_\w+|interview_stages)\b/gi,
    /\bupdate\s+(interview_prep_\w+|interview_stages)\b/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(body))) tables.add(m[1].toLowerCase());
  }
  return tables;
}

/** The plpgsql body of `claim_prep_pack_slot`, extracted between its `$$`
 *  delimiters -- a regex over fixed SQL text, per design-operate.r1.md §3b's
 *  own construction ("the body is fixed SQL, not dynamically constructed
 *  text"). Matches an OPTIONAL schema qualifier before the function name
 *  (`function public.foo(` as well as bare `function foo(`) -- this repo's
 *  own existing convention is schema-qualified
 *  (`supabase/migrations/20260612000000_feed_postings_retention.sql:14`:
 *  "create or replace function public.prune_feed_postings(..."), and the
 *  SAME file's GRANT test a few lines below already requires the `public.`
 *  qualifier on this very function -- a bare, unqualified search here could
 *  never match a migration written to match that precedent. */
function functionBody(stripped, name) {
  const match = new RegExp(`function\\s+(?:\\w+\\.)?${name}\\s*\\(`).exec(stripped);
  if (!match) return null;
  const open = stripped.indexOf("$$", match.index);
  if (open === -1) return null;
  const close = stripped.indexOf("$$", open + 2);
  if (close === -1) return null;
  return stripped.slice(open + 2, close);
}

// HISTORICAL, read unconditionally: this file's identity is now a pinned
// fact, not something a differently-shaped future migration could leave
// this suite guessing about. `20260915000000_interview_prep_spend_lockdown.sql`
// (backlog N12) deliberately does NOT match `/_interview_prep\.sql$/` --
// see that file's own header -- specifically so the glob below keeps
// matching exactly this one file rather than two.
const ORIGINAL_MIGRATION = "20260914000000_interview_prep.sql";

let migrationFiles = null;
let raw = null;
let stripped = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => /_interview_prep\.sql$/.test(f));
  raw = readFileSync(path.join(MIGRATIONS_DIR, ORIGINAL_MIGRATION), "utf8");
  stripped = stripSqlComments(raw);
});

describe("[control] the extractor works against a REAL, independently-authored migration", () => {
  it("finds position_glossaries_status_check's real 5-value list in the already-shipped precedent", () => {
    const canaryRaw = readFileSync(path.join(MIGRATIONS_DIR, CANARY_MIGRATION), "utf8");
    const canaryStripped = stripSqlComments(canaryRaw);
    const clause = constraintClause(canaryStripped, CANARY_CONSTRAINT);
    expect(clause, "the extractor could not find a REAL constraint it is known to contain").not.toBeNull();
    expect(quotedValues(clause).sort()).toEqual([...CANARY_VALUES].sort());
  });

  it("[canary] a nonexistent constraint name is not found -- absence is real, not a broken anchor", () => {
    const canaryRaw = readFileSync(path.join(MIGRATIONS_DIR, CANARY_MIGRATION), "utf8");
    expect(constraintClause(stripSqlComments(canaryRaw), "nonexistent_constraint_xyz")).toBeNull();
  });
});

describe("[control] referencedTables — the K2-RPC extractor, canaried on a planted mutant", () => {
  it("[mutant this kills] a body that adds a reference to interview_stages is detected", () => {
    const mutantBody = `
      select attempts into v_a from interview_prep_spend where application_id = p_application_id for update;
      perform 1 from interview_stages where application_id = p_application_id;
      insert into interview_prep_packs (application_id) values (p_application_id);
    `;
    const found = referencedTables(mutantBody);
    expect(found.has("interview_stages")).toBe(true);
  });

  it("[no-op control on the extractor itself] a body naming only the two allowed tables reports exactly those two", () => {
    const cleanBody = `
      select attempts into v_a from interview_prep_spend where application_id = p_application_id for update;
      insert into interview_prep_packs (application_id) values (p_application_id) on conflict (application_id) do update set status='running';
      insert into interview_prep_spend (application_id) values (p_application_id) on conflict (application_id) do update set attempts = interview_prep_spend.attempts + 1;
    `;
    expect([...referencedTables(cleanBody)].sort()).toEqual(["interview_prep_packs", "interview_prep_spend"]);
  });

  it("does not mistake a plpgsql variable target (`select ... into v_x`) for a table reference", () => {
    const body = "select attempts, model_calls into v_attempts, v_model_calls from interview_prep_spend where application_id = p_application_id;";
    // `into v_attempts` must never register as a table -- only `insert into`
    // does. A regex that matched bare `into` would falsely report a
    // "v_attempts" table.
    expect(referencedTables(body).has("v_attempts")).toBe(false);
    expect(referencedTables(body).has("interview_prep_spend")).toBe(true);
  });
});

describe("[control] functionBody — the K2-RPC extractor's OWN independent verification, canaried on a REAL, already-shipped, SCHEMA-QUALIFIED function", () => {
  // check-4b.r1.md's BLOCKER: this file's K2-RPC block had a single test and
  // NO canary anywhere proving functionBody() can find a real function
  // definition at all -- the [control] blocks above canary
  // constraintClause()/referencedTables() only. A naive, unqualified
  // `indexOf("function claim_prep_pack_slot(")` cannot match a migration
  // written `create or replace function public.claim_prep_pack_slot(...)`,
  // which is this repo's OWN existing, already-shipped convention (below),
  // not a hypothetical.
  const RETENTION_MIGRATION = "20260612000000_feed_postings_retention.sql";
  const RETENTION_FUNCTION = "prune_feed_postings";

  it("finds prune_feed_postings's real, schema-qualified ($$ create or replace function public.prune_feed_postings(...) $$) body in the already-shipped precedent", () => {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, RETENTION_MIGRATION), "utf8");
    const stripped2 = stripSqlComments(raw);
    // Independently confirm the precedent really is schema-qualified, so
    // this canary cannot be satisfied by an extractor that only handles the
    // bare, unqualified spelling.
    expect(stripped2).toContain(`function public.${RETENTION_FUNCTION}(`);
    expect(stripped2).not.toMatch(new RegExp(`function\\s+${RETENTION_FUNCTION}\\s*\\(`));
    const body = functionBody(stripped2, RETENTION_FUNCTION);
    expect(body, "the extractor could not find a REAL, schema-qualified function it is known to contain").not.toBeNull();
    expect(body).toContain("delete from public.feed_postings");
  });

  it("[canary] a nonexistent function name is not found -- absence is real, not a broken anchor", () => {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, RETENTION_MIGRATION), "utf8");
    expect(functionBody(stripSqlComments(raw), "nonexistent_function_xyz")).toBeNull();
  });

  it("also matches the BARE, unqualified spelling -- the fix is additive, not a replacement of one convention with another", () => {
    const body = functionBody("create function claim_prep_pack_slot(a uuid) returns boolean as $$ select true; $$ language sql;", "claim_prep_pack_slot");
    expect(body).not.toBeNull();
    expect(body).toContain("select true");
  });
});

describe("the migration file itself", () => {
  it("[control] the glob still resolves to exactly the historical file, by name -- a future migration whose name happens to satisfy /_interview_prep\\.sql$/ fails loudly here instead of this suite silently reading the wrong file", () => {
    expect(migrationFiles).toEqual([ORIGINAL_MIGRATION]);
  });

  describe("R-IP3-61's first obligation -- the GRANT targets the AUTHORITATIVE 3-parameter signature", () => {
    it('contains exactly "grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to authenticated;"', () => {
      expect(stripped).toContain(
        "grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to authenticated",
      );
    });

    it("[mutant this kills] the STALE, superseded 4-parameter signature does not appear anywhere", () => {
      expect(stripped).not.toMatch(/claim_prep_pack_slot\(\s*uuid\s*,\s*uuid\s*,\s*uuid\s*,\s*timestamptz\s*\)/);
    });
  });

  describe("K2-RPC -- claim_prep_pack_slot's declared body references only the allowed tables", () => {
    it("[no-op control] the extracted table set is a non-empty subset of {interview_prep_packs, interview_prep_spend}, zero interview_stages", () => {
      const body = functionBody(stripped, "claim_prep_pack_slot");
      expect(body, "claim_prep_pack_slot's $$ ... $$ body was not found").not.toBeNull();
      const tables = referencedTables(body);
      expect(tables.size).toBeGreaterThan(0);
      for (const t of tables) expect(["interview_prep_packs", "interview_prep_spend"]).toContain(t);
      expect(tables.has("interview_stages")).toBe(false);
    });
  });

  describe("the 14 CHECK constraints (contract §18 / plan.r1.md §8.6) -- specified here, execution deferred", () => {
    // interview_prep_packs_pack_size_check (a 15th, byte-size CHECK over
    // `pg_column_size(pack)`) is deliberately NOT one of these 14 -- see the
    // migration's own "NOT ADDED, deliberately" note beside
    // interview_prep_packs_claims_is_array. pg_column_size is not IMMUTABLE,
    // and a CHECK containing a non-immutable function is a dump/restore
    // hazard; the repo's own sibling precedent
    // (position_glossaries_terms_shape's neighbour in
    // 20260908010000_position_glossaries.sql) already rejected that exact
    // pattern for the same reason. The bound is enforced instead by
    // lib/interviewPrep/prepStore.js's checkPackByteBudget, covered by
    // prepStore.test.js, not by this source-text file.
    // NO LIVE POSTGRES EXISTS IN THIS CHECKOUT. Every assertion in this
    // block proves the migration's DECLARED constraint text matches what
    // the binding design documents specify; NONE of them proves Postgres
    // actually rejects a violating write. That execution is out of reach
    // here and is named, not smoothed over, in this seat's own artifact.

    it("interview_prep_packs_status_check -- exactly the 5 status values", () => {
      const clause = constraintClause(stripped, "interview_prep_packs_status_check");
      expect(clause).not.toBeNull();
      expect(quotedValues(clause).sort()).toEqual(["running", "ready", "partial", "failed", "unavailable"].sort());
    });

    // Constraints 2-6: the design documents name these constraints and what
    // they guard in PROSE, but none gives a pinned, literal CHECK expression
    // this test could assert byte-for-byte without inventing one. Per this
    // seat's brief ("including the ones that can only be *specified* here"),
    // these five assert NAME EXISTENCE only -- the maximum honestly
    // achievable from the source material without asserting a body no
    // binding document actually commits to.
    it.each([
      "interview_prep_packs_running_has_no_content",
      "interview_prep_packs_ready_is_complete",
      "interview_prep_packs_researched_at_terminal",
      "interview_prep_packs_truncated_reason_check",
      "interview_prep_packs_claims_is_array",
    ])("%s exists as a named CHECK constraint (body unspecified by any binding document)", (name) => {
      expect(constraintClause(stripped, name), `${name} not found`).not.toBeNull();
    });

    it("interview_prep_packs_claims_is_array -- loosely requires jsonb_typeof and 'array' together (the one partial shape the design names)", () => {
      const clause = constraintClause(stripped, "interview_prep_packs_claims_is_array");
      expect(clause).not.toBeNull();
      expect(clause).toMatch(/jsonb_typeof/i);
      expect(clause).toContain("array");
    });

    it("interview_prep_packs_pack_size_check -- NOT present; the byte bound moved to application code", () => {
      expect(constraintClause(stripped, "interview_prep_packs_pack_size_check")).toBeNull();
    });

    it("interview_prep_packs_reason_check -- exactly PREP_REASON_VALUES (8 members, spend-record-failed included)", () => {
      const clause = constraintClause(stripped, "interview_prep_packs_reason_check");
      expect(clause).not.toBeNull();
      expect(PREP_REASON_VALUES).toHaveLength(8);
      expect(PREP_REASON_VALUES).toContain("spend-record-failed");
      expect(quotedValues(clause).sort()).toEqual([...PREP_REASON_VALUES].sort());
    });

    it("interview_prep_spend_attempts_check -- attempts between 0 and 6 inclusive", () => {
      const clause = constraintClause(stripped, "interview_prep_spend_attempts_check");
      expect(clause).not.toBeNull();
      expect(clause).toMatch(/attempts\s*>=\s*0/);
      expect(clause).toMatch(/attempts\s*<=\s*6/);
    });

    it("interview_prep_spend_calls_check -- model_calls >= 0 ONLY, no upper bound", () => {
      const clause = constraintClause(stripped, "interview_prep_spend_calls_check");
      expect(clause).not.toBeNull();
      expect(clause).toMatch(/model_calls\s*>=\s*0/);
      expect(clause).not.toMatch(/<=/);
    });

    it("interview_prep_events_event_type_check -- exactly 'attempt' | 'delete'", () => {
      const clause = constraintClause(stripped, "interview_prep_events_event_type_check");
      expect(clause).not.toBeNull();
      expect(quotedValues(clause).sort()).toEqual(["attempt", "delete"]);
    });

    it("interview_prep_events_trigger_class_check -- exactly 'B1' | 'B3'", () => {
      const clause = constraintClause(stripped, "interview_prep_events_trigger_class_check");
      expect(clause).not.toBeNull();
      expect(quotedValues(clause).sort()).toEqual(["B1", "B3"]);
    });

    it("interview_prep_events_engine_check -- exactly 'gemini' | 'external' | 'embedded'", () => {
      const clause = constraintClause(stripped, "interview_prep_events_engine_check");
      expect(clause).not.toBeNull();
      expect(quotedValues(clause).sort()).toEqual(["embedded", "external", "gemini"]);
    });

    it("interview_prep_events_outcome_check -- carries BOTH the 7-value attempt vocabulary and the 3-value delete vocabulary", () => {
      const clause = constraintClause(stripped, "interview_prep_events_outcome_check");
      expect(clause).not.toBeNull();
      const attemptOutcomes = ["ready", "partial", "failed", "unavailable", "check-violation", "stale-token", "error"];
      const deleteOutcomes = ["deleted", "not-found", "error"];
      for (const v of [...attemptOutcomes, ...deleteOutcomes]) expect(clause).toContain(`'${v}'`);
    });

    it("interview_prep_events_reason_check -- 'reason is null or reason in (...)' over the SAME 8-value PREP_REASON_VALUES", () => {
      const clause = constraintClause(stripped, "interview_prep_events_reason_check");
      expect(clause).not.toBeNull();
      expect(clause).toMatch(/reason\s+is\s+null/i);
      expect(quotedValues(clause).sort()).toEqual([...PREP_REASON_VALUES].sort());
    });

    it("[mutant this kills] a write of the exact confusion the reason CHECK exists to reject: reason='error' is NOT a member", () => {
      // §1.3bis / §2.5 of the contract corrects exactly this confusion --
      // 'error' belongs to interview_prep_packs.error / event outcome
      // vocabularies, never to the reason vocabulary.
      expect(PREP_REASON_VALUES).not.toContain("error");
    });
  });

  describe("interview_prep_spend's authenticated privileges as THIS FILE alone declares them (HISTORICAL -- superseded by backlog N12's 20260915000000_interview_prep_spend_lockdown.sql, which revokes the UPDATE/INSERT grants this block still finds; current effective grants are asserted in lib/interviewPrep/interviewPrepEffectiveSchema.test.js)", () => {
    // R-IP3-45's spend-bypass-by-deleting, reintroduced at the RLS/grant
    // layer because an earlier round specified the events table's policies
    // and never specified this one's. Closed by: no DELETE grant or policy
    // at all, and an UPDATE grant scoped to the two columns
    // claim_prep_pack_slot itself still writes directly (attempts,
    // updated_at) -- model_calls is deliberately excluded, since its only
    // writer is now the SECURITY DEFINER record_prep_model_call function
    // covered by the next describe block, which needs no client-facing
    // grant at all.

    function grantsFor(text, tableName, role) {
      const re = /grant\s+([^;]+?)\s+on table\s+([\w.]+)\s+to\s+(\w+)\s*;/gi;
      const hits = [];
      let m;
      while ((m = re.exec(text))) {
        if (m[2] === tableName && m[3] === role) hits.push(m[1].trim());
      }
      return hits;
    }

    it("[control] the extractor finds the already-shipped interview_prep_events grant (select, insert only, this file's own precedent for the shape spend now matches)", () => {
      expect(grantsFor(stripped, "public.interview_prep_events", "authenticated")).toEqual(["select, insert"]);
    });

    it("[canary] a nonexistent table/role pair yields no grants -- absence is real, not a broken anchor", () => {
      expect(grantsFor(stripped, "public.interview_prep_spend", "nonexistent_role_xyz")).toEqual([]);
    });

    it("[mutant this kills] no grant to authenticated on interview_prep_spend carries DELETE", () => {
      const hits = grantsFor(stripped, "public.interview_prep_spend", "authenticated");
      expect(hits.length).toBeGreaterThan(0);
      for (const clause of hits) expect(clause.toLowerCase()).not.toMatch(/\bdelete\b/);
    });

    it("[mutant this kills] no grant to authenticated on interview_prep_spend carries a BARE, unscoped UPDATE", () => {
      const hits = grantsFor(stripped, "public.interview_prep_spend", "authenticated");
      for (const clause of hits) {
        const bareUpdate = /\bupdate\b(?!\s*\()/i.test(clause);
        expect(bareUpdate, `found an unscoped UPDATE in "${clause}"`).toBe(false);
      }
    });

    it("authenticated's UPDATE grant on interview_prep_spend is scoped to exactly (attempts, updated_at) -- model_calls excluded", () => {
      const hits = grantsFor(stripped, "public.interview_prep_spend", "authenticated");
      const updateClause = hits.find((c) => /\bupdate\s*\(/i.test(c));
      expect(updateClause, "no column-scoped UPDATE grant found").toBeDefined();
      const cols = /update\s*\(([^)]*)\)/i
        .exec(updateClause)[1]
        .split(",")
        .map((c) => c.trim());
      expect(cols.sort()).toEqual(["attempts", "updated_at"].sort());
    });

    it("service_role keeps grant all on interview_prep_spend, unchanged", () => {
      expect(grantsFor(stripped, "public.interview_prep_spend", "service_role")).toEqual(["all"]);
    });

    it("[mutant this kills, HISTORICAL scope -- this file's own text only, not the effective schema] no CREATE POLICY on interview_prep_spend uses `for delete`, under any policy name", () => {
      expect(stripped).not.toMatch(/create policy "[^"]*"\s+on public\.interview_prep_spend\s+for delete/i);
    });

    it("[canary, HISTORICAL scope] the delete-policy regex is capable of matching a real create-policy statement", () => {
      const fixture =
        'create policy "interview_prep_spend_delete_own" on public.interview_prep_spend\n  for delete using (auth.uid() = user_id);';
      expect(fixture).toMatch(/create policy "[^"]*"\s+on public\.interview_prep_spend\s+for delete/i);
    });
  });

  describe("record_prep_model_call -- the SECURITY DEFINER atomic increment (closes backlog item 8's lost-update race)", () => {
    function qualifiedTables(body) {
      const tables = new Set();
      const re = /\b(?:from|insert\s+into|update)\s+public\.(\w+)\b/gi;
      let m;
      while ((m = re.exec(body))) tables.add(m[1].toLowerCase());
      return tables;
    }

    it("[control] exists as a schema-qualified CREATE OR REPLACE FUNCTION, taking exactly one parameter, no p_user_id", () => {
      const match = /create or replace function public\.record_prep_model_call\s*\(([^)]*)\)/i.exec(stripped);
      expect(match, "record_prep_model_call not found as a schema-qualified create or replace function").not.toBeNull();
      expect(match[1]).toMatch(/p_application_id/i);
      expect(match[1]).not.toMatch(/p_user_id/i);
    });

    it("[control, HISTORICAL -- true of THIS FILE's text forever, no longer true of the effective schema] the same preamble-slice technique correctly reads claim_prep_pack_slot's OWN, already-known SECURITY INVOKER declaration in 20260914000000_interview_prep.sql itself; backlog N12's 20260915000000_interview_prep_spend_lockdown.sql converts the LIVE function to SECURITY DEFINER -- that current mode is asserted in lib/interviewPrep/interviewPrepEffectiveSchema.test.js, not here", () => {
      // Proves the technique the next test relies on actually discriminates
      // -- run here against a function this file already knows is INVOKER.
      const fnIdx = stripped.indexOf("function public.claim_prep_pack_slot");
      expect(fnIdx).toBeGreaterThanOrEqual(0);
      const bodyStartIdx = stripped.indexOf("$$", fnIdx);
      const preamble = stripped.slice(fnIdx, bodyStartIdx);
      expect(preamble).toMatch(/security invoker/i);
      expect(preamble).not.toMatch(/security definer/i);
    });

    it("[mutant this kills] record_prep_model_call is SECURITY DEFINER, not INVOKER -- unlike claim_prep_pack_slot", () => {
      const fnIdx = stripped.indexOf("function public.record_prep_model_call");
      expect(fnIdx).toBeGreaterThanOrEqual(0);
      const bodyStartIdx = stripped.indexOf("$$", fnIdx);
      const preamble = stripped.slice(fnIdx, bodyStartIdx);
      expect(preamble).toMatch(/security definer/i);
      expect(preamble).not.toMatch(/security invoker/i);
    });

    it("[mutant this kills] a safe, empty search_path is set on the function -- never the caller's own default", () => {
      const fnIdx = stripped.indexOf("function public.record_prep_model_call");
      const bodyStartIdx = stripped.indexOf("$$", fnIdx);
      const preamble = stripped.slice(fnIdx, bodyStartIdx);
      expect(preamble).toMatch(/set\s+search_path\s*=\s*''/);
    });

    it("[canary] the search_path regex matches a real SET clause and misses an absent one", () => {
      expect("set search_path = ''").toMatch(/set\s+search_path\s*=\s*''/);
      expect("security definer").not.toMatch(/set\s+search_path\s*=\s*''/);
    });

    it("grant execute to authenticated exists for the one-parameter signature", () => {
      expect(stripped).toContain("grant execute on function public.record_prep_model_call(uuid) to authenticated");
    });

    it("[K2-RPC, schema-qualified variant] the declared body touches only public.interview_prep_spend and public.applications -- never interview_stages or the other two prep tables", () => {
      const body = functionBody(stripped, "record_prep_model_call");
      expect(body, "record_prep_model_call's $$ ... $$ body was not found").not.toBeNull();
      const tables = qualifiedTables(body);
      expect(tables.size).toBeGreaterThan(0);
      for (const t of tables) expect(["interview_prep_spend", "applications"]).toContain(t);
    });

    it("[mutant this kills] qualifiedTables detects a planted reference to public.interview_stages", () => {
      const mutantBody = "select 1 from public.interview_stages where application_id = p_application_id;";
      expect(qualifiedTables(mutantBody).has("interview_stages")).toBe(true);
    });

    it("[mutant this kills] the body refuses (returns false) BEFORE any write when the application is not the caller's own", () => {
      const body = functionBody(stripped, "record_prep_model_call");
      expect(body).not.toBeNull();
      const existsIdx = body.search(/not\s+exists\s*\(\s*select[^)]*public\.applications/i);
      expect(existsIdx, "no ownership existence check against public.applications found").toBeGreaterThanOrEqual(0);
      const insertIdx = body.indexOf("insert into public.interview_prep_spend");
      expect(insertIdx, "no insert into public.interview_prep_spend found").toBeGreaterThan(-1);
      expect(existsIdx).toBeLessThan(insertIdx);
      const returnFalseIdx = body.indexOf("return false", existsIdx);
      expect(returnFalseIdx).toBeGreaterThan(existsIdx);
      expect(returnFalseIdx).toBeLessThan(insertIdx);
    });

    it("[mutant this kills] the ON CONFLICT DO UPDATE branch also re-checks ownership via interview_prep_spend.user_id = auth.uid()", () => {
      const body = functionBody(stripped, "record_prep_model_call");
      expect(body).not.toBeNull();
      expect(body).toMatch(/on conflict\s*\(application_id\)\s*do update/i);
      expect(body).toMatch(/where\s+interview_prep_spend\.user_id\s*=\s*auth\.uid\(\)/i);
    });

    it("the atomic increment expression matches claim_prep_pack_slot's own pattern for attempts", () => {
      const body = functionBody(stripped, "record_prep_model_call");
      expect(body).not.toBeNull();
      expect(body).toMatch(/model_calls\s*=\s*interview_prep_spend\.model_calls\s*\+\s*1/);
    });
  });
});
