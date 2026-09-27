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
  groupJobsForAccount,
  buildNewJobsEmail,
} from "@/lib/email/newJobsEmail";
import {
  selectEmailOnlyJobs,
  loadAlreadyNotifiedExternalIds,
  recordNotifiedExternalIds,
} from "@/lib/feed/emailOnlyMatches";
import { sendEmail } from "@/lib/email/sendEmail";
import { summarizeRun, SKIP_REASONS } from "@/lib/feed/autoTailorRunLog";
import { MAX_TAILORS_PER_USER_PER_RUN, MAX_TAILORS_PER_USER_PER_UTC_DAY } from "@/lib/feed/autoTailorBounds";
import { reserveDailyTailor } from "@/lib/feed/autoTailorSpendLedger";
import { reserveMailSend } from "@/lib/email/alertMailLedger";
import { isFeatureDisabled } from "@/lib/feed/killSwitch";
import {
  MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY,
  MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY,
} from "@/lib/email/alertMailBounds";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds, used by Vercel for long-running cron

// Each run sources candidates from the already-ingested `feed_postings` table
// (refreshed every minute by the feed cron), tailors a resume AND a cover
// letter for every newly-matched posting, and parks it in the auto-apply queue.
//
// To control LLM cost/time within a single serverless invocation, we cap the
// number of jobs tailored per user per run at MAX_TAILORS_PER_USER_PER_RUN
// (lib/feed/autoTailorBounds.js). The per-saved-search `auto_tailor_daily_cap`
// still applies as an upper bound per search -- it used to be wrapped in a
// second Math.min against a local ABSOLUTE_USER_CAP = 100, but the column is
// already clamped to <= its own cap before it ever reaches here, so that
// second clamp enforced nothing and was deleted (AC-S2): a name asserting an
// absolute ceiling that binds nothing is worse than no name at all.
// How many recent postings to scan per saved search.
const FEED_SCAN_LIMIT = 200;

// N60 S3 (AC-C4) -- how often Vercel actually invokes this route, named so
// every cost assumption that depends on "how many runs per day" (this file's
// own MAX_TAILORS_PER_USER_PER_UTC_DAY math, and any future copy quoting a
// daily total) derives from one constant instead of a copy of "*/15" typed
// out again. MEASURED: the schedule itself is pinned at vercel.json:5 and
// checked by app/api/cron/position-glossary/route.test.js:196-199; this
// constant is the LINK from that literal to a name, proven by
// cronSchedule.test.js in this same directory. Module-private: nothing here
// reads it at runtime (Vercel's own vercel.json is what actually schedules
// this route), so exporting it now would be a test-only export and move
// lib/sourceScan/exportReachability.sweep.test.js's pinned counts (363/435).
const TAILOR_CRON_MINUTES = 15;

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

