// AC-N18.1..N18.5. Owns the confirm gate: a newly detected question must NOT
// take the panel until the candidate explicitly confirms it, and confirmed
// questions are never evicted, only collapsed into a re-openable list. The
// time-bounded voice-cue "hold" this module's own doc used to contrast
// itself against (./questionPin.js) was fully retired — the confirm gate is
// now the ONLY surface that decides which question is current.
//
// Deliberately no clock: once anything is confirmed, nothing but a confirm
// ever changes `current` — no deadline, no elapsed time, no count. Pure over
// plain arrays, no React, no DOM, no system-clock reads, no timers, same
// discipline as the rest of lib/copilot/.
//
// N18 delta review D8: the returned view no longer carries `waitingCount`.
// M3 (fresh delta review) already removed the field from both callers that
// used to thread it further — useQuestionConfirm.js's own return shape and
// CopilotDashboard.js's WaitingList prop, each noting it "can never differ
// from `waiting.length`" — and this module was the one place still computing
// and returning it, with no consumer left past its own test file. Removed
// here to finish that cleanup rather than leave a dead field at the source
// of the pipe everything else was trimmed from.

function findEntryById(list, id) {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].id === id) return list[i];
  }
  return null;
}

// AC-N18.1: the seed rule. OWNER RULING (delta review F2): with nothing
// confirmed, `current` is the OLDEST unconfirmed entry — the interviewer's
// FIRST detected question — never the latest. The seed must still be
// allowed to land on a provisional entry (the cold-start interviewer's
// opening question is routinely flagged provisional — word-count argmax
// with no candidate turn yet to compare against), so this reads the whole
// list, unfiltered, for `current` itself.
//
// Before this fix `current` tracked latestQuestionEntry(questions) here —
// the dashboard's pre-gate "latest wins" rule, reused wholesale. With three
// questions detected and nothing confirmed, that let the panel silently
// advance 1 -> 2 -> 3 with no confirm at all, and left 1 and 2 reachable
// from neither `current`, `history`, nor `waiting` — exactly the violation
// AC-N18.4/5's "nothing advances without an explicit confirm, and nothing is
// ever evicted" exists to rule out. Landing on the OLDEST entry instead
// means every later arrival must wait for an explicit confirm, exactly like
// every question detected after the very first one already does.
//
// `waiting` is computed the SAME membership way the confirmed view below
// uses: every non-provisional entry that is not `current`. It is never
// unconditionally empty — the second and third questions detected before
// the candidate ever confirms anything are exactly as reachable through
// `waiting` as one detected after a confirm.
function firstUnconfirmedView(list, currentIsSeed) {
  const current = list.find((entry) => entry) || null;
  const waiting = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (entry && !entry.provisional && entry !== current) {
      waiting.push(entry);
    }
  }
  return {
    current,
    currentIsSeed,
    history: [],
    waiting,
  };
}

