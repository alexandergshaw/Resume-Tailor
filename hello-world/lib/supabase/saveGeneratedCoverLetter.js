import { uploadCoverDocx } from "@/lib/document/coverDocxStore.js";

/**
 * Inserts a new row into generated_cover_letters for a completed AI tailoring
 * run. Mirrors saveGeneratedResume.
 *
 * When `docxB64` is provided (the external engine's finished document), it is
 * uploaded to the `resumes` bucket at `${userId}/generated/${id}.docx` and the
 * row's `docx_path` is set so later downloads can serve the faithful file.
 *
 * Returns the new UUID, or null on any error.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   userId: string,
 *   positionId?: string|null,
 *   content: string,
 *   contentLines?: any[],
 *   sourceResumePath?: string|null,
 *   additionalContext?: string|null,
 *   docxB64?: string|null,
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
  docxB64 = null,
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
    const id = data?.id ?? null;

    // Persist the finished external document (best-effort; never fails the
    // save -- uploadCoverDocx already swallows its own errors).
    if (id && typeof docxB64 === "string" && docxB64.length > 0) {
      const path = await uploadCoverDocx(supabase, userId, docxB64, { id });
      if (path) {
        await supabase.from("generated_cover_letters").update({ docx_path: path }).eq("id", id);
      } else {
        console.warn("[saveGeneratedCoverLetter] docx upload failed for id", id);
      }
    }

    return id;
  } catch {
    return null;
  }
}
