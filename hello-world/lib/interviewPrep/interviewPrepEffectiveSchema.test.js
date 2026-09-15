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
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

const ORIGINAL_MIGRATION = "20260914000000_interview_prep.sql";
const LOCKDOWN_MIGRATION = "20260915000000_interview_prep_spend_lockdown.sql";

// An independently-authored function this suite does NOT own, used as the
// control for the security-mode replay below -- it predates IP3 entirely and
// no IP3 migration touches it.
const RETENTION_MIGRATION = "20260612000000_feed_postings_retention.sql";
const RETENTION_FUNCTION = "prune_feed_postings";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let migrationFiles = null;
let orderedTexts = null;
let originalRaw = null;
let originalStripped = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  orderedTexts = migrationFiles.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  originalRaw = readFileSync(path.join(MIGRATIONS_DIR, ORIGINAL_MIGRATION), "utf8");
  originalStripped = stripSqlComments(originalRaw);
});

describe("[control] the migrations directory was actually read and is non-trivial", () => {
  it("more than 10 migration files exist, lexicographically sorted", () => {
    expect(migrationFiles.length).toBeGreaterThan(10);
    expect(migrationFiles).toEqual([...migrationFiles].sort());
  });
});

describe("exactly the two known migrations touch interview_prep_spend", () => {
  // Comment-aware, matching this repo's own convention
  // (lib/applications/statusMigrationShape.test.js,
  // lib/supabase/applicationDigestsMigrationShape.test.js): a migration
  // naming this table only in prose must not count as "touches it".
  function mentionsSpendTable(sql) {
    return stripSqlComments(sql).includes("interview_prep_spend");
  }

  it("[canary] a prose-only mention (no real DDL) does not count", () => {
    const prose = "-- unlike interview_prep_spend, this table has no cap.\nselect 1;";
    expect(mentionsSpendTable(prose)).toBe(false);
  });

  it("[canary] a migration with real DDL referencing the table does count", () => {
    expect(mentionsSpendTable("alter table public.interview_prep_spend add column x int;")).toBe(true);
  });

  it("the matching set is exactly [ORIGINAL_MIGRATION, LOCKDOWN_MIGRATION] -- a third file fails loudly here", () => {
    const matching = migrationFiles.filter((f) => mentionsSpendTable(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")));
    expect(matching).toEqual([ORIGINAL_MIGRATION, LOCKDOWN_MIGRATION]);
  });
});

// ===========================================================================
// Grant replay: a privilege set per (table, role), built by applying every
// grant/revoke in every migration, IN FILE ORDER.
// ===========================================================================

/** Splits a privilege list on TOP-LEVEL commas only, so a column list inside
 *  `update (attempts, updated_at)` is not itself split. */
function splitPrivilegeList(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Expands one privilege clause ("select", "update (attempts, updated_at)")
 *  into atomic tokens ("select", "update(attempts)", "update(updated_at)") --
 *  a column-scoped grant/revoke is tracked per column, since that is exactly
 *  the granularity 20260915000000_interview_prep_spend_lockdown.sql's own
 *  column-scoped revoke needs to be told apart from a bare one. */
function expandPrivilege(clause) {
  const m = /^(\w+)\s*\(([^)]*)\)$/.exec(clause);
  if (!m) return [clause.toLowerCase()];
  const verb = m[1].toLowerCase();
  return m[2]
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .map((col) => `${verb}(${col})`);
}

/** Replays every `grant <privs> on table <table> to <role>;` and
 *  `revoke <privs> on table <table> from <role>;` statement across the given
 *  texts, IN ORDER, into a `Map<"table|role", Set<privilege>>`. This is the
 *  anti-rot mechanism a single-file `.toContain` cannot give: a later file's
 *  revoke actually removes what an earlier file granted. */
function replayTableGrants(texts) {
  const state = new Map();
  // The privilege-list capture is bounded to `[^;]+?` (no semicolon), not
  // `[\s\S]+?` -- a statement never contains one, but WITHOUT the bound a
  // non-greedy `[\s\S]+?` will happily cross an intervening
  // `grant/revoke execute on function ...;` statement (neither "on table"
  // nor terminated before the real target) to find the next "on table",
  // swallowing several unrelated statements into one garbled match. Verified
  // against this file's own migrations: `revoke execute on function
  // public.claim_prep_pack_slot(...) from public;` sits directly before
  // `revoke update (attempts, updated_at) on table ... from authenticated;`
  // in 20260915000000_interview_prep_spend_lockdown.sql, which reproduced
  // exactly that failure mode before this bound was added.
  const re = /\b(grant|revoke)\s+([^;]+?)\s+on table\s+([\w.]+)\s+(to|from)\s+(\w+)\s*;/gi;
  for (const text of texts) {
    const stripped = stripSqlComments(text);
    const localRe = new RegExp(re.source, re.flags);
    let m;
    while ((m = localRe.exec(stripped))) {
      const verb = m[1].toLowerCase();
      const direction = m[4].toLowerCase();
      if ((verb === "grant" && direction !== "to") || (verb === "revoke" && direction !== "from")) continue;
      const table = m[3].toLowerCase();
      const role = m[5].toLowerCase();
      const key = `${table}|${role}`;
      const set = state.get(key) || new Set();
      for (const clause of splitPrivilegeList(m[2].trim())) {
        for (const token of expandPrivilege(clause)) {
          if (verb === "grant") set.add(token);
          else set.delete(token);
        }
      }
      state.set(key, set);
    }
  }
  return state;
}

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
  });
});

