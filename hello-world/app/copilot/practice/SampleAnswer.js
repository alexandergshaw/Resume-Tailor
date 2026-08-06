"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// G1: the toggleable sample answer for practice mode's current question.
// Purely presentational — every bit of state (whether it's shown, whether a
// draft is in flight, the cached answer, which engine drafted it) lives in
// PracticeClient's useSampleAnswer hook and arrives here as props, same
// contract as QuestionCard/AnswerFeedback. The toggle button lives here
// rather than in a separate control so its "Show/Hide" label and the panel
// it opens can never disagree about `visible`.
//
// AC-H9: `mode: "answer"`'s response now returns `points` — bullets, each a
// complete, speakable sentence (STAR-labeled for a behavioral/leadership
// shape), replacing G2's earlier single prose string. Defends the same way
// the old paragraphsOf did against a missing/malformed value: anything that
// isn't a non-empty string is dropped rather than rendered as a blank
// bullet or throwing.
function cleanPoints(points) {
  return (Array.isArray(points) ? points : [])
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => p.trim());
}

// AC-G2-C-8: states what the answer was actually built from, derived from
// the response's `grounding` flags — never a static claim, since whether
// the submitted resume/cover letter were found is per-request. When
// neither was found, says so plainly rather than implying documents were
// used. Combined with the engine fact (AC-G1-8) in one sentence rather than
// two, since both describe the same draft.
function sourceCaption(isEmbedded, grounding) {
  const engineText = isEmbedded
    ? "Drafted on this server with no AI provider"
    : "Drafted by Google Gemini";
  const resume = !!grounding?.resume;
  const coverLetter = !!grounding?.coverLetter;
  if (resume && coverLetter) {
    return `${engineText} from the resume and cover letter you submitted for this posting.`;
  }
  if (resume) {
    return `${engineText} from the resume you submitted for this posting.`;
  }
  if (coverLetter) {
    return `${engineText} from the cover letter you submitted for this posting.`;
  }
  return `${engineText} from your prep context only — no submitted resume or cover letter was found for this posting.`;
}

export default function SampleAnswer({
  visible,
  status, // idle | loading | done | error
  // AC-H9.36: the sample answer as a bullet-point array (each a complete,
  // speakable sentence) — see useSampleAnswer.js and cleanPoints above.
  points,
  grounding,
  error,
  isEmbedded,
  onToggle,
  onRetry,
  onRegenerate,
}) {
  const cleanedPoints = cleanPoints(points);
  // AC-G1-11: only offered once a draft is actually on screen — not while
  // it's loading, not while hidden, and not in the error state (which has
  // its own "Retry" action instead).
  const canRegenerate = visible && status === "done" && cleanedPoints.length > 0;

  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Button size="small" variant="outlined" onClick={onToggle}>
          {visible ? "Hide sample answer" : "Show sample answer"}
        </Button>
        {canRegenerate ? (
          <Button size="small" variant="text" onClick={onRegenerate}>
            Regenerate
          </Button>
        ) : null}
      </Stack>

      {visible ? (
        <Box
          sx={{
            mt: 1,
            p: 2,
            borderRadius: 2,
            border: "1px solid var(--border)",
            background: "var(--bg-soft)",
          }}
        >
          {status === "loading" ? (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <CircularProgress size={18} />
              <Typography sx={{ color: "var(--text-muted)" }}>Drafting a sample answer…</Typography>
            </Stack>
          ) : null}

          {status === "error" ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={onRetry}>
                  Retry
                </Button>
              }
            >
              {error || "Could not draft a sample answer."}
            </Alert>
          ) : null}

          {status === "done" && cleanedPoints.length > 0 ? (
            <>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {cleanedPoints.map((point, i) => (
                  <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5, color: "var(--text-primary)" }}>
                    {point}
                  </Typography>
                ))}
              </Box>
              <Typography variant="caption" sx={{ color: "var(--text-muted)", display: "block", mt: 1 }}>
                {sourceCaption(isEmbedded, grounding)}
              </Typography>
            </>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
