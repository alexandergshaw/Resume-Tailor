// The EFFECTIVE, post-replay shape of the interview-prep schema -- backlog
// N12. This file owns every assertion about a property a LATER migration
// can change: privileges (a grant/revoke sequence across files), which
// SECURITY mode a function ends in (the LAST `create or replace` wins), and
// the final declared body of claim_prep_pack_slot. All of it is a
// source-text parse, not a live-database query -- no live Supabase project
// is reachable from this checkout ([[schema-migration-drift]],
// [[windows-shell-environment]]), so this file can only prove the repo's OWN
// declared SQL text, REPLAYED across every migration in file order, is
// internally consistent. It cannot prove Postgres actually enforces any of
// it.
//
// WHY REPLAY, NOT "CONCATENATE EVERYTHING AND SEARCH THE RESULT" -- rejected
// by this round's design pass. Concatenated text is not an applied schema: a
// `.toContain` over the concatenation of every migration would still see
// `grant update (attempts, updated_at)` from 20260914000000_interview_prep.sql
// even after 20260915000000_interview_prep_spend_lockdown.sql revokes it --
// asserting a privilege a later statement removed. Every check below instead
// walks the migrations in order and applies each grant/revoke or
// create-or-replace on top of the running state, the same way Postgres
// itself applies a migration sequence.
//
// PRECEDENT FOLLOWED HERE: lib/applications/statusMigrationShape.test.js:110
// and lib/supabase/applicationDigestsMigrationShape.test.js:303 both scan
// EVERY migration file and select by CONTENT, not filename, then assert the
// matching set equals a known list -- so a third file touching the same
// object fails this suite loudly instead of silently. The same shape is used
// below for "which files touch interview_prep_spend". Both files also pair
// every absence assertion with a positive control and every parser with a
// canary; the grant-replay and security-mode-replay parsers below follow the
// same discipline, since a replay parser checked only against its own happy
// path is the "canary drawn from the same source it validates" trap this
// repo tracks.
//
// EXTRACTED PARSING LOGIC (N12 wave 2 adversarial-check pass): the
// grant/revoke and security-mode replay functions themselves now live in
// lib/interviewPrep/migrationGrantReplay.js -- pure logic, no
// describe/it/expect -- purely to keep this file under this repo's standing
// 1000-line cap once BLOCKER-1, BLOCKER-2, MAJOR-3, MAJOR-4, MAJOR-5 and
// minors 7-9's own mutant-kill coverage landed here. Every assertion below
// is still authored and owned in this file; only the functions under test
// moved, unchanged in behaviour except where a numbered item above names a
// fix.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";
import {
  replayTableGrants,
  replayFunctionExecute,
  lastFunctionDefinition,
  extractCleanupBlock,
  extractDeleteStatement,
  extractDestructiveKeywords,
  insertAfterCleanupBegin,
  mentionsTableLiterally,
  textsExcludingFile,
  forceRlsGuardPattern,
  CLEANUP_BLOCK_EXTRA_DESTRUCTIVE_STATEMENTS,
  TRACKED_GRANT_TABLES,
  SPEND_DELETE_RE,
  PACKS_DELETE_RE,
} from "@/lib/interviewPrep/migrationGrantReplay.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

const ORIGINAL_MIGRATION = "20260914000000_interview_prep.sql";
const LOCKDOWN_MIGRATION = "20260915000000_interview_prep_spend_lockdown.sql";

// An independently-authored function this suite does NOT own, used as the
// control for the security-mode replay below -- it predates IP3 entirely and
// no IP3 migration touches it.
const RETENTION_MIGRATION = "20260612000000_feed_postings_retention.sql";
const RETENTION_FUNCTION = "prune_feed_postings";

let migrationFiles = null;
let orderedTexts = null;
let originalRaw = null;
let originalStripped = null;
// Shared across every describe below that needs the lockdown migration's own
// comment-stripped text -- four separate blocks used to each re-read and
// re-strip this same file independently; read once here instead.
let lockdownStripped = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  orderedTexts = migrationFiles.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  originalRaw = readFileSync(path.join(MIGRATIONS_DIR, ORIGINAL_MIGRATION), "utf8");
  originalStripped = stripSqlComments(originalRaw);
  lockdownStripped = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, LOCKDOWN_MIGRATION), "utf8"));
});

describe("[control] the migrations directory was actually read and is non-trivial", () => {
  it("more than 10 migration files exist, lexicographically sorted", () => {
    expect(migrationFiles.length).toBeGreaterThan(10);
    expect(migrationFiles).toEqual([...migrationFiles].sort());
  });
});

