"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";
import AnswerAids from "./AnswerAids";

// N161: the worked solution a detected coding / pseudocode question shows IN
// PLACE OF the spoken answer. One component, rendered by all five answer sites
// (CopilotDashboard.js's CurrentAnswerPanel and HistoryItem, QuestionFeed.js's
// QuestionCard, practice mode's SampleAnswer.js) -- the same "one decision, one
// place" reasoning AnswerLines.js and AnswerAids.js are shared for. Each site
// gates on the record's `codingSolution` BEFORE its points check, so a coding
// card never also shows a spoken list beside the code.
//
// Purely presentational: `solution` is the already-validated
// `{ approach, language, code, complexity, edgeCases }` object the answer route
// builds (lib/copilot/codingSolution.js normalizeCodingSolution). Nothing here
// decides whether the code is right.
//
// THE CODE BLOCK. The `code` string reaches the DOM verbatim in a `<pre>`, never
// through answerLines / deriveAnswerFromPoints, which split on sentences, join
// with a single space and drop first-person and imperative lines -- all of which
// would destroy indentation, line breaks and a `# I keep ...` comment in correct
// code. `whiteSpace` and `fontFamily` are an INLINE `style` attribute, on
// purpose and not `sx`: jsdom resolves only an element's own style attribute, so
// an sx-declared value is invisible to the one assertion that can pin it
// (CitationDetail.test.js:266-270 documents the same trap). `pre-wrap`, not
// `pre`, so a long line wraps at phone width instead of being clipped by
// app/globals.css's root overflow-x rule. Purely visual declarations (padding,
// border, background) stay in `sx`.
//
// D1: a coding card keeps the posting's vocabulary (buzzwords) and nothing else
// from AnswerAids. A resume anchor, an example project, per-point page sources
// and per-bullet expansion are claims about a SPOKEN answer; a worked solution
// is general knowledge, so none of them can enter through this component's
// props.
const MONOSPACE_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

// The labels are a caption in the same voice AnswerAids' row labels use, and
// not headings, for the same reason it gives: no heading level is added under
// whichever heading already encloses this on each of its five parents.
function PartLabel({ children }) {
  return (
    <Typography
      variant="caption"
      component="p"
      sx={{ m: 0, mb: 0.25, color: "var(--text-secondary)", fontWeight: 700, letterSpacing: 0.2 }}
    >
      {children}
    </Typography>
  );
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

export default function CodeSolution({ solution, buzzwords }) {
  const approach = trimmed(solution?.approach);
  const language = trimmed(solution?.language);
  const complexity = trimmed(solution?.complexity);
  const code = typeof solution?.code === "string" ? solution.code : "";
  const edgeCases = (Array.isArray(solution?.edgeCases) ? solution.edgeCases : []).filter(
    (e) => typeof e === "string" && e.trim(),
  );

  return (
    <Box sx={BREAK_LONG_WORDS_SX}>
      {approach ? (
        <Box sx={{ mb: 1.25 }}>
          <PartLabel>Approach</PartLabel>
          <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
            {approach}
          </Typography>
        </Box>
      ) : null}

      {code ? (
        <Box sx={{ mb: 1.25 }}>
          <PartLabel>{language ? `Code (${language})` : "Code"}</PartLabel>
          <Box
            component="pre"
            style={{ whiteSpace: "pre-wrap", fontFamily: MONOSPACE_STACK }}
            sx={{
              m: 0,
              p: 1.25,
              borderRadius: 1,
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
              fontSize: "0.8125rem",
              lineHeight: 1.5,
              ...BREAK_LONG_WORDS_SX,
            }}
          >
            {code}
          </Box>
        </Box>
      ) : null}

      {complexity ? (
        <Box sx={{ mb: 1.25 }}>
          <PartLabel>Complexity</PartLabel>
          <Typography variant="body2" sx={{ color: "var(--text-primary)" }}>
            {complexity}
          </Typography>
        </Box>
      ) : null}

      {edgeCases.length > 0 ? (
        <Box sx={{ mb: 0.5 }}>
          <PartLabel>Edge cases</PartLabel>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {edgeCases.map((edge, i) => (
              <Typography key={i} component="li" variant="body2" sx={{ color: "var(--text-primary)" }}>
                {edge}
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}

      <AnswerAids buzzwords={buzzwords} />
    </Box>
  );
}

// AC-10: the embedded engine has no model, so it cannot write code, and it must
// not pretend to. The route returns a `codingFallback` marker string instead of
// a `codingSolution`; every site that renders a worked solution renders this in
// the same slot when it has the marker and no solution. No code block, no
// points list -- an honest one-line statement of what to do instead.
const CODING_FALLBACK_DEFAULT =
  "The on-device engine can't write a worked code solution. Switch to the AI engine for approach, code, complexity, and edge cases.";

export function CodingFallbackNote({ message }) {
  return (
    <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
      {trimmed(message) || CODING_FALLBACK_DEFAULT}
    </Typography>
  );
}
