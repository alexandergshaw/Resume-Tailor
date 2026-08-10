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
import { TOUCH_TARGET_SX, TOUCH_ICON_SX, BREAK_LONG_WORDS_SX } from "./mobileSx";

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
  sourceAvailability,
  sourceUnavailableReason,
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
          sx={{
            mb: 1,
            color: "var(--text-secondary)",
            textTransform: "none",
            ...TOUCH_TARGET_SX,
            ...BREAK_LONG_WORDS_SX,
          }}
        >
          {expanded ? "▾ Hide setup" : `▸ Show setup — ${postingSummary} · Mic: ${micLabel}`}
        </Button>
      ) : null}

      {/* BUG-4: moved OUTSIDE the Collapse below (it used to sit next to the
          dismissible consent Alert, inside it). `start()` calls
          setSetupExpanded(false), and MUI's fully-exited Collapse sets
          `visibility: hidden` on its content — this file's own comment on
          the Collapse below already documents that this removes content
          from BOTH the accessibility tree and the tab order, not merely
          from view. That made this notice disappear the moment recording
          actually began: for the entire life of a live session — the whole
          time a microphone is recording everyone in the room — there was no
          recording notice on screen or reachable by a screen reader. AC-H6's
          BUG-H4 lesson was that this disclosure must never be dismissible;
          auto-hiding it on session start is the same failure by another
          route, so it now renders unconditionally for as long as this
          source stays selected, live or not, expanded or not — and still
          carries no `onClose`, so it stays non-dismissible. */}
      {source === "inperson" ? (
        <Typography
          variant="body2"
          sx={{ color: "var(--text-secondary)", mb: 2, fontWeight: 600 }}
        >
          {`Everyone in the room is being recorded and transcribed${sttProviderName ? ` by ${sttProviderName}` : ""}. Say so out loud before you start: unlike a shared browser tab, there is nothing on screen for the other person to see happening.`}
        </Typography>
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
            direction={{ xs: "column", sm: "row" }}
            spacing={1.25}
            sx={{
              mb: sourceUnavailableReason ? 1 : 2,
              alignItems: { xs: "stretch", sm: "center" },
              flexWrap: "wrap",
              rowGap: 1,
            }}
          >
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Interviewer audio:
            </Typography>
            {/* AC-P7 (R-157): this group's single-line content is the
                dominant cause of the whole page's horizontal overflow on a
                phone — a ToggleButtonGroup is `inline-flex` and never wraps
                internally, so the parent Stack's `flexWrap` only ever wrapped
                BETWEEN the label and the group, never inside it. Measured
                min-content here was 269.8px against 252px of available
                content width at a 320px viewport.

                Stacked via `sx` breakpoints rather than the `orientation`
                prop. `orientation="vertical"` was tried first and did NOT
                take effect in this MUI build: the committed fiber carried
                `orientation: "vertical"` while the DOM still rendered
                `MuiToggleButtonGroup-horizontal` with `flex-direction: row`,
                at 320px, across a reload and a resize. CSS breakpoints on
                this same page demonstrably DO work, so the layout is
                expressed in the medium that is actually reliable here — and
                as a bonus it needs no JS, no hydration pass, and no
                `isMobile` prop threaded down from the parent.

                Below `sm` each option becomes its own full-width pill. At `sm`
                and up nothing here applies at all — see the `down("sm")` note
                on the sx below for why that is written as a media query and
                not as an `{ xs, sm }` object. */}
            <ToggleButtonGroup
              exclusive
              size="small"
              value={source}
              disabled={live}
              onChange={(_e, val) => onSourceChange(val)}
              sx={(theme) => ({
                // Scoped with an explicit `down("sm")` media query rather than
                // an `{ xs, sm }` object, and that distinction is the whole
                // reason this reads the way it does. In MUI's breakpoint
                // objects `xs` compiles to `@media (min-width: 0px)`, which is
                // true at EVERY width — so `{ xs: "8px", sm: undefined }` does
                // not mean "8px only on phones", it means "8px everywhere,
                // with nothing to switch it back off". Written that way first,
                // and it silently shipped 8px radii and `margin-left: 0` to
                // the desktop, replacing MUI's joined segmented control with
                // three detached buttons at 1280px. `down("sm")` has an upper
                // bound, so at 600px and up not one of these declarations
                // exists and MUI's own horizontal grouping is genuinely
                // untouched.
                [theme.breakpoints.down("sm")]: {
                  width: "100%",
                  flexDirection: "column",
                  rowGap: theme.spacing(0.75),
                  // MUI's horizontal grouping zeroes the inner corner radii and
                  // pulls the buttons together with `margin-left: -1px`; both
                  // read as broken once the row becomes a column, so they are
                  // reset on the same three classes MUI itself targets.
                  "& .MuiToggleButtonGroup-firstButton, & .MuiToggleButtonGroup-middleButton, & .MuiToggleButtonGroup-lastButton":
                    {
                      marginLeft: 0,
                      // Explicit px. `borderRadius` is one of the sx keys MUI
                      // rescales: a bare number is multiplied by
                      // theme.shape.borderRadius, so passing that value itself
                      // rendered 8 * 8px = 64px pills. Same family of trap as
                      // `width: 1` meaning 100% (see lib/copilot/answerStatus.js)
                      // and `margin: -1` meaning -8px — in sx, a unitless number
                      // is a multiplier far more often than it is pixels.
                      borderRadius: `${theme.shape.borderRadius}px`,
                      borderLeft: "1px solid var(--border)",
                      width: "100%",
                    },
                },
              })}
            >
              {/* AC-P7: disabled whenever this device can't run display
                  capture at all (`getDisplayMedia` absent — see
                  captureSupport.js), on top of the existing `disabled={live}`
                  — individual ToggleButton `disabled` takes priority over the
                  group's own, so this ORs the two conditions rather than
                  losing the live-session gate. */}
              <ToggleButton
                value="tab"
                disabled={live || !sourceAvailability.tab}
                sx={{ textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX }}
              >
                Browser tab
              </ToggleButton>
              <ToggleButton
                value="system"
                disabled={live || !sourceAvailability.system}
                sx={{ textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX }}
              >
                System audio (speakers)
              </ToggleButton>
              {/* AC-M1.5 requirement 5: the in-person option, worded in the
                  user's terms — never "diarization" — for the case where
                  everyone is on the same microphone (in the room, or a
                  phone/laptop on speaker) and there is no tab or system
                  audio stream to separate the two voices structurally. Same
                  ToggleButtonGroup shape, same `disabled={live}` as the two
                  options above — nothing about that contract changes.
                  AC-P7: always runnable (getUserMedia-only), so it never
                  gets the sourceAvailability gate the other two do. */}
              <ToggleButton
                value="inperson"
                disabled={live}
                sx={{ textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX }}
              >
                In person (same microphone)
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {/* AC-P7: real DOM text, not a title= or Tooltip — there is no
              hover on a touch device, which is exactly the device class this
              reason exists for. Only rendered when non-empty (usable device,
              or the in-person fallback already covers this session). */}
          {sourceUnavailableReason ? (
            <Typography
              variant="body2"
              sx={{ color: "var(--text-secondary)", mb: 2, ...BREAK_LONG_WORDS_SX }}
            >
              {sourceUnavailableReason}
            </Typography>
          ) : null}

          {/* AC-I1: your own microphone, the same kind of source control as
              "Interviewer audio" above and disabled the same way (AC-I1.7)
              — changing it mid-session would require tearing down and
              rebuilding the "you" capture pipeline, which is out of scope. */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.25}
            sx={{ mb: 2, alignItems: { xs: "stretch", sm: "center" }, flexWrap: "wrap", rowGap: 1 }}
          >
            <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
              Your microphone:
            </Typography>
            <MicPicker value={micDeviceId} onChange={onMicDeviceChange} disabled={live} />
          </Stack>

          {showConsent ? (
            <Alert
              severity="info"
              sx={{ mb: 2, "& .MuiAlert-action .MuiIconButton-root": { ...TOUCH_ICON_SX } }}
              onClose={onDismissConsent}
            >
              {/* F2: names the STT provider once known, never guesses one before
                  then. BUG-H4: the posting-grounding fact used to be appended
                  here too, but this alert is dismissible (onClose) and shown
                  before the user has selected anything — dismissing it before
                  selecting a posting left that fact stated nowhere. It now
                  renders in its own always-visible element below, next to the
                  PostingPicker (see postingGroundingNotice's derivation and
                  its render site further down).

                  AC-M1.5 requirement 6: in-person gets its own, strengthened
                  wording here rather than reusing the tab/system sentence —
                  a shared browser tab is something the other party can see
                  is happening; a microphone sitting in a room is not, so the
                  notice has to say that plainly instead of speaking of "the
                  call". This Alert is still dismissible, though, so it is
                  NOT the only place this is said — see the always-visible
                  notice ABOVE the Collapse this Alert lives inside (BUG-4
                  moved it there so it survives a live session's own
                  auto-collapse), which is what actually satisfies BUG-H4 for
                  this source. */}
              {source === "inperson"
                ? `Recording notice: this in-person conversation is recorded and streamed${sttProviderName ? ` to ${sttProviderName}` : ""} for transcription. Everyone in the room is being recorded, not just you, so get their consent before you start; some regions require all-party consent.`
                : `Recording notice: audio is streamed${sttProviderName ? ` to ${sttProviderName}` : ""} for transcription. Make sure everyone on the call consents before you start — some regions require all-party consent.`}
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
