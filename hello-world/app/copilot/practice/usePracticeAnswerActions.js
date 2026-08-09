"use client";

import { useCallback, useEffect } from "react";
import { autoStartDecision } from "@/lib/copilot/practiceFlow";
import { readSaveEnabled } from "./useSaveRecordings";

// AC-N2/AC-C4: the answer-lifecycle handlers QuestionCard and AnswerFeedback
// actually call — Start answering, the auto-start arming machinery that
// fires the recorder the instant a question lands (or is re-armed for Try
// again) with no countdown, Done, Try again, and Retry critique — extracted
// out of PracticeClient.js purely to keep that component under this repo's
// line-count gate, the same reason usePracticeQuestions.js/
// usePracticeAnswer.js/usePracticeCaptureSession.js already exist as their
// own modules. This hook owns none of the underlying state itself (the
// capture session, the question flow, and the answer/critique flow each stay
// exactly where they already lived — usePracticeCaptureSession,
// usePracticeQuestions, usePracticeAnswer, respectively) — it is purely the
// composition layer that turns their combined outputs into concrete button
// handlers, the same "COMPONENT composes" split usePracticeQuestions.js's
// own header documents for onNextQuestion/onPostingChange/etc. (which stay
// in PracticeClient itself, unmoved, for the same reason).
//
// `armedRef`/`armedFromRef`/`postingRef` are passed in rather than created
// here — armedRef/armedFromRef are also written by onNextQuestion
// (PracticeClient.js), and postingRef is read by onDoneAnswer below but was
// deliberately kept in PracticeClient (see its own BUG-J4 comment) since
// it's not exclusively an answer-flow concern either; a ref is a stable
// mutable container regardless of which module holds the `useRef` call, so
// passing the ref itself down (rather than its `.current`) changes nothing
// about how either side reads or writes it.
export function usePracticeAnswerActions({
  sessionRef,
  status,
  currentQuestionRef,
  startAnswerFlow,
  micMuted,
  armedRef,
  armedFromRef,
  currentQuestionText,
  questionLoading,
  answering,
  settling,
  doneAnswerFlow,
  postingRef,
  profile,
  sendFrames,
  isEmbedded,
  interviewType,
  abandonInProgressAnswer,
  resetAnswerState,
  retryCritique,
}) {
  // Starts recording the current question's answer. A no-op unless the
  // session is actually live with a question on screen — the "Start
  // answering" button is disabled for all of those cases, but this guard
  // means a stray call can never leave the flow in an inconsistent state.
  const onStartAnswer = useCallback(() => {
    const liveStream = sessionRef.current?.stream;
    if (!liveStream || status !== "live" || !currentQuestionRef.current?.question) return;
    // Read the CURRENT mute state at the moment recording starts — the mic
    // can already be muted before "Start answering" is pressed, and the
    // toggle-driven markMicMuted() would never fire during an answer where
    // it's never re-toggled (BUG-15).
    startAnswerFlow(liveStream, micMuted);
  }, [status, startAnswerFlow, micMuted, currentQuestionRef, sessionRef]);

  // AC-N2: the single place that turns an armed press into an actual
  // "start answering" call, or lets it go. Reads `armedRef` fresh (a ref,
  // so this always sees whatever the last press left behind, never a
  // stale closure) and hands everything else straight to autoStartDecision
  // (lib/copilot/practiceFlow.js) — see that module's header for why every
  // one of these inputs matters and what each failure mode disarms rather
  // than waits on.
  //
  // Starting the recorder the instant the question lands (no countdown) is
  // safe because pace and filler are measured on the AUDIO clock, not
  // wall-clock (see lib/copilot/livePace.js's header and
  // answerMetrics.js's speechDurationSec) — the seconds the user spends
  // reading the question before speaking are silence before the first
  // word, not part of the measured span, so they cannot drag the reading
  // down. That is a property of the measurement itself, not an assumption
  // being made here.
  //
  // Called two ways: from the effect below, which is what actually catches
  // the "Next question" case (the question arrives asynchronously, so
  // there is nothing to check until a later render); and directly from
  // onTryAgainAnswer, whose target question is already on screen with
  // nothing to wait for — armed/status/question/loading/answering/settling
  // are all already correct at the moment of that click, and waiting for
  // some OTHER, unrelated render to happen to touch one of them first would
  // leave that press armed but stranded.
  const attemptAutoStart = useCallback(() => {
    const decision = autoStartDecision({
      armed: armedRef.current,
      status,
      question: currentQuestionText,
      armedFrom: armedFromRef.current,
      loading: questionLoading,
      answering,
      settling,
    });
    if (decision === "wait") return;
    // Disarm BEFORE starting, not after — a re-render triggered mid-start
    // (onStartAnswer's own setAnswering(true)) must never be able to read
    // this press as still pending and fire the recorder a second time.
    armedRef.current = false;
    if (decision === "start") onStartAnswer();
  }, [status, currentQuestionText, questionLoading, answering, settling, onStartAnswer, armedRef, armedFromRef]);

  useEffect(() => {
    attemptAutoStart();
  }, [attemptAutoStart]);

  // "Done" hands the hook everything it needs to both compute C3's metrics
  // AND kick off C4's critique: the question/type being answered, the
  // posting (so the critique can check the answer against its vocabulary),
  // the candidate's prep profile, and whether frames may be sent at all
  // (opt-in switch AND not the embedded engine — AC-C4-5).
  const onDoneAnswer = useCallback(() => {
    doneAnswerFlow({
      question: currentQuestionRef.current?.question || "",
      type: currentQuestionRef.current?.type || "general",
      posting: postingRef.current
        ? { title: postingRef.current.title, company: postingRef.current.company, description: postingRef.current.description }
        : null,
      // The posting picker's option id IS the application id (see
      // normalizePostingRows in lib/copilot/postings.js) — kept separate
      // from `posting` above rather than folded into it, since `posting` is
      // also what's sent to the critique engine and this id has no reason
      // to travel with it.
      applicationId: postingRef.current?.id || null,
      profile,
      // G2/AC-G2-C-4: closed over directly (not via a ref) — onDoneAnswer
      // is recreated whenever `interviewType` changes, and it only ever
      // runs synchronously at click time, so the closure is never stale.
      interviewType,
      includeFrames: sendFrames && !isEmbedded,
      // BUG-2: a live reader, not `saveEnabled` itself — the upload this
      // gates happens seconds later, after the critique settles, and the
      // switch must be re-read at THAT moment (see usePracticeAnswer's
      // persistAnswer), not latched to whatever it was when Done was
      // pressed. `readSaveEnabled` always reflects the current value since
      // it re-reads localStorage itself rather than closing over render-time
      // state, so no dependency on `saveEnabled` is needed here either.
      isSaveEnabled: readSaveEnabled,
    });
  }, [doneAnswerFlow, profile, sendFrames, isEmbedded, interviewType, currentQuestionRef, postingRef]);

  // "Try again" re-answers the SAME question: clears the same per-answer
  // state Next question clears (transcript, metrics, frames, replay clip,
  // feedback) but leaves the question itself — and the asked list — in
  // place, unlike onNextQuestion.
  //
  // AC-N2: arms auto-start too — same intent, same loop, as onNextQuestion.
  // Unlike that press, this one's target question is already on screen, so
  // there is no fetch to wait for: attemptAutoStart is called directly,
  // synchronously, rather than left for the effect to catch on some later
  // render that may never touch one of its watched values. armedFromRef is
  // deliberately reset to "" here rather than to the current question: this
  // press's whole point is to re-arm on the SAME question, so comparing
  // against it would read as "unchanged" and disarm the very case this
  // button exists for. There is no async gap here for a fetch to fail
  // into, so nothing could have gone stale — the same "no predecessor"
  // exception autoStartDecision gives the first question of a session
  // applies here too, and correctly still yields "start".
  const onTryAgainAnswer = useCallback(() => {
    armedRef.current = true;
    armedFromRef.current = "";
    abandonInProgressAnswer();
    resetAnswerState();
    attemptAutoStart();
  }, [abandonInProgressAnswer, resetAnswerState, attemptAutoStart, armedRef, armedFromRef]);

  // "Retry" (the error-state action, re-analyzing the SAME already-recorded
  // answer) reads the opt-in/engine state fresh, at the moment it's
  // pressed, rather than replaying whatever was true when the answer was
  // first submitted. The user may have turned the frames switch off (or
  // switched to the embedded engine) while the error was on screen — no
  // frame may leave the browser while the on-screen notice already says
  // none do (BUG-1).
  const onRetryCritique = useCallback(() => {
    retryCritique({ includeFrames: sendFrames && !isEmbedded });
  }, [retryCritique, sendFrames, isEmbedded]);

  return {
    onStartAnswer,
    onDoneAnswer,
    onTryAgainAnswer,
    onRetryCritique,
  };
}
