// The single definition site for saved-search field sanitization (N60 S2).
//
// Until now `sanitizeStringArray`, `sanitizeCap`, `sanitizeEmail`,
// `DEFAULT_DAILY_CAP`, `MIN_DAILY_CAP` and `MAX_DAILY_CAP` existed verbatim in
// both app/api/saved-searches/route.js and .../[id]/route.js. Both routes now
// import the public writers below instead of defining their own copies, so a
// third copy (e.g. a future chat-derived writer) has nowhere to drift from.
//
// `sanitizeEmail` and the per-search `notify_email` recipient override are
// DELETED (owner ruling 1): alerts go to the account email only, so there is
// nothing left for an email sanitizer to validate.
//
// The internal helpers below are module-private on purpose: only the public
// writers and the account cap are consumed anywhere in production, and
// exporting a helper with no production importer would create a test-only
// export that moves lib/sourceScan/exportReachability.sweep.test.js's pinned
// counts (owner ruling 2).
//
// `sanitizeChatDerivedSavedSearch` (N60 second chunk, Step B) is a THIRD
// writer, deliberately separate from the two above rather than a shared-flag
// variant of either: it is the one write path a chat turn can reach, and it
// must be STRUCTURALLY incapable of switching on unattended paid work. Its
// return value NEVER contains an `auto_tailor_enabled` key -- not `false`,
// ABSENT -- for any input, including a body that sets the flag in both camel
// and snake case (AC2-C3 part (i)). Only the explicit `FeedAutomationCard`
// control (via sanitizeSavedSearchPatch) can ever flip that field.

import { clampIntervalMinutes } from "@/lib/feed/cronSchedule";

const DEFAULT_DAILY_CAP = 10;
const MIN_DAILY_CAP = 1;
const MAX_DAILY_CAP = 100; // S2 keeps today's value; a later step lowers it.

export const MAX_SAVED_SEARCHES_PER_ACCOUNT = 25;

function sanitizeStringArray(value, { maxItems = 50, maxLen = 200 } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > maxLen) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function sanitizeCap(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_CAP;
  return Math.max(MIN_DAILY_CAP, Math.min(MAX_DAILY_CAP, n));
}

function sanitizeName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 200);
  return trimmed || null;
}

/**
 * Full row for POST. Returns null when `name` is missing/invalid. NEVER
 * carries a notify_email / recipient override (owner ruling 1).
 * @param {object} body
 * @returns {object|null}
 */
export function sanitizeSavedSearchCreate(body) {
  if (!body || typeof body !== "object") return null;
  const name = sanitizeName(body.name);
  if (!name) return null;
  return {
    name,
    job_keywords: sanitizeStringArray(body.jobKeywords ?? body.job_keywords, { maxItems: 25, maxLen: 100 }),
    max_years_exp:
      typeof body.maxYearsExp === "string"
        ? body.maxYearsExp.slice(0, 20)
        : typeof body.max_years_exp === "string"
          ? body.max_years_exp.slice(0, 20)
          : "any",
    selected_categories: sanitizeStringArray(body.selectedCategories ?? body.selected_categories, { maxItems: 50, maxLen: 100 }),
    selected_companies: sanitizeStringArray(body.selectedCompanies ?? body.selected_companies, { maxItems: 200, maxLen: 200 }),
    excluded_companies: sanitizeStringArray(body.excludedCompanies ?? body.excluded_companies, { maxItems: 200, maxLen: 200 }),
    excluded_title_keywords: sanitizeStringArray(body.excludedTitleKeywords ?? body.excluded_title_keywords, { maxItems: 50, maxLen: 100 }),
    auto_tailor_enabled: !!(body.autoTailorEnabled ?? body.auto_tailor_enabled),
    auto_tailor_daily_cap: sanitizeCap(body.autoTailorDailyCap ?? body.auto_tailor_daily_cap),
    email_on_new_jobs: !!(body.emailOnNewJobs ?? body.email_on_new_jobs),
  };
}

/**
 * Partial for PUT: only keys present in `body`. Same vocabulary, plus
 * `last_viewed_at` when `body.markViewed === true`. Also never carries a
 * notify_email / recipient override.
 * @param {object} body
 * @returns {object}
 */
