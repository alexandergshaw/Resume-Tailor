// Thin client for the /api/meeting/insights route — the network half of the
// meeting copilot's insight loop, modeled directly on
// lib/copilot/answerClient.js's `draftAnswer`. Owns exactly one thing:
// turning a read request into a parsed response (or a shaped failure), never
// WHEN a read happens (that's chunkTrigger.js's decision) or HOW the result
// is merged into what's already on screen (that's app/meeting/
// useMeetingInsights.js's job, same three-way split answerClient.js /
// chunkTrigger.js / useDraftAnswer.js already have on the interview side).
//
// The one place this deliberately diverges from answerClient.js:
// draftAnswer THROWS on a non-ok response, because useDraftAnswer.js already
// has a try/catch built to catch it. useMeetingInsights.js's automatic loop
// is a ticking effect, not a click handler — an uncaught rejection inside a
// setInterval callback has nowhere good to land (no surrounding try/catch a
// caller controls, and React has no error boundary for a promise that
// nobody awaited). So fetchInsights never throws for an ordinary failure —
// a non-ok response, a malformed body, a network error — and instead
// returns a same-shaped `{ ok: false, error }` the hook can render as a
// retryable failure exactly like a resolved value. It's still allowed to
// reject for the ONE case a caller explicitly opts into and is expected to
// handle itself: an aborted request (see `signal` below) rejects with
// `AbortError`, matching `fetch`'s own contract, so a caller using
// AbortController for supersession (as this feature's hook does not — see
// useMeetingInsights.js's generation-counter comment for why not) isn't
// forced to unwrap an `{ ok: false }` shape just to tell "aborted" apart
// from "failed".

/**
 * Request one read of meeting insights.
 *
 * `transcript` — the recent conversation text (already trimmed to whatever
 *   window the caller wants sent; this client does not truncate it).
 * `topic` — the current topic string, or "" if none has been established
 *   yet; forwarded as-is for the route to compare against its own model of
 *   topic continuity (see insightContract.js's `normalizeTopic`).
 * `knownInsightIds` — ids the client already has on screen, so the route can
 *   skip re-sending them (insightContract.js's `normalizeInsights` also
 *   de-dupes against this list server-side, so a client that forgot to send
 *   it degrades to "some repeats slip through", not to a broken read).
 * `pageId` — the page/document the read should ground against, or null/
 *   undefined for none selected.
 * `engine` — "gemini" | "embedded" | whichever value app/settings/engine.js's
 *   readEngine() currently returns; forwarded verbatim, exactly as
 *   answerClient.js forwards it, so the server (not this client) decides
 *   what each engine name means.
 * `signal` — an optional AbortSignal, threaded straight into `fetch`. Not
 *   used by useMeetingInsights.js today (see that file's own comment on why
 *   supersession there is a generation counter, not an abort), but a caller
 *   with a real reason to cancel in flight (rather than merely discard the
 *   result) has a real way to.
 *
 * Resolves with one of:
 *   `{ ok: true, insights, topic, topicChanged }` — a successful read.
 *     These are the route's raw payload fields, NOT re-normalized here —
 *     insightContract.js's normalizeInsights/normalizeTopic are pure
 *     functions of raw input and idempotent on already-normalized input, so
 *     running them a second time client-side would be redundant, not wrong,
 *     but the raw pass-through keeps this client a thin transport layer with
 *     no opinion of its own about what a valid insight looks like — that
 *     opinion lives in exactly one place. `topic` is a plain STRING on the
 *     wire ("" when no topic has been identified yet) and `topicChanged` the
 *     route's own already-normalized verdict on whether it moved — the
 *     client never re-derives that by comparing strings, because
 *     normalizeTopic's whole job is suppressing the trivial rephrases a
 *     naive `!==` would report as a change.
 *
 *     Deliberately NOT surfaced: `includedPageIds`. The route does not send
 *     such a field and is not going to — which page ids a read grounded
 *     against is used server-side, by normalizeSource, to decide which
 *     citations are allowed to survive, and is never a client concern. An
 *     earlier version of this client defaulted and documented it anyway,
 *     which meant its own test pinned a field production cannot produce.
 *     `topicConfidence`, `context` and `degraded`/`degradedReason` are also
 *     on the wire and also not surfaced here — no caller reads them yet, and
 *     a passthrough nothing consumes is another phantom waiting to be
 *     pinned; add each one here when something actually renders it.
 *   `{ ok: false, error }` — the read failed for any reason (non-ok status,
 *     unparsable body, rejected fetch); `error` is always a non-empty
 *     string, suitable to render directly.
 *
 * Rejects only when `signal` aborts the underlying fetch (fetch's own
 * `AbortError`), and does not catch that rejection — every other failure
 * mode is caught and folded into the `{ ok: false }` shape above.
 */
export async function fetchInsights({
  transcript,
  topic,
  knownInsightIds,
  pageId,
  engine,
  signal,
}) {
  let res;
  try {
    res = await fetch("/api/meeting/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        topic,
        knownInsightIds,
        pageId,
        engine,
      }),
      signal,
    });
  } catch (err) {
    // AbortError is a deliberate cancellation, not a failure — let it
    // propagate so a caller that actually passed `signal` can tell "the
    // request never got a chance to fail" apart from "it failed". Every
    // other rejection here (offline, DNS, a proxy reset mid-request) is an
    // ordinary failure the loop should recover from on its own next tick,
    // not something worth throwing into a ticking effect.
    if (err?.name === "AbortError") throw err;
    return { ok: false, error: err?.message || "Could not reach the insight service." };
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    return { ok: false, error: json?.error || `Insight request failed (${res.status}).` };
  }

  return {
    ok: true,
    insights: Array.isArray(json?.insights) ? json.insights : [],
    topic: json?.topic ?? null,
    topicChanged: json?.topicChanged === true,
  };
}
