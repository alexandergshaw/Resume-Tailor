import { saveGeneratedResume } from "./saveGeneratedResume";
import { saveGeneratedCoverLetter } from "./saveGeneratedCoverLetter";

/**
 * Persists whichever generated document(s) are supplied for one tailoring
 * run and repoints the owning application row at the newest generation.
 * Shared by every interactive generate/revise call site so a cover letter
 * — unlike a resume — no longer only survives in memory: before this
 * helper, only the automated feed queue (lib/feed/tailorAndQueue.js) ever
 * called saveGeneratedCoverLetter, so a cover letter generated in the
 * browser was lost on reload.
 *
 * `resume` and `coverLetter` are each either omitted/null or
 * `{ content, contentLines, docxB64? }`. Tolerates being called with only a
 * resume, only a cover letter, or neither (a no-op returning nulls).
 *
 * AC-7 note: generated_cover_letters has no docx_path column (only
 * generated_resumes does), so a cover letter's docxB64 is never written
 * here even if the caller passes one on `coverLetter`. Bringing cover
 * letters up to parity (faithful docx storage) is a known follow-up that
 * needs its own migration.
 *
 * Every generation is appended as a new row (generations are not deduped —
 * this is the foundation for future version history), so the pointer
 * update below always targets the row(s) this call just inserted.
 *
 * Never throws, and never blocks the caller on a failure: this must not
 * break generation, the preview, or the UI. saveGeneratedResume and
 * saveGeneratedCoverLetter already swallow their own errors and resolve to
 * null; the pointer update below is wrapped the same way.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   userId: string,
 *   positionId?: string|null,
 *   applicationId?: string|null,
 *   resume?: { content: string, contentLines?: any[], docxB64?: string|null }|null,
 *   coverLetter?: { content: string, contentLines?: any[] }|null,
 *   additionalContext?: string|null,
 *   sourceResumePath?: string|null,
 * }} params
 * @returns {Promise<{ resumeId: string|null, coverLetterId: string|null }>}
 */
export async function persistGeneratedDocuments(supabase, {
  userId,
  positionId = null,
  applicationId = null,
  resume = null,
  coverLetter = null,
  additionalContext = null,
  sourceResumePath = null,
} = {}) {
  const outcome = { resumeId: null, coverLetterId: null };
  if (!supabase || !userId) return outcome;

  try {
    if (resume && resume.content) {
      outcome.resumeId = await saveGeneratedResume(supabase, {
        userId,
        positionId,
        content: resume.content,
        contentLines: resume.contentLines || [],
        sourceResumePath,
        additionalContext,
        docxB64: resume.docxB64 || null,
      });
    }

    if (coverLetter && coverLetter.content) {
      outcome.coverLetterId = await saveGeneratedCoverLetter(supabase, {
        userId,
        positionId,
        content: coverLetter.content,
        contentLines: coverLetter.contentLines || [],
        sourceResumePath,
        additionalContext,
      });
    }

    // Move the application's pointer(s) to the newest generation(s). Only
    // touches the columns for documents actually written on this call, so a
    // resume-only revise never clobbers an existing cover_letter_id (or
    // vice versa).
    const updates = {};
    if (outcome.resumeId) updates.resume_used_id = outcome.resumeId;
    if (outcome.coverLetterId) updates.cover_letter_id = outcome.coverLetterId;

    if (Object.keys(updates).length > 0 && (applicationId || positionId)) {
      let query = supabase.from("applications").update(updates);
      query = applicationId
        // The tenant filter this statement had none of — its only other
        // predicate was an id, so nothing constrained it to the caller's own
        // row. Same reasoning as deleteApplicationForUser in
        // lib/supabase/applicationStatusWriter.js: whether that was
        // exploitable depends on RLS state on `applications`, which is
        // unknown and must not be assumed either way.
        ? query.eq("id", applicationId).eq("user_id", userId)
        : query.eq("user_id", userId).eq("position_id", positionId);

      const { error } = await query;
      if (error) {
        console.error("[persistGeneratedDocuments] pointer update failed:", error.message);
      }
    }
  } catch (err) {
    console.error("[persistGeneratedDocuments] threw:", err?.message || err);
  }

  return outcome;
}
