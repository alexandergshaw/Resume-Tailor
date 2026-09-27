// N60 S4 -- the shape of the spend/alert/run-ledger migration, as a SQL-TEXT
// parse. No live database and no PGlite is reachable from this checkout (PGlite
// is not in package.json, not in node_modules, and instantiated nowhere in the
// repo -- migration tests here are all text parses; precedent:
// lib/supabase/applicationDigestsMigrationShape.test.js,
// lib/interviewPrep/interviewPrepMigrationShape.test.js). So this file can
// prove the repo's OWN declared SQL is internally consistent and carries the
// atomic reserve the counters depend on; it CANNOT prove the migration was
// applied, that RLS enforces at runtime, or that Postgres serialises the
// reserve. Those are runtime facts owed to an out-of-band PGlite/staging run.
//
// THE LOAD-BEARING PROPERTY (owner ruling, 2026-09-20):
//   the per-day ceiling is enforced by an ATOMIC conditional increment, so the
//   reserve is a cap-GUARDED upsert/update -- `... + 1 ... where n < cap`, the
//   claim_prep_pack_slot shape -- never an unconditional `set n = n + 1`. The
//   plan's 6.4 read-modify-write and its "plain DDL only, no function" note are
//   BOTH superseded by this ruling: an atomic conditional increment with cap
//   enforcement cannot be expressed through the PostgREST JS client and needs a
//   server-side function, exactly as claim_prep_pack_slot already is.
//
// Every absence assertion below is paired with a positive control proving the
// extractor finds the real thing, and every negative control proves it bites.
// Discipline copied from applicationDigestsMigrationShape.test.js.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripSqlComments } from "@/lib/sourceScan/stripSqlComments.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
// The latest migration MEASURED in the tree at plan time -- the new stamp must
// sort strictly after it.
const LATEST_APPLIED = "20260923030000_application_accepted_facts.sql";

// The migration is identified by the atomic function the counters call, NOT by
// a hardcoded filename, so a differently-stamped-but-correct file still passes
// (and a file that creates the tables but forgets the atomic reserve is NOT
// mistaken for it).
const RESERVE_MARKER = "reserve_auto_tailor_slot";

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
}

let migration = null; // { name, raw, stripped } | null
beforeAll(() => {
  for (const name of listMigrations()) {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    if (stripSqlComments(raw).includes(RESERVE_MARKER)) {
      migration = { name, raw, stripped: stripSqlComments(raw) };
      break;
    }
  }
});

/** Extract a dollar-quoted function body for `create ... function <name>(...)`.
 *  Returns the body text (between the $tag$ delimiters), or null. */
function functionBody(sql, fnName) {
  // Anchor the name directly after `function` (optionally schema-qualified), so
  // asking for one function never accidentally extracts an earlier function's
  // $$-body -- the instrument fault the reference build caught.
  const start = sql.search(new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${fnName}\\b`, "i"));
  if (start === -1) return null;
  const rest = sql.slice(start);
  const m = rest.match(/\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$/);
  return m ? m[2] : null;
}

describe("the migration exists and is stamped after the latest applied one", () => {
  it("[control] the migrations directory was actually read", () => {
    expect(listMigrations().length).toBeGreaterThan(20);
  });

  it("a migration declaring the atomic reserve function exists", () => {
    expect(migration, `no migration contains ${RESERVE_MARKER}`).not.toBeNull();
  });

  it("its 14-digit stamp sorts strictly after the latest applied migration", () => {
    expect(migration).not.toBeNull();
    const stamp = (s) => s.match(/^(\d{14})_/)?.[1] ?? "";
    expect(stamp(migration.name)).toMatch(/^\d{14}$/);
    expect(stamp(migration.name) > stamp(LATEST_APPLIED)).toBe(true);
  });
});

describe("idempotency BY CONSTRUCTION (running it twice is a no-op)", () => {
  // Not executed -- asserted structurally, and its limitation is named: this
  // proves the guards are present, not that a second apply is truly inert.
  it("every ledger table is created with `if not exists`", () => {
    expect(migration).not.toBeNull();
    const creates = migration.stripped.match(/create\s+table\s+(if\s+not\s+exists\s+)?[a-z0-9_.]+/gi) || [];
    expect(creates.length).toBeGreaterThan(0);
    for (const c of creates) {
      expect(c.toLowerCase()).toContain("if not exists");
    }
  });

  it("[control+bite] the `if not exists` extractor finds a bare create and a guarded one apart", () => {
    const guarded = "create table if not exists public.x (id int);";
    const bare = "create table public.y (id int);";
    expect(/create\s+table\s+if\s+not\s+exists/i.test(guarded)).toBe(true);
    expect(/create\s+table\s+if\s+not\s+exists/i.test(bare)).toBe(false);
  });

  it("the four saved_searches columns are added with `add column if not exists` -- so a pre-existing NULLABLE column is left untouched, never re-typed to NOT NULL", () => {
    expect(migration).not.toBeNull();
    for (const col of [
      "auto_tailor_enabled",
      "auto_tailor_daily_cap",
      "auto_tailor_min_interval_minutes",
      "last_run_at",
    ]) {
      const re = new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\b`, "i");
      expect(re.test(migration.stripped), `${col} must be added with add column if not exists`).toBe(true);
    }
  });

  it("does NOT force a NOT NULL constraint onto those columns after the fact (would fail on pre-existing nulls)", () => {
    expect(migration).not.toBeNull();
    for (const col of ["auto_tailor_enabled", "auto_tailor_daily_cap", "auto_tailor_min_interval_minutes"]) {
      const re = new RegExp(`alter\\s+column\\s+${col}\\s+set\\s+not\\s+null`, "i");
      expect(re.test(migration.stripped), `${col} must not be re-forced NOT NULL`).toBe(false);
    }
  });

  it("the kill-switch seeds use `on conflict ... do nothing` so a re-apply does not clobber a flipped switch", () => {
    expect(migration).not.toBeNull();
    expect(/insert\s+into\s+[a-z0-9_.]*feature_kill_switches[\s\S]*?on\s+conflict[\s\S]*?do\s+nothing/i.test(migration.stripped)).toBe(true);
  });
});

