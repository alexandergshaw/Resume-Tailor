"use client";

import { useEffect, useRef, useState } from "react";
import { recordProgress } from "@/lib/studyPlan/studyPlanProgressStore";
import { isDone, nextCard, summarize } from "@/lib/studyPlan/studyWalkthroughModel";

// N157 SC-C (C-b): all the state behind the walkthrough card step. The
// component is presentational; every decision (which card is on screen, whether
// its answer is revealed, what a tap records, where the next tap lands) is a
// plain value or callback this hook returns, the same split useRoleDrill.js
// draws against SituationCard.js.
//
// WHERE THE PROGRESS LIVES. Not here. `progress` is read from the caller's
// store snapshot on every render, and a grade is applied by the shipped
// recordProgress, which merges it into that store SYNCHRONOUSLY (before its
// first await) and persists it through the injected writer. So the store's
// optimistic merge is what re-renders the walkthrough, and this hook keeps NO
// copy of `seen`. The only thing it holds is local view state: the card on
// screen, whether its answer is revealed, the trail for "Previous card", and the
// session-only "Review all again" pass.
//
// ONE CARD PER WRITE. A tap hands recordProgress a single card -- { moduleId,
// topicId, itemId: card.id, revealedAt, grade? } -- and the store builds the
// one-key delta with the schema's buildProgressDelta. The hook never builds a
// delta itself and never passes the whole `seen` map or a user id to the writer.
//
// ADVANCING IS nextCard, NEVER AN INDEX. The next card is the model's
// "first pending card after this one, wrapping to the first pending overall",
// so a card already done is skipped, a missed card comes back after the first
// pass, and nothing pending means completion. The advance does not wait for the
// write: a slow or failed save never holds the card shut.
//
// A FAILED SAVE is stamped on the record by the store and arrives as the
// `saveError` prop. The store never clears it again, so the hook also watches
// its own writes: a retry that lands marks the alert healed, and the next failure
// un-heals it. "Retry saving" re-sends the last FAILED card, not the card on
// screen (the UI has already moved on).

// How long every card control stays inert after an advance. A double-tap lands
// on whatever now sits under the thumb; for a read card that is "Next", which
// would silently skip an unread card. A seat-flagged GUESS (design r2 section
// 3.2), exported so the owner retunes it on a phone and the test reads the
// constant rather than a copy of it.
export const STUDY_ADVANCE_GUARD_MS = 300;

const NO_REVIEW = Object.freeze({ on: false, done: new Set() });

// The last thing the store believes it recorded: the cursor card and its seen
// entry. The fallback for "Retry saving" when this hook has no failed write of
// its own to remember (a remount while the record still carries the error).
function lastRecorded(progress) {
  const { moduleId, topicId, itemId } = progress.cursor;
  const entry = itemId === null ? undefined : progress.seen[itemId];
  return entry === undefined ? null : { moduleId, topicId, itemId, ...entry };
}

/**
 * @param {object} args
 * @param {string} args.applicationId  non-empty (the caller refuses an empty one)
 * @param {object[]} args.cards        flattenPlan(plan), at least one card
 * @param {object} args.progress       normalized progress from the store snapshot
 * @param {Function} args.writer       ({ cursor, seenDelta }) => Promise<{ written, error }>
 * @param {Function} args.clock        () => ISO string, the revealedAt clock
 * @param {string|null} args.saveError record.error from the store
 */
