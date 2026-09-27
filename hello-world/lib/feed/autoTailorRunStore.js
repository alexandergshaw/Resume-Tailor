// N60 S7 -- durable I/O around the pure run summariser (autoTailorRunLog.js).
//
// Named `...Store.js`, not `...Log.js`, on purpose: the feature-log sweep
// (lib/activityLog/activityCoverage.sweep.test.js) matches file names ending
// in `Log.js`/`LogDocument.js`/`LogArchive.js` under `lib/`, and this module
// does no rendering of its own -- it persists and reads back the summary
// autoTailorRunLog.js already produces. The same split the interview-prep
// feature already uses (prepLog vs prepStore).
//
// TWO properties, both from the brief's failure directions:
//   1. LOGGING IS NOT A GATE. recordRun never throws and never rejects: a DB
//      error and a thrown insert both resolve to {ok:false}. The cron route
//      still wraps its own call in a try/catch (route.runLog.test.js) as a
//      second line of defence, but this module's own contract is that a
//      caller who forgets to wrap it is still safe.
//   2. READS ARE OWN-ROWS. loadRecentRuns filters on user_id -- belt-and-
//      braces with the table's select-own RLS (design-structure.r1.md §4) --
//      and returns [] on any error or empty history so the reading surface
//      can always render "nothing yet" rather than propagate an error.

const RECENT_RUNS_LIMIT = 50;

/**
 * Persists one run summary (summarizeRun's output) as a row in
 * `auto_tailor_runs`. Never throws and never rejects -- a caller can await it
 * with no try/catch and the run it describes is never put at risk.
 * @param {object} admin a service-role Supabase client
 * @param {{userId:string}} run summarizeRun's output for one user's run
 * @returns {Promise<{ok:boolean}>}
 */
export async function recordRun(admin, run) {
  try {
    const { error } = await admin.from("auto_tailor_runs").insert({
      user_id: run?.userId,
      payload: run,
    });
    if (error) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Reads the most recent runs for one user, newest first. Own-rows: filtered
 * on user_id even though the table is also select-own by RLS. Returns [] on
 * any query error or an empty history -- never throws.
 * @param {object} client a Supabase client scoped to the signed-in user
 * @param {string} userId
 * @returns {Promise<Array<{id:string, ran_at:string, payload:object}>>}
 */
export async function loadRecentRuns(client, userId) {
  try {
    const { data, error } = await client
      .from("auto_tailor_runs")
      .select("id, ran_at, payload")
      .eq("user_id", userId)
      .order("ran_at", { ascending: false })
      .limit(RECENT_RUNS_LIMIT);
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
