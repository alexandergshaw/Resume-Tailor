// N30 half (a), step 1: the applied-vs-committed migration ledger.
//
// `20260915000000_interview_prep_spend_lockdown.sql` was edited in place
// AFTER the Action applied it (3d9bb27 applied, 0e83c97 edited). Four
// statement groups in today's committed text never ran against the live
// database. `lib/sourceScan/migrationDivergence.js` records them
// (NEVER_APPLIED_STATEMENTS) and yields the APPLIED view of the corpus
// (appliedMigrationTexts), so the grant replay stops certifying statements
// that never executed.
//
// This file owns the module's units (U1-U6, S1) and the ledger's checks
// against the real tree (L1-L6). Plan: chunks/N30/plan.r2.md sections 3,
// 5.1 and 5.2.
//
// WHY THE MODULE IS LOADED WITH A DYNAMIC import() INSIDE beforeAll, AND WHY
// THE APPLIED VIEW IS COMPUTED INSIDE try/catch (plan 5.0 rule 6).
// A static import of a module that does not exist yet fails the whole FILE
// with zero tests reported, and a throw in beforeAll reports every test as
// SKIPPED. Neither is a discriminating result: a skipped test is neither red
// nor green. Here, a missing module and a stale ledger both surface as
// individual test FAILURES carrying the real error message:
//   - m() re-throws the import error in every test that needs the module;
//   - L4 asserts the applied view built without an error, so a stale ledger
//     fails L4 with the helper's own message;
//   - getApplied() re-throws that error in every other test that needs it.
// This is not a shim around a gate: the specifier is a static string, which
// lib/sourceScan/exportGraph.js records as an ordinary import edge.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";
import { tokenizeSource } from "@/lib/sourceScan/tokenizeSource.js";
import { parseModuleSource } from "@/lib/sourceScan/exportGraph.js";
import { replayFunctionExecute } from "@/lib/interviewPrep/migrationGrantReplay.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const MODULE_FILE = path.join(ROOT, "lib/sourceScan/migrationDivergence.js");
const THIS_FILE = fileURLToPath(import.meta.url);

const LOCKDOWN_MIGRATION = "20260915000000_interview_prep_spend_lockdown.sql";
// Independent of the module under test: these literals were measured from
// `git show 3d9bb27:<lockdown>` (17566 bytes, 0 CR, no BOM) at plan time
// (plan.r2.md V6) and re-measured by this seat. The module must agree with
// them; they are not read from it.
const FIXTURE_REL = "lib/sourceScan/__fixtures__/lockdown-applied-3d9bb27.sql";
const FIXTURE_SHA256_LF = "3489faa24d916759c27e1f32424740114af0dede2a555d3516a2e0b6019338fe";
const SOURCE_GIT = "git-derived, live statements column not read";

const CLAIM_ANON = "revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from anon;";
const RECORD_ANON = "revoke execute on function public.record_prep_model_call(uuid) from anon;";
const SPEND_ANON_TABLE = "revoke all on table public.interview_prep_spend from anon;";
// U+FEFF, built from its code point so the file itself stays pure ASCII.
const BOM = String.fromCharCode(0xfeff);

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

function readFixture() {
  return readFileSync(path.join(ROOT, FIXTURE_REL), "utf8");
}

const sha256LF = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");

function entry(overrides) {
  return {
    file: "002_b.sql",
    group: "anon-execute-revoke",
    statement: "revoke execute on function public.f(uuid) from anon;",
    appliedCommit: "aaaaaaa",
    committedCommit: "bbbbbbb",
    source: SOURCE_GIT,
    ...overrides,
  };
}

// A three-file corpus for the unit tests. File b carries one statement the
// ledger says never ran, sandwiched between two that did, so a span that
// spills in either direction eats a real neighbour.
const FX_FILES = ["001_a.sql", "002_b.sql", "003_c.sql"];
const FX_A = "create or replace function public.f(p_id uuid) returns void language sql as $$ select 1 $$;\n";
const FX_B_LINES = [
  "-- header: the anon line below never ran",
  "revoke execute on function public.f(uuid) from public;",
  "revoke execute on function public.f(uuid) from anon;",
  "grant execute on function public.f(uuid) to authenticated;",
  "",
];
const FX_B = FX_B_LINES.join("\n");
const FX_C = "select 1;\n";
const FX_TEXTS = [FX_A, FX_B, FX_C];

