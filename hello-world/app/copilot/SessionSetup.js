"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import MicPicker from "./MicPicker";
import PostingPicker from "./PostingPicker";
import SubmittedDocs from "./SubmittedDocs";
import PrepContext from "./PrepContext";

// R-129's known follow-up (see ../../docs/REGRESSION.md): live mode's own
// pre-session setup block, extracted out of CopilotClient the same way
// PracticeSetup.js/PracticeControls.js were extracted out of PracticeClient
// — the interviewer audio-source toggle, the microphone picker, the consent
// alert, the posting picker, the posting-grounding notice, SubmittedDocs,
// and PrepContext. Purely presentational, same flat-prop convention those
// two already established: no hooks, no handlers, no derived values here —
// every value below arrives exactly as it was computed in CopilotClient.
// The error and warning Alerts deliberately did NOT move here — they report
// on a running session, not on setup, so they stay in CopilotClient (see
// its own render, right after this component, for where).
//
// New for the half-window/dual-screen fix: this block also owns the
// collapse-while-live disclosure now. `expanded` is CopilotClient's own
// state (`true` before a session ever starts or once one stops, reset to
// `false` the moment one goes live, still toggleable by the user in
// between) — this component only reads it and calls back on
// `onToggleExpanded`, the same contract as every other value here.
const SETUP_REGION_ID = "copilot-session-setup-region";

export default function SessionSetup({
  live,
  expanded,
  onToggleExpanded,
  postingSummary,
  micLabel,
  source,
  onSourceChange,
  micDeviceId,
  onMicDeviceChange,
  showConsent,
  onDismissConsent,
  sttProviderName,
  posting,
  onPostingChange,
  postingPickerLabel,
  postingPickerBlankHint,
  postingGroundingNotice,
  submittedDocs,
  profile,
  onProfileChange,
}) {
  return (
    <>
      {/* The disclosure only exists once there is something to disclose —
          before a session starts this block always renders in full
          (CopilotClient resets `expanded` back to `true` in `stop`, so the
          Collapse below is always `in` whenever `!live`), so a pre-session
          screen never shows a collapse control with nothing collapsed to
          explain it. The posting's title (or "No posting selected") and the
          microphone label are what stay readable on this one line — they're
          the two setup facts a candidate would actually want to double-check
          mid-interview without fully expanding this back out; the audio
          source and consent notice are one-time decisions already acted on
          by the time a session is live, so they're not worth the line. */}
      {live ? (
        <Button
          size="small"
          variant="text"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={SETUP_REGION_ID}
          sx={{ mb: 1, color: "var(--text-secondary)", textTransform: "none" }}
        >
          {expanded ? "▾ Hide setup" : `▸ Show setup — ${postingSummary} · Mic: ${micLabel}`}
        </Button>
      ) : null}

      {/* AC-I1.7/Step 2: `Collapse` (not a bare clipped Box) so a screen
          reader and the tab order both agree with what's on screen while
          collapsed — MUI sets `visibility: hidden` on the fully-exited
          state, which removes it from the accessibility tree and the tab
          order, not merely from view. Same Button+Collapse shape
          SubmittedDocs.js/PrepContext.js already use for their own
          disclosures, just driven by CopilotClient's state instead of a
          local one, since this component owns no state of its own. */}
      <Collapse in={expanded}>
        <Box id={SETUP_REGION_ID}>
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
          >
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Interviewer audio:
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={source}
              disabled={live}
              onChange={(_e, val) => onSourceChange(val)}
            >
              <ToggleButton value="tab" sx={{ textTransform: "none", px: 1.5 }}>
                Browser tab
              </ToggleButton>
              <ToggleButton value="system" sx={{ textTransform: "none", px: 1.5 }}>
                System audio (speakers)
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {/* AC-I1: your own microphone, the same kind of source control as
              "Interviewer audio" above and disabled the same way (AC-I1.7)
              — changing it mid-session would require tearing down and
              rebuilding the "you" capture pipeline, which is out of scope. */}
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
          >
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Your microphone:
            </Typography>
            <MicPicker value={micDeviceId} onChange={onMicDeviceChange} disabled={live} />
          </Stack>

          {showConsent ? (
            <Alert severity="info" sx={{ mb: 2 }} onClose={onDismissConsent}>
              {/* F2: names the STT provider once known, never guesses one before
                  then. BUG-H4: the posting-grounding fact used to be appended
                  here too, but this alert is dismissible (onClose) and shown
                  before the user has selected anything — dismissing it before
                  selecting a posting left that fact stated nowhere. It now
                  renders in its own always-visible element below, next to the
                  PostingPicker (see postingGroundingNotice's derivation and
                  its render site further down). */}
              {`Recording notice: audio is streamed${sttProviderName ? ` to ${sttProviderName}` : ""} for transcription. Make sure everyone on the call consents before you start — some regions require all-party consent.`}
            </Alert>
          ) : null}

          {/* AC-H1.1/AC-H1.3: the same posting picker practice mode has, above
              the prep context panel, wording it for live mode's own meaning
              of leaving it blank. Stays enabled at all times, including while
              a session is live — unlike the mode toggle and audio-source
              picker above, which are disabled once `live`. */}
          <Box sx={{ mb: 2 }}>
            <PostingPicker
              value={posting}
              onChange={onPostingChange}
              disabled={false}
              label={postingPickerLabel}
              blankHint={postingPickerBlankHint}
            />
          </Box>

          {/* AC-H6.24/AC-H6.25 (BUG-H4): always visible — never gated by
              showConsent — so the fact stays on screen for as long as a
              posting stays selected, even after the consent alert above has
              been dismissed. This is the ONE place that fact is stated; see
              postingGroundingNotice's derivation above for exactly when it
              applies and what it says. Empty (renders nothing) when no
              posting is selected, matching PracticeClient's privacyNotice
              treatment and visual weight. */}
          {postingGroundingNotice ? (
            <Typography variant="body2" sx={{ color: "var(--text-secondary)", mb: 2 }}>
              {postingGroundingNotice}
            </Typography>
          ) : null}

          {/* AC-H3: only rendered once a posting is actually selected — with
              none selected, this panel is absent entirely rather than shown
              empty or disabled. */}
          {posting ? (
            <SubmittedDocs
              status={submittedDocs.status}
              resume={submittedDocs.resume}
              coverLetter={submittedDocs.coverLetter}
              error={submittedDocs.error}
              onRetry={submittedDocs.retry}
            />
          ) : null}

          <PrepContext value={profile} onChange={onProfileChange} />
        </Box>
      </Collapse>
    </>
  );
}
