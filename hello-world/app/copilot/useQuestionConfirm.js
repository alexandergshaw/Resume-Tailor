"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveConfirmedView,
  nextConfirmTarget,
  confirmQuestionId,
  unconfirmQuestionId,
} from "@/lib/copilot/questionConfirm";

// AC-N18.1..N18.12. The React state around lib/copilot/questionConfirm.js's
// pure `resolveConfirmedView` — split out into its own hook the same way
// useQuestionPin.js splits resolvePin's state out of useLiveSession.js (this
// project's 1000-line verification cap), mirroring that hook's structure and
// discipline: this owns exactly the ONE piece of state resolveConfirmedView's
// own doc says a caller must persist across renders (`confirmedIds`) and
// nothing else — which entry is current/history/waiting stays
// resolveConfirmedView's own decision, reused here, never re-derived.
//
// Unlike useQuestionPin.js there is no clock to react to (AC-N18.2: this gate
// owns no clock at all), so there is no render-phase "sync resolvePin's
// decision back into state" step either — `confirmedIds` only ever changes
// because a confirm action wrote to it, never because a render disagreed
// with it.
//
// `logEvent` (AC-N18.12) is threaded straight into the two confirm actions
// and into the one effect below, so this hook logs at the moment something
// actually happens — a confirm, or an entry newly qualifying as waiting —
// never from a bare render-phase comparison. That is the same "log at the
// action" discipline every other logEvent call site in this codebase already
// follows (useQuestionPipeline.js's question.rejected/added, useCueActions.js's
// question.pinned/unpinned): none of them fire from render either.
//
// M7 adds `unconfirmQuestion`, the undo primitive for a confirm that turns
// out wrong — most acutely the cold-start seed, where seedView tracks the
// latest entry INCLUDING a provisional one, so the candidate's very first
// confirm can lock in their own sentence with no way back. Wave B builds
// the UI affordance; this hook only exposes the primitive.
//
// `confirmedIdsRef` mirrors `confirmedIds` synchronously, updated at every
// one of the four places that change the state (confirmQuestion, confirmNext,
// unconfirmQuestion, resetConfirmed), so it is never stale — and its Set
// membership, not the closed-over `confirmedIds` state, is what confirm and
// confirmNext check before logging. `confirmedIds` state does not update
// until React commits, so two calls in the same tick (a real double-click,
// or two distinct callers in one render) would both read the SAME
// pre-commit value and both fire `logEvent` — a duplicate AC-N18.12 event
// even though `confirmQuestionId` itself dedupes the array correctly. The
// ref sidesteps that: it is mutated the instant the first call decides to
// proceed, so the second call sees the change immediately, exactly the
// discipline `loggedWaitingIdsRef` already uses for the same reason.
export function useQuestionConfirm({ questions, questionsRef, logEvent }) {
  const [confirmedIds, setConfirmedIds] = useState([]);

  const resolved = resolveConfirmedView({ questions, confirmedIds });

  // AC-N18.12: exactly one "question.waiting" per id, the first time it
  // shows up in `waiting` — which happens either when a question is detected
  // AFTER something else is already confirmed, or later, retroactively, once
  // a speaker remap clears an entry's `provisional` flag (AC-N18.3) and it
  // newly qualifies. A Set (not a boolean flag on the entry) is what lets
  // both paths log through this one effect without a second call site that
  // could drift from this one. This is a genuine side effect (writing to the
  // session log), not state driving what renders, so a `useEffect` is the
  // right place for it — unlike the pin hold's render-phase adjustment
  // (useQuestionPin.js), which exists only because THAT sync feeds back into
  // what gets shown on screen.
  const loggedWaitingIdsRef = useRef(new Set());
  const confirmedIdsRef = useRef(new Set());
  useEffect(() => {
    for (const entry of resolved.waiting) {
      if (entry && !loggedWaitingIdsRef.current.has(entry.id)) {
        loggedWaitingIdsRef.current.add(entry.id);
        logEvent("question.waiting", { id: entry.id, question: entry.question });
      }
    }
  }, [resolved.waiting, logEvent]);

  // AC-N18.5/rule 5: confirm a SPECIFIC id — a click on a particular waiting
  // card. Checked against `confirmedIdsRef` (m12), not the closed-over
  // `confirmedIds` state, so a repeat confirm of an id already recorded —
  // including one in the SAME tick as the call that first recorded it — is
  // a no-op exactly as confirmQuestionId itself treats the array, and never
  // logs a second "question.confirmed" for it.
  const confirmQuestion = useCallback(
    (id) => {
      if (confirmedIdsRef.current.has(id)) return;
      confirmedIdsRef.current.add(id);
      logEvent("question.confirmed", { id });
      setConfirmedIds((prev) => confirmQuestionId(prev, id));
    },
    [logEvent],
  );

  // Rule 5: confirm the OLDEST waiting entry ("confirm next") rather than a
  // specific one. Reads `questionsRef.current`, not the `questions` value
  // closed over above — mirrors useQuestionPin.js's `pinCurrentQuestion`,
  // which reads `questionsRef.current` for the identical reason: this fires
  // from an event (a click, a keyboard shortcut) that can happen well after
  // the render that created this callback, and must see the LATEST detected
  // question, not whichever list was current when the closure was made. It
  // reads `confirmedIdsRef.current` for the same freshness reason, and for
  // the m12 discipline above: two same-tick calls must not pick, and log,
  // the same target twice.
  const confirmNext = useCallback(() => {
    const target = nextConfirmTarget({
      questions: questionsRef.current,
      confirmedIds: [...confirmedIdsRef.current],
    });
    if (target === null || confirmedIdsRef.current.has(target)) return null;
    confirmedIdsRef.current.add(target);
    logEvent("question.confirmed", { id: target });
    setConfirmedIds((prev) => confirmQuestionId(prev, target));
    return target;
  }, [questionsRef, logEvent]);

  // M7: the inverse of confirmQuestion — undoes a confirm. A no-op for an id
  // that is not currently confirmed, decided against `confirmedIdsRef` for
  // the same same-tick-safety reason as confirmQuestion above. Once this
  // clears the most-recently-confirmed id, `resolveConfirmedView` makes the
  // previously-confirmed entry `current` again for free (it is simply the
  // new tail of `confirmedIds`), and the unconfirmed entry itself falls
  // back into `waiting` for free too, since `waiting` is membership-based
  // (B1) rather than boundary-based.
  const unconfirmQuestion = useCallback((id) => {
    if (!confirmedIdsRef.current.has(id)) return;
    confirmedIdsRef.current.delete(id);
    setConfirmedIds((prev) => unconfirmQuestionId(prev, id));
  }, []);

  // AC-N18.9: Start and Clear both reset the gate — a new session (or an
  // emptied feed) must seed fresh, exactly as if nothing had ever been
  // confirmed. Stop deliberately does NOT call this — see useLiveSession.js's
  // own call sites for why: `stop()` never clears `questions` either, and a
  // waiting entry at Stop stays confirmable because its answer already
  // exists.
  const resetConfirmed = useCallback(() => {
    setConfirmedIds([]);
    confirmedIdsRef.current = new Set();
    loggedWaitingIdsRef.current = new Set();
  }, []);

  // M3 (fresh delta review): `resolved.waitingCount` used to be threaded
  // through here too, all the way to CopilotDashboard.js's WaitingList — but
  // it can never differ from `resolved.waiting.length` (resolveConfirmedView
  // computes both from the same call), so the prop was dead at every layer
  // it passed through. Not returned here any more; a caller that wants the
  // count reads `waiting.length` directly, same as WaitingList itself now
  // does.
  return {
    current: resolved.current,
    currentIsSeed: resolved.currentIsSeed,
    history: resolved.history,
    waiting: resolved.waiting,
    confirmedIds,
    confirmQuestion,
    confirmNext,
    unconfirmQuestion,
    resetConfirmed,
  };
}
