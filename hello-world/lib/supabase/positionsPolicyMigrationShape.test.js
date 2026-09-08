// The DDL shape of 20260908000000_positions_policy_hardening.sql, plus one
// directory-wide invariant that the defect it fixes cannot come back anywhere
// else.
//
// This is a source-text parse, not a live-database query. No Supabase project
// is reachable from this checkout, so nothing here can prove the migration was
// applied -- only that the repo's own declaration says the right thing. The
// technique and the discipline are copied from
// lib/supabase/experienceKnowledgeMigrationShape.test.js and
// lib/supabase/applicationDigestsMigrationShape.test.js: parse the
// comment-STRIPPED text (via lib/sourceScan/stripSqlComments.js) so prose can
// never be mistaken for DDL, pair every absence assertion with a positive
// control proving the checker finds the real thing when it is there, and put a
// mutation gate on every checker that would otherwise be able to pass by
// always returning the answer the test wants.
//
// ---------------------------------------------------------------------------
// THE INVARIANT, AND WHY IT IS WORTH A SWEEP RATHER THAN ONE ASSERTION
// ---------------------------------------------------------------------------
// In PostgreSQL an UPDATE policy with a USING expression and no WITH CHECK
// reuses USING for the new row (PostgreSQL 17, CREATE POLICY: "if no WITH
// CHECK expression is defined, then the USING expression will be used both to
// determine which rows are visible ... and which new rows will be allowed to
// be added"). That default is silent, it is invisible in the policy's own
// text, and it is wrong for essentially every policy anyone actually means to
// write:
//
//   * On a per-user table, `for update using (auth.uid() = user_id)` with no
//     WITH CHECK lets a user hand their own row to somebody else by writing a
//     different user_id into it. The row passes USING on the way in (it is
//     still theirs) and the implied WITH CHECK on the way out (evaluated
//     against... nothing that pins user_id to auth.uid() any more).
//   * On `positions` -- a shared table with no owner column at all -- the same
//     omission was total: the expression was `auth.role() = 'authenticated'`,
//     which names no column, so any signed-in account could rewrite any
//     posting to any value.
//
// So the sweep below asserts the universal form -- EVERY policy in this
// directory that can take a WITH CHECK actually declares one -- rather than
// only checking the one table that was found broken. Every existing migration
// already satisfies it (verified at the time of writing), which is what makes
// the universal form safe to assert rather than aspirational.
//
// "Can take a WITH CHECK" means FOR UPDATE and FOR ALL. It also means a
// `create policy` with NO `for` clause at all, because that defaults to FOR
// ALL -- a trap the sweep handles explicitly rather than skipping, since such
// a policy reads as harmless and governs every verb.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "../sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const MIGRATION_NAME = "20260908000000_positions_policy_hardening.sql";

const TABLE = "public.positions";

// The migration that granted `insert, update` on positions to `authenticated`.
// It is the thing being superseded, and it doubles as the positive control
// proving the grant-sweep below can see a real write grant when one exists.
const GRANTS_CONTROL_NAME = "20260610010000_positions_grants.sql";
// The repo's deliberately anon-readable table, cited in the ruling.
const PUBLIC_TABLE_CONTROL_NAME = "20260609010000_feed_grants.sql";
// A sibling with the correct four-policy owner-scoped shape.
const WITH_CHECK_CONTROL_NAME = "20260901000000_drive.sql";

