"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { PracticeSession } from "@/lib/copilot/practiceSession";
import { fmtClock } from "@/lib/copilot/clock";
import { interviewTypeLabel } from "@/lib/copilot/interviewTypes";
import { buildPrivacyNotice } from "@/lib/copilot/practiceNotices";
import { useEngine } from "@/app/settings/engine";
import TranscriptView from "../TranscriptView";
import StatusPill from "../StatusPill";
import CameraPreview from "./CameraPreview";
import PostingPicker from "../PostingPicker";
import SubmittedDocs from "../SubmittedDocs";
import { useApplicationDocs } from "../useApplicationDocs";
import MicPicker from "../MicPicker";
import CopilotDashboard, { PRACTICE_COPY } from "../dashboard/CopilotDashboard";
import { useCopilotDashboard } from "../useCopilotDashboard";
import InterviewTypePicker from "./InterviewTypePicker";
import QuestionCard from "./QuestionCard";
import AnswerReview from "./AnswerReview";
import AnswerFeedback from "./AnswerFeedback";
import PracticeHistory from "./PracticeHistory";
import { usePracticeAnswer } from "./usePracticeAnswer";
import { usePracticeQuestions } from "./usePracticeQuestions";
import { useSampleAnswer } from "./useSampleAnswer";
import { useInterviewType } from "./useInterviewType";
import { useSaveRecordings, readSaveEnabled } from "./useSaveRecordings";
import { usePrepContext } from "../usePrepContext";
import PrepContext from "../PrepContext";

