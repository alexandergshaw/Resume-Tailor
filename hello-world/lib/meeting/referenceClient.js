// Thin client for the /api/meeting/references route — modeled directly on
// lib/meeting/insightClient.js's `fetchInsights` (see that file's own header
// comment for the full rationale). The one thing worth restating here: this
// is called from a per-card click handler, not a ticking effect, so nothing
// about the "never throws" contract below is load-bearing the way it is for
// insightClient.js's automatic loop — it is kept anyway, so every fetch
// client in this feature resolves the same shape for an ordinary failure
// and a caller never has to remember which one might throw.
//
// Deliberately NOT surfaced: `cached`. The route's own doc says it "may" be
// present, and nothing in this feature renders a "from cache" badge — an
// unconsumed passthrough is a phantom field waiting to be pinned by a test,
// the same call insightClient.js's own header comment makes about
// `includedPageIds`. Add it here the day something actually reads it.

// The route may run a grounded search (no timeout of its own — see
// route.js's `lookup`) plus up to MAX_REFERENCES_PER_INSIGHT page fetches,
// each with its own 15s server-side timeout (see resolveReferences in
// route.js — those run concurrently, not chained, but the search call ahead
// of them has no ceiling at all). Nothing bounds that from THIS side unless
// this client imposes its own deadline, so a stalled model call or a slow
// publisher can otherwise sit a card on "Finding sources…" through the part
// of a live meeting the user actually wanted it for. AbortSignal.timeout is
// this repo's existing idiom for a client-owned deadline (see
// lib/scrape/webSearch.js's REQUEST_TIMEOUT_MS) — 25s leaves headroom for a
// normal grounded search plus the resolve phase while still being a real
// ceiling, well under the worst case this exists to cut off.
const REQUEST_TIMEOUT_MS = 25000;

/**
 * Request references for one meeting insight.
 *
 * `insightText` — the discussion point's own text, verbatim; the route
 *   grounds its search against this.
 * `topic` — the meeting's current topic string, or "" if none has been
 *   established yet; forwarded as-is, same convention as fetchInsights'
 *   `topic` parameter.
 * `engine` — "gemini" | "embedded" | whichever value app/settings/engine.js's
 *   readEngine() currently returns; forwarded verbatim so the server (not
 *   this client) decides what each engine name means, including the 503
 *   this route sends back on the embedded engine.
 *
 * Resolves with one of:
 *   `{ ok: true, references, dropped, grounded }` — a completed lookup.
 *     `references` is always an array of `{ title, url, host }`; `dropped`
 *     always a number; `grounded` always a boolean — each coerced to a safe
 *     default when the route's body is missing or malformed, the same
 *     defensiveness fetchInsights applies to its own fields.
 *   `{ ok: false, error }` — the lookup failed for any reason: a non-ok
 *     status, an unparsable body, a rejected fetch (including the route's
 *     own 503-on-embedded and 401-signed-out responses), this client's own
 *     REQUEST_TIMEOUT_MS deadline expiring, AND a 200 response that still
 *     carries an `error` field — route.js deliberately answers a model
 *     failure with HTTP 200 plus `error` (progressive enhancement: a 5xx
 *     here would read as the whole meeting feature breaking, when only this
 *     one lookup failed), so `!res.ok` alone is not enough to catch it.
 *     `error` is always a non-empty string, suitable to render directly next
 *     to a Retry.
 */
export async function fetchReferences({ insightText, topic, engine }) {
  let res;
  try {
    res = await fetch("/api/meeting/references", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insightText, topic, engine }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // AbortSignal.timeout's own rejection names itself "TimeoutError" (not
    // fetch's usual manually-aborted "AbortError" — verified against this
    // runtime's actual fetch/AbortController implementation, not assumed).
    // Unlike insightClient.js's caller-supplied `signal` — which rethrows an
    // abort so a caller that asked for cancellation can tell it apart from
    // a real failure — nobody asked for THIS one; a deadline this client
    // imposed on itself expiring is just an ordinary, retryable failure,
    // with a message that says so instead of a generic network error.
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      return { ok: false, error: "Reference lookup timed out. Try again." };
    }
    return { ok: false, error: err?.message || "Could not reach the reference service." };
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    return { ok: false, error: json?.error || `Reference request failed (${res.status}).` };
  }

  // See this function's own doc comment above: a 200 can still be a
  // failure. Checked before the ok:true shape is ever built, so a caller
  // can never see `ok: true, references: []` for a lookup that actually
  // failed server-side.
  if (typeof json?.error === "string" && json.error) {
    return { ok: false, error: json.error };
  }

  return {
    ok: true,
    references: Array.isArray(json?.references) ? json.references : [],
    dropped: typeof json?.dropped === "number" ? json.dropped : 0,
    grounded: json?.grounded === true,
  };
}
