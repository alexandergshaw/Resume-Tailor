import { writeApplicationStatus } from "./applicationStatusWriter.js";

/**
 * Upserts an application row for a given user + position, promoting it to
 * `status` — never demoting a row already at an applied-or-later status.
 *
 * This is now a thin wrapper around `writeApplicationStatus` (the fail-closed
 * allow-list writer at `lib/supabase/applicationStatusWriter.js`, PART 3 of
 * `3-plan-dataloss.md`). It used to upsert unconditionally with
 * `applied_at: status === "applied" ? now() : null` — which meant ANY
 * non-"applied" write (tracking a job, tailoring one, auto-queueing) both
 * overwrote a real `status` back to pre-apply AND nulled a real `applied_at`
 * on a row the user had already applied to (see
 * `test/repro/appliedStatusDataLoss.test.js` REPRO D1, and REPRO D4 for the
 * mirror-image defect: an unconditional "applied" write re-stamping a
 * genuine `applied_at` with `now()`). `writeApplicationStatus` refuses both
 * directions by construction: an UPDATE guarded by an allow-list of
 * pre-apply statuses, and an insert that can only ever set `applied_at` once.
 *
 * Signature and return type (`Promise<string|null>`) are FROZEN —
 * `lib/feed/tailorAndQueue.test.js:86` and three call sites inside
 * `app/page.js` (`handleTrackJob`, `handleUrlSubmit`, `handleTailorFeedPosting`)
 * all await a bare id, not the writer's richer `{id, changed, reason, ...}`
 * object, so they inherit every one of the writer's guards without changing
 * a character at the call site.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ userId: string, positionId: string, status: string }} params
 * @returns {Promise<string|null>}
 */
export async function upsertApplication(supabase, { userId, positionId, status }) {
  const result = await writeApplicationStatus(supabase, { userId, positionId, status });
  return result.id;
}

/**
 * Looks up the positions.id UUID for a given external job ID string.
 * Returns null if not found.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} externalId  e.g. "gh-12345" or a JSearch job_id
 * @returns {Promise<string|null>}
 */
export async function getPositionId(supabase, externalId) {
  if (!externalId) return null;
  try {
    const { data } = await supabase
      .from("positions")
      .select("id")
      .eq("external_id", externalId)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}
