"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { useEngine } from "@/app/settings/engine";
import TranscriptView from "../TranscriptView";
import StatusPill from "../StatusPill";
import CameraPreview from "./CameraPreview";
import PostingPicker from "./PostingPicker";
import QuestionCard from "./QuestionCard";
import AnswerReview from "./AnswerReview";
import AnswerFeedback from "./AnswerFeedback";
import { usePracticeAnswer } from "./usePracticeAnswer";
import { usePrepContext } from "../usePrepContext";
import PrepContext from "../PrepContext";

// Practice mode's capture layer: camera + mic, transcribed as "you", plus a
// posting picker, a generated interview question to practice against, (C3)
// recording + measuring the spoken answer itself, and (C4) judging what was
// actually said plus the repeat loop. The answer-recording flow (recorder,
// sampler, drain, generation guard, replay URL lifecycle, metrics/critique
// state) lives in usePracticeAnswer (AC-C4-8) — this component owns the
// capture session, the posting picker, the question, and the layout.
export default function PracticeClient() {
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
  } = usePracticeAnswer();

  const sessionRef = useRef(null);
  const idRef = useRef(0);
  const postingRef = useRef(null);
  const askedRef = useRef([]);
  const currentQuestionRef = useRef(null);
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
      profile,
      includeFrames: sendFrames && !isEmbedded,
    });
  }, [doneAnswerFlow, profile, sendFrames, isEmbedded]);

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
  // actually receives data on the CURRENT engine — not just frames. On the
  // Gemini engine, every critique request sends the answer transcript, the
  // posting details, and the prep-context profile to Google, regardless of
  // the frames switch; that switch only ever controls frames (AC-C4-5). The
  // recorded replay clip is never uploaded under any setting — nothing in
  // this component's data flow ever sends replayUrl/the recorder's blob
  // anywhere (BUG-2).
  const framesWillUpload = sendFrames && !isEmbedded;
  const privacyNotice = isEmbedded
    ? "Your audio is streamed to Deepgram for transcription. The critique runs on this server with no AI provider — your answer, the posting, and your prep context are never sent to Google. Your video stays in your browser and is never uploaded."
    : framesWillUpload
      ? "Your audio is streamed to Deepgram for transcription. Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback, along with up to three still frames from each answer. The rest of your video stays in your browser and is never uploaded."
      : "Your audio is streamed to Deepgram for transcription. Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. Your video stays in your browser and is never uploaded.";

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
            The embedded engine never uploads anything.
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
          <AnswerFeedback
            status={critiqueStatus}
            feedback={critique}
            error={critiqueError}
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
    </Box>
  );
}