// `questions` / `confirmedIds` are the two pieces of state a caller owns
// (typically the confirmed-ids array in useState, appended to via
// confirmQuestionId below); this function derives everything else fresh
// each call — no memory of its own, so a retroactive flag change on an
// existing entry (AC-N18.3) is picked up on the very next read.
export function resolveConfirmedView({ questions, confirmedIds } = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const ids = Array.isArray(confirmedIds) ? confirmedIds : [];

  // F8 (delta review): dedupe confirm order BEFORE resolving entries.
  // `confirmedIds` is public state — nothing stops a caller from handing
  // this module a duplicate (e.g. ["a", "b", "a"]) — and without this, the
  // same entry could resolve twice: once as `current` (the array's literal
  // last element) and again inside `history` (from its earlier occurrence).
  // Keeps each id's LAST occurrence only, in the order those last
  // occurrences fall — the same "whichever confirm happened most recently
  // wins" rule `current` already applies to the array as a whole, just
  // applied per id first so no id can occupy two slots at once.
  const lastIndexById = new Map();
  for (let i = 0; i < ids.length; i += 1) lastIndexById.set(ids[i], i);
  const dedupedIds = [];
  for (let i = 0; i < ids.length; i += 1) {
    if (lastIndexById.get(ids[i]) === i) dedupedIds.push(ids[i]);
  }

  // Resolve each confirmed id, in confirm order, to its live entry. An id
  // that no longer names anything in `questions` (a stale id, or one that
  // never existed) is dropped rather than allowed to fabricate a `current`
  // or throw — the same "never blank the panel over bad state" standard
  // pinnedQuestionEntry holds for a stale pin.
  const confirmedEntries = [];
  for (let i = 0; i < dedupedIds.length; i += 1) {
    const entry = findEntryById(list, dedupedIds[i]);
    if (entry) confirmedEntries.push(entry);
  }

  if (confirmedEntries.length === 0) {
    // AC-N18.1: `ids` itself is empty — nothing has ever been confirmed.
    // This is the genuine seed state.
    //
    // OWNER RULING (delta review F2): `ids.length > 0` with nothing
    // resolving is a DIFFERENT state — every previously confirmed id has
    // gone stale (its entry aged out of `questions`), not "nothing was ever
    // confirmed". Falling back to the seed view unconditionally here used
    // to flip `currentIsSeed` back to `true` the moment that happened, and
    // CopilotClient.js wires `answerHidden={currentIsSeed}` straight off
    // it — so a panel already showing a confirmed answer re-hid itself
    // behind "Show answer", with the waiting list gone too, the instant its
    // confirmed entry aged out. `currentIsSeed: false` here is what keeps a
    // revealed panel revealed; the oldest unconfirmed entry is still the
    // right fallback `current`, for the same reason the genuine seed case
    // picks it.
    return firstUnconfirmedView(list, ids.length === 0);
  }

  // AC-N18.2: no clock. `current` is simply whichever confirmed entry was
  // confirmed most recently (the tail of confirm order) — the only thing
  // that ever moves it is a confirm, never a newer arrival.
  const current = confirmedEntries[confirmedEntries.length - 1];

  // Rule 6: entries confirmed before `current`, newest-first.
  const history = confirmedEntries.slice(0, -1).reverse();

  // AC-N18.5 / owner ruling (nothing is ever evicted): `waiting` is bounded
  // by membership alone — every non-provisional, not-yet-confirmed entry in
  // `questions`, order preserved. There is no "boundary" derived from the
  // earliest confirm's position: confirming a later entry (skipping ahead,
  // e.g. the interviewer's third question while the first two were never
  // explicitly acknowledged) must not drop those earlier unconfirmed
  // entries out of `waiting` — nor may confirming the LATEST entry (the
  // ordinary "Show answer" path during seed) make every entry before it
  // vanish. An earlier version of this function computed a boundary at the
  // earliest confirmed entry's index and started `waiting` after it, on the
  // theory that skipping ahead should "consume" everything before it; that
  // reasoning was wrong and left every entry before the first confirm
  // permanently unreachable. An entry is confirmed or it is not — there is
  // no third "skipped" state, and no position-based cutoff either.
  //
  // AC-N18.3: filter on the CURRENT provisional value of each candidate
  // entry, not a cached one — a provisional entry re-enters `waiting` for
  // free once a retroactive speaker remap clears the flag, because this
  // reads `entry.provisional` fresh on every call rather than memoizing
  // anything. Provisional entries are attributed to the voice currently
  // believed to be the candidate; counting them as waiting would offer the
  // candidate an answer to their own sentence.
  const confirmedIdSet = new Set(ids);
  const waiting = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (entry && !entry.provisional && !confirmedIdSet.has(entry.id)) {
      waiting.push(entry);
    }
  }

  return {
    current,
    currentIsSeed: false,
    history,
    waiting,
  };
}

// Rule 5: the oldest unconfirmed non-provisional entry's id — the order the
// interviewer asked them in — or null once nothing is waiting. Built on the
// exact same `waiting` list resolveConfirmedView returns, so the two can
// never disagree about what still needs confirming.
//
// M1 (adversarial delta review): `waiting` deliberately EXCLUDES `current`
// — it IS current, not waiting (see firstUnconfirmedView/resolveConfirmedView
// above) — but before anything has been confirmed, `current` itself has
// never been confirmed either: it is simply the first entry in `questions`
// (AC-N18.1's seed rule), or the oldest unconfirmed entry once every
// previously-confirmed id has aged out (the stale-id fallback, same shape).
// Jumping straight to `waiting[0]` skipped that entry entirely: with
// [a, b, c] and nothing confirmed, `current` is `a`, `waiting` is [b, c],
// and three "Show next" presses confirmed b, then a, then c — past the
// question already on screen, then backwards to it. A `current` that is not
// already in `confirmedIds` has never been confirmed, so confirming it is
// the true next step in the interviewer's own order; a provisional current
// is excluded, since it is never confirmable through this control (only
// through the reveal gate's own button — see resolveConfirmedView's doc on
// why a provisional entry is never "waiting" either).
export function nextConfirmTarget({ questions, confirmedIds } = {}) {
  const ids = Array.isArray(confirmedIds) ? confirmedIds : [];
  const view = resolveConfirmedView({ questions, confirmedIds: ids });
  if (view.current && !view.current.provisional && !ids.includes(view.current.id)) {
    return view.current.id;
  }
  if (!view.waiting.length) return null;
  return view.waiting[0].id;
}

// Append-with-dedupe, pure: never mutates the array it is given, and never
// records the same id twice (confirming an already-confirmed entry again is
// a no-op, not a duplicate history entry).
export function confirmQuestionId(confirmedIds, id) {
  const list = Array.isArray(confirmedIds) ? confirmedIds : [];
  if (list.includes(id)) return list.slice();
  return [...list, id];
}

// M7: the inverse of confirmQuestionId, so a confirm is never permanent —
// most acutely at cold start, where firstUnconfirmedView (above) can land
// `current` on a provisional entry, so the candidate's very first confirm
// can lock in their own sentence with no way back. Pure, never mutates its
// input, and a no-op when `id` was never confirmed — symmetrical with
// confirmQuestionId's own no-op for an id already present.
export function unconfirmQuestionId(confirmedIds, id) {
  const list = Array.isArray(confirmedIds) ? confirmedIds : [];
  return list.filter((existingId) => existingId !== id);
}
