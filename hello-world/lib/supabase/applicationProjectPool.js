// Data access for the pre-warmed example-project pool
// (public.application_project_pool -- see
// supabase/migrations/20261008000000_application_project_pool.sql). One row per
// application, keyed by application_id; `projects` is the whole question-
// independent pool and `status` is 'pending' | 'ready' | 'failed'.
//
// Mirrors lib/supabase/applicationDigests.js function for function: every
// function takes the caller's own authenticated `supabase` client and `userId`
// (never resolves its own session) and scopes every query by `user_id`
// explicitly, in addition to RLS -- defense in depth, not a replacement for it.
// Nothing here throws -- every function returns a result object, so a failed
// call is data the API route can branch on rather than an exception that could
// tear down the route.
//
// Two callers read this table on different paths and need different things:
// the tracking-table prewarm hook asks for MANY applications at once
// (listProjectPools, keyed so the cost gate can look one up per row), while
// the answer route asks for ONE row on every question (getProjectPool -- a
// primary-key lookup, deliberately not routed through any session cache,
// because a cold pool warms mid-interview and a cached read would freeze the
// cold answer for the rest of the session).

const TABLE = "application_project_pool";

// The one pool row for an application, or `{ pool: null, error: null }` when
// none exists yet (never attempted). A transient PostgREST failure comes back
// as `{ pool: null, error }` -- the two are different results on purpose, so a
// caller can tell "no pool" from "could not read the pool".
export async function getProjectPool(supabase, userId, applicationId) {
  try {
    if (!applicationId) return { pool: null, error: "Missing application id." };

    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("application_id", applicationId)
      .maybeSingle();
    if (error) return { pool: null, error: error.message || "Could not load the project pool." };
    return { pool: data || null, error: null };
  } catch (err) {
    return { pool: null, error: err?.message || "Could not load the project pool." };
  }
}

// Pools for a set of application ids, keyed by application_id, so the prewarm
// cost gate (lib/copilot/projectPoolPrewarm.js's selectAutoProjectPoolTargets)
// can look one up per row with `poolsById[applicationId]`. Missing/empty
// `applicationIds` returns an empty map rather than querying with an empty
// `in (...)` list.
export async function listProjectPools(supabase, userId, applicationIds) {
  try {
    const ids = (Array.isArray(applicationIds) ? applicationIds : []).filter(Boolean);
    if (ids.length === 0) return { pools: {}, error: null };

    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .in("application_id", ids);
    if (error) return { pools: null, error: error.message || "Could not load project pools." };

    const pools = {};
    for (const row of data || []) pools[row.application_id] = row;
    return { pools, error: null };
  } catch (err) {
    return { pools: null, error: err?.message || "Could not load project pools." };
  }
}

// Creates or overwrites the one pool row for `applicationId` -- a pool is a
// "latest known" fact about an application, not a history, so this is always an
// upsert on the primary key rather than an insert-then-update pair. `fields` is
// whatever of projects/status/error/engine the caller has.
//
// THE UPSERT IS COLUMN-WISE, NOT ROW-WISE. `.upsert(row, { onConflict })` sends
// only the keys present in `row`, so on the UPDATE branch an omitted column
// keeps its EXISTING value. The prewarm route depends on that: its 'pending'
// write omits `projects`, so a regeneration (force) marks the row in flight
// without wiping the previous pool, and its 'failed' write likewise leaves the
// last good `projects` standing.
//
// The whitelist is the only thing standing between `fields` and PostgREST, and
// a field it does not name is dropped in silence -- no error, no warning, a 200
// response and a column that stays at its default forever. Anything added to
// `fields` must be added here, spelled EXACTLY as the column is spelled.
export async function upsertProjectPool(supabase, userId, applicationId, fields = {}) {
  try {
    if (!applicationId) return { pool: null, error: "Missing application id." };

    const row = {
      application_id: applicationId,
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    // A non-array is refused rather than stored: `projects` is read back as a
    // list on every answer, and a scalar there would be a row that reads as
    // "ready" with nothing in it.
    if (Array.isArray(fields.projects)) row.projects = fields.projects;
    if (typeof fields.status === "string") row.status = fields.status;
    // `null` is written EXPLICITLY: the success path clears a prior failure's
    // message, and `typeof null === "object"` means a check with only the
    // string arm would silently leave the old error attached to a ready pool.
    if (typeof fields.error === "string" || fields.error === null) row.error = fields.error;
    if (typeof fields.engine === "string" || fields.engine === null) row.engine = fields.engine;

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: "application_id" })
      .select()
      .maybeSingle();
    if (error) return { pool: null, error: error.message || "Could not save this project pool." };
    return { pool: data || null, error: null };
  } catch (err) {
    return { pool: null, error: err?.message || "Could not save this project pool." };
  }
}
