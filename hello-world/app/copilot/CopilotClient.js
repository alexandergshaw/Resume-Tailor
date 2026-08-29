"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { fmtClock } from "@/lib/copilot/clock";
import { postingGroundingNotice as _postingGroundingNotice } from "@/lib/copilot/groundingNotice";
import { shareInstructionsFor } from "@/lib/copilot/captureNotices";
import { identityPropsFor } from "@/lib/copilot/identityProps";
import { briefStatusMessage } from "@/lib/copilot/companyBrief";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { useEngine } from "@/app/settings/engine";
import { useIsMobile } from "@/app/hooks/useResponsive";
import TabHeader from "@/app/components/TabHeader";
import LiveHearingStrip from "./LiveHearingStrip";
import TranscriptDisclosure from "./TranscriptDisclosure";
import ManualQuestion from "./ManualQuestion";
import StatusPill from "./StatusPill";
import SessionSetup from "./SessionSetup";
import SpeakerBar from "./SpeakerBar";
import VoiceCueSidebar from "./VoiceCueSidebar";
import CompanyBriefPanel from "./CompanyBriefPanel";
import { TOUCH_TARGET_SX, TOUCH_SWITCH_SX } from "./mobileSx";
import CopilotDashboard from "./dashboard/CopilotDashboard";
import PracticeClient from "./practice/PracticeClient";
import RoleDrillClient from "./roles/RoleDrillClient";
import ModeSwitch from "./ModeSwitch";
import { usePrepContext } from "./usePrepContext";
import { useApplicationDocs } from "./useApplicationDocs";
import { useCopilotDashboard } from "./useCopilotDashboard";
import { useLiveSession } from "./useLiveSession";
import { useCaptureSetup } from "./useCaptureSetup";
import { useCompanyBrief } from "./useCompanyBrief";
import { useLiveColumnHeight } from "./useLiveColumnHeight";
import { useInterviewType, useInterviewTypeChange, getInterviewTypeStorageBlocked } from "./useInterviewType";
import { useCodeLanguage } from "./useCodeLanguage";
import { useLiveCodeLanguageChange } from "./useLiveCodeLanguageChange";
import { interviewTypeLabel } from "@/lib/copilot/interviewTypes";
import {
  invalidateLiveAnswers,
  interviewTypeChangeAnnouncement,
  joinInterviewTypeAnnouncements,
  claimStorageAnnouncement,
} from "@/lib/copilot/choiceChangeInvalidation";

// I1: 280px rail + a usable main column needs 824px minimum, so the
// breakpoint is `md` (900), not `sm`. `noSsr: true` matches useIsMobile/useIsTablet.
function useIsRailBelowMd() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("md"), { noSsr: true });
}

// AC-H1.2: live mode's own wording for the shared PostingPicker — its
// defaults are practice mode's exact strings, so passing these explicitly
// here is what keeps the two modes worded differently without touching
// PostingPicker's defaults (which practice mode still relies on).
const POSTING_PICKER_LABEL = "Interviewing for";
const POSTING_PICKER_BLANK_HINT = "Leave blank to keep talking points grounded in your prep context only.";
// F2: display name for whichever speech-to-text provider the server has
// selected (STT_PROVIDER, see lib/config/env.js's getSttProvider) — kept
// here, keyed off the token response's `provider` field, rather than
// hardcoded into the notices below, so they can never claim a destination
// that isn't actually receiving the audio (AC-F2-5).
const STT_PROVIDER_NAMES = { deepgram: "Deepgram", elevenlabs: "ElevenLabs" };

