const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Decode a base64 string into bytes in both the browser and Node.
function base64ToBytes(base64) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/**
 * Inserts a new row into generated_resumes for a completed tailoring run.
 * Each call always creates a new record — generations are not deduped.
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
export async function saveGeneratedResume(supabase, {
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
      .from("generated_resumes")
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

    if (error) {
      console.error("[saveGeneratedResume] insert failed:", error.message);
      return null;
    }

    const id = data?.id ?? null;

    // Persist the finished external document (best-effort; never fails the save).
    if (id && typeof docxB64 === "string" && docxB64.length > 0) {
      const path = `${userId}/generated/${id}.docx`;
      try {
        const { error: uploadError } = await supabase.storage
          .from("resumes")
          .upload(path, base64ToBytes(docxB64), { contentType: DOCX_MIME, upsert: true });
        if (uploadError) {
          console.warn("[saveGeneratedResume] docx upload failed:", uploadError.message);
        } else {
          await supabase.from("generated_resumes").update({ docx_path: path }).eq("id", id);
        }
      } catch (err) {
        console.warn("[saveGeneratedResume] docx upload threw:", err?.message || err);
      }
    }

    return id;
  } catch (err) {
    console.error("[saveGeneratedResume] threw:", err?.message || err);
    return null;
  }
}
