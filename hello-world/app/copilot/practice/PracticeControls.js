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
import { TOUCH_SWITCH_SX, TOUCH_TARGET_SX } from "../mobileSx";

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
        {running ? (
          <Button variant="outlined" color="error" onClick={onStop} sx={TOUCH_TARGET_SX}>
            Stop
          </Button>
        ) : (
          <Button variant="contained" onClick={onStart} sx={TOUCH_TARGET_SX}>
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
        {/* Defect 6: `flex: 1` alone is `flex-basis: 0%`, which contributes
            nothing to line packing — in a wrapping row it just absorbs free
            space on whichever wrapped line it lands on, making the row's
            wrap points unpredictable as labels change. Hidden below `sm`
            instead, where this row already wraps onto multiple lines and a
            zero-basis spacer has nothing meaningful to push against. */}
        <Box sx={{ flex: 1, display: { xs: "none", sm: "block" } }} />
        <FormControlLabel
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

      {/* AC-J2.7: "Pre-draft predicted answer" shares this row with the two
          switches it was named alongside — camera frames and save
          recordings — rather than a third row of its own.
          Defect 4: three long-labelled switches don't fit one row at
          320px — max-content is ~788px against ~272px available, so labels
          wrapped to two lines with a 24px switch floating beside them below
          `sm`. Stacking them in a column below `sm` instead gives each
          label the full row width; `ml: 0, mr: 0` on each FormControlLabel
          removes MUI's default asymmetric label margins (meant for a single
          switch inline with other controls) so the stack reads as a clean
          left-aligned list. */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        useFlexGap
        sx={{ mb: 2, alignItems: { xs: "stretch", sm: "center" }, flexWrap: "wrap", gap: 1 }}
      >
        <FormControlLabel
          sx={{ ml: 0, mr: 0 }}
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
          sx={{ ml: 0, mr: 0 }}
          control={
            <Switch size="small" checked={saveEnabled} onChange={onToggleSaveEnabled} sx={TOUCH_SWITCH_SX} />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Save recordings to my account
            </Typography>
          }
        />
        <FormControlLabel
          sx={{ ml: 0, mr: 0 }}
          control={
            <Switch
              size="small"
              checked={preDraftPredicted}
              onChange={onPreDraftChange}
              sx={TOUCH_SWITCH_SX}
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
