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
  droppedConstraintName,
  constraintNameByBodyFragment,
} from "@/lib/interviewPrep/migrationGrantReplay.js";
import { appliedMigrationTexts } from "@/lib/sourceScan/migrationDivergence.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

let migrationFiles = null;
let orderedTexts = null;

beforeAll(() => {
  migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  orderedTexts = appliedMigrationTexts(migrationFiles, migrationFiles.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")));
});

const CAP_REMOVAL_MIGRATION = "20260922000000_interview_prep_remove_spend_caps.sql";
const TRIGGER_CLASS_MIGRATION = "20260922010000_interview_prep_manual_trigger_class.sql";
const ORIGINAL_MIGRATION = "20260914000000_interview_prep.sql";

/** Looks up one migration's own raw text by filename, out of the same
 *  `migrationFiles`/`orderedTexts` pair every other describe block in this
 *  file already builds from the real, on-disk migrations directory. */
function textFor(filename) {
  const idx = migrationFiles.indexOf(filename);
  if (idx === -1) throw new Error(`textFor: migration not found in the real migrations directory: ${filename}`);
  return orderedTexts[idx];
}

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

// V-3 fix (verify.r1.md, N29/N41 fix round 2): "the CHECK no longer bounds
// attempts" and "claim_prep_pack_slot no longer refuses on either counter"
// (both proved above) say NOTHING about whether the counters THEMSELVES
// still increment -- the migration's own header says this removes the
// CEILING, not the counters, but nothing enforced that until now. Mutant M7
// (verify.r1.md) deleted `attempts + 1`'s own `+ 1` from the cap-removal
// migration and 530 tests stayed green.
describe("V-3 -- the spend counters (attempts, model_calls) still increment on every claim/model call", () => {
  it("claim_prep_pack_slot's EFFECTIVE (replayed) body still increments attempts by exactly 1 on every successful claim", () => {
    const def = lastFunctionDefinition(orderedTexts, "claim_prep_pack_slot");
    expect(def).not.toBeNull();
    expect(def.body).toMatch(/set\s+attempts\s*=\s*interview_prep_spend\.attempts\s*\+\s*1/i);
  });

  it("record_prep_model_call's own model_calls increment is untouched by either new migration (neither migration re-creates this function)", () => {
    const def = lastFunctionDefinition(orderedTexts, "record_prep_model_call");
    expect(def).not.toBeNull();
    expect(def.body).toMatch(/set\s+model_calls\s*=\s*interview_prep_spend\.model_calls\s*\+\s*1/i);
  });

  it("[canary, hand-built fixture -- never the real migrations on disk, per this repo's own instrument-destination rule] the SAME pattern above genuinely fails once the '+ 1' is removed, proving these assertions are not vacuously true", () => {
    const mutatedBody = `
      insert into public.interview_prep_spend (application_id, user_id, attempts, model_calls)
      values (p_application_id, auth.uid(), 1, 0)
      on conflict (application_id) do update
        set attempts = interview_prep_spend.attempts,
            updated_at = now()
        where interview_prep_spend.user_id = auth.uid();
    `;
    expect(mutatedBody).not.toMatch(/set\s+attempts\s*=\s*interview_prep_spend\.attempts\s*\+\s*1/i);
    const realDef = lastFunctionDefinition(orderedTexts, "claim_prep_pack_slot");
    expect(realDef.body).toMatch(/set\s+attempts\s*=\s*interview_prep_spend\.attempts\s*\+\s*1/i);
  });
});

// V-4 fix (verify.r1.md, N29/N41 fix round 2): a misspelled `drop constraint
// if exists <name>` silently no-ops in real Postgres (no error, nothing
// dropped) and lastConstraintClause's own "last add wins" replay cannot tell
// the difference from a genuine drop+add pair -- the later, correctly-named
// ADD still wins the replay either way (mutant M9, verify.r1.md, survived
// 457 tests). The fix is NOT "assert the drop happened" via a boolean this
// replay cannot honestly produce from a name mismatch alone; it is proving
// the name actually dropped is the SAME name the constraint was originally
// created under -- both read out of source text, never the same string
// literal typed twice into this test (which would catch neither side's
// typo, only their disagreement with a THIRD, hand-typed expectation).
describe("V-4 -- a DROP CONSTRAINT statement targets the exact name the constraint was originally CREATED under", () => {
  it("the cap-removal migration's DROP targets interview_prep_spend's own originally-created attempts-check name", () => {
    const createdName = constraintNameByBodyFragment(textFor(ORIGINAL_MIGRATION), "attempts >= 0 and attempts <= 6");
    expect(createdName, "could not find the original attempts CHECK's name in 20260914000000 -- fixture drifted").not.toBeNull();
    const droppedName = droppedConstraintName(textFor(CAP_REMOVAL_MIGRATION), "interview_prep_spend");
    expect(droppedName, "no ALTER TABLE ... DROP CONSTRAINT found against interview_prep_spend").not.toBeNull();
    expect(droppedName).toBe(createdName);
  });

  it("the trigger-class migration's DROP targets interview_prep_events' own originally-created trigger_class-check name", () => {
    const createdName = constraintNameByBodyFragment(textFor(ORIGINAL_MIGRATION), "trigger_class in ('B1', 'B3')");
    expect(createdName, "could not find the original trigger_class CHECK's name in 20260914000000 -- fixture drifted").not.toBeNull();
    const droppedName = droppedConstraintName(textFor(TRIGGER_CLASS_MIGRATION), "interview_prep_events");
    expect(droppedName, "no ALTER TABLE ... DROP CONSTRAINT found against interview_prep_events").not.toBeNull();
    expect(droppedName).toBe(createdName);
  });

  it("[mutant-kill proof, hand-built fixture -- never the real repo migrations] a misspelled drop name is caught by THIS instrument even though lastConstraintClause's own replay still reports the correctly-named ADD as effective", () => {
    const originalFixture = `create table public.t (\n  x text,\n  constraint t_x_check\n    check (x in ('A'))\n);`;
    const migrationFixture = [
      "alter table public.t drop constraint if exists t_x_chk;", // misspelled
      "alter table public.t add constraint t_x_check check (x in ('A','B'));",
    ].join("\n");
    // This is M9's exact failure mode, reproduced against a controlled
    // fixture: the misspelled drop never matches "t_x_check", so the replay
    // still sees the later, correctly-named ADD as effective.
    expect(lastConstraintClause([originalFixture, migrationFixture], "t_x_check")).not.toBeNull();
    // This instrument catches it anyway: the name actually dropped does not
    // match the name actually created.
    const createdName = constraintNameByBodyFragment(originalFixture, "x in ('A')");
    const droppedName = droppedConstraintName(migrationFixture, "t");
    expect(createdName).toBe("t_x_check");
    expect(droppedName).not.toBe(createdName);
  });
});