// ===========================================================================
// Security-mode replay: the LAST `create or replace function public.<name>(`
// across every migration, in order, wins.
// ===========================================================================

/** Finds the LAST `create or replace function public.<name>(` occurrence
 *  across the given texts, in order (a later file's redefinition wins over
 *  an earlier one), and returns { preamble, body } -- preamble is everything
 *  from that occurrence up to the opening `$$`, body is everything between
 *  the `$$` delimiters. Returns null if the name is never defined. */
function lastFunctionDefinition(texts, name) {
  let found = null;
  const re = new RegExp(`create or replace function public\\.${name}\\s*\\(`, "gi");
  for (const text of texts) {
    const stripped = stripSqlComments(text);
    const localRe = new RegExp(re.source, re.flags);
    let m;
    let lastIdx = null;
    while ((m = localRe.exec(stripped))) lastIdx = m.index;
    if (lastIdx !== null) found = { stripped, idx: lastIdx };
  }
  if (!found) return null;
  const open = found.stripped.indexOf("$$", found.idx);
  if (open === -1) return null;
  const close = found.stripped.indexOf("$$", open + 2);
  if (close === -1) return null;
  return {
    preamble: found.stripped.slice(found.idx, open),
    body: found.stripped.slice(open + 2, close),
  };
}

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

/** Replays `grant execute on function <signature> to <role>;` /
 *  `revoke execute on function <signature> from <role>;` across the given
 *  texts, in order. Seeds `public -> true` the first time the function is
 *  CREATED (Postgres's own default), then applies every subsequent explicit
 *  grant/revoke on top. Returns null if the function is never created. */
function replayFunctionExecute(texts, functionName, signature) {
  let state = null;
  const createRe = new RegExp(`create or replace function public\\.${functionName}\\s*\\(`, "i");
  const grantRevokeRe = new RegExp(
    `(grant|revoke)\\s+execute\\s+on function\\s+${escapeRegExp(signature)}\\s+(to|from)\\s+(\\w+)\\s*;`,
    "gi",
  );
  for (const text of texts) {
    const stripped = stripSqlComments(text);
    if (state === null && createRe.test(stripped)) {
      state = new Map([["public", true]]);
    }
    if (state === null) continue;
    const localRe = new RegExp(grantRevokeRe.source, grantRevokeRe.flags);
    let m;
    while ((m = localRe.exec(stripped))) {
      const verb = m[1].toLowerCase();
      const role = m[3].toLowerCase();
      state.set(role, verb === "grant");
    }
  }
  return state;
}

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
});