describe("U1 splitTopLevelStatements: ';' splits only at top level", () => {
  it("a ';' inside '...', \"...\", $$...$$ and $tag$...$tag$ does not split", () => {
    const sql = "select 'a;b'; select \"x;y\"; create function g() returns void as $$ begin x; y; end $$ language plpgsql; do $q$ begin execute $$ a; b $$; end $q$; select 3;";
    const texts = m().splitTopLevelStatements(sql).map((s) => s.text);
    expect(texts).toEqual([
      "select 'a;b';",
      'select "x;y";',
      "create function g() returns void as $$ begin x; y; end $$ language plpgsql;",
      "do $q$ begin execute $$ a; b $$; end $q$;",
      "select 3;",
    ]);
    // [canary] a naive split has a different count on the same input, so the
    // expectation above is not something any splitter produces.
    expect(sql.split(";").filter((s) => s.trim()).length).not.toBe(texts.length);
  });

  it("a whole do-block is ONE statement", () => {
    const sql = "do $$ begin x; y; end $$;";
    expect(m().splitTopLevelStatements(sql)).toEqual([{ text: sql, start: 0, end: sql.length }]);
  });

  it("the '' and \"\" escapes stay inside their literal; a $tag$ closes only on the same tag", () => {
    expect(m().splitTopLevelStatements("select 'it''s; fine'; select 2;").map((s) => s.text)).toEqual([
      "select 'it''s; fine';",
      "select 2;",
    ]);
    expect(m().splitTopLevelStatements('select "a"";b"; select 2;').map((s) => s.text)).toEqual([
      'select "a"";b";',
      "select 2;",
    ]);
    expect(m().splitTopLevelStatements("do $a$ x $b$ ; $a$; select 2;").map((s) => s.text)).toEqual([
      "do $a$ x $b$ ; $a$;",
      "select 2;",
    ]);
  });

  it("a positional parameter such as $1 is not a dollar-quote", () => {
    expect(m().splitTopLevelStatements("select $1; select 2;").map((s) => s.text)).toEqual(["select $1;", "select 2;"]);
  });

  it("start is the first non-whitespace character, end is just past ';', and slice(start, end) === text", () => {
    const sql = "  \n select 1;\n\n  revoke x from anon;  \n";
    const out = m().splitTopLevelStatements(sql);
    expect(out).toEqual([
      { text: "select 1;", start: 4, end: 13 },
      { text: "revoke x from anon;", start: 17, end: 36 },
    ]);
    for (const s of out) expect(sql.slice(s.start, s.end)).toBe(s.text);
  });

  it("empty and whitespace-only input give []; a lone ';' is a statement", () => {
    expect(m().splitTopLevelStatements("")).toEqual([]);
    expect(m().splitTopLevelStatements("  \n\t ")).toEqual([]);
    expect(m().splitTopLevelStatements(";")).toEqual([{ text: ";", start: 0, end: 1 }]);
    expect(m().splitTopLevelStatements("  ;")).toEqual([{ text: ";", start: 2, end: 3 }]);
  });

  it("a trailing remainder without ';' is returned with its trailing whitespace excluded", () => {
    expect(m().splitTopLevelStatements("select 1; select 2  \n")).toEqual([
      { text: "select 1;", start: 0, end: 9 },
      { text: "select 2", start: 10, end: 18 },
    ]);
  });

  it("an unterminated quote or dollar-quote throws rather than guessing", () => {
    expect(() => m().splitTopLevelStatements("select 'abc; select 2;")).toThrow(/^migrationDivergence: unterminated/);
    expect(() => m().splitTopLevelStatements('select "abc; select 2;')).toThrow(/^migrationDivergence: unterminated/);
    expect(() => m().splitTopLevelStatements("do $$ begin x; end;")).toThrow(/^migrationDivergence: unterminated/);
    // [control] the terminated forms of the same inputs do not throw
    expect(() => m().splitTopLevelStatements("select 'abc'; select 2;")).not.toThrow();
    expect(() => m().splitTopLevelStatements("do $$ begin x; end $$;")).not.toThrow();
  });
});

