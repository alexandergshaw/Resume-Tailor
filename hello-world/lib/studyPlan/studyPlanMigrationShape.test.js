// N157 SC-B -- the study_plans migration's DDL shape, a source-text parse,
// NOT a live-database query. No live Supabase project is reachable from this
// checkout ([[schema-migration-drift]], [[windows-shell-environment]]), so
// this file can only prove the repo's OWN declared SQL is internally
// consistent; it CANNOT prove any CHECK, GRANT or RLS policy actually
// enforces at runtime, and it cannot prove merge_study_plan_progress's body
// behaves as specified against real Postgres (its lost-update safety under
// READ COMMITTED is owner-run, 2-session concurrency -- plan.r1.md §8). Every
// describe block below restates this where it matters.
//
// RED STATUS ON HEAD, split honestly:
//   * The [control] / canary blocks read ALREADY-SHIPPED migrations
//     (20260908010000_position_glossaries.sql,
//     20260612000000_feed_postings_retention.sql,
//     20260914000000_interview_prep.sql, 20260817000000_application_digests.sql)
//     and are GREEN now by design -- they prove the extractors in THIS file
//     discriminate (standing rule 6: canary every search against a known
//     positive, plus a negative control). They are NOT feature coverage.
//   * The "study_plans migration" blocks read
//     supabase/migrations/20261011000000_n157_study_plans.sql, which does NOT
//     exist yet, via a describe-scoped beforeAll. That beforeAll throws, so
//     those tests RED -- the honest missing-file red. They are scoped so the
//     missing file reds ONLY the feature blocks, leaving the controls visibly
//     green (a control swept red by an unrelated beforeAll failure proves
//     nothing -- [[loop-traps-tests]]: a malformed sabotage is
//     indistinguishable from a test that cannot fail).
//
// PRECEDENT: lib/interviewPrep/interviewPrepMigrationShape.test.js. The
// generic helpers (stripSqlComments usage, constraintClause, quotedValues,
// functionBody, grantsFor) are copied from it; referencedTables and
// createPoliciesOn are study_plans-specific variants written here.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

const STUDY_PLANS_MIGRATION = "20261011000000_n157_study_plans.sql";

// Already-shipped migrations the extractors are canaried against.
const GLOSSARY_MIGRATION = "20260908010000_position_glossaries.sql";
const GLOSSARY_CONSTRAINT = "position_glossaries_status_check";
const GLOSSARY_VALUES = ["ready", "partial", "quotes-only", "unavailable", "failed"];
const RETENTION_MIGRATION = "20260612000000_feed_postings_retention.sql"; // prune_feed_postings (DEFINER)
const PREP_MIGRATION = "20260914000000_interview_prep.sql"; // claim_prep_pack_slot (INVOKER), record_prep_model_call (DEFINER)
const DIGESTS_MIGRATION = "20260817000000_application_digests.sql"; // 4 owner-scoped policies; status DEFAULT 'ready'

function readStripped(name) {
  return stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
}

// --- extractors -----------------------------------------------------------

/** Paren-balanced extraction of `constraint <name> check ( ... )`. Returns
 *  null if the anchor, the "check" keyword, or a balanced closing paren is
 *  not found, so "not found" is distinct from "found an empty clause". */
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

/** The $$...$$ body of a (optionally schema-qualified) function. */
function functionBody(stripped, name) {
  const match = new RegExp(`function\\s+(?:\\w+\\.)?${name}\\s*\\(`).exec(stripped);
  if (!match) return null;
  const open = stripped.indexOf("$$", match.index);
  if (open === -1) return null;
  const close = stripped.indexOf("$$", open + 2);
  if (close === -1) return null;
  return stripped.slice(open + 2, close);
}

/** The preamble text between a function's declaration and its $$ body --
 *  where `security invoker|definer` lives. */
function functionPreamble(stripped, name) {
  const match = new RegExp(`function\\s+(?:\\w+\\.)?${name}\\s*\\(`).exec(stripped);
  if (!match) return null;
  const open = stripped.indexOf("$$", match.index);
  if (open === -1) return null;
  return stripped.slice(match.index, open);
}

/** EVERY table identifier a plpgsql body references via from / insert into /
 *  update / join -- a GENERAL matcher (unlike the template's allow-list
 *  vocabulary), so it detects a reference to ANY other table, which is what
 *  "the body touches only study_plans" requires. A plpgsql `select ... into
 *  v_x` target is NOT matched (only `insert into` is), so a variable is never
 *  mistaken for a table. */
function referencedTables(body) {
  const tables = new Set();
  const re = /\b(?:from|insert\s+into|update|join)\s+(?:public\.)?(\w+)\b/gi;
  let m;
  while ((m = re.exec(body))) tables.add(m[1].toLowerCase());
  return tables;
}

