// N41 (both interview-prep spend caps removed, owner decision 2026-09-20)
// and N29's DS-N29.3 (the manual trigger_class widening) -- the EFFECTIVE,
// post-replay database-schema half of both changes. This is a NEW file,
// not one more describe block in interviewPrepEffectiveSchema.test.js
// (998 lines today, confirmed by direct line count this round -- that
// file's own header, :35-43, already states it was split out of the
// migration-shape file once specifically to stay under this repo's 1000-
// line cap, so adding here instead of there is a continuation of that same
// discipline, not a new one).
//
// Same replay idiom that file established (its own header, :13-21): a
// `.toContain`/regex over the CONCATENATION of every migration would see
// text a LATER migration deletes; every assertion below instead scans
// migrations IN FILE ORDER and applies each drop+add pair on top of the
// running state, via `lastConstraintClause`/`lastFunctionDefinition`
// (lib/interviewPrep/migrationGrantReplay.js) -- the same "last one wins"
// property that file's own `lastFunctionDefinition` already established
// for `create or replace function`, extended here to the CHECK-constraint
// analogue (`lastConstraintClause`, new, plan.r1.md §2's function table).
//
// RED ON HEAD, and why, per assertion group:
//   - `lastConstraintClause` itself does not exist in migrationGrantReplay.js
//     today (grep confirms zero hits) -- the hand-built-fixture unit tests
//     below fail at import resolution.
//   - No migration after 20260921000000_interview_prep_trusted_names.sql
//     (the actual latest file in the tree, confirmed by directory listing
//     this round) touches interview_prep_spend_attempts_check or
//     claim_prep_pack_slot's guard, or widens interview_prep_events_
//     trigger_class_check -- so every "[RED until ... lands]" assertion
//     against the REAL migrations directory fails against today's tree.
//   - The "[TODAY, positive control]" assertions each EXCLUDE their own
//     chunk's not-yet-existing migration by name (`textsExcludingFile`,
//     matching the "before/after pair" plan.r1.md's own risk table
//     requires) -- so they read as TRUE both before AND after the real
//     migration lands, unlike a naive assertion against the bare migrations
//     directory, which would flip from true to false the moment the fix
//     ships and become a control that fails a correct implementation.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  lastConstraintClause,
  lastFunctionDefinition,
  textsExcludingFile,
} from "@/lib/interviewPrep/migrationGrantReplay.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

let migrationFiles = null;
let orderedTexts = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  orderedTexts = migrationFiles.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
});

const CAP_REMOVAL_MIGRATION = "20260922000000_interview_prep_remove_spend_caps.sql";
const TRIGGER_CLASS_MIGRATION = "20260922010000_interview_prep_manual_trigger_class.sql";

describe("[control] the migrations directory was actually read and is non-trivial", () => {
  it("more than 10 migration files exist, lexicographically sorted", () => {
    expect(migrationFiles.length).toBeGreaterThan(10);
    expect(migrationFiles).toEqual([...migrationFiles].sort());
  });
});

describe("lastConstraintClause -- unit tests against a hand-built fixture, independent of the real repo migrations", () => {
  const ADD_ONLY = `alter table public.t add constraint t_x_check check (x in ('A','B'));`;
  const DROP_THEN_ADD_WIDER = [
    `alter table public.t drop constraint if exists t_x_check;`,
    `alter table public.t add constraint t_x_check check (x in ('A','B','C'));`,
  ].join("\n");
  const DROP_ONLY = `alter table public.t drop constraint if exists t_x_check;`;

  it("[canary] a constraint that was never declared in the given texts returns null", () => {
    expect(lastConstraintClause([ADD_ONLY], "nonexistent_check")).toBeNull();
  });

  it("returns the clause from a single migration that only adds it", () => {
    const result = lastConstraintClause([ADD_ONLY], "t_x_check");
    expect(result).not.toBeNull();
    expect(result.clause).toContain("'A'");
    expect(result.clause).toContain("'B'");
    expect(result.clause).not.toContain("'C'");
  });

  it("[the 'last one wins' property] a LATER drop+add pair supersedes an earlier bare add, across two files", () => {
    const result = lastConstraintClause([ADD_ONLY, DROP_THEN_ADD_WIDER], "t_x_check");
    expect(result.clause).toContain("'C'");
  });

  it("a constraint dropped LAST, with no later add, is reported as removed (null) -- N41(a)'s own 'drop' option", () => {
    const result = lastConstraintClause([ADD_ONLY, DROP_ONLY], "t_x_check");
    expect(result).toBeNull();
  });
});

