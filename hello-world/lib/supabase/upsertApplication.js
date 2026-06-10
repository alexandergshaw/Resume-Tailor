/**
 * Upserts an application row for a given user + position.
 *
 * - status='applied'   → sets applied_at to now
 * - status='tracking'  → clears applied_at (keeps the row, reverts pipeline stage)
 *
 * On conflict (user_id, position_id) only status and applied_at are updated;
 * tracked_at, notes, and application_url are left untouched.
 *
 * Returns the application UUID, or null on any error.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ userId: string, positionId: string, status: string }} params
 * @returns {Promise<string|null>}
 */
export async function upsertApplication(supabase, { userId, positionId, status }) {
  if (!userId || !positionId || !status) return null;

  try {
    const { data, error } = await supabase
      .from("applications")
      .upsert(
        {
          user_id: userId,
          position_id: positionId,
          status,
          applied_at: status === "applied" ? new Date().toISOString() : null,
        },
        { onConflict: "user_id,position_id" },
      )
      .select("id")
      .single();

    if (error) {
      console.error("[upsertApplication] upsert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[upsertApplication] threw:", err?.message || err);
    return null;
  }
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
