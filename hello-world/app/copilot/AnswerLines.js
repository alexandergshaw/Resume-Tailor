"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { BREAK_LONG_WORDS_SX } from "./mobileSx";
import ExpansionPanel from "./ExpansionPanel";

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
// THREE renderings, chosen per line rather than once for the whole list,
// because `cue` and `emphasis` are decided per-line by answerLines (an
// all-or-nothing pairing can still leave every cue blank for a whole draft):
//
//   - With an `emphasis` span: the label (if any) at its own weight, then the
//     point ONCE, with `point.slice(start, end)` wrapped in a single
//     `<strong>`. No cue, no em dash. This is the ordinary case now: the cue
//     was a verbatim fragment of the sentence behind it, so rendering both
//     printed the same words twice —
//
//       before  **Built and scaled a payments platform** — I built and scaled
//               a payments platform.
//       after   I **built and scaled a payments platform**.
//
//     The bolded characters come from the POINT, so a cue whose first letter
//     answerCues.js's `tidy` capitalised renders in the point's own case.
//   - With a cue and no span: the cue (with its label, if any) in `<strong>`,
//     an em dash, then the point — byte-identical to what this component has
//     always rendered. A genuinely paraphrasing cue, which is what the Gemini
//     path supplies, has no run to locate and lands here.
//   - With neither: the label (if any) followed by the point, exactly the
//     bare string every one of the four call sites rendered before this
//     component existed for a draft that carries no cues — this must not
//     regress that rendering.
//
// WHY THE STAR LABEL LEAVES THE BOLD. The cue branch wraps `{label}: {cue}`,
// so today the label is INSIDE the emphasis. The emphasised run now sits
// inside the sentence, and exactly one `<strong>` per line is the rule (two
// would announce two emphasised runs to a screen reader where the design means
// one), so the label cannot stay in it. It keeps a weight of its own instead —
// answerCues.js calls the label "the navigation", and it is how a candidate
// mid-interview finds the Result beat without reading four sentences. That
// weight is `fontWeight: 600` on the label's own element rather than a second
// `<strong>`: semantically it is not emphasis, it is a caption.
//
// A malformed span renders as though there were none rather than as a
// half-sliced sentence, because the one thing worse than an unemphasised
// bullet is a bullet whose words are missing or doubled.
//
// Both branches keep the cue and its point inside ONE `<li>`, in reading
// order, so a screen reader announces them as a single item rather than two
// — splitting them into sibling `<li>`s would read as two unrelated bullets
// instead of a prompt and the sentence it heads.
//
// ARCH §4e/AC-6: `line.pageSource` — `{ id, title }` or `null` — is
// lib/copilot/answerPoints.js's THIRD positional field, resolved and
// shape-validated there (never re-validated here). Rendered inside this
// SAME `<li>`, after the point, in reading order — not a sibling element,
// not a separate list beside this one, and not behind a disclosure — so a
// screen reader announces "point, then where it came from" as one item, and
// a sighted reader mid-interview sees it with zero extra clicks (AC-6.4).
// It is plain text, not a colour or icon alone (WCAG 1.4.1): the source is
// the only thing that carries the meaning, so it has to survive being read
// aloud or printed in black and white.
//
// A line with `pageSource: null` renders nothing extra — no placeholder row,
// no "no source" caption — and when every line in `lines` has none, this
// component's output is identical to before the field existed (AC-6.3): the
// per-line check below is the only thing gating it, there is no separate
// "any sources at all?" header to suppress.
//
// Wording: "From your {title} page." names the page the citation was
// validated against (lib/copilot/pageCitations.js's resolvePageSources,
// wave 1), never a claim about how much of the page the model read — this
// component only ever receives a title that already passed that whitelist,
// so it has nothing further to hedge.
//
// Colour: `--text-secondary`, not `--text-muted`. R-228 settled this rule in
// numbers — muted measures 3.90:1 against `--bg-soft`, the fill of all three
// panels that render this component (CopilotDashboard's RealPanel,
// QuestionFeed's QuestionCard, practice's SampleAnswer), against the 4.5:1
// WCAG 1.4.3 requires for normal text; `variant="caption"` is 0.75rem, so the
// large-text allowance does not apply. Secondary measures 6.67:1 in light and
// clears the bar in dark. The existing muted uses elsewhere under app/copilot
// are a pre-existing problem, not licence to add another to the one surface
// whose entire job is to make an answer trustworthy.
// The emphasis span answerLines reported, but only once it is actually usable
// against THIS point: two integers inside the string, in order. Anything else
// falls back to the unemphasised render.
function usableSpan(emphasis, point) {
  if (!emphasis) return null;
  const { start, end } = emphasis;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > String(point || "").length) return null;
  return { start, end };
}

// GOING DEEPER ON ONE BULLET. `expansion` is optional and is usually absent:
// ExpansionPanel falls back to the context an ExpansionScope provides, which is
// how the three components that render this one get the feature without being
// edited. With neither, ExpansionPanel renders null and this component's output
// is byte-identical to what it was before the feature existed.
//
// THE WHOLE DIFF THIS FEATURE MAKES TO THIS FILE is one import, this prop, and
// the three lines between the sentinels below. `usableSpan`, the three-branch
// point render and the citation block are untouched, deliberately: the `<li>`'s
// single `<strong>` is produced by one expression over one character range, and
// nothing added here reads `line.emphasis`, slices `line.point`, or wraps a
// text node that render produced. The sentinels also give the next chunk to
// edit this file a region to slice AROUND rather than through.
export default function AnswerLines({ lines, expansion }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {lines.map((line, i) => {
        const span = usableSpan(line.emphasis, line.point);
        return (
        <Typography
          key={i}
          component="li"
          variant="body2"
          sx={{ mb: 0.5, color: "var(--text-primary)", ...BREAK_LONG_WORDS_SX }}
        >
          {span ? (
            <>
              {line.label ? (
                <Box component="span" sx={{ fontWeight: 600 }}>{`${line.label}: `}</Box>
              ) : null}
              {line.point.slice(0, span.start)}
              <strong>{line.point.slice(span.start, span.end)}</strong>
              {line.point.slice(span.end)}
            </>
          ) : line.cue ? (
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
          {line.pageSource ? (
            <Typography
              component="span"
              variant="caption"
              sx={{ display: "block", color: "var(--text-secondary)", mt: 0.25, ...BREAK_LONG_WORDS_SX }}
            >
              From your {line.pageSource.title} page.
            </Typography>
          ) : null}
          {/* expansion:start */}
          <ExpansionPanel line={line} api={expansion} />
          {/* expansion:end */}
        </Typography>
        );
      })}
    </Box>
  );
}
