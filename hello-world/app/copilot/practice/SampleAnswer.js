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
// G2: renders `mode: "answer"`'s response — a single prose string the
// candidate could actually say out loud, not the G1 bullet-point array
// (AC-G2-C-8). Split into paragraphs on blank lines; a bullet list would
// misrepresent something meant to be spoken.
function paragraphsOf(answer) {
  return String(answer || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
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
  answer,
  grounding,
  error,
  isEmbedded,
  onToggle,
  onRetry,
  onRegenerate,
}) {
  // AC-G1-11: only offered once a draft is actually on screen — not while
  // it's loading, not while hidden, and not in the error state (which has
  // its own "Retry" action instead).
  const canRegenerate = visible && status === "done" && !!answer;
  const paragraphs = paragraphsOf(answer);

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

          {status === "done" && paragraphs.length > 0 ? (
            <>
              <Stack spacing={1.5}>
                {paragraphs.map((paragraph, i) => (
                  <Typography key={i} variant="body2" sx={{ color: "var(--text-primary)" }}>
                    {paragraph}
                  </Typography>
                ))}
              </Stack>
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
