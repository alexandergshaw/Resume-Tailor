"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { interviewTypeLabel } from "@/lib/copilot/interviewTypes";
import { buildPrivacyNotice } from "@/lib/copilot/practiceNotices";
import { submitPracticeQuestion } from "@/lib/copilot/manualQuestion";
import { useEngine } from "@/app/settings/engine";
import { useIsTablet } from "@/app/hooks/useResponsive";
import TranscriptView from "../TranscriptView";
import QuestionFeed from "../QuestionFeed";
import ManualQuestion from "../ManualQuestion";
import CameraPreview from "./CameraPreview";
import { useApplicationDocs } from "../useApplicationDocs";
import CopilotDashboard, { PRACTICE_COPY } from "../dashboard/CopilotDashboard";
import { useCopilotDashboard } from "../useCopilotDashboard";
import PracticeSetup from "./PracticeSetup";
import PracticeControls from "./PracticeControls";
import QuestionCard from "./QuestionCard";
import AnswerReview from "./AnswerReview";
import AnswerFeedback from "./AnswerFeedback";
import PracticeHistory from "./PracticeHistory";
import { usePracticeAnswer } from "./usePracticeAnswer";
import { usePracticeQuestions } from "./usePracticeQuestions";
import { useRoomQuestions } from "./useRoomQuestions";
import { useSampleAnswer } from "./useSampleAnswer";
import { usePracticeCodeLanguage } from "./usePracticeCodeLanguage";
import { shouldQueueSampleAnswer } from "@/lib/copilot/practiceFlow";
import { useInterviewType, useInterviewTypeChange } from "../useInterviewType";
import { discardPracticeWork } from "@/lib/copilot/choiceChangeInvalidation";
import { useSaveRecordings } from "./useSaveRecordings";
import { usePrepContext } from "../usePrepContext";
import { usePracticeCaptureSession } from "./usePracticeCaptureSession";
import { usePracticeAnswerActions } from "./usePracticeAnswerActions";
import { usePracticeSessionLog } from "./usePracticeSessionLog";
import { roomQuestionPrivacyClause } from "./practiceRoomQuestionPrivacy";

