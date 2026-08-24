"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CopilotSession } from "@/lib/copilot/session";

// The meeting copilot's capture-and-transcript pipeline: owns a
// CopilotSession, turns its raw frames into a growing list of turns, and
// tracks the in-progress interim text per capture stream. Nothing here
// detects a topic, decides when to read insights, or renders anything —
// that split mirrors app/copilot/useLiveSession.js's own boundary (capture
// session + transcript in one hook, drafting/detection layered on
// separately), but this file does NOT import that hook and does not try to
// generalise it: useLiveSession.js's spine is shaped by interview-only
// concerns this file has no use for — question detection
// (evaluateUtterance/addQuestion), the two-value "them"/"you" speaker
// vocabulary its `interims` state is hard-coded to, per-tag pending-segment
// assembly for question boundaries, draft-answer wiring, voice cues, session
// logging. Threading `attributeSpeakers: false` through a copy of that file
// would leave 80% of it dead code with no test coverage exercising the
// meeting path at all. Reading it as the wiring/lifecycle reference — build
// the session in `start`, forward `onTranscript`/`onStatus`/`onError`, tear
// down on `stop` and on unmount — while writing a meeting-shaped body is
// this file's actual job.
//
// `attributeSpeakers: false` (lib/copilot/session.js, exercised by
// session.meeting.test.js) is what makes this a meeting session rather than
// an interview one: no diarization requested on "inperson", no speaker
// identity built, and every "inperson" turn arrives already resolved to the
// single unattributed routing value `"room"` (session.js's
// `_resolveSpeakerLabel`: "no identity instance means attribution was never
// wanted... there is no argmax to consult"). "tab"/"system" are unaffected
// by the flag — those sources get their structural "them"/"you" split from
// two independent sockets, not from diarization — so this hook sees exactly
// three possible raw `speaker` values across all three sources: "them",
// "you", "room".
//
// Turns are stored with that RAW routing value, never a display label. The
// translation lives in exactly one place, lib/meeting/insightContract.js's
// `meetingSpeakerLabel` — this hook does not import it and does not call it.
// That is deliberate, not an oversight: `meetingSpeakerLabel("room")`
// resolves to `""` (no label at all — a shared mic has no signal for who is
// talking), and if THIS hook baked that translation into the stored turn,
// every consumer of `turns` would inherit today's rendering opinion baked
// into stored data. The render boundary (app/meeting/Meeting*.js, out of
// scope for this file) is what decides how an empty label actually looks on
// screen; this hook's job stops at handing over the honest routing value.

// The frames this hook forwards to `onTranscript` never carry a `speakerTag`
// (attribution is off, so session.js never resolves one — see the header
// comment above), so — unlike useLiveSession.js's `interims`, which is a
// fixed `{ them, you }` object matching the two-value vocabulary an
// attributed interview session guarantees — this hook's interim state has to
// be a map keyed by whatever routing value shows up, because "room" is a
// third value that object literal has no slot for. `{}` starts empty rather
// than pre-seeded with `them`/`you`/`room` keys: nothing reads a key that
// was never set (an empty string and an absent key render identically), and
// pre-seeding all three would wrongly imply every meeting source produces
// interim text on all three streams, when a given session only ever uses
// one or two of them.
const NO_INTERIMS = {};