/** `grant <privs> on table <table> to <role>;` clauses for one (table, role). */
function grantsFor(text, tableName, role) {
  const re = /grant\s+([^;]+?)\s+on table\s+([\w.]+)\s+to\s+(\w+)\s*;/gi;
  const hits = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[2] === tableName && m[3] === role) hits.push(m[1].trim());
  }
  return hits;
}

/** Every `create policy "<name>" on <table> for <command> ... ;` on a table.
 *  Policy bodies carry no semicolons, so `[^;]*` captures the whole clause.
 *  Returns { name, command, clause } so a test can count them, check the
 *  command set, AND check each clause is owner-scoped. */
function createPoliciesOn(stripped, table) {
  const re = new RegExp(
    `create policy\\s+"([^"]+)"\\s+on\\s+${table.replace(/\./g, "\\.")}\\s+for\\s+(select|insert|update|delete)\\b([^;]*);`,
    "gi",
  );
  const out = [];
  let m;
  while ((m = re.exec(stripped))) out.push({ name: m[1], command: m[2].toLowerCase(), clause: m[3] });
  return out;
}

const OWNER_SCOPE_RE = /auth\.uid\(\)\s*=\s*user_id/i;

/** The modifiers between a `status text not null` column declaration and the
 *  next comma -- where a `default` would sit. Anchored on the column
 *  declaration, so it never catches `status in (...)` inside a CHECK. */
function statusColumnModifiers(stripped) {
  const m = /\bstatus\s+text\s+not\s+null\b([^,]*)/i.exec(stripped);
  return m ? m[1] : null;
}

// ==========================================================================
// CONTROLS -- the extractors discriminate (GREEN on HEAD by design)
// ==========================================================================

describe("[control] constraintClause + quotedValues against a REAL shipped migration", () => {
  it("finds position_glossaries_status_check's real 5-value list", () => {
    const clause = constraintClause(readStripped(GLOSSARY_MIGRATION), GLOSSARY_CONSTRAINT);
    expect(clause, "extractor could not find a REAL constraint it is known to contain").not.toBeNull();
    expect(quotedValues(clause).sort()).toEqual([...GLOSSARY_VALUES].sort());
  });

  it("[canary] a nonexistent constraint name is not found -- absence is real, not a broken anchor", () => {
    expect(constraintClause(readStripped(GLOSSARY_MIGRATION), "nonexistent_constraint_xyz")).toBeNull();
  });
});

describe("[control] functionBody against a REAL, schema-qualified shipped function", () => {
  it("finds prune_feed_postings's real $$ body (and the precedent really is schema-qualified)", () => {
    const stripped = readStripped(RETENTION_MIGRATION);
    expect(stripped).toContain("function public.prune_feed_postings(");
    const body = functionBody(stripped, "prune_feed_postings");
    expect(body, "extractor could not find a REAL schema-qualified function").not.toBeNull();
    expect(body).toContain("delete from public.feed_postings");
  });

  it("[canary] a nonexistent function name is not found", () => {
    expect(functionBody(readStripped(RETENTION_MIGRATION), "nonexistent_function_xyz")).toBeNull();
  });
});

describe("[control] functionPreamble discriminates SECURITY INVOKER from DEFINER, both directions", () => {
  // The INVOKER/DEFINER property of merge_study_plan_progress is load-bearing
  // (R4: a DEFINER merge is a cross-tenant write). Prove the preamble reader
  // can tell them apart on functions THIS REPO already ships and whose mode is
  // independently known: claim_prep_pack_slot is INVOKER, record_prep_model_call
  // is DEFINER, both declared in 20260914000000_interview_prep.sql itself.
  it("reads claim_prep_pack_slot as SECURITY INVOKER (not DEFINER)", () => {
    const preamble = functionPreamble(readStripped(PREP_MIGRATION), "claim_prep_pack_slot");
    expect(preamble, "claim_prep_pack_slot preamble not found").not.toBeNull();
    expect(preamble).toMatch(/security invoker/i);
    expect(preamble).not.toMatch(/security definer/i);
  });

  it("reads record_prep_model_call as SECURITY DEFINER (not INVOKER) -- the reader is not hardwired to say INVOKER", () => {
    const preamble = functionPreamble(readStripped(PREP_MIGRATION), "record_prep_model_call");
    expect(preamble, "record_prep_model_call preamble not found").not.toBeNull();
    expect(preamble).toMatch(/security definer/i);
    expect(preamble).not.toMatch(/security invoker/i);
  });
});