async function processUser({
  admin,
  userId,
  autoSearches,
  emailOnlySearches,
  autoFeatureError,
  emailFeatureError,
}) {
  let totalScanned = 0;
  const queued = [];
  const skipped = {};
  let autoProcessed = 0;

  // N60 S4: the mail kill switch, read once per user, ahead of both mail
  // paths below (AC-R4/R6, owner ruling: alert_mail fails closed on its own
  // read error, the same as auto_tailor).
  const mailKill = await isFeatureDisabled(admin, "alert_mail");

  // A broken/errored auto-tailor eligibility query skips the whole feature
  // for this user rather than guessing -- the eligibility count and the
  // feature error are reported separately below (AC-R4/AC-R6).
  if (!autoFeatureError && autoSearches.length > 0) {
    // N60 S4: the auto-tailor kill switch, read once per user, before any
    // storage read or tailoring. A read error fails CLOSED (isFeatureDisabled
    // returns disabled:true with ok:false) so an unreadable switch refuses
    // the same way a deliberately-disabled one does, distinguishably.
    const autoKill = await isFeatureDisabled(admin, "auto_tailor");
    if (autoKill.disabled) {
      const reason = autoKill.ok ? SKIP_REASONS.KILL_SWITCH : SKIP_REASONS.KILL_SWITCH_UNREADABLE;
      skipped[reason] = (skipped[reason] || 0) + autoSearches.length;
    } else {
      // N60 S4 (owner ruling 2): the per-user daily cap is user-scoped, no
      // per-search dimension -- the min across the user's auto-enabled
      // searches' own (already-clamped) daily caps and the global ceiling.
      const userDailyCap = Math.min(
        MAX_TAILORS_PER_USER_PER_UTC_DAY,
        // A stored 0 means "none" and must survive as 0 -- `cap || 10` turned it
        // into 10, i.e. a user asking for no unattended work got the default.
        // Only a missing or non-numeric value falls back; a negative floors at 0.
        // The reserve function refuses anything below 1, so 0 tailors nothing.
        ...autoSearches.map((s) =>
          Number.isFinite(s.auto_tailor_daily_cap) ? Math.max(0, s.auto_tailor_daily_cap) : 10,
        ),
      );

      const resumeBuffer = await loadStorageBuffer(admin, `${userId}/resume`);
      if (!resumeBuffer) {
        skipped[SKIP_REASONS.NO_RESUME] = (skipped[SKIP_REASONS.NO_RESUME] || 0) + autoSearches.length;
      } else {
        const coverLetterBuffer = await loadStorageBuffer(admin, `${userId}/cover-letter`);
        // Set once a reserve refuses or the counter is unreadable -- both are
        // user-level terminal states for this run, so no later search may
        // spend either (N60 S4).
        let userStop = false;

        for (const savedSearch of autoSearches) {
          const remaining = MAX_TAILORS_PER_USER_PER_RUN - queued.length;
          if (remaining <= 0) {
            skipped[SKIP_REASONS.PER_RUN_CAP] = (skipped[SKIP_REASONS.PER_RUN_CAP] || 0) + 1;
            break;
          }
          autoProcessed += 1;

          const postings = await loadFeedPostings(admin, savedSearch);
          totalScanned += postings.length;

          const externalIds = postings.map(postingExternalId).filter(Boolean);
          const alreadyTracked = await loadAlreadyTrackedExternalIds(admin, userId, externalIds);

          const perSearchCap = Math.max(1, savedSearch.auto_tailor_daily_cap || 10);
          const cap = Math.min(perSearchCap, remaining);

          const candidates = selectQueueCandidates(postings, savedSearch, alreadyTracked, cap);

          for (const posting of candidates) {
            if (queued.length >= MAX_TAILORS_PER_USER_PER_RUN) break;

            // N60 S4: reserve the daily slot BEFORE any spend. An atomic
            // rpc, so no spend can precede a successful reserve and no
            // overlapping run can spend past the ceiling.
            const reservation = await reserveDailyTailor(admin, userId, { cap: userDailyCap });
            if (!reservation.ok) {
              skipped[SKIP_REASONS.COUNTER_UNREADABLE] = (skipped[SKIP_REASONS.COUNTER_UNREADABLE] || 0) + 1;
              userStop = true;
              break;
            }
            if (!reservation.reserved) {
              skipped[SKIP_REASONS.PER_DAY_CEILING] = (skipped[SKIP_REASONS.PER_DAY_CEILING] || 0) + 1;
              userStop = true;
              break;
            }

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
                });
            } catch (err) {
              skipped[SKIP_REASONS.TAILOR_THREW] = (skipped[SKIP_REASONS.TAILOR_THREW] || 0) + 1;
              console.error(`[cron] queue failed for user=${userId} posting=${posting?.id}:`, err?.message || err);
            }
          }

          await admin
            .from("saved_searches")
            .update({ last_run_at: new Date().toISOString() })
            .eq("id", savedSearch.id);

          if (userStop) break;
        }
      }
    }
  }

  if (queued.length > 0) {
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

    // Best-effort email alert for queued jobs whose search opted in. Never let
    // an email failure break the queueing pipeline.
    try {
      await emailNewJobs({ admin, userId, queued, mailKill });
    } catch (err) {
      console.error(`[cron] new-jobs email step failed for user=${userId}:`, err?.message || err);
    }
  }

  // Email-only alerts: searches that want emails without auto-tailoring. Runs
  // independently of the resume/queue pipeline so it works even with no
  // resume, and independently of an auto-tailor eligibility error (AC-R6).
  let emailedOnly = 0;
  if (!emailFeatureError && emailOnlySearches.length > 0) {
    try {
      emailedOnly = await emailOnlyNewJobs({
        admin,
        userId,
        savedSearches: emailOnlySearches,
        mailKill,
      });
    } catch (err) {
      console.error(`[cron] email-only step failed for user=${userId}:`, err?.message || err);
    }
  }

  return {
    ...summarizeRun({
      userId,
      autoEligible: autoSearches.length,
      autoProcessed,
      tailored: queued.length,
      skipped,
      emailEligible: emailOnlySearches.length,
      emailed: emailedOnly,
      autoFeatureError: autoFeatureError || null,
      emailFeatureError: emailFeatureError || null,
    }),
    scanned: totalScanned,
  };
}