describe("exactly the two known migrations touch interview_prep_spend", () => {
  // mentionsTableLiterally is comment-aware, matching this repo's own
  // convention (lib/applications/statusMigrationShape.test.js,
  // lib/supabase/applicationDigestsMigrationShape.test.js): a migration
  // naming this table only in prose must not count as "touches it".
  it("[canary] a prose-only mention (no real DDL) does not count", () => {
    const prose = "-- unlike interview_prep_spend, this table has no cap.\nselect 1;";
    expect(mentionsTableLiterally(prose, "interview_prep_spend")).toBe(false);
  });

  it("[canary] a migration with real DDL referencing the table does count", () => {
    expect(mentionsTableLiterally("alter table public.interview_prep_spend add column x int;", "interview_prep_spend")).toBe(true);
  });

  it("the matching set is exactly [ORIGINAL_MIGRATION, LOCKDOWN_MIGRATION] -- a third file fails loudly here", () => {
    const matching = migrationFiles.filter((f) =>
      mentionsTableLiterally(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"), "interview_prep_spend"),
    );
    expect(matching).toEqual([ORIGINAL_MIGRATION, LOCKDOWN_MIGRATION]);
  });
});

// ===========================================================================
// Grant replay: a privilege set per (table, role), built by applying every
// grant/revoke in every migration, IN FILE ORDER. Parser lives in
// lib/interviewPrep/migrationGrantReplay.js (see this file's header).
// ===========================================================================

describe("grant replay -- (public.interview_prep_spend, authenticated) across every migration in order", () => {
  it("[canary] REPLAYS across files rather than reading only the last one: file 1 grants insert, file 2 has no revoke -> insert still present", () => {
    const state = replayTableGrants([
      "grant insert on table public.foo to bar;",
      "select 1;",
    ]);
    expect([...(state.get("public.foo|bar") || [])]).toEqual(["insert"]);
  });

  it("[canary] a later file's revoke is honoured -- file 1 grants insert, file 2 revokes it -> absent", () => {
    const state = replayTableGrants([
      "grant insert on table public.foo to bar;",
      "revoke insert on table public.foo from bar;",
    ]);
    expect([...(state.get("public.foo|bar") || [])]).toEqual([]);
  });

  it("[mutant this kills] a synthetic THIRD migration re-granting update(attempts) after the real revoke would flip the real assertion below from passing to failing", () => {
    const mutantThirdFile = "grant update (attempts) on table public.interview_prep_spend to authenticated;";
    const state = replayTableGrants([...orderedTexts, mutantThirdFile]);
    const privs = [...(state.get("public.interview_prep_spend|authenticated") || [])];
    // The mutant reopens exactly the column this migration closed -- proving
    // the real assertion below is sensitive to this, not vacuously true.
    expect(privs).not.toEqual(["select"]);
    expect(privs).toContain("update(attempts)");
  });

  it("[mutant this kills] an intervening `revoke execute on function ...;` statement between two real table grants does not bleed into either one's privilege list", () => {
    const state = replayTableGrants([
      "grant insert on table public.t to r;",
      "revoke execute on function public.f(uuid) from public;\nrevoke insert on table public.t from r;",
    ]);
    expect([...(state.get("public.t|r") || [])]).toEqual([]);
  });

  it("[control] parsing a column-scoped grant/revoke pair in isolation resolves to empty, proving the extractor understands column scope, not just bare privilege names", () => {
    const state = replayTableGrants([
      "grant update (a, b) on table public.t to r;",
      "revoke update (a, b) on table public.t from r;",
    ]);
    expect([...(state.get("public.t|r") || [])]).toEqual([]);
  });

  it("(public.interview_prep_spend, authenticated) resolves to exactly {select} after replaying every real migration in order", () => {
    const state = replayTableGrants(orderedTexts);
    const privs = [...(state.get("public.interview_prep_spend|authenticated") || [])];
    expect(privs.sort()).toEqual(["select"]);
  });

  it("service_role keeps grant all on interview_prep_spend, unaffected by authenticated's narrowing", () => {
    const state = replayTableGrants(orderedTexts);
    const privs = [...(state.get("public.interview_prep_spend|service_role") || [])];
    expect(privs).toEqual(["all"]);
  });

  it("the linkage test -- the ORIGINAL file still asserts the stale grant text; the two states must DISAGREE, or a future edit to 20260914000000 silencing the historical test would go unnoticed", () => {
    expect(originalStripped).toContain("grant update (attempts, updated_at)");
    const state = replayTableGrants(orderedTexts);
    const privs = [...(state.get("public.interview_prep_spend|authenticated") || [])];
    expect(privs.some((p) => p.startsWith("update"))).toBe(false);

    // MINOR-K: same linkage, for the SECURITY MODE -- interviewPrepMigrationShape.test.js
    // (:150-154) deliberately scopes to ORIGINAL_MIGRATION alone and asserts
    // `security invoker` there, a fact this suite's own replay supersedes to
    // DEFINER below. Previously tied only by a comment in that file's test
    // title; asserted TOGETHER here so the two can never drift unnoticed.
    expect(originalStripped).toMatch(/security invoker/i);
    const def = lastFunctionDefinition(orderedTexts, "claim_prep_pack_slot");
    expect(def, "claim_prep_pack_slot not found").not.toBeNull();
    expect(def.preamble).toMatch(/security definer/i);
  });
});

describe("grant replay -- table grants recognised in every legal Postgres spelling, not just this file's own happy-path shape", () => {
  it("[canary] the TABLE keyword is optional -- 'grant select on public.t to r;' is recognised", () => {
    const state = replayTableGrants(["grant select on public.t to r;"]);
    expect([...(state.get("public.t|r") || [])]).toEqual(["select"]);
  });

  it("[control] the repo's OWN multi-role grant (20260609010000_feed_grants.sql:12, 'to anon, authenticated') is parsed as two role entries, not dropped entirely", () => {
    const state = replayTableGrants(["grant select on table public.feed_postings to anon, authenticated;"]);
    expect([...(state.get("public.feed_postings|anon") || [])]).toEqual(["select"]);
    expect([...(state.get("public.feed_postings|authenticated") || [])]).toEqual(["select"]);
  });

  it("[canary] a multi-table list ('on table a, b') applies to every named table", () => {
    const state = replayTableGrants(["grant select on table public.a, public.b to r;"]);
    expect([...(state.get("public.a|r") || [])]).toEqual(["select"]);
    expect([...(state.get("public.b|r") || [])]).toEqual(["select"]);
  });

  it("[canary] a trailing WITH GRANT OPTION does not get swallowed into the role name", () => {
    const state = replayTableGrants(["grant select on table public.t to r with grant option;"]);
    expect([...(state.get("public.t|r") || [])]).toEqual(["select"]);
  });

  it("[canary] a trailing CASCADE (a revoke-only modifier) does not get swallowed into the role name", () => {
    const state = replayTableGrants([
      "grant select on table public.t to r;",
      "revoke select on table public.t from r cascade;",
    ]);
    expect([...(state.get("public.t|r") || [])]).toEqual([]);
  });

  it('[canary] a quoted role ("r") is normalised to its unquoted lower-case form', () => {
    const state = replayTableGrants(['grant select on table public.t to "r";']);
    expect([...(state.get("public.t|r") || [])]).toEqual(["select"]);
  });

  it("[canary] an unqualified table name defaults to the public schema, matching how Postgres itself resolves it via search_path", () => {
    const state = replayTableGrants(["grant select on table t to r;"]);
    expect([...(state.get("public.t|r") || [])]).toEqual(["select"]);
  });

  it("[canary] a grant/revoke hidden inside a do $$ ... execute '...'; ... end $$; dynamic-SQL block is still parsed", () => {
    const state = replayTableGrants(["do $$\nbegin\n  execute 'grant select on table public.t to r';\nend\n$$;"]);
    expect([...(state.get("public.t|r") || [])]).toEqual(["select"]);
  });

  it("[canary] a bare 'revoke update ...' (no column list) ALSO revokes an already-held column-scoped update grant -- matching real Postgres REVOKE semantics, not literal token equality", () => {
    const state = replayTableGrants([
      "grant update (a, b) on table public.t to r;",
      "revoke update on table public.t from r;",
    ]);
    expect([...(state.get("public.t|r") || [])]).toEqual([]);
  });

  it("[mutant this kills] the bare-revoke cascade above must NOT touch a DIFFERENT verb's column-scoped grant", () => {
    const state = replayTableGrants([
      "grant update (a) on table public.t to r;",
      "grant references (a) on table public.t to r;",
      "revoke update on table public.t from r;",
    ]);
    expect([...(state.get("public.t|r") || [])]).toEqual(["references(a)"]);
  });

  describe("[mutant this kills, once per legal spelling] a synthetic third migration re-granting UPDATE on public.interview_prep_spend to authenticated, spelled seven different LEGAL ways, each flips the real assertion above from {select} to including update", () => {
    function expectMutantCaught(mutantStatement) {
      const state = replayTableGrants([...orderedTexts, mutantStatement]);
      const privs = [...(state.get("public.interview_prep_spend|authenticated") || [])].sort();
      expect(privs).not.toEqual(["select"]);
      expect(privs).toContain("update");
    }

    it("no ON TABLE keyword", () => {
      expectMutantCaught("grant update on public.interview_prep_spend to authenticated;");
    });

    it("multi-role ('to anon, authenticated')", () => {
      expectMutantCaught("grant update on table public.interview_prep_spend to anon, authenticated;");
    });

    it("multi-table ('on table a, interview_prep_spend')", () => {
      expectMutantCaught(
        "grant update on table public.zzz_unrelated, public.interview_prep_spend to authenticated;",
      );
    });

    it("WITH GRANT OPTION suffix", () => {
      expectMutantCaught("grant update on table public.interview_prep_spend to authenticated with grant option;");
    });

    it("a quoted role", () => {
      expectMutantCaught('grant update on table public.interview_prep_spend to "authenticated";');
    });

    it("an unqualified table name", () => {
      expectMutantCaught("grant update on table interview_prep_spend to authenticated;");
    });

    it("a do $$ ... execute '...' ... $$ dynamic-SQL block", () => {
      expectMutantCaught(
        "do $$\nbegin\n  execute 'grant update on table public.interview_prep_spend to authenticated';\nend\n$$;",
      );
    });
  });
});

describe("grant replay -- expandPrivilege's ALL shorthand matches real Postgres REVOKE semantics (minor-9)", () => {
  it("[mutant this kills] 'revoke all on table t from r' after a column-scoped grant removes it -- REVOKE ALL removes literally everything, not just entries that begin with 'all('", () => {
    const state = replayTableGrants([
      "grant update (a, b) on table public.t to r;",
      "revoke all on table public.t from r;",
    ]);
    expect([...(state.get("public.t|r") || [])]).toEqual([]);
  });

  it("[mutant this kills] 'revoke all privileges' (the two-word GRANT/REVOKE-synopsis spelling) removes everything too, not nothing", () => {
    const state = replayTableGrants([
      "grant select on table public.t to r;",
      "revoke all privileges on table public.t from r;",
    ]);
    expect([...(state.get("public.t|r") || [])]).toEqual([]);
  });

  it("[mutant this kills] 'grant all' then 'revoke select' narrows ALL down to its remaining components, not left as a bare 'all' that still (wrongly) covers select", () => {
    const state = replayTableGrants([
      "grant all on table public.t to r;",
      "revoke select on table public.t from r;",
    ]);
    const privs = [...(state.get("public.t|r") || [])].sort();
    expect(privs).not.toContain("all");
    expect(privs).not.toContain("select");
    expect(privs).toEqual(["delete", "insert", "references", "trigger", "truncate", "update"]);
  });

  it("[control] 'grant all privileges' behaves exactly like bare 'grant all', proving both spellings normalise to the same token", () => {
    const state = replayTableGrants(["grant all privileges on table public.t to r;"]);
    expect([...(state.get("public.t|r") || [])]).toEqual(["all"]);
  });
});

describe("grant replay -- 'on all tables in schema <s>' fans privileges across every table already seen there (MAJOR-5)", () => {
  it("[canary] fans a schema-wide grant across every table already seen in that schema, by role", () => {
    const state = replayTableGrants([
      "grant select on table public.a to r;",
      "grant select on table public.b to r;",
      "grant update on all tables in schema public to r;",
    ]);
    expect([...(state.get("public.a|r") || [])].sort()).toEqual(["select", "update"]);
    expect([...(state.get("public.b|r") || [])].sort()).toEqual(["select", "update"]);
  });

  it("[canary] a schema-wide grant does not reach a table in a DIFFERENT schema", () => {
    const state = replayTableGrants([
      "grant select on table other.c to r;",
      "grant update on all tables in schema public to r;",
    ]);
    expect([...(state.get("other.c|r") || [])]).toEqual(["select"]);
  });

  it("[mutant this kills] a synthetic schema-wide re-grant of UPDATE on the whole public schema reaches interview_prep_spend too, not just a silently-keyed literal table named 'all tables in schema public'", () => {
    const state = replayTableGrants([
      ...orderedTexts,
      "grant update on all tables in schema public to authenticated;",
    ]);
    const privs = [...(state.get("public.interview_prep_spend|authenticated") || [])].sort();
    expect(privs).not.toEqual(["select"]);
    expect(privs).toContain("update");
    // The old, wrong behaviour keyed this shape as a literal table -- prove
    // that key is gone, not merely that a correct one was added alongside it.
    expect(state.has("public.all tables in schema public|authenticated")).toBe(false);
  });
});

describe("grant replay -- a string literal's contents cannot fabricate a real grant (MAJOR-3)", () => {
  it("[canary] a prose string literal naming a real grant on a real table does NOT change that table's replayed state", () => {
    const beforePrivs = [...(replayTableGrants(orderedTexts).get("public.interview_prep_spend|authenticated") || [])].sort();
    const withFabrication = replayTableGrants([
      ...orderedTexts,
      "select 'housekeeping note: grant update on table public.interview_prep_spend to authenticated; do not do this';",
    ]);
    const afterPrivs = [...(withFabrication.get("public.interview_prep_spend|authenticated") || [])].sort();
    expect(afterPrivs).toEqual(beforePrivs);
  });

  it("[canary] a format()-style dynamic-SQL template naming a placeholder table does not mine a phantom grant, proven against the real repo shape (20260630000000_tailor_library.sql:119)", () => {
    const state = replayTableGrants([
      "do $$\nbegin\n  execute format('grant select, insert, update, delete on table public.%I to authenticated;', 'x');\nend\n$$;",
    ]);
    expect(state.size).toBe(0);
  });
});

describe("grant replay -- BLOCKER-A: a DOLLAR-QUOTED format() template is blanked too, not just a single-quoted one", () => {
  it.each(["$$", "$q$", "$p$"])(
    "[canary] a %s...%s-tagged format() template naming a placeholder table does not mine a phantom grant",
    (tag) => {
      const state = replayTableGrants([`execute format(${tag}grant select on table public.%I to authenticated;${tag}, 'x');`]);
      expect(state.size).toBe(0);
    },
  );

  it("[mutant this kills] this repo's OWN dollar-quoted spelling (20260630000000_tailor_library.sql:108,111,114,117 -- execute format($p$...$p$, t, t)), with a literal grant clause, does not mine a phantom grant", () => {
    const state = replayTableGrants([
      "execute format($p$grant select, insert, update, delete on table public.%I to authenticated;$p$, 'x');",
    ]);
    expect(state.size).toBe(0);
  });

  it("[canary] the genuine, non-format() dollar-quoted dynamic-SQL idiom (execute $tag$...$tag$) is still LIFTED, not blanked away -- blanking one spelling must not break the other", () => {
    const state = replayTableGrants(["do $$\nbegin\n  execute $q$grant select on table public.t to r$q$;\nend\n$$;"]);
    expect([...(state.get("public.t|r") || [])]).toEqual(["select"]);
  });
});

describe("grant replay -- BLOCKER-B: a format() call naming a TRACKED table literally throws instead of vanishing silently", () => {
  it("[control] the real migration corpus never trips this guard", () => {
    expect(() => replayTableGrants(orderedTexts)).not.toThrow();
  });

  it.each(TRACKED_GRANT_TABLES)(
    "[mutant this kills] a format() grant naming public.%s literally, with only the role templated, throws",
    (table) => {
      const mutant = `do $$ begin execute format('grant update on table public.${table} to %I;', 'authenticated'); end $$;`;
      expect(() => replayTableGrants([...orderedTexts, mutant])).toThrow(new RegExp(table));
    },
  );

  it("[canary] a format() call templating BOTH the table and the role (this repo's own real shape) does not throw", () => {
    expect(() =>
      replayTableGrants([
        "execute format('grant update on table public.%I to %I;', 'interview_prep_spend', 'authenticated');",
      ]),
    ).not.toThrow();
  });
});

describe("grant replay -- the (?!function\\b|routine\\b) lookahead is real-shaped, not merely correct-by-luck (minor-7)", () => {
  it("[canary] 'functions', 'functions_audit', and 'function_log' are recognised as ordinary tables, not wrongly excluded by the lookahead", () => {
    for (const name of ["functions", "functions_audit", "function_log"]) {
      const state = replayTableGrants([`grant select on ${name} to r;`]);
      expect([...(state.get(`public.${name}|r`) || [])]).toEqual(["select"]);
    }
  });

  it("[canary] 'on function'/'on routine' targets are correctly excluded, not matched as a table literally named 'function'/'routine'", () => {
    const state = replayTableGrants(["grant execute on function public.f(uuid) to r;"]);
    expect(state.size).toBe(0);
  });
});

describe("grant replay -- a malformed to/from pairing is rejected, not half-applied (minor-8)", () => {
  it("[canary] 'grant ... from r' (wrong direction) is ignored, not applied as a grant", () => {
    const state = replayTableGrants(["grant select on table public.t from r;"]);
    expect(state.has("public.t|r")).toBe(false);
  });

  it("[canary] 'revoke ... to r' (wrong direction) is ignored, not applied as a revoke", () => {
    const state = replayTableGrants([
      "grant select on table public.t to r;",
      "revoke select on table public.t to r;",
    ]);
    expect([...(state.get("public.t|r") || [])]).toEqual(["select"]);
  });
});

// ===========================================================================
// Security-mode replay: the LAST `create or replace function public.<name>(`
// across every migration, in order, wins.
// ===========================================================================

describe("security-mode replay -- the LAST create-or-replace wins", () => {
  it("[canary] a nonexistent function name is not found -- absence is real, not a broken anchor", () => {
    expect(lastFunctionDefinition(orderedTexts, "nonexistent_function_xyz")).toBeNull();
  });

  it("[control] prune_feed_postings -- a real, independently-authored, unrelated SECURITY DEFINER function -- is DEFINER with a NAMED (non-empty-string) search_path, proving the extractor tells the two apart rather than matching on 'search_path' loosely", () => {
    const def = lastFunctionDefinition(orderedTexts, RETENTION_FUNCTION);
    expect(def, `${RETENTION_FUNCTION} not found`).not.toBeNull();
    expect(def.preamble).toMatch(/security definer/i);
    expect(def.preamble).not.toMatch(/security invoker/i);
    expect(def.preamble).not.toMatch(/set\s+search_path\s*=\s*''/);
    // Independently confirm this control really is defined in the file this
    // suite expects, so a passing result above cannot be an accidental match
    // against some other function.
    const raw = readFileSync(path.join(MIGRATIONS_DIR, RETENTION_MIGRATION), "utf8");
    expect(stripSqlComments(raw)).toContain(`function public.${RETENTION_FUNCTION}(`);
  });

  it("claim_prep_pack_slot's EFFECTIVE definition is SECURITY DEFINER with search_path pinned to '' -- the ORIGINAL file's own SECURITY INVOKER text is superseded by a later create-or-replace", () => {
    const def = lastFunctionDefinition(orderedTexts, "claim_prep_pack_slot");
    expect(def, "claim_prep_pack_slot not found").not.toBeNull();
    expect(def.preamble).toMatch(/security definer/i);
    expect(def.preamble).not.toMatch(/security invoker/i);
    expect(def.preamble).toMatch(/set\s+search_path\s*=\s*''/);
  });

  it("record_prep_model_call's EFFECTIVE definition is (still) SECURITY DEFINER with search_path pinned to '' -- unchanged across the two migrations", () => {
    const def = lastFunctionDefinition(orderedTexts, "record_prep_model_call");
    expect(def, "record_prep_model_call not found").not.toBeNull();
    expect(def.preamble).toMatch(/security definer/i);
    expect(def.preamble).not.toMatch(/security invoker/i);
    expect(def.preamble).toMatch(/set\s+search_path\s*=\s*''/);
  });
});

describe("security-mode replay -- MAJOR-C: a prose string literal cannot fabricate a function-definition anchor", () => {
  it("[mutant this kills] a later prose sentence containing the real anchor text must not shadow the true, earlier definition", () => {
    const prose =
      "select 'note: create or replace function public.claim_prep_pack_slot( is unchanged here' as note; do $$ begin null; end $$;";
    const def = lastFunctionDefinition([...orderedTexts, prose], "claim_prep_pack_slot");
    expect(def).not.toBeNull();
    expect(def.preamble).toMatch(/security definer/i);
  });

  it("[canary] the SAME anchor text, as a REAL create-or-replace rather than prose, is found and DOES win as the latest definition", () => {
    const real =
      "create or replace function public.claim_prep_pack_slot(a uuid) returns void language sql security invoker as $$ select 1 $$;";
    const def = lastFunctionDefinition([...orderedTexts, real], "claim_prep_pack_slot");
    expect(def).not.toBeNull();
    expect(def.preamble).toMatch(/security invoker/i);
  });
});

// ===========================================================================
// Final-body assertions on claim_prep_pack_slot's EFFECTIVE definition.
// ===========================================================================

describe("claim_prep_pack_slot's effective body", () => {
  let body;
  beforeAll(() => {
    const def = lastFunctionDefinition(orderedTexts, "claim_prep_pack_slot");
    body = def && def.body;
  });

  it("[control] a body was actually found", () => {
    expect(body).not.toBeNull();
    expect(typeof body).toBe("string");
    expect(body.length).toBeGreaterThan(50);
  });

  it("[K2-RPC, schema-qualified variant, reused from lib/interviewPrep/interviewPrepMigrationShape.test.js's own qualifiedTables regex] every `from`/`insert into`/`update` target that IS schema-qualified names only applications, interview_prep_packs or interview_prep_spend", () => {
    const re = /\b(?:from|insert\s+into|update)\s+public\.(\w+)\b/gi;
    const tables = new Set();
    let m;
    while ((m = re.exec(body))) tables.add(m[1].toLowerCase());
    expect(tables.size).toBeGreaterThan(0);
    for (const t of tables) expect(["applications", "interview_prep_packs", "interview_prep_spend"]).toContain(t);
  });

  it("no BARE, unqualified `from`/`insert into`/`update` table reference survives -- every real table target is public.-qualified (the ON CONFLICT correlation names below are deliberately excluded from this check, since they are not preceded by from/insert into/update)", () => {
    const re = /\b(?:from|insert\s+into|update)\s+(interview_prep_\w+|applications)\b/gi;
    expect(re.test(body)).toBe(false);
  });

  it("[canary] the bare-reference regex is capable of matching a real, unqualified reference", () => {
    expect(/\b(?:from|insert\s+into|update)\s+(interview_prep_\w+|applications)\b/i.test(
      "select 1 from interview_prep_spend;",
    )).toBe(true);
  });

  it("an existence check against public.applications requires user_id = auth.uid(), before any write", () => {
    const existsIdx = body.search(/not\s+exists\s*\(\s*select[^)]*public\.applications[^)]*user_id\s*=\s*auth\.uid\(\)/i);
    expect(existsIdx, "no ownership existence check against public.applications found").toBeGreaterThanOrEqual(0);
    const firstInsertIdx = body.indexOf("insert into public.interview_prep_packs");
    expect(firstInsertIdx).toBeGreaterThan(-1);
    expect(existsIdx).toBeLessThan(firstInsertIdx);
  });

  it("the spend upsert's ON CONFLICT DO UPDATE carries `where interview_prep_spend.user_id = auth.uid()` -- the WHERE clause the ORIGINAL invoker version never needed", () => {
    const spendInsertIdx = body.indexOf("insert into public.interview_prep_spend");
    expect(spendInsertIdx).toBeGreaterThan(-1);
    const spendClause = body.slice(spendInsertIdx);
    expect(spendClause).toMatch(/on conflict\s*\(application_id\)\s*do update[\s\S]*?where\s+interview_prep_spend\.user_id\s*=\s*auth\.uid\(\)/i);
  });

  it("no p_user_id parameter or reference exists anywhere in the effective body", () => {
    expect(body).not.toMatch(/p_user_id/i);
  });
});

