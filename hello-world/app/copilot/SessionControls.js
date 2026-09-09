"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { fmtClock } from "@/lib/copilot/clock";
import StatusPill from "./StatusPill";
import { TOUCH_TARGET_SX, TOUCH_SWITCH_SX } from "./mobileSx";

// Headroom extraction, NOT a feature: split out of CopilotClient.js purely to
// keep that file under CopilotClient.extraction.test.js's 950-line cap — the
// same reason SpeakerBar.js, TranscriptDisclosure.js and useTypeAnnouncements
// .js were themselves split out of it (see each of those modules' own docs,
// and the call site in CopilotClient.js). The JSX below moved VERBATIM,
// comments included; nothing about what reaches the screen changed on the way
// out, and no assertion in this suite was weakened to let it move.
//
// Owns live mode's session control row and nothing else: Start/Stop, the
// status pill, the elapsed clock, the Auto-draft switch, Copy, Clear, and the
// "Download session log" button with its D6 disabled-reason caption. This is
// the live-mode mirror of practice/PracticeControls.js — the same split, for
// the same reason, on the very row that file's own header already points at
// ("live mode's own Start/Stop row in CopilotClient.js").
//
// No state and no hooks of its own, deliberately. Every value rendered here
// and every handler called is a prop, so CopilotClient's own hook call order
// is byte-for-byte what it was before this file existed — an extraction that
// moved a useState or a useEffect across this boundary would be a behaviour
// change in React, not a relocation. `finals` and `questions` arrive as the
// ARRAYS rather than as pre-computed booleans for the same reason: it keeps
// the two `disabled` expressions identical to the ones that used to sit
// inline, instead of restating them one level up.
export default function SessionControls({
  live,
  stop,
  onStartSession,
  status,
  startedAt,
  elapsed,
  autoDraft,
  setAutoDraft,
  copyTranscript,
  clearAll,
  finals,
  questions,
  downloadLog,
  sessionLogHasEvents,
}) {
  return (
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
  );
}