// Email a summary of newly-queued jobs to the account's own email address.
// There is no per-search recipient override (owner ruling 1).
async function emailNewJobs({ admin, userId, queued, mailKill }) {
  const emailable = selectEmailableJobs(queued);
  if (emailable.length === 0) return;

  let accountEmail = null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    accountEmail = data?.user?.email || null;
  } catch (err) {
    console.error(`[cron] could not resolve account email for user=${userId}:`, err?.message || err);
  }

  const groups = groupJobsForAccount(emailable, accountEmail);
  for (const [to, jobs] of groups.entries()) {
    try {
      // N60 S4: the mail kill switch gates every send; a reserved slot is
      // required before sendEmail, never after (owner ruling, same shape as
      // the tailor reserve).
      if (mailKill.disabled) continue;
      const slot = await reserveMailSend(admin, userId, to, {
        perAddressCap: MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY,
        perAccountCap: MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY,
      });
      if (slot.ok && slot.reserved) {
        const { subject, html, text } = buildNewJobsEmail(jobs);
        const result = await sendEmail({ to, subject, html, text });
        if (result?.skipped) {
          console.warn(`[cron] new-jobs email skipped for user=${userId}: ${result.reason}`);
        }
      }
      // slot refused or counter_unreadable => do not send.
    } catch (err) {
      console.error(`[cron] new-jobs email failed for user=${userId} to=${to}:`, err?.message || err);
    }
  }
}

