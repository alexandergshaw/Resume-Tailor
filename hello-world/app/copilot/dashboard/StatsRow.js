"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { PACE_LABEL_TEXT, FILLER_LABEL_TEXT } from "@/lib/copilot/dashboardCopy";

// ARCH-stats-in-strip r3 §2.3. The speaking-stats reading that lives OUTSIDE
// the sticky strip's capped question box (StickyQuestionStrip.js) — the
// slice: "the speaking stats (i.e. filler and speed) must stay on screen at
// all times along with the question". Two lines, one reading each, always —
// not a wrapping flex row. `ReadingSlot`/`DeliveryPanel`
// (CopilotDashboard.js) already own the coloured, labelled, single-row
// treatment for the dashboard below; this is a DIFFERENT, narrower widget
// with a measured reason to exist: the shipped wrapping form reflows across
// strip widths (worst delta 100px over the sweep this design measured), and
// a strip that reflows as a reading arrives mid-answer pushes the question
// down with it. One reading per line plus a constant `minHeight` makes the
// row's own height a function of root font size alone, never of the text
// inside it.
//
// `STATS_RESERVE` reserves TWO body2 line boxes plus a small allowance over
// the row's own `rowGap` — see useStickyTop.js's STATS_FLOOR_PX/
// STATS_FLOOR_REM for the derivation; restated here as one literal (not
// imported) because this is the only place it is actually applied as a
// style, the same reasoning that keeps useStickyTop.js's own five/eight cap
// constants module-local (see that file's own comment).
const STATS_RESERVE = "calc(4px + 2.51rem)";

// `minHeight`, never `height`. Above the width bound the content never
// exceeds this reservation (measured 0 violations); below the bound the row
// simply is not hosted at all. So the one failure mode a wrong bound could
// ever produce is a slightly taller strip, never a truncated reading —
// truncation is the AccentPanel "PREDI…" defect (panelShells.js:75-84) and
// must not be reintroduced here. This is also what absorbs an unclamped,
// implausible wpm value with no code change: `computeLivePace` clamps
// nothing (livePace.js), so a short-span frame can render four digits, and
// a taller row — not a cut-off one — is the correct outcome.
function paceText(pace) {
  if (!pace?.measured) return "speed: not measured yet"; // CopilotDashboard.js's own literal, reused verbatim
  const label = PACE_LABEL_TEXT[pace.paceLabel] || pace.paceLabel;
  // `wpm`, not `words/min` — the one deliberate divergence from the
  // dashboard's own wording (§2.3). It is the unit token, not the label,
  // and it is the entire reason the strip's width bound is narrower than a
  // spelled-out unit would allow.
  return `${Math.round(pace.wordsPerMinute)} wpm · ${label}`;
}

function fillerText(fillers) {
  if (!fillers?.measured) return "filler: not measured yet"; // CopilotDashboard.js's own literal, reused verbatim
  const label = FILLER_LABEL_TEXT[fillers.fillerLabel] || fillers.fillerLabel;
  // The filler line never binds the strip's width bound (measured), so it
  // keeps the dashboard's exact wording — including the word "filler"
  // itself, without which "12.5% · Clean" would be ambiguous ("12.5% of
  // what?") in the one label that does not otherwise contain the word.
  return `${fillers.fillerRate.toFixed(1)}% filler · ${label}`;
}

// Each line gates on its OWN `measured` flag (never a combined gate, never
// object truthiness — both computeLivePace/computeLiveFillers return an
// object on every path) so one signal being unmeasured never hides or
// erases the other, and a reading is NEVER printed as a fabricated zero
// (AC-I2.14): `measured: false` always renders the shipped literal above,
// whatever numeric fields the reading object happens to still be carrying.
//
// No border, no fill, no padding, no heading, no live region and no
// interpolated aria-label — the row mounts once per session and its text
// then changes on every tick of the client's 1-second clock; a live region
// or an aria-label that echoed a reading would re-announce a wpm figure
// every second, over the interviewer, which is worse than the silence G-2
// guards CurrentQuestionPanel/panelShells.js for and is exactly the same
// scan applied here. Ink colour: the SECONDARY body text token only, never
// the muted one, and never either of the dashboard's own two threshold-
// colour lookups (the ones DeliveryPanel keys its coloured labels off of) —
// measured on this strip's own canvas-colour ground, the warning token
// fails WCAG 1.4.3 there where the dashboard's own softer ground passes it,
// so the threshold word (`Slow`/`Rushed`, `Heavy filler`) is this row's ONLY
// carrier of "is this a problem", never colour (WCAG 1.4.1).
export default function StatsRow({ pace, fillers }) {
  return (
    <Box sx={{ display: "grid", rowGap: 0.25, minHeight: STATS_RESERVE, mt: 1.5 }}>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
        {paceText(pace)}
      </Typography>
      <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
        {fillerText(fillers)}
      </Typography>
    </Box>
  );
}