describe("U2 normalizeStatement", () => {
  it("collapses CRLF, tabs and space runs to one space, trims and lower-cases", () => {
    expect(m().normalizeStatement("  REVOKE\r\n  Execute\ton   FUNCTION  Public.F(UUID)\n from ANON;  ")).toBe(
      "revoke execute on function public.f(uuid) from anon;",
    );
  });

  it("removes a leading byte-order mark", () => {
    expect(m().normalizeStatement(BOM + "revoke x from anon;")).toBe("revoke x from anon;");
  });

  it("is idempotent", () => {
    for (const s of ["  A\r\n\tB  ;", "do $$ begin\n  x;\nend $$;", BOM + " X ", ""]) {
      const once = m().normalizeStatement(s);
      expect(m().normalizeStatement(once)).toBe(once);
    }
  });
});

describe("U3 statementDivergence: multiset difference of normalized statements", () => {
  it("[control] identical inputs give two empty lists", () => {
    expect(m().statementDivergence("a; b;", "a; b;")).toEqual({ neverApplied: [], appliedNotCommitted: [] });
  });

  it("a statement only in the committed text is neverApplied; one only in the applied text is appliedNotCommitted", () => {
    expect(m().statementDivergence("a; b; c;", "a; b;")).toEqual({ neverApplied: ["c;"], appliedNotCommitted: [] });
    expect(m().statementDivergence("a; b;", "a; b; c;")).toEqual({ neverApplied: [], appliedNotCommitted: ["c;"] });
  });

  it("duplicates count as a multiset, and each list is sorted ascending", () => {
    expect(m().statementDivergence("a; a; b;", "a; b;")).toEqual({ neverApplied: ["a;"], appliedNotCommitted: [] });
    expect(m().statementDivergence("z; y; x;", "")).toEqual({ neverApplied: ["x;", "y;", "z;"], appliedNotCommitted: [] });
  });

  it("CRLF, comments, case and whitespace do not register as divergence", () => {
    expect(m().statementDivergence("-- note\r\nREVOKE  x\r\n  FROM anon;\r\n", "revoke x from anon;")).toEqual({
      neverApplied: [],
      appliedNotCommitted: [],
    });
  });
});

