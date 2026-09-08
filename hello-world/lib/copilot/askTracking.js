// "Everything from the company's row in the tracking table" -- the half of it
// that lib/copilot/answerContext.js's cached fan-out does not carry.
//
// WHAT IS ALREADY LOADED AND IS NOT RE-FETCHED HERE. `loadAnswerContext`
// returns `{ resume, coverLetter, posting, employer, pages }`, so the posting
// DESCRIPTION and the employer's company/title arrive already fetched and
// already capped (MAX_POSTING_CHARS, answerContext.js:46). This module
// deliberately does not select any of them again -- it reads the SCALARS that
// fan-out has no column for (`status`, `applied_at`, `tracked_at`,
// `application_url`) plus the interview stages, and the route stitches the two
// halves together. Widening `loadAnswerContext` instead was the alternative and
// was rejected: `fetchRawContext`'s Promise.all is pinned by
// route.latency.test.js down to its argument shape, and its cached value is
// shared with the answer route, which has no use for any of this.
//
// THERE IS NO `create table public.applications` IN THIS REPO --
// supabase/migrations/20260906000000_applications_user_position_key.sql:11 says
// so outright. The column list below is the OBSERVED shape of the live query in
// app/page.js's loadApplications (:1362-1367 for applications, :1424-1427 for
// stages), not a schema file. Any column added here must be checked against the
// live database first.
//
// Never throws, exactly like lib/copilot/applicationDocs.js's three siblings:
// every failure -- no application id, no user id, no matching row, a row that
// belongs to someone else, a query error -- degrades to `null`, which the
// caller renders as "no tracking row" rather than an error. A broken
// application must not be able to break the ask box.

/**
 * Interview stages are scoped by `application_id` ALONE, because the table has
 * no `user_id` column. That is only safe because the caller has already proved
 * ownership: this runs strictly after the `applications` read below returned a
 * row for `.eq("user_id", userId)`. Calling it with an unverified id would be a
 * cross-tenant read, so it is not exported.
 */
async function fetchStages(supabase, applicationId) {
  try {
    const { data, error } = await supabase
      .from("interview_stages")
      .select(
        "id, application_id, stage_name, stage_type, scheduled_at, duration_minutes, outcome, interviewer_names, notes, created_at, updated_at",
      )
      .eq("application_id", applicationId)
      .order("scheduled_at", { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

/**
 * @param {object} supabase
 * @param {{ applicationId?: string, userId?: string }} scope
 * @returns {Promise<null | {
 *   status: string, appliedAt: string, trackedAt: string, applicationUrl: string,
 *   stages: object[],
 * }>}
 */
export async function fetchTrackingRow(supabase, { applicationId, userId } = {}) {
  // No round trip at all when nothing is selected -- the same short-circuit
  // fetchApplicationDocs makes, and what keeps the "no application selected"
  // case free.
  if (!applicationId || !userId) return null;

  let row = null;
  try {
    // The `user_id` filter is not optional and is not redundant with RLS. It is
    // what keeps an application-scoped lookup from ever reading another user's
    // row if RLS is ever misconfigured -- lib/copilot/applicationDocs.js:26-28
    // states the identical rule for the identical reason. `applicationId` comes
    // off the request body and is a FILTER, never authorization; `userId` is
    // the id `supabase.auth.getUser()` resolved to.
    // `positions ( url, posted_at )` and NOT `description`/`company`/`title`:
    // those three arrive already fetched and already capped from
    // `loadAnswerContext`, and re-selecting the description here would put it
    // in a bag of fields a prompt builder could be handed wholesale -- the
    // exact coupling lib/copilot/applicationDocs.js:44-58 keeps
    // `fetchPostingDescription` separate to prevent. The two scalars taken here
    // are the remainder of "everything from the company's row" that no existing
    // fetch carries.
    const { data, error } = await supabase
      .from("applications")
      .select("id, status, applied_at, tracked_at, application_url, positions ( url, posted_at )")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    row = data;
  } catch {
    return null;
  }

  const stages = await fetchStages(supabase, applicationId);

  // PostgREST returns an embedded one-to-one relation as an object and a
  // one-to-many as an array; accept either rather than depending on which shape
  // the schema's foreign key happens to produce -- the same either-shape
  // acceptance lib/copilot/applicationDocs.js makes for the same join.
  const position = Array.isArray(row.positions) ? row.positions[0] : row.positions;

  return {
    status: typeof row.status === "string" ? row.status : "",
    appliedAt: typeof row.applied_at === "string" ? row.applied_at : "",
    trackedAt: typeof row.tracked_at === "string" ? row.tracked_at : "",
    applicationUrl: typeof row.application_url === "string" ? row.application_url : "",
    url: typeof position?.url === "string" ? position.url : "",
    postedAt: typeof position?.posted_at === "string" ? position.posted_at : "",
    stages,
  };
}