// ===========================================================================
// Execute-grant replay: PUBLIC's implicit default (Postgres grants EXECUTE
// to PUBLIC on function creation) is only overridden by an EXPLICIT revoke
// somewhere in the replayed sequence.
// ===========================================================================

describe("execute-grant replay -- both functions exclude PUBLIC, include authenticated, in the end", () => {
  it("[canary] a nonexistent function is never seeded and resolves to null", () => {
    expect(replayFunctionExecute(orderedTexts, "nonexistent_fn_xyz", "public.nonexistent_fn_xyz(uuid)")).toBeNull();
  });

  it("[control] before the lockdown migration, the ORIGINAL file alone leaves PUBLIC's default execute untouched -- the second gap this migration closes", () => {
    const state = replayFunctionExecute([originalRaw], "claim_prep_pack_slot", "public.claim_prep_pack_slot(uuid, uuid, timestamptz)");
    expect(state).not.toBeNull();
    expect(state.get("public")).toBe(true);
  });

  it("claim_prep_pack_slot(uuid, uuid, timestamptz): PUBLIC excluded, authenticated included, after replaying every real migration", () => {
    const state = replayFunctionExecute(orderedTexts, "claim_prep_pack_slot", "public.claim_prep_pack_slot(uuid, uuid, timestamptz)");
    expect(state).not.toBeNull();
    expect(state.get("public")).toBe(false);
    expect(state.get("authenticated")).toBe(true);
  });

  it("record_prep_model_call(uuid): PUBLIC excluded, authenticated included, after replaying every real migration", () => {
    const state = replayFunctionExecute(orderedTexts, "record_prep_model_call", "public.record_prep_model_call(uuid)");
    expect(state).not.toBeNull();
    expect(state.get("public")).toBe(false);
    expect(state.get("authenticated")).toBe(true);
  });

  it("[control] prune_feed_postings(integer) -- an independently-authored function this suite does not own -- excludes PUBLIC via an explicit 'revoke ALL ... from public', never the literal word 'execute'; a parser requiring that literal word (this file's own state before item 1's fix) reports this control WRONG -- RED against that parser, GREEN now", () => {
    const state = replayFunctionExecute(orderedTexts, "prune_feed_postings", "public.prune_feed_postings(integer)");
    expect(state).not.toBeNull();
    expect(state.get("public")).toBe(false);
    expect(state.get("anon")).toBe(false);
    expect(state.get("authenticated")).toBe(false);
    expect(state.get("service_role")).toBe(true);
  });

  it("[canary] 'grant all on function' is recognised, not just 'grant execute'", () => {
    const state = replayFunctionExecute(
      [
        "create or replace function public.foo(a uuid) returns void language sql as $$ select 1 $$;",
        "grant all on function public.foo(uuid) to authenticated;",
      ],
      "foo",
      "public.foo(uuid)",
    );
    expect(state.get("authenticated")).toBe(true);
  });

  it("[canary] 'on routine' is recognised, not just 'on function'", () => {
    const state = replayFunctionExecute(
      [
        "create or replace function public.foo(a uuid) returns void language sql as $$ select 1 $$;",
        "revoke execute on routine public.foo(uuid) from public;",
      ],
      "foo",
      "public.foo(uuid)",
    );
    expect(state.get("public")).toBe(false);
  });

  it("[canary] a signature with no spaces between arguments still matches the spaced signature it was declared with", () => {
    const state = replayFunctionExecute(
      [
        "create or replace function public.foo(a uuid, b uuid) returns void language sql as $$ select 1 $$;",
        "revoke execute on function public.foo(uuid,uuid) from public;",
      ],
      "foo",
      "public.foo(uuid, uuid)",
    );
    expect(state.get("public")).toBe(false);
  });

  it("[canary] a named-argument signature (e.g. 'p_id uuid') still matches the bare-type signature it was declared with -- a function's identity is its argument TYPES, never the parameter names", () => {
    const state = replayFunctionExecute(
      [
        "create or replace function public.foo(p_id uuid) returns void language sql as $$ select 1 $$;",
        "revoke execute on function public.foo(p_id uuid) from public;",
      ],
      "foo",
      "public.foo(uuid)",
    );
    expect(state.get("public")).toBe(false);
  });

  it("[canary] a multi-role list ('to anon, authenticated') updates every named role, not just the first", () => {
    const state = replayFunctionExecute(
      [
        "create or replace function public.foo(a uuid) returns void language sql as $$ select 1 $$;",
        "grant execute on function public.foo(uuid) to anon, authenticated;",
      ],
      "foo",
      "public.foo(uuid)",
    );
    expect(state.get("anon")).toBe(true);
    expect(state.get("authenticated")).toBe(true);
  });

  it("[mutant this kills] a synthetic THIRD migration re-granting execute to public on claim_prep_pack_slot would flip the real assertion above from passing to failing", () => {
    const mutantThirdFile =
      "grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to public;";
    const state = replayFunctionExecute(
      [...orderedTexts, mutantThirdFile],
      "claim_prep_pack_slot",
      "public.claim_prep_pack_slot(uuid, uuid, timestamptz)",
    );
    expect(state.get("public")).toBe(true);
  });
});