describe("U4 appliedMigrationTexts on a fixture corpus", () => {
  const LEDGER = [entry({})];

  it("blanks exactly the ledgered statement's span, keeps every newline, and keeps both neighbours intact", () => {
    const out = m().appliedMigrationTexts(FX_FILES, FX_TEXTS, LEDGER);
    // Expected value built WITHOUT the module: the comment-stripped file with
    // that one line overwritten by spaces of the same length.
    const stripped = stripSqlComments(FX_B);
    const target = FX_B_LINES[2];
    expect(stripped.split(target).length).toBe(2);
    expect(out[1]).toBe(stripped.replace(target, " ".repeat(target.length)));
    expect(out[1].split("\n").length).toBe(FX_B.split("\n").length);
    expect(out[1]).toContain(FX_B_LINES[1]);
    expect(out[1]).toContain(FX_B_LINES[3]);
  });

  it("a MULTI-LINE ledgered statement keeps every newline inside its span, so line numbers survive", () => {
    // The single-line fixture above cannot see a blanker that also erases
    // '\n' (measured: that mutant survived it). The real cleanup entry spans
    // dozens of lines, so this is the shape that matters.
    const lines = ["revoke execute", "  on function public.f(uuid)", "  from anon;"];
    const text = ["select 1;", ...lines, "select 2;", ""].join("\n");
    const out = m().appliedMigrationTexts(["001_x.sql"], [text], [entry({ file: "001_x.sql" })]);
    const span = lines.join("\n");
    expect(out[0]).toBe(text.replace(span, span.replace(/[^\n]/g, " ")));
    expect(out[0].split("\n").length).toBe(text.split("\n").length);
  });

  it("returns a new array; every non-ledgered text is the IDENTICAL string; the inputs are not mutated", () => {
    const filesIn = [...FX_FILES];
    const textsIn = [...FX_TEXTS];
    const out = m().appliedMigrationTexts(filesIn, textsIn, LEDGER);
    expect(out).not.toBe(textsIn);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(FX_TEXTS[0]);
    expect(out[2]).toBe(FX_TEXTS[2]);
    expect(filesIn).toEqual(FX_FILES);
    expect(textsIn).toEqual(FX_TEXTS);
  });

  it("a CRLF copy of the file gives the same applied text as the LF original", () => {
    const crlf = [FX_A, FX_B.replace(/\n/g, "\r\n"), FX_C];
    expect(m().appliedMigrationTexts(FX_FILES, crlf, LEDGER)[1]).toBe(m().appliedMigrationTexts(FX_FILES, FX_TEXTS, LEDGER)[1]);
  });

  it("matching is by whole normalized statement, never by substring", () => {
    const widened = [FX_A, FX_B.replace("from anon;", "from anon, authenticated;"), FX_C];
    expect(() => m().appliedMigrationTexts(FX_FILES, widened, LEDGER)).toThrow(/not found in 002_b\.sql/);
  });

  it("[AC-A2.2 staleness canary] a ledgered statement absent from its file throws 'not found ... the ledger is stale'", () => {
    const stale = [entry({ statement: "revoke execute on function public.f(uuid) from someone_else;" })];
    expect(() => m().appliedMigrationTexts(FX_FILES, FX_TEXTS, stale)).toThrow(/^migrationDivergence: .*not found in 002_b\.sql.*the ledger is stale/);
  });

  it("throws when the ledger names a file that is not in the list, or appears twice in it", () => {
    expect(() => m().appliedMigrationTexts(FX_FILES, FX_TEXTS, [entry({ file: "009_gone.sql" })])).toThrow(
      /^migrationDivergence: .*009_gone\.sql not in the migrations list/,
    );
    expect(() =>
      m().appliedMigrationTexts([...FX_FILES, "002_b.sql"], [...FX_TEXTS, FX_B], LEDGER),
    ).toThrow(/^migrationDivergence:/);
  });

  it("throws when the statement occurs more than once in its file (ambiguous span)", () => {
    const twice = [FX_A, FX_B + FX_B_LINES[2] + "\n", FX_C];
    expect(() => m().appliedMigrationTexts(FX_FILES, twice, LEDGER)).toThrow(/^migrationDivergence: .*more than once in 002_b\.sql/);
  });

  it("throws on a filenames/texts length mismatch", () => {
    expect(() => m().appliedMigrationTexts(FX_FILES, FX_TEXTS.slice(0, 2), [])).toThrow(/^migrationDivergence:/);
  });

  it("validates the ledger: duplicate entry, un-normalized statement, and a 'live-confirmed' source each throw", () => {
    expect(() => m().appliedMigrationTexts(FX_FILES, FX_TEXTS, [entry({}), entry({})])).toThrow(/^migrationDivergence:/);
    expect(() =>
      m().appliedMigrationTexts(FX_FILES, FX_TEXTS, [entry({ statement: "REVOKE execute on function public.f(uuid) from anon;" })]),
    ).toThrow(/^migrationDivergence:/);
    expect(() => m().appliedMigrationTexts(FX_FILES, FX_TEXTS, [entry({ source: "live-confirmed (Q1)" })])).toThrow(/^migrationDivergence:/);
    // [control] the valid single entry does not throw
    expect(() => m().appliedMigrationTexts(FX_FILES, FX_TEXTS, LEDGER)).not.toThrow();
  });

  it("[AC-A2.3 sensitivity canary] subtracting the ledgered revoke changes the replay; an empty ledger does not", () => {
    const withLedger = m().appliedMigrationTexts(FX_FILES, FX_TEXTS, LEDGER);
    const state = replayFunctionExecute(withLedger, "f", "public.f(uuid)");
    expect(state.has("anon")).toBe(false);
    expect(state.get("public")).toBe(false);
    expect(state.get("authenticated")).toBe(true);
    const noLedger = m().appliedMigrationTexts(FX_FILES, FX_TEXTS, []);
    for (let i = 0; i < FX_TEXTS.length; i += 1) expect(noLedger[i]).toBe(FX_TEXTS[i]);
    expect(replayFunctionExecute(noLedger, "f", "public.f(uuid)").get("anon")).toBe(false);
  });
});