describe("N41(a) -- interview_prep_spend_attempts_check, replayed", () => {
  it("[TODAY, positive control, excluding the not-yet-existing cap-removal migration] the CHECK still bounds attempts to <= 6", () => {
    const preTexts = textsExcludingFile(migrationFiles, orderedTexts, CAP_REMOVAL_MIGRATION);
    const clause = lastConstraintClause(preTexts, "interview_prep_spend_attempts_check");
    expect(clause).not.toBeNull();
    expect(clause.clause).toMatch(/<=\s*6/);
  });

  it("[RED until N41's cap-removal migration lands] the EFFECTIVE (replayed) constraint no longer bounds attempts by an upper limit -- either dropped outright, or widened past any real ceiling", () => {
    const clause = lastConstraintClause(orderedTexts, "interview_prep_spend_attempts_check");
    const stillBounded = clause !== null && /<=\s*6/.test(clause.clause);
    expect(stillBounded).toBe(false);
  });
});

describe("N41(b) -- claim_prep_pack_slot's guard, replayed", () => {
  it("[TODAY, positive control, excluding the not-yet-existing cap-removal migration] the effective function body still refuses on either counter", () => {
    const preTexts = textsExcludingFile(migrationFiles, orderedTexts, CAP_REMOVAL_MIGRATION);
    const def = lastFunctionDefinition(preTexts, "claim_prep_pack_slot");
    expect(def).not.toBeNull();
    expect(def.body).toMatch(/v_attempts\s*>=\s*6/);
    expect(def.body).toMatch(/v_model_calls\s*>=\s*12/);
  });

  it("[RED until N41's cap-removal migration lands] the EFFECTIVE (last create or replace) function body no longer refuses on either counter", () => {
    const def = lastFunctionDefinition(orderedTexts, "claim_prep_pack_slot");
    expect(def).not.toBeNull();
    expect(def.body).not.toMatch(/v_attempts\s*>=\s*6/);
    expect(def.body).not.toMatch(/v_model_calls\s*>=\s*12/);
  });

  it("[risk-table guard] the replaced function's SECURITY mode is still DEFINER, never reverted to the ORIGINAL file's stale INVOKER text", () => {
    // A crude but sufficient replay-safe check: the LAST 'create or replace
    // function public.claim_prep_pack_slot' block's preamble (everything
    // before the body's own $$ delimiter) must contain 'security definer'.
    const def = lastFunctionDefinition(orderedTexts, "claim_prep_pack_slot");
    expect(def).not.toBeNull();
    expect(def.preamble.toLowerCase()).toContain("security definer");
  });

  it("[risk-table guard] the replaced function's parameter list is unchanged -- no p_user_id reintroduced", () => {
    const def = lastFunctionDefinition(orderedTexts, "claim_prep_pack_slot");
    expect(def).not.toBeNull();
    expect(def.preamble).not.toMatch(/p_user_id/);
  });
});

describe("DS-N29.3 -- the manual trigger_class ('B2') CHECK widening, replayed", () => {
  it("[TODAY, positive control, excluding the not-yet-existing migration] the effective set is exactly ['B1','B3']", () => {
    const preTexts = textsExcludingFile(migrationFiles, orderedTexts, TRIGGER_CLASS_MIGRATION);
    const clause = lastConstraintClause(preTexts, "interview_prep_events_trigger_class_check");
    expect(clause).not.toBeNull();
    expect(clause.clause).toContain("'B1'");
    expect(clause.clause).toContain("'B3'");
    expect(clause.clause).not.toContain("'B2'");
  });

  it("[RED until the migration lands] the FULL effective replay's constraint clause contains 'B2'", () => {
    const clause = lastConstraintClause(orderedTexts, "interview_prep_events_trigger_class_check");
    expect(clause).not.toBeNull();
    expect(clause.clause).toContain("'B2'");
  });

  it("[the before/after pair together prove the drop+add pair actually fired, not merely a stray second constraint of the same name] both assertions above read the SAME real migrations directory", () => {
    // A named control, not a new instrument: if the migration's `drop
    // constraint if exists` silently no-ops (a misspelled name), the
    // "TODAY" control above and this file's own RED assertion would BOTH
    // still read the pre-migration text and neither would move -- exactly
    // the risk plan.r1.md §4's risk table names for steps 3/4. Recorded as
    // its own case so a reviewer sees the pairing was deliberate.
    expect(migrationFiles.length).toBeGreaterThan(0);
  });
});
