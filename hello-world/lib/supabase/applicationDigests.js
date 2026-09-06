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
// always an upsert on the primary key rather than an insert-then-update pair.
// `fields` is whatever of markdown/status/error/sources/engine/
// citation_outcome/researched_at the caller has.
//
// THE UPSERT IS COLUMN-WISE, NOT ROW-WISE. `.upsert(row, { onConflict })`
// sends only the keys present in `row`, so on the UPDATE branch an omitted
// column keeps its EXISTING value — this is not a full-row replace, whatever
// an earlier version of this comment claimed. Two consequences the callers
// depend on, in opposite directions:
//
//   * A write that omits `citation_outcome` leaves the PREVIOUS run's stamp
//     attached to the NEW run's markdown, and every citation marker then
//     splices at an offset computed against a different document. So the
//     digest route passes it on every write, on both paths, and carries
//     markdown, sources and the outcome forward together as one generation.
//   * A write that omits `researched_at` leaves the last SUCCESSFUL research
//     time standing. That is exactly what the failure path wants: `updated_at`
//     below is stamped unconditionally and honestly means "row last written",
//     so it must never be read as research recency.
//
// The whitelist is the only thing standing between `fields` and PostgREST, and
// a field it does not name is dropped in silence — no error, no warning, a 200
// response and a column that stays NULL forever. Anything added to `fields`
// must be added here, spelled EXACTLY as the column is spelled.
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
    // `null` is written EXPLICITLY, mirroring how `error` is handled above.
    // `typeof null === "object"`, so a check written with only the typeof arm
    // lets null through by accident and cannot say whether that was meant —
    // and here it is very much meant. SQL NULL in this column is the only
    // signal separating "this row predates the citation pipeline" from "the
    // pipeline ran and found nothing to cite", the two states render
    // differently, and the failure path carries a legacy row's null forward
    // alongside the markdown it describes.
    if (fields.citation_outcome === null
        || (fields.citation_outcome && typeof fields.citation_outcome === "object")) {
      row.citation_outcome = fields.citation_outcome;
    }
    // NO null arm here, and the asymmetry with the line above is deliberate.
    // `researched_at` is when research last SUCCEEDED; there is no caller that
    // wants to ERASE that, and a failure path is exactly where a stray null
    // would arrive. Omitting the key keeps the stored value, which is the
    // correct behaviour for every non-success write. A timestamp is stored as
    // an ISO string; a Date or an epoch number is refused rather than coerced,
    // because a silently coerced timestamp is indistinguishable from a right
    // one until someone reads it.
    if (typeof fields.researched_at === "string" && fields.researched_at !== "") {
      row.researched_at = fields.researched_at;
    }

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
