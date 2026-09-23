// N50/N53: a plain, framework-free action queue for the interview-prep panel.
// Serialises every generate/restore request PER APPLICATION so at most one is
// ever outstanding at a time (AC-N50.15), while a second click on a different
// section, or on the whole pack, is accepted and shown as queued rather than
// refused -- a section regeneration takes the same whole-row server claim as
// a whole-pack one (GATE 9 in route.js), so letting both POST at once is a
// guaranteed 409 that has already spent a rate-limit token (plan.r2.md
// section 4, the N53 ruling).
//
// This module owns none of that wiring: it is pure, synchronous except for
// the promises callers hand it, and has no React import (node-testable, see
// app/hooks/prepActionQueue.contract.test.js). `app/hooks/
// usePrepActionQueue.js` is its ONLY intended caller -- one instance per
// browser session, module-scope there, so an accepted-but-waiting action
// survives a main-tab switch that unmounts the dialog around it (AC-N50.15(e)).
//
// createPrepActionQueue() is the file's ONLY export.
//
// m6 (N50 fix round 1): an action whose `send()` never settles at all --
// R5's own accepted gap, "a hung send now outlives remounts" -- used to block
// that application's queue for the rest of the session. `timeoutMs` (an
// option, defaulting to DEFAULT_TIMEOUT_MS below so production behaviour is
// unchanged from a bare `createPrepActionQueue()` call) races the real send
// against a timer; whichever settles first is what the queue records, and the
// loser is never awaited further. A timed-out send is normalised through the
// SAME `networkError` shape a rejected send already produces, so every caller
// (PrepSectionActions' own `sectionOutcomeCopy`, M3's server-text branch)
// already knows how to render it without a new outcome shape to learn.
//
// M-1/m-b (N50 fix round 2): m6's own timeout used to just stop AWAITING the
// hung `send` -- it never told it to stop. Two consequences, both fixed here:
//   (1) the request itself lived on, so `usePrepGeneration`'s own in-flight
//       guard (keyed per applicationId+section) never released, and a
//       candidate's retry after the timeout came back `{skipped:true}` --
//       recorded as ANOTHER failure although no second request was ever
//       sent. `drain` now hands `send` an `AbortSignal` and aborts it the
//       moment the timeout wins the race, so the real fetch settles (as a
//       rejection `usePrepGeneration` already turns into a normal error
//       result) and releases its own key -- a retry is then a REAL request.
//   (2) a reply that was already in flight when the client gave up (the
//       route's own maxDuration is close enough to this timeout that a
//       genuine success can still land) was simply discarded, so a
//       generation that actually finished never appeared without the
//       candidate reopening the dialog by hand. `timedOut` outcomes are now
//       flagged (below) so AppViewDialog's settled handler can schedule ONE
//       refetch regardless of `kind`/`status` -- "state unknown, go check" --
//       rather than only refetching a recognized terminal status.
//   m-b: `timeoutMs`'s default must clear a real margin for transit -- a
//   default too short abandons a legitimate generation and lets the next
//   queued entry send its own POST into a claim that is still live
//   server-side, spending a rate-limit token on a guaranteed 409.
//
//   B-1 (N50 fix round 3, verify.r3.md): m-b originally pinned that margin
//   against the ROUTE's own declared `maxDuration` (120s) -- but the
//   constant that actually decides what a post-timeout refetch can observe
//   is the server's own CLAIM LEASE (`prepConstants.js`'s PREP_LEASE_MS,
//   150s today), not the route's function budget: a generation can still be
//   mid-flight, holding its claim, well after 120s. At the old 135s default
//   (120s + 15s), the timeout fired BEFORE the lease could have cleared --
//   the refetch it schedules was then guaranteed, by arithmetic, to read a
//   row the `interview_prep_packs_running_has_no_content` CHECK forces to be
//   empty. PREP_LEASE_MS_LITERAL below mirrors PREP_LEASE_MS as a LITERAL,
//   deliberately NOT an import of prepConstants.js -- this module is
//   node-testable and framework-free by design (this file's own header
//   above), and lib/sourceScan/exportReachability.ledger.js's ORPHAN_EXPORTS
//   already carries PREP_ROUTE_MAX_DURATION_S with its own stated reason for
//   the same discipline; lib/sourceScan is out of scope for this round, so a
//   real import here would move a ledger this round cannot fix. If the
//   route's own lease ever changes, this literal must be updated by hand to
//   match (app/hooks/prepActionQueue.contract.test.js pins the two against
//   each other).

