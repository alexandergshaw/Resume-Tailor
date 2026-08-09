"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { normalizeQuestion } from "@/lib/copilot/questions";
import { fmtClock } from "@/lib/copilot/clock";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { listMicrophones, resolveStoredMicDeviceId, SYSTEM_DEFAULT_OPTION } from "@/lib/copilot/audioDevices";
import { useEngine } from "@/app/settings/engine";
import { useIsMobile } from "@/app/hooks/useResponsive";
import TabHeader from "@/app/components/TabHeader";
import TranscriptView from "./TranscriptView";
import QuestionFeed from "./QuestionFeed";
import StatusPill from "./StatusPill";
import SessionSetup from "./SessionSetup";
import SpeakerChip from "./SpeakerChip";
import CopilotDashboard from "./dashboard/CopilotDashboard";
import PracticeClient from "./practice/PracticeClient";
import { usePrepContext } from "./usePrepContext";
import { useApplicationDocs } from "./useApplicationDocs";
import { useCopilotDashboard } from "./useCopilotDashboard";
import { useLiveSession } from "./useLiveSession";

const SOURCE_STORAGE_KEY = "copilot-audio-source";
// AC-I1.4: the selected microphone's own key — separate from
// SOURCE_STORAGE_KEY (interviewer audio) and PrepContext's storage key, so
// the three controls persist independently. Follows the exact same
// seed-from-storage/persist pattern as SOURCE_STORAGE_KEY below (try/catch,
// a bad or missing value falling back to the default).
const MIC_STORAGE_KEY = "copilot-mic-device";
// AC-H1.2: live mode's own wording for the shared PostingPicker — its
// defaults are practice mode's exact strings, so passing these explicitly
// here is what keeps the two modes worded differently without touching
// PostingPicker's defaults (which practice mode still relies on).
const POSTING_PICKER_LABEL = "Interviewing for";
const POSTING_PICKER_BLANK_HINT =
  "Leave blank to keep talking points grounded in your prep context only.";
// F2: display name for whichever speech-to-text provider the server has
// selected (STT_PROVIDER, see lib/config/env.js's getSttProvider) — kept
// here, keyed off the token response's `provider` field, rather than
// hardcoded into the notices below, so they can never claim a destination
// that isn't actually receiving the audio (AC-F2-5).
const STT_PROVIDER_NAMES = { deepgram: "Deepgram", elevenlabs: "ElevenLabs" };

// Step 4: links the transcript/question-history disclosure's Button
// (aria-controls) to the region it shows/hides.
const HISTORY_REGION_ID = "copilot-history-region";

// BUG-H5/AC-H6.25: names only the document(s) actually found for the
// selected application — never both when only one exists — the same
// discipline SubmittedDocs.js's statusSuffix and
// practice/SampleAnswer.js's sourceCaption already apply to the read-only
// panel and the sample-answer caption respectively. Only called once at
// least one of the two is known to be present; callers decide what to say
// when neither is.
function submittedDocsClause(hasResume, hasCoverLetter) {
  if (hasResume && hasCoverLetter) {
    return "the résumé and cover letter you submitted for it are also sent to Google Gemini to ground your talking points";
  }
  if (hasResume) {
    return "the résumé you submitted for it is also sent to Google Gemini to ground your talking points";
  }
  return "the cover letter you submitted for it is also sent to Google Gemini to ground your talking points";
}

