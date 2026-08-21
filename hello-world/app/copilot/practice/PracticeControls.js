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
// Camera/Mute toggles), and the two-switch row (camera frames, save
// recordings) with its embedded-engine caption. All state (status, timing,
// mic/camera state, the switches themselves) lives in PracticeClient — this
// only renders what it's given and calls back on start/stop and each switch
// change.
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
  onDownloadLog,
  downloadLogEnabled,
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
        {/* AC-Q7.5: one button, no confirmation, no format menu — reuses
            downloadSessionLogArchive (via PracticeClient's sessionLog),
            which already zips the Markdown record and the raw JSON into
            the single file it triggers. Visible whether or not a session
            is currently running (it sits outside the `running ? Stop :
            Start` branch above), and disabled only when nothing has been
            recorded yet — never behind a Tooltip on a disabled span, which
            this codebase's own a11y trap (MUI Tooltip stealing a control's
            accessible name) would apply to; the reason is instead plain DOM
            text right beside it, the same idiom the embedded-engine caption
            below already uses for the identical problem. */}
        <Button
          variant="outlined"
          size="small"
          onClick={onDownloadLog}
          disabled={!downloadLogEnabled}
          aria-describedby={!downloadLogEnabled ? "practice-download-log-reason" : undefined}
          sx={TOUCH_TARGET_SX}
        >
          Download session log
        </Button>
        {!downloadLogEnabled ? (
          <Typography id="practice-download-log-reason" variant="caption" sx={{ color: "var(--text-muted)" }}>
            Available once a practice session has started.
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

      {/* Defect 4: two long-labelled switches don't comfortably fit one row
          at 320px — max-content is well past the ~272px available, so
          labels wrapped to two lines with a 24px switch floating beside them
          below `sm`. Stacking them in a column below `sm` instead gives each
          label the full row width; `ml: 0, mr: 0` on each FormControlLabel
          removes MUI's default asymmetric label margins (meant for a single
          switch inline with other controls) so the stack reads as a clean
          left-aligned list.
          Bug fix (audit round): that override used to apply at every width,
          unscoped — FormControlLabel's own default is `marginLeft: -11px,
          marginRight: 16px` (see node_modules/@mui/material/FormControlLabel/
          FormControlLabel.js), so it was shifting both switches ~11px right
          and dropping 16px of trailing margin even at `sm` and up, where the
          row is back to a normal inline flow and needed none of this. Scoped
          via the same bounded `theme.breakpoints.down("sm")` idiom
          SessionSetup.js uses for its ToggleButtonGroup, rather than an
          `{ xs, sm }` object — an `xs` key is `min-width: 0` and applies
          everywhere, so it can state "0 below sm" but never "MUI's default
          again at sm+"; a bounded down("sm") query has an upper bound, so at
          600px and up none of these declarations exist and the label's
          normal margins are untouched. */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        useFlexGap
        sx={{ mb: 2, alignItems: { xs: "stretch", sm: "center" }, flexWrap: "wrap", gap: 1 }}
      >
        <FormControlLabel
          sx={(theme) => ({ [theme.breakpoints.down("sm")]: { ml: 0, mr: 0 } })}
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
          sx={(theme) => ({ [theme.breakpoints.down("sm")]: { ml: 0, mr: 0 } })}
          control={
            <Switch size="small" checked={saveEnabled} onChange={onToggleSaveEnabled} sx={TOUCH_SWITCH_SX} />
          }
          label={
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Save recordings to my account
            </Typography>
          }
        />
        {/* BUG-J2: this used to say "...separate from saving recordings
            below" as a locator into a longer row; now that the row holds
            only these two switches, "below" would just be confusing, so the
            caption names the save switch directly instead. Saving recordings
            is genuinely a separate destination from the embedded guarantee
            above it (Supabase upload happens identically on every engine,
            regardless of which AI provider the critique itself runs on). */}
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