// Phase 4: assemble the interviewer's speech into complete utterances (on
// Deepgram's speech_final endpoint), confirm/normalize questions with an LLM
// (heuristic pre-filter avoids calling it on trivial fragments), and auto-draft
// talking points as soon as a question is detected.
export default function CopilotClient() {
  const [mode, setMode] = useState("live"); // "live" | "practice" | "roles"
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
  // A6: the shared interview type (contract 2) — one store, read by both
  // the live and practice surfaces.
  const { interviewType, setInterviewType } = useInterviewType();
  // AC-C1/AC-C4: the shared code-language control (chunk C) — mirrors the
  // line above; a second, independent store (app/copilot/useCodeLanguage.js).
  const { codeLanguage, setCodeLanguage } = useCodeLanguage();
  // AC-H1: the tracked posting selected for this live session, if any — the
  // same picker practice mode has, feeding both the "Submitted for this
  // application" panel and the grounding documents draftAnswer sends along
  // (see onPostingChange/runDraft below).
  const [posting, setPosting] = useState(null);
  // Interviewer-audio-source and microphone SETUP — seed-from-storage,
  // persist-on-change, and the derived availability facts SessionSetup
  // needs — lives in useCaptureSetup (split out to keep this file under the
  // 1000-line cap). Everything here that merely READS `source` afterwards
  // stays below; this destructure just renames the two derived
  // availability fields back to their original local names.
  const {
    source,
    onSourceChange,
    micDeviceId,
    onMicDeviceChange,
    micLabel,
    sourceAvailability: interviewerSourceAvailability,
    sourceUnavailableReason: interviewerSourceUnavailableReason,
  } = useCaptureSetup();
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
  const isMobile = useIsMobile();

  // AC-N1.5: normalized question -> { points, type, cues, buzzwords, anchor,
  // idealProject, pageSources, profile, interviewType, applicationId } — the
  // reading aids (AC-K1, extended by ARCH §3.5/§4f's `pageSources`) and the
  // grounding the draft was actually built from (AC-N1.2) both landed here
  // since this comment was last accurate; runDraft, inside useDraftAnswer.js
  // (called from useLiveSession.js), is the sole writer, and stores every
  // field a read (via answerGrounding.js's cachedAnswerFor) needs to decide
  // whether an entry still applies.
  const answerCacheRef = useRef(new Map());
  // AC-N1.3: bumped whenever the posting or prep context changes (below) or
  // a fresh session starts (useLiveSession.js's `start`) — see runDraft's
  // own comment for why the cache alone (AC-N1.2) can't guard its OTHER
  // write, the one straight onto the visible question card.
  const draftGenRef = useRef(0);

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

  // AC-Q10.4/AC-R1.11: the "Speak as" one-liner. BUG (privacy audit):
  // embedded branch used to claim recording itself "runs on this server" —
  // false, lib/copilot/stt/ streams audio to Deepgram/ElevenLabs on EVERY
  // engine; only feedback generation is local, so the guarantee is scoped.
  const roleModeDescription = isEmbedded
    ? "Answer a workplace situation out loud in a professional role’s register, then record yourself answering it and reveal a model answer for its cadence and vocabulary — the model answer is generated on this server with no AI provider, so nothing is sent to Google. Recording still sends your audio to a speech-to-text provider, and once you press Done, sends it here for feedback — see the notice above the recording controls for what is sent, and where."
    : `Answer a workplace situation out loud in a professional role’s register, then record yourself answering it and reveal a model answer for its cadence and vocabulary. Recording sends audio${sttProviderName ? ` to ${sttProviderName}` : ""} for transcription and, once you press Done, sends it for feedback to Google Gemini — see the notice above the recording controls for exactly what that sends. Revealing a model answer also sends the role and the situation text to Google.`;

  const isRailBelowMd = useIsRailBelowMd();

  // T2: created before useLiveSession below — its `onCompanyCue` input needs
  // `companyBrief.openBrief` to already exist. Fires no request on mount or
  // on a posting change, only from openBrief()/refresh().
  const companyBrief = useCompanyBrief(posting);
  const hasCompany = !!String(posting?.company || "").trim();
  // I8: moved up (step-9c-iii) so the change handlers below can put it in their own deps, TDZ-free.
  const briefArticleCount = Array.isArray(companyBrief.articles) ? companyBrief.articles.length : 0;
  const briefLiveText = companyBrief.open
    ? briefStatusMessage({
        status: companyBrief.status,
        count: briefArticleCount,
        company: companyBrief.company,
        error: companyBrief.error,
      })
    : "";

  // Prep context (seed-from-storage/fallback/persist) lives in
  // usePrepContext — this wraps its setter to also drop the answer cache:
  // prior answers were grounded in the old background, so they must not
  // survive an edit to it (that cache-clearing logic is specific to the
  // live session's auto-draft flow, not something the shared hook should
  // know about). AC-N1.3: also bumps draftGenRef — the cache clear alone
  // stops a stale entry from being SERVED later (and AC-N1.2's grounding
  // comparison would catch that on its own regardless), but it does nothing
  // about a draft already in flight against the OLD profile that is about to
  // land directly on a question card via useLiveSession.js's runDraft — see
  // that function's own comment for why that write needs its own guard.
  const onProfileChange = useCallback(
    (val) => {
      answerCacheRef.current.clear();
      draftGenRef.current += 1;
      setProfileRaw(val);
    },
    [setProfileRaw],
  );

  // AC-H1.4: changing OR clearing the selected posting clears the answer
  // cache for the same reason onProfileChange above does — every cached
  // draft was grounded in the OLD posting's documents (or the lack of any),
  // and must not be served once the selection has moved on. Covers both
  // "changing" and "clearing" since PostingPicker calls onChange with
  // `null` for the latter. AC-N1.3: bumps draftGenRef too — see
  // onProfileChange's own comment just above for why.
  const onPostingChange = useCallback((newPosting) => {
    answerCacheRef.current.clear();
    draftGenRef.current += 1;
    setPosting(newPosting);
  }, []);

  // AC-N1.4 (defense in depth for BUG 3): usePrepContext is a real external
  // store (see usePrepContext.js's own header) — an edit made from PRACTICE
  // mode's own editor (PracticeClient's `setProfile`, never this
  // component's onProfileChange wrapper above) still lands in `profile`
  // here through the shared subscription, but nothing clears answerCacheRef
  // for that path. The load-bearing fix for a stale entry actually being
  // SERVED is AC-N1.2's grounding comparison on read (runDraft already
  // rejects an entry whose stored `profile` differs from the current one,
  // regardless of which editor changed it) — this effect is only about not
  // letting the cache keep growing entries that can never hit again once
  // the prep context has moved on, from EITHER editor.
  useEffect(() => {
    answerCacheRef.current.clear();
  }, [profile]);

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

  const live = status === "live" || status === "connecting";

  // I3: the rail auto-collapses once live and auto-expands once idle again
  // (AC-T3.5: learnable before Start, then out of the dashboard's way) — the
  // sidebar's own toggle can still override this within a session. Same
  // render-phase state-adjustment idiom CopilotDashboard.js's
  // useCurrentQuestionAnnouncement uses — not an effect (react-hooks/
  // set-state-in-effect) and not a ref (react-hooks/refs forbids `.current`
  // reads during render).
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [prevLiveForRail, setPrevLiveForRail] = useState(live);
  if (live !== prevLiveForRail) {
    setPrevLiveForRail(live);
    setRailCollapsed(live);
  }
  const onToggleRailCollapsed = useCallback(() => setRailCollapsed((v) => !v), []);

  // Step 2/4: disclosure toggles — click handlers, not effects, so these
  // are the only place besides start/stop that setupExpanded/showHistory
  // ever change outside a per-session reset.
  const onToggleSetupExpanded = useCallback(() => setSetupExpanded((v) => !v), []);
  const onToggleHistory = useCallback(() => setShowHistory((v) => !v), []);

  // Step 2: the two facts SessionSetup's collapsed summary keeps visible.
  const postingSummary = posting?.title || "No posting selected";

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

  // AC-I2/AC-N1: live mode's dashboard — talking pace and verbal-filler
  // reading, backing LiveHearingStrip's delivery strip below.
  const { pace, fillers, recordSpeechSample, resetForSession } = useCopilotDashboard();

  // AC-T1.18/E4: declines (and reports it) when no posting is selected at
  // all, the same way pinCurrentQuestion declines with no question yet
  // (AC-T1.14). A posting with no company still opens the panel, which
  // explains that itself (CompanyBriefPanel's own idle/no-company branch).
  const onCompanyCue = useCallback(() => {
    if (!posting) return false;
    companyBrief.openBrief();
    return true;
  }, [posting, companyBrief]);

  const [staleTypeChangeAt, setStaleTypeChangeAt] = useState(0); // Contract 8, hoisted for a stable onCurrentEntryRedrafted below.
  const onCurrentEntryRedrafted = useCallback(() => setStaleTypeChangeAt(0), []);

  const {
    warning,
    setWarning,
    error,
    finals,
    interims,
    startedAt,
    liveSince, // D2: LiveHearingStrip's second clock — see useLiveSession.js's own doc.
    now,
    elapsed,
    stop,
    start,
    onDraft,
    redraftCurrentAnswer,
    addManualQuestion,
    clearAll,
    copyTranscript,
    // AC-M1.5.6/5.8/5.9: the in-person speaker-identity surface — see the
    // identityProps/correction-bar derivations below for how these feed
    // TranscriptView and the always-reachable correction control.
    speakerSnapshot,
    speakerLabelFor,
    identityUnsettled,
    onAssignUser,
    // AC-V2.1/V2.6: the structured attribution axis — handed straight to
    // VoiceCueSidebar so its degraded-state disclosure reads off the same
    // module useLiveSession.js enforces the policy through.
    speakerAttribution,
    sessionRef,
    downloadLog,
    // D7: a real, reactive boolean — backs the "Download session log"
    // control's disabled state below, replacing a per-render deep clone of
    // the whole log (see this variable's old derivation, removed).
    sessionLogHasEvents,
    // AC-T1.16..T1.18: the pin/hold surface, read by CopilotDashboard's held
    // treatment and QuestionFeed's held region.
    pinnedId,
    newerQuestionCount: pinnedNewerCount,
    held,
    pinCurrentQuestion,
    unpinQuestion,
    cueAnnouncement = { text: "" }, // I10: voice-only; defaulted for older mocks.
  } = useLiveSession({
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
    onCompanyCue,
    onCurrentEntryRedrafted, // MATERIAL-3: clears the caption below on redraft.
  });

  // Contract 7/8: this surface's own announcement and practice's own.
  const [typeAnnouncement, setTypeAnnouncement] = useState("");
  const [practiceTypeAnnouncement, setPracticeTypeAnnouncement] = useState("");
  const announcedStorageBlockRef = useRef(false); // AC-A15b: once per tab; touched in the handler only.
  // Step-9c-iii: each slot's ambient "cue|brief" signature when SET, compared
  // at render time near the join — see joinInterviewTypeAnnouncements's doc.
  const [typeAmbientAtSet, setTypeAmbientAtSet] = useState("");
  const [practiceAmbientAtSet, setPracticeAmbientAtSet] = useState("");

  // C.2: the ONE live-surface subscriber (closes over redraftCurrentAnswer).
  // AC-A15b: canRedraft reads render-scope `mode`, listed below.
  const onInterviewTypeChanged = useCallback(
    (next, prev, meta) => {
      const blocked = getInterviewTypeStorageBlocked();
      // BLOCKER-1: claim ONLY when this text is actually spoken (same
      // predicate the join uses) — else it silences the other surface.
      const announceBlocked = blocked && mode === "live" && !announcedStorageBlockRef.current;
      if (announceBlocked) announcedStorageBlockRef.current = true;
      invalidateLiveAnswers({
        clearAnswerCache: () => answerCacheRef.current.clear(),
        bumpDraftGeneration: () => {
          draftGenRef.current += 1;
        },
        redraftCurrentAnswer,
        canRedraft: meta.origin === "local" && mode === "live",
      });
      // Contract 8: a foreign change may leave an on-screen card drafted
      // under the old type — CurrentAnswerPanel dims it once its own `at`
      // predates this timestamp.
      if (meta.origin === "foreign") setStaleTypeChangeAt(Date.now());
      setTypeAnnouncement(
        interviewTypeChangeAnnouncement({
          surface: "live",
          origin: meta.origin,
          label: interviewTypeLabel(next),
          hadRecording: false,
          hadReview: false,
          storageBlocked: announceBlocked,
        }),
      );
      setTypeAmbientAtSet(`${cueAnnouncement.text}|${briefLiveText}`);
    },
    [mode, redraftCurrentAnswer, cueAnnouncement.text, briefLiveText],
  );
  useInterviewTypeChange(onInterviewTypeChanged);

  // AC-C25/CONF-1: the code-language subscriber, in its own module (D-1, D-2)
  // — origin-blind, unlike the interview-type one above, since a language
  // change destroys nothing for a foreign click to protect (see that
  // module's own header). R-3 (a11y finding 2, HIGH): `onForeignChange`
  // reports a foreign change with nothing local to explain it; local stays
  // silent, like the live/local row above (stable callbacks below — F5).
  useLiveCodeLanguageChange({
    canRedraft: mode === "live",
    clearAnswerCache: useCallback(() => answerCacheRef.current.clear(), []),
    bumpDraftGeneration: useCallback(() => { draftGenRef.current += 1; }, []),
    redraftCurrentAnswer,
    onForeignChange: useCallback(
      (text) => {
        setTypeAnnouncement(text);
        setTypeAmbientAtSet(`${cueAnnouncement.text}|${briefLiveText}`);
      },
      [cueAnnouncement.text, briefLiveText],
    ),
  });

  // MATERIAL-1: filters PracticeClient's text through the SAME latch above.
  const onPracticeTypeAnnouncement = useCallback(
    (text) => {
      setPracticeTypeAnnouncement(claimStorageAnnouncement(text, announcedStorageBlockRef));
      setPracticeAmbientAtSet(`${cueAnnouncement.text}|${briefLiveText}`);
    },
    [cueAnnouncement.text, briefLiveText],
  );

  // BUG-3: bumped on every new session and handed to SpeakerBar (which now
  // owns the who's-talking announcement) as `sessionNonce` — without this, a
  // correction in session 2 could repeat session 1's last announcement
  // verbatim and, by the bailout SpeakerBar's own comment explains, say
  // nothing. Wrapped around `start` here, the only caller of it in this file.
  const [sessionNonce, setSessionNonce] = useState(0);
  const onStartSession = useCallback(() => {
    setSessionNonce((n) => n + 1);
    start();
  }, [start]);

  // ModeSwitch already swallows MUI's null-on-re-click report; the allowlist
  // below is kept anyway — it defends something different: an unrecognized
  // `val` reaching `setMode` (e.g. a future 4th button with no render
  // branch) would silently fall through to the live column while the toggle
  // shows the new mode selected, instead of the no-op this used to be.
  // Leaving live mode — for "practice" OR "roles" (AC-Q10.2) — must not
  // strand a running session: `live` (from `status`) is false once errored,
  // but an errored CopilotSession can still hold the screen-share/mic
  // tracks, so teardown is keyed off `sessionRef.current`, not `status`.
  const onModeChange = useCallback(
    (val) => {
      if (val !== "live" && val !== "practice" && val !== "roles") return;
      if ((val === "roles" || val === "practice") && sessionRef.current) stop();
      // MATERIAL-2: closes the one gap the ambient check alone can't — a round trip back to the SAME mode.
      setTypeAnnouncement("");
      setPracticeTypeAnnouncement("");
      setMode(val);
    },
    [stop, sessionRef],
  );

  const shareInstructions = shareInstructionsFor(source);

  // AC-M1.5.6/BUG-5: TranscriptView's optional identity props — the
  // in-person-only compatibility gate plus the extra `identityUnsettled`
  // gate that stops it claiming unsettled identity over an idle transcript
  // that never heard a word. Moved to lib/copilot/identityProps.js (pure, no
  // React) for this file's line budget — see that module for the full
  // history this comment used to carry. Spread onto both TranscriptView
  // render sites below (live-collapsed and !live).
  const identityProps = identityPropsFor({
    source,
    speakerLabelFor,
    identityUnsettled,
    live,
    speakerSnapshot,
    onAssignUser,
  });

  // AC-H6.24/AC-H6.25 (BUG-H5): moved to lib/copilot/groundingNotice.js — see
  // that module's own doc. Called with CURRENT state on every render, so it
  // can never name a destination not actually receiving data right now.
  const postingGroundingNotice = _postingGroundingNotice({
    posting,
    isEmbedded,
    docsStatus,
    resume: docsResume,
    coverLetter: docsCoverLetter,
    hasCompany, // Defect 1 fix: same fact VoiceCueSidebar reads — see groundingNotice.js.
  });

  // Step 3/AC-X1: the bounded live column's ref and measured height now live
  // in useLiveColumnHeight.js — see that hook's own doc for the R-142
  // reasoning. `live && !isMobile` is CopilotClient's own call on WHEN the
  // column needs bounding at all.
  const { liveWrapperRef, liveHeight } = useLiveColumnHeight(live && !isMobile);

  // I10: a click already changes the pin button's `aria-pressed` on its
  // own, so this never calls announceCue — that stays useLiveSession's job,
  // fired only for a speech-matched change. "company" opens the same brief
  // a spoken cue opens (onCompanyCue above).
  const onCueActivate = useCallback(
    (action) => {
      if (action === "pin") pinCurrentQuestion();
      else if (action === "unpin") unpinQuestion();
      else if (action === "company") companyBrief.openBrief();
    },
    [pinCurrentQuestion, unpinQuestion, companyBrief],
  );

  // MATERIAL-1/step-9c-iii: see joinInterviewTypeAnnouncements's own doc.
  const [liveTypeText, practiceTypeText] = joinInterviewTypeAnnouncements({
    mode,
    live: typeAnnouncement,
    practice: practiceTypeAnnouncement,
    liveAmbientAtSet: typeAmbientAtSet,
    practiceAmbientAtSet,
    cueText: cueAnnouncement.text,
    briefText: briefLiveText,
  });
  const consolidatedLiveText = [cueAnnouncement.text, briefLiveText, liveTypeText, practiceTypeText]
    .filter(Boolean)
    .join(" ");

  // I11: the brief panel takes over the rail's slot rather than opening beside it (no room for both — I1).
  const railContent = companyBrief.open ? (
    <CompanyBriefPanel
      status={companyBrief.status}
      articles={companyBrief.articles}
      warnings={companyBrief.warnings}
      error={companyBrief.error}
      company={companyBrief.company}
      onRefresh={companyBrief.refresh}
      onBack={companyBrief.closeBrief}
      isEmbedded={isEmbedded}
    />
  ) : (
    <VoiceCueSidebar
      collapsed={railCollapsed}
      onToggleCollapsed={onToggleRailCollapsed}
      pinned={held}
      onActivate={onCueActivate}
      isEmbedded={isEmbedded}
      hasCompany={hasCompany}
      speakerAttribution={speakerAttribution}
      // AC-V2.8: the rail's disclosure is a permission statement, and the
      // attribution flag alone under-claims (see cuePolicy.js's
      // `effectiveAttribution`). The same snapshot TranscriptView and the
      // correction bar already render is the evidence that keeps this rail
      // from calling cues button-only in a session that can separate voices.
      speakerSnapshot={speakerSnapshot}
    />
  );

  return (
    <Box sx={{ maxWidth: 1180, mx: "auto", p: { xs: 1.5, sm: 3 } }}>
      {/* I8: consolidated pin/brief live region, mounted empty, never
          conditionally rendered — only its text ever changes. */}
      <Box component="span" role="status" aria-live="polite" data-testid="copilot-consolidated-live-region" sx={visuallyHidden}>
        {consolidatedLiveText}
      </Box>

      <TabHeader
        title="Interview copilot"
        description={
          mode === "roles"
            ? roleModeDescription
            : mode === "practice"
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

      <ModeSwitch value={mode} onChange={onModeChange} disabled={live} />

      {/* AC-J1.5: the microphone selection is owned HERE, not per mode, and
          handed to both practice and roles mode as props — one piece of
          hardware and one localStorage key (MIC_STORAGE_KEY), so a headset
          picked for a live interview needn't be picked again to rehearse,
          and two independent selections under two keys couldn't disagree
          about what's actually recording. Same reasoning already made
          `sttProviderName` a prop rather than a second fetch. */}
      {mode === "roles" ? (
        // AC-Q10.3/AC-R1: instead of the live column/PracticeClient — no
        // session setup, no dashboard, no voice-cue rail. RoleDrillClient
        // owns its own role/situation/reveal AND answer-recording state; the
        // props below are the shared-hardware/STT-name facts PracticeClient
        // gets below, for the same reason (AC-J1.5, F2).
        <RoleDrillClient
          sttProviderName={sttProviderName}
          micDeviceId={micDeviceId}
          onMicDeviceChange={onMicDeviceChange}
        />
      ) : mode === "practice" ? (
        <PracticeClient
          sttProviderName={sttProviderName}
          micDeviceId={micDeviceId}
          onMicDeviceChange={onMicDeviceChange}
          // Contract 7: practice knows the facts (a recording in flight, a
          // review on screen) that decide ITS OWN announcement text; this is
          // where that text arrives to be joined into consolidatedLiveText.
          onInterviewTypeAnnouncement={onPracticeTypeAnnouncement}
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
              overflow: { xs: "visible", sm: live ? "hidden" : "visible" },
            }}
          >
            {/* D1: the single most important signal on the page, at the
                very top of the bounded, no-scroll wrapper — above
                SessionSetup, above the dashboard, above everything. It used
                to render OUTSIDE this wrapper entirely (only inside
                `{live ? ... : ...}`, itself below the wrapper's own closing
                tag), which put it below the fold on desktop by
                construction: a working copilot and a completely deaf one
                looked identical on the default screen, and R-142's
                no-scroll requirement was broken for the one element that
                exists to prove the session is alive. Rendered unconditionally
                (not gated on `live`) — it renders nothing visible while
                `!live` (see its own component), but D5 needs it MOUNTED
                before a session ever starts so its hidden live regions are
                already in the DOM the instant they have their first
                sentence to announce. */}
            <LiveHearingStrip
              live={live}
              finals={finals}
              interims={interims}
              startedAt={startedAt}
              liveSince={liveSince}
              now={now}
              speakerSnapshot={speakerSnapshot}
              source={source}
            />

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
              isEmbedded={isEmbedded} // Defect 2 fix: see SessionSetup.js's own recording notice.
              sourceAvailability={interviewerSourceAvailability}
              sourceUnavailableReason={interviewerSourceUnavailableReason}
              micDeviceId={micDeviceId}
              onMicDeviceChange={onMicDeviceChange}
              showConsent={showConsent}
              onDismissConsent={() => setShowConsent(false)}
              sttProviderName={sttProviderName}
              interviewType={interviewType}
              onInterviewTypeChange={setInterviewType}
              interviewTypeLabel={interviewTypeLabel(interviewType)}
              codeLanguage={codeLanguage}
              onCodeLanguageChange={setCodeLanguage}
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
                <Button variant="outlined" color="error" onClick={stop} sx={TOUCH_TARGET_SX}>
                  Stop
                </Button>
              ) : (
                // BUG-3: onStartSession, not the bare `start` — see its own
                // comment for why the bar's announcement must not survive
                // into a new session.
                <Button variant="contained" onClick={onStartSession} sx={TOUCH_TARGET_SX}>
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
              <Box sx={{ flex: 1, display: { xs: "none", sm: "block" } }} />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={autoDraft}
                    onChange={(e) => setAutoDraft(e.target.checked)}
                    sx={TOUCH_SWITCH_SX}
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
                sx={TOUCH_TARGET_SX}
              >
                Copy
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={clearAll}
                disabled={finals.length === 0 && questions.length === 0}
                sx={TOUCH_TARGET_SX}
              >
                Clear
              </Button>
              {/* AC-Q6.8/D6: one button, one file, no confirmation, no format
                  menu; this row renders both while `live` and after Stop. No
                  Tooltip (mui-a11y-traps: it would steal or rename this
                  button's visible name). D6: the disabled reason used to
                  live ONLY as an `aria-label` on this natively-disabled
                  button — out of the tab order, so neither a keyboard/
                  screen-reader user nor a sighted user (a greyed button with
                  no visible text at all) could ever reach it. Mirrors
                  practice/PracticeControls.js's own "Download session log"
                  control exactly: `aria-describedby` pointing at a sibling
                  VISIBLE caption, rendered under the same condition, so
                  every user gets the same explanation through whichever
                  channel they're using. Renamed to "Download session log" —
                  the old "Download log" name meant practice mode and live
                  mode named the same feature two different things. */}
              <Button
                size="small"
                variant="text"
                onClick={downloadLog}
                disabled={!sessionLogHasEvents}
                aria-describedby={sessionLogHasEvents ? undefined : "live-download-log-reason"}
                sx={TOUCH_TARGET_SX}
              >
                Download session log
              </Button>
              {!sessionLogHasEvents ? (
                <Typography id="live-download-log-reason" variant="caption" sx={{ color: "var(--text-muted)" }}>
                  Available once the session has recorded something.
                </Typography>
              ) : null}
            </Stack>

            {/* AC-M1.5.9/AC-X1: the speaker-correction bar — split out to
                SpeakerBar.js (see its own module doc for the full
                reasoning). It keeps its own `source === "inperson" &&
                tags.length > 0` gate, so this stays a single unconditional
                call. `sessionNonce` lets it reset its announcement at the
                start of a new session — see onStartSession above. */}
            <SpeakerBar
              source={source}
              speakerSnapshot={speakerSnapshot}
              speakerLabelFor={speakerLabelFor}
              identityUnsettled={identityUnsettled}
              onAssignUser={onAssignUser}
              sessionNonce={sessionNonce}
            />

            {/* AC-O2: reachable WITHOUT expanding "Show transcript and
                question history" below — that disclosure is collapsed by
                default for every session and QuestionFeed lives entirely
                inside it, so putting this control next to the feed would
                hide it exactly when it's most needed. A sibling of the
                dashboard instead, inside the same bounded live wrapper,
                right after the who's-talking bar above.

                Rendered in BOTH live and idle states — never gated on
                `live`. The realistic reason to type a question is that
                detection missed it, or the interviewer is on a channel this
                tab can't hear, and that's exactly as true before Start as
                during a session.

                helperText only while `!live`: commit 5258564 made live mode
                fit the viewport without scrolling (see the `liveHeight`
                measuring effect above) — a permanent row spent on a
                sentence already read by the time a session starts would eat
                into that same budget for nothing. */}
            <Box sx={{ mb: 2 }}>
              <ManualQuestion
                onSubmit={addManualQuestion}
                label="Type a question the interviewer asked"
                buttonLabel="Add"
                confirmLabel="Added to detected questions"
                helperText={
                  live
                    ? undefined
                    : "It joins the detected questions and gets an answer drafted, just like one the copilot hears."
                }
              />
            </Box>

            {/* AC-I5: the dashboard — current question/answer and talking pace.
                Presentational only (every value is a prop from
                useCopilotDashboard above); does NOT replace QuestionFeed
                below, which stays the full question history (AC-I5.30). */}
            {/* Step 3: flex:1/minHeight:0 lets this claim whatever height is
                left after the auto-height items above it; overflow:auto is
                the fallback if even that isn't enough — this scrolls
                internally rather than pushing the page into scrolling
                again, since these panels are exactly what the user asked
                to keep on screen. */}
            {/* I1: at `md`+ the rail sits INSIDE this bounded column beside
                the dashboard (own scroll container, below); below `md` it
                renders outside the column entirely (just past its close),
                like TranscriptDisclosure, reachable by scroll not clipped. */}
            <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", gap: 2 }}>
              <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <CopilotDashboard
                  questions={questions}
                  pinnedId={pinnedId}
                  held={held}
                  live={live} // Defect 3 fix: gates the held panel's "still running" caption.
                  newerQuestionCount={pinnedNewerCount}
                  onReleasePin={unpinQuestion}
                  pace={pace}
                  fillers={fillers}
                  staleTypeChangeAt={staleTypeChangeAt}
                />
              </Box>
              {!isRailBelowMd ? <Box sx={{ overflowY: "auto", minHeight: 0 }}>{railContent}</Box> : null}
            </Box>
          </Box>

          {isRailBelowMd ? <Box sx={{ mt: 2 }}>{railContent}</Box> : null}

          {/* D1/AC-S3.11: split into its own file (TranscriptDisclosure.js)
              purely to keep this file under the 1000-line cap — see that
              component's own module doc for the full D1 reasoning (why
              <QuestionFeed> moved back inside this disclosure, alongside
              <TranscriptView>, rather than staying "unconditional" inside
              the bounded wrapper above, where it was actually clipped
              off-screen on desktop). Rendered OUTSIDE that bounded wrapper
              so opting in to either is free to scroll. */}
          <TranscriptDisclosure
            live={live}
            showHistory={showHistory}
            onToggleHistory={onToggleHistory}
            finals={finals}
            interims={interims}
            startedAt={startedAt}
            identityProps={identityProps}
            questions={questions}
            onDraft={onDraft}
            pinnedId={pinnedId}
            held={held}
            newerQuestionCount={pinnedNewerCount}
          />
        </>
      )}
    </Box>
  );
}