// Phase 4: assemble the interviewer's speech into complete utterances (on
// Deepgram's speech_final endpoint), confirm/normalize questions with an LLM
// (heuristic pre-filter avoids calling it on trivial fragments), and auto-draft
// talking points as soon as a question is detected.
export default function CopilotClient() {
  const [mode, setMode] = useState("live"); // "live" | "practice"
  // Owned here rather than inside useLiveSession, despite being that hook's
  // state in every other sense (every setStatus/setQuestions call lives
  // there) — see useLiveSession.js's module doc: useCopilotDashboard below
  // needs `live` (derived from `status`) and `questions` REACTIVELY, before
  // useLiveSession is called, and this project's react-hooks/refs lint rule
  // forbids reading a ref's `.current` during render as a substitute.
  const [status, setStatus] = useState("idle"); // idle | connecting | live | error
  const [questions, setQuestions] = useState([]);
  const [autoDraft, setAutoDraft] = useState(true);
  const [profile, setProfileRaw] = usePrepContext();
  // AC-H1: the tracked posting selected for this live session, if any — the
  // same picker practice mode has, feeding both the "Submitted for this
  // application" panel and the grounding documents draftAnswer sends along
  // (see onPostingChange/runDraft below).
  const [posting, setPosting] = useState(null);
  const [source, setSource] = useState("tab"); // "tab" | "system" | "inperson" — the interviewer's audio source
  // AC-I1: the selected microphone's device id, or `null` for "System
  // default" — audioDevices.js's SYSTEM_DEFAULT_OPTION.deviceId, and exactly
  // the value capture.js's captureMicAudio treats as "no deviceId
  // constraint at all" (AC-I1.3).
  const [micDeviceId, setMicDeviceId] = useState(null);
  const [showConsent, setShowConsent] = useState(true);
  // F2: which speech-to-text provider is actually live — `null` until the
  // mount-time probe below resolves. See the useEffect near the other
  // mount-time setup for why this is a separate, display-only fetch rather
  // than something threaded out of a running session.
  const [sttProviderName, setSttProviderName] = useState(null);
  // Step 2: whether SessionSetup renders in full. Defaults `true` to match
  // "renders in full before a session starts"; `start`/`stop` below flip
  // it false/true again each session, and the user can toggle it in
  // between via SessionSetup's own disclosure button.
  const [setupExpanded, setSetupExpanded] = useState(true);
  // Step 4: same idea, for the transcript + question-history row — only
  // meaningful while `live` (reset `false` in `start`); the `!live` branch
  // renders that row unconditionally, ignoring this.
  const [showHistory, setShowHistory] = useState(false);
  const [liveHeight, setLiveHeight] = useState(null); // Step 3: measured; null => "auto" pre-measurement/SSR
  const isMobile = useIsMobile();

  const answerCacheRef = useRef(new Map()); // normalized question -> { points, type }
  const liveWrapperRef = useRef(null); // Step 3: the bounded session column, measured below

  // AC-H2/AC-H3: loads the résumé and cover letter submitted for the
  // selected posting, the moment it changes — feeds the "Submitted for this
  // application" panel below. Called unconditionally (not just in live
  // mode's JSX branch) because hooks can't be conditional; its result is
  // simply unused while `mode === "practice"`, since that branch renders
  // PracticeClient instead, which owns its own posting selection.
  const {
    status: docsStatus,
    resume: docsResume,
    coverLetter: docsCoverLetter,
    error: docsError,
    retry: retryDocs,
  } = useApplicationDocs(posting?.id || null);
  const { engine } = useEngine();
  const isEmbedded = engine === "embedded";

  // Prep context (seed-from-storage/fallback/persist) lives in
  // usePrepContext — this wraps its setter to also drop the answer cache:
  // prior answers were grounded in the old background, so they must not
  // survive an edit to it (that cache-clearing logic is specific to the
  // live session's auto-draft flow, not something the shared hook should
  // know about).
  const onProfileChange = useCallback(
    (val) => {
      answerCacheRef.current.clear();
      setProfileRaw(val);
    },
    [setProfileRaw],
  );

  // AC-H1.4: changing OR clearing the selected posting clears the answer
  // cache for the same reason onProfileChange above does — every cached
  // draft was grounded in the OLD posting's documents (or the lack of any),
  // and must not be served once the selection has moved on. Covers both
  // "changing" and "clearing" since PostingPicker calls onChange with
  // `null` for the latter.
  const onPostingChange = useCallback((newPosting) => {
    answerCacheRef.current.clear();
    setPosting(newPosting);
  }, []);

  // Seed the interviewer-audio-source choice from localStorage, wrapped in
  // try/catch like the prep-context read above. A missing or unrecognized
  // value just leaves the "tab" default from useState in place. The actual
  // setSource call is deferred a microtask out (same shape the mic seed
  // effect right below already uses via listMicrophones().then(...)) rather
  // than called synchronously in the effect body, which is what keeps this
  // clear of react-hooks/set-state-in-effect — this project's lint rule set
  // only started surfacing this specific effect once CopilotClient.js's
  // hook graph shrank enough for its whole-component analysis to complete;
  // the pattern itself was always the thing the rule flags.
  //
  // AC-M1.5.2/R-037: "inperson" is a third valid stored value, alongside
  // "tab"/"system" — omitting it here would mean a candidate who picked
  // in-person mode loses that choice on every reload. The deferred
  // Promise.resolve().then(...) shape above is kept exactly as it was;
  // only the set of values considered valid grows.
  useEffect(() => {
    let stored = null;
    try {
      stored = window.localStorage.getItem(SOURCE_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored === "tab" || stored === "system" || stored === "inperson") {
      Promise.resolve().then(() => setSource(stored));
    }
  }, []);

  // AC-I1.4/AC-I1.5: seed the selected microphone from localStorage, same
  // try/catch discipline as the source seed above. A stored id can't just be
  // trusted, though — the device it names may no longer be plugged in — so
  // this resolves it against a FRESH device list via
  // resolveStoredMicDeviceId (wave 1's audioDevices.js) before adopting it,
  // falling back to System default (`null`, already today's useState
  // default) rather than leaving a stale id in place that would later throw
  // OverconstrainedError. listMicrophones() only calls enumerateDevices(),
  // never getUserMedia, so this never prompts for permission on its own —
  // same guarantee MicPicker's own mount-time load relies on.
  useEffect(() => {
    let stored = null;
    try {
      stored = window.localStorage.getItem(MIC_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (!stored) return undefined;
    let cancelled = false;
    listMicrophones().then((options) => {
      if (cancelled) return;
      const resolved = resolveStoredMicDeviceId(stored, options);
      if (resolved) setMicDeviceId(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // F2: learn which speech-to-text provider is actually live, purely so the
  // privacy notices below (and the one PracticeClient renders, which reads
  // this as a prop) can name it instead of unconditionally saying
  // "Deepgram" the way they used to. Hits the token route's GET handler —
  // NOT fetchSttToken()'s POST — because GET mints nothing: it just answers
  // "which provider?" (see app/api/copilot/token/route.js). Using POST here
  // would mint a real credential on every page view purely to read
  // `.provider` and then throw it away unconnected, which is wasteful on
  // any provider and a genuine loss on ElevenLabs, whose token is
  // single-use. This runs ahead of, and separately from, whatever a
  // session's own createSttStream call does when a session actually starts
  // (see lib/copilot/stt/index.js) — the whole point is to inform the user
  // BEFORE they press Start, not only once a session already exists.
  // Errors are swallowed: an unreachable/misconfigured provider surfaces
  // for real through the normal onError/onStatus("error") path once a
  // session is actually started, and this mount-time probe is not it.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/copilot/token", { method: "GET" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        setSttProviderName(STT_PROVIDER_NAMES[body?.provider] || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // AC-M1.5.2/R-037: accepts "inperson" alongside the original two values —
  // omitting it here is the OTHER half of what would make the new toggle
  // option inert (the seeding effect above is the other half).
  const onSourceChange = useCallback((val) => {
    if (val !== "tab" && val !== "system" && val !== "inperson") return;
    setSource(val);
    try {
      window.localStorage.setItem(SOURCE_STORAGE_KEY, val);
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, []);

  // AC-I1.4: `id` is `null` for "System default" (MicPicker's own
  // SYSTEM_DEFAULT_OPTION.deviceId) — that's the useState default already,
  // so there is nothing meaningful to persist for it; only a real device id
  // is written to storage, and choosing System default clears whatever was
  // stored before.
  const onMicDeviceChange = useCallback((id) => {
    setMicDeviceId(id || null);
    try {
      if (id) {
        window.localStorage.setItem(MIC_STORAGE_KEY, id);
      } else {
        window.localStorage.removeItem(MIC_STORAGE_KEY);
      }
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, []);

  const live = status === "live" || status === "connecting";

  // Step 2/4: disclosure toggles — click handlers, not effects, so these
  // are the only place besides start/stop that setupExpanded/showHistory
  // ever change outside a per-session reset.
  const onToggleSetupExpanded = useCallback(() => setSetupExpanded((v) => !v), []);
  const onToggleHistory = useCallback(() => setShowHistory((v) => !v), []);

  // Step 2: the two facts SessionSetup's collapsed summary keeps visible.
  // `micLabel` skips a second device-enumeration lookup (MicPicker.js's own
  // job, out of scope here) for a fact that's always true without one:
  // whether a specific device is selected.
  const postingSummary = posting?.title || "No posting selected";
  const micLabel = micDeviceId ? "custom microphone" : SYSTEM_DEFAULT_OPTION.label;

  // AC-H3: reshaped into the shape SubmittedDocs/PracticeSetup.js's own
  // `submittedDocs` prop already takes (useApplicationDocs returns it
  // directly) — CopilotClient still needs the individual fields itself
  // (postingGroundingNotice below), so this just regroups them.
  const submittedDocsForSetup = {
    status: docsStatus,
    resume: docsResume,
    coverLetter: docsCoverLetter,
    error: docsError,
    retry: retryDocs,
  };

  // AC-I4.23: the load-bearing cache write — keyed EXACTLY the way runDraft
  // below looks a cached answer up (normalizeQuestion(question)), so a
  // correct prediction is served from the SAME cache instead of costing a
  // second draftAnswer call when the interviewer actually asks the
  // predicted question.
  // AC-K1: the pre-draft's reading aids are cached with it, so a correct
  // prediction serves the SAME panel the question would have drafted on
  // demand — a cache hit that dropped the cues and subsections would make a
  // successful prediction look like a degraded answer.
  const onPrefetchedAnswer = useCallback((question, { points, type, cues, buzzwords, resumeAnchor, idealProject }) => {
    answerCacheRef.current.set(normalizeQuestion(question), {
      points,
      type,
      cues: Array.isArray(cues) ? cues : [],
      buzzwords: Array.isArray(buzzwords) ? buzzwords : [],
      anchor: resumeAnchor || null,
      idealProject: idealProject || null,
    });
  }, []);

  // AC-I2/AC-I3/AC-I4: live mode's dashboard — talking pace, the predicted
  // next question, and a pre-drafted answer for it. `active: live` (AC-I4
  // fix) is what keeps a posting selection or a detected question from
  // spending a model call before the user has actually pressed Start; see
  // useCopilotDashboard.js's own `active` doc for what it does with this.
  const {
    pace,
    // AC-N1: verbal-filler reading beside `pace` — see useCopilotDashboard.js.
    fillers,
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
    resetForSession,
  } = useCopilotDashboard({
    questions,
    posting,
    applicationId: posting?.id || null,
    autoDraft,
    profile,
    onPrefetchedAnswer,
    active: live,
  });

  const {
    warning,
    setWarning,
    error,
    finals,
    interims,
    startedAt,
    elapsed,
    stop,
    start,
    onDraft,
    clearAll,
    copyTranscript,
    // AC-M1.5.6/5.8/5.9: the in-person speaker-identity surface — see the
    // identityProps/correction-bar derivations below for how these feed
    // TranscriptView and the always-reachable correction control.
    speakerSnapshot,
    speakerLabelFor,
    identityUnsettled,
    onAssignUser,
    sessionRef,
  } = useLiveSession({
    answerCacheRef,
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
  });

  // BUG-2: a correction made from the always-visible "Who's talking" bar
  // (rendered below) must announce itself through a polite live region,
  // exactly as TranscriptView.handleAssign already does for corrections
  // made through the transcript — retroactively rewriting every label in
  // the transcript is a change of meaning, and a user who cannot see it
  // happen still needs to be told. This is a SEPARATE region from
  // TranscriptView's own, not a second announcement of the same event:
  // TranscriptView owns that region's state internally (it isn't reachable
  // from here) and, more importantly, TranscriptView sits inside the
  // `showHistory` Collapse — closed by default while a session is live —
  // which is exactly the surface BUG-2 says goes unreachable mid-session.
  // Each region only fires for a correction activated through its OWN
  // surface (bar vs. transcript row); a single click can only ever go
  // through one of the two, so nothing is ever announced twice.
  //
  // BUG-3: `{ text, nonce }`, not a plain string. React bails out of
  // re-rendering a mounted node when setState receives a value that is
  // `Object.is`-equal to what's already there — a plain string repeats
  // that equality check on CONTENT, so two corrections that land on the
  // identical sentence (reachable in any two-voice session: the only chip
  // that is ever clickable is the one NOT currently "You", so its label
  // going into the sentence is always "Them" — mark it, identity flips,
  // mark the other one back, and the sentence is byte-identical both
  // times) produce no text change on the live region, hence no
  // announcement at all (see lib/copilot/answerStatus.js's header doc for
  // this exact discipline elsewhere in this app). A fresh object literal is
  // never `Object.is`-equal to the previous one no matter what `text` says,
  // which is what actually guarantees a text change; only `.text` is
  // rendered into the region below, so the sentence read aloud is
  // unaffected — `nonce` never appears in it, it exists purely to make each
  // state value a distinct object.
  const [barAnnouncement, setBarAnnouncement] = useState({ text: "", nonce: 0 });
  const barAnnouncementNonceRef = useRef(0);
  const onAssignFromBar = useCallback(
    (tag, label) => {
      // BUG-2: only announce a REAL application of the correction —
      // onAssignUser (useLiveSession.js) now reports whether a live session
      // existed to apply it to. After Stop it does not (sessionRef.current
      // is null), and this chip would otherwise still be a clickable button
      // (see identityProps below) that announces success for a click that
      // changed nothing.
      if (!onAssignUser(tag)) return;
      barAnnouncementNonceRef.current += 1;
      setBarAnnouncement({
        text: `Marked ${label} as you. Earlier turns from this voice are now labeled You.`,
        nonce: barAnnouncementNonceRef.current,
      });
    },
    [onAssignUser],
  );
  // BUG-3: also cleared at the start of every new session — without this,
  // the FIRST correction of session 2 could repeat session 1's last
  // announcement text verbatim and, by the same identical-string bailout
  // above, say nothing. Wrapped around `start` here (not inside
  // useLiveSession's own `start`, which owns none of CopilotClient's UI-only
  // state) because this Start button is the only caller of `start` in this
  // component — simpler than threading a fourth setter into that hook the
  // way setSetupExpanded/setShowHistory already are for state THAT hook
  // owns.
  const onStartSession = useCallback(() => {
    setBarAnnouncement({ text: "", nonce: 0 });
    start();
  }, [start]);

  // MUI's exclusive ToggleButtonGroup reports `null` when the currently
  // selected button is clicked again — ignore that so the mode can never end
  // up unset. Leaving live mode must not strand a running session: `live`
  // (derived from `status`) is false once the session has errored, but an
  // errored CopilotSession can still be holding the screen-share and mic
  // tracks, so key the teardown off `sessionRef.current` existing, not off
  // `status`.
  const onModeChange = useCallback(
    (val) => {
      if (val !== "live" && val !== "practice") return;
      if (val === "practice" && sessionRef.current) stop();
      setMode(val);
    },
    [stop, sessionRef],
  );

  // The tab option keeps today's wording verbatim; the system option needs
  // different share-dialog instructions plus a note on when to reach for it.
  // AC-M1.5.3: "inperson" has no share dialog at all — mic-only capture via
  // getUserMedia — so neither the tab nor the system wording may render for
  // it; this branch says so instead of describing a picker that never
  // appears for this source.
  const shareInstructions =
    source === "inperson"
      ? // Extra (adversarial review): a period, not an em dash — this
        // codebase's screen-reader rule (see other copilot notices' own
        // comments) is that an em dash is not spoken as a pause at default
        // punctuation settings, so a sentence whose two independent clauses
        // depend on that pause for meaning is a defect, not a style choice.
        "Everyone speaks into your selected microphone. There is no tab or screen to share."
      : source === "system"
        ? 'Share your Entire Screen (with "Share system audio" enabled) and allow your mic — use this when the interview is running in a desktop app (Zoom, Teams, etc.) rather than a browser tab.'
        : 'Share the meeting tab (with "Share tab audio" enabled) and allow your mic.';

  // AC-M1.5.6: TranscriptView's optional identity props — passed only for
  // the in-person source, which is the pinned compatibility gate
  // (TranscriptView treats `onAssignUser`'s mere PRESENCE as "render the
  // correction UI"; leaving it undefined for tab/system is what keeps that
  // mode byte-identical to HEAD, per TranscriptView's own doc). Spread onto
  // both TranscriptView render sites below (live-collapsed and !live).
  //
  // BUG-5: `identityUnsettled` (from useLiveSession) is true from mount —
  // the default snapshot's confidence is "unknown" — and stays true for the
  // rest of the page's idle life, before a session has ever run and again
  // after one ends. Gating the whole bundle on `source` alone let
  // TranscriptView's "Still working out who is who in this conversation"
  // caption render over an idle transcript that had not heard a word yet
  // ("Transcript will appear here once the session starts…" directly under
  // a claim about a conversation that hasn't happened), and again once a
  // session ends. `speakerLabelFor`/`onAssignUser` stay gated on `source`
  // alone as before — BUG-2's fix already makes `onAssignUser` a safe no-op
  // once no session exists, so leaving the correction control reachable
  // post-session is harmless, just inert. Only the CLAIM of unsettled
  // identity needs an extra gate: `live` (a session is running right now)
  // or `speakerSnapshot.tags.length > 0` (at least one voice has actually
  // been observed) — the latter is belt-and-braces given stop() (BUG-2)
  // resets `speakerSnapshot` back to its tags-less default the instant a
  // session ends, so `live` alone already covers every reachable case; kept
  // explicit so this reads correctly on its own, the same discipline
  // useLiveSession.js's own `identityUnsettled` comment already follows for
  // its `!overridden` half.
  const identityProps =
    source === "inperson"
      ? {
          speakerLabelFor,
          identityUnsettled: identityUnsettled && (live || speakerSnapshot.tags.length > 0),
          onAssignUser,
        }
      : {};

  // AC-H6.24/AC-H6.25 (BUG-H5): derived from CURRENT state, not hard-coded,
  // so it can never name a destination that isn't actually receiving data
  // right now. Nothing about a selected posting's documents leaves the
  // browser at all unless a posting is actually selected, so this is empty
  // in that case — no claim, true or false, needs making. Once one is
  // selected: on the embedded engine (isEmbedded, from useEngine — the same
  // source of truth PracticeClient's own notice reads), the route's
  // embedded path never calls Gemini at all (see
  // app/api/copilot/answer/route.js), so this says so explicitly regardless
  // of what useApplicationDocs finds below. On every other engine value,
  // whether anything is actually sent depends on that same load — the one
  // backing the "Submitted for this application" panel: while it is still
  // loading (or has errored), whether a résumé/cover letter even exists for
  // this application is genuinely unknown, so the notice hedges with "may"
  // rather than asserting either way — staying silent instead, while
  // documents might be about to be sent, would be the worse failure. Once
  // the load settles (`docsStatus === "done"`) with neither document found,
  // the route's own `if (resume || coverLetter)` guard
  // (app/api/copilot/answer/route.js) means nothing is actually sent, so
  // the notice falls silent rather than repeating BUG-H5's old (false)
  // blanket claim. And once it settles with something found, this names
  // only the document(s) that actually exist, never both when only one
  // does.
  const hasSubmittedResume = !!docsResume;
  const hasSubmittedCoverLetter = !!docsCoverLetter;
  const docsSettled = docsStatus === "done";
  const postingGroundingNotice = !posting
    ? ""
    : isEmbedded
      ? " The embedded engine drafts talking points on this server with no AI provider, so nothing about this application is sent to Google."
      : !docsSettled
        ? " Because you selected a posting, any résumé or cover letter you submitted for it may also be sent to Google Gemini to ground your talking points."
        : hasSubmittedResume || hasSubmittedCoverLetter
          ? ` Because you selected a posting, ${submittedDocsClause(hasSubmittedResume, hasSubmittedCoverLetter)}.`
          : "";

  // Step 3 (half-window dual-screen fix; R-142): measures `liveWrapperRef`'s
  // real distance from the viewport top instead of predicting it — a
  // prediction goes stale the moment anything above it changes, and no
  // test here can catch that (no jsdom). `dvh` (falls back to `vh`) stops a
  // mobile URL bar pushing the column below the fold; a `resize` listener
  // plus a ResizeObserver on `document.body` catch height changes above.
  const measureLiveHeight = live && !isMobile;
  useEffect(() => {
    const el = liveWrapperRef.current;
    if (!measureLiveHeight || !el) return undefined;
    const measure = () => {
      const dvh = typeof CSS !== "undefined" && CSS.supports?.("height", "1dvh");
      // Trap: getBoundingClientRect().top is viewport-relative, and the ResizeObserver above can fire at any scroll position (an Alert appearing, history expanding, ...); + scrollY converts it to the wrapper's document-relative, scroll-invariant offset instead, which is what this calc actually needs — so no separate scroll listener is warranted either.
      setLiveHeight(`calc(100${dvh ? "dvh" : "vh"} - ${el.getBoundingClientRect().top + window.scrollY}px)`);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [measureLiveHeight]);

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto", p: 3 }}>
      <TabHeader
        title="Interview copilot"
        description={
          mode === "practice"
            ? // "nothing else is recorded or shared" was false: on the Gemini
              // engine, the answer transcript, posting details, and prep
              // context all go to Google for the critique. The detailed
              // notice below (PracticeClient) states exactly what leaves on
              // the current engine — this one-liner defers to it rather
              // than making its own (previously false) blanket claim.
              // F2: the STT destination is only named once it's actually
              // known (see the mount-time fetch above) — never guessed.
              `Practice speaking out loud with your camera and mic — see the notice below for what's sent ${sttProviderName ? `to ${sttProviderName} or Gemini` : "to Gemini"}.`
            : "Live transcription, question detection, and suggested answers during interviews."
        }
      />

      <Stack
        direction="row"
        spacing={1.25}
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          Mode:
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          disabled={live}
          onChange={(_e, val) => onModeChange(val)}
        >
          <ToggleButton value="live" sx={{ textTransform: "none", px: 1.5 }}>
            Live interview
          </ToggleButton>
          <ToggleButton value="practice" sx={{ textTransform: "none", px: 1.5 }}>
            Practice
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {/* AC-J1.5: the microphone selection is owned HERE, not per mode, and
          handed to practice mode as props. It is one piece of hardware and
          one localStorage key (MIC_STORAGE_KEY) shared by both modes: a
          candidate who picks their headset for a live interview should not
          have to pick it again to rehearse, and two independent selections
          under two keys would let the picker in one mode contradict what
          the other is actually recording on. Same reasoning that already
          made `sttProviderName` a prop rather than a second fetch. */}
      {mode === "practice" ? (
        <PracticeClient
          sttProviderName={sttProviderName}
          micDeviceId={micDeviceId}
          onMicDeviceChange={onMicDeviceChange}
        />
      ) : (
        <>
          {/* Step 3: bounded to the remaining viewport height while `live`
              (see the measuring effect above). Below `sm` the page scrolls
              normally — a phone isn't the dual-screen case. `minHeight: 0`
              below is what lets a flex child shrink instead of overflowing. */}
          <Box
            ref={liveWrapperRef}
            sx={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              height: { xs: "auto", sm: live && liveHeight ? liveHeight : "auto" },
              overflow: live ? "hidden" : "visible",
            }}
          >
            {/* shareInstructions and the error/warning Alerts are ordinary
                flex children, not folded into the measured height — the
                ResizeObserver above re-measures if they change the top. */}
            <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
              {shareInstructions} Both sides of the conversation are transcribed
              live; the interviewer&apos;s questions are detected on the right and
              answered automatically.
              {/* AC-M1.5.3: mic-only capture is getUserMedia, which every
                  modern browser supports — the tab/system Chrome-or-Edge
                  caveat (screen/tab capture) does not apply and must not
                  render for "inperson". */}
              {source === "inperson" ? "" : " Chrome or Edge only."}
            </Typography>

            <SessionSetup
              live={live}
              expanded={setupExpanded}
              onToggleExpanded={onToggleSetupExpanded}
              postingSummary={postingSummary}
              micLabel={micLabel}
              source={source}
              onSourceChange={onSourceChange}
              micDeviceId={micDeviceId}
              onMicDeviceChange={onMicDeviceChange}
              showConsent={showConsent}
              onDismissConsent={() => setShowConsent(false)}
              sttProviderName={sttProviderName}
              posting={posting}
              onPostingChange={onPostingChange}
              postingPickerLabel={POSTING_PICKER_LABEL}
              postingPickerBlankHint={POSTING_PICKER_BLANK_HINT}
              postingGroundingNotice={postingGroundingNotice}
              submittedDocs={submittedDocsForSetup}
              profile={profile}
              onProfileChange={onProfileChange}
            />

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

            <Stack
              direction="row"
              spacing={1.5}
              sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
            >
              {live ? (
                <Button variant="outlined" color="error" onClick={stop}>
                  Stop
                </Button>
              ) : (
                // BUG-3: onStartSession, not the bare `start` — see its own
                // comment for why the bar's announcement must not survive
                // into a new session.
                <Button variant="contained" onClick={onStartSession}>
                  Start session
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
                    checked={autoDraft}
                    onChange={(e) => setAutoDraft(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
                    Auto-draft
                  </Typography>
                }
                sx={{ mr: 0.5 }}
              />
              <Button
                size="small"
                variant="text"
                onClick={copyTranscript}
                disabled={finals.length === 0}
              >
                Copy
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={clearAll}
                disabled={finals.length === 0 && questions.length === 0}
              >
                Clear
              </Button>
            </Stack>

            {/* AC-M1.5.9: the speaker-correction control has to be reachable
                WITHOUT expanding the transcript disclosure below — live mode
                collapses `showHistory` by default, and TranscriptView (the
                only other place this control lives) sits entirely inside
                that Collapse. This bar is a sibling of it, in the
                always-rendered part of the tree, so a correction is
                reachable the moment a second voice is heard even while the
                full transcript stays collapsed. Renders nothing until at
                least one voice has actually been observed
                (`speakerSnapshot.tags`), and nothing at all for tab/system,
                which never populate it. Reuses SpeakerChip — the exact same
                control TranscriptView's own rows use — so "mark as me" means
                the same thing and looks the same whichever surface it's
                pressed from. */}
            {source === "inperson" && speakerSnapshot.tags.length > 0 ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 0.75 }}
              >
                <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
                  {identityUnsettled ? "Who's talking (still working out who is who):" : "Who's talking:"}
                </Typography>
                {speakerSnapshot.tags.map((tag) => {
                  const label = speakerLabelFor(tag);
                  const isYou = tag === speakerSnapshot.userTag;
                  return (
                    <SpeakerChip
                      key={tag}
                      label={label}
                      resolved
                      isYou={isYou}
                      // BUG-1: the chip already resolved as the user is not
                      // a control — there is no "mark yourself as yourself"
                      // action. `onActivate: null` is what makes SpeakerChip
                      // render the same non-interactive <Chip> the
                      // tab/system path renders, instead of a self-
                      // contradictory button. Only the OTHER voice's chip
                      // corrects a wrong guess.
                      onActivate={isYou ? null : () => onAssignFromBar(tag, label)}
                    />
                  );
                })}
                {/* BUG-2: mounted unconditionally alongside the bar itself —
                    not only once a correction has actually happened — since
                    a region that mounts already carrying its final text is
                    not reliably announced; only a TEXT CHANGE on an
                    already-mounted node is. Same discipline
                    TranscriptView.js's own region and
                    lib/copilot/answerStatus.js document.
                    BUG-3: only `.text` is rendered — `.nonce` is state-only,
                    never part of the announced sentence (see barAnnouncement's
                    own derivation above). */}
                <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
                  {barAnnouncement.text}
                </Box>
              </Stack>
            ) : null}

            {/* AC-I5: the five-panel dashboard — current question/answer,
                predicted next question/answer, and talking pace. Presentational
                only (every value is a prop from useCopilotDashboard above); does
                NOT replace QuestionFeed below, which stays the full question
                history (AC-I5.30). */}
            {/* Step 3: flex:1/minHeight:0 lets this claim whatever height is
                left after the auto-height items above it; overflow:auto is
                the fallback if even that isn't enough — this scrolls
                internally rather than pushing the page into scrolling
                again, since these panels are exactly what the user asked
                to keep on screen. */}
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <CopilotDashboard
                questions={questions}
                pace={pace}
                fillers={fillers}
                predictedQuestion={predictedQuestion}
                predictionStatus={predictionStatus}
                predictionError={predictionError}
                onRetryPrediction={retryPrediction}
                onRetryPredraft={retryPredraft}
                predictedPoints={predictedPoints}
                predictedCues={predictedCues}
                predictedAnswerStatus={predictedAnswerStatus}
                predictedAnswerError={predictedAnswerError}
              />
            </Box>
          </Box>

          {/* Step 4: transcript + question history — the tallest content on
              this page, and the region the user left out of the
              always-visible set. Same disclosure pattern as SessionSetup's,
              collapsed by default per session, only while `live` (otherwise
              unchanged from today). Kept OUTSIDE the bounded wrapper so
              opting in is free to scroll — only DEFAULT scrolling must stop. */}
          {live ? (
            <>
              <Button
                size="small"
                variant="text"
                onClick={onToggleHistory}
                aria-expanded={showHistory}
                aria-controls={HISTORY_REGION_ID}
                sx={{ mt: 2, color: "var(--text-secondary)", textTransform: "none" }}
              >
                {showHistory
                  ? "▾ Hide transcript and question history"
                  : "▸ Show transcript and question history"}
              </Button>
              <Collapse in={showHistory}>
                <Stack
                  id={HISTORY_REGION_ID}
                  direction={{ xs: "column", md: "row" }}
                  spacing={2}
                  sx={{ alignItems: "stretch", mt: 2 }}
                >
                  <TranscriptView
                    finals={finals}
                    interims={interims}
                    startedAt={startedAt}
                    {...identityProps}
                  />
                  <QuestionFeed questions={questions} onDraft={onDraft} />
                </Stack>
              </Collapse>
            </>
          ) : (
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              sx={{ alignItems: "stretch", mt: 2 }}
            >
              <TranscriptView
                finals={finals}
                interims={interims}
                startedAt={startedAt}
                {...identityProps}
              />
              <QuestionFeed questions={questions} onDraft={onDraft} />
            </Stack>
          )}
        </>
      )}
    </Box>
  );
}
