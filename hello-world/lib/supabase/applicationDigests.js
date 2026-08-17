// Data access for the researched "what the posting does not tell you" column
// on the tracking table (public.application_digests — see
// supabase/migrations/20260817000000_application_digests.sql). One row per
// application, keyed by application_id.
//
// Mirrors lib/supabase/experiencePages.js: every function takes the
// caller's own authenticated `supabase` client and `userId` (never resolves
// its own session) and scopes every query by `user_id` explicitly, in
// addition to RLS — defense in depth, not a replacement for it. Nothing here
// throws — every function returns a result object, so a failed call is data
// the API route can branch on rather than an exception that could tear down
// the route.

const TABLE = "application_digests";

// Digests for a set of application ids, keyed by application_id, so the
// tracking table can look one up per row with `digestsById[applicationId]`
// (the shape lib/tracking/applicationDigest.js's selectAutoDigestTargets
// expects). Missing/empty `applicationIds` returns an empty map rather than
// querying with an empty `in (...)` list.
export async function listDigests(supabase, userId, applicationIds) {
  try {
    const ids = (Array.isArray(applicationIds) ? applicationIds : []).filter(Boolean);
    if (ids.length === 0) return { digests: {}, error: null };

    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .in("application_id", ids);
    if (error) return { digests: null, error: error.message || "Could not load digests." };

    const digests = {};
    for (const row of data || []) digests[row.application_id] = row;
    return { digests, error: null };
  } catch (err) {
    return { digests: null, error: err?.message || "Could not load digests." };
  }
}

// Creates or overwrites the one digest row for `applicationId` — a digest is
// a "latest known" fact about an application, not a history, so this is
// always an upsert on the primary key rather than an insert-then-update
// pair. `fields` is whatever of markdown/status/error/sources/engine the
// caller has; anything omitted keeps its column default (or, on an update
// of an existing row, its current value — upsert here is a full-row
// replace, so the API route is expected to pass every field it means to
// keep, matching how it is actually called: one write per digest attempt).
export async function upsertDigest(supabase, userId, applicationId, fields = {}) {
  try {
    if (!applicationId) return { digest: null, error: "Missing application id." };

    const row = {
      application_id: applicationId,
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    if (typeof fields.markdown === "string") row.markdown = fields.markdown;
    if (typeof fields.status === "string") row.status = fields.status;
    if (typeof fields.error === "string" || fields.error === null) row.error = fields.error;
    if (Array.isArray(fields.sources)) row.sources = fields.sources;
    if (typeof fields.engine === "string" || fields.engine === null) row.engine = fields.engine;

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: "application_id" })
      .select()
      .maybeSingle();
    if (error) return { digest: null, error: error.message || "Could not save this digest." };
    return { digest: data || null, error: null };
  } catch (err) {
    return { digest: null, error: err?.message || "Could not save this digest." };
  }
}
