// The one edge that fires IP3's own interview-prep research.
//
// Modelled directly on `lib/copilot/glossaryTrigger.js`'s `startPositionGlossary`
// (reuse.r1.md RU-6): five call sites across `app/page.js` and
// `app/hooks/useManualPostings.js` import this single symbol rather than
// each writing its own `fetch`, so a change to the route, the body shape or
// the failure posture happens once. THE SHAPE IS THE WHOLE DESIGN, and it is
// the same three refusals as that module:
//
//   IT RETURNS NOTHING. Not a resolved promise -- `undefined`. A promise is
//   awaitable, and the first caller to write `await` makes tailoring or
//   marking an application applied depend on a research call finishing.
//
//   IT SWALLOWS EVERYTHING. Tailoring/applying must complete, unchanged and
//   silent, with the network down. Three distinct failures are caught, not
//   one: `fetch` rejecting, `fetch` throwing synchronously before a promise
//   exists, and `fetch` being absent altogether (a non-browser render, an
//   old webview).
//
//   IT REFUSES A BLANK ID. A missing `applicationId` would still be a POST
//   the route has to authenticate, rate-limit and then reject, spending the
//   caller's own rate-limit allowance to learn nothing.
//
// `keepalive` matters here specifically: every one of the five call sites
// fires this immediately after a tailor or an apply completes, which is
// very often followed by a navigation (opening the generated document,
// closing a dialog) -- a plain fetch would be cancelled when the document
// goes away.
//
// `triggerClass` ("B1" | "B3") tells the route which of its two trigger
// classes fired it, since there is exactly one POST verb serving both
// (plan.r1.md §3). Its CHECK constraint on `interview_prep_events` bounds it
// to those two values server-side; this module does not validate it beyond
// what the caller passes, matching the plan's own low-risk assessment (the
// worst a malformed value produces is a wrong diagnostic label, refused
// outright by the CHECK).

/** The route this module posts to (app/api/interview-prep/route.js). */
const PREP_ENDPOINT = "/api/interview-prep";

function idOf(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Enqueue interview-prep research for an application. Fire and forget.
 *
 * @param {{ applicationId?: string, triggerClass?: "B1" | "B3" }} [args]
 * @returns {undefined} always, so `await` on this path is unwritable.
 */
export function startInterviewPrepResearch({ applicationId, triggerClass } = {}) {
  const application = idOf(applicationId);
  if (!application) return;

  const body = { applicationId: application, triggerClass };

  try {
    // Guarded rather than assumed: this module is imported by client
    // components that also render on the server, where `fetch` may be
    // undefined.
    if (typeof fetch !== "function") return;
    const started = fetch(PREP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    // `.catch` on the promise, NOT `await` in a try -- awaiting would make
    // this function async, and an async function returns a promise, which
    // is exactly the awaitable shape the void start exists to prevent.
    if (started && typeof started.catch === "function") started.catch(() => {});
  } catch {
    // Synchronous throw. Nothing downstream is waiting to be told.
  }
}
