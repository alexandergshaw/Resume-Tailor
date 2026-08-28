"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CopilotSession } from "@/lib/copilot/session";
import { speakerDisplayLabel } from "@/lib/copilot/speakerIdentity";
// AC-Q6/AC-Q6.9/AC-P4/AC-N1/AC-T1/AC-M1.6.3: wiring surfaces split out to keep this file under the line cap — see each module's own doc.
import { useSessionLogRecorder } from "./useSessionLogRecorder";
import { useDraftAnswer } from "./useDraftAnswer";
import { useVoiceCues } from "./useVoiceCues";
import { useQuestionPin } from "./useQuestionPin";
import { SPEAKER_ATTRIBUTION } from "@/lib/copilot/cuePolicy";
import { useCueActions } from "./useCueActions";
import { useQuestionPipeline } from "./useQuestionPipeline";
import { getInterviewType } from "./useInterviewType";
// Contract 6 (AC-A15): this file did not import pinnedQuestionEntry before —
// its only importers were CopilotDashboard.js and QuestionFeed.js.
import { pinnedQuestionEntry } from "@/lib/copilot/currentQuestion";

const CONTEXT_TURNS = 12;

// AC-M1.3.1/AC-M1.5.6: the idle shape `speakerSnapshot` state starts (and
// resets to, each new session) at — before an in-person session has
// observed a single turn, or for the entire life of a tab/system session,
// which never constructs a speakerIdentity instance at all (session.js's
// `speakerSnapshot()` returns exactly this shape in that case too, so this
// hook's default and CopilotSession's own no-op default can never drift
// apart).
const DEFAULT_SPEAKER_SNAPSHOT = { userTag: null, confidence: "unknown", overridden: false, tags: [] };

// BUG-6: shared by copyTranscript and buildContext below — resolves a
// row/turn's label through the CURRENT identity snapshot when it carries a
// numeric `speakerTag`, the same per-render (never cached) resolution
// TranscriptView.js already applies to what's on screen via
// `speakerLabelFor`, instead of the literal `speaker` field, which is
// frozen at frame-capture time and is never rewritten by a correction. A
// row with no `speakerTag` at all (tab/system — see AC-M1.5.7 above) falls
// through to today's exact ternary, unchanged: the pinned compatibility
// requirement for those two sources.
function resolveTranscriptLabel(row, snapshot) {
  if (typeof row.speakerTag === "number") {
    return speakerDisplayLabel(row.speakerTag, snapshot);
  }
  return row.speaker === "them" ? "Them" : "You";
}

// Phase 4: assemble the interviewer's speech into complete utterances (on
// Deepgram's speech_final endpoint), confirm/normalize questions with an LLM
// (heuristic pre-filter avoids calling it on trivial fragments), and auto-draft
// talking points as soon as a question is detected. The middle step is
// useQuestionPipeline.js's and the last is useDraftAnswer.js's — this hook
// still owns the session that produces the utterances in the first place, and
// hands each finished one to them.
//
// Extracted out of CopilotClient.js (which was pinned at this project's
// 1000-line verification cap) purely to keep both files under it before an
// upcoming feature adds more code to CopilotClient.js — this is the live-
// interview session pipeline (capture session, transcript, detected-question
// queue, answer drafting) and only that; CopilotClient.js keeps every piece
// of setup/UI state (mode, posting, source, mic, ...) and the render, the
// same split useCopilotDashboard.js and useApplicationDocs.js already
// established for their own pieces of this component.
//
// `answerCacheRef` is passed in rather than created here because
// CopilotClient's own onPostingChange/onProfileChange handlers (and its
// profile-change effect) clear it directly, outside this hook entirely —
// CopilotClient has to hold the one Map instance both those handlers and
// useDraftAnswer.js's runDraft (called from this hook, and its sole writer)
// read and write. `recordSpeechSample`/`resetForSession` are passed in from
// useCopilotDashboard for a plainer reason: that hook, not this one, owns
// the rolling pace/filler speech-sample window, so CopilotClient calls it
// and hands its two callbacks down as ordinary props.
// `status`/`setStatus` and `questions`/`setQuestions` are passed in rather
// than kept as local state here for a different reason again: CopilotClient's
// own render needs them directly — `live` (derived from `status`) gates
// several branches, StatusPill reads `status`, and QuestionFeed and the
// manual-question disabled check both read `questions` — so CopilotClient
// keeps the raw `useState` calls for just these two pieces of state (like it
// already does for `profile`/`posting`/`autoDraft`) and hands them down as
// controlled state; every state TRANSITION for them (setStatus/setQuestions
// calls) still lives entirely in this hook, exactly as the rest of the
// pipeline does.
//
// AC-N1.3: `draftGenRef` is the same story as `answerCacheRef` — created in
// CopilotClient so its two writers outside this hook (onPostingChange,
// onProfileChange) can bump it without needing anything this hook returns.
// runDraft captures it before its own `await` and re-checks it before both
// of its post-await writes (the cache write AC-N1.2 already guards via
// grounding, and the direct `setQuestions(... status: "done" ...)` write,
// which is not cache-mediated and so has no other guard at all — see
// runDraft's own comment). `start` below bumps it too, so a draft still
// resolving from a session the user has already left behind can't land in
// the new one either.

