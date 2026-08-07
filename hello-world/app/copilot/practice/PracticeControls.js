"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { fmtClock } from "@/lib/copilot/clock";
import StatusPill from "../StatusPill";
import MicPicker from "../MicPicker";

// Presentational block for practice mode's session controls: the "Your
// microphone" row, the Start/Stop row (status pill, elapsed clock,
// Camera/Mute toggles), and the three-switch row (camera frames, save
// recordings, pre-draft) with its embedded-engine caption. All state
// (status, timing, mic/camera state, the switches themselves) lives in
// PracticeClient — this only renders what it's given and calls back on
// start/stop and each switch change.
export default function PracticeControls({
  micDeviceId,
  onMicDeviceChange,
  running,
  status,
  onStop,
  onStart,
  startedAt,
  elapsed,
  controlsEnabled,
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
  preDraftPredicted,
  onPreDraftChange,
}) {
  return (
    <>
      {/* AC-J1.6: the microphone is one piece of hardware shared with live
          mode — CopilotClient owns the selection AND the localStorage key
          (see its own MIC_STORAGE_KEY doc) and hands both down as props,
          exactly the way it already hands down `sttProviderName`. This
          component owns no storage logic of its own for it. Laid out like
          live mode's own "Your microphone:" row in CopilotClient.js, placed
          above the Start/Stop row the same way that row sits above live
          mode's Start/Stop row. */}
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          Your microphone:
        </Typography>
        <MicPicker value={micDeviceId} onChange={onMicDeviceChange} disabled={running} />
      </Stack>

      <Stack
        direction="row"
        spacing={1.5}
        sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        {running ? (
          <Button variant="outlined" color="error" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button variant="contained" onClick={onStart}>
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

      {/* AC-J2.7: "Pre-draft predicted answer" shares this row with the two
          switches it was named alongside — camera frames and save
          recordings — rather than a third row of its own. */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={sendFrames}
              disabled={isEmbedded}
              onChange={onSendFramesChange}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Include camera frames in AI feedback
            </Typography>
          }
        />
        <FormControlLabel
          control={
            <Switch size="small" checked={saveEnabled} onChange={onToggleSaveEnabled} />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Save recordings to my account
            </Typography>
          }
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={preDraftPredicted}
              onChange={onPreDraftChange}
            />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Pre-draft predicted answer
            </Typography>
          }
        />
        {/* BUG-J2: this used to say "...separate from saving recordings
            below", which became wrong once the save switch moved into this
            same row (it reads as a locator, not a claim about coverage). It
            briefly said "and from pre-drafting predicted answers" too, but
            that was a FALSE privacy claim in the dangerous direction: the
            embedded engine's own sentence above ("Sample answers are
            drafted on this server too") already covers pre-drafting
            correctly — draftAnswer sends `engine: readEngine()`, and
            app/api/copilot/answer/route.js's wantsEmbedded branch drafts
            locally, so a pre-draft on this engine reaches no AI provider at
            all. Saying "separate from" pre-drafting would have told the
            user the embedded guarantee excludes it, which understates the
            protection they actually have. Only saving recordings is
            genuinely a separate destination (Supabase upload happens
            identically on every engine), so only that stays named here. */}
        {isEmbedded ? (
          <Typography variant="caption" sx={{ color: "var(--text-muted)" }}>
            The embedded engine never sends your answer, posting, or frames to an AI provider. This is
            separate from saving recordings.
          </Typography>
        ) : null}
      </Stack>
    </>
  );
}
