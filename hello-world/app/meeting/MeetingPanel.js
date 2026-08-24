"use client";

// The composition: the one component that wires the meeting copilot's
// capture hook (useMeetingSession), its insight loop (useMeetingInsights),
// and its two presentational views (MeetingTranscript, MeetingInsightList)
// together, and turns a finished meeting into a saved Experience page. Every
// piece it touches has its own suite; this file's whole job is proving they
// are actually wired to each other, and that a meeting's end is one action,
// not a sequence that can lose the meeting if a step after the mic stops
// fails.
//
// Collapsed until used, expands in place once a meeting is running, and
// never replaces the page tree beside it — this panel owns exactly the
// state described below and nothing about the Experience page list itself.

import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMeetingSession } from "./useMeetingSession.js";
import { useMeetingInsights } from "./useMeetingInsights.js";
import MeetingTranscript from "./MeetingTranscript.js";
import MeetingInsightList from "./MeetingInsightList.js";
import { buildMeetingPage } from "@/lib/meeting/meetingPage.js";
import {
  recordingConsentNotice,
  engineCaveatNotice,
  meetingSttProviderName,
} from "@/lib/meeting/meetingNotices.js";
import {
  DEFAULT_INTERVIEWER_SOURCE,
  displayCaptureSupported,
  resolveInterviewerSource,
} from "@/lib/copilot/captureSupport.js";
import { readEngine } from "@/app/settings/engine.js";

// Mirrors app/copilot/useCaptureSetup.js's own SOURCE_STORAGE_KEY exactly —
// duplicated rather than imported, the same call meetingNotices.js already
// made for CopilotClient.js's STT_PROVIDER_NAMES: that hook is shaped for
// the interview copilot's own source PICKER (onSourceChange, mic-device
// state, its own persistence writes), none of which this panel needs. A
// two-line storage key is a smaller dependency than pulling that hook in,
// and a future third copy of this key would be the real signal to hoist it,
// not this second one.
const SOURCE_STORAGE_KEY = "copilot-audio-source";