export function useMeetingSession({ source, micDeviceId } = {}) {
  const [status, setStatus] = useState("idle");
  // Two channels, mirroring useLiveSession.js's own split: `error` is what a
  // failed `start()` throws (nothing is running) and what an ESSENTIAL
  // source's socket erroring escalates to via CopilotSession.
  // aggregateStatus() (nothing useful is running anymore either, even though
  // `start()` itself returned cleanly); `warning` is CopilotSession's
  // onError callback firing for a NON-essential degradation (e.g. the
  // optional "you" mic on a tab/system session) — the session is still
  // capturing, this is a "heads up" not a "we stopped".
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  // { id, speaker, text, at }[] — the accumulated transcript. `speaker` is
  // always one of the three raw routing values described above, never a
  // resolved label.
  const [turns, setTurns] = useState([]);
  // Routing value -> in-progress text. See NO_INTERIMS above for why this is
  // a map rather than useLiveSession.js's fixed two-key object.
  const [interims, setInterims] = useState(NO_INTERIMS);

  const sessionRef = useRef(null);
  const idRef = useRef(0);

  // Stable across the hook's life — appended to by every `start()`'s
  // onTranscript closure, so a session rebuilt after `stop()` (or after an
  // error) keeps assigning ids from where the last one left off rather than
  // risking a collision with a still-rendered turn from before.
  const appendTurn = useCallback((speaker, text) => {
    setTurns((prev) => [
      ...prev,
      { id: (idRef.current += 1), speaker, text, at: Date.now() },
    ]);
  }, []);

  const stop = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = null;
    }
    setStatus("idle");
    // Interim text belongs to a socket that no longer exists the instant
    // this resolves — leaving stale interim text on screen after Stop would
    // claim someone is still mid-sentence when nothing is listening anymore.
    // `turns` is deliberately NOT touched here: the transcript already said
    // is the one thing a Stop press must never take away, the same
    // "accumulated turns survive" contract this hook applies to a session
    // ending in error (see `start`'s catch block below) applies just as much
    // to a session the user deliberately ended.
    setInterims(NO_INTERIMS);
  }, []);

  // Unmounting (switching screens, navigating away mid-meeting) must not
  // leave a live capture running — same discipline useLiveSession.js's own
  // unmount effect applies, including firing this fire-and-forget (not
  // awaited: a component that has already unmounted has nothing left to
  // update while the teardown's own async work finishes).
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
    };
  }, []);

  const start = useCallback(async () => {
    // A session already running is left alone rather than replaced — two
    // concurrent CopilotSession instances on the same source would fight
    // over the same microphone/tab-audio permission prompt and leak the
    // first session's streams the instant the second's _sources array
    // replaces this ref, exactly the kind of leak session.js's own
    // `_openStreams` bookkeeping exists to prevent at the capture layer;
    // this is that same discipline one level up, at the hook that owns the
    // ref. A session that has already reached the terminal "error" status
    // has cleared this ref itself (see `onStatus` below), so this guard never
    // stands between a user and their one way to recover from a dropped
    // socket.
    if (sessionRef.current) return;

    // Errors from a PRIOR attempt are cleared — this is a fresh attempt and
    // deserves to be judged on its own result — but `turns` and `interims`
    // are pointedly absent from this reset. This is the whole point of the
    // file's "transcript survives an error" contract: the STT layer has no
    // reconnect logic anywhere (lib/copilot/stt/index.js's provider
    // contract has no retry of its own), so the ONLY way a user recovers
    // from a dropped socket is pressing Start again — and if doing that
    // wiped the transcript gathered so far, the most likely failure mode
    // (a socket that drops mid-meeting) would also be the most destructive
    // one available. A caller that wants a genuinely blank transcript for a
    // brand new meeting is expected to unmount/remount this hook (a fresh
    // `useState([])`) rather than lean on `start()` to do it — conflating
    // "resume after a hiccup" and "begin an unrelated meeting" into the same
    // action is exactly the ambiguity this hook refuses to guess at.
    setError("");
    setWarning("");
    setStatus("connecting");

    try {
      const session = new CopilotSession({
        withMic: true,
        source,
        micDeviceId,
        // The one flag that makes this a meeting session rather than an
        // interview one — see the file header comment for what it changes
        // and why a meeting can't reuse the interview's youScore-based
        // identity in the first place.
        attributeSpeakers: false,
        onStatus: (next) => {
          setStatus(next);
          // "error" is TERMINAL for this session: CopilotSession.
          // aggregateStatus() only escalates here once an ESSENTIAL source's
          // socket has failed, and the STT layer has no reconnect anywhere
          // (see the header comment above), so nothing further will ever
          // arrive on this instance. Dropping the ref is what makes the
          // recovery path this file documents — pressing Start again —
          // actually build a new session, instead of hitting `start`'s
          // "already running" early return and doing nothing, silently,
          // until the user thinks to press Stop first. The dead session is
          // still told to stop so its streams and sockets are released;
          // fire-and-forget because nothing reads a teardown's result, and
          // `turns` is pointedly untouched here for the same reason it is
          // untouched in the catch block below.
          if (next !== "error") return;
          const dead = sessionRef.current;
          if (!dead) return;
          sessionRef.current = null;
          try {
            const pending = dead.stop();
            if (pending && typeof pending.then === "function") pending.catch(() => {});
          } catch {
            // Best-effort teardown of a session that is already failing.
          }
        },
        // A non-essential degradation (optional mic failing on tab/system;
        // see session.js's D1 essential-source rule) — the session is still
        // capturing, so this is a warning, not a fatal `error`. An essential
        // failure instead reaches `onStatus("error")` above, through
        // CopilotSession's own aggregateStatus() escalation — see that
        // file's header comment for the full essential/non-essential split.
        onError: (err) => setWarning(err?.message || "Capture warning."),
        onTranscript: ({ speaker, transcript, isFinal, textAlreadyDelivered }) => {
          if (!isFinal) {
            setInterims((prev) => ({ ...prev, [speaker]: transcript }));
            return;
          }
          // The interim slot for this speaker is done regardless of whether
          // the TEXT below turns out to be new — an interim left standing
          // after its own final frame would show the same words twice on
          // screen (once as the settled turn, once as the still-typing
          // interim line above it).
          setInterims((prev) => ({ ...prev, [speaker]: "" }));
          // lib/copilot/stt/index.js's onTranscript contract, R-127:
          // ElevenLabs' commit_strategy=vad re-delivers a final utterance's
          // exact text a second time purely to carry `speechFinal: true`.
          // session.js's own in-person path guards the identical field for
          // the identical reason (see its _handleInPersonFrame); skipping
          // this is what keeps a re-delivered frame from doubling every
          // turn's word count in the transcript this hook builds.
          if (!textAlreadyDelivered) {
            appendTurn(speaker, transcript);
          }
        },
      });
      sessionRef.current = session;
      await session.start();
    } catch (err) {
      // `session.start()` itself rejected (e.g. "inperson"'s mic is fatal
      // when unavailable — see session.js's micFatalMessage) — nothing is
      // running. `turns`/`interims` are, once again, deliberately left
      // untouched; a failed START still may have accumulated turns from a
      // PRIOR successful stretch of the same recovery attempt (start ->
      // partial capture -> drop -> start again -> this failure), and none
      // of that history is this catch block's to discard.
      setError(err?.message || "Could not start capture.");
      setStatus("error");
      if (sessionRef.current) {
        try {
          await sessionRef.current.stop();
        } catch {
          // Best-effort teardown of a session that's already failing.
        }
        sessionRef.current = null;
      }
    }
  }, [source, micDeviceId, appendTurn]);

  return {
    status,
    error,
    warning,
    turns,
    interims,
    start,
    stop,
  };
}