describe("U5 the ledger's shape, and the cleanup entry's anchors", () => {
  it("exactly four frozen entries for the lockdown file, in the planned order and groups", () => {
    const L = m().NEVER_APPLIED_STATEMENTS;
    expect(Object.isFrozen(L)).toBe(true);
    expect(L).toHaveLength(4);
    for (const e of L) {
      expect(Object.isFrozen(e)).toBe(true);
      expect(e.file).toBe(LOCKDOWN_MIGRATION);
      expect(e.appliedCommit).toBe("3d9bb27");
      expect(e.committedCommit).toBe("0e83c97");
    }
    expect(L.map((e) => e.group)).toEqual(["cleanup-block", "anon-execute-revoke", "anon-execute-revoke", "anon-table-revoke"]);
    expect(L.slice(1).map((e) => e.statement)).toEqual([CLAIM_ANON, RECORD_ANON, SPEND_ANON_TABLE]);
  });

  it("the cleanup entry is the whole do-block: its start, its end, 1816 chars, and exactly two $$", () => {
    // Catches a paste that corrupted `$$` into `$` (String.replace with a
    // string replacement does this) before L4's less specific "not found".
    const s = m().NEVER_APPLIED_STATEMENTS[0].statement;
    expect(s.startsWith("do $$ declare v_deleted_spend")).toBe(true);
    expect(s.endsWith("end; $$;")).toBe(true);
    expect(s.split("$$").length - 1).toBe(2);
    expect(s).toHaveLength(1816);
  });
});

describe("U6 textsBefore: the corpus prefix, by NAME comparison", () => {
  const F = ["20260101000000_a.sql", "20260102000000_b.sql", "20260103000000_c.sql"];
  const T = ["A", "B", "C"];

  it("with the name absent and sorting after every file, keeps all of them (the indexOf/slice pitfall drops the last)", () => {
    expect(m().textsBefore(F, T, "20260104000000_x.sql")).toEqual(["A", "B", "C"]);
    // [control] the rejected implementation really does drop one here
    expect(T.slice(0, F.indexOf("20260104000000_x.sql"))).toEqual(["A", "B"]);
  });

  it("with the name present, excludes it and every later file", () => {
    expect(m().textsBefore(F, T, "20260102000000_b.sql")).toEqual(["A"]);
  });

  it("with the name absent and sorting mid-list, keeps only the earlier files", () => {
    expect(m().textsBefore(F, T, "20260102500000_z.sql")).toEqual(["A", "B"]);
  });

  it("orders by name, not position, and keeps input order", () => {
    const F2 = [F[2], F[0], F[1]];
    const T2 = ["C", "A", "B"];
    expect(m().textsBefore(F2, T2, "20260102000000_b.sql")).toEqual(["A"]);
    expect(m().textsBefore(F2, T2, "20260109000000_z.sql")).toEqual(["C", "A", "B"]);
  });

  it("throws on a filenames/texts length mismatch", () => {
    expect(() => m().textsBefore(F, ["A"], "20260102000000_b.sql")).toThrow(/^migrationDivergence:/);
  });
});

describe("S1 the module is pure: no filesystem access, and the ledger is never derived at runtime", () => {
  // A deliberate source-text sweep, not a prose assertion: it scans CODE only
  // (comments blanked by the shared tokenizer), so the module's header may
  // discuss supabase/migrations freely.
  function scan(file) {
    const src = readFileSync(file, "utf8");
    const { readable, codeMask } = tokenizeSource(src);
    return {
      specs: parseModuleSource(src).imports.map((e) => e.spec),
      codeHits: ["readFileSync", "readdirSync", "require("].filter((w) => codeMask.includes(w)),
      namesMigrationsDir: readable.includes("supabase/migrations"),
    };
  }

  it("[canary] the same scan over THIS test file finds fs use, the migrations path, and other specifiers", () => {
    const r = scan(THIS_FILE);
    expect(r.specs).toContain("node:fs");
    expect(r.codeHits).toContain("readFileSync");
    expect(r.namesMigrationsDir).toBe(true);
  });

  it("migrationDivergence.js imports only ./stripSqlComments.js and has no fs call or migrations path", () => {
    m();
    const r = scan(MODULE_FILE);
    expect(r.specs).toEqual(["./stripSqlComments.js"]);
    expect(r.codeHits).toEqual([]);
    expect(r.namesMigrationsDir).toBe(false);
  });
});

