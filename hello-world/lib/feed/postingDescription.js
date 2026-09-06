// ---------------------------------------------------------------------------
// Getting the WHOLE job description for a single Live Feed posting.
//
// The feed LIST query (app/api/feed/route.js) deliberately omits `raw_data`:
// it returns up to 50 postings at a time and `raw_data` holds entire job
// descriptions, so selecting it there would inflate every feed page load for a
// field that only one posting at a time ever needs. The consequence is that a
// posting object on the client carries `description_snippet` -- a 400-character
// truncation with a trailing ellipsis (see `snippetFrom` in ./normalize.js) --
// and no `description` at all.
//
// The apply (app/api/feed/apply/route.js), auto-apply-queue and cron paths all
// select `raw_data` for the one posting they act on and tailor from
// `raw_data.description`. This module is how the Live Feed's Tailor button gets
// the same text: one targeted single-row read, made only when the user actually
// clicks Tailor, never on a feed page load.
// ---------------------------------------------------------------------------

/** The single-row read that returns one posting's stored full description. */
export const FULL_DESCRIPTION_ENDPOINT = "/api/feed/description";

/**
 * Fetch the stored full description for one feed posting.
 *
 * Never throws and never blocks tailoring: any failure degrades to the
 * truncated snippet already on the posting object, with a `reason` the caller
 * is expected to surface (see `truncatedDescriptionNotice`).
 *
 * @param {object} posting - a feed posting as returned by /api/feed
 * @param {{fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{text: string, full: boolean, reason: string}>}
 */
export async function fetchFullPostingDescription(posting, { fetchImpl } = {}) {
  const snippet = String(posting?.description || posting?.description_snippet || "").trim();
  const id = String(posting?.id || "").trim();

  if (!id) {
    return {
      text: snippet,
      full: false,
      reason: "This posting has no feed id to look its full description up by.",
    };
  }

  // Default through an arrow rather than passing `globalThis.fetch` itself: an
  // unbound reference throws "Illegal invocation" in a real browser even though
  // jsdom tolerates it.
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));

  try {
    const res = await doFetch(`${FULL_DESCRIPTION_ENDPOINT}?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!res?.ok) {
      return {
        text: snippet,
        full: false,
        reason: `The description lookup failed (HTTP ${res?.status ?? 0}).`,
      };
    }

    const json = await res.json();
    const text = typeof json?.description === "string" ? json.description.trim() : "";
    if (json?.full && text) return { text, full: true, reason: "" };

    return {
      text: text || snippet,
      full: false,
      reason: String(json?.reason || "").trim() || "The stored description came back empty.",
    };
  } catch (err) {
    return {
      text: snippet,
      full: false,
      reason: `The description lookup failed (${err?.message || "unknown error"}).`,
    };
  }
}

/**
 * Decide what a /api/tailor request should carry for this posting.
 *
 * The two fields are NOT additive. For Gemini, lib/llm/tailorResume.js builds
 * the prompt as `jobPostingUrl ? "<url>, go fetch it" : "<text>"`, so sending
 * both makes the URL win and throws away the full text we just fetched;
 * app/api/tailor/route.js clears the URL itself for the same reason once its
 * own scrape succeeds. For the embedded engine the precedence is the other way
 * round (text wins, URL is a fallback). Only one of the two is ever sent here.
 *
 * @param {{text?: string, full?: boolean, url?: string}} input
 * @returns {{jobPosting: string, jobPostingUrl: string}}
 */
export function tailorPostingFields({ text, full, url } = {}) {
  const body = String(text || "").trim();
  const link = String(url || "").trim();

  // The whole posting: send it as text, deterministically, with no URL for a
  // prompt builder or a scraper to prefer over it.
  if (full && body) return { jobPosting: body, jobPostingUrl: "" };

  // Only the truncation is available. Sending 400 characters would be strictly
  // worse than what the server can do on its own: /api/tailor scrapes the URL
  // and may recover the whole posting.
  if (link) return { jobPosting: "", jobPostingUrl: link };

  // No URL either -- the truncation is genuinely all there is.
  return { jobPosting: body, jobPostingUrl: "" };
}

/**
 * The message shown when a résumé was tailored without the full description.
 *
 * Falling back to the snippet is acceptable; falling back silently is not --
 * nobody could otherwise tell that a tailored résumé was built on 400
 * characters. Returns "" whenever the engine did see the whole posting, so the
 * warning never cries wolf: `scrapedDescription` is /api/tailor's
 * `jobDescription`, non-empty exactly when the server's own scrape succeeded.
 *
 * @param {{full?: boolean, scrapedDescription?: string, reason?: string}} input
 * @returns {string} the notice, or "" when nothing was truncated
 */
export function truncatedDescriptionNotice({ full, scrapedDescription, reason } = {}) {
  if (full) return "";
  if (String(scrapedDescription || "").trim()) return "";

  const why = String(reason || "").trim();
  const parts = [
    "Tailored without the full job description — only the ~400-character preview shown on this card was available.",
  ];
  if (why) parts.push(why);
  parts.push("Check the generated documents before you send them.");
  return parts.join(" ");
}