const EMPTY_APP_STATE = Object.freeze({ active: null, queued: Object.freeze([]), outcomes: Object.freeze({}) });
const PREP_LEASE_MS_LITERAL = 150_000;
const TIMEOUT_MARGIN_MS = 15_000;
const DEFAULT_TIMEOUT_MS = PREP_LEASE_MS_LITERAL + TIMEOUT_MARGIN_MS;
const TIMEOUT_MESSAGE = "No reply after a couple of minutes, so this attempt was abandoned here — it may still finish. Check back, or try again.";
// N50 fix round 5 (verify.r5.md M-1): how long a `timedOut` outcome is
// allowed to keep answering "this claim might still be live" while the
// server keeps reporting `running` with nothing fresher to contradict it --
// see `retireStaleTimedOut`'s own header below.
//
// M-1 (N50 fix round 6, verify.r6.md): the 10-minute value this constant
// used to carry was measured to leave a real, reachable window open: a
// candidate reopening 5 minutes after their OWN action timed out, onto a
// totally unrelated run something else started in the meantime (another
// tab, an automatic trigger), still saw that stale outcome's Restore
// controls and section-named banner -- a guaranteed-refusal POST away from
// spending a rate-limit token on a claim this session has no business acting
// on. The ideal fix is EVIDENTIAL, not temporal -- retire the instant a GET
// proves the live claim is a different one, by identity, not merely by
// status -- but the GET response this feature reads (route.js's own GET
// handler, out of this round's scope to change) carries no claim identity of
// its own (no attempt id, no `updated_at`) for a `running` reply to compare
// against, so that evidence does not exist for this module to read. This
// constant is therefore the bound alone, cut from 10 minutes to comfortably
// past the longest window this session could still plausibly be polling
// about the SAME claim (this file's own timeout, plus AppViewDialog.js's two
// scheduled follow-ups, TIMEOUT_FOLLOW_UP_DELAYS_MS = [20s, 40s] -- well
// under two minutes past the timeout itself) -- the exact margin this
// comment already argued for, now actually applied rather than quintupled
// past it. A reopen within this window still reads as plausibly the same
// claim (unchanged from round 5); a reopen past it -- five minutes later, an
// hour later, verify.r5.md's and verify.r6.md's own examples alike -- can no
// longer be told apart from a genuinely different run, so it is retired.
const TIMED_OUT_OUTCOME_MAX_AGE_MS = 2 * 60 * 1000;

/** A `send()` result is normalised so the drain step below can treat it the
 *  same way whatever went wrong: a rejection, a synchronous throw, or a
 *  resolution that is not an object all become one shape. */
function normalizeResult(result) {
  if (result && typeof result === "object") return result;
  return { error: "Request failed.", networkError: true };
}

