// Data access for the study plan (N157): the ONLY module that names
// `study_plans` or issues a statement against it, and the ONLY progress write
// path (the merge_study_plan_progress RPC). See
// supabase/migrations/20261011000000_n157_study_plans.sql for the table and the
// function, studyPlanContract.js for the names and the column projection, and
// studyPlanSchema.js for the shapes this file normalizes on the way out.
//
// Mirrors lib/supabase/applicationDigests.js (the column-wise upsert on a 1:1
// primary key) and lib/interviewPrep/prepStore.js (an injected `supabase`, a
// named projection, an RPC for the counter-style write): every function takes
// the caller's own client, resolves no session of its own, imports nothing
// browser-only or server-only (so the browser client and a generation route can
// both call it), and NEVER THROWS -- a failed call is a result object the caller
// branches on, so a DB blip cannot tear down a walkthrough mid-card.
//
// Tenant scoping is defence in depth on top of RLS, per statement:
//   * readStudyPlan filters on application_id AND user_id.
//   * writeStudyPlan cannot chain a filter onto an upsert, so user_id rides in
//     the row payload and RLS's `with check` / `using` is the live boundary.
//   * writeStudyPlanProgress takes NO user id at all: identity is auth.uid()
//     inside the RPC's WHERE, the same discipline as recordModelCallIssued.
//
// `cached_research` is passed through UNCHANGED in both directions: its element
// shape belongs to the evidence module, and re-shaping it here would hand that
// module a wrong inheritance.

import {
  STUDY_PLANS_TABLE,
  STUDY_PLAN_PROJECTION,
  MERGE_STUDY_PLAN_PROGRESS_FN,
} from "./studyPlanContract.js";
import {
  normalizePlan,
  normalizeProgress,
  normalizeKnobs,
  isSingleItemSeenDelta,
} from "./studyPlanSchema.js";

const READ_FAILED = "Could not load the study plan.";
const WRITE_FAILED = "Could not save the study plan.";
const PROGRESS_FAILED = "Could not save your progress.";

