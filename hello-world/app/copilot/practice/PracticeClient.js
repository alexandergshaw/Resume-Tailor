"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { PracticeSession } from "@/lib/copilot/practiceSession";
import { fmtClock } from "@/lib/copilot/clock";
import { fetchNextQuestion } from "@/lib/copilot/questionClient";
import { normalizeQuestion } from "@/lib/copilot/questions";
import { interviewTypeLabel } from "@/lib/copilot/interviewTypes";
import { useEngine } from "@/app/settings/engine";
import TranscriptView from "../TranscriptView";
import StatusPill from "../StatusPill";
import CameraPreview from "./CameraPreview";
import PostingPicker from "./PostingPicker";
import InterviewTypePicker from "./InterviewTypePicker";
import QuestionCard from "./QuestionCard";
import AnswerReview from "./AnswerReview";
import AnswerFeedback from "./AnswerFeedback";
import PracticeHistory from "./PracticeHistory";
import { usePracticeAnswer } from "./usePracticeAnswer";
import { useSampleAnswer } from "./useSampleAnswer";
import { useInterviewType } from "./useInterviewType";
import { usePrepContext } from "../usePrepContext";
import PrepContext from "../PrepContext";

// D1: whether recorded answers are saved to the user's account, persisted in
// localStorage under a new key alongside the existing practice preferences
// (usePrepContext.js's PREP_STORAGE_KEY, app/settings/engine.js's
// ENGINE_STORAGE_KEY). Built as a real external store — same shape as
// engine.js's useEngine — rather than a mount effect that calls setState:
// getServerSaveEnabledSnapshot keeps the server render and the client's
// first hydration pass identical (no flash/mismatch), and there is no
// separate effect synchronously writing state afterward for the "set state
// in an effect" lint rule to flag. Defaults ON — see AC-D1-4.
const SAVE_RECORDINGS_STORAGE_KEY = "copilot-practice-save-recordings";
const DEFAULT_SAVE_ENABLED = true;
const saveEnabledListeners = new Set();

