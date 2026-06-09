import { createAdminClient } from "@/lib/supabase/admin";
import { tailorResumeHeadless, tailorCoverLetterHeadless } from "@/lib/llm/tailorForUserHeadless";
import { upsertPosition } from "@/lib/supabase/upsertPosition";
import { upsertApplication } from "@/lib/supabase/upsertApplication";
import { saveGeneratedResume } from "@/lib/supabase/saveGeneratedResume";
import { saveGeneratedCoverLetter } from "@/lib/supabase/saveGeneratedCoverLetter";
import {
  selectQueueCandidates,
  postingToJob,
  postingExternalId,
} from "@/lib/feed/selectQueueCandidates";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds, used by Vercel for long-running cron

// Each run sources candidates from the already-ingested `feed_postings` table
// (refreshed every minute by the feed cron), tailors a resume AND a cover
// letter for every newly-matched posting, and parks it in the auto-apply queue.
//
// To control LLM cost/time within a single serverless invocation, we cap the
// number of jobs tailored per user per run. The per-saved-search
// `auto_tailor_daily_cap` still applies as an upper bound per search.
const MAX_TAILORS_PER_USER_PER_RUN = 5;
const ABSOLUTE_USER_CAP = 100; // safety ceiling
// How many recent postings to scan per saved search.
const FEED_SCAN_LIMIT = 200;

/**
 * Returns true if the request is authorized for cron access.
 * Accepts:
 *   - `Authorization: Bearer ${CRON_SECRET}` (manual / Vercel cron with secret)
 *   - Vercel cron auto-header `x-vercel-cron: 1` when CRON_SECRET is unset
 */
function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") || "";
    return header === `Bearer ${secret}`;
  }
  return request.headers.get("x-vercel-cron") === "1";
}

async function loadStorageBuffer(admin, path) {
  try {
    const { data, error } = await admin.storage.from("resumes").download(path);
    if (error || !data) return null;
    const arr = await data.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

// Pull the most recent feed postings. Returns an array of feed_postings rows.
async function loadFeedPostings(admin, savedSearch) {
  const { data, error } = await admin
    .from("feed_postings")
    .select(
      "id, dedup_key, source, source_posting_id, title, company, location, remote_type, employment_type, salary_min, salary_max, description_snippet, min_years_required, url, tags, posted_at, raw_data",
    )
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(FEED_SCAN_LIMIT);

  if (error) {
    console.error(`[cron] feed_postings query failed for search ${savedSearch?.id}:`, error.message);
    return [];
  }
  return data || [];
}

// External ids already in the user's pipeline (any status) — so we never queue
// or tailor the same posting twice.
async function loadAlreadyTrackedExternalIds(admin, userId, externalIds) {
  const ids = [...new Set(externalIds.filter(Boolean))];
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
async function markFeedSaved(admin, userId, postingId) {
  if (!postingId) return;
  try {
    await admin
      .from("feed_user_state")
      .upsert(
        { user_id: userId, posting_id: postingId, saved: true },
        { onConflict: "user_id,posting_id" },
      );
  } catch (err) {
    console.error(`[cron] markFeedSaved failed for posting ${postingId}:`, err?.message || err);
  }
}

async function tailorAndQueueOne({
  admin,
  userId,
  savedSearch,
  posting,
  resumeBuffer,
  coverLetterBuffer,
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
    additionalContext: `Auto-queued by cron from saved search "${savedSearch.name}".`,
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
          additionalContext: `Auto-queued by cron from saved search "${savedSearch.name}".`,
        });
      }
    } catch (err) {
      console.error(`[cron] cover letter failed for user=${userId} job=${job.id}:`, err?.message || err);
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
      auto_search_id: savedSearch.id || null,
      auto_saved_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .eq("user_id", userId);
  if (updErr) {
    console.error(`[cron] failed to queue application ${applicationId}:`, updErr.message);
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

async function processUser({ admin, userId, savedSearches }) {
  const resumeBuffer = await loadStorageBuffer(admin, `${userId}/resume`);
  if (!resumeBuffer) {
    return { userId, skipped: "no-resume", scanned: 0, queued: [] };
  }
  const coverLetterBuffer = await loadStorageBuffer(admin, `${userId}/cover-letter`);

  let totalScanned = 0;
  const queued = [];

  for (const savedSearch of savedSearches) {
    const remaining = MAX_TAILORS_PER_USER_PER_RUN - queued.length;
    if (remaining <= 0) break;

    const postings = await loadFeedPostings(admin, savedSearch);
    totalScanned += postings.length;

    const externalIds = postings.map(postingExternalId).filter(Boolean);
    const alreadyTracked = await loadAlreadyTrackedExternalIds(admin, userId, externalIds);

    const perSearchCap = Math.min(
      ABSOLUTE_USER_CAP,
      Math.max(1, savedSearch.auto_tailor_daily_cap || 10),
    );
    const cap = Math.min(perSearchCap, remaining);

    const candidates = selectQueueCandidates(postings, savedSearch, alreadyTracked, cap);

    for (const posting of candidates) {
      if (queued.length >= MAX_TAILORS_PER_USER_PER_RUN) break;
      try {
        const result = await tailorAndQueueOne({
          admin,
          userId,
          savedSearch,
          posting,
          resumeBuffer,
          coverLetterBuffer,
        });
        if (result) queued.push(result);
      } catch (err) {
        console.error(`[cron] queue failed for user=${userId} posting=${posting?.id}:`, err?.message || err);
      }
    }

    await admin
      .from("saved_searches")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", savedSearch.id);
  }

  if (queued.length === 0) {
    return { userId, scanned: totalScanned, queued: [] };
  }

  // One notification per run summarizing the newly queued jobs.
  const titlePart =
    queued.length === 1
      ? `New job ready to auto-apply: ${queued[0].title}`
      : `${queued.length} new jobs ready to auto-apply`;
  const bodyPart = queued
    .map((t) => `• ${t.title}${t.company ? ` — ${t.company}` : ""}`)
    .join("\n");
  try {
    await admin.from("notifications").insert({
      user_id: userId,
      kind: "auto_tailor",
      title: titlePart,
      body: bodyPart,
      related_application_id: queued[0].applicationId || null,
      related_position_id: queued[0].positionId || null,
    });
  } catch (err) {
    console.error(`[cron] notification insert failed for user=${userId}:`, err?.message || err);
  }

  return { userId, scanned: totalScanned, queued };
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return Response.json(
      { error: `admin client unavailable: ${err.message}` },
      { status: 500 },
    );
  }

  // Pull every enabled saved search across all users.
  const { data: searches, error: searchErr } = await admin
    .from("saved_searches")
    .select("*")
    .eq("auto_tailor_enabled", true);
  if (searchErr) {
    return Response.json({ error: searchErr.message }, { status: 500 });
  }

  // Group by user.
  const byUser = new Map();
  for (const s of searches || []) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id).push(s);
  }

  const results = [];
  for (const [userId, list] of byUser.entries()) {
    try {
      const r = await processUser({ admin, userId, savedSearches: list });
      results.push(r);
    } catch (err) {
      results.push({ userId, error: String(err?.message || err) });
    }
  }

  return Response.json({
    ok: true,
    users: results.length,
    totalQueued: results.reduce(
      (acc, r) => acc + (Array.isArray(r.queued) ? r.queued.length : 0),
      0,
    ),
    results,
  });
}

// Vercel cron sends GETs in some configurations; accept both verbs.
export const GET = POST;