function countOccurrences(haystack, needle) {
  if (needle instanceof RegExp) {
    const re = new RegExp(needle.source, needle.flags.includes("g") ? needle.flags : needle.flags + "g");
    return (haystack.match(re) || []).length;
  }
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// Splits comment-stripped SQL into `create policy ...;` statements.
//
// Scans to the terminating semicolon while tracking single-quoted string
// literals (with SQL's `''` escape), because a `;` inside a literal does not
// end a statement. That is not hypothetical here:
// 20260630000000_tailor_library.sql builds its policies inside
// `execute format('... ;', t)` calls, so an unquoted scan would cut its
// statements in the wrong place and could silently drop a `with check` off the
// end of one -- reporting a violation that is not there, or missing one that
// is.
function policyStatements(stripped) {
  const out = [];
  const re = /create\s+policy\b/gi;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    let i = m.index;
    let inStr = false;
    for (; i < stripped.length; i++) {
      const c = stripped[i];
      if (inStr) {
        if (c === "'") {
          if (stripped[i + 1] === "'") { i += 1; continue; }
          inStr = false;
        }
        continue;
      }
      if (c === "'") { inStr = true; continue; }
      if (c === ";") break;
    }
    out.push(stripped.slice(m.index, Math.min(i + 1, stripped.length)));
  }
  return out;
}

// The command a policy statement governs. Anchored AFTER the `on <table>`
// clause, because that is where SQL puts the `for` clause -- and because a
// bare search for /for/ would match the word inside a USING expression.
// Returns "all" when there is no `for` clause, which is what Postgres does.
function policyCommand(statement) {
  const afterOn = statement.replace(/^[\s\S]*?\bon\s+\S+/i, "");
  const m = afterOn.match(/\bfor\s+(all|select|insert|update|delete)\b/i);
  return m ? m[1].toLowerCase() : "all";
}

function policyTable(statement) {
  const m = statement.match(/\bon\s+(\S+)/i);
  return m ? m[1].replace(/;$/, "") : null;
}

function hasWithCheck(statement) {
  return /\bwith\s+check\b/i.test(statement);
}

// A policy needs an explicit WITH CHECK exactly when Postgres would otherwise
// silently substitute its USING expression for one.
function needsWithCheck(statement) {
  const cmd = policyCommand(statement);
  return cmd === "update" || cmd === "all";
}

function violatesInvariant(statement) {
  return needsWithCheck(statement) && !hasWithCheck(statement);
}

let files = null;
let raw = null;
let stripped = null;

beforeAll(() => {
  files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  raw = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_NAME), "utf8");
  stripped = stripSqlComments(raw);
});

