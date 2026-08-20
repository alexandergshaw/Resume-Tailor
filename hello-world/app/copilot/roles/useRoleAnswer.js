"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEngine } from "@/app/settings/engine";
import {
  canStartRoleAnswer,
  recordingStatusMessage,
  roleAnswerContext,
  roleAutoStartDecision,
  roleRecordingPrivacyNotice,
} from "@/lib/copilot/roleDrillAnswer";
import { usePracticeAnswer } from "../practice/usePracticeAnswer";
import { usePracticeCaptureSession } from "../practice/usePracticeCaptureSession";
import { readSaveEnabled, useSaveRecordings } from "../practice/useSaveRecordings";

// AC-R1: recording + feedback for the "Speak as" mode, composed entirely out
// of practice mode's own answer-recording machinery — usePracticeAnswer (the
// recorder, sampler, drain, generation guard, critique and save flow) and
// usePracticeCaptureSession (the camera/mic session lifecycle) — plus the
// mode-specific decisions in lib/copilot/roleDrillAnswer.js. This hook writes
// no recorder, sampler, critique, or save logic of its own (WAVE2-BRIEF.md's
// reuse survey). What genuinely differs from practice mode is the one-press
// arm/auto-start loop (roleAutoStartDecision, the roleDrillAnswer.js
// counterpart of practiceFlow.js's own autoStartDecision — re-derived rather
// than imported because that function's props are all practice-only:
// `question`/`armedFrom` diffed via normalizeQuestion, meaningless to a mode
// with one situation on screen rather than a question feed) and the mode's
// own context-building (roleAnswerContext), which pins posting/profile/
// applicationId to their "absent" values instead of threading a
// caller-supplied version through.
//
// `status`/`setStatus` are owned here, not inside usePracticeCaptureSession,
// for the exact reason PracticeClient.js keeps its own copy: the capture
// hook needs them as controlled state before it can be called at all.
export function useRoleAnswer({
  situation,
  roleLabel,
  micDeviceId,
  sttProviderName,
  // Wave 3, BLOCKER 1/2: threaded straight through from useRoleDrill's own
  // return value — RoleDrillClient must not invent a second, competing
  // source for "is a situation on its way", since useRoleDrill already
  // computes both halves of it (see situationPending below).
  situationLoading,
  situationStatus,
}) {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error

  const { engine } = useEngine();
  const isEmbedded = engine === "embedded";

  // AC-R1.6: default ON, same as practice mode's own switch — see
  // useSaveRecordings.js for why the actual upload decision below re-reads
  // storage via `readSaveEnabled` instead of trusting this snapshot.
  const { saveEnabled, setSaveEnabled } = useSaveRecordings();
  const onToggleSaveEnabled = useCallback((e) => setSaveEnabled(e.target.checked), [setSaveEnabled]);

  // AC-R1.5: default OFF, same as practice mode's own switch — only takes
  // effect when the engine isn't embedded.
  const [sendFrames, setSendFrames] = useState(false);
  const onSendFramesChange = useCallback((e) => setSendFrames(e.target.checked), []);

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
    // Kept RAW here — this is the unconditional reset every other path in
    // this hook needs (Try again, a role change, a fresh situation). Only
    // usePracticeCaptureSession's own stop()/unsolicited-teardown paths get
    // the gated wrapper built below (Wave 3, BLOCKER 3) — see
    // resetAnswerStateOnStop's own comment for why those two must not share
    // this one.
    resetAnswerState,
    resetForSession,
    recordTranscriptEvent,
    markMicMuted,
    critiqueStatus,
    critique,
    critiqueError,
    critiqueFramesSent,
    retryCritique,
    saveStatus,
    saveError,
  } = usePracticeAnswer();

  // Wave 3, BLOCKER 3: "Stop" sits in the SAME row as Start speaking/Done in
  // this mode, and R-236 step 7 tells the user to press it right after
  // reading their score. usePracticeCaptureSession's stop() (and its own
  // onStatus("idle") branch, for an unsolicited teardown) both call
  // whatever `resetAnswerState` this hook hands them — unconditionally,
  // before this fix — which wiped a COMPLETED review the user was still
  // reading, no warning, no undo. The fix is a wrapper that only clears when
  // there is something in flight TO clear.
  //
  // Read from a REF, not render state: this wrapper is handed to
  // usePracticeCaptureSession's `stop`, a useCallback whose identity must
  // not churn on every render (`start`'s own useCallback lists `stop` as a
  // dependency — see that hook's header comment on why a fresh function
  // identity per render is the exact bug NOOP/module-scope constants exist
  // to prevent elsewhere in that file). Mirrored from render state into the
  // ref by the effect below rather than read directly, so the wrapper's own
  // identity can stay stable across every render.
  //
  // The critique-loading clause is not optional: abandonInProgressAnswer
  // bumps the generation, so a critique that is still "loading" when Stop
  // lands would otherwise never get cleared — its eventual response is
  // gen-gated and writes nothing, stranding AnswerFeedback on its spinner
  // forever (this is BUG-15 in usePracticeAnswer's own history, reproduced
  // here for a new caller).
  const clearableRef = useRef(false);
  useEffect(() => {
    clearableRef.current = answering || settling || critiqueStatus === "loading";
  }, [answering, settling, critiqueStatus]);
  const resetAnswerStateOnStop = useCallback(() => {
    if (clearableRef.current) resetAnswerState();
  }, [resetAnswerState]);

  const {
    error,
    warning,
    setWarning,
    finals,
    interim,
    startedAt,
    elapsed,
    cameraOff,
    micMuted,
    stream,
    hasVideo,
    start,
    stop: rawStop,
    onToggleCamera,
    onToggleMic,
    sessionRef,
  } = usePracticeCaptureSession({
    status,
    setStatus,
    micDeviceId,
    withVideo: true,
    recordTranscriptEvent,
    markMicMuted,
    abandonInProgressAnswer,
    resetAnswerState: resetAnswerStateOnStop,
    resetForSession,
  });

  // ROUGH EDGE (adversarial review): a dropped socket or an ended track can
  // tear the capture session down on its own — usePracticeCaptureSession's
  // own onStatus("idle") branch — which abandons whatever answer was in
  // flight exactly like the explicit Stop button does, but silently: no
  // warning, no error, and the live region below goes back to "". This
  // effect tells the two apart by whether OUR OWN wrapped `stop` (below) was
  // the thing that asked for the teardown, and says something for the
  // unsolicited case, which was never a deliberate user action.
  const explicitStopRef = useRef(false);
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === "idle" && (prev === "live" || prev === "connecting")) {
      if (!explicitStopRef.current) {
        setWarning("Your session ended unexpectedly, and any answer in progress was not saved.");
      }
      explicitStopRef.current = false;
    }
  }, [status, setWarning]);

  const stop = useCallback(() => {
    explicitStopRef.current = true;
    return rawStop();
  }, [rawStop]);

  // Wave 3, BLOCKER 1: `situationPending` is what lets the auto-start
  // decision below tell "a situation is on screen" apart from "a situation
  // is on screen but about to be replaced" — useRoleDrill deliberately keeps
  // the PREVIOUS situation visible while a new one fetches, so `situation`
  // alone is not evidence the user has seen what they're about to be graded
  // against. `situationLoading` covers the "New situation" button's own
  // pending window; `situationStatus === "loading"` covers the FIRST fetch
  // on mount/role-change, which never touches `situationLoading` at all (see
  // useRoleDrill.js's own comment on why not). Computed here, once, rather
  // than by the caller, so there is exactly one place this OR lives.
  const situationPending = situationLoading || situationStatus === "loading";

  // AC-R1.2: starts recording over whatever stream the session currently
  // has — a no-op unless the session is actually live with a situation on
  // screen (the primary control is disabled for every other case, but this
  // guard means a stray call can never leave the recorder mid-state).
  //
  // Wave 3, BLOCKER 1 belt-and-braces: the situation actually being recorded
  // against is captured into a ref RIGHT HERE, at the moment the recorder
  // actually starts — never read live off `situation` again after this
  // point. roleAutoStartDecision (below) is what's supposed to make a stale
  // situation unreachable in the first place; this ref is what makes it
  // impossible even if that decision is ever wrong.
  const situationAtStartRef = useRef(null);
  const onStartAnswer = useCallback(() => {
    const liveStream = sessionRef.current?.stream;
    if (!liveStream || !canStartRoleAnswer({ status, situation, answering, settling })) return;
    situationAtStartRef.current = situation;
    startAnswerFlow(liveStream, micMuted);
  }, [status, situation, answering, settling, startAnswerFlow, micMuted, sessionRef]);

  // AC-R1.2 (Wave 3 rewrite): the one-press arm/auto-start loop, now
  // delegating every "should this fire yet" call to roleAutoStartDecision
  // rather than re-deriving it inline — see that function's own long
  // comment for what each of its three outcomes means and why. "wait" must
  // leave the press armed for a LATER run of this same callback (the next
  // status/situation/situationPending change); "start" and "drop" both
  // consume it. Disarming happens BEFORE starting, not after — a re-render
  // triggered mid-start (onStartAnswer's own setAnswering(true)) must never
  // read this press as still pending and fire the recorder a second time.
  const armedRef = useRef(false);

  const attemptAutoStart = useCallback(() => {
    const decision = roleAutoStartDecision({
      armed: armedRef.current,
      status,
      situation,
      situationPending,
      answering,
      settling,
    });
    if (decision === "wait") return;
    armedRef.current = false;
    if (decision === "start") onStartAnswer();
  }, [status, situation, situationPending, answering, settling, onStartAnswer]);

  useEffect(() => {
    attemptAutoStart();
  }, [attemptAutoStart]);

  // AC-R1.2: one press, cold mode to a running recorder. Already live and
  // not mid-answer: start the recorder immediately, nothing to wait for.
  // Safe to call unconditionally on this branch even while a situation is
  // pending — RoleDrillControls disables the button for that case (see
  // primaryDisabled below), so a stray call can only ever reach here already
  // gated.
  const onStartSpeaking = useCallback(() => {
    if (status === "live") {
      onStartAnswer();
      return;
    }
    if (status === "idle" || status === "error") {
      armedRef.current = true;
      start();
    }
  }, [status, onStartAnswer, start]);

  // AC-R1.4/AC-R1.5: roleAnswerContext pins posting/profile/applicationId to
  // their "absent" values — there is nothing of the sort to send in this
  // mode. `includeFrames` is computed fresh from this render's switch/engine
  // state, and `isSaveEnabled` is the plain `readSaveEnabled` function, never
  // this hook's own `saveEnabled` snapshot — the upload it gates happens
  // seconds later, after the critique settles (BUG-2 in usePracticeAnswer's
  // persistAnswer), and must re-read storage at that moment.
  //
  // Wave 3, BLOCKER 1 belt-and-braces: `situation` here is
  // `situationAtStartRef.current` — the scene that was actually on screen
  // when THIS recording started, never the live render value, which may
  // already have moved on to a newer situation by the time Done is pressed.
  const onDoneAnswer = useCallback(() => {
    doneAnswerFlow(
      roleAnswerContext({
        roleLabel,
        situation: situationAtStartRef.current,
        includeFrames: sendFrames && !isEmbedded,
        isSaveEnabled: readSaveEnabled,
      }),
    );
  }, [doneAnswerFlow, roleLabel, sendFrames, isEmbedded]);

  // Focus management (rough edge, adversarial review): "Done" is replaced
  // by a bare spinner, and "Try again" unmounts the whole review/feedback
  // panel — a keyboard user pressing the advertised one-press action loses
  // their place and has to tab from the top of the page. Bumped here (never
  // via `autoFocus`, which fights a screen reader's own navigation) so
  // RoleDrillControls can move focus to the primary control the instant it
  // re-renders as the thing to press next — see that component's own effect
  // watching this value.
  const [focusPrimarySignal, setFocusPrimarySignal] = useState(0);

  // AC-R1.7: re-answers the SAME situation. Clears whatever the previous
  // answer left on screen, then re-arms and attempts the start SYNCHRONOUSLY
  // — there is no fetch to wait on, exactly like
  // usePracticeAnswerActions.js's own onTryAgainAnswer. This button only
  // ever renders once `!answering && !settling`, so abandonInProgressAnswer/
  // resetAnswerState here are clearing stale review state, not racing a
  // still-open answer — `status` is already "live" from the session that
  // just finished the previous take, so attemptAutoStart finds
  // canStartRoleAnswer true immediately.
  const onTryAgain = useCallback(() => {
    armedRef.current = true;
    abandonInProgressAnswer();
    resetAnswerState();
    attemptAutoStart();
    setFocusPrimarySignal((n) => n + 1);
  }, [abandonInProgressAnswer, resetAnswerState, attemptAutoStart]);

  // AC-R1.5: read fresh at click time, never replayed from what was true
  // when the answer was recorded — usePracticeAnswerActions.js's own
  // onRetryCritique, re-derived for the same reason onStartAnswer above is.
  const onRetryCritique = useCallback(() => {
    retryCritique({ includeFrames: sendFrames && !isEmbedded });
  }, [retryCritique, sendFrames, isEmbedded]);

  // AC-R1.8: the ONE call RoleDrillClient makes for a role change — the
  // other abandonment path that lives entirely outside the capture
  // session's own state machine. Stop, leaving the mode, and (below) a
  // fresh situation already do their own half — see resetAnswerStateOnStop
  // above for Stop, usePracticeAnswer's own unmount effect for leaving the
  // mode, and onNewSituationRequested below for a fresh situation. Never
  // arms auto-start: switching roles has no business starting a recording
  // by itself.
  const onAbandon = useCallback(() => {
    abandonInProgressAnswer();
    resetAnswerState();
  }, [abandonInProgressAnswer, resetAnswerState]);

  // Wave 3, BLOCKER 1/2: "New situation" — both the situation card's own
  // button and the feedback panel's — arms auto-start, which is what turns
  // the fresh-situation loop into one press instead of two, and what makes
  // BLOCKER 1's window safe rather than merely narrower: with the primary
  // control disabled while a situation is pending (see primaryDisabled
  // below), the only way into a recording during that window is THIS armed
  // press, which roleAutoStartDecision holds at "wait" until the new scene
  // is actually the one on screen.
  const onNewSituationRequested = useCallback(() => {
    abandonInProgressAnswer();
    resetAnswerState();
    armedRef.current = true;
  }, [abandonInProgressAnswer, resetAnswerState]);

  // ROUGH EDGE: `framesWillUpload` used to have no notion of whether a
  // camera even exists, so with the camera denied and the mic granted the
  // notice still promised "up to three still frames from each answer" for
  // frames that could never be captured. Suppressed only when we KNOW
  // there's no camera — a LIVE session that reports `hasVideo: false` —
  // never before a session exists, where it's simply unknown (and where
  // suppressing it would be its own kind of wrong: a camera may well be
  // granted the moment "Start speaking" is pressed).
  const cameraKnownAbsent = status === "live" && !hasVideo;
  const framesWillUpload = sendFrames && !isEmbedded && !cameraKnownAbsent;
  const privacyNotice = roleRecordingPrivacyNotice({
    sttProviderName,
    isEmbedded,
    framesWillUpload,
    saveEnabled,
  });

  const running = status === "live" || status === "connecting";

  // AC-R1.1/BLOCKER 2: the primary control's own disabled reasons, computed
  // once here rather than re-derived inside RoleDrillControls — it used to
  // render enabled with nothing to answer (only `status === "connecting"`
  // disabled it), which acquired the camera and mic for a press that
  // `canStartRoleAnswer` then silently rejected. Disabled while connecting,
  // with no situation at all, or while one is pending — the same three
  // conditions roleAutoStartDecision itself treats as "not startable yet".
  const primaryDisabled = status === "connecting" || !situation || situationPending;

  const hasAnswer = !answering && !settling && !!answerMetrics;

  return {
    status,
    running,
    error,
    warning,
    setWarning,
    finals,
    interim,
    startedAt,
    elapsed,
    cameraOff,
    micMuted,
    stream,
    hasVideo,
    stop,
    onToggleCamera,
    onToggleMic,
    sendFrames,
    onSendFramesChange,
    isEmbedded,
    saveEnabled,
    onToggleSaveEnabled,
    privacyNotice,
    primaryDisabled,
    focusPrimarySignal,
    recordingStatusText: recordingStatusMessage({ answering, settling, hasAnswer }),
    answering,
    settling,
    answerTranscript,
    answerMetrics,
    replayUrl,
    replaySupported,
    critiqueStatus,
    critique,
    critiqueError,
    critiqueFramesSent,
    saveStatus,
    saveError,
    onStartSpeaking,
    onDoneAnswer,
    onTryAgain,
    onRetryCritique,
    onAbandon,
    onNewSituationRequested,
  };
}