function errMessage(error, fallback) {
  return typeof error?.message === "string" && error.message !== "" ? error.message : fallback;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

// What a read returns when there is nothing to show: no row (no plan built yet,
// or a row that is not this owner's), a refused call, or a failed one. Every
// data field null and `error` the only thing that differs.
function emptyRecord(error = null) {
  return {
    status: null,
    plan: null,
    knobs: null,
    progress: null,
    cachedResearch: null,
    postingFingerprint: null,
    researchedAt: null,
    engine: null,
    error,
  };
}

/**
 * The one plan row for an application, normalized through the schema (plan,
 * knobs and progress all degrade to an empty-but-valid shape on a legacy or
 * corrupt row, never a throw). An absent row is the all-null record with
 * `error: null`, which is how "no plan yet" differs from "the read failed".
 * An empty application or user id is refused before any network call.
 */
export async function readStudyPlan(supabase, { applicationId, userId } = {}) {
  try {
    if (!applicationId) return emptyRecord("Missing application id.");
    if (!userId) return emptyRecord("Missing user id.");

    const { data, error } = await supabase
      .from(STUDY_PLANS_TABLE)
      .select(STUDY_PLAN_PROJECTION)
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return emptyRecord(errMessage(error, READ_FAILED));
    if (!isObject(data)) return emptyRecord();

    return {
      status: stringOrNull(data.status),
      plan: normalizePlan(data.plan),
      knobs: normalizeKnobs(data.knobs),
      progress: normalizeProgress(data.progress),
      cachedResearch: data.cached_research ?? null,
      postingFingerprint: stringOrNull(data.posting_fingerprint),
      researchedAt: stringOrNull(data.researched_at),
      engine: stringOrNull(data.engine),
      error: null,
    };
  } catch (err) {
    return emptyRecord(errMessage(err, READ_FAILED));
  }
}

/**
 * Creates or rebuilds the one plan row for `applicationId`.
 *
 * THE UPSERT IS COLUMN-WISE (see upsertDigest): `.upsert(row, { onConflict })`
 * sends only the keys present in `row`, so on the UPDATE branch an omitted
 * column keeps its EXISTING value. That is exactly what protects a learner's
 * drill history, and it is why `progress` is DELIBERATELY NOT a column this
 * function can write: `progress` is RPC-write-only (writeStudyPlanProgress
 * below). It is not destructured from the argument, so passing one has no
 * effect -- a create or a knob/plan rebuild that carried it would silently
 * wipe the `seen` map the merge function maintains.
 *
 * The whitelist is the only thing between the caller and PostgREST, and a field
 * it does not name is dropped in silence. Anything added here must be spelled
 * EXACTLY as the column is spelled. `status` has no column default, so the
 * first write for an application has to carry it; the status<->plan coherence
 * CHECK (a 'ready' row needs at least one module) is the DB's to enforce and
 * fails loudly there, not pre-validated here.
 */
export async function writeStudyPlan(
  supabase,
  { applicationId, userId, status, plan, knobs, engine, postingFingerprint, researchedAt, cachedResearch } = {},
) {
  try {
    if (!applicationId) return { written: false, row: null, error: "Missing application id." };
    if (!userId) return { written: false, row: null, error: "Missing user id." };

    const row = {
      application_id: applicationId,
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    if (typeof status === "string" && status !== "") row.status = status;
    if (isObject(plan)) row.plan = plan;
    if (isObject(knobs)) row.knobs = knobs;
    if (typeof engine === "string" || engine === null) row.engine = engine;
    // NOT NULL with a '' default: a null would be rejected, so only a string is sent.
    if (typeof postingFingerprint === "string") row.posting_fingerprint = postingFingerprint;
    if (typeof researchedAt === "string" && researchedAt !== "") row.researched_at = researchedAt;
    if (isObject(cachedResearch)) row.cached_research = cachedResearch;

    const { data, error } = await supabase
      .from(STUDY_PLANS_TABLE)
      .upsert(row, { onConflict: "application_id" })
      .select()
      .maybeSingle();
    if (error) return { written: false, row: null, error: errMessage(error, WRITE_FAILED) };
    return { written: true, row: data || null, error: null };
  } catch (err) {
    return { written: false, row: null, error: errMessage(err, WRITE_FAILED) };
  }
}

/**
 * Records ONE card (a reveal or a grade) and the resume cursor, through the
 * merge_study_plan_progress RPC -- the only way `progress` is ever written.
 * `seenDelta` is the single entry just touched, never the whole `seen` map: the
 * server merges it into the stored map in one statement, which is what lets two
 * devices record different cards without dropping each other's. This is a
 * second line of defence behind the progress store's own check, and it FAILS
 * CLOSED: a map of several entries, an empty map, or a malformed entry is
 * refused here and the RPC is never issued.
 *
 * `cursor` must be an object, not merely present: the function writes it with
 * jsonb_set, which is STRICT, so a null cursor would turn the whole `progress`
 * column into SQL NULL instead of failing.
 *
 * No user id goes on the wire (auth.uid() is the identity inside the RPC), so
 * `true` means "a row of this owner's was updated" and `false` means zero rows
 * matched (no plan, or not this owner's) -- reported as not written.
 */
export async function writeStudyPlanProgress(supabase, { applicationId, cursor, seenDelta } = {}) {
  try {
    if (!applicationId) return { written: false, error: "Missing application id." };
    if (!isSingleItemSeenDelta(seenDelta)) {
      return { written: false, error: "A progress write must carry exactly one card." };
    }
    if (!isObject(cursor)) return { written: false, error: "A progress write needs a cursor." };

    const { data, error } = await supabase.rpc(MERGE_STUDY_PLAN_PROGRESS_FN, {
      p_application_id: applicationId,
      p_cursor: cursor,
      p_seen_delta: seenDelta,
    });
    if (error) return { written: false, error: errMessage(error, PROGRESS_FAILED) };
    if (data !== true) return { written: false, error: "No study plan was found to save progress to." };
    return { written: true, error: null };
  } catch (err) {
    return { written: false, error: errMessage(err, PROGRESS_FAILED) };
  }
}
