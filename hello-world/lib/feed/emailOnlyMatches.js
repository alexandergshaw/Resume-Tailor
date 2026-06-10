// ---------------------------------------------------------------------------
// Email-only "new jobs" matching.
//
// Decouples the "email me new jobs" feature from auto-tailor: given freshly
// ingested feed_postings and the user's saved searches that opted into email
// alerts (regardless of whether auto-tailor is on), pick the postings to email
// about — skipping any we've already alerted the user about.
//
// The pure selection lives here so it can be unit-tested without I/O. The DB
// ledger helpers (load/record) wrap the `email_notified_postings` table.
// ---------------------------------------------------------------------------

import {
  selectQueueCandidates,
  postingExternalId,
  postingToJob,
} from "./selectQueueCandidates";

/**
 * Pick the postings to email about across one user's email-enabled saved
 * searches. Reuses the same matching rules as the auto-apply queue, but never
 * tailors or queues anything. De-dups against an already-notified id set and
 * across searches within the same run.
 *
 * @param {object[]} postings            feed_postings rows
 * @param {object[]} savedSearches       saved_searches rows with email_on_new_jobs
 * @param {Set<string>} alreadyNotified  external ids already emailed to the user
 * @param {number} capPerSearch          max matches to take per saved search
 * @returns {{ jobs: object[], externalIds: string[] }}
 *   jobs: email summary objects ({ title, company, url, savedSearchName,
 *         emailOnNewJobs, notifyEmail, externalId })
 *   externalIds: the new ids that should be recorded as notified
 */
export function selectEmailOnlyJobs(
  postings,
  savedSearches,
  alreadyNotified,
  capPerSearch = 200,
) {
  const notified = alreadyNotified instanceof Set ? alreadyNotified : new Set();
  // `seen` starts from the already-notified set and grows as we collect, so a
  // posting matching several searches is only emailed once.
  const seen = new Set(notified);
  const jobs = [];
  const newIds = [];

  for (const savedSearch of Array.isArray(savedSearches) ? savedSearches : []) {
    if (!savedSearch || !savedSearch.email_on_new_jobs) continue;
    const candidates = selectQueueCandidates(postings, savedSearch, seen, capPerSearch);
    for (const posting of candidates) {
      const extId = postingExternalId(posting);
      if (!extId || seen.has(extId)) continue;
      const job = postingToJob(posting);
      jobs.push({
        title: job.title,
        company: job.company,
        url: job.url,
        savedSearchName: savedSearch.name,
        emailOnNewJobs: true,
        notifyEmail: savedSearch.notify_email || null,
        externalId: extId,
      });
      seen.add(extId);
      newIds.push(extId);
    }
  }

  return { jobs, externalIds: newIds };
}

/**
 * External ids the user has already been emailed about via the email-on-new-jobs
 * feature. Scoped to the candidate ids to keep the query small.
 */
export async function loadAlreadyNotifiedExternalIds(admin, userId, externalIds) {
  const ids = [...new Set((externalIds || []).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from("email_notified_postings")
    .select("external_id")
    .eq("user_id", userId)
    .in("external_id", ids);
  if (error) {
    console.error(
      `[cron] email_notified_postings query failed for user=${userId}:`,
      error.message,
    );
    return new Set();
  }
  return new Set((data || []).map((r) => r.external_id).filter(Boolean));
}

/** Record external ids as already-emailed for the user. Idempotent (upsert). */
export async function recordNotifiedExternalIds(admin, userId, externalIds) {
  const ids = [...new Set((externalIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  const rows = ids.map((external_id) => ({ user_id: userId, external_id }));
  const { error } = await admin
    .from("email_notified_postings")
    .upsert(rows, { onConflict: "user_id,external_id" });
  if (error) {
    console.error(
      `[cron] email_notified_postings insert failed for user=${userId}:`,
      error.message,
    );
  }
}
