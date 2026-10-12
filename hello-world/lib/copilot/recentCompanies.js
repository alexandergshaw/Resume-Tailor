// N124: the pure half of "remember the companies the user recently practiced or
// interviewed for". React-free (like the rest of lib/copilot/), so the recency,
// dedupe and ordering rules are testable in the default node environment. The
// storage half is app/copilot/useRecentCompanies.js; the surface is PostingPicker.
//
// WHAT IS REMEMBERED IS A COMPANY NAME, not a posting id. A tracked posting can be
// deleted, after which a remembered id points at nothing; a company is the stabler
// handle. The name is re-matched against the freshly fetched postings every time
// the picker renders, so a company whose postings are gone is simply not offered.
//
// Every function here is total: bad input degrades to "nothing remembered", never
// to a throw, because the input includes whatever a hand-edited or corrupt
// localStorage value decodes to.

export const RECENT_COMPANIES_STORAGE_KEY = "copilot-recent-companies";

// A recency list, not an archive: five covers a typical active search's current
// targets and keeps the surfaced group short enough to scan.
export const RECENT_COMPANIES_CAP = 5;

// The one empty list. Frozen and shared, so the store's default and an
// emptied/sanitized list are the SAME reference (useSyncExternalStore bails out of a
// re-render on Object.is equality), and so nothing can push into it.
export const NO_RECENT_COMPANIES = Object.freeze([]);

// The identity of a company for matching and dedupe: case- and
// whitespace-insensitive, so "Acme" and " acme " are one company.
function companyKey(company) {
  return typeof company === "string" ? company.trim().toLowerCase() : "";
}

// Normalizes whatever the store decoded into a valid list: entries with a
// non-empty string company only (trimmed), deduped by companyKey keeping the first
// (most recent) occurrence, at most `cap` long. Non-arrays become the empty list.
export function sanitizeRecentCompanies(raw, cap = RECENT_COMPANIES_CAP) {
  if (!Array.isArray(raw)) return NO_RECENT_COMPANIES;
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const company = typeof item?.company === "string" ? item.company.trim() : "";
    const key = companyKey(company);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      company,
      lastUsedAt: Number.isFinite(item.lastUsedAt) ? item.lastUsedAt : 0,
    });
    if (out.length >= cap) break;
  }
  return out.length > 0 ? out : NO_RECENT_COMPANIES;
}

// Records `entry` as the most recent company: any older entry for the same company
// is dropped, the new one goes first, and the list is cut to `cap`. Returns a NEW
// array; a blank or missing company returns `list` itself, untouched.
export function addCompany(list, entry, cap = RECENT_COMPANIES_CAP) {
  const company = typeof entry?.company === "string" ? entry.company.trim() : "";
  const key = companyKey(company);
  if (!key) return list;
  const rest = (Array.isArray(list) ? list : []).filter((item) => companyKey(item?.company) !== key);
  return [{ company, lastUsedAt: entry.lastUsedAt }, ...rest].slice(0, cap);
}

// True iff `company` is one of the remembered companies.
export function isRecentCompany(company, recentList) {
  const key = companyKey(company);
  if (!key || !Array.isArray(recentList)) return false;
  return recentList.some((item) => companyKey(item?.company) === key);
}

// Orders `options` for a grouped picker: the postings of remembered companies first
// (most recently used company first, original order within a company), then every
// other posting in its original order. Each option appears exactly once, and the
// remembered ones form a contiguous prefix -- the shape MUI's `groupBy` needs to
// render one header per group. When no option matches a remembered company (no
// history, or its postings were deleted) it returns `options` itself, which is the
// caller's "nothing to surface" signal.
export function orderRecentFirst(options, recentList) {
  if (!Array.isArray(options) || !Array.isArray(recentList) || recentList.length === 0) return options;
  const rank = new Map();
  recentList.forEach((item, index) => {
    const key = companyKey(item?.company);
    if (key && !rank.has(key)) rank.set(key, index);
  });
  const recent = [];
  const rest = [];
  options.forEach((option, index) => {
    const position = rank.get(companyKey(option?.company));
    if (position === undefined) rest.push(option);
    else recent.push({ option, position, index });
  });
  if (recent.length === 0) return options;
  recent.sort((a, b) => a.position - b.position || a.index - b.index);
  return [...recent.map((r) => r.option), ...rest];
}
