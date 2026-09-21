// N30 half (a), steps 2 and 3: what the interview-prep migrations did to anon
// on the LIVE schema, replayed over the APPLIED view of the corpus
// (lib/sourceScan/migrationDivergence.js), plus the acceptance tests for the
// new migration 20260923020000_interview_prep_anon_execute_revokes.sql.
// Plan: chunks/N30/plan.r2.md section 5.3. AC: chunks/N30/ac.r1.md AC-A2 and AC-A4.
//
// Location note: the plan names lib/interviewPrep/ for this file. It lives in
// lib/sourceScan/ beside the module it exercises because another change was
// in flight under lib/interviewPrep/ when it landed; nothing in it depends on
// the directory (both sit two levels below hello-world/).
//
// WORDING RULE (plan R9). The replay models only what migration STATEMENTS
// did. It has no model of the platform's default privileges, so it can never
// show that "anon cannot execute" a function. Titles here say "no statement
// that ran ... addresses anon", never "anon cannot".
//
// Loading: the module is imported dynamically inside beforeAll and the
// applied view is built inside try/catch, for the reason given at the top of
// migrationDivergence.test.js (plan 5.0 rule 6): a missing module or a stale
// ledger must fail each dependent test, never skip the file.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";
import { stripComments } from "@/lib/sourceScan/tokenizeSource.js";
import {
  replayFunctionExecute,
  replayTableGrants,
  extractCleanupBlock,
  extractDestructiveKeywords,
  blankStringLiterals,
  lastFunctionDefinition,
  normalizeFunctionSignature,
  parseFunctionSignature,
  mentionsTableLiterally,
} from "@/lib/interviewPrep/migrationGrantReplay.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const FIXTURE_REL = "lib/sourceScan/__fixtures__/lockdown-applied-3d9bb27.sql";

const ANON_REVOKE_MIGRATION = "20260923020000_interview_prep_anon_execute_revokes.sql";
const LOCKDOWN_MIGRATION = "20260915000000_interview_prep_spend_lockdown.sql";
const LATEST_BEFORE_N30A = "20260923010000";
const CLAIM_SIG = "public.claim_prep_pack_slot(uuid, uuid, timestamptz)";
const RECORD_SIG = "public.record_prep_model_call(uuid)";
const SPEND_ANON = "public.interview_prep_spend|anon";

const EFFECTIVE_SCHEMA_TEST_FILES = [
  "lib/interviewPrep/interviewPrepEffectiveSchema.test.js",
  "lib/interviewPrep/interviewPrepSpendCapRemoval.effectiveSchema.test.js",
];

let mod = null;
let modError = null;
let files = null;
let rawTexts = null;
let applied = null;
let appliedError = null;

beforeAll(async () => {
  files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  rawTexts = files.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  try {
    mod = await import("@/lib/sourceScan/migrationDivergence.js");
  } catch (e) {
    modError = e;
    return;
  }
  try {
    applied = mod.appliedMigrationTexts(files, rawTexts);
  } catch (e) {
    appliedError = e;
  }
});

function m() {
  if (modError) throw new Error(`lib/sourceScan/migrationDivergence.js could not be loaded: ${modError.message}`);
  return mod;
}

function getApplied() {
  m();
  if (appliedError) throw appliedError;
  return applied;
}

function readNewMigration() {
  const p = path.join(MIGRATIONS_DIR, ANON_REVOKE_MIGRATION);
  if (!existsSync(p)) throw new Error(`${ANON_REVOKE_MIGRATION} does not exist yet (plan step 3)`);
  return readFileSync(p, "utf8").replace(/\r\n/g, "\n");
}

function newStatements() {
  return m()
    .splitTopLevelStatements(stripSqlComments(readNewMigration()))
    .map((s) => m().normalizeStatement(s.text));
}

