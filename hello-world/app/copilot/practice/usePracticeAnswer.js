"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerRecorder } from "@/lib/copilot/answerRecorder";
import { VideoFrameSampler } from "@/lib/copilot/videoStats";
import { BodyLanguageSampler } from "@/lib/copilot/bodyLandmarks";
import { computeAnswerMetrics } from "@/lib/copilot/answerMetrics";
import { acceptedAnswerFinal } from "@/lib/copilot/answerWindow";
import { answerMetricsInputs } from "@/lib/copilot/answerSpeakers";
import { critiqueAnswer } from "@/lib/copilot/critiqueClient";
import { framesWereSent } from "@/lib/copilot/answerProvenance";
import { savePracticeAnswer, updatePracticeAnswerCritique } from "@/lib/supabase/practiceAnswers";

// After "Done" is pressed, how long the transcript keeps draining before
// closing for good. Deepgram's endpointing (300ms) plus normal network
// latency means the final for whatever was said right up to "Done" can
// arrive 0.3-1.5s late — this window gives it room to land while still
// being short enough that a lost socket can never hang the review.
const DRAIN_MS = 1800;

// Practice mode's answer flow, extracted out of PracticeClient (AC-C4-8):
// the recorder, the sampler, the drain, the generation guard, the
// object-URL lifecycle, and the metrics/critique state for one recorded
// answer at a time. PracticeClient keeps the session, the picker, and the
// question — this hook owns everything about turning a recorded answer
// into the C3 review card's data plus the C4 judgement built on top of it.
// Every fix from the C3 review still holds: the post-Done drain that
// catches the last sentence, the audio-time lower/upper bound on which
// finals belong to an answer, the generation guard against a stale drain/
// abandon/critique race, camera-off honesty (deferred to
// computeAnswerMetrics/summarizeVideoStats, untouched here), and the rule
// that only one replay object URL exists at a time.
export function usePracticeAnswer() {
  const [answering, setAnswering] = useState(false);
  // True from "Done" until the trailing-transcript drain finishes — the
  // recorder/sampler are already stopped by then, only the transcript is
  // still settling. See doneAnswer.
  const [settling, setSettling] = useState(false);
  const [answerTranscript, setAnswerTranscript] = useState([]); // string[] finalized during the last completed answer
  const [answerMetrics, setAnswerMetrics] = useState(null);
  // AC-M2: the other half of partitionAnswerFinals's split for the last
  // completed answer — every accepted final that was NOT attributed to the
  // candidate (raw `{ text, start, duration, speakerTag }` entries, same
  // shape as answerFinalsRef, not just text). Practice mode does nothing
  // with these itself; this is purely a handoff so a later wave can scan
  // them for a mock interviewer's questions without re-deriving the split.
  // Always empty for a non-diarized session, since partitionAnswerFinals
  // puts every untagged final in `mine`.
  const [otherSpeakerFinals, setOtherSpeakerFinals] = useState([]);
  // Final wave (room-question detection): the speaker tag that dominated
  // the MOST RECENTLY COMPLETED answer — answerMetricsInputs' own `myTag`
  // (answerSpeakers.js), which partitionAnswerFinals already computes
  // internally to build `mine`/`others`. `null` until the first answer with
  // at least one tagged final has completed; a solo/non-diarized session
  // never learns a value here and stays `null` for the whole session, which
  // is exactly what roomQuestions.js's shouldTreatAsRoomQuestion treats as
  // "not yet learned" rather than "no one else is ever in the room".
  //
  // Deliberately state, not a ref: this rides straight into
  // useRoomQuestions (PracticeClient.js) as a plain prop, the same way
  // `answering`/`settling` already do, and that hook mirrors it into its
  // OWN ref internally (the same postingRef/profileRef pattern every other
  // async pipeline in this codebase already uses) — this hook has no async
  // continuation of its own that needs a stable ref-read of this value.
  //
  // Persists across "Next question"/"Try again" on purpose (see doneAnswer
  // below, which only ever WRITES a non-null result, never clears this) —
  // once the candidate's voice is known, it stays known for the rest of the
  // session; only resetForSession (a fresh capture session, a fresh
  // diarization) clears it back to `null`.
  const [myTag, setMyTag] = useState(null);
  // Whether AnswerRecorder actually supports recording in this browser, as
  // of the last completed answer — distinguishes "this browser can't
  // record" from "recording just produced nothing this time" (BUG-10).
  const [replaySupported, setReplaySupported] = useState(true);

  // C4's judgement of what was actually SAID, layered on top of the C3
  // metrics above. "idle" before any answer has ever been analyzed, then
  // tracks the most recent critique request for the answer currently under
  // review.
  const [critiqueStatus, setCritiqueStatus] = useState("idle"); // idle | loading | done | error
  const [critique, setCritique] = useState(null); // the AC-C4-1 shape, once done
  const [critiqueError, setCritiqueError] = useState("");
  // K1: whether the LAST completed critique request actually carried at
  // least one frame — recorded from the `frames` array runCritique actually
  // sent, via framesWereSent(frames), never from the `includeFrames` flag
  // that selected it (an opt-in with no usable camera sends `frames: []`).
  // This is what AnswerFeedback's retrospective caption must read instead of
  // PracticeClient's live `framesWillUpload`: that switch sits on the same
  // screen as the feedback panel, so re-deriving the caption from its
  // current value would silently rewrite what the panel claims about a
  // request that already happened, every time the switch is toggled.
  const [critiqueFramesSent, setCritiqueFramesSent] = useState(false);
  // D1: persisting the completed answer (transcript + metrics + critique,
  // plus the clip when one exists) to the user's account. "idle" until a
  // save is actually attempted — the save switch being off (PracticeClient)
  // means this never leaves "idle" for that answer, which is itself honest:
  // nothing was attempted, so there's nothing to report. saveError doubles
  // as the reason on "failed" and as a non-fatal note on "saved" (e.g. the
  // clip was over the size cap and only the rest of the answer was kept) —
  // see persistAnswer.
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | failed
  const [saveError, setSaveError] = useState("");
  // Bumped after every successful save so PracticeHistory (mounted by
  // PracticeClient) knows to reload — it has no other way to learn that a
  // new row exists in the CURRENT session.
  const [savedAnswerVersion, setSavedAnswerVersion] = useState(0);
  // Per-question scores for this session, keyed by the exact question text
  // — a Map rather than a running count/sum, so re-answering the SAME
  // question (via "Try again") REPLACES its entry instead of adding a
  // second one; without this, the running total inflated for what a user
  // would consider one question answered twice (BUG-16). Survives Next
  // question/Try again (only resetAnswerState runs then); only
  // resetForSession clears it, since it's scoped to the whole practice
  // session, not to one answer.
  const [questionScores, setQuestionScores] = useState(() => new Map());

  // Mirrors `answering` for recordTranscriptEvent below, which is called
  // from the session's onTranscript callback — that callback closes over
  // whatever was current when the session started, so it needs a ref (not
  // state) to see live values.
  const answeringRef = useRef(false);
  // Mirrors `settling` the same way.
  const settlingRef = useRef(false);
  // True from "Start answering" through the end of the post-"Done" drain —
  // broader than answeringRef, which flips off the moment Done is pressed.
  // Gates whether recordTranscriptEvent's final-handling logic considers a
  // final for the answer at all.
  const collectingRef = useRef(false);
  // Finals accepted into the answer currently being collected — never the
  // full session transcript. Each entry is
  // `{ text, start, duration, speakerTag }` (start/duration in audio-time
  // seconds, possibly non-numbers; speakerTag possibly undefined — see
  // answerWindow.js). This is EVERY accepted final, candidate and anyone
  // else in the room alike — doneAnswer (AC-M2) is what splits it via
  // partitionAnswerFinals before any metric is computed, never this ref.
  // Cleared at the start of every new answer.
  const answerFinalsRef = useRef([]);
  const answerStartRef = useRef(0);
  // The freshest known position in the Deepgram audio stream (seconds since
  // this session's socket started receiving audio), updated from EVERY
  // transcript event — interim or final. Interims arrive with near-zero
  // latency, so this is a far better "what's the audio position right now"
  // estimate than a final (which lags 0.3-1.5s behind speech) or wall-clock
  // Date.now() (which has no defined relationship to Deepgram's own time
  // base at all). Reset to 0 at the start of every session.
  const audioClockRef = useRef(0);
  // The audio-time lower/upper bounds for the current answer, captured from
  // audioClockRef at "Start answering" and "Done" respectively. A final is
  // only ever included in the answer when its own audio-time `start` falls
  // in [answerStartAudioRef, answerDoneAudioRef) — see
  // recordTranscriptEvent. The upper bound stays null (unconstrained) until
  // Done is pressed.
  const answerStartAudioRef = useRef(0);
  const answerDoneAudioRef = useRef(null);
  // True if the mic was muted at any point between "Start answering" and
  // "Done" — real words can be lost entirely (muted = silence, so Deepgram
  // never even sees them) while the clock keeps running, and the review
  // must say so next to the numbers it affects (BUG-6).
  const answerMicMutedRef = useRef(false);
  // Retained JPEG snapshots from the last completed answer's
  // VideoFrameSampler — feature C4's visual analysis input. Cleared
  // alongside the rest of the answer.
  const answerFramesRef = useRef([]);
  // Lazily constructed on the first "Start answering" and reused across
  // every answer in a session — both classes support stop() then start()
  // again cleanly, so there's no need to rebuild them per answer.
  const recorderRef = useRef(null);
  const samplerRef = useRef(null);
  // D2: the body-language sampler, started/stopped in lockstep with
  // samplerRef (VideoFrameSampler) everywhere below — see AC-D2-4. Its own
  // MediaPipe models are cached at module scope inside bodyLandmarks.js and
  // survive being rebuilt here, so recreating this instance per session
  // (resetForSession) is cheap; only the FIRST model load in the whole page
  // session is ever slow, and this never awaits it either way.
  const bodySamplerRef = useRef(null);
  // Mirrors `replayUrl` so it can be revoked synchronously (session stop,
  // unmount) without depending on React state having flushed.
  const replayUrlRef = useRef("");
  // The pending post-"Done" drain timer and its Promise's resolve function.
  // An abandoned answer (posting change, next question, Stop, unmount) both
  // cancels the timer AND resolves the promise immediately — clearing the
  // timeout alone would leave doneAnswer's `await Promise.all(...)` (see
  // below) permanently pending, which is exactly the unresolved-promise
  // hang BUG-11 forbids, not a fix for it.
  const drainTimerRef = useRef(null);
  const drainResolveRef = useRef(null);
  // Monotonic generation token for the answer flow. Captured at "Start
  // answering"; bumped on Done-drain-abandonment paths (posting change,
  // next question, try again, Stop, unmount) and at the top of every new
  // "Start answering". doneAnswer's post-await writes are gated on the
  // generation it captured still being current (BUG-11). Also reused to gate
  // the critique request runCritique kicks off at the end of doneAnswer —
  // abandoning the answer invalidates a critique in flight the same way it
  // invalidates a drain in flight.
  const answerGenRef = useRef(0);
  // The non-frame inputs the last critique request was built from
  // (question/type/answer/posting/profile/metrics), so "Retry" can re-run
  // the SAME analysis on the SAME answer without re-recording. Frames are
  // deliberately NOT cached here — see runCritique.
  const lastCritiqueInputsRef = useRef(null);
  // D1/BUG-6: `{ gen, id }` of the row already saved for the CURRENT answer,
  // once the initial save has landed — lets a later successful Retry UPDATE
  // that row's critique instead of inserting a duplicate (savePracticeAnswer
  // only ever inserts). Keyed by generation, not just a bare id: a stale
  // save/update settling for an ANSWER THAT'S SINCE BEEN ABANDONED must never
  // be mistaken for belonging to whatever NEWER answer's id this ref might
  // hold by the time it resolves — see persistAnswer.
  const savedAnswerIdRef = useRef(null);

  // Exactly one replay object URL may exist at a time (AC-C3-6) — revoke
  // whatever the previous answer left behind before anything else adopts a
  // new one, or before a URL is abandoned for good (session stop, unmount).
  // A leaked blob URL pins that whole video clip in memory.
  const revokeReplay = useCallback(() => {
    if (replayUrlRef.current) {
      URL.revokeObjectURL(replayUrlRef.current);
      replayUrlRef.current = "";
    }
    setReplayUrl("");
  }, []);

  // Clears everything the previous answer's review card was showing —
  // metrics AND the critique built on top of them. Called whenever the
  // question changes (Next question), the same question is re-answered
  // (Try again), the posting changes, and on Stop/unmount/session-restart.
  const resetAnswerState = useCallback(() => {
    revokeReplay();
    setAnswerTranscript([]);
    setAnswerMetrics(null);
    setOtherSpeakerFinals([]);
    answerFramesRef.current = [];
    setCritiqueStatus("idle");
    setCritique(null);
    setCritiqueError("");
    setCritiqueFramesSent(false);
    lastCritiqueInputsRef.current = null;
    setSaveStatus("idle");
    setSaveError("");
    savedAnswerIdRef.current = null;
  }, [revokeReplay]);

  // Abandons whatever answer is currently being recorded OR still settling
  // (draining trailing transcript after Done), discarding it entirely — no
  // metrics get computed for it, nothing about it is shown. Every path that
  // gives up on an in-progress answer must call this FIRST: posting change,
  // next question, try again, session stop, and unmount (BUG-4). Bumping
  // the generation also invalidates a drain that's already running, so its
  // eventual completion writes nothing (BUG-11).
  const abandonInProgressAnswer = useCallback(() => {
    answerGenRef.current += 1;
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    if (drainResolveRef.current) {
      // Unblocks doneAnswer's `await Promise.all(...)` right away instead
      // of leaving it pending on a timer that was just cancelled — it will
      // find the generation stale and write nothing, but it must actually
      // get to run that check rather than hang.
      drainResolveRef.current();
      drainResolveRef.current = null;
    }
    collectingRef.current = false;
    if (answeringRef.current) {
      answeringRef.current = false;
      setAnswering(false);
    }
    if (settlingRef.current) {
      settlingRef.current = false;
      setSettling(false);
    }
    // Safe no-ops if already stopped above (or never started) — all three
    // classes guarantee stop() is idempotent and safe before start(). Every
    // path that abandons an in-progress answer routes through here, so this
    // is also what makes AC-D2-4's "every abandonment path finalises both
    // samplers" hold: posting change, next question, try again, session
    // stop, and unmount all call this before anything else.
    samplerRef.current?.stop();
    bodySamplerRef.current?.stop();
    recorderRef.current?.stop();
  }, []);

  // Full reset at the start of a fresh capture session (PracticeClient's
  // start()): abandons anything left over from a previous session, zeroes
  // the audio clock (it's relative to THIS session's Deepgram socket), and
  // drops the recorder/sampler instances so they're rebuilt fresh — cheap,
  // and keeps nothing accidentally carrying across a Stop/Start boundary.
  // The running session total is scoped to one practice session, so it
  // resets here — and only here, never in resetAnswerState.
  const resetForSession = useCallback(() => {
    abandonInProgressAnswer();
    audioClockRef.current = 0;
    answerFinalsRef.current = [];
    answerStartAudioRef.current = 0;
    answerDoneAudioRef.current = null;
    answerMicMutedRef.current = false;
    recorderRef.current = null;
    samplerRef.current = null;
    bodySamplerRef.current = null;
    resetAnswerState();
    setQuestionScores(new Map());
    // A fresh capture session is a fresh diarization — whatever tag USED to
    // dominate the answer window under the PREVIOUS session's socket has no
    // bearing on this one (Deepgram/ElevenLabs assign tags per-connection,
    // not per-candidate), so this is the one place `myTag` resets. Every
    // OTHER reset in this hook (resetAnswerState, via "Next question"/"Try
    // again") deliberately leaves it alone — see myTag's own doc above.
    setMyTag(null);
  }, [abandonInProgressAnswer, resetAnswerState]);

  // Unmounting (e.g. switching back to live mode) must not leave an answer
  // recorder/sampler mid-flight, a pending drain timer, or a replay blob URL
  // pinning a video clip in memory. Revokes the URL directly (not via
  // resetAnswerState, which calls setState) so no state update is attempted
  // on an unmounted component.
  useEffect(() => {
    return () => {
      abandonInProgressAnswer();
      if (replayUrlRef.current) {
        URL.revokeObjectURL(replayUrlRef.current);
        replayUrlRef.current = "";
      }
    };
  }, [abandonInProgressAnswer]);

  // Called for EVERY transcript event on the session's STT socket — final
  // or interim — so the audio clock stays fresh regardless of whether an
  // answer is being recorded. The accept/reject decision for whether a
  // FINAL belongs in the answer (collecting? inside the window? a R-127
  // ElevenLabs re-delivery already accounted for?) is
  // acceptedAnswerFinal — extracted to lib/copilot/answerWindow.js so it's
  // unit-testable outside this hook; this function keeps only the audio
  // clock and the ref itself, which have no meaning outside React.
  //
  // `speakerTag` (AC-M2) rides straight through to acceptedAnswerFinal and
  // then into answerFinalsRef — this function does not examine it. Whose
  // words a final belongs to is decided once, over the WHOLE answer, by
  // partitionAnswerFinals in doneAnswer below; deciding it per-event here
  // would be deciding it from a single final, which is exactly what AC-M2
  // says cannot be judged in isolation. A caller that never supplies
  // `speakerTag` at all (every existing practice session, until diarization
  // is wired into this hook's caller) leaves it `undefined` here exactly as
  // before this field existed.
  const recordTranscriptEvent = useCallback(
    ({ isFinal, transcript, start, duration, speakerTag, textAlreadyDelivered }) => {
      if (typeof start === "number" && typeof duration === "number") {
        const end = start + duration;
        if (end > audioClockRef.current) audioClockRef.current = end;
      }

      const entry = acceptedAnswerFinal({
        isFinal,
        transcript,
        start,
        duration,
        speakerTag,
        textAlreadyDelivered,
        collecting: collectingRef.current,
        answerStart: answerStartAudioRef.current,
        answerEnd: answerDoneAudioRef.current,
      });
      if (!entry) return;

      answerFinalsRef.current = [...answerFinalsRef.current, entry];
    },
    [],
  );

  // Starts recording the current question's answer over the given live
  // stream: marks the start time (wall clock and audio-time), clears
  // whatever the previous answer left on screen, and starts the recorder +
  // sampler. A no-op with no stream, or while an answer is already being
  // recorded or settling — PracticeClient additionally gates the "Start
  // answering" button on session/question state this hook doesn't know
  // about, but the guard here means a stray call can never leave the
  // recorder/sampler in an inconsistent state either.
  const startAnswer = useCallback(
    (liveStream, initialMicMuted = false) => {
      if (!liveStream) return;
      if (answeringRef.current || settlingRef.current) return;

      // Invalidates a drain still settling from a previous answer, belt and
      // suspenders alongside the caller already gating on settling.
      abandonInProgressAnswer();
      resetAnswerState();
      answerFinalsRef.current = [];
      answerStartRef.current = Date.now();
      answerStartAudioRef.current = audioClockRef.current;
      answerDoneAudioRef.current = null;
      // Seed from the mic state at the moment recording actually starts,
      // not just false — the mic can already be muted when "Start
      // answering" is pressed, and if it's never toggled again during the
      // answer, the toggle-driven markMicMuted() below would never fire
      // even though the whole answer was recorded with a muted mic,
      // silently reporting `micMuted: false` for a wordless answer
      // (BUG-15).
      answerMicMutedRef.current = !!initialMicMuted;
      collectingRef.current = true;
      answeringRef.current = true;
      setAnswering(true);

      if (!recorderRef.current) recorderRef.current = new AnswerRecorder();
      if (!samplerRef.current) samplerRef.current = new VideoFrameSampler();
      if (!bodySamplerRef.current) bodySamplerRef.current = new BodyLanguageSampler();
      recorderRef.current.start(liveStream);
      samplerRef.current.start(liveStream);
      bodySamplerRef.current.start(liveStream);
    },
    [abandonInProgressAnswer, resetAnswerState],
  );

  // D1: syncs one completed answer to the user's account — called after
  // EVERY critique settle for that answer (the initial one from doneAnswer,
  // and any later Retry), and decides for itself whether that means
  // inserting a new row or updating an existing one:
  //
  // - No row saved yet for this generation (`save` present, built by
  //   doneAnswer with the recording/transcript/metrics) → INSERT, with
  //   whatever critique this settle produced (or `{}` if it failed — a
  //   failed analysis must not cost the user their recording, AC-D1-3).
  // - A row already exists for this generation (`savedAnswerIdRef`) →
  //   UPDATE just its critique — this is BUG-6's fix: without it, an answer
  //   whose first critique failed and was then successfully retried stayed
  //   stored with an empty critique forever, even though the user watched a
  //   real one come back. Only worth doing when this settle actually
  //   produced one; a retry that fails again has nothing new to persist.
  // - Neither (a bare Retry with no row and no `save` payload) → nothing to
  //   do; retryCritique doesn't carry a fresh recording to insert.
  //
  // BUG-2: `save.isSaveEnabled`, when present, is a LIVE reader (not a
  // snapshot taken at Done) — called here, immediately before the network
  // call, exactly like camera-frame consent is re-read at send time rather
  // than latched (C4's BUG-1). The critique this waits on can take seconds;
  // a user who turns "Save recordings" off in that window must get what
  // they asked for, not whatever was true when Done was pressed.
  //
  // Fire-and-forget from the caller's point of view: never awaited by
  // doneAnswer/runCritique, so a slow or failed save can never block the
  // feedback panel, "Next question", or tear down the capture session.
  // `gen` is the SAME generation the critique request was gated on. The
  // network call itself is NOT skipped when it goes stale — the write this
  // function makes has already reached the server by the time the
  // post-await check below runs, and that's deliberate: the user asked for
  // this recording to be saved, and abandoning the on-screen review (Next
  // question, Try again, Stop, unmount) must not silently cancel a save
  // already in flight. What the gen check actually gates is the LOCAL UI
  // state (saveStatus/saveError) below it — an abandoned answer's result
  // must not paint stale status onto whatever answer is on screen now. A
  // row that DID land for an abandoned generation still bumps
  // savedAnswerVersion, so PracticeHistory (if still mounted this session)
  // picks it up even though nothing else about that answer is shown anymore.
  const persistAnswer = useCallback(async (input) => {
    const { gen, save, critique } = input;
    const existingId =
      savedAnswerIdRef.current && savedAnswerIdRef.current.gen === gen ? savedAnswerIdRef.current.id : null;

    if (existingId) {
      if (!critique) return;
      setSaveStatus("saving");
      setSaveError("");
      const { error } = await updatePracticeAnswerCritique(existingId, critique);
      if (answerGenRef.current !== gen) {
        if (!error) setSavedAnswerVersion((v) => v + 1);
        return;
      }
      if (error) {
        setSaveStatus("failed");
        setSaveError(error);
        return;
      }
      setSaveStatus("saved");
      setSaveError("");
      setSavedAnswerVersion((v) => v + 1);
      return;
    }

    if (!save) return;
    const enabled = typeof save.isSaveEnabled === "function" ? save.isSaveEnabled() : true;
    if (!enabled) return;

    setSaveStatus("saving");
    setSaveError("");
    const {
      blob,
      mimeType,
      question,
      questionType,
      transcript,
      durationMs,
      applicationId,
      postingTitle,
      postingCompany,
      metrics,
    } = save;
    const { data, error } = await savePracticeAnswer({
      blob,
      mimeType,
      question,
      questionType,
      transcript,
      durationMs,
      applicationId,
      postingTitle,
      postingCompany,
      metrics,
      critique: critique || {},
    });
    if (!error && data?.id) savedAnswerIdRef.current = { gen, id: data.id };
    if (answerGenRef.current !== gen) {
      if (!error && data?.id) setSavedAnswerVersion((v) => v + 1);
      return;
    }
    if (error) {
      setSaveStatus("failed");
      setSaveError(error);
      return;
    }
    setSaveStatus("saved");
    // Not a failure — the answer WAS saved — but the clip specifically
    // wasn't (over the size cap, or nothing was ever recorded — BUG-3), and
    // that must be reported plainly rather than the save silently looking
    // fully successful.
    setSaveError(data?.videoSkipped || "");
    setSavedAnswerVersion((v) => v + 1);
  }, []);

  // Requests the substance critique for one completed answer and writes the
  // result into critique/critiqueStatus/critiqueError — gated on the SAME
  // answerGenRef generation doneAnswer captured, so abandoning the answer
  // (Next question, Try again, Stop, unmount, or starting a fresh answer)
  // while the request is in flight discards its result exactly like an
  // abandoned drain does. Also feeds the running per-question session
  // average once a result lands.
  //
  // `baseInputs` (question/type/answer/posting/profile/metrics) is cached in
  // lastCritiqueInputsRef so "Retry" can re-run the same analysis without
  // re-recording — but frames are deliberately NOT part of that cache. They
  // are rebuilt HERE, every time this runs (both the initial Done-triggered
  // call and any later Retry), from answerFramesRef.current gated by
  // `includeFrames` as it stands AT SEND TIME. Caching the frames array
  // itself would let a Retry replay a JPEG after the user had already
  // turned the opt-in off — the on-screen privacy notice would say no frame
  // is sent while one still was (BUG-1).
  //
  // `save` (D1) is only ever passed by doneAnswer's initial call, never by
  // retryCritique — persistAnswer tells the initial insert and a later
  // Retry's update apart by whether a row has already landed for this
  // generation, not by whether `save` itself is present (see persistAnswer).
  // Every settle here — the initial one AND any Retry — hands its result to
  // persistAnswer; passing `critiqueResult` as-is (not coerced to `{}`) lets
  // persistAnswer distinguish "this settle produced nothing new" (a Retry
  // that failed again) from "this settle explicitly has an empty critique"
  // (the very first save, when the FIRST attempt failed).
  // BUG-3: persistAnswer must run after EVERY settle, stale generation or
  // not — an abandoned review (Next question, Try again, Stop, unmount)
  // must never cancel a save the user already asked for; that's the whole
  // D1 rule (persistAnswer's own docblock states it) and it was being
  // violated here: the old code returned early on a stale generation from
  // inside both the try and the catch, before ever reaching
  // persistAnswer(...) below. critiqueResult is now captured UNCONDITIONALLY
  // (success or failure, current generation or not); only the LOCAL UI state
  // writes (setCritique/setCritiqueStatus/setQuestionScores/setCritiqueError)
  // stay gated on the generation, since those paint the screen for whatever
  // answer is on screen NOW, not whichever one this request was for.
  const runCritique = useCallback(async (baseInputs, { includeFrames, save } = {}) => {
    lastCritiqueInputsRef.current = baseInputs;
    const frames = includeFrames ? answerFramesRef.current || [] : [];
    const gen = answerGenRef.current;
    setCritiqueStatus("loading");
    setCritiqueError("");
    let critiqueResult = null;
    try {
      const result = await critiqueAnswer({ ...baseInputs, frames });
      critiqueResult = result;
      if (answerGenRef.current === gen) {
        setCritique(result);
        setCritiqueStatus("done");
        // K1: recorded from the `frames` array THIS request actually built
        // and sent above, not from `includeFrames` — see critiqueFramesSent's
        // own doc. Written on the success settle so AnswerFeedback's caption
        // reflects what really left the browser for this critique.
        setCritiqueFramesSent(framesWereSent(frames));
        const key = baseInputs.question || "";
        setQuestionScores((prev) => {
          const next = new Map(prev);
          next.set(key, Number(result?.score) || 0);
          return next;
        });
      }
    } catch (err) {
      if (answerGenRef.current === gen) {
        setCritiqueError(err?.message || "Could not analyze this answer.");
        setCritiqueStatus("error");
        // K1: also written on the error settle — the body-language section
        // renders in more than just the "done" state, and a stale true/false
        // left over from a PREVIOUS answer's success must not misreport
        // during a retry cycle for this one.
        setCritiqueFramesSent(framesWereSent(frames));
      }
    }
    persistAnswer({ gen, save, critique: critiqueResult });
  }, [persistAnswer]);

  // Re-runs the critique on the SAME answer (same transcript and metrics
  // already sent the first time) without touching the recording at all —
  // the "Retry" action on an error state. `includeFrames` is read fresh
  // from the caller here too, for the same reason doneAnswer does below
  // (BUG-1): PracticeClient passes its CURRENT opt-in/engine state, never
  // whatever was true when the original request was built.
  const retryCritique = useCallback(
    ({ includeFrames } = {}) => {
      if (!lastCritiqueInputsRef.current) return;
      runCritique(lastCritiqueInputsRef.current, { includeFrames: !!includeFrames });
    },
    [runCritique],
  );

  // Stops the recorder and sampler immediately, then drains the transcript
  // for trailing finals before computing metrics and moving the card into
  // its review state — see DRAIN_MS and BUG-1a. Every write after an await
  // is gated on this answer's generation still being current, so abandoning
  // the answer mid-drain (posting change, next question, Stop, unmount, or
  // starting a new answer) writes nothing stale (BUG-11). `context` carries
  // what the hook doesn't itself know — the question, its type, the
  // posting, the candidate's prep profile, the selected interview type
  // (G2), and whether frames are allowed to be sent — so the critique
  // request built at the end has everything it needs.
  const doneAnswer = useCallback(
    async (context = {}) => {
      if (!answeringRef.current) return;
      const gen = answerGenRef.current;

      answeringRef.current = false;
      setAnswering(false);
      answerDoneAudioRef.current = audioClockRef.current;
      settlingRef.current = true;
      setSettling(true);

      const durationMs = Date.now() - answerStartRef.current;
      const videoResult = samplerRef.current ? samplerRef.current.stop() : { summary: null, frames: [] };
      // D2: stopped in the SAME place as the video sampler, not after the
      // drain below — AC-D2-4 requires both to start/stop in lockstep, and
      // neither this call nor the model loading it may still be waiting on
      // ever blocks anything: stop() itself never awaits (see
      // BodyLanguageSampler.stop()), so a slow/unfinished model load simply
      // means fewer (or zero) samples were collected this answer, reported
      // honestly rather than waited for.
      const bodyLanguageResult = bodySamplerRef.current
        ? bodySamplerRef.current.stop()
        : new BodyLanguageSampler().stop();

      const blobPromise = recorderRef.current ? recorderRef.current.stop() : Promise.resolve(null);
      const drainPromise = new Promise((resolve) => {
        drainResolveRef.current = resolve;
        drainTimerRef.current = setTimeout(resolve, DRAIN_MS);
      });
      const [blob] = await Promise.all([blobPromise, drainPromise]);

      // The answer was abandoned while the recorder/drain were in flight —
      // its result belongs nowhere. Checked BEFORE clearing the shared
      // drain refs below: abandonInProgressAnswer resolves drainPromise
      // above without waiting for this function to notice, so a NEWER
      // answer can already have set up its OWN drain by the time this
      // stale continuation resumes here — clearing the refs unconditionally
      // would wipe that live reference out from under it (BUG-15).
      if (answerGenRef.current !== gen) return;

      drainTimerRef.current = null;
      drainResolveRef.current = null;

      collectingRef.current = false;
      settlingRef.current = false;
      setSettling(false);

      const collected = answerFinalsRef.current;
      answerFinalsRef.current = [];

      // AC-M2/R-127: derive every delivery number below (word count, wpm,
      // filler rate, speech span) from the candidate's half alone, never
      // from `collected` as a whole. A mock interviewer's words landing in
      // this answer's metrics is the R-127 shape again: word count is a SUM
      // (contaminates visibly wrong once summed) but speechDurationMs is a
      // min/max over spans (stays superficially plausible even when
      // contaminated), so the two would silently disagree instead of the
      // whole answer just being wrong. answerMetricsInputs
      // (lib/copilot/answerSpeakers.js) is the tested composition of that
      // split plus the text/span derivation built on top of it — moved out
      // of this hook so it's reachable from this repo's node-only vitest
      // config (see that module's own doc comment and
      // answerMetricsInputs.test.js). It puts every UNTAGGED final into
      // `mine` unconditionally, so a non-diarized session (every existing
      // practice user) gets `lines`/`text` byte-identical to the
      // pre-AC-M2 behavior and `others === []`.
      const { lines, text, speechDurationMs, others, myTag: dominantTag } = answerMetricsInputs(collected);
      // Final wave: learn (or reconfirm) the candidate's speaker tag from
      // THIS answer — but only when this answer actually carried a tagged
      // final. `null` here means nothing was tagged in THIS particular
      // answer (an empty answer, a drain that caught nothing, or a
      // non-diarized session), not "the candidate has no voice" — a stale
      // learned tag from an earlier answer this session is far more likely
      // correct than discarding it over one uninformative answer, so a null
      // result never overwrites whatever was already learned (see myTag's
      // own doc above for why "Next question"/"Try again" must not reset
      // it either).
      if (dominantTag !== null) setMyTag(dominantTag);

      const metrics = computeAnswerMetrics({
        text,
        durationMs,
        speechDurationMs,
        video: videoResult.summary,
        micMuted: answerMicMutedRef.current,
      });
      // D2: rides alongside the existing video summary rather than being
      // folded into computeAnswerMetrics's own contract (answerMetrics.js
      // is untouched by this feature) — AnswerReview reads it straight off
      // metrics.bodyLanguage, same as it already reads metrics.video.
      metrics.bodyLanguage = bodyLanguageResult;

      setAnswerTranscript(lines);
      setAnswerMetrics(metrics);
      // AC-M2 (C): expose the non-candidate half for a later wave to scan
      // for interviewer questions — this hook does nothing with it beyond
      // handing it out. See otherSpeakerFinals' own doc comment above.
      setOtherSpeakerFinals(others);
      answerFramesRef.current = videoResult.frames || [];
      setReplaySupported(recorderRef.current?.supported ?? true);

      if (blob) {
        const url = URL.createObjectURL(blob);
        replayUrlRef.current = url;
        setReplayUrl(url);
      }

      // Kick off the substance critique for this same answer —
      // fire-and-forget (runCritique gates its own writes on `gen`, the
      // same generation this function already verified is still current
      // above).
      runCritique(
        {
          question: context.question || "",
          type: context.type || "general",
          answer: lines.join(" "),
          posting: context.posting || null,
          profile: context.profile || "",
          // G2/AC-G2-C-4: cached into lastCritiqueInputsRef by runCritique
          // below exactly like every other baseInputs field, so a later
          // Retry (retryCritique) re-sends the SAME interview type the
          // original request used, not whatever is currently selected.
          interviewType: context.interviewType || "general",
          // AC-H5: same id `save.applicationId` below already carries for
          // persisting the answer — cached into lastCritiqueInputsRef
          // exactly like every other baseInputs field, so retryCritique
          // (below) re-sends it for the SAME application the original
          // critique was grounded in, not whatever posting is selected by
          // the time Retry is pressed.
          applicationId: context.applicationId || null,
          metrics,
        },
        {
          includeFrames: !!context.includeFrames,
          // D1: built UNCONDITIONALLY, regardless of the save switch's
          // state right now — BUG-2's fix. Whether to actually upload is a
          // per-UPLOAD decision, re-read at the moment persistAnswer is
          // about to call savePracticeAnswer (via `isSaveEnabled`, a live
          // reader, not a boolean snapshot taken here), exactly like the
          // frames opt-in above is re-read at send time rather than
          // latched. That live read is what lets a user who turns "Save
          // recordings" OFF while the critique is still running stop the
          // upload that was about to happen — the payload still has to be
          // built here regardless, so there's something for that later
          // check to act on either way.
          save: {
            blob,
            mimeType: recorderRef.current?.mimeType || "",
            question: context.question || "",
            questionType: context.type || "general",
            transcript: lines.join(" "),
            durationMs,
            applicationId: context.applicationId || null,
            postingTitle: context.posting?.title || "",
            postingCompany: context.posting?.company || "",
            metrics,
            isSaveEnabled: context.isSaveEnabled,
          },
        },
      );
    },
    [runCritique],
  );

  // Records that the mic was muted while an answer was actively being
  // recorded — a no-op otherwise (see BUG-6: muting after Done has no
  // bearing on an answer that's already done being recorded). Complements
  // the initialMicMuted seed in startAnswer above (BUG-15): this catches a
  // toggle DURING the answer, the seed catches the mic already being muted
  // when the answer began.
  const markMicMuted = useCallback((muted) => {
    if (muted && answeringRef.current) {
      answerMicMutedRef.current = true;
    }
  }, []);

  const sessionAnswered = questionScores.size;
  const sessionAverageScore =
    sessionAnswered > 0
      ? Math.round(Array.from(questionScores.values()).reduce((sum, s) => sum + s, 0) / sessionAnswered)
      : 0;

  return {
    answering,
    settling,
    answerTranscript,
    answerMetrics,
    otherSpeakerFinals,
    myTag,
    replayUrl,
    replaySupported,
    answerFramesRef,
    startAnswer,
    doneAnswer,
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
  };
}
