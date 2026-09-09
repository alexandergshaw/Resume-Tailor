"use client";

import { useCallback } from "react";
import { interviewTypeLabel } from "@/lib/copilot/interviewTypes";
import { submitPracticeQuestion } from "@/lib/copilot/manualQuestion";
import { discardPracticeWork } from "@/lib/copilot/choiceChangeInvalidation";
import { useInterviewTypeChange } from "../useInterviewType";

// The question/posting/interview-type handlers PracticeSetup, QuestionCard,
// ManualQuestion and the dashboard strip actually call — Next question, Retry
// question, a typed question, changing the posting, and changing the interview
// format (both the picker's own write and the store-subscription duty list that
// runs for the OTHER mode tab and another window's `storage` event).
//
// A LINE-BUDGET EXTRACTION out of PracticeClient.js, not a feature change — the
// same move usePracticeQuestions.js, usePracticeAnswer.js,
// usePracticeCaptureSession.js and usePracticeAnswerActions.js each record in
// their own headers. PracticeClient.js sat at 999 lines against this repo's
// 1000-line convention with the convention enforced NOWHERE for that file: the
// sub-bullets mount hit 1001 and was squeezed back by rewrapping a comment, and
// the glossary provider mount hit 1002 and its comment was cut to three words to
// fit. Two changes in a row budgeting lines instead of writing code is the file
// dictating the change. usePracticeHandlers.extraction.test.js adds the missing
// executable ceiling alongside this move, so the next one gets a red test rather
// than a silent 1001.
//
// WHY THIS SEAM AND NOT A CHEAPER ONE. Hook call order is positional, so an
// extraction that moves a hook relative to another is a behaviour change, not a
// relocation. These six useCallbacks and the useInterviewTypeChange
// subscription were one CONTIGUOUS run in the caller, every consumer of them is
// in JSX, and nothing between them and the return reads them — so calling this
// hook exactly where the run began leaves every underlying hook at the index it
// already had. The block moved with ZERO dedent (it was at this same depth
// inside the component), so the moved lines were verified byte-identical to the
// ones they replaced rather than merely asserted to be.
//
// THE THREE LINES THAT ARE NOT BYTE-IDENTICAL, and why. `armedRef`,
// `armedFromRef` and `setPosting` were provably-stable values inside the
// component — a `useRef` result and a `useState` setter — so
// react-hooks/exhaustive-deps did not require them in a dependency array. As
// PARAMETERS of this hook the rule can no longer prove that, and asked for all
// three. They are stable identities either way, so including them cannot change
// when a callback is rebuilt at runtime; the arrays are wider, the behaviour is
// not. usePracticeAnswerActions.js's own arrays already carry `sessionRef` and
// `currentQuestionRef` for exactly this reason, so this matches the sibling
// rather than inventing a convention. Adding a disable comment instead would
// have hidden a rule that is right about what it can see.
//
// `armedRef`/`armedFromRef` are passed in rather than created here, for the
// reason usePracticeAnswerActions.js's header already gives about the same two
// refs: that hook's auto-start machinery also reads and writes them, so they
// belong to neither module alone. A ref is a stable mutable container whichever
// module holds the `useRef` call, so passing the ref itself down (never its
// `.current`) changes nothing about how either side reads or writes it.
//
// `roomQuestions` is taken WHOLE rather than destructured to the two members
// used (`addManualQuestion`, `invalidateDrafts`). Destructuring here would have
// rewritten the dependency arrays below, and an extraction whose moved lines are
// byte-identical to the ones it replaced is one a reader can check.
export function usePracticeHandlers({
  // usePracticeQuestions
  advanceAsked,
  requestQuestion,
  retryFetch,
  resetQuestions,
  markQuestionsStaleForNewFormat,
  setManualQuestion,
  currentQuestionRef,
  // usePracticeAnswer
  abandonInProgressAnswer,
  resetAnswerState,
  clearSessionScores,
  describeInterviewTypeChange,
  // useRoomQuestions, whole — see the header.
  roomQuestions,
  // PracticeClient's own state and refs
  setPosting,
  setInterviewType,
  armedRef,
  armedFromRef,
  // Contract 7, forwarded from PracticeClient's own required prop.
  onInterviewTypeAnnouncement,
}) {
  // "Next question": advanceAsked (usePracticeQuestions) does the
  // question-side half — see its own doc for the dedupe rule. Order matters
  // here: abandonInProgressAnswer/resetAnswerState run BETWEEN computing
  // the next asked list and requesting it, mirroring the inline version
  // exactly (the question changing invalidates the previous answer).
  const onNextQuestion = useCallback(() => {
    // AC-N2: arms auto-start BEFORE the fetch, not after — the question
    // this press is waiting for hasn't landed yet (requestQuestion is
    // async), so there is nothing here to check synchronously. The
    // attemptAutoStart effect below picks this up once `questionLoading`/
    // `currentQuestionText` actually change. armedFromRef is captured in
    // the same breath: whatever is on screen right now, so a failed fetch
    // that leaves it unchanged can be told apart from a real arrival.
    armedRef.current = true;
    armedFromRef.current = currentQuestionRef.current?.question || "";
    const next = advanceAsked();
    abandonInProgressAnswer();
    resetAnswerState();
    requestQuestion(next);
    // armedRef/armedFromRef joined this array when they became parameters — see
    // the header's note on the three dependency lines the move had to touch.
  }, [
    advanceAsked,
    abandonInProgressAnswer,
    resetAnswerState,
    requestQuestion,
    currentQuestionRef,
    armedRef,
    armedFromRef,
  ]);

  const onRetryQuestion = useCallback(() => {
    abandonInProgressAnswer();
    resetAnswerState();
    retryFetch();
  }, [abandonInProgressAnswer, resetAnswerState, retryFetch]);

  // AC-O5: typing a question does everything detecting one does — the drill
  // question AND a fully drafted feed entry — by calling
  // submitPracticeQuestion (lib/copilot/manualQuestion.js) with this
  // component's own five pieces. See that function's own module doc for why
  // the five-call sequence lives there rather than inline here: this
  // component cannot be rendered under test, so a reordering inline would be
  // unfalsifiable.
  //
  // Deliberately does NOT set armedRef/armedFromRef the way onNextQuestion
  // does — those arm the recorder to auto-start the instant the new question
  // lands, which is right for a press that means "give me something to
  // answer", but wrong here: the user's hands are on the keyboard, typing,
  // not signalling they're ready to speak.
  const onManualQuestion = useCallback(
    (text) =>
      submitPracticeQuestion(text, {
        advanceAsked,
        abandonAnswer: abandonInProgressAnswer,
        resetAnswer: resetAnswerState,
        setDrillQuestion: setManualQuestion,
        addToFeed: roomQuestions.addManualQuestion,
      }),
    [advanceAsked, abandonInProgressAnswer, resetAnswerState, setManualQuestion, roomQuestions.addManualQuestion],
  );

  // The picker can be changed at any time, including while live. Changing
  // the posting clears the question flow via resetQuestions (see its own
  // doc) and the answer flow — the question just changed out from under it.
  const onPostingChange = useCallback(
    (newPosting) => {
      resetQuestions();
      setPosting(newPosting);
      abandonInProgressAnswer();
      resetAnswerState();
    },
    // setPosting joined this array when it became a parameter — see the header.
    [resetQuestions, abandonInProgressAnswer, resetAnswerState, setPosting],
  );

  // G2/AC-G2-C-3/AC-A11-A13: the duty list that used to run inline here now
  // runs from the store's change subscription below
  // (onInterviewTypeChangeSubscriber), so the SAME origin-split list also
  // runs for the other mode tab and another window's `storage` event. Kept
  // as a named callback only because PracticeSetup.js passes it straight to
  // the picker's onChange (AC-A14); collapsed to just the write, or the
  // duty list would run twice for this tab's own picker.
  const onInterviewTypeChange = useCallback(
    (nextType) => {
      setInterviewType(nextType);
    },
    [setInterviewType],
  );

  // AC-A11-A13/contract 7: registered against the store's own change
  // subscription (contract 2), AFTER usePracticeQuestions/usePracticeAnswer/
  // useRoomQuestions above since it closes over their functions (§C.3). The
  // origin is forwarded from the store's own argument, NEVER a literal
  // "local" — that would make AC-A11's three-valued split unreachable,
  // abandoning an in-progress recording for a change made in a window the
  // candidate isn't looking at. The announcement's own facts live in
  // usePracticeAnswer's describeInterviewTypeChange (see its own doc), which
  // hands up a { storage, ordinary } PAIR, not a string — CopilotClient's
  // claimStorageAnnouncement owns the once-per-tab latch and picks between
  // them. Forwarded whole and never unwrapped here: picking a row on this
  // side is what silenced every practice change after the first on a
  // storage-blocked tab.
  const onInterviewTypeChangeSubscriber = useCallback(
    (next, prev, meta) => {
      discardPracticeWork({
        origin: meta.origin,
        resetQuestions,
        markQuestionsStale: markQuestionsStaleForNewFormat,
        clearSessionScores,
        abandonInProgressAnswer,
        resetAnswerState,
        invalidateRoomDrafts: roomQuestions.invalidateDrafts,
      });
      onInterviewTypeAnnouncement(
        describeInterviewTypeChange({ origin: meta.origin, label: interviewTypeLabel(next) }),
      );
    },
    [
      resetQuestions,
      markQuestionsStaleForNewFormat,
      clearSessionScores,
      abandonInProgressAnswer,
      resetAnswerState,
      roomQuestions.invalidateDrafts,
      onInterviewTypeAnnouncement,
      describeInterviewTypeChange,
    ],
  );
  useInterviewTypeChange(onInterviewTypeChangeSubscriber);

  return { onNextQuestion, onRetryQuestion, onManualQuestion, onPostingChange, onInterviewTypeChange };
}