function fixtureStatements() {
  const { splitTopLevelStatements, normalizeStatement } = m();
  const raw = readFileSync(path.join(ROOT, FIXTURE_REL), "utf8").replace(/\r\n/g, "\n");
  return splitTopLevelStatements(stripSqlComments(raw)).map((s) => normalizeStatement(s.text));
}

const lockdownIdx = () => files.indexOf(LOCKDOWN_MIGRATION);
const prefix = (texts) => m().textsBefore(files, texts, ANON_REVOKE_MIGRATION);
const withLedger = (ledger) => m().appliedMigrationTexts(files, rawTexts, ledger);

describe("AC-A2.1: over every migration that ran BEFORE 20260923020000 (applied view)", () => {
  it("T-A2.1a no statement that ran before it addresses anon on claim_prep_pack_slot or record_prep_model_call", () => {
    const pre = prefix(getApplied());
    expect(replayFunctionExecute(pre, "claim_prep_pack_slot", CLAIM_SIG).has("anon")).toBe(false);
    expect(replayFunctionExecute(pre, "record_prep_model_call", RECORD_SIG).has("anon")).toBe(false);
  });

  it("T-A2.1b no statement that ran before it addresses anon on interview_prep_spend (.has, never get(k) || [])", () => {
    expect(replayTableGrants(prefix(getApplied())).has(SPEND_ANON)).toBe(false);
  });

  it("T-A2.1c [linkage control] the COMMITTED-text replay of the same prefix disagrees: it is the stale record", () => {
    const pre = m().textsBefore(files, rawTexts, ANON_REVOKE_MIGRATION);
    expect(replayFunctionExecute(pre, "claim_prep_pack_slot", CLAIM_SIG).get("anon")).toBe(false);
    expect(replayFunctionExecute(pre, "record_prep_model_call", RECORD_SIG).get("anon")).toBe(false);
    expect(replayTableGrants(pre).has(SPEND_ANON)).toBe(true);
  });

  it("T-A2.1d a later schema-wide or per-function anon statement cannot move the prefix verdict (control: it moves the whole corpus)", () => {
    const later = [
      ["20991231000000_b_shaped_probe.sql", "revoke truncate, references, trigger on all tables in schema public from anon, authenticated;"],
      ["20991231000001_fn_probe.sql", "revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from anon;"],
    ];
    const f2 = [...files, ...later.map((x) => x[0])];
    const t2 = [...getApplied(), ...later.map((x) => x[1])];
    const pre = m().textsBefore(f2, t2, ANON_REVOKE_MIGRATION);
    expect(replayTableGrants(pre).has(SPEND_ANON)).toBe(false);
    expect(replayFunctionExecute(pre, "claim_prep_pack_slot", CLAIM_SIG).has("anon")).toBe(false);
    // [control] the synthetic files have power over a whole-corpus replay
    expect(replayTableGrants(t2).has(SPEND_ANON)).toBe(true);
    expect(replayFunctionExecute(t2, "claim_prep_pack_slot", CLAIM_SIG).has("anon")).toBe(true);
  });

  it("T-A2.2 the cleanup do-block is absent from the applied lockdown (control: present in the committed text)", () => {
    expect(extractCleanupBlock(getApplied()[lockdownIdx()])).toBe(null);
    expect(extractCleanupBlock(stripSqlComments(rawTexts[lockdownIdx()]))).not.toBe(null);
  });
});