describe("[control] referencedTables -- canaried on a planted mutant and a no-op clean body", () => {
  it("[mutant this kills] a body that references another table is detected", () => {
    const mutantBody = "update study_plans set progress = '{}'::jsonb; perform 1 from other_secret_table where id = 1;";
    const found = referencedTables(mutantBody);
    expect(found.has("other_secret_table")).toBe(true);
  });

  it("[no-op control] a body touching only study_plans reports exactly {study_plans}", () => {
    const cleanBody =
      "update study_plans set progress = jsonb_set(progress, '{seen}', '{}'::jsonb) where application_id = p_application_id and user_id = auth.uid();";
    expect([...referencedTables(cleanBody)].sort()).toEqual(["study_plans"]);
  });

  it("does not mistake a `select ... into v_x` plpgsql target for a table", () => {
    const body = "select progress into v_progress from study_plans where application_id = p_application_id;";
    expect(referencedTables(body).has("v_progress")).toBe(false);
    expect(referencedTables(body).has("study_plans")).toBe(true);
  });
});

describe("[control] createPoliciesOn + owner-scope detector against application_digests (4 owner-scoped policies)", () => {
  it("finds EXACTLY 4 create-policy statements, one per command, all owner-scoped", () => {
    const policies = createPoliciesOn(readStripped(DIGESTS_MIGRATION), "public.application_digests");
    expect(policies).toHaveLength(4);
    expect(policies.map((p) => p.command).sort()).toEqual(["delete", "insert", "select", "update"]);
    for (const p of policies) expect(p.clause, `${p.name} is not owner-scoped`).toMatch(OWNER_SCOPE_RE);
  });

  it("[negative control] a planted `for select using (true)` policy is NOT owner-scoped -- the detector is not vacuous", () => {
    const planted = 'create policy "study_plans_select_any" on public.study_plans for select using (true);';
    const policies = createPoliciesOn(planted, "public.study_plans");
    expect(policies).toHaveLength(1);
    expect(policies[0].clause).not.toMatch(OWNER_SCOPE_RE);
  });

  it("[canary] a nonexistent table yields zero policies -- absence is real", () => {
    expect(createPoliciesOn(readStripped(DIGESTS_MIGRATION), "public.no_such_table_xyz")).toHaveLength(0);
  });
});

describe("[control] grantsFor + statusColumnModifiers against application_digests", () => {
  it("reads application_digests' authenticated + service_role grants", () => {
    const stripped = readStripped(DIGESTS_MIGRATION);
    expect(grantsFor(stripped, "public.application_digests", "authenticated")).toEqual(["select, insert, update, delete"]);
    expect(grantsFor(stripped, "public.application_digests", "service_role")).toEqual(["all"]);
  });

  it("[canary] a nonexistent role yields no grants", () => {
    expect(grantsFor(readStripped(DIGESTS_MIGRATION), "public.application_digests", "nonexistent_role_xyz")).toEqual([]);
  });

  it("[canary] statusColumnModifiers DETECTS the `default 'ready'` application_digests deliberately carries -- so its absence on study_plans is a real signal", () => {
    // R2: study_plans must NOT default status to 'ready' (a default-ready row
    // with an empty plan would violate study_plans_ready_has_modules). This
    // canary proves the no-default assertion below can actually see a default.
    const mods = statusColumnModifiers(readStripped(DIGESTS_MIGRATION));
    expect(mods).not.toBeNull();
    expect(mods.toLowerCase()).toContain("default");
  });
});

// ==========================================================================
// THE STUDY_PLANS MIGRATION ITSELF -- RED until 20261011000000 lands
// ==========================================================================