// Email a user about newly-fetched postings matching their email-enabled saved
// searches, without tailoring or queueing anything. Idempotent: postings are
// recorded in `email_notified_postings` once delivered so they're never emailed
// twice. Returns the number of postings emailed about.
async function emailOnlyNewJobs({ admin, userId, savedSearches, mailKill }) {
  if (!Array.isArray(savedSearches) || savedSearches.length === 0) return 0;

  const postings = await loadFeedPostings(admin, null);
  if (postings.length === 0) return 0;

  const externalIds = postings.map(postingExternalId).filter(Boolean);
  const alreadyNotified = await loadAlreadyNotifiedExternalIds(admin, userId, externalIds);

  const { jobs, externalIds: matchedIds } = selectEmailOnlyJobs(
    postings,
    savedSearches,
    alreadyNotified,
    FEED_SCAN_LIMIT,
  );
  if (jobs.length === 0) return 0;

  let accountEmail = null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    accountEmail = data?.user?.email || null;
  } catch (err) {
    console.error(`[cron] could not resolve account email for user=${userId}:`, err?.message || err);
  }

  const groups = groupJobsForAccount(selectEmailableJobs(jobs), accountEmail);
  let anySent = false;
  for (const [to, list] of groups.entries()) {
    try {
      // N60 S4: same kill-switch + reserve-before-send gate as emailNewJobs.
      // A refused/unreadable slot leaves anySent false for this batch, so
      // the carry-forward below (AC-E2) retries these postings next run.
      if (mailKill.disabled) continue;
      const slot = await reserveMailSend(admin, userId, to, {
        perAddressCap: MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY,
        perAccountCap: MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY,
      });
      if (slot.ok && slot.reserved) {
        const { subject, html, text } = buildNewJobsEmail(list);
        const result = await sendEmail({ to, subject, html, text });
        if (result?.skipped) {
          console.warn(`[cron] email-only alert skipped for user=${userId}: ${result.reason}`);
        } else {
          anySent = true;
        }
      }
      // slot refused or counter_unreadable => do not send, do not set anySent.
    } catch (err) {
      console.error(`[cron] email-only alert failed for user=${userId} to=${to}:`, err?.message || err);
    }
  }

  // Only mark postings notified once we've actually delivered at least one
  // email, so a missing API key (sends skipped) doesn't silently drop alerts —
  // they'll be retried on the next run once email is configured.
  if (anySent) {
    await recordNotifiedExternalIds(admin, userId, matchedIds);
  }
  return anySent ? jobs.length : 0;
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

  // Pull the saved searches for each feature INDEPENDENTLY (AC-R6): a broken
  // or missing flag column on one predicate must not take the other feature
  // down with it. Each select is its own try, and neither can 500 the route.
  const auto = await selectFeatureSearches(admin, "auto_tailor_enabled");
  const email = await selectFeatureSearches(admin, "email_on_new_jobs");

  const autoByUser = new Map();
  for (const s of auto.rows) {
    if (!s.auto_tailor_enabled) continue;
    if (!autoByUser.has(s.user_id)) autoByUser.set(s.user_id, []);
    autoByUser.get(s.user_id).push(s);
  }
  // Email-only searches exclude auto-tailor-enabled ones, matching the
  // pre-decoupling behavior: a search that does both is handled entirely by
  // the auto-tailor branch, which sends its own new-jobs email.
  const emailByUser = new Map();
  for (const s of email.rows) {
    if (!(s.email_on_new_jobs && !s.auto_tailor_enabled)) continue;
    if (!emailByUser.has(s.user_id)) emailByUser.set(s.user_id, []);
    emailByUser.get(s.user_id).push(s);
  }

  const userIds = new Set([...autoByUser.keys(), ...emailByUser.keys()]);
  const results = [];
  for (const userId of userIds) {
    try {
      const r = await processUser({
        admin,
        userId,
        autoSearches: autoByUser.get(userId) || [],
        emailOnlySearches: emailByUser.get(userId) || [],
        autoFeatureError: auto.error,
        emailFeatureError: email.error,
      });
      results.push(r);
    } catch (err) {
      results.push({ userId, error: String(err?.message || err) });
    }
  }

  return Response.json({
    ok: true,
    users: results.length,
    autoFeatureError: auto.error,
    emailFeatureError: email.error,
    totalQueued: results.reduce(
      (acc, r) => acc + (Number.isFinite(r.tailored) ? r.tailored : 0),
      0,
    ),
    totalEmailedOnly: results.reduce(
      (acc, r) => acc + (Number.isFinite(r.emailed) ? r.emailed : 0),
      0,
    ),
    results,
  });
}

// Selects the saved searches for one feature's flag column, in its own try
// so a failure reading or filtering on ONE predicate cannot 500 the whole
// route or suppress the other, independent feature (AC-R6).
async function selectFeatureSearches(admin, column) {
  try {
    const { data, error } = await admin.from("saved_searches").select("*").eq(column, true);
    if (error) return { rows: [], error: error.message };
    return { rows: data || [], error: null };
  } catch (err) {
    return { rows: [], error: String(err?.message || err) };
  }
}

// Vercel cron sends GETs in some configurations; accept both verbs.
export const GET = POST;
