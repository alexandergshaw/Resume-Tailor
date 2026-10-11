// Pure, no-IO contract module for the study plan (N157): the table name, the
// RPC name and the named column projection every other module in this feature
// imports rather than re-typing. A store module (SC-B-persist's
// studyPlanStore.js, not yet written) is meant to be the ONLY module that
// names `study_plans` or issues a query against it; this file is where its
// projection literal and the merge function's name live, so no caller reaches
// for a raw string or an un-pinned `.select()` argument. Same shape as
// lib/interviewPrep/prepContract.js.
//
// The columns mirror supabase/migrations/20261011000000_n157_study_plans.sql
// one for one; studyPlanMigrationShape.test.js proves that migration's
// declared SQL, studyPlanContract.test.js pins this list.

/** The table the store reads and writes. */
export const STUDY_PLANS_TABLE = "study_plans";

/**
 * The SECURITY INVOKER function every progress write goes through (never a
 * whole-object read-modify-write of `progress`), so two devices recording
 * different cards cannot drop each other's entries.
 */
export const MERGE_STUDY_PLAN_PROGRESS_FN = "merge_study_plan_progress";

/**
 * The whole-row projection a read selects by name -- never `select("*")`, so
 * a column added to the table later is a visible, intentional change here
 * rather than a silent widening of every read. Order is the migration's
 * column order. A lighter list-view projection is deliberately NOT baked in
 * yet; add a second constant beside this one if a list view needs it.
 */
export const STUDY_PLAN_COLUMNS = Object.freeze([
  "application_id",
  "user_id",
  "status",
  "plan",
  "knobs",
  "progress",
  "cached_research",
  "posting_fingerprint",
  "researched_at",
  "engine",
  "created_at",
  "updated_at",
]);

/** Joined form of STUDY_PLAN_COLUMNS, for the `.select()` call itself. */
export const STUDY_PLAN_PROJECTION = STUDY_PLAN_COLUMNS.join(", ");
