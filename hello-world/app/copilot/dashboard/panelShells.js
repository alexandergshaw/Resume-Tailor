// ARCH-sticky §3.1. The dashboard's three panel "shells" — split out of
// CopilotDashboard.js so app/copilot/dashboard/CurrentQuestionPanel.js (the
// relocated question panel, now mounted inside the sticky strip rather than
// inside the dashboard's own grid) can use them without CopilotDashboard.js
// and CurrentQuestionPanel.js each holding a copy that can drift.
// CurrentAnswerPanel — which stays in CopilotDashboard.js — is RealPanel's
// other caller, which is why RealPanel cannot simply travel with the
// question panel: copying it would fork the "certain content" look this
// module exists to keep in exactly one place.
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";

// The two "real" panels' shared card look — a plain surface, same as
// QuestionFeed's own question cards. Deliberately distinct from
// AccentPanel's look below: a user glancing at this mid-interview must
// never mistake one for the other (AC-I3.20).
//
// ARCH-sticky §4/G-1: `headingLevel` defaults to "h4" — every existing
// caller (CurrentAnswerPanel, nested under CopilotDashboard.js's own h3)
// keeps rendering byte-identically. StickyQuestionStrip.js is the one
// caller that passes "h3": once CurrentQuestionPanel moved OUT of
// CopilotDashboard and into a strip mounted as its SIBLING, the question's
// heading is no longer a child of "Live dashboard" — it needs to sit one
// level higher, directly under the tab's own h2 (copilotHeadingOrder.test.js
// asserts the resulting sequence).
export function RealPanel({ title, children, headingLevel = "h4" }) {
  return (
    <Box
      sx={{
        p: { xs: 1.25, sm: 1.75 },
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-soft)",
        minWidth: 0,
      }}
    >
      {/* F10: `variant="subtitle2"` alone maps (via MUI's
          defaultVariantMapping) to `h6`, which would skip levels from
          whichever heading actually precedes this one — `component=`
          changes only the rendered element; `variant` (and therefore the
          look) is unchanged. */}
      <Typography variant="subtitle2" component={headingLevel} sx={{ mb: 1, color: "var(--text-secondary)", fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

// The shared card look for content the app is NOT certain about — an
// accent-tinted surface plus an explicit chip, so it can never be read as
// something the interviewer actually said or something already confirmed
// for real (AC-I3.20). Deliberately distinct from RealPanel above.
//
// BUG-1: `chipLabel` is required — its only caller is CurrentQuestionPanel's
// provisional branch, passing `chipLabel="Unconfirmed"`, which names the
// SPECIFIC uncertainty (a real detected utterance of unclear speaker) rather
// than a generic label. Reusing one wrapper (not copying it) is what keeps
// the accent-plus-chip look itself in exactly one place.
export function AccentPanel({ title, children, chipLabel, headingLevel = "h4" }) {
  return (
    <Box
      sx={{
        p: { xs: 1.25, sm: 1.75 },
        borderRadius: 2,
        border: "1px solid var(--accent)",
        background: "var(--accent-soft)",
        minWidth: 0,
      }}
    >
      {/* BLOCKER fix: this row previously had no flexWrap, and the Chip had
          no flexShrink guard. MUI's Chip root carries `overflow: hidden`,
          which zeroes its flex `min-width: auto` floor, so at ~140px of
          available width (well under the row's natural ~262px) the Chip
          shrank first and its label ellipsized down to nothing readable
          ("PREDI…" or narrower). This badge is load-bearing (see
          CurrentQuestionPanel's "Unconfirmed" reuse) — it is what stops
          uncertain content from being read as something confirmed — so it
          must never truncate. WRAP_ROW_SX lets the badge drop to its own
          line intact instead. */}
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", ...WRAP_ROW_SX }}>
        <Typography variant="subtitle2" component={headingLevel} sx={{ color: "var(--text-secondary)", fontWeight: 700 }}>
          {title}
        </Typography>
        <Chip
          size="small"
          label={chipLabel}
          sx={{
            // `height: 18`/`fontSize: 10` unconditionally left no room for
            // the label to wrap onto two lines even after the Stack above
            // gained flexWrap, and 10px uppercase text is below a readable
            // floor on a phone. `xs: "auto"` lets the label wrap; `sm` keeps
            // the original compact pill on pointer-driven layouts.
            height: { xs: "auto", sm: 18 },
            fontSize: { xs: 11, sm: 10 },
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            color: "var(--accent-contrast)",
            background: "var(--accent)",
            // Keeps the badge itself from being the thing that shrinks when
            // the row is tight — see the Stack comment above.
            flexShrink: 0,
            "& .MuiChip-label": { py: { xs: 0.25, sm: 0 } },
          }}
        />
      </Stack>
      {children}
    </Box>
  );
}

// AC-T1.16/I6: the held treatment for the current-question panel. Reuses
// AccentPanel's wrapper/Chip mechanics (WRAP_ROW_SX avoids the "PREDI…"
// ellipsis bug) but with the WARNING accent — `--warning-soft` on
// `--bg-surface` measures only 1.08:1, so the border, badge and release
// control are ALL required, never colour alone (AC-X2). The release button
// is the count-bearing element, one click, uncapped (OpenShift/Mastodon/
// Guardian all ship this pattern); its caption says what is STILL
// happening, so a frozen display doesn't read as broken.
export function HeldQuestionPanel({ title, newerCount, onRelease, live, children, headingLevel = "h4" }) {
  const releaseLabel =
    newerCount > 0
      ? `Release hold and show ${newerCount} newer question${newerCount === 1 ? "" : "s"}`
      : "Release hold";
  return (
    <Box
      sx={{ p: { xs: 1.25, sm: 1.75 }, borderRadius: 2, border: "1px solid var(--warning)", background: "var(--warning-soft)", minWidth: 0 }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", ...WRAP_ROW_SX }}>
        <Typography variant="subtitle2" component={headingLevel} sx={{ flex: 1, minWidth: 0, color: "var(--text-secondary)", fontWeight: 700 }}>
          {title}
        </Typography>
        <Chip
          size="small"
          label="Held on screen"
          sx={{
            height: { xs: "auto", sm: 18 },
            fontSize: { xs: 11, sm: 10 },
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            color: "var(--warning)",
            background: "transparent",
            border: "1px solid var(--warning)",
            flexShrink: 0,
            "& .MuiChip-label": { py: { xs: 0.25, sm: 0 } },
          }}
        />
      </Stack>
      {children}
      <Button
        size="small"
        variant="outlined"
        onClick={onRelease}
        sx={{ mt: 1, textTransform: "none", borderColor: "var(--warning)", color: "var(--warning)", ...TOUCH_TARGET_SX }}
      >
        {releaseLabel}
      </Button>
      {/* Defect 3 fix: was unconditional — a false "is it broken?" claim
          once the session had actually ended. Belt-and-suspenders: that fix
          already keeps `held` from being true while `!live`. Adds a
          live/not-live axis without collapsing the existing three states:
          not held, held, held-with-N-newer. */}
      <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "var(--text-secondary)" }}>
        {live
          ? "Detection and drafting keep running behind the hold; only this panel's display is frozen."
          : "This session has ended, so nothing is running behind this hold anymore — release it to see the dashboard's normal idle state."}
      </Typography>
    </Box>
  );
}
