/**
 * Inserts a new row into generated_cover_letters for a completed AI tailoring
 * run. Mirrors saveGeneratedResume. Returns the new UUID, or null on any error.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   userId: string,
 *   positionId?: string|null,
 *   content: string,
 *   contentLines?: any[],
 *   sourceResumePath?: string|null,
 *   additionalContext?: string|null,
 * }} params
 * @returns {Promise<string|null>}
 */
export async function saveGeneratedCoverLetter(supabase, {
  userId,
  positionId = null,
  content,
  contentLines = [],
  sourceResumePath = null,
  additionalContext = null,
}) {
  if (!userId || !content) return null;

  try {
    const { data, error } = await supabase
      .from("generated_cover_letters")
      .insert({
        user_id: userId,
        position_id: positionId ?? null,
        content,
        content_lines: contentLines,
        source_resume_path: sourceResumePath ?? null,
        additional_context: additionalContext ?? null,
      })
      .select("id")
      .single();

    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}