describe("in-suite mutants M1-M3: the real ledger minus one entry turns its AC-A2 test", () => {
  // Subtraction only, from the module's own ledger. No entry is ever built
  // from disk text here.
  const minus = (i) => m().NEVER_APPLIED_STATEMENTS.filter((_, k) => k !== i);

  it("M1 (minus the claim_prep_pack_slot anon revoke) would fail T-A2.1a", () => {
    const pre = prefix(withLedger(minus(1)));
    expect(m().NEVER_APPLIED_STATEMENTS[1].statement).toMatch(/claim_prep_pack_slot.*from anon;$/);
    expect(replayFunctionExecute(pre, "claim_prep_pack_slot", CLAIM_SIG).get("anon")).toBe(false);
  });

  it("M2 (minus the interview_prep_spend anon revoke) would fail T-A2.1b", () => {
    expect(m().NEVER_APPLIED_STATEMENTS[3].statement).toMatch(/interview_prep_spend from anon;$/);
    expect(replayTableGrants(prefix(withLedger(minus(3)))).has(SPEND_ANON)).toBe(true);
  });

  it("M3 (minus the cleanup block) would fail T-A2.2", () => {
    expect(m().NEVER_APPLIED_STATEMENTS[0].group).toBe("cleanup-block");
    expect(extractCleanupBlock(withLedger(minus(0))[lockdownIdx()])).not.toBe(null);
  });
});

describe("AC-A4: the new migration re-issues exactly the two anon EXECUTE revokes", () => {
  it("T-A4.3 the new migration file exists in supabase/migrations", () => {
    expect(files).toContain(ANON_REVOKE_MIGRATION);
  });

  it("T-A4.9 its 14-digit stamp sorts after every migration that existed when N30(a) was planned", () => {
    expect(ANON_REVOKE_MIGRATION).toMatch(/^\d{14}_/);
    expect(ANON_REVOKE_MIGRATION.slice(0, 14) > LATEST_BEFORE_N30A).toBe(true);
    // Deliberately NOT "is the last file" (plan section 7): later migrations must stay free to land.
    expect(files).toContain(ANON_REVOKE_MIGRATION);
  });

  it("T-A4.2 [join] its executable statements equal, in order, the ledger's anon-execute-revoke entries", () => {
    const expected = m()
      .NEVER_APPLIED_STATEMENTS.filter((e) => e.group === "anon-execute-revoke")
      .map((e) => e.statement);
    expect(expected).toHaveLength(2);
    expect(newStatements()).toEqual(expected);
  });

  it("T-A4.1 over the WHOLE applied corpus: anon revoked on both; public still revoked; authenticated still granted", () => {
    const all = getApplied();
    for (const [name, sig] of [["claim_prep_pack_slot", CLAIM_SIG], ["record_prep_model_call", RECORD_SIG]]) {
      const state = replayFunctionExecute(all, name, sig);
      expect(state.get("anon")).toBe(false);
      expect(state.get("public")).toBe(false);
      expect(state.get("authenticated")).toBe(true);
    }
  });

  it("T-A4.4 [canaries] the destructive census flags a delete and a do-block in a fixture", () => {
    const census = (sql) => blankStringLiterals(stripSqlComments(sql)).match(/\b(do|raise|create|alter|drop|grant|truncate|insert|update|delete)\b/gi) || [];
    expect(extractDestructiveKeywords(stripSqlComments("delete from public.t;"))).toEqual(["delete"]);
    expect(census("do $$ begin null; end $$;")).toContain("do");
    expect(census("-- a do-block and a grant, in prose only\nrevoke execute on function public.f(uuid) from anon;")).toEqual([]);
  });

  it("T-A4.4 the new file has no destructive keyword and no do/raise/create/alter/drop/grant/truncate/insert/update/delete", () => {
    const stripped = stripSqlComments(readNewMigration());
    expect(extractDestructiveKeywords(stripped)).toEqual([]);
    expect(blankStringLiterals(stripped).match(/\b(do|raise|create|alter|drop|grant|truncate|insert|update|delete)\b/gi)).toBe(null);
  });

  it("T-A4.5 [deploy safety] both functions exist, with these argument types, in the replay just before the new file", () => {
    const pre = prefix(getApplied());
    const argsOf = (def) => /^create or replace function\s+([\w.]+)\s*\(([^)]*)\)/i.exec(def.preamble);
    for (const [name, sig] of [["claim_prep_pack_slot", CLAIM_SIG], ["record_prep_model_call", RECORD_SIG]]) {
      const def = lastFunctionDefinition(pre, name);
      expect(def).not.toBe(null);
      const mm = argsOf(def);
      expect(mm).not.toBe(null);
      expect(normalizeFunctionSignature(mm[1], mm[2])).toBe(parseFunctionSignature(sig));
    }
    // [canary] a two-argument definition does not satisfy the three-argument signature
    expect(normalizeFunctionSignature("public.claim_prep_pack_slot", "a uuid, b uuid")).not.toBe(parseFunctionSignature(CLAIM_SIG));
  });

  it("T-A4.6 [deploy safety] no migration drops or alters either function", () => {
    const re = /\b(drop|alter)\s+function\s+(if\s+exists\s+)?public\.(claim_prep_pack_slot|record_prep_model_call)\b/i;
    expect(re.test("drop function if exists public.claim_prep_pack_slot(uuid);")).toBe(true);
    const hits = files.filter((f, i) => re.test(stripSqlComments(rawTexts[i])));
    expect(hits).toEqual([]);
  });

  it("T-A4.7 [deploy safety] each new statement, with 'from anon;' read as 'from public;', is a statement Postgres already parsed in 3d9bb27", () => {
    const stmts = newStatements();
    const applied3d9 = new Set(fixtureStatements());
    expect(stmts.length).toBeGreaterThan(0);
    for (const s of stmts) {
      expect(s.endsWith(" from anon;")).toBe(true);
      expect(applied3d9.has(s.replace(/ from anon;$/, " from public;"))).toBe(true);
    }
    // [canary] a misspelled role maps to nothing in the applied statements
    expect(applied3d9.has(stmts[0].replace(/ from anon;$/, " from anno;"))).toBe(false);
  });

  it("T-A4.8 it does not touch interview_prep_spend in executable text (comment mentions do not count)", () => {
    expect(mentionsTableLiterally("-- revoke all on table public.interview_prep_spend from anon;\nselect 1;", "interview_prep_spend")).toBe(false);
    expect(mentionsTableLiterally(readNewMigration(), "interview_prep_spend")).toBe(false);
  });
});

