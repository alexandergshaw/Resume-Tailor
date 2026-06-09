// ---------------------------------------------------------------------------
// Pure selection logic for the Auto-Apply Queue.
//
// Given a batch of already-ingested `feed_postings` rows and a saved search,
// decide which postings should be auto-tailored and queued. Kept free of any
// I/O so it can be unit-tested in isolation and reused by the cron route.
// ---------------------------------------------------------------------------

/** Lowercase + trim a string array, dropping empties. */
export function toLowerList(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
    .filter(Boolean);
}

/** The full text we match keywords against: title + best-available description. */
export function postingText(posting) {
  if (!posting || typeof posting !== "object") return "";
  const title = posting.title || "";
  const description =
    (posting.raw_data && posting.raw_data.description) ||
    posting.description ||
    posting.description_snippet ||
    "";
  return `${title} ${description}`.toLowerCase();
}

/** Every keyword must appear somewhere in title or description. */
export function matchesAllKeywords(posting, keywordsLower) {
  if (keywordsLower.length === 0) return true;
  const haystack = postingText(posting);
  return keywordsLower.every((kw) => haystack.includes(kw));
}

/** Title must contain none of the excluded keywords. */
export function matchesNoExcludedTitleKeywords(posting, excludedLower) {
  if (excludedLower.length === 0) return true;
  const title = (posting?.title || "").toLowerCase();
  return !excludedLower.some((kw) => title.includes(kw));
}

/** Company must not match (substring) any excluded company. */
export function matchesNoExcludedCompany(posting, excludedCompaniesLower) {
  if (excludedCompaniesLower.length === 0) return true;
  const company = (posting?.company || "").toLowerCase();
  return !excludedCompaniesLower.some((c) => company.includes(c));
}

/** Company must be in the include list (by display name, case-insensitive). */
export function matchesIncludedCompany(posting, includedCompaniesLower) {
  if (includedCompaniesLower.length === 0) return true;
  const company = (posting?.company || "").toLowerCase();
  return includedCompaniesLower.includes(company);
}

/**
 * Experience cap: keep postings whose required years are unknown (null) or at
 * or below the cap. Prefers the persisted `min_years_required` column, falling
 * back to a light parse of the posting text.
 */
export function passesMaxYears(posting, maxYears) {
  if (!maxYears || maxYears === "any") return true;
  const cap = Number.parseInt(maxYears, 10);
  if (!Number.isFinite(cap)) return true;

  const persisted = posting?.min_years_required;
  if (persisted == null) {
    // Unknown from ingestion — do a best-effort parse so we don't over-filter.
    const text = postingText(posting);
    const matches = [...text.matchAll(/(\d{1,2})\s*\+?\s*(?:to\s*\d{1,2}\s*)?years?/g)];
    for (const m of matches) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > cap) return false;
    }
    return true;
  }

  const n = Number.parseInt(persisted, 10);
  if (!Number.isFinite(n)) return true;
  return n <= cap;
}

/** A posting's stable external id used to dedup against positions/applications. */
export function postingExternalId(posting) {
  if (!posting || typeof posting !== "object") return "";
  return (
    posting.source_posting_id ||
    (posting.raw_data && posting.raw_data.id) ||
    ""
  );
}

/** Convert a feed_postings row into the job shape `upsertPosition` expects. */
export function postingToJob(posting) {
  const description =
    (posting.raw_data && posting.raw_data.description) ||
    posting.description_snippet ||
    "";
  return {
    id: postingExternalId(posting),
    title: posting.title || "",
    company: posting.company || "",
    location: posting.location || "",
    isRemote: posting.remote_type === "remote",
    employmentType: posting.employment_type || null,
    description,
    url: posting.url || "",
    salaryMin: posting.salary_min ?? null,
    salaryMax: posting.salary_max ?? null,
    postedAt: posting.posted_at || null,
  };
}

/**
 * Select the postings to queue for one saved search.
 *
 * @param {object[]} postings              feed_postings rows
 * @param {object}   savedSearch           a saved_searches row
 * @param {Set<string>} alreadyQueuedIds   external ids already queued/applied for the user
 * @param {number}   cap                   max items to return
 * @returns {object[]} the postings (rows) that should be tailored & queued
 */
export function selectQueueCandidates(postings, savedSearch, alreadyQueuedIds, cap) {
  const list = Array.isArray(postings) ? postings : [];
  const seen = alreadyQueuedIds instanceof Set ? alreadyQueuedIds : new Set();
  const limit = Number.isFinite(cap) && cap > 0 ? cap : 0;
  if (limit === 0) return [];

  const keywordsLower = toLowerList(savedSearch?.job_keywords);
  const excludedTitleLower = toLowerList(savedSearch?.excluded_title_keywords);
  const excludedCompaniesLower = toLowerList(savedSearch?.excluded_companies);
  // selected_companies are stored as slugs; the feed stores display names, so we
  // only filter by them when the saved search also captured names. To stay
  // permissive we skip include-filtering here (the cron already scopes by feed).
  const maxYears = savedSearch?.max_years_exp;

  const out = [];
  const usedIds = new Set();
  for (const posting of list) {
    if (out.length >= limit) break;
    const extId = postingExternalId(posting);
    if (!extId || seen.has(extId) || usedIds.has(extId)) continue;
    if (!matchesAllKeywords(posting, keywordsLower)) continue;
    if (!matchesNoExcludedTitleKeywords(posting, excludedTitleLower)) continue;
    if (!matchesNoExcludedCompany(posting, excludedCompaniesLower)) continue;
    if (!passesMaxYears(posting, maxYears)) continue;
    out.push(posting);
    usedIds.add(extId);
  }
  return out;
}
