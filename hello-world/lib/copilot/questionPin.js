// AC-T1.16..T1.16.3. Owns the ONE decision "is the dashboard's current
// question held, and should that hold still be in force right now". Builds
// entirely on latestQuestionEntry / pinnedQuestionEntry / newerQuestionCount
// from ./currentQuestion.js — this module does not re-decide any of "which
// entry is current", "which entry is pinned" or "how many arrived since";
// it only decides whether the pin from currentQuestion.js should still be
// honoured, and adds the one thing currentQuestion.js deliberately does not
// know about: time.
//
// Why a hold exists at all. A candidate saying "let me think about that" or
// "good question" out loud is asking the dashboard to stop moving while they
// answer, so a later detected question (their own filler, or the
// interviewer's mid-answer clarification) cannot evict the question and
// drafted answer they are currently reading. See voiceCues.js for the
// phrases that set and release it.
//
// Why the hold is BOUNDED. The pin vocabulary is made of reflexive stalling
// tics said at the start of most answers ("good question", "let me think");
// the release vocabulary is a deliberate hand-back many candidates never
// say. Capture rate exceeds release rate, so an unbounded hold's steady
// state is a dashboard stuck on question 1 while the candidate answers
// question 3 — a passive on-screen badge does not fix this, because someone
// mid-answer is reading bullets, not counting badges. The 120s figure
// (PIN_SUPERSEDED_MAX_MS) is not arbitrary: IEC 60601-1-8 time-bounds an
// audio-paused alarm at 120s without operator intervention for
// critical-care ventilators, on exactly this reasoning — a human may
// suspend monitoring, but not indefinitely and not without a visible
// marker.
//
// Why the clock starts at the SUPERSEDE and not at the PIN. A hold with
// nothing newer behind it is hiding nothing from the candidate, so
// expiring it could only yank the panel out from under a long answer for no
// benefit at all. The hold only becomes a liability once something exists
// that the candidate cannot currently see, so the clock is keyed to that
// moment, not to when the hold was set.
//
// What this module deliberately does NOT do: read the system clock or set a
// timer itself - `now` always arrives as an argument, so callers own
// scheduling and this stays testable with no timers and no rendering -
// decide which phrases pin or unpin (voiceCues.js), or render anything (the
// dashboard/panel layer).
import { latestQuestionEntry, pinnedQuestionEntry, newerQuestionCount } from "./currentQuestion.js";

export const PIN_SUPERSEDED_MAX_MS = 120000;

// `pinnedId` / `supersededAt` are the two pieces of state a caller persists
// across renders (typically in useState); `questions` is the live feed;
// `now` is the caller's own clock reading, passed in rather than read here.
// Returns the full next state in one shape so a caller can write it straight
// back: { pinnedId, supersededAt, entry, newerCount, held, expired }.
export function resolvePin({ pinnedId, supersededAt, questions, now } = {}) {
  const list = Array.isArray(questions) ? questions : [];

  // Nothing pinned: the plain unheld view onto whatever is current. This is
  // the byte-identical behaviour every caller had before pinning existed.
  if (pinnedId === null || pinnedId === undefined) {
    return {
      pinnedId: null,
      supersededAt: null,
      entry: latestQuestionEntry(list),
      newerCount: 0,
      held: false,
      expired: false,
    };
  }

  // Nothing to hold onto at all (empty feed, or questions arrived as
  // something other than an array). A hold needs an entry to hold; with no
  // list there is nothing to show and nothing to call "held".
  if (list.length === 0) {
    return {
      pinnedId: null,
      supersededAt: null,
      entry: null,
      newerCount: 0,
      held: false,
      expired: false,
    };
  }

  // newerQuestionCount already folds "pin is stale" and "pin is already
  // last" into 0, which is exactly the "nothing hidden" case this module
  // needs — no need to re-derive either case here.
  const newerCount = newerQuestionCount(list, pinnedId);

  // Held with nothing behind it (AC-T1.16.3): nothing is being hidden, so
  // no clock runs. This also clears any supersededAt left over from an
  // earlier supersede that has since gone away (e.g. via Clear, or a
  // redraft that rebuilds the list) — a stale clock left ticking here would
  // eventually expire a hold that currently has nothing behind it, which is
  // exactly what this branch exists to prevent.
  if (newerCount === 0) {
    return {
      pinnedId,
      supersededAt: null,
      entry: pinnedQuestionEntry(list, pinnedId),
      newerCount: 0,
      held: true,
      expired: false,
    };
  }

  // Held with newer questions behind it (AC-T1.16.2). The clock is anchored
  // to the FIRST supersede: if one is already recorded, keep it; otherwise
  // this is the first moment something became hidden, so start it now.
  // Not restarting on every later arrival is what stops a talkative
  // interviewer from keeping the hold alive indefinitely.
  const startedAt = typeof supersededAt === "number" ? supersededAt : now;

  // `now` guard, written explicitly rather than left to arithmetic. A
  // caller that has not yet read its own clock passes `now: undefined`,
  // and `undefined - startedAt` is NaN, and `NaN >= PIN_SUPERSEDED_MAX_MS`
  // happens to evaluate false — but relying on that would make "no expiry"
  // an accident of NaN comparison semantics rather than a decision, and the
  // day someone changes `>=` to a helper or a different operator it stops
  // being true by accident. So: no usable clock reading means no expiry,
  // full stop, checked explicitly.
  const hasClock = typeof now === "number" && typeof startedAt === "number";
  const expired = hasClock && now - startedAt >= PIN_SUPERSEDED_MAX_MS;

  if (expired) {
    // The hold releases. It must land on the current question, never on
    // null — the panel cannot go blank just because a hold expired.
    return {
      pinnedId: null,
      supersededAt: null,
      entry: latestQuestionEntry(list),
      newerCount: 0,
      held: false,
      expired: true,
    };
  }

  return {
    pinnedId,
    supersededAt: startedAt,
    entry: pinnedQuestionEntry(list, pinnedId),
    newerCount,
    held: true,
    expired: false,
  };
}