describe("wiring and cap guards on the effective-schema suites", () => {
  // W1 is a deliberate source-text sweep (a wiring census): neither suite
  // exports its orderedTexts, and the switch has no power inside their own
  // 127 tests (plan V8), so its presence can only be checked here. Code only:
  // comments are blanked first, so a commented-out call does not count.
  const WIRED_RE = /orderedTexts\s*=\s*appliedMigrationTexts\(/;

  it("W1 [canaries] today's plain read does not match; a commented-out call does not match after stripping", () => {
    expect(WIRED_RE.test('orderedTexts = migrationFiles.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));')).toBe(false);
    const commented = "// orderedTexts = appliedMigrationTexts(migrationFiles, texts);\n";
    expect(WIRED_RE.test(commented)).toBe(true);
    expect(WIRED_RE.test(stripComments(commented))).toBe(false);
  });

  for (const rel of EFFECTIVE_SCHEMA_TEST_FILES) {
    it(`W1 ${path.basename(rel)} builds orderedTexts through appliedMigrationTexts`, () => {
      expect(WIRED_RE.test(stripComments(readFileSync(path.join(ROOT, rel), "utf8")))).toBe(true);
    });
  }

  it("W2 interviewPrepEffectiveSchema.test.js stays within the 1000-line cap (split on \\n)", () => {
    const text = readFileSync(path.join(ROOT, EFFECTIVE_SCHEMA_TEST_FILES[0]), "utf8");
    expect(text.split("\n").length).toBeLessThanOrEqual(1000);
    // [canary] the counter is the repo's: one more line on a 1000-line file exceeds it
    expect(("x\n".repeat(999) + "x\n").split("\n").length).toBeGreaterThan(1000);
  });
});
