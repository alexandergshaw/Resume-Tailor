import { tailorResumeHeadless, tailorCoverLetterHeadless } from "@/lib/llm/tailorForUserHeadless";
import { upsertPosition } from "@/lib/supabase/upsertPosition";
import { upsertApplication } from "@/lib/supabase/upsertApplication";
import { saveGeneratedResume } from "@/lib/supabase/saveGeneratedResume";
import { saveGeneratedCoverLetter } from "@/lib/supabase/saveGeneratedCoverLetter";
import { postingToJob } from "@/lib/feed/selectQueueCandidates";

// Shared tailoring + queueing pipeline used by both the cron route
// (bulk, every saved-search match) and the single-posting API route
// (manual "Auto-apply" button on a Live Feed card). Keeping this in one place
// guarantees identical behaviour across both entry points.

// Download a file from the "resumes" storage bucket as a Buffer, or null.
export async function loadStorageBuffer(admin, path) {
  try {
    const { data, error } = await admin.storage.from("resumes").download(path);
    if (error || !data) return null;
    const arr = await data.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

// External ids already in the user's pipeline (any status) — so we never queue
// or tailor the same posting twice.
export async function loadAlreadyTrackedExternalIds(admin, userId, externalIds) {
  const ids = [...new Set((externalIds || []).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data } = await admin
    .from("positions")
    .select("external_id, applications!inner(user_id)")
    .in("external_id", ids)
    .eq("applications.user_id", userId);
  return new Set((data || []).map((r) => r.external_id).filter(Boolean));
}

// Mark the source feed posting as "saved" for this user so it also surfaces in
// the Live Feed's saved view.
export async function markFeedSaved(admin, userId, postingId) {
  if (!postingId) return;
  try {
    await admin
      .from("feed_user_state")
      .upsert(
        { user_id: userId, posting_id: postingId, saved: true },
        { onConflict: "user_id,posting_id" },
      );
  } catch (err) {
    console.error(`[tailorAndQueue] markFeedSaved failed for posting ${postingId}:`, err?.message || err);
  }
}

/**
 * Tailor a resume + (best-effort) cover letter for one feed posting and park it
 * in the auto-apply queue (status "auto_queued").
 *
 * @param {object}   args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.admin service-role client
 * @param {string}   args.userId
 * @param {object}   args.posting               a feed_postings row
 * @param {Buffer}   args.resumeBuffer          required
 * @param {Buffer|null} args.coverLetterBuffer  optional template
 * @param {string|null} [args.savedSearchId]    null for manual/single runs
 * @param {string}   [args.sourceLabel]         human label for additional_context
 * @returns {Promise<object|null>} queued summary, or null when it couldn't be queued
 */
export async function tailorAndQueueOne({
  admin,
  userId,
  posting,
  resumeBuffer,
  coverLetterBuffer = null,
  savedSearchId = null,
  sourceLabel = "the Live Feed",
}) {
  const job = postingToJob(posting);
  if (!job.id) return null;

  const positionId = await upsertPosition(admin, job);
  if (!positionId) return null;

  // Resume (required).
  const resumeDraft = await tailorResumeHeadless({
    resumeBuffer,
    jobPosting: job.description || job.title || "",
    jobTitleHint: job.title || "",
  });
  if (!resumeDraft?.result) return null;

  const generatedResumeId = await saveGeneratedResume(admin, {
    userId,
    positionId,
    content: resumeDraft.result,
    contentLines: resumeDraft.resultLines,
    sourceResumePath: `${userId}/resume`,
    additionalContext: `Auto-queued from ${sourceLabel}.`,
  });

  // Cover letter (best-effort; only when the user has a template uploaded).
  let coverLetterId = null;
  if (coverLetterBuffer) {
    try {
      const coverDraft = await tailorCoverLetterHeadless({
        coverLetterBuffer,
        resumeBuffer,
        jobPosting: job.description || job.title || "",
        jobPostingUrl: job.url || "",
        companyName: job.company || "",
        jobTitle: resumeDraft.jobTitle || job.title || "",
      });
      if (coverDraft?.result) {
        coverLetterId = await saveGeneratedCoverLetter(admin, {
          userId,
          positionId,
          content: coverDraft.result,
          contentLines: coverDraft.resultLines,
          sourceResumePath: `${userId}/cover-letter`,
          additionalContext: `Auto-queued from ${sourceLabel}.`,
        });
      }
    } catch (err) {
      console.error(`[tailorAndQueue] cover letter failed for user=${userId} job=${job.id}:`, err?.message || err);
    }
  }

  // Park in the queue: upsert the application then attach queue metadata.
  const applicationId = await upsertApplication(admin, {
    userId,
    positionId,
    status: "tracking",
  });
  if (!applicationId) return null;

  const { error: updErr } = await admin
    .from("applications")
    .update({
      status: "auto_queued",
      resume_used_id: generatedResumeId || null,
      cover_letter_id: coverLetterId || null,
      auto_search_id: savedSearchId || null,
      auto_saved_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .eq("user_id", userId);
  if (updErr) {
    console.error(`[tailorAndQueue] failed to queue application ${applicationId}:`, updErr.message);
  }

  await markFeedSaved(admin, userId, posting.id);

  return {
    applicationId,
    positionId,
    generatedResumeId,
    coverLetterId,
    title: job.title,
    company: job.company,
    url: job.url,
  };
}