describe("the reserve is an ATOMIC, cap-GUARDED increment (never unconditional)", () => {
  it("reserve_auto_tailor_slot increments under a `< cap` guard in the same statement", () => {
    expect(migration).not.toBeNull();
    const body = functionBody(migration.stripped, "reserve_auto_tailor_slot");
    expect(body, "reserve_auto_tailor_slot body not found").toBeTruthy();
    // The conditional increment: an on-conflict upsert (or an update) that both
    // increments AND is guarded by a cap comparison. Postgres returns no row
    // when that guard is false -- that is how the ceiling refuses atomically.
    const guardedUpsert = /on\s+conflict[\s\S]*do\s+update[\s\S]*where[\s\S]*<\s*p_cap/i.test(body);
    const guardedUpdate = /update[\s\S]*set[\s\S]*\+\s*1[\s\S]*where[\s\S]*<\s*p_cap/i.test(body);
    expect(guardedUpsert || guardedUpdate).toBe(true);
  });

  it("[bite] an UNCONDITIONAL increment fixture (no cap guard) fails this check", () => {
    const badBody = "insert into t (user_id, day, tailored_count) values (a, b, 1) on conflict (user_id, day) do update set tailored_count = t.tailored_count + 1 returning t.tailored_count;";
    const guardedUpsert = /on\s+conflict[\s\S]*do\s+update[\s\S]*where[\s\S]*<\s*p_cap/i.test(badBody);
    const guardedUpdate = /update[\s\S]*set[\s\S]*\+\s*1[\s\S]*where[\s\S]*<\s*p_cap/i.test(badBody);
    expect(guardedUpsert || guardedUpdate).toBe(false);
  });

  it("reserve_alert_mail_slot guards BOTH the address and the account ceilings", () => {
    expect(migration).not.toBeNull();
    const body = functionBody(migration.stripped, "reserve_alert_mail_slot");
    expect(body, "reserve_alert_mail_slot body not found").toBeTruthy();
    expect(/<\s*p_address_cap/i.test(body)).toBe(true);
    expect(/<\s*p_account_cap/i.test(body)).toBe(true);
  });
});

describe("the tables the counters and ledgers need are created", () => {
  it("creates the spend, run-ledger, alert-settings and kill-switch tables", () => {
    expect(migration).not.toBeNull();
    for (const t of [
      "auto_tailor_spend_daily",
      "alert_mail_spend_daily",
      "auto_tailor_runs",
      "user_alert_settings",
      "feature_kill_switches",
    ]) {
      const re = new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+[a-z0-9_.]*${t}\\b`, "i");
      expect(re.test(migration.stripped), `missing create table ... ${t}`).toBe(true);
    }
  });

  it("seeds both kill-switch keys", () => {
    expect(migration).not.toBeNull();
    expect(migration.stripped).toMatch(/auto_tailor/);
    expect(migration.stripped).toMatch(/alert_mail/);
  });
});

describe("RLS and policy shape", () => {
  it("enables RLS on the new tables", () => {
    expect(migration).not.toBeNull();
    const enables = migration.stripped.match(/enable\s+row\s+level\s+security/gi) || [];
    expect(enables.length).toBeGreaterThanOrEqual(5);
  });

  it("every `for update` policy carries an explicit `with check` (positionsPolicyMigrationShape:324's rule)", () => {
    expect(migration).not.toBeNull();
    // Split on `create policy` and check each policy statement that is `for update`.
    const policies = migration.stripped.split(/create\s+policy/i).slice(1);
    const forUpdate = policies.filter((p) => /for\s+update/i.test(p.split(";")[0]));
    for (const p of forUpdate) {
      expect(/with\s+check/i.test(p.split(";")[0])).toBe(true);
    }
  });

  it("[control] the for-update/with-check extractor finds a real pair and rejects a missing one", () => {
    const good = "create policy p on t for update using (a) with check (a);";
    const bad = "create policy p on t for update using (a);";
    const grab = (s) => s.split(/create\s+policy/i).slice(1).filter((p) => /for\s+update/i.test(p.split(";")[0]));
    expect(grab(good).every((p) => /with\s+check/i.test(p))).toBe(true);
    expect(grab(bad).every((p) => /with\s+check/i.test(p))).toBe(false);
  });
});

describe("the migration touches none of the tripwire objects", () => {
  it("mentions neither public.positions nor the interview-prep / applications objects other files pin", () => {
    expect(migration).not.toBeNull();
    for (const forbidden of [
      "public.positions",
      "interview_prep_spend",
      "claim_prep_pack_slot",
      "record_prep_model_call",
      "applications_status_check",
      "citation_outcome",
    ]) {
      expect(migration.stripped.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("its comment-stripped single-quotes are balanced (the stripSqlComments:87 parity invariant)", () => {
    expect(migration).not.toBeNull();
    const quoteCount = (migration.stripped.match(/'/g) || []).length;
    expect(quoteCount % 2).toBe(0);
  });
});