// Practice mode's capture layer: camera + mic, transcribed as "you", plus a
// posting picker, a generated interview question to practice against, (C3)
// recording + measuring the spoken answer itself, and (C4) judging what was
// actually said plus the repeat loop. The answer-recording flow (recorder,
// sampler, drain, generation guard, replay URL lifecycle, metrics/critique
// state) lives in usePracticeAnswer (AC-C4-8) — this component owns the
// capture session, the posting picker, the question, and the layout.
export default function PracticeClient({
  sttProviderName,
  micDeviceId,
  onMicDeviceChange,
  // Contract 7. CopilotClient's only render site always supplies this
  // (onPracticeTypeAnnouncement, which filters through the shared storage
  // latch before setPracticeTypeAnnouncement) — no default, hard-called
  // below with no `?.`, so a missing wire throws instead of going inert.
  onInterviewTypeAnnouncement,
} = {}) {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error

  const [posting, setPosting] = useState(null);

  // G2: which interview format drives question generation, the sample
  // answer, and the critique's rubric — a real external store (same shape
  // as useSaveRecordings.js's own store and engine.js's useEngine), not
  // component state, so it persists across visits the same way the save
  // toggle and the engine choice already do.
  const { interviewType, setInterviewType } = useInterviewType();

  // BUG-J4/AC-J3: "which question are we on" — the whole question state
  // machine, extracted into usePracticeQuestions.js (see its own module doc
  // for what moved and why) purely to keep this component under the gate.
  const {
    currentQuestion,
    currentQuestionText,
    questionLoading,
    questionError,
    exhausted,
    currentQuestionRef,
    requestQuestion,
    advanceAsked,
    retryFetch,
    resetQuestions,
    invalidateInFlight,
    clearForNewSession,
    invalidateAndClearLoading,
    setManualQuestion,
    markQuestionsStaleForNewFormat,
  } = usePracticeQuestions({ posting });

  // Same shared prep-context hook the live session uses (AC-C4-7) — grounds
  // the critique in the candidate's real background. Practice mode has no
  // answer cache to clear on edit, so unlike CopilotClient's wrapper, the
  // hook's setter is used directly.
  const [profile, setProfile] = usePrepContext();

  // Whether camera frames may be sent to Gemini for this session — default
  // OFF (AC-C4-5). Only takes effect when the engine isn't embedded; the
  // embedded rubric never looks at frames regardless of this switch.
  const [sendFrames, setSendFrames] = useState(false);
  const { engine } = useEngine();
  const isEmbedded = engine === "embedded";

  // D1: "Save recordings to my account" — defaults ON. `saveEnabled` drives
  // the switch's checked state and the privacy notice below, both of which
  // should reflect whatever is true RIGHT NOW. See useSaveRecordings.js for
  // why the actual upload decision (`readSaveEnabled`, imported above as a
  // plain function, not this hook's value) re-reads storage instead — that
  // upload happens seconds later, after the critique settles (BUG-2 in
  // usePracticeAnswer's persistAnswer).
  const { saveEnabled, setSaveEnabled } = useSaveRecordings();
  const onToggleSaveEnabled = useCallback((e) => setSaveEnabled(e.target.checked), [setSaveEnabled]);

  const {
    answering,
    settling,
    answerTranscript,
    answerMetrics,
    // AC-A11b/AC-A12: the type this on-screen critique was judged under —
    // see usePracticeAnswer.js's own doc. Read below for judgedInterviewTypeLabel.
    judgedInterviewType,
    // Final wave (AC-M2): the speaker tag that dominated the most recently
    // completed answer, learned by usePracticeAnswer's own doneAnswer and
    // persisted across "Next question"/"Try again" — see that hook's own
    // doc. Fed straight into useRoomQuestions below, which is the ONLY
    // consumer: the drill itself never renders this.
    myTag,
    replayUrl,
    replaySupported,
    startAnswer: startAnswerFlow,
    doneAnswer: doneAnswerFlow,
    abandonInProgressAnswer,
    resetAnswerState,
    clearSessionScores,
    describeInterviewTypeChange, // Contract 7 — see usePracticeAnswer.js's own doc.
    // Renamed at this destructuring site so it can be folded, below, into a
    // single combined callback with useRoomQuestions' own resetForSession —
    // usePracticeCaptureSession.js's start() calls exactly ONE
    // `resetForSession` prop at the top of every fresh capture session, the
    // same reason useCopilotDashboard's own resetForSession is renamed to
    // resetDashboardForSession a little further down.
    resetForSession: resetAnswerFlowForSession,
    recordTranscriptEvent,
    markMicMuted,
    critiqueStatus,
    critique,
    critiqueError,
    critiqueFramesSent,
    retryCritique,
    sessionAnswered,
    sessionAverageScore,
    saveStatus,
    saveError,
    savedAnswerVersion,
  } = usePracticeAnswer();

  // Final wave (AC-M2): whether the candidate's OWN answer is currently
  // being recorded — reconstructed from usePracticeAnswer's two already-
  // exposed booleans rather than a third value that hook would have to
  // export, since it's exactly the union of them: `answering` (Start
  // answering through Done) and `settling` (Done through the end of the
  // post-Done transcript drain) together are the same window
  // usePracticeAnswer's own internal collectingRef tracks. Every turn
  // captured while this is true is the candidate's by definition
  // (shouldTreatAsRoomQuestion's first signal, lib/copilot/roomQuestions.js)
  // — pressing "Start answering" IS the statement that what follows belongs
  // to that answer, whoever's voice it actually is.
  const collectingAnswer = answering || settling;

  // Final wave (AC-M2): detects a question asked by someone else in the
  // room WHILE it's being asked, and drafts the full answer for it — the
  // same detect/confirm/draft pipeline live mode's detected-question feed
  // runs, reused rather than re-implemented (see useRoomQuestions.js's own
  // header). `applicationId`/`profile` are the same two grounding facts
  // sampleAnswer above is given; `myTag`/`collectingAnswer` are the two
  // signals shouldTreatAsRoomQuestion needs to tell the candidate's own
  // voice apart from someone else's.
  const roomQuestions = useRoomQuestions({
    applicationId: posting?.id || null,
    profile,
    myTag,
    collecting: collectingAnswer,
  });

  // A-25/D-1: the code-language store read AND its change subscriber, out of
  // this component by necessity — see usePracticeCodeLanguage.js's own
  // header for the full reasoning (D-1's negative this file must stay true
  // to, and A17's narrow seam). Its invalidation duty is the room's stale
  // drafts; R-3 (a11y finding 2, HIGH) adds a second, non-destructive one —
  // reporting that wipe through the SAME announcement channel the interview
  // type change already uses below, since both are "this tab's own
  // announcement" and never fire in the same tick.
  const { codeLanguage, setCodeLanguage } = usePracticeCodeLanguage({
    invalidateRoomDrafts: roomQuestions.invalidateDrafts,
    onAnnounce: onInterviewTypeAnnouncement,
  });

  // Folds usePracticeAnswer's own per-session reset together with
  // useRoomQuestions' — see resetAnswerFlowForSession's own comment above
  // for why this single combined callback exists rather than
  // usePracticeCaptureSession.js gaining a second reset call. A brand-new
  // capture session must not carry over a room question detected during the
  // PREVIOUS one, nor its dedupe guard against repeating it.
  const resetForSession = useCallback(() => {
    resetAnswerFlowForSession();
    roomQuestions.resetForSession();
    // `roomQuestions` is a fresh literal every render — depending on its one
    // stable member ([] deps inside useRoomQuestions) is what keeps this
    // callback's identity from changing every render too.
  }, [resetAnswerFlowForSession, roomQuestions.resetForSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // G1: the toggleable sample answer for the question currently on screen.
  // Deliberately kept independent of usePracticeAnswer above — showing or
  // hiding a draft must never start/stop the recorder or samplers, alter
  // answering/settling, or touch the critique (AC-G1-10), so this hook is
  // given only the question text and the shared prep profile, and nothing
  // it returns is threaded into usePracticeAnswer's API. G2: also given the
  // selected interview type and the selected posting's id (its
  // applicationId — see normalizePostingRows in lib/copilot/postings.js) so
  // the draft can be grounded in the resume/cover letter submitted for that
  // posting; null with no posting selected (AC-G2-C-9).
  const sampleAnswer = useSampleAnswer({
    question: currentQuestion?.question || "",
    profile,
    interviewType,
    applicationId: posting?.id || null,
    codeLanguage,
  });

  // AC-H3: the read-only "Submitted for this application" panel's data —
  // same applicationId fact as sampleAnswer above (the picker option's `id`
  // IS the application id, per onDoneAnswer's own note below). Owns its own
  // load/generation-gating entirely (useApplicationDocs.js); this component
  // only decides WHETHER to render the panel (never when no posting is
  // selected — AC-H3.11) and never writes anything back into the prep
  // context (AC-H3.14) — `profile`/`setProfile` above are never touched by
  // this hook or by SubmittedDocs.
  const submittedDocs = useApplicationDocs(posting?.id || null);

  // BUG-J4: stays here — onDoneAnswer below reads it for the critique
  // payload, not exclusively a question-flow concern (askedRef/
  // currentQuestionRef/reqGenRef all moved into that hook; its
  // `interviewTypeRef` is gone entirely — a render-mirrored ref cannot be
  // current inside a synchronous store listener, so every consumer reads
  // `getInterviewType()` instead, see usePracticeQuestions.js:103).
  const postingRef = useRef(null);
  // AC-N2: arms "Next question"/"Try again" auto-start intent for
  // autoStartDecision (lib/copilot/practiceFlow.js) — a ref, not state,
  // because arming it is a side effect of a click that already has its own
  // reason to re-render (requestQuestion's loading flag), so a second,
  // dedicated render for the arm itself would be pure waste. Read fresh by
  // attemptAutoStart below, never listed as a dependency anywhere (writing
  // a ref must never itself be treated as "the thing that changed").
  const armedRef = useRef(false);
  // BUG fix: a failed fetch leaves the PREVIOUS question on screen —
  // usePracticeQuestions' catch sets questionError and deliberately does
  // not clear `currentQuestion` — so once `loading` goes back to false,
  // "is there a question" is true but stale, not evidence a new one
  // arrived. armedFromRef captures what was on screen at the moment the
  // press armed, so autoStartDecision can require the question to have
  // CHANGED instead, and never auto-start the recorder on the question the
  // user just moved off.
  const armedFromRef = useRef("");

  const running = status === "live" || status === "connecting";
  const controlsEnabled = status === "live";

  useEffect(() => {
    postingRef.current = posting;
  }, [posting]);

  // AC-N2: queues a sample-answer draft the moment a question lands, so
  // it's already cached (READY, never SHOWN — see useSampleAnswer's queue)
  // by the time the user reveals it, instead of paying for it and waiting
  // only after asking to see it. Gated by shouldQueueSampleAnswer
  // (lib/copilot/practiceFlow.js) so this never re-fires for a question it
  // already queued, never races the reveal panel's own request while it's
  // open, and never pays for a draft that's already cached (a prior queue
  // or a prior reveal).
  //
  // Deliberately independent of `armedRef`/autoStartDecision above — see
  // practiceFlow.test.js's "the two decisions are independent" cases: a
  // question reached ANY way (Next question, Retry, a posting change, the
  // first question of a session) still wants its answer queued, whether or
  // not a press is armed to auto-start the recorder.
  useEffect(() => {
    const should = shouldQueueSampleAnswer({
      question: currentQuestionText,
      loading: questionLoading,
      visible: sampleAnswer.visible,
      hasCached: sampleAnswer.hasCached(currentQuestionText),
      queuedFor: sampleAnswer.getQueuedFor(),
    });
    if (!should) return;
    sampleAnswer.queue(currentQuestionText, profile, interviewType, posting?.id || null, codeLanguage);
    // `sampleAnswer` is a fresh literal every render — depending on the
    // specific, stable members this body actually reads/calls is what keeps
    // this effect from re-running on every unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentQuestionText,
    questionLoading,
    sampleAnswer.visible,
    sampleAnswer.hasCached,
    sampleAnswer.getQueuedFor,
    sampleAnswer.queue,
    profile,
    interviewType,
    posting,
    codeLanguage,
  ]);

  // J2.4: the one-entry array CopilotDashboard's "Current question"/"Current
  // answer" panels read (see CopilotDashboard.js's latestQuestionEntry).
  // Live mode has a real running array of detected questions; practice mode
  // synthesizes this single-entry stand-in from `currentQuestion` and the
  // SAME `sampleAnswer` instance QuestionCard already renders below, so
  // revealing the sample answer in either place reveals it in both (J2.3) —
  // two independent visibility flags for one draft would let the card and
  // the dashboard panel disagree about whether the answer is showing.
  const dashboardQuestions = useMemo(() => {
    if (!currentQuestionText) return [];
    return [
      {
        id: currentQuestionText,
        question: currentQuestionText,
        status: sampleAnswer.status,
        points: sampleAnswer.points,
        // AC-K1: the dashboard's answer panel reads the same fields live
        // mode's detected-question entries carry, so the card and the panel
        // show one answer in one form — a panel still rendering full
        // sentences beside a card showing cues is the drift J2.3 exists to
        // prevent, in a new place.
        cues: sampleAnswer.cues,
        buzzwords: sampleAnswer.buzzwords,
        anchor: sampleAnswer.anchor,
        idealProject: sampleAnswer.idealProject,
        pageSources: sampleAnswer.pageSources,
        error: sampleAnswer.error,
      },
    ];
  }, [
    currentQuestionText,
    sampleAnswer.status,
    sampleAnswer.points,
    sampleAnswer.cues,
    sampleAnswer.buzzwords,
    sampleAnswer.anchor,
    sampleAnswer.idealProject,
    sampleAnswer.pageSources,
    sampleAnswer.error,
  ]);

  // AC-J2: practice mode's own instance of the SAME dashboard hook live mode
  // uses (useCopilotDashboard.js, formerly useLiveDashboard.js) — the whole
  // point of a practice dashboard is rehearsing against the instrument the
  // candidate will be reading mid-interview, so this must not become a
  // second, diverging implementation. The hook now only tracks the delivery
  // strip (pace/fillers, driven by recordSpeechSample) and its own session
  // reset, so it takes no arguments at all.
  const {
    pace,
    fillers,
    recordSpeechSample,
    // AC-J2.10: usePracticeAnswer above already returns its own
    // `resetForSession` (destructured near the top of this component) — the
    // dashboard hook's own reset is renamed at this destructuring site so
    // the two can never shadow one another, and start() below calls BOTH.
    resetForSession: resetDashboardForSession,
  } = useCopilotDashboard();

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
  }, [advanceAsked, abandonInProgressAnswer, resetAnswerState, requestQuestion, currentQuestionRef]);

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
    [resetQuestions, abandonInProgressAnswer, resetAnswerState],
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

  // AC-C3/AC-C4: the capture-session pipeline (camera/mic lifecycle,
  // transcript, elapsed clock, camera/mic toggles) lives in
  // usePracticeCaptureSession.js — see that module's own header for why
  // `status`/`setStatus` stay here as controlled state rather than moving in
  // with the rest: this hook's own `start` needs useCopilotDashboard's
  // `resetDashboardForSession`/`recordSpeechSample`, both already
  // destructured above, in return.
  const {
    error,
    warning,
    setWarning,
    finals,
    activeSessionId,
    interim,
    startedAt,
    elapsed,
    cameraOff,
    micMuted,
    stream,
    hasVideo,
    start,
    stop,
    onToggleCamera,
    onToggleMic,
    sessionRef,
  } = usePracticeCaptureSession({
    status,
    setStatus,
    micDeviceId,
    invalidateAndClearLoading,
    abandonInProgressAnswer,
    resetAnswerState,
    invalidateInFlight,
    clearForNewSession,
    resetForSession,
    resetDashboardForSession,
    requestQuestion,
    recordTranscriptEvent,
    recordSpeechSample,
    markMicMuted,
    // Final wave (AC-M2): the room-question detector, forwarded straight
    // into usePracticeCaptureSession so it can be handed to the
    // PracticeSession constructor alongside onTranscript/onStatus/onError/
    // onStream — see that hook's own comment on this option for how it
    // still sees the current handler despite the constructor call
    // happening well after render, inside start(). `roomQuestions.
    // onUtterance` is itself a stable callback (useRoomQuestions.js's own
    // [] + ref-only dependency chain), so this never forces `start` to be
    // rebuilt on its account.
    onUtterance: roomQuestions.onUtterance,
  });

  // AC-N2/AC-C4: the answer-lifecycle button handlers (Start answering, the
  // auto-start arming machinery, Done, Try again, Retry critique) live in
  // usePracticeAnswerActions.js — see that module's own header for why
  // armedRef/armedFromRef/postingRef stay declared here rather than moving
  // in with the rest (onNextQuestion above also writes armedRef/
  // armedFromRef, and postingRef is BUG-J4's own "not exclusively an
  // answer-flow concern" ref) and are passed down by reference instead.
  const { onStartAnswer, onDoneAnswer, onTryAgainAnswer, onRetryCritique } = usePracticeAnswerActions({
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
  });

  // AC-Q7: OBSERVES these already-destructured values — see
  // usePracticeSessionLog.js's own header for why.
  const sessionLog = usePracticeSessionLog({
    start, posting, interviewType,
    currentQuestionText, questionError, finals,
    // AC-Q7.9: usePracticeCaptureSession's own per-session identity — see
    // that hook's and usePracticeSessionLog's own comments on why the
    // finals effect compares against this instead of trusting `finals`'
    // length alone.
    activeSessionId,
    captureError: error, captureWarning: warning,
    answering, answerMetrics, critique, critiqueStatus, critiqueError,
  });

  // Derived from state, not hard-coded, and names every destination that
  // actually receives data on the CURRENT engine/switch combination — never
  // a static claim. On the Gemini engine, every critique request sends the
  // answer transcript, the posting details, and the prep-context profile to
  // Google, regardless of the frames switch; that switch only ever controls
  // whether still frames are ALSO sent (AC-C4-5) — unchanged by D1.
  const framesWillUpload = sendFrames && !isEmbedded;
  // AC-H5/AC-H6.23/BUG-H5: the critique route now ALSO fetches and sends the
  // submitted resume/cover letter to Gemini, grounding the critique the same
  // way revealing a sample answer already did — but ONLY when a posting is
  // selected AND that application actually has a document to send: with no
  // posting there is no application for either request to fetch documents
  // for, and even with one selected, an application whose
  // `resume_used_id`/`cover_letter_id` are both unset makes
  // fetchApplicationDocs return empty strings, in which case both routes'
  // `if (resume || coverLetter)` guard (app/api/copilot/critique/route.js,
  // app/api/copilot/answer/route.js) skips the document section entirely —
  // nothing is sent. `submittedDocs` (from useApplicationDocs, the same hook
  // backing the "Submitted for this application" panel) drives both
  // clauses; while its load is still unsettled (`loading`/`idle`) or has
  // failed (`error`), whether a document exists is genuinely unknown.
  const hasPosting = !!posting;
  // P1.6: the same fact live mode already reads for its own notice
  // (CopilotClient.js) and for VoiceCueSidebar — whether the selected posting
  // has a company on file. It is the exact predicate for whether the answer
  // route's company-facts search fires: `companyKnown` there is read off the
  // SAME `positions.company` column. Practice mode's room-question and typed-
  // question paths take that branch (no `mode`), so the clause has to be
  // gated on this rather than on whether a posting was merely selected.
  const hasCompany = !!String(posting?.company || "").trim();
  const docsSettled = submittedDocs.status === "done";
  const hasSubmittedResume = !!submittedDocs.resume;
  const hasSubmittedCoverLetter = !!submittedDocs.coverLetter;
  // AC-J3: the actual sentence-by-sentence derivation (critique/sample-
  // answer document clauses, the engine notice, the video notice, the STT
  // notice) now lives in lib/copilot/practiceNotices.js, extracted purely to
  // keep this component under this repo's line-count gate — its output is
  // byte-identical to what used to be inlined here (see that module's own
  // tests for the full combinatorial proof). F2: `sttProviderName` is passed
  // down from
  // CopilotClient, which learns it from the /api/copilot/token response
  // rather than this component fetching its own — one fetch per page is
  // enough for both modes' notices to agree. D1: `saveEnabled` is this
  // render's live value from useSaveRecordings, since the notice should
  // reflect whatever is true RIGHT NOW (unlike the upload decision itself,
  // which re-reads storage — see useSaveRecordings.js's own doc on
  // `readSaveEnabled`).
  // Final wave (AC-M2): roomQuestionPrivacyClause's own sentence is appended
  // after buildPrivacyNotice's full output — see that function's own doc
  // for why it lives in this file rather than inside practiceNotices.js
  // itself.
  const privacyNotice = `${buildPrivacyNotice({
    sttProviderName,
    isEmbedded,
    framesWillUpload,
    hasPosting,
    docsSettled,
    hasSubmittedResume,
    hasSubmittedCoverLetter,
    saveEnabled,
  })} ${roomQuestionPrivacyClause({ isEmbedded, hasPosting, docsSettled, hasSubmittedResume, hasSubmittedCoverLetter, hasCompany })}`;
  // G2/AC-G2-C-6/AC-A12: resolved from usePracticeAnswer's OWN captured
  // judgedInterviewType, not the live `interviewType` — a foreign-origin
  // change no longer clears the answer on screen (AC-A11), so this now
  // holds by CONSTRUCTION (captured at the moment each critique's
  // answerMetrics are set) rather than by destruction.
  const judgedInterviewTypeLabel = interviewTypeLabel(judgedInterviewType);

  // Mobile shell (defects 1/2): below `md` the primary "Start answering" /
  // "Done" loop and the self-view must both be reachable without scrolling
  // past the five-panel dashboard first. `useIsTablet` (below `md`, i.e. the
  // SAME cutoff the camera/transcript Stack's own `{ xs, md }` direction
  // switches on below) rather than `useIsMobile` (below `sm`) so this and
  // the CSS `order` values a few lines down never disagree about which
  // width phones-and-small-tablets belongs to.
  const isTablet = useIsTablet();

  return (
    <Box>
      <PracticeSetup
        privacyNotice={privacyNotice}
        profile={profile}
        onProfileChange={setProfile}
        error={error}
        warning={warning}
        onDismissWarning={() => setWarning("")}
        interviewType={interviewType}
        onInterviewTypeChange={onInterviewTypeChange}
        codeLanguage={codeLanguage}
        onCodeLanguageChange={setCodeLanguage}
        isEmbedded={isEmbedded}
        posting={posting}
        onPostingChange={onPostingChange}
        submittedDocs={submittedDocs}
      />

      <PracticeControls
        micDeviceId={micDeviceId}
        onMicDeviceChange={onMicDeviceChange}
        running={running}
        status={status}
        onStop={stop}
        onStart={sessionLog.onStart}
        startedAt={startedAt}
        elapsed={elapsed}
        controlsEnabled={controlsEnabled}
        cameraOff={cameraOff}
        hasVideo={hasVideo}
        onToggleCamera={onToggleCamera}
        micMuted={micMuted}
        onToggleMic={onToggleMic}
        sendFrames={sendFrames}
        isEmbedded={isEmbedded}
        onSendFramesChange={(e) => setSendFrames(e.target.checked)}
        saveEnabled={saveEnabled}
        onToggleSaveEnabled={onToggleSaveEnabled}
        onDownloadLog={sessionLog.downloadLog}
        downloadLogEnabled={sessionLog.hasLog}
      />

      {/* Shown once at least one answer has been analyzed (AC-C4-6), and
          rendered independent of the review panel below so it stays
          visible through "Next question"/"Try again" instead of vanishing
          alongside the just-cleared answerMetrics (BUG-16). */}
      {sessionAnswered > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Session so far: {sessionAnswered} question{sessionAnswered === 1 ? "" : "s"} answered, average
          score {sessionAverageScore}/100.
        </Alert>
      ) : null}

      {/* Defect 1 (mobile shell, BLOCKER): below `md` the five-panel
          dashboard is ~1100px tall on its own, which buried QuestionCard's
          Start answering / Done controls multiple screens down.
          Defect 2 (BLOCKER): the compact self-view sits ahead of
          QuestionCard, so a phone user can see the question and their own
          face together without scrolling — practice mode's whole premise is
          watching yourself answer. It is the ONLY CameraPreview rendered
          below `md`; the full-size instance further down (the
          camera/transcript Stack) only mounts at `md`+ (see `isTablet`
          there), so a given MediaStream is never handed to two <video>
          elements at once.

          This reorders the DOM, NOT just the paint order. The first version
          of this fix used breakpoint-keyed CSS `order` on a flex column,
          which moves the pixels and leaves the DOM alone — so below `md` a
          keyboard or screen-reader user met the dashboard (including its
          "Show sample answer" button) BEFORE the question card, while every
          sighted user saw the opposite. That is a visual/focus order
          mismatch, WCAG 2.4.3 and 1.3.2, and it is exactly the trap CSS
          `order` sets. Reordering the array instead keeps the two in
          agreement.

          The `key`s are what make this safe: React matches keyed children
          across a reorder, so crossing the breakpoint MOVES these two
          elements rather than unmounting and remounting them. That matters
          beyond cheapness — CopilotDashboard's panels carry `aria-live`
          regions, and a region that remounts already holding its final text
          is not announced (see lib/copilot/answerStatus.js), so a remount
          here would silently drop announcements on every rotation. */}
      <Box>
        {isTablet ? (
          <Box sx={{ mb: 2 }}>
            <CameraPreview stream={stream} hasVideo={hasVideo} cameraOff={cameraOff} compact />
          </Box>
        ) : null}

        {(isTablet ? ["question", "dashboard"] : ["dashboard", "question"]).map((slot) =>
          slot === "dashboard" ? (
            <Box key="dashboard" sx={{ mb: 2 }}>
              <CopilotDashboard
                questions={dashboardQuestions}
                copy={PRACTICE_COPY}
                pace={pace}
                fillers={fillers}
                // AC-J2.3: gated behind the SAME useSampleAnswer instance
                // QuestionCard's own sample-answer panel uses below, so
                // revealing the answer in either place reveals it in both —
                // practice mode's whole drill is answering cold, and the
                // dashboard must not put the model's answer on screen before
                // the candidate asks for it.
                answerHidden={!sampleAnswer.visible}
                onRevealAnswer={sampleAnswer.toggle}
                revealLabel="Show sample answer"
              />
            </Box>
          ) : (
            <Box key="question" sx={{ mb: 2 }}>
              <QuestionCard
                question={currentQuestion?.question || ""}
                type={currentQuestion?.type || "general"}
                loading={questionLoading}
                error={questionError}
                exhausted={exhausted}
                sessionActive={running}
                hasPosting={!!posting}
                live={status === "live"}
                answering={answering}
                settling={settling}
                onNext={onNextQuestion}
                onRetry={onRetryQuestion}
                onStartAnswer={onStartAnswer}
                onDoneAnswer={onDoneAnswer}
                sampleVisible={sampleAnswer.visible}
                sampleStatus={sampleAnswer.status}
                sampleAnswerPoints={sampleAnswer.points}
                sampleCues={sampleAnswer.cues}
                sampleBuzzwords={sampleAnswer.buzzwords}
                sampleAnchor={sampleAnswer.anchor}
                sampleIdealProject={sampleAnswer.idealProject}
                samplePageSources={sampleAnswer.pageSources}
                sampleGrounding={sampleAnswer.grounding}
                sampleError={sampleAnswer.error}
                isEmbedded={isEmbedded}
                onToggleSample={sampleAnswer.toggle}
                onRetrySample={sampleAnswer.retry}
                onRegenerateSample={sampleAnswer.regenerate}
              />
              {/* AC-O5: lives directly below the drill card, not beside the
                  feed at the bottom — this slot block already reorders so
                  the question card comes first on phones, and a typed
                  question's primary effect IS that card (submitPracticeQuestion
                  sets it as the drill question); the feed entry below is the
                  secondary effect. */}
              <Box sx={{ mt: 2 }}>
                <ManualQuestion
                  onSubmit={onManualQuestion}
                  label="Type your own question"
                  buttonLabel="Use question"
                  confirmLabel="Set as your practice question and added to detected questions"
                  helperText="It becomes the question on the card above, and also gets an answer drafted in the detected questions below."
                />
              </Box>
            </Box>
          ),
        )}
      </Box>

      {!answering && !settling && answerMetrics ? (
        <>
          <AnswerReview
            transcript={answerTranscript}
            metrics={answerMetrics}
            replayUrl={replayUrl}
            replaySupported={replaySupported}
          />
          {/* D1's save state, surfaced honestly (AC-D1-3): only ever shown
              when a save was actually attempted (saveStatus starts, and
              stays, "idle" when the switch above is off — see
              usePracticeAnswer's persistAnswer). "failed" states plainly
              what went wrong rather than implying the recording was kept. */}
          {saveStatus === "saving" ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Saving this answer to your practice history…
            </Alert>
          ) : null}
          {saveStatus === "saved" ? (
            <Alert severity={saveError ? "warning" : "success"} sx={{ mb: 2 }}>
              {saveError ? `Saved to your practice history. ${saveError}` : "Saved to your practice history."}
            </Alert>
          ) : null}
          {saveStatus === "failed" ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This answer was not saved to your practice history: {saveError || "an unknown error occurred."}
            </Alert>
          ) : null}
          <AnswerFeedback
            status={critiqueStatus}
            feedback={critique}
            error={critiqueError}
            // D3 bug fix: AnswerFeedback cannot tell frames-sent from
            // frames-not-sent (or resolve D2's unavailable-reason code) from
            // the response contract alone — both already live here.
            //
            // K1: this is `critiqueFramesSent` (usePracticeAnswer), NOT
            // `framesWillUpload` below. `framesWillUpload` is re-derived from
            // the "Include camera frames" switch's LIVE state every render —
            // correct for describing what the NEXT request will do (see its
            // own doc and buildPrivacyNotice below), but the switch lives on
            // this same screen as the feedback panel, so toggling it after a
            // critique has already returned would silently rewrite the
            // panel's claim about a request that already happened.
            // critiqueFramesSent instead is written once, at the moment each
            // critique settles, from the frames array that request actually
            // sent — a retrospective fact that toggling the switch afterward
            // cannot change.
            framesSent={critiqueFramesSent}
            bodyLanguageReason={answerMetrics?.bodyLanguage?.reason || null}
            interviewTypeLabel={judgedInterviewTypeLabel}
            onRetry={onRetryCritique}
            onNext={onNextQuestion}
            onTryAgain={onTryAgainAnswer}
          />
        </>
      ) : null}

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{ alignItems: "stretch" }}
      >
        {/* Defect 2: below `md` the self-view already renders, compact,
            above QuestionCard (see the flex-order wrapper above this
            component's Alert/dashboard/QuestionCard block) — rendering it a
            second time here too would mount two <video> elements against
            the same MediaStream at once, which CameraPreview's own
            srcObject effect is not built to share. `isTablet` is that same
            wrapper's cutoff, so the two never disagree about which one a
            given width renders. */}
        {isTablet ? null : (
          <CameraPreview stream={stream} hasVideo={hasVideo} cameraOff={cameraOff} />
        )}
        <TranscriptView
          finals={finals}
          interims={{ them: "", you: interim }}
          startedAt={startedAt}
        />
      </Stack>

      {/* Final wave (AC-M2): an ADDITIONAL panel, not a replacement for the
          drill above — QuestionCard (the generated practice question) stays
          the primary thing on screen; this sits below the camera/transcript
          row, exactly like live mode's own QuestionFeed sits beside its
          transcript rather than above the detected-question history it
          documents. Reuses QuestionFeed/AnswerLines/AnswerAids unmodified
          (see useRoomQuestions.js's own doc for why the entries it's fed
          already match that component's contract field for field), so a
          room question's drafted answer looks exactly like every other
          drafted answer in this app — same cues, same buzzwords/resume/
          ideal-project aids, same accessible status region. */}
      <Box sx={{ mt: 2 }}>
        <QuestionFeed questions={roomQuestions.questions} onDraft={roomQuestions.onDraft} />
      </Box>

      <Box sx={{ mt: 2 }}>
        <PracticeHistory refreshSignal={savedAnswerVersion} />
      </Box>
    </Box>
  );
}