export default function useStudyWalkthrough({ applicationId, cards, progress, writer, clock, saveError }) {
  const { seen } = progress;

  const [view, setView] = useState(() => ({
    id: nextCard(cards, seen, progress.cursor.itemId).id,
    revealed: false,
    revealedAt: null,
  }));
  const [history, setHistory] = useState([]);
  const [review, setReview] = useState(NO_REVIEW);
  const [focusRequest, setFocusRequest] = useState(null);
  const [healed, setHealed] = useState(false);
  const guardRef = useRef(false);
  const guardTimerRef = useRef(null);
  const failedRef = useRef(null);

  useEffect(
    () => () => {
      if (guardTimerRef.current !== null) clearTimeout(guardTimerRef.current);
    },
    [],
  );

  // A plan that changed under a live view (the caller normally remounts on a new
  // plan) can leave the id pointing at no card: resume from the cursor instead.
  const reviewOpts = { reviewAll: review.on, sessionDone: review.done };
  const known = view.id === null || cards.some((candidate) => candidate.id === view.id);
  const currentId = known ? view.id : nextCard(cards, seen, progress.cursor.itemId, reviewOpts).id;
  const card = currentId === null ? null : (cards.find((candidate) => candidate.id === currentId) ?? null);
  const entry = card === null ? undefined : seen[card.id];
  const index = card === null ? -1 : cards.indexOf(card);

  const armGuard = () => {
    guardRef.current = true;
    if (guardTimerRef.current !== null) clearTimeout(guardTimerRef.current);
    guardTimerRef.current = setTimeout(() => {
      guardRef.current = false;
      guardTimerRef.current = null;
    }, STUDY_ADVANCE_GUARD_MS);
  };

  // Focus is the announcement: the caller moves it to the new heading or the
  // answer group when the request changes. Null until the first user action, so
  // nothing steals focus on mount.
  const requestFocus = (target) => setFocusRequest((previous) => ({ target, seq: (previous?.seq ?? 0) + 1 }));

  const go = (id, { revealed = false, revealedAt = null } = {}) => {
    setView({ id, revealed, revealedAt });
    requestFocus("heading");
    armGuard();
  };

  // Fire-and-forget: the advance never waits on this. A rejected persist is
  // remembered for the retry; a landed one clears it only if it is the failed
  // card itself (or an explicit retry), because a later card saving fine says
  // nothing about an earlier one that did not.
  const send = (sent, isRetry) => {
    recordProgress(applicationId, sent, writer).then((outcome) => {
      if (outcome.written === true) {
        if (isRetry || failedRef.current?.itemId === sent.itemId) {
          failedRef.current = null;
          setHealed(true);
        }
        return;
      }
      failedRef.current = sent;
      setHealed(false);
    });
  };

  // Record one card and move to the next pending one.
  const finish = (target, grade) => {
    const revealedAt = view.revealedAt ?? clock();
    const sent = {
      moduleId: target.moduleId,
      topicId: target.topicId,
      itemId: target.id,
      revealedAt,
      ...(grade === undefined ? {} : { grade }),
    };
    send(sent, false);

    const sessionDone = review.on ? new Set(review.done).add(target.id) : review.done;
    const seenAfter = { ...seen, [target.id]: grade === undefined ? { revealedAt } : { revealedAt, grade } };
    const next = nextCard(cards, seenAfter, target.id, { reviewAll: review.on, sessionDone });
    if (review.on) setReview({ on: true, done: sessionDone });
    setHistory((trail) => [...trail, target.id]);
    go(next.id);
  };

  const onReveal = () => {
    if (guardRef.current || card === null || !card.hasReveal || view.revealed) return;
    setView({ id: card.id, revealed: true, revealedAt: clock() });
    requestFocus("answer");
  };

  const onGrade = (grade) => {
    if (guardRef.current || card === null || !card.hasReveal || !view.revealed) return;
    finish(card, grade);
  };

  const onNext = () => {
    if (guardRef.current || card === null || card.hasReveal) return;
    finish(card);
  };

  const canPrevious = card !== null && (history.length > 0 || index > 0);

  const onPrevious = () => {
    if (guardRef.current || card === null) return;
    let trail = history;
    let target = null;
    while (trail.length > 0 && target === null) {
      const lastId = trail[trail.length - 1];
      target = cards.find((candidate) => candidate.id === lastId) ?? null;
      trail = trail.slice(0, -1);
    }
    if (target === null && index > 0) target = cards[index - 1];
    if (target === null) return;
    const prior = seen[target.id];
    const revealedAt = typeof prior?.revealedAt === "string" ? prior.revealedAt : null;
    setHistory(trail);
    go(target.id, { revealed: target.hasReveal && revealedAt !== null, revealedAt });
  };

  const onJump = (topicId) => {
    const inTopic = cards.filter((candidate) => candidate.topicId === topicId);
    const pending = inTopic.find((candidate) =>
      review.on ? !review.done.has(candidate.id) : !isDone(candidate, seen[candidate.id]),
    );
    const target = pending ?? inTopic[0];
    if (target === undefined) return;
    if (card !== null && target.id !== card.id) setHistory((trail) => [...trail, card.id]);
    go(target.id);
  };

  // Session-local: the data layer has no reset, so this is one flag and a Set
  // that a reload forgets (everything reads done again).
  const onReviewAll = () => {
    const done = new Set();
    setReview({ on: true, done });
    setHistory([]);
    go(nextCard(cards, seen, null, { reviewAll: true, sessionDone: done }).id);
  };

  const onRetry = () => {
    const sent = failedRef.current ?? lastRecorded(progress);
    if (sent !== null) send(sent, true);
  };

  return {
    card,
    complete: card === null,
    revealed: view.revealed,
    entry,
    summary: summarize(cards, seen),
    fresh: cards.every((candidate) => seen[candidate.id] === undefined),
    secondPass: card !== null && !review.on && entry !== undefined && !isDone(card, entry),
    canPrevious,
    focusRequest,
    saveAlert: Boolean(saveError) && !healed,
    onReveal,
    onGrade,
    onNext,
    onPrevious,
    onJump,
    onReviewAll,
    onRetry,
  };
}