describe("execute-grant replay -- MAJOR-C: a prose string literal cannot fabricate or swallow a real revoke", () => {
  const SIG = "public.claim_prep_pack_slot(uuid, uuid, timestamptz)";

  it("[mutant this kills] a prose sentence quoting the real anon/public revoke must not read as though the revoke happened", () => {
    const prose =
      "select 'we revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from public; someday';";
    const withoutLockdown = textsExcludingFile(migrationFiles, orderedTexts, LOCKDOWN_MIGRATION);
    const state = replayFunctionExecute([...withoutLockdown, prose], "claim_prep_pack_slot", SIG);
    expect(state.get("public")).toBe(true);
  });

  it("[canary] the SAME text, as a REAL statement rather than prose, does flip PUBLIC to false -- proving the prose test above is sensitive, not vacuous", () => {
    const real = "revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from public;";
    const withoutLockdown = textsExcludingFile(migrationFiles, orderedTexts, LOCKDOWN_MIGRATION);
    const state = replayFunctionExecute([...withoutLockdown, real], "claim_prep_pack_slot", SIG);
    expect(state.get("public")).toBe(false);
  });
});

describe("execute-grant replay -- BLOCKER-1: two more legal re-grant spellings, proven against the REAL claim_prep_pack_slot key, not a synthetic public.foo fixture", () => {
  const REAL_SIG = "public.claim_prep_pack_slot(uuid, uuid, timestamptz)";

  it("[mutant this kills] 'grant all privileges on function ...' (Postgres's own GRANT/REVOKE synopsis spelling) re-opens PUBLIC on the real function", () => {
    const mutantThirdFile =
      "grant all privileges on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to public;";
    const state = replayFunctionExecute([...orderedTexts, mutantThirdFile], "claim_prep_pack_slot", REAL_SIG);
    expect(state.get("public")).toBe(true);
  });

  it("[mutant this kills] a $tag$-dollar-quoted dynamic-SQL re-grant on the real function is not swallowed into a garbled 'public$q$' role name", () => {
    const mutantThirdFile =
      "do $$ begin execute $q$grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to public$q$; end $$;";
    const state = replayFunctionExecute([...orderedTexts, mutantThirdFile], "claim_prep_pack_slot", REAL_SIG);
    expect(state.get("public")).toBe(true);
  });
});