describe("L1-L6 the ledger against the real tree", () => {
  it("L1 the applied-bytes fixture is pinned: path, commit and sha256 (CRLF-normalized, BOM NOT stripped)", () => {
    const pin = m().APPLIED_FIXTURES[LOCKDOWN_MIGRATION];
    expect(pin).toEqual({ path: FIXTURE_REL, commit: "3d9bb27", sha256LF: FIXTURE_SHA256_LF });
    expect(sha256LF(readFixture())).toBe(FIXTURE_SHA256_LF);
  });

  it("L2 the ledger equals committed-minus-applied for the lockdown file, in BOTH directions", () => {
    const d = m().statementDivergence(rawTexts[files.indexOf(LOCKDOWN_MIGRATION)], readFixture());
    const ledgered = m()
      .NEVER_APPLIED_STATEMENTS.filter((e) => e.file === LOCKDOWN_MIGRATION)
      .map((e) => e.statement)
      .sort();
    expect(d.neverApplied).toEqual(ledgered);
    expect(d.appliedNotCommitted).toEqual([]);
  });

  it("L3 every entry's provenance is the git-derived label; nothing claims live-confirmed", () => {
    expect(m().DIVERGENCE_SOURCE_GIT).toBe(SOURCE_GIT);
    for (const e of m().NEVER_APPLIED_STATEMENTS) {
      expect(e.source).toBe(SOURCE_GIT);
      expect(e.source).not.toMatch(/live-confirmed/i);
    }
  });

  it("L4 the applied view of the REAL corpus builds with the default ledger (the staleness guard does not fire)", () => {
    m();
    expect(appliedError === null ? null : appliedError.message).toBeNull();
    expect(getApplied()).toHaveLength(files.length);
  });

  it("L5 the applied lockdown still carries the statements that DID run", () => {
    const view = getApplied()[files.indexOf(LOCKDOWN_MIGRATION)].replace(/\s+/g, " ").toLowerCase();
    expect(view).toContain("revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from public;");
    expect(view).toContain("revoke execute on function public.record_prep_model_call(uuid) from public;");
    expect(view).toContain("create or replace function public.claim_prep_pack_slot(");
  });

  it("L6 the applied VIEW of the lockdown equals the applied BYTES, statement for statement", () => {
    // Any span spill (forward or backward), an under-blank that leaves a
    // fragment, or a blank of the wrong statement shows up here as a
    // leftover fragment or a missing statement.
    const view = getApplied()[files.indexOf(LOCKDOWN_MIGRATION)];
    expect(m().statementDivergence(view, readFixture())).toEqual({ neverApplied: [], appliedNotCommitted: [] });
    // and the multi-line cleanup block's blanking kept the file's line count
    const committedLF = rawTexts[files.indexOf(LOCKDOWN_MIGRATION)].replace(/\r\n/g, "\n");
    expect(view.split("\n").length).toBe(committedLF.split("\n").length);
  });

  it("L6b every migration the ledger does not name is passed through as the identical string", () => {
    const out = getApplied();
    const ledgered = new Set(m().NEVER_APPLIED_STATEMENTS.map((e) => e.file));
    for (let i = 0; i < files.length; i += 1) {
      if (!ledgered.has(files[i])) expect(out[i] === rawTexts[i]).toBe(true);
    }
    // [control] the one ledgered file really was changed
    expect(out[files.indexOf(LOCKDOWN_MIGRATION)]).not.toBe(rawTexts[files.indexOf(LOCKDOWN_MIGRATION)]);
  });
});