// AC-V5.6: the "back to idle" reset the three session-lifecycle sites share
// (start, stop, clear), returning the PREVIOUS object when it is already the
// idle pair. React bails out only on `Object.is`, so the literal
// `{them:"",you:""}` these sites used is never equal to anything and a reset
// that reset nothing still re-rendered the whole tree — and at all three the
// pair is usually already empty, cleared by the session's last final.
function clearedInterims(prev) {
  return prev.them === "" && prev.you === "" ? prev : { them: "", you: "" };
}

export function useLiveSession({
  answerCacheRef,
  draftGenRef,
  recordSpeechSample,
  resetForSession,
  status,
  setStatus,
  questions,
  setQuestions,
  source,
  micDeviceId,
  profile,
  posting,
  autoDraft,
  setSetupExpanded,
  setShowHistory,
  onCompanyCue, // AC-T1.18: CopilotClient's state; return value reports whether it acted.
  // MATERIAL-3 (step-9 review): fired when the CURRENT entry specifically
  // is redrafted (never for a redraft of some other card) — CopilotClient
  // clears its staleTypeChangeAt caption here, since `current.at` is
  // stamped once at question detection and never moves, so nothing else
  // would ever tell that caption a fresh draft has since landed.
  onCurrentEntryRedrafted,
}) {
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [finals, setFinals] = useState([]); // { id, speaker, text, at, speakerTag }
  // AC-V5.6: reset through `clearedInterims` (module scope, above), never a
  // fresh `{them:"",you:""}` literal — see that function's comment.
  const [interims, setInterims] = useState({ them: "", you: "" });
  const [startedAt, setStartedAt] = useState(null);
  // D2: the moment THIS session started connecting — set in `start()`,
  // before `setStatus("connecting")` — as distinct from `startedAt`, which
  // only lands once status actually reaches "live". A session whose socket
  // hangs at "connecting" has `live === true` and `startedAt === null`
  // forever; `liveSince` is what lets hearingState() (lib/copilot/
  // liveHearing.js) still measure silence in exactly that case.
  const [liveSince, setLiveSince] = useState(null);
  const [now, setNow] = useState(0);
  // AC-M1.5.6/AC-M1.5.8: the in-person speaker-identity snapshot, updated
  // from CopilotSession's `onSpeakerIdentity` callback (session.js) — both
  // from new evidence and from a manual correction. Stays at its default,
  // untouched, for a tab/system session, since that path never fires the
  // callback in the first place (session.js's constructor never builds a
  // `_speakerIdentity` instance for those sources).
  const [speakerSnapshot, setSpeakerSnapshot] = useState(DEFAULT_SPEAKER_SNAPSHOT);
  // AC-V2.1/V2.6: the five-value attribution axis (lib/copilot/cuePolicy.js),
  // mirrored by a ref below for the same reason speakerSnapshotRef exists —
  // this state is what VoiceCueSidebar reads to render (V2.6, a render-time
  // read), the ref is what the STABLE onTranscript closure below reads
  // synchronously (this project's react-hooks/refs rule forbids reading a
  // ref's `.current` during render, so the two can never be collapsed into
  // one). Starts at NOT_APPLICABLE — the same default a tab/system session
  // keeps for its entire life — and is set to the source-correct starting
  // value at the top of `start()` below, before a session even exists.
  const [speakerAttribution, setSpeakerAttribution] = useState(SPEAKER_ATTRIBUTION.NOT_APPLICABLE);

  const sessionRef = useRef(null);
  const idRef = useRef(0);
  const qIdRef = useRef(0);
  const recentRef = useRef([]); // rolling [{ speaker, text }] for answer context
  const pendingRef = useRef([]); // interviewer segments awaiting speech_final
  const lastQNormRef = useRef(""); // dedupe back-to-back identical questions
  const questionsRef = useRef([]);
  const autoDraftRef = useRef(true);
  // BUG-6: mirrors `speakerSnapshot` for buildContext below, same reason
  // useDraftAnswer.js keeps its own profileRef/postingRef mirrors of
  // `profile`/`posting` — buildContext is a stable useCallback (empty dep
  // array; see its own comment) whose closure must resolve against the
  // LATEST identity snapshot, not whichever one was current when the
  // callback identity was created.
  const speakerSnapshotRef = useRef(DEFAULT_SPEAKER_SNAPSHOT);
  // AC-V2.1: mirrors `speakerAttribution` above for evaluateVoiceCue's
  // closure, the same pairing speakerSnapshotRef keeps with speakerSnapshot.
  const speakerAttributionRef = useRef(SPEAKER_ATTRIBUTION.NOT_APPLICABLE);

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);
  useEffect(() => {
    autoDraftRef.current = autoDraft;
  }, [autoDraft]);
  useEffect(() => {
    speakerSnapshotRef.current = speakerSnapshot;
  }, [speakerSnapshot]);
  useEffect(() => {
    speakerAttributionRef.current = speakerAttribution;
  }, [speakerAttribution]);

  // AC-T1.16..T1.18: pin/hold state (useQuestionPin.js, split for the line
  // cap); reuses the ticking `now` clock so an expiry can fire with no click.
  const pin = useQuestionPin({ questions, questionsRef, now });
  const pinnedIdRef = useRef(null); // mirrors pin.pinnedId, as questionsRef mirrors questions.
  useEffect(() => { pinnedIdRef.current = pin.pinnedId; }, [pin.pinnedId]);
  const onCompanyCueRef = useRef(onCompanyCue);
  useEffect(() => { onCompanyCueRef.current = onCompanyCue; }, [onCompanyCue]);
  const evaluateVoiceCue = useVoiceCues(source); // AC-T1.13: see useVoiceCues.js.

  // AC-Q6/AC-Q6.9/D9: the session-log wiring surface — see
  // useSessionLogRecorder.js. `speakerSnapshotRef` is threaded through so
  // downloadLog can hand the CURRENT identity snapshot to the archive
  // builder — see that hook's own doc for why the renderer needs it as an
  // argument rather than recovering it from the log's own events.
  const { startLog, logEvent, logProvider, sessionLogSnapshot, downloadLog, hasEvents: sessionLogHasEvents } =
    useSessionLogRecorder(source, speakerSnapshotRef);

  // AC-T1.13/T1.16.1/T1.17/T1.18/AC-V2: the "act" half of useVoiceCues.js's
  // "decide vs act" split — see useCueActions.js's own doc for why this is a
  // separate hook rather than inline code here (the 1000-line cap).
  const { handleVoiceCue, cueAnnouncement, resetCueAnnouncement } = useCueActions({
    pin,
    pinnedIdRef,
    onCompanyCueRef,
    logEvent,
    speakerAttributionRef,
  });

  const live = status === "live" || status === "connecting";

  // Defect 3 (regression pass): a hold must be released the instant the
  // session leaves the live state, not only when the Stop button is
  // pressed. `stop()` below already calls `pin.unpinQuestion()` directly,
  // but it is not the only way `status` can reach "idle" (or "error"):
  // lib/copilot/session.js's own CopilotSession ends itself two other ways
  // that never call this hook's `stop` at all —
  //   - the audio track's native "ended" event
  //     (`stream.getAudioTracks()[0]?.addEventListener("ended", () =>
  //     this.stop())`) calls CopilotSession's OWN stop(), which fires
  //     `onStatus("idle")` straight from inside session.js;
  //   - an essential source's socket erroring escalates
  //     `aggregateStatus()` straight to `onStatus("error")`, again with no
  //     call back into this hook at all.
  // Both land here as nothing more than the `onStatus` callback passed into
  // `new CopilotSession(...)` in `start()` below calling `setStatus(s)` —
  // see that callback's own body. Before this fix, `pinnedId` survived a
  // session that had already ended, `held` stayed true, and — because the
  // ticking `now` clock right below is itself gated on `live` — a frozen
  // `now` meant resolvePin's own 120s expiry (lib/copilot/questionPin.js)
  // could never fire on this path either: the hold was permanent, with no
  // way to self-correct.
  //
  // Render-phase state adjustment, not a useEffect — the same idiom
  // CopilotClient.js's own `railCollapsed` uses for reacting to this exact
  // `live` transition, for the same two reasons: this project's
  // react-hooks/set-state-in-effect rule forbids the "compare in an effect,
  // setState if it changed" version of this, and an effect would also apply
  // the release one paint late — the held panel would keep claiming
  // detection and drafting were still running for one extra frame after the
  // session had already ended. Guarded on `live !== prevLiveForPin` (not
  // unconditional) so this converges in the render pass it fires in, same
  // as every other render-phase adjustment in this codebase.
  const [prevLiveForPin, setPrevLiveForPin] = useState(live);
  if (live !== prevLiveForPin) {
    setPrevLiveForPin(live);
    if (!live) pin.unpinQuestion();
  }

  // D2: used to be gated on `!startedAt` alone, which stayed true (frozen
  // `now`) for the entire life of a session stuck "connecting" — the clock
  // hearingState() needs to ever notice that silence never had a chance to
  // tick. `liveSince` is set in `start()` at the same moment `status`
  // becomes "connecting", so it is already true by the time `live` first
  // is — this only ever needs one of the two clocks to exist, not both.
  useEffect(() => {
    if (!live || (!startedAt && !liveSince)) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live, startedAt, liveSince]);

  const stop = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = null;
    }
    setInterims(clearedInterims);
    setStatus("idle");
    // BUG-2: back to the untouched default the instant a session ends — a
    // stale snapshot left in place (tags still populated, a resolved
    // userTag still set) is what let the "Who's talking" bar keep
    // rendering its chips as live, functional controls after Stop, for a
    // session that no longer exists to apply a correction to.
    setSpeakerSnapshot(DEFAULT_SPEAKER_SNAPSHOT);
    pin.unpinQuestion(); // AC-T1.17: a hold must not survive the session.
    // Step 2: mirrors start's setSetupExpanded(false) — `!live` must
    // always mean "SessionSetup renders in full".
    setSetupExpanded(true);
  }, [setSetupExpanded, setStatus, pin]);

  // Unmounting (e.g. switching main tabs) must not leave the screen-share or
  // mic running — stop whatever session is active on the way out.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
    };
  }, []);

  // BUG-6: resolves each turn's label through resolveTranscriptLabel (the
  // current identity snapshot, via speakerSnapshotRef) instead of the
  // frozen `t.speaker` — the same wrong-attribution bug as copyTranscript
  // below, but for the conversation context sent to draftAnswer/
  // confirmQuestion: a corrected interviewer turn must not keep reading as
  // "You" (or vice versa) in the grounding text a model sees.
  const buildContext = useCallback(
    () =>
      recentRef.current
        .slice(-CONTEXT_TURNS)
        .map((t) => `${resolveTranscriptLabel(t, speakerSnapshotRef.current)}: ${t.text}`)
        .join("\n"),
    [],
  );

  // AC-P4/AC-N1/AC-Q6.9: split out into useDraftAnswer.js purely to keep
  // this file under the 1000-line cap — see that file's own module doc.
  // Owns the answer-drafting flow end to end: the cache, the in-flight-
  // generation guard, and fetchAnswer's draftAnswerStreaming/draftAnswer
  // compatibility shim.
  const runDraft = useDraftAnswer({
    profile,
    posting,
    answerCacheRef,
    draftGenRef,
    buildContext,
    setQuestions,
    logEvent,
  });

  // AC-M1.3.5/AC-M1.6.3/AC-O2/AC-P4.1: the question pipeline — everything
  // between a finished utterance and an answered card, plus the typed
  // question that lands in the same place — now lives in
  // useQuestionPipeline.js, split out purely to keep this file under the
  // 1000-line cap, the same reason the four hooks called above left. See that
  // module's own doc for what it owns and what it deliberately does not: the
  // questions array, the draft (runDraft), the log, the session object and
  // all four refs handed in below stay owned HERE, so `start`/`clearAll`
  // remain the only places they are reset and `questionsRef` remains the one
  // mirror the pin surface also reads.
  //
  // Its `addQuestion`/`acceptQuestion` are not returned — see the note beside
  // that module's own return for why the pipeline's internal half stays
  // internal.
  const { addManualQuestion, evaluateUtterance, handleUtterance } = useQuestionPipeline({
    qIdRef,
    questionsRef,
    lastQNormRef,
    autoDraftRef,
    sessionRef,
    defaultSpeakerSnapshot: DEFAULT_SPEAKER_SNAPSHOT,
    buildContext,
    runDraft,
    setQuestions,
    logEvent,
  });

  // AC-M1.5.7: `speakerTag` rides alongside the existing four fields — it is
  // `undefined` for tab/system (their frames never carry the key at all;
  // see session.js's AC-M1.4.7 guarantee), which is exactly what makes
  // retroactive relabelling possible for in-person turns without changing
  // anything about how a tab/system turn is stored. TranscriptView reads
  // this straight off the row and resolves the label at RENDER time, not
  // here — this hook never resolves a label itself.
  const appendFinal = useCallback((speaker, text, speakerTag) => {
    // BUG-6: `speakerTag` now rides along into recentRef too (previously
    // only `finals` carried it) — buildContext's resolveTranscriptLabel
    // call needs it on THESE entries to resolve a corrected label into the
    // context sent to draftAnswer/confirmQuestion, not just on-screen.
    recentRef.current = [...recentRef.current, { speaker, text, speakerTag }].slice(
      -CONTEXT_TURNS * 2,
    );
    setFinals((prev) => [
      ...prev,
      { id: (idRef.current += 1), speaker, text, at: Date.now(), speakerTag },
    ]);
  }, []);

  // AC-M1.5.6: applies a correction (or any later identity change) to the
  // session's own identity instance. Harmless no-op for tab/system —
  // CopilotSession.assignUser() itself is a no-op when there is no
  // `_speakerIdentity` instance to correct (see session.js) — so this is
  // safe to hand to TranscriptView unconditionally; CopilotClient only
  // wires it up for the in-person source regardless, matching
  // TranscriptView's own "onAssignUser presence is the gate" contract.
  // BUG-2: reports whether the assignment actually reached a live session
  // — `sessionRef.current` is null once stop() has run (Stop nulls it out
  // but, before this fix, left `speakerSnapshot` populated), and the
  // optional-chain below silently no-ops in that case. The caller
  // (CopilotClient's onAssignFromBar) needs a real signal here to avoid
  // announcing a correction "worked" when nothing was left to correct —
  // a false success claim about the one action this feature exists to
  // provide.
  const onAssignUser = useCallback((tag) => {
    if (!sessionRef.current) return false;
    sessionRef.current.assignUser(tag);
    return true;
  }, []);

  // AC-M1.5.6: `speakerLabelFor` for TranscriptView's prop contract — a
  // straight pass-through to the pure `speakerDisplayLabel`, closed over
  // the CURRENT snapshot so a re-render after `onSpeakerIdentity` fires
  // resolves every row against the latest identity state.
  const speakerLabelFor = useCallback(
    (tag) => speakerDisplayLabel(tag, speakerSnapshot),
    [speakerSnapshot],
  );

  // AC-M1.5.8: "still working out who is who" — true whenever confidence
  // has not reached "high" and the user has not manually overridden it.
  // (`setUserTag`/`swap` already force confidence to "high" the instant
  // `overridden` becomes true, so the `!overridden` half of this check is
  // belt-and-braces, not load-bearing — kept explicit so this reads
  // correctly on its own rather than depending on that coupling.)
  const identityUnsettled = speakerSnapshot.confidence !== "high" && !speakerSnapshot.overridden;
  // AC-T1.13/T1.16.1/T1.17/T1.18/AC-V2: `handleVoiceCue` (the "act" half of
  // useVoiceCues.js's "decide vs act" split) now lives in useCueActions.js —
  // see that hook's own doc — and is already in scope from the call above.

  const start = useCallback(async () => {
    // AC-Q6.1/Q6.6: a fresh log the instant Start is pressed, before any
    // other per-session reset below — so even a session that fails inside
    // the try block still has a session.start entry to explain what it was.
    startLog();
    // AC-A23: the format this session's answers are drafted under, on the
    // one event that already names what the session started as.
    logEvent("session.start", { source, interviewType: getInterviewType() });
    setError("");
    setWarning("");
    setFinals([]);
    setInterims(clearedInterims);
    setQuestions([]);
    setStartedAt(null);
    // AC-S3/D2: a fresh session's own clock — without this, `now` could
    // still hold a stale timestamp from a PRIOR session (this state is
    // otherwise only advanced by the ticking interval above, at most once a
    // second), which would let hearingState's very first evaluation of a
    // new session compare a brand-new `startedAt`/`liveSince` against an
    // old `now`, understating (or even negating) elapsed silence for up to
    // a second. `liveSince` is stamped with the SAME timestamp — this is
    // the "Start was pressed" moment `startedAt` cannot yet stand in for,
    // since it only lands once status reaches "live".
    const sessionStartTs = Date.now();
    setNow(sessionStartTs);
    setLiveSince(sessionStartTs);
    setSpeakerSnapshot(DEFAULT_SPEAKER_SNAPSHOT);
    // AC-V2.1: this session's starting attribution value, known before the
    // session object even exists — "inperson" starts PENDING (nothing is
    // known about diarization until the socket reports back, see
    // session.js's own onAttribution comment); every other source has no
    // socket-dependent fact to wait on at all and goes straight to
    // NOT_APPLICABLE, which is also this state's idle default. Setting this
    // here (not only relying on CopilotSession's constructor default) is
    // what gives tab/system and the meeting path a correct value with NO
    // callback ever firing for them — see session.js's onAttribution, which
    // only ever fires on the in-person path.
    setSpeakerAttribution(source === "inperson" ? SPEAKER_ATTRIBUTION.PENDING : SPEAKER_ATTRIBUTION.NOT_APPLICABLE);
    pin.unpinQuestion(); // AC-T1.17: a hold must not survive into the next session.
    resetCueAnnouncement();
    recentRef.current = [];
    pendingRef.current = [];
    lastQNormRef.current = "";
    answerCacheRef.current.clear();
    // AC-N1.3: invalidates a draft still resolving from the session just
    // left behind — see runDraft's own comment for why the cache clear above
    // isn't enough by itself (a superseded draft's direct setQuestions write
    // isn't cache-mediated).
    draftGenRef.current += 1;
    resetForSession();
    // Step 2/4: collapse both disclosures for THIS session, same as every
    // other per-session reset above.
    //
    // AC-S3.9: `setShowHistory(false)` stays — it must NOT stop collapsing
    // the transcript. What changed is its SCOPE, at the call site in
    // CopilotClient.js (AC-S3.8): `showHistory` now gates only
    // <TranscriptView>, the one genuinely tall element this disclosure
    // exists to keep off the default screen. <QuestionFeed> and the
    // always-visible hearing strip (AC-S3.6) both moved OUTSIDE the
    // Collapse there and render unconditionally regardless of this value —
    // so collapsing it here no longer hides anything the user needs to see
    // that a live session is working. Un-collapsing it too (or dropping
    // this call) would bring back the exact scrolling problem the
    // disclosure was built to avoid, for a bug this fix does not touch.
    setSetupExpanded(false);
    setShowHistory(false);
    setStatus("connecting");
    try {
      const session = new CopilotSession({
        withMic: true,
        source,
        micDeviceId,
        onStatus: (s) => {
          setStatus(s);
          // AC-Q6.11: the resolved status transitions — the exact signal
          // the reported bug hinged on (went to "Live" and then nothing).
          logEvent("status", { status: s });
          if (s === "live") setStartedAt((prev) => prev || Date.now());
        },
        onError: (err) => {
          setWarning(err.message);
          // AC-Q6.4: type matches /warn|error/i, and the message the user
          // was actually shown rides along verbatim.
          logEvent("session.warning", { message: err?.message || "" });
        },
        // AC-V2.1: fired only on the in-person attribution path (session.js's
        // own onAttribution comment) — once, the instant diarization's fate
        // is known. Never fires for tab/system or the meeting path, which
        // both already got their correct value from the setSpeakerAttribution
        // call above, before this session was even constructed.
        onAttribution: (a) => setSpeakerAttribution(a),
        // AC-W1.3: fired for every source that opens an STT stream — unlike
        // onAttribution above, not only in-person — the instant
        // createSttStream (stt/index.js) resolves and its `providerName` is
        // known. Routed straight to the session log via logProvider
        // (useSessionLogRecorder.js) rather than into React state: nothing
        // in the UI renders this today, only the downloaded log does, and
        // that log already reads live off sessionLogSnapshot() on demand
        // (see logProvider's own comment for why it targets the CURRENT
        // log rather than needing a re-render to reach it).
        onSttProvider: (name) => logProvider(name),
        // AC-M1.4.9/10: fired only for the "inperson" source, once per
        // utterance CopilotSession itself assembles — see handleUtterance
        // (useQuestionPipeline.js, in scope from the call above) for why
        // this, not `speaker === "them"`, is what drives in-person question
        // detection.
        onUtterance: handleUtterance,
        // AC-M1.5.6: fired on every identity change — new evidence AND a
        // manual correction (session.js's assignUser). Never fires for
        // tab/system.
        onSpeakerIdentity: (snap) => {
          setSpeakerSnapshot(snap);
          // BUG-1 (adversarial review): `provisional` means "this question
          // is attributed to the voice CURRENTLY believed to be the user" —
          // not "...and that belief is still unconfirmed". The old formula
          // (`... && snap.confidence !== "high" && !snap.overridden`) went
          // false the moment confidence reached "high" or the user pressed
          // "mark as me" — the exact instant the attribution is CONFIRMED,
          // not disproven — so it re-derived every matching entry's flag to
          // `false` and evicted it from the "provisional" UI right when it
          // was proven right. Once identity is confident that tag IS the
          // user, a question from that tag is MORE certainly the user's own
          // speech, not less.
          //
          // Still re-derives EVERY entry from the fresh snapshot (not only
          // clearing it), so an argmax that has moved on to a DIFFERENT tag
          // also stops calling a past entry provisional the instant it
          // turns out to have been the actual interviewer all along.
          // Entries with no `speakerTag` at all (tab/system, or seeded
          // before any tag existed) are never provisional and are left
          // alone.
          setQuestions((prev) =>
            prev.map((q) =>
              q.speakerTag === null
                ? q
                : {
                    ...q,
                    provisional: snap.userTag !== null && q.speakerTag === snap.userTag,
                  },
            ),
          );
        },
        onTranscript: ({
          speaker,
          transcript,
          isFinal,
          speechFinal,
          start: spanStart,
          duration,
          textAlreadyDelivered,
          speakerTag,
        }) => {
          if (!isFinal) {
            // AC-V5.6: `prev` UNCHANGED when this speaker's interim already
            // reads exactly this. React bails out only on `Object.is`, so the
            // unconditional spread this replaces re-rendered the whole tree
            // several times a second for an unchanged interim — and providers
            // re-send one on every mid-sentence pause.
            setInterims((prev) => (prev[speaker] === transcript ? prev : { ...prev, [speaker]: transcript }));
            return;
          }
          // AC-Q6.2/Q6.11: every finalized frame, including a provider's
          // re-delivery of text already sent (R-127 below) — a diagnostic log
          // shows what the pipeline received, not what survived de-duplication.
          logEvent("transcript", {
            text: transcript,
            speaker,
            isFinal,
            speechFinal,
            speakerTag,
            start: spanStart,
            duration,
          });
          // AC-V5.6, the same bailout and the higher-value half of it: the
          // interim is almost always already cleared by the provider's own
          // last empty one, so this re-rendered on EVERY final for nothing.
          setInterims((prev) => (prev[speaker] === "" ? prev : { ...prev, [speaker]: "" }));

          // AC-T1.13/AC-V2.1: snapshot read synchronously, as handleUtterance
          // does in useQuestionPipeline.js and for the same reason (that
          // hook's own comment). `speakerAttributionRef.current` rides alongside it —
          // this closure is stable (created once in start(), see this
          // callback's own deps) so it must read the ref, not the
          // `speakerAttribution` state variable, to see the CURRENT value
          // rather than whatever was current when start() was called.
          const cueMatch = evaluateVoiceCue(
            { isFinal, textAlreadyDelivered, speaker, transcript },
            sessionRef.current?.speakerSnapshot() || DEFAULT_SPEAKER_SNAPSHOT,
            speakerAttributionRef.current,
          );
          if (cueMatch) handleVoiceCue(cueMatch, transcript);

          // AC-I2.10/11 + AC-V1.8: pace samples come from the user's own FINAL
          // frames only, never from a wall-clock stand-in for missing audio
          // timing, and — the fix — *** GATED ON THE SPAN, NOT ON
          // `textAlreadyDelivered`. *** This sat inside the
          // `!textAlreadyDelivered` block below, which reads as obviously
          // right and is exactly backwards: on ElevenLabs a commit arrives as
          // an untimed frame followed by its timed twin, and the twin — the
          // ONLY frame that ever carries start/duration — is the flagged one,
          // so skipping flagged frames threw away 100% of that provider's
          // audio timing and pace/filler readings silently measured nothing.
          // The flag means the TEXT is a re-delivery and nothing more
          // (lib/copilot/stt/index.js's onTranscript contract); timing comes
          // from whichever frame carries it, so the pair contributes text once
          // (below) and a span once (here), in either arrival order, and the
          // numeric check keeps that at once rather than twice. "inperson" is
          // unchanged — session.js resolves it to "you"/"them" (AC-M1.6.3.4).
          if (speaker === "you" && typeof spanStart === "number" && typeof duration === "number") {
            recordSpeechSample({ text: transcript, start: spanStart, duration });
          }

          // R-127: this frame's text already went into appendFinal/pendingRef
          // — skip the TEXT accumulation below. `speechFinal` is still
          // honoured further down: it is this frame's own end-of-turn signal
          // whether or not its text was new.
          if (!textAlreadyDelivered) {
            appendFinal(speaker, transcript, speakerTag);

            // AC-M1.4.9: the tab/system pendingRef assembly below is
            // COMPLETELY untouched for those two sources, but must not also
            // run for "inperson" — that source's `speaker` resolves through
            // the very same "you"/"them" values, and CopilotSession already
            // assembles and evaluates ITS utterances through onUtterance
            // above (AC-M1.4.9/10). Running both would double-detect every
            // in-person question and is exactly the "second per-tag
            // assembly inside the client" the AC forbids.
            if (source !== "inperson" && speaker === "them") {
              pendingRef.current.push(transcript);
            }
          }

          if (source !== "inperson" && speaker === "them" && speechFinal) {
            const utterance = pendingRef.current
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            pendingRef.current = [];
            evaluateUtterance(utterance);
          }
        },
      });
      sessionRef.current = session;
      await session.start();
    } catch (err) {
      setError(err?.message || "Could not start capture.");
      setStatus("error");
      await stop();
    }
  }, [
    stop,
    appendFinal,
    evaluateUtterance,
    handleUtterance,
    evaluateVoiceCue,
    handleVoiceCue,
    source,
    micDeviceId,
    recordSpeechSample,
    resetForSession,
    answerCacheRef,
    draftGenRef,
    setSetupExpanded,
    setShowHistory,
    setStatus,
    setQuestions,
    logEvent,
    startLog,
    logProvider,
    pin,
    resetCueAnnouncement,
  ]);

  const onDraft = useCallback(
    (id) => {
      const q = questionsRef.current.find((it) => it.id === id);
      // "Redraft" (already answered) forces a fresh generation; the first draft
      // may reuse a cached answer.
      if (q) runDraft(id, q.question, { force: q.status === "done" });
      // MATERIAL-3: a MANUAL redraft of the entry that is currently "the
      // current one" (not just any card) is exactly what makes a prior
      // staleness caption false — see onCurrentEntryRedrafted's own doc.
      if (pinnedQuestionEntry(questionsRef.current, pinnedIdRef.current)?.id === id) {
        onCurrentEntryRedrafted?.();
      }
    },
    [runDraft, onCurrentEntryRedrafted],
  );

  // Contract 6 (AC-A15): what an interview-type change fires when the LIVE
  // tab's own picker made it. The load-bearing gate is `sessionRef.current`,
  // never `live` — a ref cannot freeze into a stale closure the way
  // render-scope state can, and that is what stops a BILLED model call
  // firing into an unmounted branch after a finished session: `stop()`
  // above never clears `questions`, and pinnedQuestionEntry(list, null)
  // falls back to the latest entry, so without this check a change made
  // after Stop would silently re-bill for whatever was last on screen.
  const redraftCurrentAnswer = useCallback(() => {
    if (!sessionRef.current) return;
    // Not pin.entry — a render value, stale inside this change callback.
    const entry = pinnedQuestionEntry(questionsRef.current, pinnedIdRef.current);
    if (entry) {
      runDraft(entry.id, entry.question, { force: true });
      onCurrentEntryRedrafted?.(); // this redraft is ALWAYS the current entry, by construction.
    }
  }, [runDraft, onCurrentEntryRedrafted]);

  const clearAll = useCallback(() => {
    setFinals([]);
    setInterims(clearedInterims);
    setQuestions([]);
    recentRef.current = [];
    pendingRef.current = [];
    lastQNormRef.current = "";
    pin.unpinQuestion(); // AC-T1.17: Clear releases a hold too.
  }, [setQuestions, pin]);

  // BUG-6: resolves each line through resolveTranscriptLabel (current
  // identity snapshot) rather than the frozen `l.speaker` — otherwise a
  // user who corrects a wrong identity mid-session, watches the ON-SCREEN
  // transcript relabel itself, and then presses Copy would get a pasted
  // transcript with the OLD (wrong) attribution, since `l.speaker` is set
  // once at frame time and no correction ever rewrites it. `speakerSnapshot`
  // (not a ref) is fine here — this only runs synchronously from a button
  // click, so the latest render's closure is exactly what's needed.
  const copyTranscript = useCallback(() => {
    const text = finals
      .map((l) => `${resolveTranscriptLabel(l, speakerSnapshot)}: ${l.text}`)
      .join("\n");
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  }, [finals, speakerSnapshot]);

  const elapsed = startedAt ? now - startedAt : 0;

  // Extra (adversarial review): `buildContext`, `runDraft`, `appendFinal`,
  // `evaluateUtterance` and `handleUtterance` are NOT exported here —
  // CopilotClient.js, the only caller, never destructures any of them. This
  // module boundary exists to bound CopilotClient.js's file size (see the
  // module doc at the top); a public surface nothing uses just invites a
  // future caller to reach into the pipeline's internals instead of going
  // through start/stop/onDraft/etc. All five stay as ordinary local bindings
  // — every one of them is still used INSIDE this hook (runDraft by onDraft
  // and by useQuestionPipeline.js's addQuestion, which is handed it;
  // appendFinal and evaluateUtterance by start's onTranscript,
  // handleUtterance by start's onUtterance, buildContext by runDraft/
  // copyTranscript and by that same pipeline hook) — only the return object
  // shrinks. `addManualQuestion` is the one piece of the pipeline that IS
  // returned, because ManualQuestion's onSubmit is a user-facing control.
  //
  // `now` USED to be cut for the same reason (nothing outside this hook
  // destructured it, `elapsed` above was the only consumer). AC-S3.6 changed
  // that: LiveHearingStrip.js (via CopilotClient.js) needs the same ticking
  // clock this hook already advances to evaluate hearingState() on every
  // tick, not just the one derived `elapsed` number — re-deriving a second
  // independent clock in CopilotClient.js instead would risk the two
  // drifting out of sync with each other for no reason.
  return {
    warning,
    setWarning,
    error,
    finals,
    interims,
    startedAt,
    // D2: LiveHearingStrip.js's own clock, alongside startedAt — see
    // hearingState's (lib/copilot/liveHearing.js) doc for why a session
    // stuck "connecting" needs this second, earlier timestamp to measure
    // silence from at all.
    liveSince,
    now,
    elapsed,
    start,
    stop,
    onDraft,
    // Contract 6/AC-A15: CopilotClient's interview-type change subscriber
    // calls this, gated on canRedraft — see that subscriber's own comment.
    redraftCurrentAnswer,
    // AC-O2: CopilotClient wires this to ManualQuestion's onSubmit — see
    // addManualQuestion's own comment (useQuestionPipeline.js) for what it
    // deliberately skips.
    addManualQuestion,
    clearAll,
    copyTranscript,
    // AC-M1.5.6/5.8: the in-person speaker-identity surface — CopilotClient
    // feeds these straight into TranscriptView's own prop contract (and its
    // own always-reachable correction control, AC-M1.5.9). All four are
    // harmless/inert for tab/system: `speakerSnapshot` never leaves its
    // default, `identityUnsettled` is therefore always true but simply
    // never read for that source (CopilotClient never wires this surface up
    // for tab/system to begin with — see its own `identityProps`), and
    // `onAssignUser` (BUG-2) now returns `false` instead of silently
    // no-oping whenever no session exists to apply a correction to
    // (stopped, or never started) — CopilotClient's onAssignFromBar is what
    // actually acts on that return value.
    speakerSnapshot,
    speakerLabelFor,
    identityUnsettled,
    onAssignUser,
    // AC-V2.1/V2.6: the structured attribution axis (lib/copilot/cuePolicy.js)
    // CopilotClient hands to VoiceCueSidebar so it can state — never restate,
    // read straight off the same module handleVoiceCue enforces against —
    // which cues are unavailable this session and why.
    speakerAttribution,
    // AC (onModeChange): sessionRef itself, so CopilotClient's onModeChange
    // can keep keying its teardown off "does a session object exist" rather
    // than off `status`/`live` — see onModeChange's own comment for why an
    // errored session still needs this distinct check.
    sessionRef,
    // AC-Q6: the wiring surface CopilotClient's "Download session log"
    // control uses — see this hook's own sessionLogSnapshot/downloadLog
    // above. Tests (useLiveSession.log.test.js) still read the log through
    // sessionLogSnapshot() directly; CopilotClient itself no longer reads
    // it — see sessionLogHasEvents below, D7's fix for the control's
    // enabled state.
    sessionLogSnapshot,
    downloadLog,
    // D7: a real, reactive boolean — flipped true inside useSessionLogRecorder's
    // startLog(), not derived by deep-cloning sessionLogSnapshot() on every
    // render (that clone used to run at least once a second from the
    // ticking clock plus once per interim frame, over up to 500 events of
    // up to 4000 chars each, purely to compute one boolean CopilotClient
    // never even displayed).
    sessionLogHasEvents,
    ...pin, // AC-T1.16..T1.18: the click path; handleVoiceCue above is the voice path.
    cueAnnouncement,
  };
}
