// The one edge that makes the position glossary happen.
//
// Everything downstream of this shipped first and was green the whole time --
// the table, the harvest, the research join, the cron worker, the read route,
// the hover card. None of it ran, because nothing ever enqueued a posting. This
// module is that missing call, and it is deliberately the ONLY one: four apply
// seams import this symbol rather than each writing its own `fetch`, so a
// change to the route, the body shape or the failure posture happens once.
//
// THE SHAPE IS THE WHOLE DESIGN, and it is three refusals:
//
//   IT RETURNS NOTHING. Not a resolved promise -- `undefined`. A promise is
//   awaitable, and the first caller to write `await` makes applying to a job
//   depend on a model harvest finishing. `answerCodeLanguage.js`'s
//   `startCodeLanguageResolution` states the same discipline for the same
//   reason: a void start is what makes an `await` on this path unwritable.
//
//   IT SWALLOWS EVERYTHING. Applying must complete, unchanged and silent, with
//   the network down. Three distinct failures are caught, not one: `fetch`
//   rejecting, `fetch` throwing synchronously before a promise exists, and
//   `fetch` being absent altogether (a non-browser render, an old webview).
//   The empty catch is deliberate -- there is no caller left holding a
//   reference to tell.
//
//   IT REFUSES A BLANK ID. A missing id would still be a POST the route has to
//   authenticate, rate-limit and then reject, spending the caller's own hourly
//   allowance to learn nothing. The route's own gate order puts the limiter
//   ahead of field validation on purpose; this keeps junk from reaching it.
//
// `keepalive` matters here specifically: applying is very often followed
// immediately by a navigation -- the Auto-Tailored seam opens a positioned
// popup, the search seam moves the row to Tracking -- and a plain fetch is
// cancelled when the document goes away. The request is small (one id), well
// inside the keepalive body budget.

import { RESEARCH_FLOOR } from "./glossaryConstants.js";

/** The shipped route. Note this is NOT the spec's `/api/position-glossary`. */
const GLOSSARY_ENDPOINT = "/api/copilot/glossary";

function idOf(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Enqueue a posting's glossary research. Fire and forget.
 *
 * Accepts EITHER key. Three of the four apply seams hold a `positionId`; the
 * Edit-application dialog holds only an `applicationId`, and the route resolves
 * that to a position server-side. When both are present the position id wins --
 * it is what the glossary row is keyed on, so passing it saves a lookup.
 *
 * @param {{ positionId?: string, applicationId?: string }} [args]
 * @returns {undefined} always, so `await` on this path is unwritable.
 */
export function startPositionGlossary({ positionId, applicationId } = {}) {
  const position = idOf(positionId);
  const application = idOf(applicationId);
  if (!position && !application) return;

  const body = position ? { positionId: position } : { applicationId: application };

  try {
    // Guarded rather than assumed: this module is imported by client components
    // that also render on the server, where `fetch` may be undefined.
    if (typeof fetch !== "function") return;
    const started = fetch(GLOSSARY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    // `.catch` on the promise, NOT `await` in a try -- awaiting would make this
    // function async, and an async function returns a promise, which is exactly
    // the awaitable shape the void start exists to prevent.
    if (started && typeof started.catch === "function") started.catch(() => {});
  } catch {
    // Synchronous throw. Nothing downstream is waiting to be told.
  }
}

/**
 * THE LAZY BACKSTOP. Should opening this posting enqueue its glossary?
 *
 * The four apply seams only cover postings applied to FROM NOW ON. Everything
 * already in the tracker predates them, and would have stayed dark forever. This
 * is what covers those, plus a `keepalive` POST the browser dropped mid-
 * navigation and a generation the worker never finished. Lazy rather than a bulk
 * sweep, by the owner's choice: spend follows the postings actually opened.
 *
 * IT ANSWERS EXACTLY ONE QUESTION -- "can the route do anything with this?" --
 * and that is why it is narrower than AC-T5's prose. A POST the route refuses is
 * not free. `GENERATION_RATE_LIMIT` is 4 per hour per user and the limiter runs
 * ahead of body validation, so four hopeless POSTs leave the fifth posting -- a
 * genuinely unresearched one -- rate-limited and dark. Each branch below is
 * therefore a gate of the route's, restated:
 *
 *   no row          -> no gate applies; a full generation starts.
 *   cursor < total  -> gate 9 `in-flight`. The worker owns it; re-enqueuing
 *                      would roll the term list out from under its cursor.
 *   `ready`         -> gate 8 `already-ready`, which not even `force` lifts.
 *   partial >= floor-> gate 10 `above-floor`. A second run meets the same terms
 *                      with the same absent sources.
 *   anything else   -> `failed` has its own attempt budget and a visible Retry;
 *                      `unavailable` has no description text to research;
 *                      `quotes-only` is the keyless engine's honest output, and
 *                      on a deployment still without a key, re-enqueuing spends
 *                      the hourly budget to rewrite the identical row.
 *
 * `truncated_reason` is deliberately not consulted. No enqueue gate reads it, so
 * the spec's "`ready`/`partial` with truncated_reason = 'model'" branch is
 * refused by gate 8 or gate 10 wherever it is distinct from the floor test, and
 * subsumed by the floor test wherever it is not.
 *
 * @param {object|null|undefined} row the glossary row as the GET returned it.
 * @returns {boolean}
 */
export function shouldStartBackfill(row) {
  if (!row) return true;

  // Gate 9 first, and unconditionally: an advancing cursor outranks every other
  // signal, including a row sitting at 0% researched.
  const cursor = Number(row.research_cursor) || 0;
  const total = Number(row.research_total) || 0;
  if (cursor < total) return false;

  if (row.status !== "partial") return false;

  // Gate 10's arithmetic, including its divide-by-zero answer: a row that graded
  // nothing scores 0, which is below the floor.
  const researched = Number(row.researched_count) || 0;
  const graded = researched + (Number(row.recalled_count) || 0);
  const ratio = graded > 0 ? researched / graded : 0;
  return ratio < RESEARCH_FLOOR;
}
