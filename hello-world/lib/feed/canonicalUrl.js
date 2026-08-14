// ---------------------------------------------------------------------------
// A posting's identity across sources is its URL, because `feed_postings`'s
// `dedup_key` is namespaced per source (see docs/REGRESSION.md R-202) and
// therefore cannot dedupe a Greenhouse posting against an AI-search hit for
// the SAME job. This module is the one place that decides when two URLs
// mean the same posting.
// ---------------------------------------------------------------------------

// Tracking/campaign params that vary per link-share but never identify the
// posting itself. `gh_jid` is deliberately NOT here: on a Greenhouse-embedded
// careers page (one that proxies boards.greenhouse.io through the company's
// own domain) it IS the posting id, and stripping it would collapse every
// job on that board into a single key.
const TRACKING_PARAM_NAMES = new Set([
  "gh_src",
  "ref",
  "source",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
]);

function isTrackingParam(key) {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAM_NAMES.has(lower);
}

/**
 * Normalize a posting URL so the same job reached two different ways (www vs
 * not, trailing slash, tracking params, param order) produces the same key.
 * Returns "" for anything that is not an http(s) URL — including strings
 * that fail to parse at all — so callers never bucket unrelated garbage
 * together under one empty-string key.
 */
export function canonicalPostingUrl(url) {
  if (!url || typeof url !== "string") return "";

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  const keptParams = [];
  for (const [key, value] of parsed.searchParams) {
    if (isTrackingParam(key)) continue;
    keptParams.push([key, value]);
  }
  // Sort so parameter order in the source URL can't fork the key.
  keptParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = keptParams.map(([k, v]) => `${k}=${v}`).join("&");

  return `${parsed.protocol}//${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * Filter `postings` (each with a `.url`) down to ones not already known and
 * not repeated within the batch itself, keeping the first occurrence of a
 * duplicate. A posting whose URL will not canonicalize is dropped rather
 * than kept under a shared "" key — a feed row with no working link is
 * useless to the user regardless of dedupe.
 */
export function rejectDuplicateUrls(postings, knownUrlKeySet) {
  const known = knownUrlKeySet instanceof Set ? knownUrlKeySet : new Set(knownUrlKeySet || []);
  const seenInBatch = new Set();
  const out = [];
  for (const posting of Array.isArray(postings) ? postings : []) {
    const key = canonicalPostingUrl(posting?.url);
    if (!key) continue;
    if (known.has(key) || seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    out.push(posting);
  }
  return out;
}
