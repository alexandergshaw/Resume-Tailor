// ---------------------------------------------------------------------------
// Builds grounded-search queries for the AI job-search ingest source from
// saved searches.
//
// `feed_postings` is a GLOBAL table (docs/REGRESSION.md R-202: it has no
// per-user partition), and a Gemini + Google Search grounded call is a real
// cost, so queries are derived from saved searches ONCE per distinct keyword
// set and shared across every user who asked for the same thing — never one
// call per saved-search row. There is deliberately no new opt-in switch here:
// a saved search that already asked for automated work (auto-tailor or email
// alerts) is in scope, exactly like the existing cron pipeline.
// ---------------------------------------------------------------------------

// How many distinct queries a single ingest run may issue. Each is a real
// grounded model call, so this is the primary cost lever; 3 keeps a run cheap
// while still covering the handful of most common searches per cycle (with
// the per-source cadence gate in llmSearch.js spreading the rest out over
// time rather than dropping them).
const DEFAULT_MAX_QUERIES = 3;

// Trim, drop empties, and (for exclusions/dedupe) lowercase a string array.
function cleanList(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
}

function lowerList(list) {
  return cleanList(list).map((s) => s.toLowerCase());
}

// A stable, order- and case-independent key for "these saved searches want
// the same thing" — so ["react","remote"] and ["Remote","REACT"] collapse to
// one query instead of two.
function keywordSetKey(keywordsLower) {
  return [...new Set(keywordsLower)].sort().join("|");
}

// A plain-language brief, not a literal search-engine query string — Gemini's
// googleSearch tool turns natural language into its own searches, so this
// just needs to state the ask clearly.
function buildQueryText(keywordsLower) {
  return `Find current job postings for: ${keywordsLower.join(", ")}. Only recent, still-open listings.`;
}

/**
 * Turn saved searches into a deduped list of grounded-search queries.
 *
 * @param {object[]} savedSearches           saved_searches rows
 * @param {object}   [opts]
 * @param {number}   [opts.maxQueries]       hard cap on model calls this run
 * @returns {{key:string, query:string, keywords:string[], excludedTitleKeywords:string[], excludedCompanies:string[], maxYears:*}[]}
 */
export function buildSearchQueries(savedSearches, { maxQueries = DEFAULT_MAX_QUERIES } = {}) {
  if (!Array.isArray(savedSearches)) return [];

  const byKey = new Map();
  for (const search of savedSearches) {
    if (!search || typeof search !== "object") continue;
    // Only rows that asked for some form of automated work — the same gate
    // the existing /api/cron/tailor route applies (auto-tailor OR email
    // alerts). No new UI switch to find and flip.
    if (!search.auto_tailor_enabled && !search.email_on_new_jobs) continue;

    const keywordsLower = lowerList(search.job_keywords);
    if (keywordsLower.length === 0) continue; // an empty query poisons a global table

    const key = keywordSetKey(keywordsLower);
    if (byKey.has(key)) continue; // another user already asked for this

    byKey.set(key, {
      key,
      query: buildQueryText(keywordsLower),
      keywords: keywordsLower,
      excludedTitleKeywords: lowerList(search.excluded_title_keywords),
      excludedCompanies: lowerList(search.excluded_companies),
      maxYears: search.max_years_exp ?? "any",
    });
  }

  return [...byKey.values()].slice(0, maxQueries);
}