export function sanitizeSavedSearchPatch(body) {
  if (!body || typeof body !== "object") return {};
  const out = {};
  if (typeof body.name === "string") out.name = body.name.trim().slice(0, 200);
  if ("jobKeywords" in body || "job_keywords" in body) {
    out.job_keywords = sanitizeStringArray(body.jobKeywords ?? body.job_keywords, { maxItems: 25, maxLen: 100 });
  }
  if ("maxYearsExp" in body || "max_years_exp" in body) {
    const v = body.maxYearsExp ?? body.max_years_exp;
    out.max_years_exp = typeof v === "string" ? v.slice(0, 20) : "any";
  }
  if ("selectedCategories" in body || "selected_categories" in body) {
    out.selected_categories = sanitizeStringArray(body.selectedCategories ?? body.selected_categories, { maxItems: 50, maxLen: 100 });
  }
  if ("selectedCompanies" in body || "selected_companies" in body) {
    out.selected_companies = sanitizeStringArray(body.selectedCompanies ?? body.selected_companies, { maxItems: 200, maxLen: 200 });
  }
  if ("excludedCompanies" in body || "excluded_companies" in body) {
    out.excluded_companies = sanitizeStringArray(body.excludedCompanies ?? body.excluded_companies, { maxItems: 200, maxLen: 200 });
  }
  if ("excludedTitleKeywords" in body || "excluded_title_keywords" in body) {
    out.excluded_title_keywords = sanitizeStringArray(body.excludedTitleKeywords ?? body.excluded_title_keywords, { maxItems: 50, maxLen: 100 });
  }
  if ("autoTailorEnabled" in body || "auto_tailor_enabled" in body) {
    out.auto_tailor_enabled = !!(body.autoTailorEnabled ?? body.auto_tailor_enabled);
  }
  if ("autoTailorDailyCap" in body || "auto_tailor_daily_cap" in body) {
    out.auto_tailor_daily_cap = sanitizeCap(body.autoTailorDailyCap ?? body.auto_tailor_daily_cap);
  }
  if ("emailOnNewJobs" in body || "email_on_new_jobs" in body) {
    out.email_on_new_jobs = !!(body.emailOnNewJobs ?? body.email_on_new_jobs);
  }
  // Marking a search as viewed clears its unviewed-postings bubble.
  if (body.markViewed === true) {
    out.last_viewed_at = new Date().toISOString();
  }
  return out;
}

/**
 * Full row for a chat-derived saved search (N60 second chunk, Step B,
 * AC2-C3/AC2-C4/AC2-C5). Returns null when there is nothing to key a search
 * on (mirrors sanitizeSavedSearchCreate's name-required refusal) -- the caller
 * (the apply route) turns that into a 400.
 *
 * Deliberately NEVER sets `auto_tailor_enabled`, for any input: a chat turn
 * cannot enable unattended tailoring, structurally rather than by discipline
 * (AC2-C3). The cadence and per-day cap are CLAMPED rather than refused (a
 * job-seeker asking for "every 5 minutes" or "500 a day" is a normal ask, not
 * an error) via the shared clamps this module and lib/feed/cronSchedule.js
 * already apply to every other write path.
 * @param {object} body
 * @returns {object|null}
 */
export function sanitizeChatDerivedSavedSearch(body) {
  if (!body || typeof body !== "object") return null;
  const name = sanitizeName(body.name);
  if (!name) return null;
  return {
    name,
    job_keywords: sanitizeStringArray(body.jobKeywords ?? body.job_keywords, { maxItems: 25, maxLen: 100 }),
    max_years_exp:
      typeof body.maxYearsExp === "string"
        ? body.maxYearsExp.slice(0, 20)
        : typeof body.max_years_exp === "string"
          ? body.max_years_exp.slice(0, 20)
          : "any",
    selected_categories: sanitizeStringArray(body.selectedCategories ?? body.selected_categories, { maxItems: 50, maxLen: 100 }),
    selected_companies: sanitizeStringArray(body.selectedCompanies ?? body.selected_companies, { maxItems: 200, maxLen: 200 }),
    excluded_companies: sanitizeStringArray(body.excludedCompanies ?? body.excluded_companies, { maxItems: 200, maxLen: 200 }),
    excluded_title_keywords: sanitizeStringArray(body.excludedTitleKeywords ?? body.excluded_title_keywords, { maxItems: 50, maxLen: 100 }),
    auto_tailor_daily_cap: sanitizeCap(body.autoTailorDailyCap ?? body.auto_tailor_daily_cap),
    auto_tailor_min_interval_minutes: clampIntervalMinutes(
      body.autoTailorMinIntervalMinutes ?? body.auto_tailor_min_interval_minutes,
    ),
    // Owner ruling 2: the chat MAY set this -- the recipient is account-only
    // and already bounded by the built mail ceilings. Only the enable flag
    // above is excluded, because only it drives unattended LLM spend.
    email_on_new_jobs: !!(body.emailOnNewJobs ?? body.email_on_new_jobs),
  };
}
