import { tailorResumeHeadless, tailorCoverLetterHeadless } from "@/lib/llm/tailorForUserHeadless";
import { upsertApplication } from "@/lib/supabase/upsertApplication";
import { saveGeneratedResume } from "@/lib/supabase/saveGeneratedResume";
import { saveGeneratedCoverLetter } from "@/lib/supabase/saveGeneratedCoverLetter";
import { postingToJob } from "@/lib/feed/selectQueueCandidates";

// Shared tailoring + queueing pipeline used by both the cron route
// (bulk, every saved-search match) and the single-posting API route
// (manual "Auto-apply" button on a Live Feed card). Keeping this in one place
// guarantees identical behaviour across both entry points.

// Map a normalized job into a positions row.
function jobToPositionRow(job) {
  return {
    external_id: String(job.id),
    source: String(job.id).startsWith("gh-") ? "greenhouse" : "jsearch",
    title: job.title ?? null,
    company: job.company ?? null,
    location: job.location ?? null,
    is_remote: job.isRemote ?? null,
    employment_type: job.employmentType ?? null,
    description: job.description ?? null,
    url: job.url ?? null,
    salary_min: job.salaryMin ?? null,
    salary_max: job.salaryMax ?? null,
    posted_at: job.postedAt ?? null,
    raw_data: job,
  };
}

// Upsert a position and return its id. Unlike the shared upsertPosition helper
// (which swallows errors), this surfaces the underlying Postgres error so the
// caller can report it. Falls back to select-then-insert if the ON CONFLICT
// target constraint is missing.
async function upsertPositionOrThrow(admin, job) {
  const row = jobToPositionRow(job);

  const { data, error } = await admin
    .from("positions")
    .upsert(row, { onConflict: "external_id" })
    .select("id")
    .single();

  if (!error) return data?.id ?? null;

  // If there's no unique constraint on external_id, ON CONFLICT can't be used.
  // Fall back to a manual select-then-insert/update.
  const noConstraint =
    /no unique|exclusion constraint|on conflict/i.test(error.message || "");
  if (!noConstraint) {
    throw new Error(`Could not save the position: ${error.message}`);
  }

  const { data: existing, error: selErr } = await admin
    .from("positions")
    .select("id")
    .eq("external_id", row.external_id)
    .maybeSingle();
  if (selErr) {
    throw new Error(`Could not look up the position: ${selErr.message}`);
  }

  if (existing?.id) {
    const { error: updErr } = await admin
      .from("positions")
      .update(row)
      .eq("id", existing.id);
    if (updErr) {
      throw new Error(`Could not update the position: ${updErr.message}`);
    }
    return existing.id;
  }

  const { data: inserted, error: insErr } = await admin
    .from("positions")
    .insert(row)
    .select("id")
    .single();
  if (insErr) {
    throw new Error(`Could not insert the position: ${insErr.message}`);
  }
  return inserted?.id ?? null;
}

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
export async function loadAlreadyTrackedExternalIds(admin, userId, externalIds, statuses = null) {
  const ids = [...new Set((externalIds || []).filter(Boolean))];
  if (ids.length === 0) return new Set();
  let query = admin
    .from("positions")
    .select("external_id, applications!inner(user_id, status)")
    .in("external_id", ids)
    .eq("applications.user_id", userId);
  if (Array.isArray(statuses) && statuses.length > 0) {
    query = query.in("applications.status", statuses);
  }
  const { data } = await query;
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
  if (!job.id) {
    throw new Error("Posting is missing a stable id (source_posting_id / raw_data.id).");
  }

  const positionId = await upsertPositionOrThrow(admin, job);
  if (!positionId) {
    throw new Error("Could not save the position (no id returned).");
  }

  // Resume (required).
  const resumeDraft = await tailorResumeHeadless({
    resumeBuffer,
    jobPosting: job.description || job.title || "",
    jobTitleHint: job.title || "",
    userId,
  });
  if (!resumeDraft?.result) {
    throw new Error("Resume tailoring returned no content.");
  }

  const generatedResumeId = await saveGeneratedResume(admin, {
    userId,
    positionId,
    content: resumeDraft.result,
    contentLines: resumeDraft.resultLines,
    sourceResumePath: `${userId}/resume`,
    additionalContext: `Auto-queued from ${sourceLabel}.`,
    docxB64: resumeDraft.docxB64 || "",
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
        userId,
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
  if (!applicationId) {
    throw new Error("Could not create the application row (upsertApplication failed).");
  }

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
    throw new Error(`Could not move the application into the queue: ${updErr.message}`);
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
