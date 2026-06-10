import { createAdminClient } from "@/lib/supabase/admin";
import {
  selectQueueCandidates,
  postingExternalId,
} from "@/lib/feed/selectQueueCandidates";
import {
  loadStorageBuffer,
  loadAlreadyTrackedExternalIds,
  tailorAndQueueOne,
} from "@/lib/feed/tailorAndQueue";
import {
  selectEmailableJobs,
  groupJobsByRecipient,
  buildNewJobsEmail,
} from "@/lib/email/newJobsEmail";
import { sendEmail } from "@/lib/email/sendEmail";

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
          savedSearchId: savedSearch.id,
          sourceLabel: `saved search "${savedSearch.name}"`,
        });
        if (result)
          queued.push({
            ...result,
            savedSearchId: savedSearch.id,
            savedSearchName: savedSearch.name,
            emailOnNewJobs: !!savedSearch.email_on_new_jobs,
            notifyEmail: savedSearch.notify_email || null,
          });
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

  // Best-effort email alert for searches that opted in. Never let an email
  // failure break the queueing pipeline.
  try {
    await emailNewJobs({ admin, userId, queued });
  } catch (err) {
    console.error(`[cron] new-jobs email step failed for user=${userId}:`, err?.message || err);
  }

  return { userId, scanned: totalScanned, queued };
}

// Email a summary of newly-queued jobs to each recipient that opted in. The
// destination is the saved search's `notify_email` override, or the user's
// account email when unset.
async function emailNewJobs({ admin, userId, queued }) {
  const emailable = selectEmailableJobs(queued);
  if (emailable.length === 0) return;

  let fallbackEmail = null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    fallbackEmail = data?.user?.email || null;
  } catch (err) {
    console.error(`[cron] could not resolve account email for user=${userId}:`, err?.message || err);
  }

  const groups = groupJobsByRecipient(emailable, fallbackEmail);
  for (const [to, jobs] of groups.entries()) {
    try {
      const { subject, html, text } = buildNewJobsEmail(jobs);
      const result = await sendEmail({ to, subject, html, text });
      if (result?.skipped) {
        console.warn(`[cron] new-jobs email skipped for user=${userId}: ${result.reason}`);
      }
    } catch (err) {
      console.error(`[cron] new-jobs email failed for user=${userId} to=${to}:`, err?.message || err);
    }
  }
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
