// The pure decision behind the meeting copilot's automatic insight reads:
// given how much new speech has landed, how long ago the room went quiet,
// how long ago the last read happened, and whether one is already running,
// should THIS evaluation spend a model call?
//
// lib/copilot/liveHearing.js's `hearingState` is the precedent this follows
// on purpose: a live session needs several small clock comparisons made
// consistently every second, and the interview copilot already learned once
// that leaving those comparisons inline in a hook (rather than one pure,
// fully-argument-driven function) is how a threshold drifts between two call
// sites, or gets duplicated with an off-by-one nobody notices until a live
// meeting either spams the model on every final or never fires at all. Every
// threshold below is exported for the same reason `HEARD_NOTHING_AFTER_MS` is
// exported from liveHearing.js: a caller that wants to know "how long until
// this could fire" reads the constant, it never hardcodes a second copy of
// the number.
//
// `now` is always a caller-supplied argument, never `Date.now()` read from
// inside — the same discipline liveHearing.js documents at its own top, for
// the same reason: a function that consulted the clock itself could not be
// asked "what would you have said one second ago" and could not be asserted
// against twice in a row for equality.

// A burst of finals lands as several short frames in quick succession before
// the room actually pauses; word count (not turn count, not a raw char
// count) is what tells that apart from a real chunk worth reading, because a
// single long turn IS a chunk and three one-word "yeah"s are not — see
// chunkTrigger.test.js's own note on this. 40 words is roughly the length of
// a short, complete thought — enough that a read spent on it says something,
// short enough that a terse but real update ("we're moving the launch to
// March, engineering flagged the auth work as the blocker") isn't held back
// waiting for more.
export const MIN_NEW_WORDS = 40;

// How long the room has to have gone quiet — measured from the last final
// transcript frame, not from the last read — before a chunk is considered
// "settled" rather than "still being said". This is THE debounce: every new
// final pushes this clock forward, so a ten-final burst collapses into
// exactly one fire once the burst actually stops, instead of one fire per
// final. 2.5s is comfortably longer than the pause between two clauses of
// the same sentence but short enough that the copilot still feels like it's
// keeping up with the conversation rather than lagging behind it.
export const SETTLE_MS = 2500;

// The floor between two automatic reads, regardless of how much new speech
// has piled up in between. Without this, a long monologue with natural
// breath-pauses (each one long enough to clear SETTLE_MS on its own) would
// fire a read every few seconds for the length of the monologue. 20s is long
// enough that consecutive reads represent genuinely separate chunks of
// conversation, not the same chunk's own natural breathing room.
export const MIN_INTERVAL_MS = 20000;

// `value` coerced to a finite number, or 0. Used for `newWords`: a caller's
// very first evaluation of a brand-new meeting has never counted any words
// at all, and that absence must read as "zero new words landed", not as a
// NaN that corrupts the comparison below into `false` (NaN < 40 is false,
// which would make an uninitialized counter look like a real 40-word chunk).
function wordsOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// `value` as a finite number, or `null` when it isn't one. Used for
// `lastFinalAt`/`lastReadAt`: unlike `newWords`, a MISSING clock reading here
// must NOT read as "zero" (which would mean "at time zero", i.e. an eternity
// ago, which would make the settle/interval checks below trivially pass) —
// it has to read as "no such event has happened yet in this meeting", which
// this function's callers handle by skipping that particular check
// altogether rather than asking a `now - null` subtraction to make sense.
function clockOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Decide whether the meeting copilot should spend a read on an insight
 * request right now.
 *
 * Returns `{ fire, reason, why }`:
 *   - `fire`: whether to issue the read.
 *   - `reason`: `"chunk"` | `"nudge"` | `null` — WHY it fired, so a caller
 *     that logs or displays "how did this happen" (or a test asserting which
 *     branch actually ran) never has to infer it from which fields were
 *     truthy.
 *   - `why`: the blocking condition's name when `fire` is false, or `""`
 *     when it's true — see chunkTrigger.test.js's own note on this: a bare
 *     boolean would make every failure test pass for the wrong reason, and
 *     the UI needs an honest "waiting for a pause in the conversation"
 *     rather than looking broken with no explanation.
 *
 * Precedence, evaluated top to bottom:
 *   1. `inFlight` blocks everything, including a nudge. Two concurrent reads
 *      would race to write the same insight list, and the generation counter
 *      the calling hook keeps (see useMeetingInsights.js) would discard one
 *      of them anyway — so stacking a second request on top of a running one
 *      spends a model call to accomplish nothing.
 *   2. `nudge` — the user explicitly asked for a read (a button, a voice
 *      cue) — overrides every heuristic below it. This mirrors the interview
 *      copilot's own manual-question path (useLiveSession.js's
 *      addManualQuestion), which skips its own local/remote detection gate
 *      for the same reason: a person who just said "check this" has already
 *      made the judgment call the heuristics below exist to approximate.
 *   3. The automatic path: enough new words, then the room has actually gone
 *      quiet, then the floor since the last read has cleared.
 */
export function insightTrigger({
  now,
  newWords,
  lastFinalAt,
  lastReadAt,
  inFlight = false,
  nudge = false,
} = {}) {
  if (inFlight) {
    return { fire: false, reason: null, why: "in-flight" };
  }

  if (nudge) {
    return { fire: true, reason: "nudge", why: "" };
  }

  // A word count, not a turn count — see MIN_NEW_WORDS's own comment above.
  // This also happens to be what makes an idle meeting cost nothing at all
  // (chunkTrigger.test.js's "costs nothing at all during a silence"): with
  // no new speech this condition can never pass no matter how long `now`
  // drifts forward, so there is no separate "meeting has been idle too long"
  // rule to maintain here — it falls out of this one check for free.
  const words = wordsOrZero(newWords);
  if (words < MIN_NEW_WORDS) {
    return { fire: false, reason: null, why: "no-new-speech" };
  }

  // A brand-new meeting has no `lastFinalAt` yet (nothing has ever finalized
  // to measure from) — clockOrNull's `null` skips this check entirely rather
  // than treating the absence as "settled a moment ago" or "settled forever
  // ago"; either guess could be wrong in a way that changes the outcome, and
  // silently guessing is exactly what this module exists to not do.
  const nowMs = wordsOrZero(now);
  const finalAt = clockOrNull(lastFinalAt);
  if (finalAt !== null && nowMs - finalAt < SETTLE_MS) {
    return { fire: false, reason: null, why: "quiet" };
  }

  // Same reasoning as above for the floor since the last read: no prior read
  // this meeting means nothing to be "too soon" after.
  const readAt = clockOrNull(lastReadAt);
  if (readAt !== null && nowMs - readAt < MIN_INTERVAL_MS) {
    return { fire: false, reason: null, why: "too-soon" };
  }

  return { fire: true, reason: "chunk", why: "" };
}
