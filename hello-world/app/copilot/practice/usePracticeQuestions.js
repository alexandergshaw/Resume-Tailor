"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchNextQuestion } from "@/lib/copilot/questionClient";
import { normalizeQuestion } from "@/lib/copilot/questions";

// BUG-J4/AC-J3: "which question are we on" — practice mode's whole question
// state machine, extracted out of PracticeClient.js purely to keep that
// component under this repo's line-count gate. This is a genuinely cohesive
// unit, not an arbitrary cut: every piece here exists to answer that one
// question (the current question, the asked list, loading/error/exhausted,
// and the generation-token discipline that keeps a stale network response
// from repainting over a newer one), and nothing outside this hook reads
// its internals directly.
//
// What deliberately did NOT move here, and why:
//   - `posting` itself stays a PracticeClient state value (this hook only
//     takes it as an input) — its own `postingRef` there is read by
//     onDoneAnswer for the critique payload, a concern this hook has
//     nothing to do with, so posting is not exclusively the question
//     flow's to own.
//   - `abandonInProgressAnswer`/`resetAnswerState` (usePracticeAnswer) never
//     get called from inside this hook, even though PracticeClient's
//     onNextQuestion/onRetryQuestion/onPostingChange/onInterviewTypeChange/
//     stop/start all call both a hook function here AND one of those in the
//     same handler. Keeping "what question are we on" and "what's happening
//     with the in-progress answer" as two separate concerns that the
//     COMPONENT composes, rather than one reaching into the other, is the
//     same separation AC-G1-10 already pins for useSampleAnswer versus
//     usePracticeAnswer — showing/hiding a draft must never start/stop the
//     recorder, and clearing/advancing the question must never itself
//     decide what happens to an answer that was mid-recording for the
//     question being left behind. The caller decides that ordering, every
//     time, explicitly.
//
// Several of the functions below look like they could be one call
// (`resetForNewQuestionFlow()` or similar) but are kept as smaller pieces
// instead, because PracticeClient's callers need DIFFERENT subsets of this
// behaviour at DIFFERENT points relative to their own state changes
// (`setPosting`, the async session teardown in `start()`) — see each
// function's own doc for which caller needs it and why.
export function usePracticeQuestions({ posting, interviewType }) {
  const [currentQuestion, setCurrentQuestion] = useState(null); // { question, type }
  const [asked, setAsked] = useState([]);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [exhausted, setExhausted] = useState(false);

  // `posting`/`asked`/`currentQuestion`/`interviewType` mirrored into refs
  // for the same reason PracticeClient's own postingRef exists: the async
  // bodies below (requestQuestion's fetch, advanceAsked's dedupe check) are
  // stable useCallbacks (empty dependency arrays) that must see the LATEST
  // value across an `await` or across renders, not whatever was in scope
  // when the callback identity was created.
  const postingRef = useRef(posting);
  const askedRef = useRef([]);
  const currentQuestionRef = useRef(null);
  const interviewTypeRef = useRef(interviewType);
  // Monotonic generation token: bumped whenever an in-flight question
  // request should be discarded (posting change, Stop, or a fresh Start).
  // requestQuestion captures the generation before its await and refuses to
  // write state if a newer generation has since started — otherwise a slow
  // response for the OLD posting/session can land after the user has already
  // moved on and repaint stale data over their new selection. This guard is
  // load-bearing and unchanged by this extraction: every caller that used
  // to bump `reqGenRef.current` directly now goes through one of the
  // functions below instead, but each one bumps the SAME ref at the SAME
  // point in the SAME caller's flow.
  const reqGenRef = useRef(0);

  useEffect(() => {
    postingRef.current = posting;
  }, [posting]);
  useEffect(() => {
    askedRef.current = asked;
  }, [asked]);
  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);
  useEffect(() => {
    interviewTypeRef.current = interviewType;
  }, [interviewType]);

  // Requests the next practice question for the currently selected posting,
  // deduping against the given asked list. Its own failures are caught here
  // and surfaced via questionError — never thrown — so a question request
  // never tears down the capture session. Every write after the await is
  // gated on the generation token still being current: a posting change, a
  // Stop, or a fresh Start can all invalidate this call while it's in
  // flight, and a stale response must write nothing when that happens.
  const requestQuestion = useCallback(async (askedList) => {
    const gen = (reqGenRef.current += 1);
    setQuestionLoading(true);
    setQuestionError("");
    const p = postingRef.current;
    try {
      const result = await fetchNextQuestion({
        posting: p ? { title: p.title, company: p.company, description: p.description } : null,
        asked: askedList,
        interviewType: interviewTypeRef.current,
      });
      if (reqGenRef.current !== gen) return;
      setCurrentQuestion({ question: result.question, type: result.type });
      setExhausted(!!result.exhausted);
    } catch (err) {
      if (reqGenRef.current !== gen) return;
      setQuestionError(err?.message || "Could not get the next question.");
    } finally {
      if (reqGenRef.current === gen) setQuestionLoading(false);
    }
  }, []);

  // "Next question"'s question-side half: pushes the current question onto
  // the asked list (so the route dedupes against it) and returns the
  // updated list. Skips the push when that question is already in the
  // list — a prior failed request leaves `currentQuestion` in place, and
  // pressing Next again must not record it twice. Deliberately does NOT
  // call requestQuestion itself and does NOT touch answer state — the
  // caller (PracticeClient's onNextQuestion) calls this FIRST, then
  // abandonInProgressAnswer/resetAnswerState, then passes the returned list
  // to `requestQuestion`, preserving the exact statement order the inline
  // version had (the question changing invalidates whatever answer — in
  // progress, settling, or already reviewed — belonged to the previous
  // one).
  const advanceAsked = useCallback(() => {
    const prevQuestion = currentQuestionRef.current?.question;
    const alreadyAsked =
      !!prevQuestion &&
      askedRef.current.some((q) => normalizeQuestion(q) === normalizeQuestion(prevQuestion));
    const next = prevQuestion && !alreadyAsked ? [...askedRef.current, prevQuestion] : askedRef.current;
    setAsked(next);
    return next;
  }, []);

  // "Retry"'s question-side half: re-requests against whatever is CURRENTLY
  // asked, read from the ref rather than taking it as an argument so the
  // caller (PracticeClient's onRetryQuestion, a stable useCallback with no
  // `asked` dependency) never needs `asked` in its own dependency array to
  // stay current.
  const retryFetch = useCallback(() => {
    requestQuestion(askedRef.current);
  }, [requestQuestion]);

  // Bumps the generation (discarding any question request already in
  // flight) and clears `questionLoading` — used alone by `stop()` (no
  // future request is coming to naturally overwrite it) and composed into
  // `resetQuestions` below (for the posting/interview-type-change case,
  // where a fresh request MAY follow via requestQuestion, but the clear
  // still needs to happen immediately so the card doesn't sit on a spinner
  // for a request that's already been discarded).
  const invalidateAndClearLoading = useCallback(() => {
    reqGenRef.current += 1;
    setQuestionLoading(false);
  }, []);

  // Clears every OTHER question state slot — deliberately not the
  // generation or `questionLoading`, which the two callers below handle
  // differently (see each one's own reasoning). Used alone by `start()`,
  // and composed into `resetQuestions` below.
  const clearForNewSession = useCallback(() => {
    setAsked([]);
    setCurrentQuestion(null);
    setExhausted(false);
    setQuestionError("");
  }, []);

  // The full question-clearing half of a posting or interview-type change:
  // both need EXACTLY this reset (verified identical statement-for-
  // statement before this extraction) — only what happens to
  // `posting`/`interviewType` themselves, and to the answer-flow state,
  // differs between the two callers, and both of those stay the caller's
  // own responsibility (see this file's module doc).
  const resetQuestions = useCallback(() => {
    invalidateAndClearLoading();
    clearForNewSession();
  }, [invalidateAndClearLoading, clearForNewSession]);

  // start()'s own two-part invalidation, kept separate from resetQuestions
  // above because start() interleaves them around an `await` (tearing down
  // a stray prior session) and a batch of OTHER state resets (error,
  // warning, camera, etc.) that belong to PracticeClient, not this hook —
  // collapsing them into one call would move those intermediate writes to
  // a different point in start()'s sequence than they happen today.
  // `invalidateInFlight` is the gen-bump ALONE (no loading clear — start()
  // doesn't touch questionLoading here; the requestQuestion([]) call at the
  // end of start() sets it back to `true` regardless, exactly as before
  // this extraction).
  const invalidateInFlight = useCallback(() => {
    reqGenRef.current += 1;
  }, []);

  // AC-O4: the manual-entry counterpart of requestQuestion above. Bumps the
  // SAME generation token every other caller in this hook bumps — a
  // generated question already in flight when the user types their own must
  // not land on top of it once that fetch resolves (see this file's own
  // manual test, which resolves a pending fetchNextQuestion afterward and
  // asserts the typed question survives). Also clears questionLoading,
  // questionError, and exhausted: left standing beside a freshly typed
  // question, a stale spinner/error reads as belonging to it, and the
  // exhausted notice disables "Next question", stranding the user beside a
  // question they just typed with no way to move on.
  const setManualQuestion = useCallback((question, type) => {
    reqGenRef.current += 1;
    setQuestionLoading(false);
    setQuestionError("");
    setExhausted(false);
    setCurrentQuestion({ question, type });
    // Written synchronously here, not left to the mirroring effect above:
    // usePracticeAnswerActions reads currentQuestionRef (not the state value)
    // to stamp which question a recording belongs to, and the effect only
    // fires after a render has flushed. This is the one path where the user
    // can press "Use question" and "Start answering" back to back with
    // nothing in between to force that flush — so without this line, whether
    // the ref is current at that moment depends on flush ordering nothing
    // here states or guarantees. The effect stays exactly as it is; it is
    // still what keeps the ref correct for every other path.
    currentQuestionRef.current = { question, type };
  }, []);

  return {
    currentQuestion,
    // Convenience derived from `currentQuestion` alone — returned here
    // (rather than left for every consumer to re-derive) because more than
    // one caller in PracticeClient reads it (the dashboard arrays, the
    // sample-answer question prop).
    currentQuestionText: currentQuestion?.question || "",
    asked,
    questionLoading,
    questionError,
    exhausted,
    // Returned as the ref object itself (not a snapshot, not a getter that
    // could go stale) so PracticeClient's onStartAnswer/onDoneAnswer read
    // the SAME ref this hook writes — a second ref in the component mirroring
    // the same value could drift from this one.
    currentQuestionRef,
    requestQuestion,
    advanceAsked,
    retryFetch,
    resetQuestions,
    invalidateInFlight,
    clearForNewSession,
    invalidateAndClearLoading,
    setManualQuestion,
  };
}
