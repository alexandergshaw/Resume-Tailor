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
import { companyResearchDestination } from "@/lib/copilot/groundingNotice";
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

// Defect fix (adversarial review, AC-P7): stable id for the "why is this
// disabled" sentence rendered below (see its render site further down), so
// the two capability-gated ToggleButtons can each carry an
// `aria-describedby` pointing at it. Same module-level-constant convention
// as SETUP_REGION_ID directly above.
const SOURCE_UNAVAILABLE_REASON_ID = "copilot-source-unavailable-reason";

export default function SessionSetup({
  live,
  expanded,
  onToggleExpanded,
  postingSummary,
  micLabel,
  source,
  onSourceChange,
  // Defect 2 (regression pass): the one fact this file needs to make its
  // own recording-consent notice honest — see that notice's render site
  // below for the full reasoning. Passed from CopilotClient, the same
  // `useEngine`-derived value `postingGroundingNotice`/VoiceCueSidebar
  // already read.
  isEmbedded,
  // Defect fix (adversarial review): this file has exactly one caller today
  // (CopilotClient), which always passes the full `{ tab, system }` shape —
  // but nothing enforced that, and reading `.tab`/`.system` straight off an
  // undefined prop would crash the instant a second caller rendered this
  // component without a capability gate of its own. Defaulted right in the
  // destructure, the same plain-default convention optional props already
  // use elsewhere in this component tree (e.g. useCopilotDashboard.js's
  // `active = false`), to the value that reproduces today's behaviour
  // exactly: every source available, so the capability gate never trips.
  sourceAvailability = { tab: true, system: true },
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
  // Defect 2 (regression pass): reused verbatim from
  // lib/copilot/groundingNotice.js rather than re-derived here — see that
  // module's own `companyResearchDestination` doc (BL-1) for the full,
  // code-verified reasoning behind each engine's wording. `hasCompany: true`
  // is fixed here on purpose: this consent notice is shown BEFORE a posting
  // is necessarily even selected (see showConsent's own render site below),
  // so it cannot condition on any one posting's actual company field the
  // way postingGroundingNotice's own hasCompany argument does — it states
  // what happens if the candidate does end up asking about a company later
  // in the session, the same "worth disclosing before the fact" reasoning
  // AC-T2.14/E2 already gives for why this has to be a standing notice
  // rather than one shown alongside the request.
  //
  // Verified against lib/scrape/webSearch.js directly (not assumed):
  // searchPostingUrls tries Brave first (BRAVE_SEARCH_API_KEY), then Google
  // Programmable Search (GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID),
  // then falls through to a keyless DuckDuckGo scrape — the exact
  // "Brave, Google or DuckDuckGo" wording companyResearchDestination uses
  // for the embedded engine.
  const companyResearchNotice = companyResearchDestination({ isEmbedded, hasCompany: true });
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
              {/* AC-P7, revised for the adversarial-review defect fix: this
                  used to be one `disabled={live || !sourceAvailability.tab}`
                  — a single native `disabled`, which SpeakerChip.js already
                  documents the problem with (a `disabled` button drops out
                  of the tab order and stops being focusable in most
                  browsers). That cost a screen-reader user both the control
                  AND the `sourceUnavailableReason` sentence explaining why
                  it's missing, since browse-mode is the only way to reach
                  text with nothing pointing at it.

                  The two conditions are deliberately NOT folded back into
                  one boolean. `live` keeps the real, native `disabled`:
                  mid-session the source genuinely cannot change (rebuilding
                  the capture pipeline is out of scope), and
                  `sourceUnavailableReason` never describes "a session is
                  running" — it only ever describes a capability gap — so
                  there is nothing to announce for that case. The capability
                  gate (`!sourceAvailability.tab`/`.system`) is the one that
                  DOES have something to announce, so it uses `aria-disabled`
                  plus the same inert-click-handler pattern SpeakerChip.js
                  established, wired to `aria-describedby` — pointing at
                  SOURCE_UNAVAILABLE_REASON_ID only while that reason is
                  actually rendered below, never a dangling reference to an
                  absent element. Either way, activating a capability-gated
                  button must not change `source`: `handleInertSourceSelect`
                  calls `event.preventDefault()`, which stops ToggleButton
                  from ever forwarding the click to the group's own
                  `onChange` (see ToggleButton's `handleChange`). */}
              <ToggleButton
                value="tab"
                disabled={live}
                aria-disabled={!live && !sourceAvailability.tab ? true : undefined}
                aria-describedby={
                  !live && !sourceAvailability.tab && sourceUnavailableReason
                    ? SOURCE_UNAVAILABLE_REASON_ID
                    : undefined
                }
                onClick={!live && !sourceAvailability.tab ? handleInertSourceSelect : undefined}
                sx={{ textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX }}
              >
                Browser tab
              </ToggleButton>
              <ToggleButton
                value="system"
                disabled={live}
                aria-disabled={!live && !sourceAvailability.system ? true : undefined}
                aria-describedby={
                  !live && !sourceAvailability.system && sourceUnavailableReason
                    ? SOURCE_UNAVAILABLE_REASON_ID
                    : undefined
                }
                onClick={!live && !sourceAvailability.system ? handleInertSourceSelect : undefined}
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
              or the in-person fallback already covers this session).
              Defect fix: carries SOURCE_UNAVAILABLE_REASON_ID now, so the
              two capability-gated ToggleButtons above can reference it via
              `aria-describedby` — only while this branch is the one
              actually rendering, so that reference is never dangling. */}
          {sourceUnavailableReason ? (
            <Typography
              id={SOURCE_UNAVAILABLE_REASON_ID}
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
                  this source.

                  AC-T2.14/E2 (Group T amendment, adversarial review): before
                  the company-research voice cue, the STT provider was the
                  ONLY outbound destination this session ever created, so
                  naming it here was a complete disclosure. It no longer is —
                  a spoken request to research the company sends data
                  through POST /api/company-research. That fetch fires the
                  moment the cue is recognized, with nothing to click and
                  nothing to confirm, so the disclosure has to be standing
                  and read before the fact rather than shown alongside the
                  request.

                  Defect 2 fix (regression pass): the sentence AC-T2.14/E2
                  added here claimed, unconditionally, that the request
                  "sends its name, this job's title and the posting text" —
                  true on the non-embedded (Gemini) engine, but FALSE on the
                  embedded one: app/api/company-research/route.js's embedded
                  branch calls `researchCompanyLocal({ company, jobTitle })`
                  with no `posting` at all, so the posting text is never
                  sent — the exact fact `companyResearchDestination` already
                  states correctly elsewhere on this same screen
                  (VoiceCueSidebar's foot-of-rail note), which made the two
                  disclosures contradict each other. It also named no
                  recipient ("for that search") where the honest answer is
                  engine-specific: Google Gemini on one engine, one of
                  Brave/Google/DuckDuckGo (see lib/scrape/webSearch.js's own
                  provider order) on the other. `companyResearchNotice`
                  (computed above) is that same shared, engine-aware,
                  code-verified sentence, reused rather than re-derived a
                  third time — CompanyBriefPanel.js and VoiceCueSidebar.js
                  already reuse it for the same reason.

                  Known residual, left AS IS on purpose: this Alert is still
                  inside the Collapse below and still dismissible (onClose),
                  so it is not on screen for the entire life of a live
                  session — the "Show setup"/"Hide setup" toggle and
                  `start()`'s own setSetupExpanded(false) both remove it once
                  a session goes live, and dismissing it removes it even
                  earlier. Unlike the mic-recording sentence above (BUG-4),
                  this one is deliberately NOT hoisted out of the Collapse:
                  VoiceCueSidebar's own foot-of-rail note (collapsed and
                  expanded) already carries the identical fact through the
                  ENTIRE live window — the one window a spoken cue can ever
                  fire in (BL-2) — so this Alert is not the sole carrier of
                  the claim the way the mic-recording sentence was before
                  BUG-4. This sentence is what a candidate reads BEFORE
                  starting, not what has to survive the session.

                  Added to both branches below (the cue is not
                  audio-source-specific); the second branch's em dash was
                  already replaced with a period by AC-T2.14/E2 — a screen
                  reader does not speak an em dash as a pause at default
                  punctuation settings. */}
              {source === "inperson"
                ? `Recording notice: this in-person conversation is recorded and streamed${sttProviderName ? ` to ${sttProviderName}` : ""} for transcription. Everyone in the room is being recorded, not just you, so get their consent before you start; some regions require all-party consent. The company-research voice cue is separate: ${companyResearchNotice}`
                : `Recording notice: audio is streamed${sttProviderName ? ` to ${sttProviderName}` : ""} for transcription. Make sure everyone on the call consents before you start. Some regions require all-party consent. The company-research voice cue is separate: ${companyResearchNotice}`}
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

// Defect fix (adversarial review): an explicit no-op, same reasoning as
// SpeakerChip.js's own handleInertClick — a capability-disabled
// ToggleButton stays a real, focusable, clickable element (so its
// aria-disabled state and aria-describedby reason reach a screen reader),
// but the click itself must never select that source. Calling
// `preventDefault()` here is what stops ToggleButton's `handleChange` from
// forwarding the event on to the ToggleButtonGroup's `onChange` — see the
// comment at the two call sites above.
function handleInertSourceSelect(event) {
  event.preventDefault();
}
