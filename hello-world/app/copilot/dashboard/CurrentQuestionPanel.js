"use client";

import Typography from "@mui/material/Typography";
import { BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";
import { RealPanel, AccentPanel, HeldQuestionPanel } from "./panelShells";

// ARCH-sticky §2.1/§3.1. Moved out of CopilotDashboard.js: this panel now
// mounts once per client, inside
// app/copilot/dashboard/StickyQuestionStrip.js's sticky strip, rather than
// inside CopilotDashboard's own grid — "relocation, not duplication". Every
// default this panel used to receive implicitly from CopilotDashboard's own
// destructured parameters — the `copy` merge, the `held`/`newerCount`/`live`
// fallbacks, the heading level that made this panel's own heading legal —
// is now the CALLER's job (StickyQuestionStrip for `copy`/heading;
// CopilotClient/PracticeClient for the pin surface), and nothing here
// defaults silently: a caller that drops a prop gets an honest-looking
// WRONG answer rather than a thrown error, which is why
// stickyQuestionGuards.test.js (G-2) and copilotHeadingOrder.test.js (G-1)
// exist as source/render guards rather than relying on this file alone.
//
// This panel is a leaf — it announces nothing of its own accord (enforced
// directly against this file's source by stickyQuestionGuards.test.js's
// G-2) — which is what makes the strip's CONDITIONAL mount (only once a
// question exists) safe: the mount-already-carrying-final-text trap only
// applies to a region that DOES announce itself, and this panel is not one.
// The dashboard's two announcing regions (CurrentAnswerPanel's, SpeakerBar's)
// do not move and are not affected.
//
// BUG-1: `current` can be the array's true LAST entry even though it is
// `provisional` — latestQuestionEntry's fallback for "every entry is
// provisional". Before that branch existed, that fallback rendered through
// RealPanel — the plain treatment, no chip, no accent, no caveat — under the
// same "Current question" heading a confirmed entry gets. By construction a
// provisional entry is one the app CURRENTLY attributes to the candidate's
// own voice, so that plain treatment presented the candidate's own speech as
// the interviewer's question with nothing to tell them apart. This is not a
// rare edge case: at cold start the interviewer speaks first and becomes the
// provisional argmax on word count alone, so their genuine opening question
// is routinely the one flagged provisional — which is exactly why the
// fallback must keep rendering (never nothing) and instead be marked.
//
// R-106's bar is why this is BOTH the accent/chip treatment AND a sentence,
// not one or the other: visual distinction alone is insufficient (a user
// glancing mid-interview, or anyone who can't rely on color/border), text
// alone is insufficient (a user skimming past the caption to the bold
// question line). Reuses AccentPanel rather than a new component so the
// "uncertain content" look stays defined in one place; "Unconfirmed" names
// this uncertainty specifically because this IS a real detected utterance,
// just of unclear speaker — the opposite uncertainty a guess about the
// future would be.
//
// Practice mode never sets `provisional` (see PracticeClient's
// `dashboardQuestions`), so `current?.provisional` is always falsy there and
// this branch never runs — practice always takes the plain `RealPanel` path
// below, unchanged. AC-T1.16: `held` is checked FIRST, above the provisional
// branch — a held entry gets the warning treatment regardless of whether it
// also happens to be provisional; practice mode passes no `pinnedId` (so
// `held` is always false there), which is what keeps it byte-identical to
// before this prop existed.
export default function CurrentQuestionPanel({ current, copy, held, newerCount, onReleasePin, live, headingLevel = "h4" }) {
  if (held) {
    return (
      <HeldQuestionPanel
        title={copy.currentQuestionTitle}
        newerCount={newerCount}
        onRelease={onReleasePin}
        live={live}
        headingLevel={headingLevel}
      >
        {current ? (
          <Typography sx={{ color: "var(--text-primary)", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
            {current.question}
          </Typography>
        ) : (
          <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
            {copy.noQuestion}
          </Typography>
        )}
      </HeldQuestionPanel>
    );
  }
  if (current?.provisional) {
    return (
      <AccentPanel title={copy.currentQuestionTitle} chipLabel="Unconfirmed" headingLevel={headingLevel}>
        <Typography sx={{ color: "var(--text-primary)", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
          {current.question}
        </Typography>
        <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "var(--text-secondary)" }}>
          Not confirmed as the interviewer — this may be your own words, picked up while speaker identity is
          still unsettled.
        </Typography>
      </AccentPanel>
    );
  }
  return (
    <RealPanel title={copy.currentQuestionTitle} headingLevel={headingLevel}>
      {current ? (
        <Typography sx={{ color: "var(--text-primary)", fontWeight: 600, ...BREAK_LONG_WORDS_SX }}>
          {current.question}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          {copy.noQuestion}
        </Typography>
      )}
    </RealPanel>
  );
}
