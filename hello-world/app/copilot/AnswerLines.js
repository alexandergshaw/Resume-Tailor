"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { BREAK_LONG_WORDS_SX } from "./mobileSx";

// AC-K1.1/AC-L1: the one place a drafted answer's lines are actually
// rendered. The reported bug was exactly this markup existing as four
// hand-rolled copies — CopilotDashboard.js's CurrentAnswerPanel and
// PredictedAnswerPanel, QuestionFeed.js's QuestionCard, and practice mode's
// SampleAnswer.js — all built from `answerBullets(cues, points)`, which
// returned the CUES ALONE and discarded the full sentences behind them. The
// cue is a glanceable head, read in the two seconds before speaking; the
// point behind it is the actual substance a candidate can speak from.
// Neither replaces the other, so every line needs both, in one place, so
// there is exactly one copy of that decision left to drift — see
// lib/copilot/answerPoints.js's doc for the fuller history (its own
// `cleanAnswerPoints` filter had already drifted between two copies once).
//
// `lines` is the output of lib/copilot/answerPoints.js's `answerLines(cues,
// points)`: one entry per drafted point, each `{ label, cue, point }`.
// `label` is a bare STAR label word ("Situation", never "Situation:") or
// "" when the point carries none; `cue` is a few-word prompt or "" when
// cues weren't usable for this line (see answerLines's doc for the exact
// rules); `point` is the full speakable sentence and is never empty.
//
// Two renderings, chosen per line rather than once for the whole list,
// because `cue` is decided per-line by answerLines (an all-or-nothing
// pairing can still leave every cue blank for a whole draft):
//
//   - With a cue: the cue (with its label, if any) in `<strong>`, an em
//     dash, then the point — the cue is what's skimmed first, `<strong>`
//     is semantic emphasis (not a styled span) so a screen reader's rendering
//     agrees with the visual one, and the dash keeps the two readable as one
//     clause rather than two unrelated fragments.
//   - Without a cue: the label (if any) followed by the point, exactly the
//     bare string every one of the four call sites rendered before this
//     component existed for a draft that carries no cues — this must not
//     regress that rendering.
//
// Both branches keep the cue and its point inside ONE `<li>`, in reading
// order, so a screen reader announces them as a single item rather than two
// — splitting them into sibling `<li>`s would read as two unrelated bullets
// instead of a prompt and the sentence it heads.
export default function AnswerLines({ lines }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {lines.map((line, i) => (
        <Typography
          key={i}
          component="li"
          variant="body2"
          sx={{ mb: 0.5, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
        >
          {line.cue ? (
            <>
              <strong>
                {line.label ? `${line.label}: ` : ""}
                {line.cue}
              </strong>
              {" — "}
              {line.point}
            </>
          ) : (
            <>
              {line.label ? `${line.label}: ` : ""}
              {line.point}
            </>
          )}
        </Typography>
      ))}
    </Box>
  );
}
