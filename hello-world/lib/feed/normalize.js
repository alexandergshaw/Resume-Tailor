// ---------------------------------------------------------------------------
// Shared normalization helpers for feed ingestion.
//
// These were originally private to `ingestFeed.js` (the Greenhouse path). They
// are extracted here so every source adapter (Greenhouse, Lever, Ashby, RSS)
// produces postings in the exact same shape with consistent text handling.
// ---------------------------------------------------------------------------

/** Strip HTML to readable plain text and decode the common entities. */
export function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|li)>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Build a length-capped plain-text snippet from (possibly HTML) text. */
export function snippetFrom(text, max = 400) {
  const clean = stripHtml(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}…`;
}

/** Infer remote/hybrid/onsite from a free-text location string. */
export function remoteTypeFor(locationName) {
  const lower = (locationName || "").toLowerCase();
  if (!lower) return "unknown";
  if (lower.includes("remote")) return "remote";
  if (lower.includes("hybrid")) return "hybrid";
  return "onsite";
}

/**
 * Parse the minimum years of experience a posting requires. Mirrors the
 * client-side `extractMinYearsRequired` used by Job Search so the feed's
 * experience filter behaves consistently. Returns null when unknown.
 */
export function extractMinYearsRequired(description) {
  if (!description) return null;
  const text = description.toLowerCase();
  const patterns = [
    /(\d+)\s*\+\s*years?/,
    /(\d+)\s*or\s*more\s*years?/,
    /at\s*least\s*(\d+)\s*years?/,
    /minimum\s*(?:of\s*)?(\d+)\s*years?/,
    /(\d+)\s*-\s*\d+\s*years?/,
    /(\d+)\s*to\s*\d+\s*years?/,
    /(\d+)\s*years?\s*(?:of\s*)?(?:professional\s*)?(?:experience|exp)/,
  ];
  const found = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const yrs = parseInt(match[1], 10);
      if (!Number.isNaN(yrs) && yrs <= 25) found.push(yrs);
    }
  }
  return found.length > 0 ? Math.min(...found) : null;
}
