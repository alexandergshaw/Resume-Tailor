// N60 second chunk, Step D -- rowToSavedSearchEntry, extracted out of
// app/page.js so the chat-derived review surface can map an apply-route
// response into the exact same UI entry shape page.js's own saved-search
// load uses (AC2-C2's no-fork guarantee: one mapper, not two that could
// drift). Both app/page.js and app/components/feed/FeedAutomationPanel.js
// import this module in production -- it is not a test-only export.
//
// This ALSO closes a gap the Step A implementer surfaced and left: the
// inline version never mapped auto_tailor_min_interval_minutes, so
// FeedAutomationCard's confirm (which reads entry.autoTailorMinIntervalMinutes)
// always saw undefined and stated the default cadence no matter what interval
// was actually stored. Harmless while nothing could set an interval; Step D's
// chat is what makes it settable, so this is the step that closes it.

/**
 * Maps a saved_searches row (snake_case, as the API returns it) into the
 * shape this UI uses everywhere (camelCase).
 * @param {object} row
 * @returns {object}
 */
export function rowToSavedSearchEntry(row) {
  return {
    id: row.id,
    name: row.name || "",
    jobKeywords: Array.isArray(row.job_keywords) ? row.job_keywords : [],
    maxYearsExp: row.max_years_exp || "any",
    selectedCategories: Array.isArray(row.selected_categories) ? row.selected_categories : [],
    selectedCompanies: Array.isArray(row.selected_companies) ? row.selected_companies : [],
    excludedCompanies: Array.isArray(row.excluded_companies) ? row.excluded_companies : [],
    excludedTitleKeywords: Array.isArray(row.excluded_title_keywords) ? row.excluded_title_keywords : [],
    autoTailorEnabled: !!row.auto_tailor_enabled,
    autoTailorDailyCap: Number.isFinite(row.auto_tailor_daily_cap) ? row.auto_tailor_daily_cap : 10,
    autoTailorMinIntervalMinutes: Number.isFinite(row.auto_tailor_min_interval_minutes)
      ? row.auto_tailor_min_interval_minutes
      : null,
    emailOnNewJobs: !!row.email_on_new_jobs,
  };
}
