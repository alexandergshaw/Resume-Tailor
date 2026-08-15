"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { hearingState } from "@/lib/copilot/liveHearing";
import { visuallyHidden } from "@/lib/copilot/answerStatus";

// AC-S3.6/S3.7/S3.10: the always-visible "what is the copilot hearing right
// now" strip. See lib/copilot/liveHearing.js's own header for the bug this
// exists to fix — a live session that looked "● Live" and transcribed
// nothing, indistinguishable on screen from one that was actually working,
// because the transcript AND the detected-question feed both lived behind
// a disclosure that collapses on every Start. Split out of CopilotClient.js
// purely to keep that file under this project's 1000-line cap (AC-S3.11) —
// every decision rendered here comes from the pure hearingState(); this
// file is presentation only.
//
// AC-S3.7: silence-specific copy, written here (not in hearingState, whose
// test contract takes no `source`) so it can name what to check for the
// SELECTED capture source — a tab/system session and an in-person one fail
// in different, checkable ways.
function silenceHint(source) {
  if (source === "inperson") {
    return "Check that your microphone is selected and not muted.";
  }
  return "Check that the shared tab or screen is still playing audio.";
}

// D5: rendered on EVERY pass — CopilotClient.js now mounts this component
// unconditionally inside the bounded live wrapper (D1's fix put it there,
// above the dashboard, rather than behind `{live ? ... : ...}`), so the
// hidden live regions below are already present in the DOM before a session
// ever goes live, and only their TEXT changes once one does. Before that
// move, this component lived entirely inside CopilotClient's `live` branch —
// the region node was INSERTED at the exact instant it first had content,
// which is the "mounts already carrying its final text" trap
// answerStatus.js's header documents, and the first sentence of every
// session was silently dropped. The visible Alert below still only renders
// while `live`; only the two hidden regions are unconditional.
export default function LiveHearingStrip({ live, finals, interims, startedAt, liveSince, now, speakerSnapshot, source }) {
  const state = hearingState({ live, finals, interims, startedAt, liveSince, now, speakerSnapshot });
  const isSilent = state.status === "silent";
  const isWaiting = state.status === "waiting";
  const body =
    state.label && state.text ? `${state.label}: ${state.text}` : state.text || "Listening for speech.";
  const withHint = isSilent ? `${body} ${silenceHint(source)}` : body;

  // D3: the visible Alert carries no `role`/`aria-live` of its own any
  // more. It used to — `role="status"` (which implies `aria-atomic`) on a
  // node whose text WAS the interim transcript, updating on every STT
  // frame, meant every partial word re-announced the whole sentence: a
  // probe measured five interim frames producing five full
  // re-announcements, and that traffic starved the five OTHER polite
  // regions on this screen. The category — not the transcript — is what's
  // worth announcing, and that now lives in the two regions below instead.
  //
  // D4: the zero-width-space parity mechanism that used to sit here is
  // deleted outright, not merely unused. It defended a state this component
  // can never reach — every entry into "silent" is necessarily preceded by
  // a DIFFERENT status text (interim/"heard"/"waiting" are never
  // byte-identical to the silence sentence), so React's `oldText ===
  // newText` bail could never fire for it — while costing an extra DOM
  // write per silence and leaking a stray U+200B into copied text on
  // odd-numbered silences. Once the region below carries only the
  // CATEGORY (which changes far less often than the transcript did), no
  // coalescing guard is needed at all.
  return (
    <>
      {live ? (
        <Alert
          // D3: MUI's Alert defaults its OWN `role` prop to "alert" when
          // none is passed (see node_modules/@mui/material/Alert/Alert.js)
          // — simply omitting `role`/`aria-live` here would still leave
          // this node an implicit assertive live region, re-announcing the
          // whole message on every interim frame exactly as the explicit
          // `role="status"` this replaces did. `null` (not "omitted")
          // is what actually clears it — MUI's default parameter only
          // engages when the prop is `undefined`.
          role={null}
          severity={isSilent ? "warning" : "info"}
          sx={{
            mb: 1.5,
            py: 0.5,
            // AC-S3.6: bounded to about two lines — live mode must still not
            // need scrolling to see whether the copilot is hearing anything.
            "& .MuiAlert-message": {
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            },
          }}
        >
          {withHint}
        </Alert>
      ) : null}
      {/* D3: polite — "listening" is informational, never time-critical,
          and must be free to queue behind other polite chatter on the
          page. Carries the CATEGORY sentence only while genuinely
          "waiting"; empty for "heard" (never the transcript text) and
          empty for "silent" (that severity has its own region below, so a
          silence sentence is never announced twice at two different
          priorities). */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {live && isWaiting ? body : ""}
      </Box>
      {/* D3: a SEPARATE role="alert" element, used only for the silence
          sentence — a session going deaf mid-interview is time-critical and
          must not queue behind the polite region's ordinary chatter. Never
          shares a node with the polite region above. */}
      <Box component="span" role="alert" sx={visuallyHidden}>
        {live && isSilent ? withHint : ""}
      </Box>
    </>
  );
}