function readSaveEnabled() {
  if (typeof window === "undefined") return DEFAULT_SAVE_ENABLED;
  try {
    const stored = window.localStorage.getItem(SAVE_RECORDINGS_STORAGE_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
    return DEFAULT_SAVE_ENABLED;
  } catch {
    return DEFAULT_SAVE_ENABLED;
  }
}

function getServerSaveEnabledSnapshot() {
  return DEFAULT_SAVE_ENABLED;
}

function subscribeSaveEnabled(callback) {
  saveEnabledListeners.add(callback);
  return () => saveEnabledListeners.delete(callback);
}

function writeSaveEnabled(on) {
  try {
    window.localStorage.setItem(SAVE_RECORDINGS_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Quota exceeded / private browsing: the choice still applies for the
    // rest of this tab via the listener notification below, it just won't
    // persist across a reload.
  }
  saveEnabledListeners.forEach((cb) => cb());
}

// Practice mode's capture layer: camera + mic, transcribed as "you", plus a
// posting picker, a generated interview question to practice against, (C3)
// recording + measuring the spoken answer itself, and (C4) judging what was
// actually said plus the repeat loop. The answer-recording flow (recorder,
// sampler, drain, generation guard, replay URL lifecycle, metrics/critique
// state) lives in usePracticeAnswer (AC-C4-8) — this component owns the
// capture session, the posting picker, the question, and the layout.
export default function PracticeClient({ sttProviderName } = {}) {
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
  const [currentQuestion, setCurrentQuestion] = useState(null); // { question, type }
  const [asked, setAsked] = useState([]);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [exhausted, setExhausted] = useState(false);

  // G2: which interview format drives question generation, the sample
  // answer, and the critique's rubric — a real external store (same shape
  // as SAVE_RECORDINGS_STORAGE_KEY above and engine.js's useEngine), not
  // component state, so it persists across visits the same way the save
  // toggle and the engine choice already do.
  const { interviewType, setInterviewType } = useInterviewType();

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

  // D1: "Save recordings to my account" — defaults ON. This value drives the
  // switch's checked state and the privacy notice below, both of which
  // should reflect whatever is true RIGHT NOW. The actual upload decision is
  // separate: `readSaveEnabled` (the plain function, not this hook value) is
  // handed to onDoneAnswer/usePracticeAnswer and re-read again immediately
  // before any upload happens, seconds later — see BUG-2 in usePracticeAnswer's
  // persistAnswer. That live re-read, not this render-time snapshot, is what
  // makes toggling mid-critique actually take effect.
  const saveEnabled = useSyncExternalStore(
    subscribeSaveEnabled,
    readSaveEnabled,
    getServerSaveEnabledSnapshot,
  );

  const onToggleSaveEnabled = useCallback((e) => {
    writeSaveEnabled(e.target.checked);
  }, []);

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

  const sessionRef = useRef(null);
  const idRef = useRef(0);
  const postingRef = useRef(null);
  const askedRef = useRef([]);
  const currentQuestionRef = useRef(null);
  // G2: mirrors `interviewType` for requestQuestion below, the same reason
  // postingRef/askedRef/currentQuestionRef exist — requestQuestion is a
  // stable useCallback whose async body must see the LATEST selection, not
  // whatever was current when the callback identity was created.
  const interviewTypeRef = useRef(interviewType);
  // Monotonic generation token: bumped whenever an in-flight question
  // request should be discarded (posting change, Stop, or a fresh Start).
  // requestQuestion captures the generation before its await and refuses to
  // write state if a newer generation has since started — otherwise a slow
  // response for the OLD posting/session can land after the user has already
  // moved on and repaint stale data over their new selection.
  const reqGenRef = useRef(0);

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

  // "Next question" pushes the current question onto the asked list (so the
  // route dedupes against it) and requests the next one. Skips the push when
  // that question is already in the list — a prior failed request leaves
  // `currentQuestion` in place, and pressing Next again must not record it
  // twice. The question changing invalidates whatever answer (in progress,
  // settling, or already reviewed) belonged to the previous one.
  const onNextQuestion = useCallback(() => {
    const prevQuestion = currentQuestionRef.current?.question;
    const alreadyAsked =
      !!prevQuestion &&
      askedRef.current.some((q) => normalizeQuestion(q) === normalizeQuestion(prevQuestion));
    const next = prevQuestion && !alreadyAsked ? [...askedRef.current, prevQuestion] : askedRef.current;
    setAsked(next);
    abandonInProgressAnswer();
    resetAnswerState();
    requestQuestion(next);
  }, [requestQuestion, resetAnswerState, abandonInProgressAnswer]);

  const onRetryQuestion = useCallback(() => {
    abandonInProgressAnswer();
    resetAnswerState();
    requestQuestion(askedRef.current);
  }, [requestQuestion, abandonInProgressAnswer, resetAnswerState]);

  // The picker can be changed at any time, including while live. Changing
  // the posting clears the asked-question list and the current question —
  // the asked list is per-posting, not per-session. Bumping the generation
  // token here discards any question request already in flight for the
  // posting being left behind.
  const onPostingChange = useCallback(
    (newPosting) => {
      reqGenRef.current += 1;
      setPosting(newPosting);
      setAsked([]);
      setCurrentQuestion(null);
      setExhausted(false);
      setQuestionError("");
      // A request left in flight for the old posting is now gen-gated and will
      // never get to clear this itself — clear it here so the card doesn't
      // sit on a spinner for a request that's been discarded.
      setQuestionLoading(false);
      // The question just changed out from under whatever answer (in
      // progress, settling, or already reviewed) was on screen — it
      // belongs to a question that's gone now.
      abandonInProgressAnswer();
      resetAnswerState();
    },
    [abandonInProgressAnswer, resetAnswerState],
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
      reqGenRef.current += 1;
      setAsked([]);
      setCurrentQuestion(null);
      setExhausted(false);
      setQuestionError("");
      setQuestionLoading(false);
      abandonInProgressAnswer();
      resetAnswerState();
    },
    [setInterviewType, abandonInProgressAnswer, resetAnswerState],
  );

  const stop = useCallback(async () => {
    // Invalidate any question request in flight — its response belongs to a
    // session that is being torn down — and stop the card from sitting on a
    // spinner for a request that will never get to write its result.
    reqGenRef.current += 1;
    setQuestionLoading(false);
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
  }, [abandonInProgressAnswer, resetAnswerState]);

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
    reqGenRef.current += 1;
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
    setAsked([]);
    setCurrentQuestion(null);
    setExhausted(false);
    setQuestionError("");
    // A fresh start also leaves no answer, recorder, or sampler behind from
    // whatever the previous session was doing, and resets the audio-time
    // clock to 0 — it's relative to THIS session's Deepgram socket.
    resetForSession();
    setStatus("connecting");
    // Fire-and-forget: requestQuestion catches its own errors into
    // questionError, so a slow or failed question request never blocks or
    // fails the capture session starting up.
    requestQuestion([]);
    try {
      const session = new PracticeSession({
        withVideo: true,
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
  }, [stop, requestQuestion, abandonInProgressAnswer, resetAnswerState, resetForSession, recordTranscriptEvent]);

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
  }, [status, startAnswerFlow, micMuted]);

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
  }, [doneAnswerFlow, profile, sendFrames, isEmbedded, interviewType]);

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
  //
  // D1 made the old blanket "your video stays in your browser and is never
  // uploaded" claim false: the save switch below controls a SEPARATE
  // destination (this user's own private Supabase storage) for the full
  // recorded clip, independent of both the engine and the frames opt-in —
  // saving happens (or doesn't) the same way on every engine. `videoNotice`
  // and `engineNotice` are deliberately built from independent state and
  // never reference each other's wording, so neither switch's sentence can
  // be read as implying anything about the other (AC-D1-4).
  const framesWillUpload = sendFrames && !isEmbedded;
  // G1: each branch also names the sample-answer draft's destination — the
  // same "is this request grounded by an AI provider" fact the critique
  // sentence above it already states, so this never drifts from it
  // (AC-G1-9).
  const engineNotice = isEmbedded
    ? "The critique runs on this server with no AI provider — your answer, the posting, and your prep context are never sent to Google. Sample answers are drafted on this server too."
    : framesWillUpload
      ? "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback, along with up to three still frames from each answer. Revealing a sample answer sends that question, your prep context, and the resume and cover letter you submitted for the selected posting to Gemini as well."
      : "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. Revealing a sample answer sends that question, your prep context, and the resume and cover letter you submitted for the selected posting to Gemini as well.";
  const videoNotice = saveEnabled
    ? "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it."
    : "Your video clip stays in your browser and is dropped when the session ends.";
  // F2: `sttProviderName` is passed down from CopilotClient, which learns
  // it from the /api/copilot/token response (see CopilotClient.js) rather
  // than this component fetching its own — the provider is a single
  // server-side choice (STT_PROVIDER) shared by live and practice mode
  // alike, so one fetch per page is enough for both notices to agree. It is
  // `undefined`/`null` until that fetch resolves, in which case this notice
  // names no provider at all rather than guessing one (AC-F2-5).
  const sttNotice = sttProviderName
    ? `Your audio is streamed to ${sttProviderName} for transcription.`
    : "Your audio is streamed for transcription.";
  const privacyNotice = `${sttNotice} ${engineNotice} ${videoNotice}`;
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
        {isEmbedded ? (
          <Typography variant="caption" sx={{ color: "var(--text-muted)" }}>
            The embedded engine never sends your answer, posting, or frames to an AI provider. This is
            separate from saving recordings below.
          </Typography>
        ) : null}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
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
          sampleAnswerText={sampleAnswer.answer}
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
            framesSent={framesWillUpload}
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