describe("execute-grant replay -- a malformed to/from pairing is rejected, not half-applied (minor-8)", () => {
  it("[mutant this kills] 'revoke execute on function ... to public;' (wrong direction) must NOT be applied as a revoke", () => {
    const state = replayFunctionExecute(
      [
        "create or replace function public.foo(a uuid) returns void language sql as $$ select 1 $$;",
        "revoke execute on function public.foo(uuid) to public;",
      ],
      "foo",
      "public.foo(uuid)",
    );
    // PUBLIC's default grant (seeded true on creation) must survive -- this
    // statement is not valid Postgres grammar and must be ignored, not
    // half-applied as though it correctly meant revoke.
    expect(state.get("public")).toBe(true);
  });

  it("[canary] 'grant execute on function ... from public;' (wrong direction) must NOT be applied as a grant", () => {
    const state = replayFunctionExecute(
      [
        "create or replace function public.foo(a uuid) returns void language sql as $$ select 1 $$;",
        "revoke execute on function public.foo(uuid) from public;",
        "grant execute on function public.foo(uuid) from public;",
      ],
      "foo",
      "public.foo(uuid)",
    );
    expect(state.get("public")).toBe(false);
  });
});

// ===========================================================================
// anon: a bare `revoke ... from public` narrows the DEFAULT PUBLIC-wide
// grant, but does NOT remove an explicit grant a MORE SPECIFIC role such as
// `anon` might separately hold -- so naming `public` alone in the lockdown
// migration would not actually prove `anon` has no path to either function
// or to interview_prep_spend. Both precedents this file's own header cites
// revoke `anon` as its own, separate statement:
// 20260612000000_feed_postings_retention.sql:33-34 (`from public;` AND
// `from anon, authenticated;`) and
// 20260908000000_positions_policy_hardening.sql:274 (`revoke all on table
// public.positions from anon;`). Asserted here as a source-text presence
// check, not a replay -- these are independent statements the migration
// either contains or does not, not a sequence a later file could override.
// ===========================================================================