describe("[src] 20260908000000_positions_policy_hardening.sql shape", () => {
  it("[control] the migrations directory and this migration were actually read", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain(MIGRATION_NAME);
    expect(raw.length).toBeGreaterThan(1000);
    expect(stripped.length).toBe(raw.length);
  });

  it("[canary] the header's quoted pg_policies output and example SQL are comment-stripped, so they cannot be parsed as DDL", () => {
    // The header quotes the live, BROKEN policy rows verbatim, and also shows
    // the `create policy ... to anon, authenticated` reversal it declines to
    // make. Both sit inside `--` comments. If stripping ever stopped working,
    // every sweep in this file would start reading the defect it documents as
    // if it were the DDL it declares -- so this is checked directly.
    expect(raw).toContain("positions_update_authenticated  UPDATE");
    expect(stripped).not.toContain("positions_update_authenticated  UPDATE");
    expect(raw).toContain("for select to anon, authenticated using (true)");
    expect(stripped).not.toContain("to anon, authenticated");
  });

  describe("the two permissive write policies are dropped and nothing replaces them", () => {
    it("drops positions_insert_authenticated and positions_update_authenticated", () => {
      expect(countOccurrences(stripped, `drop policy if exists "positions_insert_authenticated" on ${TABLE};`)).toBe(1);
      expect(countOccurrences(stripped, `drop policy if exists "positions_update_authenticated" on ${TABLE};`)).toBe(1);
    });

    it("creates NO insert, update, delete or all policy on positions -- the denial is the absence of a policy", () => {
      const onPositions = policyStatements(stripped).filter((s) => policyTable(s) === TABLE);
      const writeCommands = onPositions.map(policyCommand).filter((c) => c !== "select");
      expect(writeCommands).toEqual([]);
      // Positive control: the extractor did find policies on this table, so
      // the empty list above is a real absence and not a parse that saw
      // nothing at all.
      expect(onPositions.length).toBeGreaterThan(0);
    });

    it("adds no service_role policy -- service_role bypasses RLS, so one would never be consulted", () => {
      expect(stripped).not.toMatch(/create\s+policy[^;]*to\s+service_role/i);
    });
  });

  describe("the anonymous SELECT is narrowed to authenticated", () => {
    it("drops positions_select_all and creates positions_select_authenticated, scoped `to authenticated`", () => {
      expect(countOccurrences(stripped, `drop policy if exists "positions_select_all" on ${TABLE};`)).toBe(1);
      expect(stripped).toMatch(
        /create policy "positions_select_authenticated" on public\.positions\s*\n?\s*for select to authenticated using \(true\);/,
      );
    });

    it("is re-runnable: the new policy is itself dropped-if-exists before being created", () => {
      expect(countOccurrences(stripped, `drop policy if exists "positions_select_authenticated" on ${TABLE};`)).toBe(1);
    });

    it("no policy on positions is left applying to PUBLIC or anon", () => {
      const onPositions = policyStatements(stripped).filter((s) => policyTable(s) === TABLE);
      for (const s of onPositions) {
        expect(s).toMatch(/\bto\s+authenticated\b/i);
        expect(s).not.toMatch(/\bto\s+(public|anon)\b/i);
      }
    });
  });

  describe("the privilege layer is made to agree with the policy layer", () => {
    it("revokes write privileges from authenticated and everything from anon", () => {
      expect(countOccurrences(stripped, `revoke insert, update, delete on table ${TABLE} from authenticated;`)).toBe(1);
      expect(countOccurrences(stripped, `revoke all on table ${TABLE} from anon;`)).toBe(1);
    });

    it("leaves authenticated with select only, and service_role with all", () => {
      expect(countOccurrences(stripped, `grant select on table ${TABLE} to authenticated;`)).toBe(1);
      expect(countOccurrences(stripped, `grant all on table ${TABLE} to service_role;`)).toBe(1);
      // No write verb is granted to authenticated anywhere in this file.
      expect(stripped).not.toMatch(/grant[^;]*\b(insert|update|delete)\b[^;]*on table public\.positions to authenticated/i);
    });

    it("[positive control] the superseded migration really did grant writes to authenticated, so the check above is testing a real change", () => {
      const control = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, GRANTS_CONTROL_NAME), "utf8"));
      expect(control).toMatch(/grant select, insert, update on table public\.positions to authenticated;/);
    });

    it("restates `enable row level security`, so the policies are not inert if RLS is ever turned off", () => {
      expect(countOccurrences(stripped, `alter table ${TABLE} enable row level security;`)).toBe(1);
    });
  });

  describe("policy-and-privilege only -- no schema or data change", () => {
    const DESTRUCTIVE = [
      /^\s*drop table\b/im,
      /^\s*delete\s+from\b/im,
      /^\s*update\s+\S+\s+set\b/im,
      /^\s*truncate\b/im,
      /^\s*create table\b/im,
      /^\s*alter\s+table\s+\S+\s+(add|alter|drop)\s+column\b/im,
    ];

    it("declares no create table, column change, delete, update or truncate", () => {
      for (const re of DESTRUCTIVE) expect(stripped).not.toMatch(re);
      // Canary: these patterns do match the shapes they look for.
      expect("delete from public.x where 1=1;").toMatch(DESTRUCTIVE[1]);
      expect("create table public.x (id uuid);").toMatch(DESTRUCTIVE[4]);
      expect("alter table public.x add column y text;").toMatch(DESTRUCTIVE[5]);
    });

    it("the only `drop` statements are `drop policy if exists`", () => {
      const drops = stripped.match(/drop \S+/gi) || [];
      // Four: the two permissive write policies, plus the drop/re-create pair
      // that swaps positions_select_all for positions_select_authenticated.
      expect(drops.length).toBe(4);
      for (const d of drops) expect(d.toLowerCase()).toBe("drop policy");
    });

    it("names only public.positions -- it cannot block the directory on an object it never verified", () => {
      const tables = stripped.match(/\bon table (\S+)/gi) || [];
      expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) expect(t.toLowerCase()).toBe("on table public.positions");
    });
  });

  describe("[pinned] the reasoning a future reader most needs is stated in the file", () => {
    it("explains why adding a WITH CHECK would not have worked", () => {
      expect(raw).toContain('WHY "JUST ADD A WITH CHECK" IS NOT THE FIX');
      expect(raw).toContain("There is no predicate over this table's columns that means");
    });

    it("quotes the PostgreSQL documentation the whole finding rests on", () => {
      expect(raw).toContain("the USING");
      expect(raw).toContain("expression will be used both to determine which rows are visible");
    });

    it("records the write-surface census and the SSR case that makes the drop safe", () => {
      expect(raw).toContain("THE WRITE-SURFACE CENSUS");
      expect(raw).toContain("createBrowserClient");
      expect(raw).toContain("no currently-working user-session write");
    });

    it("rules on the anonymous SELECT explicitly rather than changing it silently", () => {
      expect(raw).toContain("RULING ON THE ANONYMOUS SELECT");
      expect(raw).toContain("WHAT THIS RULING DOES NOT CLAIM");
    });

    it("states the deploy ordering that this migration is step 3 of", () => {
      expect(raw).toContain("DEPLOY ORDERING");
      expect(raw).toContain("68c7dde");
    });

    it("explains the deliberate absence of explicit begin/commit", () => {
      expect(raw).toContain("IDEMPOTENCY AND TRANSACTIONALITY");
      expect(stripped).not.toMatch(/^\s*(begin|commit)\s*;/im);
    });
  });
});