export function createPrepActionQueue({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const apps = new Map();
  // `send` functions are held OUTSIDE the (frozen, snapshot-safe) app state,
  // keyed by the entry's own sequence number -- a function is never a value
  // a snapshot consumer should see or diff.
  const sends = new Map();
  const listeners = new Set();
  let settledHandler = null;
  let seq = 0;

  const stateFor = (applicationId) => apps.get(applicationId) || EMPTY_APP_STATE;

  function commit(applicationId, next) {
    apps.set(applicationId, Object.freeze({ ...next, outcomes: Object.freeze(next.outcomes) }));
    for (const listener of [...listeners]) listener();
  }

  /** Runs `entry`'s `send()`, then -- once it settles -- awaits the CURRENT
   *  settled handler (so an in-flight refetch it starts, e.g. AppViewDialog's
   *  own post-action GET, finishes before the next queued entry is sent),
   *  records the outcome, and starts the next entry if one is waiting.
   *  Neither a rejected/throwing `send` nor a throwing/rejecting handler ever
   *  stalls the queue (AC-N50.15(c)).
   *
   *  minor (N50 fix round 6, verify.r6.md m-3): the sentence this comment
   *  used to end on -- "only a `send` that never settles at all blocks that
   *  application's queue for the session" -- read as an absolute guarantee
   *  this module itself does not enforce: `drain` below `await`s an
   *  ARBITRARY caller-supplied settled handler with no bound of its own, so a
   *  handler that never settles blocks the queue exactly the same way an
   *  un-timed-out `send` would. It is true in production today only because
   *  AppViewDialog.js's own settled handler is itself bounded -- every GET it
   *  issues goes through `fetchPrep`, which now carries its own timeout (that
   *  file's own header) -- a fact this module cannot see or rely on. Stated
   *  honestly rather than re-timed here: bounding the handler inside `drain`
   *  would duplicate a deadline AppViewDialog.js already owns, for a caller
   *  this module has exactly one of.
   *
   *  M-1 (N50 fix round 2): `send` is handed an `AbortSignal`, aborted the
   *  moment the timeout below wins the race -- see this file's own header.
   *  A `send` that ignores the signal (e.g. a restore that never wired one
   *  up) behaves exactly as before: the queue still moves on at `timeoutMs`,
   *  it just cannot make that particular request stop. */
  function drain(entry) {
    const controller = new AbortController();
    let sendPromise;
    try {
      sendPromise = Promise.resolve(sends.get(entry.seq)(controller.signal));
    } catch (err) {
      sendPromise = Promise.reject(err);
    }
    // A send that eventually settles AFTER the timeout already won the race
    // must never surface as an unhandled rejection -- it is simply ignored.
    sendPromise.catch(() => {});
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ error: TIMEOUT_MESSAGE, networkError: true, timedOut: true });
      }, timeoutMs);
    });
    Promise.race([sendPromise, timeout])
      .then(normalizeResult, (err) => ({ error: err?.message || "Request failed.", networkError: true }))
      .then(async (result) => {
        clearTimeout(timer);
        const handler = settledHandler;
        if (handler) {
          try {
            await handler(entry, result);
          } catch {
            // A misbehaving handler must not stop the queue.
          }
        }
        sends.delete(entry.seq);
        const cur = stateFor(entry.applicationId);
        // N50 fix round 5 (verify.r5.md M-1): `settledAt` is stamped ONLY on a
        // `timedOut` outcome -- every other outcome keeps its exact prior
        // shape (app/hooks/prepActionQueue.contract.test.js pins several with
        // an exact `toEqual`), and only `retireStaleTimedOut` below ever
        // reads this field.
        const outcomeRecord = { kind: entry.kind, revision: entry.revision, result, seen: false };
        if (result?.timedOut === true) outcomeRecord.settledAt = Date.now();
        const outcomes = {
          ...cur.outcomes,
          [entry.target]: Object.freeze(outcomeRecord),
        };
        const [head, ...rest] = cur.queued;
        commit(entry.applicationId, { active: head || null, queued: rest, outcomes });
        if (head) drain(head);
      });
  }

  return {
    /** Accepts, refuses, or queues one action. A `send` for an idle
     *  application runs SYNCHRONOUSLY, inside this call -- not merely
     *  scheduled -- so a caller that checks its own side effect right after
     *  `enqueue()` returns sees it. */
    enqueue({ applicationId, target, kind, revision, send }) {
      if (!applicationId || !target || typeof send !== "function") return { accepted: false, reason: "invalid" };
      const cur = stateFor(applicationId);
      const sameTarget = (entry) => entry && entry.target === target;
      if (sameTarget(cur.active) || cur.queued.some(sameTarget)) return { accepted: false, reason: "duplicate" };
      seq += 1;
      const entry = Object.freeze({ seq, applicationId, target, kind, revision: revision ?? null });
      sends.set(seq, send);
      // A whole-pack action clears EVERY outcome of this application (a
      // fresh regeneration makes every prior section message stale); a
      // section action clears only that section's own outcome.
      const outcomes = { ...cur.outcomes };
      if (target === "pack") {
        for (const key of Object.keys(outcomes)) delete outcomes[key];
      } else {
        delete outcomes[target];
      }
      if (!cur.active) {
        commit(applicationId, { active: entry, queued: cur.queued, outcomes });
        drain(entry);
        return { accepted: true, state: "active", seq };
      }
      commit(applicationId, { active: cur.active, queued: [...cur.queued, entry], outcomes });
      return { accepted: true, state: "queued", seq };
    },

    /** The SAME reference until this application's state next changes --
     *  required for `useSyncExternalStore` to avoid looping. `null` and any
     *  application id this queue has never seen share ONE frozen empty
     *  state. */
    getAppState(applicationId) {
      if (applicationId == null) return EMPTY_APP_STATE;
      return stateFor(applicationId);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Latest registration wins. The returned unregister clears the handler
     *  ONLY if it is still the current one -- an unregister called after a
     *  later `setSettledHandler` is inert, so two callers can never race to
     *  clear each other's handler. */
    setSettledHandler(fn) {
      settledHandler = fn;
      return () => {
        if (settledHandler === fn) settledHandler = null;
      };
    },

    /** Marks every outcome of `applicationId` seen. A no-op (no state change,
     *  no notification) when nothing is unseen, so a caller that runs this on
     *  every render never churns the snapshot. */
    markOutcomesSeen(applicationId) {
      const cur = stateFor(applicationId);
      const keys = Object.keys(cur.outcomes);
      if (!keys.some((key) => !cur.outcomes[key].seen)) return;
      const outcomes = {};
      for (const key of keys) outcomes[key] = Object.freeze({ ...cur.outcomes[key], seen: true });
      commit(applicationId, { active: cur.active, queued: cur.queued, outcomes });
    },

    /** Removes every SEEN outcome of `applicationId`, leaving an outcome that
     *  settled since the last `markOutcomesSeen` call untouched -- an outcome
     *  nobody has looked at yet must survive to be shown (AC-N50.16(b)). A
     *  no-op when nothing is seen.
     *
     *  B-1 (N50 fix round 4, verify4.md): a `timedOut` outcome is EXEMPT from
     *  this drop, seen or not. "Seen" answers "has the candidate looked at
     *  this message" -- a UI fact about THIS render. A `timedOut` outcome
     *  answers a different question -- "did this session give up on a claim
     *  that may still be live server-side" -- and that fact's lifetime is the
     *  APPLICATION's claim, not the panel's render: every prior round fixed
     *  exactly one instant after a timeout and left the fact disposable on
     *  the very next fresh open (verify4.md's B-1, paths 1/2 -- close+reopen,
     *  a bare remount). The ONLY thing that still supersedes a `timedOut`
     *  outcome is a FRESH action on that exact target, which `enqueue` above
     *  already clears unconditionally (a retry is what "I am done waiting on
     *  THAT attempt" actually means) -- never merely looking at it, and never
     *  merely reopening the dialog around it. */
    dropSeenOutcomes(applicationId) {
      const cur = stateFor(applicationId);
      const keys = Object.keys(cur.outcomes);
      const droppable = (key) => cur.outcomes[key].seen && cur.outcomes[key].result?.timedOut !== true;
      if (!keys.some(droppable)) return;
      const outcomes = {};
      for (const key of keys) if (!droppable(key)) outcomes[key] = cur.outcomes[key];
      commit(applicationId, { active: cur.active, queued: cur.queued, outcomes });
    },

    /** N50 fix round 5 (verify.r5.md M-1/M-2) -- retires a `timedOut` outcome
     *  once the premise it exists to state ("this session gave up on a claim
     *  that MIGHT still be live") stops holding, independent of `seen`: a
     *  candidate must never be told an attempt "may still finish" once it
     *  provably already has, whether or not they ever looked at the message.
     *  Two ways an outcome goes stale:
     *    (1) `stillRunning` false -- a FRESHER GET already proved the claim
     *        this outcome was about is over (any status but `running`).
     *        verify.r5.md's own M-2: this is what clears a permanently false
     *        "it may still finish" sentence once the pack actually arrives.
     *    (2) `stillRunning` true, but the outcome has simply been on the
     *        books too long to still plausibly be about the SAME claim
     *        (TIMED_OUT_OUTCOME_MAX_AGE_MS above) -- the case with no fresher
     *        evidence either way, e.g. a dialog reopened long after this
     *        session ever polled, onto a `running` status a totally
     *        different, later trigger produced (verify.r5.md's own M-1
     *        example). Every OTHER outcome kind is left untouched -- this is
     *        additive to dropSeenOutcomes above, never a replacement for it. */
    retireStaleTimedOut(applicationId, stillRunning) {
      const cur = stateFor(applicationId);
      const now = Date.now();
      const keys = Object.keys(cur.outcomes);
      const stale = (key) => {
        const outcome = cur.outcomes[key];
        if (outcome.result?.timedOut !== true) return false;
        if (!stillRunning) return true;
        return typeof outcome.settledAt === "number" && now - outcome.settledAt >= TIMED_OUT_OUTCOME_MAX_AGE_MS;
      };
      if (!keys.some(stale)) return;
      const outcomes = {};
      for (const key of keys) if (!stale(key)) outcomes[key] = cur.outcomes[key];
      commit(applicationId, { active: cur.active, queued: cur.queued, outcomes });
    },
  };
}
