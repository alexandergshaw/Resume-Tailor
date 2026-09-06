import { positionRowFromJob } from "./positionRow";

// ---------------------------------------------------------------------------
// The public entry point for recording a job posting in `public.positions`.
// Isomorphic on purpose, so none of its eight call sites had to change:
//
//   * In the BROWSER it makes no database call at all. It POSTs to
//     /api/positions, which authenticates the caller and performs the merge
//     under the service-role client. This is what lets the permissive
//     `positions_insert_authenticated` / `positions_update_authenticated`
//     policies (both `auth.role() = 'authenticated'`, i.e. any signed-in user
//     may write any row) be dropped later — see the ordering note in
//     app/api/positions/route.js: THIS CODE SHIPS FIRST and stale tabs must
//     drain before the policy is tightened.
//
//   * On the SERVER it merges directly, through the client it was handed. The
//     writer is pulled in with a DYNAMIC import so that server-only module
//     never lands in a client bundle.
//
// Errors are still swallowed and null still means "no position" — position
// persistence must never block the UX, and every caller already branches on a
// null id.
// ---------------------------------------------------------------------------

const POSITIONS_ENDPOINT = "/api/positions";

async function upsertPositionViaApi(job) {
  const res = await fetch(POSITIONS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Only the job. The route reads the caller from the session cookie; a user
    // id sent from here would be attacker-controlled and is never trusted.
    body: JSON.stringify({ job }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("[upsertPosition] /api/positions refused:", res.status, payload?.error || "");
    return null;
  }
  return payload?.positionId ?? null;
}

/**
 * Record a job posting in the shared `positions` catalogue and return its UUID.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase used only on the server
 * @param {object} job normalized job object
 * @returns {Promise<string|null>} position UUID, or null on any failure
 */
export async function upsertPosition(supabase, job) {
  if (!job || typeof job !== "object" || !job.id) return null;

  try {
    if (typeof window !== "undefined") return await upsertPositionViaApi(job);

    const { writePositionMerged } = await import("./writePosition.js");
    const { id, error } = await writePositionMerged(supabase, positionRowFromJob(job));
    if (error) {
      console.error("[upsertPosition] write failed:", error.message);
      return null;
    }
    return id ?? null;
  } catch (err) {
    console.error("[upsertPosition] threw:", err?.message || err);
    return null;
  }
}

/**
 * Apply the Edit Application dialog's typed title/company/description to a
 * position. Browser-only, and deliberately NOT silent: the dialog shows the
 * message, so a refusal has to reach it.
 *
 * The route authorizes this one — the caller must hold an application on the
 * position — which is protection the RLS policy never provided.
 *
 * @param {string} positionId
 * @param {{title?: string, company?: string, description?: string}} fields
 * @returns {Promise<{ error: string|null }>}
 */
export async function editPositionFieldsViaApi(positionId, fields) {
  try {
    const res = await fetch(POSITIONS_ENDPOINT, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positionId,
        ...(fields?.title === undefined ? {} : { title: fields.title }),
        ...(fields?.company === undefined ? {} : { company: fields.company }),
        ...(fields?.description === undefined ? {} : { description: fields.description }),
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) return { error: payload?.error || "Failed to save position changes." };
    return { error: null };
  } catch (err) {
    return { error: err?.message || "Failed to save position changes." };
  }
}