// ---------------------------------------------------------------------------
// The directory-wide invariant.
// ---------------------------------------------------------------------------
describe("[src] every policy that can take a WITH CHECK declares one", () => {
  it("[control] the sweep actually parses policies out of the directory", () => {
    const all = files.flatMap((f) =>
      policyStatements(stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))),
    );
    // There are dozens across the directory; a handful would mean the
    // statement splitter is broken and every assertion below is vacuous.
    expect(all.length).toBeGreaterThan(30);
    expect(all.filter((s) => policyCommand(s) === "update").length).toBeGreaterThan(5);
  });

  it("no migration declares a FOR UPDATE or FOR ALL policy without an explicit WITH CHECK", () => {
    const violations = [];
    for (const f of files) {
      const text = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
      for (const s of policyStatements(text)) {
        if (violatesInvariant(s)) {
          violations.push(`${f}: ${s.replace(/\s+/g, " ").slice(0, 120)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("[mutation gate] the checker flags the exact policy this migration removes, and passes the corrected form", () => {
    // The real, live defect, written out as SQL. If the checker cannot see
    // this, the sweep above proves nothing.
    const broken =
      `create policy "positions_update_authenticated" on public.positions for update using (auth.role() = 'authenticated');`;
    expect(violatesInvariant(broken)).toBe(true);

    // The per-user variant of the same omission, which is the shape a future
    // migration is far more likely to introduce.
    const brokenOwned = `create policy "x_update_own" on public.x for update using (auth.uid() = user_id);`;
    expect(violatesInvariant(brokenOwned)).toBe(true);

    // A FOR ALL policy, and a policy with no `for` clause at all (which
    // Postgres treats as FOR ALL) -- both must be caught.
    expect(violatesInvariant(`create policy "x_all" on public.x for all using (true);`)).toBe(true);
    expect(violatesInvariant(`create policy "x_bare" on public.x using (true);`)).toBe(true);

    // And the corrected forms must pass, so the checker is not simply
    // returning true for everything.
    expect(
      violatesInvariant(`create policy "x_update_own" on public.x for update using (auth.uid() = user_id) with check (auth.uid() = user_id);`),
    ).toBe(false);
    expect(violatesInvariant(`create policy "x_select" on public.x for select using (true);`)).toBe(false);
    expect(violatesInvariant(`create policy "x_insert" on public.x for insert with check (auth.uid() = user_id);`)).toBe(false);
    expect(violatesInvariant(`create policy "x_delete" on public.x for delete using (auth.uid() = user_id);`)).toBe(false);
  });

  it("[mutation gate] policyCommand is not fooled by the word `for` inside a USING expression", () => {
    // `for` can legitimately appear inside an expression (a column named
    // `valid_for`, a function argument). The command must still be read from
    // the clause after `on <table>`, not from the first `for` in the text.
    const s = `create policy "x" on public.x for select using (valid_for > 0);`;
    expect(policyCommand(s)).toBe("select");
    expect(violatesInvariant(s)).toBe(false);
  });

  it("[mutation gate] policyStatements stops at a real terminator, not at a `;` inside a string literal", () => {
    // The tailor_library shape: a policy built inside execute format('...;').
    const s = `execute format($p$create policy "a_update_own" on public.a for update using (auth.uid() = user_id) with check (auth.uid() = user_id);$p$, t);\nexecute format('grant select on table public.a to authenticated;', t);`;
    const found = policyStatements(s);
    expect(found).toHaveLength(1);
    expect(hasWithCheck(found[0])).toBe(true);
    expect(found[0]).not.toContain("grant select");
  });

  it("[positive control] the sweep sees the real dynamically-built policies in the tailor_library migration", () => {
    const text = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, "20260630000000_tailor_library.sql"), "utf8"));
    const updates = policyStatements(text).filter((s) => policyCommand(s) === "update");
    expect(updates.length).toBeGreaterThan(0);
    for (const s of updates) expect(hasWithCheck(s)).toBe(true);
  });

  it("[positive control] a sibling migration's four-policy shape is read correctly, command by command", () => {
    const text = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, WITH_CHECK_CONTROL_NAME), "utf8"));
    const cmds = policyStatements(text)
      .filter((s) => policyTable(s) === "public.drive_documents")
      .map(policyCommand)
      .sort();
    expect(cmds).toEqual(["delete", "insert", "select", "update"]);
  });
});

// ---------------------------------------------------------------------------
// Nothing later may quietly undo this.
// ---------------------------------------------------------------------------
describe("[src] no later migration reopens write access to positions", () => {
  it("is currently the newest migration touching public.positions", () => {
    const touching = files.filter((f) =>
      stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")).includes(TABLE),
    );
    expect(touching).toContain(MIGRATION_NAME);
    expect(touching).toContain(GRANTS_CONTROL_NAME);
    expect(touching[touching.length - 1]).toBe(MIGRATION_NAME);
  });

  it("any migration sorting after this one grants no write on positions and declares no write policy on it", () => {
    // A tripwire, deliberately. If a later migration legitimately needs to
    // touch this table, this test is where the author is made to state why --
    // and to re-confirm that whatever they add does not hand write access back
    // to `authenticated` or `anon`. Loosening it silently is the failure this
    // guards against, so it fails loudly rather than being scoped narrowly.
    const later = files.filter((f) => f > MIGRATION_NAME);
    for (const f of later) {
      const text = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
      expect(text, `${f} grants a write privilege on positions`).not.toMatch(
        /grant[^;]*\b(insert|update|delete|all)\b[^;]*on table public\.positions to (authenticated|anon|public)/i,
      );
      const writePolicies = policyStatements(text)
        .filter((s) => policyTable(s) === TABLE)
        .map(policyCommand)
        .filter((c) => c !== "select");
      expect(writePolicies, `${f} declares a write policy on positions`).toEqual([]);
    }
  });

  it("[positive control] the anon-readable table named in the ruling really is granted to anon, unlike positions", () => {
    const control = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, PUBLIC_TABLE_CONTROL_NAME), "utf8"));
    expect(control).toMatch(/grant select on table public\.feed_postings to anon, authenticated;/);
    // And no migration has ever granted anon anything on positions -- the
    // factual claim the ruling rests on.
    for (const f of files) {
      const text = stripSqlComments(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
      expect(text, `${f} grants anon a privilege on positions`).not.toMatch(
        /grant[^;]*on table public\.positions to[^;]*\banon\b/i,
      );
    }
  });
});
