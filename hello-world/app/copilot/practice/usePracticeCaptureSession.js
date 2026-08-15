"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PracticeSession } from "@/lib/copilot/practiceSession";

// Practice mode's OWN capture-session pipeline: the camera/mic session
// lifecycle (start/stop, the PracticeSession construction and its
// onStatus/onError/onTranscript/onStream handlers), the on-screen transcript
// (finals/interim), the elapsed-time clock, and the camera/mic toggles —
// extracted out of PracticeClient.js purely to keep that component under
// this repo's line-count gate, the same reason usePracticeQuestions.js and
// usePracticeAnswer.js already exist as their own modules. This is the
// practice-mode counterpart of app/copilot/useLiveSession.js: a self-
// contained transport/capture concern, not the question flow (that stays in
// usePracticeQuestions) and not the answer-recording/critique flow (that
// stays in usePracticeAnswer) — this hook knows nothing about either.
//
// `status`/`setStatus` are passed in rather than owned here, for the exact
// ordering reason useLiveSession's own header documents for CopilotClient:
// useCopilotDashboard's `active: running` argument needs `running` (derived
// from `status`) BEFORE this hook can be called (this hook's `start` needs
// useCopilotDashboard's own `resetDashboardForSession`/`recordSpeechSample`
// in return), so PracticeClient keeps the raw useState call for `status` and
// hands it down as controlled state, recomputing `running`/`controlsEnabled`
// itself for useCopilotDashboard's sake while this hook recomputes the same
// `running` value internally, purely for its own clock effect.
export function usePracticeCaptureSession({
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
  // Final wave (AC-M2): the room-question detector — forwarded straight
  // into the PracticeSession constructor below, alongside onTranscript/
  // onStatus/onError/onStream, rather than attached onto the session object
  // after the fact (see PracticeClient.js's own comment on why that used to
  // be a separate effect). Read directly out of this closure exactly like
  // recordTranscriptEvent/recordSpeechSample/markMicMuted are: `start`
  // itself is what has to see the CURRENT value, and it does, the same way
  // it already does for those, by being a useCallback that lists
  // `onUtterance` as one of its own dependencies (below) — a fresh `start`
  // is created whenever the caller passes a new one, so the closure the
  // constructor call sits inside is never stale.
  onUtterance,
}) {
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

  const sessionRef = useRef(null);
  const idRef = useRef(0);
  // AC-Q7.9: a per-session identity, bumped synchronously as the very FIRST
  // thing `start()` does — strictly before the `await sessionRef.current.
  // stop()` a restart-without-stop press has to sit through (see that
  // block's own comment: idempotent restart is a supported path, not an
  // edge case). A stray final that the OLD session's socket still delivers
  // during that await window is stamped with the OLD id by the closure
  // below (captured at ITS OWN start() call, before this ref's next bump),
  // so usePracticeSessionLog.js can tell "belongs to the session the log
  // has already moved on from" apart from "belongs to the session just
  // started" by comparing stamped identity, never by an array index/counter
  // — the shape of bug this AC exists to rule out, since an index is only
  // ever correct if paired resets land in the same render, which this exact
  // await window is proof they need not. A ref, not state, because
  // `mySessionId` below has to be the synchronously-incremented, guaranteed-
  // unique value available BEFORE any state update this same start() call
  // makes could possibly commit — `activeSessionId` (state, below) is the
  // read-during-render-safe twin exposed for the rest of this hook's return
  // value, mirrored from this ref rather than read directly (React forbids
  // reading a ref's `.current` while rendering).
  const sessionIdRef = useRef(0);
  const [activeSessionId, setActiveSessionId] = useState(0);

  const running = status === "live" || status === "connecting";

  useEffect(() => {
    if (!running || !startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, startedAt]);

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
  }, [invalidateAndClearLoading, abandonInProgressAnswer, resetAnswerState, setStatus]);

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
    // AC-Q7.9: mint THIS press's session identity before anything else —
    // including invalidateInFlight() and the old session's own teardown
    // below — so it is already the CURRENT id for the rest of this
    // function's life, and so a frame the OLD session's onTranscript
    // closure (captured on ITS OWN earlier call to start(), holding the
    // PREVIOUS value) delivers after this point is provably stamped with a
    // value that no longer matches.
    const mySessionId = (sessionIdRef.current += 1);
    setActiveSessionId(mySessionId);
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
        onTranscript: ({ transcript, isFinal, start: audioStart, duration: audioDuration, textAlreadyDelivered }) => {
          recordTranscriptEvent({ isFinal, transcript, start: audioStart, duration: audioDuration, textAlreadyDelivered });

          if (!isFinal) {
            setInterim(transcript);
            return;
          }
          setInterim("");
          // R-127: textAlreadyDelivered re-delivers the text of the final
          // that already fed the two accumulators below for this same span
          // (see lib/copilot/stt/index.js's onTranscript contract) — skip
          // both, or the pace sampler and the on-screen transcript both
          // double-count this utterance.
          if (textAlreadyDelivered) return;
          // AC-J2.9: feed the dashboard's pace sampler from FINAL frames
          // only — appendSpeechSample (via recordSpeechSample) already
          // drops frames whose start/duration aren't usable numbers, so
          // this passes them through as-is rather than pre-filtering here,
          // and never substitutes a wall-clock value for a missing one
          // (same discipline CopilotClient's own onTranscript handler
          // follows for live mode).
          recordSpeechSample({ text: transcript, start: audioStart, duration: audioDuration });
          // AC-Q7.9: `mySessionId` is THIS closure's own captured value —
          // fixed at the moment THIS session's start() minted it, never
          // read fresh off the ref — so a frame this exact session delivers
          // is stamped with the id it was actually produced under, whatever
          // sessionIdRef has since moved on to.
          setFinals((prev) => [
            ...prev,
            { id: (idRef.current += 1), speaker: "you", text: transcript, at: Date.now(), sessionId: mySessionId },
          ]);
        },
        // Published as soon as capture succeeds, well before the Deepgram
        // socket connects, so the self-view never lies about the camera
        // being off during the "connecting" phase.
        onStream: (s, hasV) => {
          setStream(s);
          setHasVideo(hasV);
        },
        onUtterance,
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
    setStatus,
    onUtterance,
  ]);

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

  return {
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
  };
}