export default function MeetingPanel({ pageId, onMeetingSaved }) {
  // The interviewer-audio source THIS panel resolved and owns — passed INTO
  // useMeetingSession (which has no opinion of its own on where it came
  // from) and back OUT to MeetingTranscript for its attribution notice.
  // Seeded with the same optimistic default useCaptureSetup.js uses, then
  // refined below once the real device capability is known.
  const [source, setSource] = useState(DEFAULT_INTERVIEWER_SOURCE);
  // A fresh id per meeting — see handleStart. This is the value that stops
  // a straggling insight read from a PREVIOUS meeting landing in a new one:
  // useMeetingInsights resets all of its own pacing/dedup bookkeeping
  // whenever this changes (see that hook's own `sessionId`-keyed effect).
  const [sessionId, setSessionId] = useState(0);
  // Whether the running view (transcript + insights) should be on screen.
  // Deliberately NOT derived from useMeetingSession's own `status` alone:
  // that hook resets `status` to "idle" the instant a real stop() resolves
  // (see its own file header), and this panel still has a save to attempt —
  // and possibly retry — after that happens. `running` below OR's this
  // together with `status`, so the view appears the moment either becomes
  // true and only disappears once a save has actually landed.
  const [meetingActive, setMeetingActive] = useState(false);
  // True once Stop has been pressed for the meeting currently on screen —
  // this is what hides the Stop control itself (nothing left to stop)
  // without ever leaving a disabled Stop button sitting next to its own
  // explanation, which this repo has shipped as a bug before.
  const [stopped, setStopped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // `null` until the per-Start probe below resolves (see handleStart).
  // recordingConsentNotice/engineCaveatNotice both already hedge gracefully
  // on `null`, so this is never blocked on and never guessed.
  const [providerName, setProviderName] = useState(null);

  // The built `{ title, body }` for the meeting currently being saved, so a
  // Retry can re-POST the exact same page rather than rebuilding it from
  // whatever the transcript/insight hooks happen to hold at retry time (a
  // moment that, for a session already stopped, should be identical anyway,
  // but there is no reason to make Retry depend on that being true).
  const pendingPageRef = useRef(null);
  const startedAtRef = useRef(null);
  // Guards the provider-name probe to firing at most once per component
  // instance — see handleStart. A ref, not state: nothing renders off
  // "have we probed", only off the resolved name itself.
  const probedProviderRef = useRef(false);

  // A pure, synchronous localStorage read, done directly rather than
  // through the reactive useEngine() store — this panel only ever needs
  // "the engine as of the moment a fact about it is used," the same way
  // every other one-off readEngine() call site in this app (answerClient.js,
  // chatbot.js, ...) treats it, not a value it re-renders in response to.
  const engine = readEngine();

  // Resolve the ACTUAL interviewer-audio source once on mount: the stored
  // preference, coerced against what this device can run right now
  // (resolveInterviewerSource already does the "no getDisplayMedia on this
  // phone -> inperson" coercion — see captureSupport.js). The setState is
  // deferred a microtask out, the same shape useCaptureSetup.js's own seed
  // effect uses, which is what keeps this clear of
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    let stored = null;
    try {
      stored = window.localStorage.getItem(SOURCE_STORAGE_KEY);
    } catch {
      stored = null;
    }
    // navigator always exists by the time an effect body runs (effects
    // never execute during SSR) — see useCaptureSetup.js's own comment.
    const resolved = resolveInterviewerSource(stored, displayCaptureSupported(navigator.mediaDevices));
    Promise.resolve().then(() => setSource(resolved));
  }, []);

  const session = useMeetingSession({ source });
  const live = session.status === "live" || session.status === "connecting";
  const running = live || meetingActive;

  const insights = useMeetingInsights({
    turns: session.turns,
    sessionId,
    live,
    pageId,
    engine,
  });

  // Posts (or re-posts, on Retry) the built page. Split out of handleStop so
  // Retry can call the identical function against the identical payload.
  const doSave = useCallback(
    async (page) => {
      setSaving(true);
      setSaveError("");
      try {
        const res = await fetch("/api/meeting/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(page),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // AC: a failed save keeps the whole meeting on screen. Nothing
          // here touches `meetingActive`/`stopped`/`pendingPageRef` — there
          // is no server-side record of this meeting until the POST above
          // actually succeeds, so losing any of that state now, because
          // this one attempt didn't land, would be the single most
          // destructive thing this feature could do. The Retry button
          // (wired to this same function) is the only way forward from here.
          setSaveError(data?.error || "Could not save this meeting. Try again.");
          return;
        }
        // Hard-called, never `?.()`. The page tree's own list of pages lives
        // in a hook owned by a distant ancestor (ExperienceTab) that this
        // panel cannot reach or refresh on its own — this callback is the
        // ONLY mechanism by which the page just created is ever shown. An
        // optional call here would turn a caller that forgot to pass
        // `onMeetingSaved` into a silent no-op: the meeting saves, the
        // callback quietly does nothing, and nobody sees the new page.
        onMeetingSaved(data.page);
        // Only NOW — once a save has actually returned a page — is it safe
        // to let the running view go. Clearing any earlier would have
        // discarded a meeting a failed attempt hadn't actually saved yet.
        pendingPageRef.current = null;
        setMeetingActive(false);
        setStopped(false);
      } catch (err) {
        setSaveError(err?.message || "Could not save this meeting. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [onMeetingSaved],
  );

  const handleRetry = useCallback(() => {
    if (pendingPageRef.current) doSave(pendingPageRef.current);
  }, [doSave]);

  // The ONLY way a meeting begins: one click, no dialog, no source picker in
  // the way — the source was already resolved above, from the copilot's own
  // remembered choice, coerced to whatever this device can actually run. A
  // picker may exist beside a running session later; it must never stand in
  // front of starting one.
  const handleStart = useCallback(() => {
    startedAtRef.current = Date.now();
    setSessionId((n) => n + 1);
    setStopped(false);
    setSaveError("");
    pendingPageRef.current = null;
    setMeetingActive(true);
    session.start();

    // The provider-name probe: fired here, not from a mount effect, and at
    // most once per panel instance. It hits the token route's GET handler —
    // which mints nothing, it only answers "which provider?" — exactly the
    // way CopilotClient.js's own F2 probe does, and for the same reason:
    // informing the consent/engine notices below is worth doing, but never
    // worth blocking Start on, so this fires and is walked away from
    // immediately. `typeof fetch` (not a bare reference) is deliberate: it
    // is the one safe way to ask whether a global identifier exists without
    // risking a ReferenceError if it doesn't.
    if (!probedProviderRef.current && typeof fetch === "function") {
      probedProviderRef.current = true;
      fetch("/api/copilot/token", { method: "GET" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (body) setProviderName(meetingSttProviderName(body.provider));
        })
        .catch(() => {});
    }
  }, [session]);

  const handleStop = useCallback(() => {
    // Unconditional, and before anything below that can fail. Leaving the
    // microphone recording because the save that follows failed would be
    // the worst possible coupling this feature could ship — so stopping
    // capture is not allowed to depend on the save's outcome in either
    // direction.
    session.stop();
    setStopped(true);
    const page = buildMeetingPage({
      topic: insights.topic,
      insights: insights.insights,
      turns: session.turns,
      startedAt: startedAtRef.current,
      endedAt: Date.now(),
      source,
    });
    pendingPageRef.current = page;
    doSave(page);
  }, [session, insights.topic, insights.insights, source, doSave]);

  return (
    <Box>
      {/* Consent is a "before you press record" fact, not an after-the-fact
          disclosure, so both notices are shown whether or not a meeting is
          currently running — never gated behind Start, and never a dialog
          Start has to clear first. */}
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          {recordingConsentNotice(source, providerName)}
        </Typography>
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          {engineCaveatNotice(engine, providerName)}
        </Typography>
      </Stack>

      {!running ? (
        <Button variant="contained" onClick={handleStart} aria-label="Start a meeting">
          Start a meeting
        </Button>
      ) : (
        <Box>
          <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "center" }}>
            {!stopped ? (
              <Button
                variant="outlined"
                onClick={handleStop}
                aria-label="Stop the meeting and save it as a page"
              >
                Stop
              </Button>
            ) : null}
            {saving ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <CircularProgress size={16} />
                <Typography variant="body2" role="status" aria-live="polite">
                  Saving this meeting…
                </Typography>
              </Stack>
            ) : null}
          </Stack>

          {/* AC: a failed save is role="alert" (MUI's <Alert severity="error">
              already sets that by default — see MeetingInsightList.js's own
              comment on the identical point), with a Retry, and the
              transcript/insights below stay mounted right through it. */}
          {saveError ? (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={handleRetry} aria-label="Retry saving this meeting">
                  Retry
                </Button>
              }
            >
              {saveError}
            </Alert>
          ) : null}

          <MeetingTranscript turns={session.turns} interims={session.interims} source={source} />

          <Box sx={{ mt: 2 }}>
            <MeetingInsightList
              insights={insights.insights}
              topic={insights.topic}
              topicChanged={insights.topicChanged}
              loading={insights.status === "loading"}
              error={insights.error}
              onNudge={insights.nudge}
              // Retrying a failed insight read IS asking again — there is no
              // separate retry mechanism, `nudge` already is one.
              onRetry={insights.nudge}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}