// Practice mode's capture layer: camera + mic, transcribed as "you", plus a
// posting picker, a generated interview question to practice against, (C3)
// recording + measuring the spoken answer itself, and (C4) judging what was
// actually said plus the repeat loop. The answer-recording flow (recorder,
// sampler, drain, generation guard, replay URL lifecycle, metrics/critique
// state) lives in usePracticeAnswer (AC-C4-8) — this component owns the
// capture session, the posting picker, the question, and the layout.
export default function PracticeClient({ sttProviderName, micDeviceId, onMicDeviceChange } = {}) {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [finals, setFinals] = useState([]); // { id, speaker: "you", text, at }
  const [interim, setInterim] = useState("");
  const [startedAt, setStartedAt] = useState(null);
  const [now, setNow] = useState(0);
  const [cameraOff, setCameraOff] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [stream, setStream] = useState(null);
  const [hasVideo, setHasVideo] = useState(false);

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
    asked,
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
  } = usePracticeQuestions({ posting, interviewType });

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

  // AC-J2.7: "Pre-draft predicted answer" — plain component state, not
  // persisted, the same way live mode's Auto-draft switch (CopilotClient.js)
  // is plain state rather than a stored preference. It exists so the user
  // can turn off the extra model call a pre-draft costs per prediction
  // (AC-I4.26's cost concern, restated here since practice mode has no
  // other auto-drafting control to piggyback on); its value is what's
  // passed to useCopilotDashboard as `autoDraft` below.
  const [preDraftPredicted, setPreDraftPredicted] = useState(true);

  const {
    answering,
    settling,
    answerTranscript,
    answerMetrics,
    replayUrl,
    replaySupported,
    startAnswer: startAnswerFlow,
    doneAnswer: doneAnswerFlow,
    abandonInProgressAnswer,
    resetAnswerState,
    resetForSession,
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

  const sessionRef = useRef(null);
  const idRef = useRef(0);
  // BUG-J4: stays here — onDoneAnswer below reads it for the critique
  // payload, not exclusively a question-flow concern (askedRef/
  // currentQuestionRef/interviewTypeRef/reqGenRef all moved into that hook).
  const postingRef = useRef(null);

  const running = status === "live" || status === "connecting";
  const controlsEnabled = status === "live";

  useEffect(() => {
    if (!running || !startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, startedAt]);

  useEffect(() => {
    postingRef.current = posting;
  }, [posting]);

  // AC-J2.6: primes useSampleAnswer's own cache (AC-J2.8) with a dashboard
  // pre-draft — the practice-mode counterpart of live mode's
  // onPrefetchedAnswer (CopilotClient.js), which writes into its
  // answerCacheRef the same way. `payload` is passed straight through: it
  // already carries the profile/interviewType/applicationId the draft was
  // ACTUALLY built from (see useCopilotDashboard.js's runPredraft), and
  // re-deriving those from current render state instead would mislabel a
  // draft whose inputs changed while it was in flight. Deliberately depends
  // on `sampleAnswer.prime` (stable, [] deps inside useSampleAnswer) rather
  // than the whole `sampleAnswer` object, which is a fresh literal every
  // render — depending on it would defeat the whole point of this being a
  // useCallback, hence the exhaustive-deps override below.
  const onPrefetchedAnswer = useCallback(
    (question, payload) => sampleAnswer.prime(question, payload),
    [sampleAnswer.prime], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // J2.5: the ASKED list plus the current question, oldest first, in the
  // `{ question }` shape askedQuestionsFor (useCopilotDashboard.js) expects
  // — this is what the prediction predicts FROM. Deliberately a DIFFERENT
  // array from `dashboardQuestions` below, which drives what the
  // dashboard's "Current question"/"Current answer" panels actually
  // display (J2.4): feeding the predictor a list that includes the
  // not-yet-asked current question is correct (an interviewer choosing the
  // next question already knows what was just asked), but the display
  // panels must show ONLY that current question, never the whole history.
  // Memoized on `asked`/`currentQuestionText` alone: useCopilotDashboard
  // keys its own effect on the derived signature STRING, not on this
  // array's reference, so a fresh array every render causes no bug — but it
  // did re-fire that hook's questionsRef sync effect on every render for
  // nothing, since a new array is a new reference every time.
  const dashboardAskedQuestions = useMemo(() => {
    return currentQuestionText
      ? [...asked.map((q) => ({ question: q })), { question: currentQuestionText }]
      : asked.map((q) => ({ question: q }));
  }, [asked, currentQuestionText]);

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
    sampleAnswer.error,
  ]);

  // AC-J2: practice mode's own instance of the SAME dashboard hook live mode
  // uses (useCopilotDashboard.js, formerly useLiveDashboard.js) — the whole
  // point of a practice dashboard is rehearsing against the instrument the
  // candidate will be reading mid-interview, so this must not become a
  // second, diverging implementation. `draftMode: "answer"` asks for the
  // same response shape useSampleAnswer already requests, which is what
  // makes priming its cache with a pre-draft sound (see that hook's `prime`
  // and AC-J2.9 in useCopilotDashboard.js). `active: running` mirrors
  // CopilotClient's own `active: live` — a posting selected or a question
  // on screen before Start practice is pressed must not spend a model call.
  const {
    pace,
    predictedQuestion,
    predictionStatus,
    predictionError,
    retryPrediction,
    retryPredraft,
    predictedPoints,
    predictedCues,
    predictedAnswerStatus,
    predictedAnswerError,
    recordSpeechSample,
    // AC-J2.10: usePracticeAnswer above already returns its own
    // `resetForSession` (destructured near the top of this component) — the
    // dashboard hook's own reset is renamed at this destructuring site so
    // the two can never shadow one another, and start() below calls BOTH.
    resetForSession: resetDashboardForSession,
  } = useCopilotDashboard({
    questions: dashboardAskedQuestions,
    posting,
    applicationId: posting?.id || null,
    profile,
    interviewType,
    draftMode: "answer",
    autoDraft: preDraftPredicted,
    active: running,
    onPrefetchedAnswer,
  });

  // "Next question": advanceAsked (usePracticeQuestions) does the
  // question-side half — see its own doc for the dedupe rule. Order matters
  // here: abandonInProgressAnswer/resetAnswerState run BETWEEN computing
  // the next asked list and requesting it, mirroring the inline version
  // exactly (the question changing invalidates the previous answer).
  const onNextQuestion = useCallback(() => {
    const next = advanceAsked();
    abandonInProgressAnswer();
    resetAnswerState();
    requestQuestion(next);
  }, [advanceAsked, abandonInProgressAnswer, resetAnswerState, requestQuestion]);

  const onRetryQuestion = useCallback(() => {
    abandonInProgressAnswer();
    resetAnswerState();
    retryFetch();
  }, [abandonInProgressAnswer, resetAnswerState, retryFetch]);

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

  // G2/AC-G2-C-3: changing the interview type reshapes questions, the
  // sample answer, and the critique's rubric alike — it does everything
  // onPostingChange above does, for the same reasons (a question request
  // in flight belongs to the old format; the asked list, current question,
  // and any answer on screen all belonged to it too), EXCEPT it leaves the
  // selected posting untouched — the two selections are independent.
  const onInterviewTypeChange = useCallback(
    (nextType) => {
      setInterviewType(nextType);
      resetQuestions();
      abandonInProgressAnswer();
      resetAnswerState();
    },
    [setInterviewType, resetQuestions, abandonInProgressAnswer, resetAnswerState],
  );

  const stop = useCallback(async () => {
    // Invalidate any question request in flight — its response belongs to a
    // session that is being torn down — and stop the card from sitting on a
    // spinner for a request that will never get to write its result.
    invalidateAndClearLoading();
    // An answer in progress or still settling must be finalized cleanly,
    // not abandoned mid-recording with a dangling interval/recorder — see
    // AC-C3-4 and BUG-4.
    abandonInProgressAnswer();
    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = null;
    }
    setInterim("");
    setStream(null);
    setHasVideo(false);
    setStatus("idle");
    resetAnswerState();
  }, [invalidateAndClearLoading, abandonInProgressAnswer, resetAnswerState]);

  // Unmounting (e.g. switching back to live mode) must not leave the camera
  // or mic running — stop whatever session is active on the way out. The
  // answer flow's own recorder/sampler/timer/replay-URL teardown lives in
  // usePracticeAnswer's own unmount effect.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
    };
  }, []);

  const start = useCallback(async () => {
    // Invalidate any question request already in flight (e.g. from a Stop
    // that just happened, or a still-resolving request from before) before
    // any of the async work below runs — a response for the OLD session
    // landing after this point must not overwrite what's about to start.
    invalidateInFlight();
    // Idempotent: a stray session (e.g. one that's mid-teardown from an
    // unsolicited close) must never be orphaned by pressing Start again.
    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = null;
    }
    setError("");
    setWarning("");
    setFinals([]);
    setInterim("");
    setStartedAt(null);
    setCameraOff(false);
    setMicMuted(false);
    setStream(null);
    setHasVideo(false);
    // A fresh start resets the asked list — it's scoped to a session, and a
    // new session should be able to hear its opening question again.
    clearForNewSession();
    // A fresh start also leaves no answer, recorder, or sampler behind from
    // whatever the previous session was doing, and resets the audio-time
    // clock to 0 — it's relative to THIS session's Deepgram socket.
    resetForSession();
    // AC-J2.10: the dashboard hook's own reset — clears its pace samples and
    // any prediction/pre-draft left over from a previous session the same
    // way resetForSession above clears the answer flow's own state. Without
    // this, a session restarted against the same posting with no questions
    // asked yet could briefly keep showing the PREVIOUS session's stale
    // prediction (see useCopilotDashboard.js's own resetForSession doc).
    resetDashboardForSession();
    setStatus("connecting");
    // Fire-and-forget: requestQuestion catches its own errors into
    // questionError, so a slow or failed question request never blocks or
    // fails the capture session starting up.
    requestQuestion([]);
    try {
      const session = new PracticeSession({
        withVideo: true,
        micDeviceId,
        onStatus: (s) => {
          setStatus(s);
          if (s === "live") {
            setStartedAt((prev) => prev || Date.now());
          } else if (s === "idle") {
            // The session can tear itself down on its own (an "ended" track,
            // or an unsolicited socket close) — reset the same view state
            // the explicit Stop button resets, including finalizing any
            // answer that was mid-recording or settling AND clearing
            // whatever review/feedback was on screen. Without
            // resetAnswerState here, bumping the generation (inside
            // abandonInProgressAnswer) strands an in-flight critique's
            // status at "loading" forever, since its eventual response is
            // gen-gated and writes nothing — every abandonment path must be
            // symmetric with the explicit Stop handler below (BUG-15).
            abandonInProgressAnswer();
            resetAnswerState();
            setInterim("");
            setStream(null);
            setHasVideo(false);
            sessionRef.current = null;
          }
        },
        onError: (err) => setWarning(err.message),
        onTranscript: ({ transcript, isFinal, start: audioStart, duration: audioDuration }) => {
          recordTranscriptEvent({ isFinal, transcript, start: audioStart, duration: audioDuration });

          if (!isFinal) {
            setInterim(transcript);
            return;
          }
          setInterim("");
          // AC-J2.9: feed the dashboard's pace sampler from FINAL frames
          // only — appendSpeechSample (via recordSpeechSample) already
          // drops frames whose start/duration aren't usable numbers, so
          // this passes them through as-is rather than pre-filtering here,
          // and never substitutes a wall-clock value for a missing one
          // (same discipline CopilotClient's own onTranscript handler
          // follows for live mode).
          recordSpeechSample({ text: transcript, start: audioStart, duration: audioDuration });
          setFinals((prev) => [
            ...prev,
            { id: (idRef.current += 1), speaker: "you", text: transcript, at: Date.now() },
          ]);
        },
        // Published as soon as capture succeeds, well before the Deepgram
        // socket connects, so the self-view never lies about the camera
        // being off during the "connecting" phase.
        onStream: (s, hasV) => {
          setStream(s);
          setHasVideo(hasV);
        },
      });
      sessionRef.current = session;
      await session.start();
    } catch (err) {
      setError(err?.message || "Could not start practice.");
      // A camera-unavailable warning from earlier in this same start() only
      // makes sense next to a running session — a hard failure means the
      // session never came up, so any stale soft warning must go with it.
      setWarning("");
      setStatus("error");
      await stop();
    }
  }, [
    stop,
    requestQuestion,
    invalidateInFlight,
    clearForNewSession,
    abandonInProgressAnswer,
    resetAnswerState,
    resetForSession,
    resetDashboardForSession,
    recordTranscriptEvent,
    recordSpeechSample,
    micDeviceId,
  ]);

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
  }, [status, startAnswerFlow, micMuted, currentQuestionRef]);

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
  }, [doneAnswerFlow, profile, sendFrames, isEmbedded, interviewType, currentQuestionRef]);

  // "Try again" re-answers the SAME question: clears the same per-answer
  // state Next question clears (transcript, metrics, frames, replay clip,
  // feedback) but leaves the question itself — and the asked list — in
  // place, unlike onNextQuestion.
  const onTryAgainAnswer = useCallback(() => {
    abandonInProgressAnswer();
    resetAnswerState();
  }, [abandonInProgressAnswer, resetAnswerState]);

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

  const onToggleCamera = useCallback((e) => {
    const on = e.target.checked;
    setCameraOff(!on);
    sessionRef.current?.setCameraOff(!on);
  }, []);

  const onToggleMic = useCallback(
    (e) => {
      const muted = e.target.checked;
      setMicMuted(muted);
      sessionRef.current?.setMicMuted(muted);
      // Only what happens WHILE actively recording affects the answer being
      // measured — muting after Done has no bearing on an answer that's
      // already done being recorded (see BUG-6).
      markMicMuted(muted);
    },
    [markMicMuted],
  );

  const elapsed = startedAt ? now - startedAt : 0;
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
  const docsSettled = submittedDocs.status === "done";
  const hasSubmittedResume = !!submittedDocs.resume;
  const hasSubmittedCoverLetter = !!submittedDocs.coverLetter;
  // AC-J3: the actual sentence-by-sentence derivation (critique/sample-
  // answer document clauses, the pre-draft clause, the engine notice, the
  // video notice, the STT notice) now lives in lib/copilot/practiceNotices.js,
  // extracted purely to keep this component under this repo's line-count
  // gate — with `preDraftEnabled: false`, its output is byte-identical to
  // what used to be inlined here (see that module's own tests for the full
  // combinatorial proof). F2: `sttProviderName` is passed down from
  // CopilotClient, which learns it from the /api/copilot/token response
  // rather than this component fetching its own — one fetch per page is
  // enough for both modes' notices to agree. D1: `saveEnabled` is this
  // render's live value from useSaveRecordings, since the notice should
  // reflect whatever is true RIGHT NOW (unlike the upload decision itself,
  // which re-reads storage — see useSaveRecordings.js's own doc on
  // `readSaveEnabled`).
  const privacyNotice = buildPrivacyNotice({
    sttProviderName,
    isEmbedded,
    framesWillUpload,
    hasPosting,
    docsSettled,
    hasSubmittedResume,
    hasSubmittedCoverLetter,
    saveEnabled,
    // BUG-J3: discloses the pre-draft switch's automatic Gemini send.
    preDraftEnabled: preDraftPredicted,
  });
  // G2/AC-G2-C-6: resolved once here, from the CURRENT interview type,
  // rather than inside AnswerFeedback — changing interview type always
  // clears any answer on screen (onInterviewTypeChange above), so this is
  // always the type whatever critique is showing was actually judged
  // against.
  const judgedInterviewTypeLabel = interviewTypeLabel(interviewType);

  return (
    <Box>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
        {privacyNotice}
      </Typography>

      <PrepContext value={profile} onChange={setProfile} />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {warning ? (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setWarning("")}>
          {warning}
        </Alert>
      ) : null}

      <Box sx={{ mb: 2 }}>
        <InterviewTypePicker value={interviewType} onChange={onInterviewTypeChange} disabled={false} />
      </Box>

      <Box sx={{ mb: 2 }}>
        <PostingPicker value={posting} onChange={onPostingChange} disabled={false} />
      </Box>

      {/* AC-H3.11: rendered whenever a posting is selected, in BOTH modes,
          and absent entirely otherwise — never shown in some disabled/empty
          state for "no posting". */}
      {posting ? (
        <SubmittedDocs
          status={submittedDocs.status}
          resume={submittedDocs.resume}
          coverLetter={submittedDocs.coverLetter}
          error={submittedDocs.error}
          onRetry={submittedDocs.retry}
        />
      ) : null}

      {/* AC-J1.6: the microphone is one piece of hardware shared with live
          mode — CopilotClient owns the selection AND the localStorage key
          (see its own MIC_STORAGE_KEY doc) and hands both down as props,
          exactly the way it already hands down `sttProviderName`. This
          component owns no storage logic of its own for it. Laid out like
          live mode's own "Your microphone:" row in CopilotClient.js, placed
          above the Start/Stop row the same way that row sits above live
          mode's Start/Stop row. */}
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          Your microphone:
        </Typography>
        <MicPicker value={micDeviceId} onChange={onMicDeviceChange} disabled={running} />
      </Stack>

      <Stack
        direction="row"
        spacing={1.5}
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        {running ? (
          <Button variant="outlined" color="error" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button variant="contained" onClick={start}>
            Start practice
          </Button>
        )}
        <StatusPill status={status} />
        {startedAt ? (
          <Typography
            variant="body2"
            sx={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}
          >
            {fmtClock(elapsed)}
          </Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={!cameraOff}
              disabled={!controlsEnabled || !hasVideo}
              onChange={onToggleCamera}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Camera
            </Typography>
          }
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={micMuted}
              disabled={!controlsEnabled}
              onChange={onToggleMic}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Mute mic
            </Typography>
          }
        />
      </Stack>

      {/* AC-J2.7: "Pre-draft predicted answer" shares this row with the two
          switches it was named alongside — camera frames and save
          recordings — rather than a third row of its own. */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={sendFrames}
              disabled={isEmbedded}
              onChange={(e) => setSendFrames(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Include camera frames in AI feedback
            </Typography>
          }
        />
        <FormControlLabel
          control={
            <Switch size="small" checked={saveEnabled} onChange={onToggleSaveEnabled} />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Save recordings to my account
            </Typography>
          }
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={preDraftPredicted}
              onChange={(e) => setPreDraftPredicted(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Pre-draft predicted answer
            </Typography>
          }
        />
        {/* BUG-J2: this used to say "...separate from saving recordings
            below", which became wrong once the save switch moved into this
            same row (it reads as a locator, not a claim about coverage). It
            briefly said "and from pre-drafting predicted answers" too, but
            that was a FALSE privacy claim in the dangerous direction: the
            embedded engine's own sentence above ("Sample answers are
            drafted on this server too") already covers pre-drafting
            correctly — draftAnswer sends `engine: readEngine()`, and
            app/api/copilot/answer/route.js's wantsEmbedded branch drafts
            locally, so a pre-draft on this engine reaches no AI provider at
            all. Saying "separate from" pre-drafting would have told the
            user the embedded guarantee excludes it, which understates the
            protection they actually have. Only saving recordings is
            genuinely a separate destination (Supabase upload happens
            identically on every engine), so only that stays named here. */}
        {isEmbedded ? (
          <Typography variant="caption" sx={{ color: "var(--text-muted)" }}>
            The embedded engine never sends your answer, posting, or frames to an AI provider. This is
            separate from saving recordings.
          </Typography>
        ) : null}
      </Stack>

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

      {/* AC-J2.1: the same five-panel dashboard live mode shows, so a
          candidate rehearses against the instrument they will be reading
          during a real interview — see CopilotDashboard.js's own module doc
          for why the layout, states, and copy stay identical between modes.
          Does NOT replace QuestionCard below, which keeps its own Next
          question / Start answering / Done / sample-answer controls. */}
      <Box sx={{ mb: 2 }}>
        <CopilotDashboard
          questions={dashboardQuestions}
          copy={PRACTICE_COPY}
          pace={pace}
          predictedQuestion={predictedQuestion}
          predictionStatus={predictionStatus}
          predictionError={predictionError}
          onRetryPrediction={retryPrediction}
          onRetryPredraft={retryPredraft}
          predictedPoints={predictedPoints}
          predictedCues={predictedCues}
          predictedAnswerStatus={predictedAnswerStatus}
          predictedAnswerError={predictedAnswerError}
          // AC-J2.3: gated behind the SAME useSampleAnswer instance
          // QuestionCard's own sample-answer panel uses below, so revealing
          // the answer in either place reveals it in both — practice mode's
          // whole drill is answering cold, and the dashboard must not put
          // the model's answer on screen before the candidate asks for it.
          answerHidden={!sampleAnswer.visible}
          onRevealAnswer={sampleAnswer.toggle}
          revealLabel="Show sample answer"
        />
      </Box>

      <Box sx={{ mb: 2 }}>
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
          sampleGrounding={sampleAnswer.grounding}
          sampleError={sampleAnswer.error}
          isEmbedded={isEmbedded}
          onToggleSample={sampleAnswer.toggle}
          onRetrySample={sampleAnswer.retry}
          onRegenerateSample={sampleAnswer.regenerate}
        />
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
        <CameraPreview stream={stream} hasVideo={hasVideo} cameraOff={cameraOff} />
        <TranscriptView
          finals={finals}
          interims={{ them: "", you: interim }}
          startedAt={startedAt}
        />
      </Stack>

      <Box sx={{ mt: 2 }}>
        <PracticeHistory refreshSignal={savedAnswerVersion} />
      </Box>
    </Box>
  );
}