describe("the study_plans migration file (declared SQL only; NO live enforcement proven)", () => {
  let migrationFiles = null;
  let stripped = null;

  beforeAll(() => {
    // Throws while the file is absent -> these tests RED (honest missing-file
    // red). Scoped to THIS describe so the controls above stay green.
    migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /_n157_study_plans\.sql$/.test(f));
    stripped = readStripped(STUDY_PLANS_MIGRATION);
  });

  it("[control] the glob resolves to EXACTLY the one expected file -- a second matching name fails loudly here", () => {
    expect(migrationFiles).toEqual([STUDY_PLANS_MIGRATION]);
  });

  describe("table shape", () => {
    it("PK application_id references public.applications (id) ON DELETE CASCADE", () => {
      expect(stripped).toMatch(/references\s+public\.applications\s*\(\s*id\s*\)\s+on delete cascade/i);
    });

    it("user_id references auth.users (id)", () => {
      expect(stripped).toMatch(/references\s+auth\.users\s*\(\s*id\s*\)/i);
    });

    it("status CHECK vocabulary is EXACTLY ('ready','partial','unavailable')", () => {
      const clause = constraintClause(stripped, "study_plans_status_check");
      expect(clause, "study_plans_status_check not found").not.toBeNull();
      expect(quotedValues(clause).sort()).toEqual(["partial", "ready", "unavailable"].sort());
    });

    it("the status column carries NO default (R2 -- a default 'ready' would violate study_plans_ready_has_modules)", () => {
      const mods = statusColumnModifiers(stripped);
      expect(mods, "status column declaration not found").not.toBeNull();
      expect(mods.toLowerCase()).not.toContain("default");
    });

    it("study_plans_ready_has_modules exists, is CASE-guarded over jsonb_typeof, and names modules", () => {
      const clause = constraintClause(stripped, "study_plans_ready_has_modules");
      expect(clause, "study_plans_ready_has_modules not found").not.toBeNull();
      expect(clause).toMatch(/jsonb_typeof/i);
      expect(clause).toContain("modules");
    });

    it("declares a user_id index study_plans_user_idx on public.study_plans (user_id)", () => {
      expect(stripped).toMatch(
        /create index if not exists study_plans_user_idx\s+on public\.study_plans\s*\(\s*user_id\s*\)/i,
      );
    });

    it("enables row level security on public.study_plans", () => {
      expect(stripped).toMatch(/alter table public\.study_plans enable row level security/i);
    });
  });

  describe("RLS policies (R10 -- teeth: exactly 4, each owner-scoped)", () => {
    it("declares EXACTLY 4 create-policy statements on public.study_plans -- one per command, never >=1", () => {
      const policies = createPoliciesOn(stripped, "public.study_plans");
      expect(policies).toHaveLength(4);
      expect(policies.map((p) => p.command).sort()).toEqual(["delete", "insert", "select", "update"]);
    });

    it("every study_plans policy is owner-scoped auth.uid() = user_id (no `using (true)` leak)", () => {
      const policies = createPoliciesOn(stripped, "public.study_plans");
      expect(policies.length).toBeGreaterThan(0);
      for (const p of policies) expect(p.clause, `${p.name} is not owner-scoped`).toMatch(OWNER_SCOPE_RE);
    });
  });

  describe("grants", () => {
    it("authenticated gets exactly select, insert, update, delete", () => {
      expect(grantsFor(stripped, "public.study_plans", "authenticated")).toEqual(["select, insert, update, delete"]);
    });

    it("service_role gets all", () => {
      expect(grantsFor(stripped, "public.study_plans", "service_role")).toEqual(["all"]);
    });
  });

  describe("merge_study_plan_progress RPC (K2-RPC -- declared body only)", () => {
    it("exists as a $$-bodied function", () => {
      expect(functionBody(stripped, "merge_study_plan_progress"), "RPC body not found").not.toBeNull();
    });

    it("is SECURITY INVOKER, not DEFINER (R4 -- a DEFINER merge would be a cross-tenant write)", () => {
      const preamble = functionPreamble(stripped, "merge_study_plan_progress");
      expect(preamble, "RPC preamble not found").not.toBeNull();
      expect(preamble).toMatch(/security invoker/i);
      expect(preamble).not.toMatch(/security definer/i);
    });

    it("signature is (p_application_id uuid, p_cursor jsonb, p_seen_delta jsonb) and carries NO p_user_id", () => {
      const sig = /function\s+(?:public\.)?merge_study_plan_progress\s*\(([^)]*)\)/i.exec(stripped);
      expect(sig, "RPC signature not found").not.toBeNull();
      expect(sig[1]).toMatch(/p_application_id\s+uuid/i);
      expect(sig[1]).toMatch(/p_cursor\s+jsonb/i);
      expect(sig[1]).toMatch(/p_seen_delta\s+jsonb/i);
      expect(sig[1]).not.toMatch(/p_user_id/i);
    });

    it("the declared body references ONLY study_plans -- zero other tables", () => {
      const body = functionBody(stripped, "merge_study_plan_progress");
      expect(body, "RPC body not found").not.toBeNull();
      expect([...referencedTables(body)].sort()).toEqual(["study_plans"]);
    });

    it("the WHERE carries both application_id = p_application_id AND user_id = auth.uid() (S8 defence-in-depth)", () => {
      const body = functionBody(stripped, "merge_study_plan_progress");
      expect(body).not.toBeNull();
      expect(body).toMatch(/where\s+application_id\s*=\s*p_application_id\s+and\s+user_id\s*=\s*auth\.uid\(\)/i);
    });

    it("merges seen via `|| coalesce(p_seen_delta ...)` -- the bounded delta direction (M3)", () => {
      const body = functionBody(stripped, "merge_study_plan_progress");
      expect(body).not.toBeNull();
      expect(body).toMatch(/\|\|\s*coalesce\(\s*p_seen_delta/i);
    });

    it("grants execute on the exact (uuid, jsonb, jsonb) signature to authenticated", () => {
      expect(stripped).toContain(
        "grant execute on function public.merge_study_plan_progress(uuid, jsonb, jsonb) to authenticated",
      );
    });
  });
});
