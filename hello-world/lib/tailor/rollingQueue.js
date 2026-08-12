// The manual Job Description tab's rolling tailor queue: paste a posting,
// press Tailor, and keep pasting while it works.
//
// runWithConcurrency (lib/tailor/runWithConcurrency.js) is a BATCH primitive
// -- it takes a fixed array and resolves when that array drains, so there is
// no way to hand it more work mid-flight. This module replaces it FOR THE
// MANUAL TAB ONLY: a pure reducer over queue state, so the rules (what a
// Tailor press submits, how many run at once across submissions, when a
// period is actually done) can be pinned by fast tests with no React, no
// timers, and no network. runWithConcurrency itself is untouched -- other
// callers (app/page.js) still use it correctly for genuinely fixed batches.
//
// Statuses on an entry: "idle" (never run) | "pending" (queued) |
// "processing" (in flight) | "done" | "error". This module never reads or
// writes an entry's status directly (lib/tailor/postingQueue.js owns that);
// it only decides IDS -- which ones a Tailor press should submit, and how
// many of them may run at once.

// A posting is a candidate for THIS Tailor press when it has real text and
// has not already succeeded or is not already going. "Already going" covers
// the re-entrancy guard (a double-click must not submit the same posting
// twice); "already succeeded" is the deliberate behaviour change from the
// old submittableEntries -- under a rolling queue, re-submitting a `done`
// posting would re-tailor it and replace a result that already landed.
const ALREADY_QUEUED_OR_FINISHED = new Set(["pending", "processing", "done"]);

export function enqueueTargets(entries) {
  return entries.filter(
    (e) => e.text.trim() !== "" && !ALREADY_QUEUED_OR_FINISHED.has(e.status),
  );
}

// The queue's own bookkeeping, independent of the entries' own status field.
// `total`/`completed` are the tally for the CURRENT active period (from the
// queue going non-empty until it next drains back to idle) -- see `enqueue`
// and `isIdle` below.
export function createQueueState() {
  return { pending: [], inFlight: [], total: 0, completed: 0 };
}

// A period is over only when there is nothing waiting AND nothing running.
// Checking just one of those ends the period early: pending-only would flip
// the UI to idle while workers are still writing results; inFlight-only
// would never notice new work that hasn't started yet.
export function isIdle(state) {
  return state.pending.length === 0 && state.inFlight.length === 0;
}

// Add `ids` to the queue. Ids already pending or already in flight are not
// added again (and do not inflate `total`) -- the re-entrancy guard at the
// state level, so the progress readout's denominator only ever counts real
// work once.
//
// If the queue was idle before this call, a NEW active period is starting:
// `total`/`completed` reset to 0 first, so a press after a previous run has
// fully drained does not carry that run's tally into the next one. If the
// queue was NOT idle, this call is adding to the period already in
// progress, and the running counters are left exactly as they are.
export function enqueue(state, ids) {
  const wasIdle = isIdle(state);
  const pending = state.pending.slice();
  const inFlight = state.inFlight.slice();
  let total = wasIdle ? 0 : state.total;
  const completed = wasIdle ? 0 : state.completed;
  const already = new Set([...pending, ...inFlight]);
  for (const id of ids) {
    if (already.has(id)) continue;
    already.add(id);
    pending.push(id);
    total += 1;
  }
  return { pending, inFlight, total, completed };
}

// Start as many pending items as fit under `limit`, counting everything
// already in flight -- the cap applies to the whole active period, not to
// any one submission, so two submissions of two each cannot together run
// four at once. Returns the ids that were just started (in the order they
// were pending), so the caller knows exactly which workers to kick off.
export function startNext(state, limit) {
  const capacity = Math.max(0, limit - state.inFlight.length);
  if (capacity === 0 || state.pending.length === 0) {
    return { state, started: [] };
  }
  const started = state.pending.slice(0, capacity);
  const pending = state.pending.slice(started.length);
  const inFlight = [...state.inFlight, ...started];
  return { state: { ...state, pending, inFlight }, started };
}

// Record one in-flight id as finished. A late "finish" for something this
// state is not actually running (a straggler from a previous period, or a
// duplicate call) is ignored rather than incrementing `completed` past
// `total` -- that would leave the progress readout reading "3 of 2".
export function finish(state, id) {
  if (!state.inFlight.includes(id)) return state;
  return {
    ...state,
    inFlight: state.inFlight.filter((x) => x !== id),
    completed: state.completed + 1,
  };
}