describe("the lockdown migration explicitly revokes anon, not only public/authenticated", () => {
  it("[canary] the presence check below is capable of failing -- a text missing the anon revoke does not match", () => {
    const noAnon = "revoke execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) from public;";
    expect(noAnon).not.toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.claim_prep_pack_slot\([^)]*\)\s+from\s+anon\s*;/i,
    );
  });

  it("revokes claim_prep_pack_slot's execute grant from anon explicitly", () => {
    expect(lockdownStripped).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.claim_prep_pack_slot\([^)]*\)\s+from\s+anon\s*;/i,
    );
  });

  it("revokes record_prep_model_call's execute grant from anon explicitly", () => {
    expect(lockdownStripped).toMatch(
      /revoke\s+execute\s+on\s+function\s+public\.record_prep_model_call\([^)]*\)\s+from\s+anon\s*;/i,
    );
  });

  it("revokes every table privilege on interview_prep_spend from anon explicitly", () => {
    expect(lockdownStripped).toMatch(/revoke\s+all\s+on\s+table\s+public\.interview_prep_spend\s+from\s+anon\s*;/i);
  });
});

// ===========================================================================
// Cleanup (OWNER RULING, 2026-09-15): claim_prep_pack_slot's new ownership
// check makes a cross-tenant row created via the still-open N12 hole
// PERMANENTLY unclaimable once the DEFINER function below is live, so the
// migration must clean those rows up FIRST. This is a pure source-text
// parse -- it can prove the DELETE/GET DIAGNOSTICS/RAISE NOTICE statements
// exist and that they appear, in the file, BEFORE claim_prep_pack_slot's
// create-or-replace. It CANNOT prove that text order is execution order in
// general; it can only observe that THIS file has no explicit transaction
// control or conditional branching around these statements, so within this
// one file Postgres's own top-to-bottom execution of a simple-query batch
// makes the two coincide. No live Postgres is reachable from this checkout
// ([[schema-migration-drift]], [[windows-shell-environment]]) to confirm the
// cleanup actually runs, or how many rows it finds, on the live project.
// ===========================================================================

