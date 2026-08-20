"use client";

import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { fmtClock } from "@/lib/copilot/clock";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import StatusPill from "../StatusPill";
import MicPicker from "../MicPicker";
import { TOUCH_SWITCH_SX, TOUCH_TARGET_SX } from "../mobileSx";

// Bounded down("sm") override, not an `xs` key (MUI sx trap: `xs` is
// `min-width: 0` and has no way to turn itself back off at `sm`+, where
// FormControlLabel's real default -11px margin belongs on wider screens).
// Shared by every FormControlLabel in this file so the Camera/Mute-mic row
// stops hanging 11px left of the Include-frames/Save-recordings row below it
// (adversarial review) — those two already carried this override; these two
// didn't.
const LABEL_MARGIN_SX = (theme) => ({ [theme.breakpoints.down("sm")]: { ml: 0, mr: 0 } });

// AC-R1.1/AC-R1.2/AC-R1.12: the "Speak as" mode's own recording surface —
// modelled on practice mode's PracticeControls and QuestionCard's Start
// answering/Done cluster (../practice/PracticeControls.js,
// ../practice/QuestionCard.js), reproduced here rather than imported because
// those two components carry practice-only inputs (a posting picker, a
// question feed, the pre-draft switch, session-log download) this mode has
// none of. All state and every decision live in useRoleAnswer.js — this only
// renders what it's given and calls back on the primary press, Stop, and
// each switch/toggle.
//
// AC-R1.12: uses the "secondary" text colour token throughout, never the
// "muted" one — the contract test's own accessibility check scans every
// non-test file in this directory for that token (R-228: it measures 4.15:1
// on --bg-surface in light mode, under the 4.5:1 threshold for normal text).
export default function RoleDrillControls({
  privacyNotice,
  micDeviceId,
  onMicDeviceChange,
  status,
  running,
  startedAt,
  elapsed,
  answering,
  settling,
  primaryDisabled,
  focusPrimarySignal,
  onStartSpeaking,
  onDoneAnswer,
  onStop,
  recordingStatusText,
  cameraOff,
  hasVideo,
  onToggleCamera,
  micMuted,
  onToggleMic,
  sendFrames,
  isEmbedded,
  onSendFramesChange,
  saveEnabled,
  onToggleSaveEnabled,
}) {
  const controlsEnabled = status === "live";

  // Focus management (rough edge, adversarial review): "Done" is replaced by
  // a bare spinner and "Try again" unmounts the whole review/feedback panel,
  // stranding a keyboard user's focus on `<body>` twice per loop. This ref
  // sits on whichever primary button is currently rendered (Done while
  // answering, Start speaking otherwise — never both at once, so one ref
  // suffices); `focusPrimarySignal` is bumped by useRoleAnswer.js's
  // onTryAgain, and the effect below moves focus there each time it changes.
  // Guarded against firing on mount (`prevSignalRef` seeded from the first
  // render's own value, not 0) — a page load must not steal focus with no
  // user action behind it. Deliberately not `autoFocus`: that fights a
  // screen reader's own navigation instead of being announced as a focus
  // change it already tracks.
  const primaryButtonRef = useRef(null);
  const prevSignalRef = useRef(focusPrimarySignal);
  useEffect(() => {
    if (focusPrimarySignal !== prevSignalRef.current) {
      prevSignalRef.current = focusPrimarySignal;
      primaryButtonRef.current?.focus();
    }
  }, [focusPrimarySignal]);

  return (
    <Box>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
        {privacyNotice}
      </Typography>

      {/* AC-R1.12: mounted unconditionally from the first render — only its
          TEXT ever changes from here on. See lib/copilot/answerStatus.js's
          own long comment: a live region that first appears already holding
          its final content is not reliably announced by NVDA/JAWS. This is a
          SEPARATE region from the reveal's own status span (RoleDrillClient)
          — they speak for two independent things, and a recording starting
          or stopping must never be silently folded into the reveal's own
          announcement text. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {recordingStatusText}
      </Box>

      <Stack
        direction="row"
        useFlexGap
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", gap: 1.25 }}
      >
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          Your microphone:
        </Typography>
        <MicPicker value={micDeviceId} onChange={onMicDeviceChange} disabled={running} />
      </Stack>

      <Stack
        direction="row"
        useFlexGap
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", gap: 1.5 }}
      >
        {/* Colour never carries this alone (AC-R1.12): the "danger"-coloured
            line pairs a "●" glyph with the words "Recording your answer",
            same idiom QuestionCard.js already uses for practice mode. */}
        {answering ? (
          <>
            <Typography variant="body2" sx={{ color: "var(--danger)", fontWeight: 600 }}>
              ● Recording your answer…
            </Typography>
            <Button variant="outlined" color="error" onClick={onDoneAnswer} sx={TOUCH_TARGET_SX} ref={primaryButtonRef}>
              Done
            </Button>
          </>
        ) : settling ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <CircularProgress size={16} />
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Finishing up your answer…
            </Typography>
          </Stack>
        ) : (
          <Button
            variant="contained"
            onClick={onStartSpeaking}
            disabled={primaryDisabled}
            sx={TOUCH_TARGET_SX}
            ref={primaryButtonRef}
          >
            Start speaking
          </Button>
        )}
        <StatusPill status={status} />
        {startedAt ? (
          <Typography
            variant="body2"
            sx={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}
          >
            {fmtClock(elapsed)}
          </Typography>
        ) : null}
        {running ? (
          <Button variant="outlined" color="error" onClick={onStop} sx={TOUCH_TARGET_SX}>
            Stop
          </Button>
        ) : null}
      </Stack>

      <Stack
        direction="row"
        useFlexGap
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", gap: 1.5 }}
      >
        <FormControlLabel
          sx={LABEL_MARGIN_SX}
          control={
            <Switch
              size="small"
              checked={!cameraOff}
              disabled={!controlsEnabled || !hasVideo}
              onChange={onToggleCamera}
              sx={TOUCH_SWITCH_SX}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Camera
            </Typography>
          }
        />
        <FormControlLabel
          sx={LABEL_MARGIN_SX}
          control={
            <Switch
              size="small"
              checked={micMuted}
              disabled={!controlsEnabled}
              onChange={onToggleMic}
              sx={TOUCH_SWITCH_SX}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Mute mic
            </Typography>
          }
        />
      </Stack>

      {/* Bounded down("sm") override, not an `xs` key — mirrors
          PracticeControls.js's own three-switch row exactly, for the same
          reason its own comment gives: an `xs` key is `min-width: 0` and
          would apply at every width with no way to turn it back off at
          `sm`+, where FormControlLabel's real default margins belong. */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        useFlexGap
        sx={{ alignItems: { xs: "stretch", sm: "center" }, flexWrap: "wrap", gap: 1 }}
      >
        <FormControlLabel
          sx={LABEL_MARGIN_SX}
          control={
            <Switch
              size="small"
              checked={sendFrames}
              disabled={isEmbedded}
              onChange={onSendFramesChange}
              sx={TOUCH_SWITCH_SX}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Include camera frames in AI feedback
            </Typography>
          }
        />
        <FormControlLabel
          sx={LABEL_MARGIN_SX}
          control={
            <Switch size="small" checked={saveEnabled} onChange={onToggleSaveEnabled} sx={TOUCH_SWITCH_SX} />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Save recordings to my account
            </Typography>
          }
        />
        {isEmbedded ? (
          // BUG (privacy audit): this used to say the embedded engine "never
          // sends your answer, role, or frames to an AI provider" with no
          // qualifier — read as a blanket guarantee. It isn't one: the
          // answer's audio goes to Deepgram, an AI speech provider, on every
          // engine including this one (lib/copilot/practiceSession.js ->
          // lib/copilot/stt/). Scoped to "for feedback" so the guarantee
          // covers only what it actually covers — the feedback model — and
          // the transcription destination is named plainly right beside it
          // rather than left for the reader to infer from the notice above.
          <Typography variant="caption" sx={{ color: "var(--text-secondary)" }}>
            The embedded engine never sends your answer, role, or frames to an AI provider for
            feedback — but your audio is still sent to the transcription provider named above. This
            guarantee is separate from saving recordings.
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