describe("the lockdown migration cleans up cross-tenant rows BEFORE replacing claim_prep_pack_slot", () => {
  const REPLACE_MARKER = "create or replace function public.claim_prep_pack_slot(";

  it("[canary] the ordering assertions below are sensitive to real ordering, not vacuously true", () => {
    const wrongOrder = `${REPLACE_MARKER}\ndelete from public.interview_prep_spend x;`;
    const rightOrder = `delete from public.interview_prep_spend x;\n${REPLACE_MARKER}`;
    const deleteIdx = (text) => text.search(/delete\s+from\s+public\.interview_prep_spend/i);
    const replaceIdx = (text) => text.indexOf(REPLACE_MARKER);
    expect(deleteIdx(wrongOrder)).toBeGreaterThan(replaceIdx(wrongOrder));
    expect(deleteIdx(rightOrder)).toBeLessThan(replaceIdx(rightOrder));
  });

  it("both cleanup deletes appear, IN THE SOURCE TEXT, before claim_prep_pack_slot's create-or-replace -- text order only, not proof of runtime order", () => {
    const spendDeleteIdx = lockdownStripped.search(/delete\s+from\s+public\.interview_prep_spend/i);
    const packsDeleteIdx = lockdownStripped.search(/delete\s+from\s+public\.interview_prep_packs/i);
    const replaceIdx = lockdownStripped.indexOf(REPLACE_MARKER);
    expect(spendDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(packsDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(replaceIdx).toBeGreaterThan(-1);
    expect(spendDeleteIdx).toBeLessThan(replaceIdx);
    expect(packsDeleteIdx).toBeLessThan(replaceIdx);
  });
});

// ===========================================================================
// BLOCKER-2: the two NAMED DELETE statements are guarded by their exact
// join and predicate, WITHIN the cleanup DO block, not by keyword presence
// anywhere in the file. Before this, `:827`'s `toContain("public.applications")`
// was satisfied by the unrelated `select 1 from public.applications` inside
// claim_prep_pack_slot's own ownership check 40-odd lines later, and nothing
// asserted the join predicate at all -- five corruptions (delete every row,
// cross join, `<>` flipped to `=`, an always-false self-reference, and a
// join to the wrong table entirely) all left the suite green. Fixed by
// slicing the DO block out first (extractCleanupBlock) and anchoring a
// single, fully-normalised regex against each table's own statement
// (extractDeleteStatement) -- this is destructive SQL with no other gate,
// so these are the deliverable, not incidental coverage.
//
// MAJOR-G CORRECTION: "guarded" above is true only of the two DELETEs it
// names -- extractDeleteStatement returns the FIRST match per table, so a
// THIRD destructive statement anywhere else in the block (another delete,
// a truncate, an update) went unseen. Closed below by
// extractDestructiveKeywords, whitelisting the block's shape to exactly
// those two DELETEs and nothing else.
// ===========================================================================

describe("the cleanup DELETE statements are guarded by their exact join and predicate (BLOCKER-2)", () => {
  let cleanupBlock;

  beforeAll(() => {
    cleanupBlock = extractCleanupBlock(lockdownStripped);
  });

  it("[control] the cleanup block was actually found and is non-trivial", () => {
    expect(cleanupBlock).not.toBeNull();
    expect(cleanupBlock.length).toBeGreaterThan(80);
  });

  it("the spend DELETE joins to applications on application_id and filters on a genuine user_id mismatch", () => {
    const stmt = extractDeleteStatement(cleanupBlock, "interview_prep_spend");
    expect(stmt).not.toBeNull();
    expect(stmt).toMatch(SPEND_DELETE_RE);
  });

  it("the packs DELETE joins to applications on application_id and filters on a genuine user_id mismatch", () => {
    const stmt = extractDeleteStatement(cleanupBlock, "interview_prep_packs");
    expect(stmt).not.toBeNull();
    expect(stmt).toMatch(PACKS_DELETE_RE);
  });

  /** Applies one corruption to the REAL lockdown migration's own text, then
   *  re-runs the exact same extraction pipeline the real assertions above
   *  use, and returns the spend DELETE it finds -- proving the corruption
   *  is caught by the real machinery, not a synthetic stand-in for it. */
  function spendStatementAfter(corruptionRe, replacement) {
    const corrupted = lockdownStripped.replace(corruptionRe, replacement);
    // Sanity: the corruption actually landed, or the assertion below would
    // pass vacuously against the unmodified real text.
    expect(corrupted).not.toEqual(lockdownStripped);
    const block = extractCleanupBlock(corrupted);
    return extractDeleteStatement(block, "interview_prep_spend");
  }

  it("[mutant this kills] 'where true' (deletes every row) is rejected", () => {
    const stmt = spendStatementAfter(
      /where\s+spend\.application_id\s*=\s*app\.id\s+and\s+spend\.user_id\s*<>\s*app\.user_id\s*;/i,
      "where true;",
    );
    expect(stmt).not.toMatch(SPEND_DELETE_RE);
  });

  it("[mutant this kills] dropping the application_id join predicate (cross join -- deletes rows belonging to any other user) is rejected", () => {
    const stmt = spendStatementAfter(
      /where\s+spend\.application_id\s*=\s*app\.id\s+and\s+(spend\.user_id\s*<>\s*app\.user_id)\s*;/i,
      "where $1;",
    );
    expect(stmt).not.toMatch(SPEND_DELETE_RE);
  });

  it("[mutant this kills] '<>' flipped to '=' (deletes exactly the LEGITIMATE rows) is rejected", () => {
    const stmt = spendStatementAfter(/spend\.user_id\s*<>\s*app\.user_id/i, "spend.user_id = app.user_id");
    expect(stmt).not.toMatch(SPEND_DELETE_RE);
  });

  it("[mutant this kills] a self-referencing predicate (always false; cleanup silently no-ops) is rejected", () => {
    const stmt = spendStatementAfter(/spend\.user_id\s*<>\s*app\.user_id/i, "spend.user_id <> spend.user_id");
    expect(stmt).not.toMatch(SPEND_DELETE_RE);
  });

  it("[mutant this kills] joining to interview_prep_packs instead of applications (wrong relation entirely) is rejected", () => {
    const stmt = spendStatementAfter(/using\s+public\.applications\s+app/i, "using public.interview_prep_packs app");
    expect(stmt).not.toMatch(SPEND_DELETE_RE);
  });

  it("MAJOR-6 (MAJOR-F: now aborts, not warns): relforcerowsecurity set on either table raises, so a genuinely-clean cleanup can be told apart from one silently filtered by RLS to 0 rows", () => {
    expect(cleanupBlock).toMatch(
      /select\s+relforcerowsecurity\s+into\s+v_spend_force_rls[\s\S]*'public\.interview_prep_spend'::regclass/i,
    );
    expect(cleanupBlock).toMatch(/raise exception\s+'interview_prep_spend has relforcerowsecurity set/i);
    expect(cleanupBlock).toMatch(
      /select\s+relforcerowsecurity\s+into\s+v_packs_force_rls[\s\S]*'public\.interview_prep_packs'::regclass/i,
    );
    expect(cleanupBlock).toMatch(/raise exception\s+'interview_prep_packs has relforcerowsecurity set/i);
  });

  it("MAJOR-6: the relforcerowsecurity checks run BEFORE either DELETE -- a force-RLS warning must not follow a misleadingly-clean '0 row(s) deleted' notice", () => {
    const forceRlsIdx = cleanupBlock.search(/relforcerowsecurity/i);
    const firstDeleteIdx = cleanupBlock.search(/delete\s+from\s+public\.interview_prep_spend/i);
    expect(forceRlsIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIdx).toBeGreaterThan(-1);
    expect(forceRlsIdx).toBeLessThan(firstDeleteIdx);
  });

  describe("MAJOR-G: the destructive-statement whitelist covers the block's own shape entirely, not just the first match per table", () => {
    it("[control] the whitelist passes on the REAL, unmodified block", () => {
      expect(extractDestructiveKeywords(cleanupBlock)).toEqual(["delete", "delete"]);
    });

    it.each(CLEANUP_BLOCK_EXTRA_DESTRUCTIVE_STATEMENTS)(
      "[mutant this kills] an extra destructive statement (%s) inserted into the block is caught",
      (stmt) => {
        const corrupted = insertAfterCleanupBegin(lockdownStripped, stmt);
        expect(corrupted).not.toEqual(lockdownStripped);
        expect(extractDestructiveKeywords(extractCleanupBlock(corrupted))).not.toEqual(["delete", "delete"]);
      },
    );
  });
});

describe("MAJOR-D: the force-RLS guard's condition, polarity, verb and message are pinned TOGETHER, not read separately", () => {
  it.each(["spend", "packs"])("[mutant this kills, control included] inverting the %s guard's polarity is caught", (v) => {
    const re = forceRlsGuardPattern(v);
    expect(lockdownStripped).toMatch(re);
    const mutated = lockdownStripped.replace(new RegExp(`if\\s+v_${v}_force_rls\\s+then`, "i"), `if not v_${v}_force_rls then`);
    expect(mutated).not.toEqual(lockdownStripped);
    expect(mutated).not.toMatch(re);
  });

  it.each(["spend", "packs"])(
    "[mutant this kills, control included] reverting MAJOR-F's ruling (raise exception -> raise warning) on the %s guard is caught",
    (v) => {
      const re = forceRlsGuardPattern(v);
      expect(lockdownStripped).toMatch(re);
      const mutated = lockdownStripped.replace(new RegExp(`(if\\s+v_${v}_force_rls\\s+then\\s+raise\\s+)exception`, "i"), "$1warning");
      expect(mutated).not.toEqual(lockdownStripped);
      expect(mutated).not.toMatch(re);
    },
  );
});

it("N22 wave-4: F1 (splice preserves intra-file order), F2 (the format() guard also covers tracked functions), F3 (format() caught without literal 'execute format('), F5 (destructive-keyword count runs over blanked text) and F6 ($$ delimiter search runs over blanked text) each have an executed mutant that fails without the fix and a no-op control that passes with it", () => {
  expect([...(replayTableGrants([...orderedTexts, "do $$ begin execute 'revoke update on table public.interview_prep_spend from authenticated'; end $$;\ngrant update on table public.interview_prep_spend to authenticated;"]).get("public.interview_prep_spend|authenticated") || [])].sort()).toEqual(["select", "update"]);
  expect(() => replayFunctionExecute([...orderedTexts, "do $$ begin execute format('grant execute on function public.claim_prep_pack_slot(uuid, uuid, timestamptz) to %I;', 'public'); end $$;"], "claim_prep_pack_slot", "public.claim_prep_pack_slot(uuid, uuid, timestamptz)")).toThrow(/claim_prep_pack_slot/);
  expect(() => replayTableGrants([...orderedTexts, "do $$ declare v_sql text; begin v_sql := format('grant update on table public.interview_prep_spend to %I;', 'authenticated'); execute v_sql; end $$;"])).toThrow(/interview_prep_spend/);
  for (const sql of ["execute format('drop policy if exists %I on public.interview_prep_packs;', 'x');", "execute format('grant select on table public.interview_prep_spend_audit to %I;', 'authenticated');"]) expect(() => replayTableGrants([sql])).not.toThrow();
  expect(lockdownStripped.replace("row(s) deleted', v_deleted_spend;", "row(s) dropped; no update was applied', v_deleted_spend;")).not.toEqual(lockdownStripped);
  expect(extractDestructiveKeywords(extractCleanupBlock(lockdownStripped.replace("row(s) deleted', v_deleted_spend;", "row(s) dropped; no update was applied', v_deleted_spend;")))).toEqual(["delete", "delete"]);
  expect(lastFunctionDefinition(["create or replace function public.foo(a uuid) returns void language plpgsql set search_path = '$$' as $$ begin null; end $$;"], "foo")?.body.trim()).toBe("begin null; end");
});
