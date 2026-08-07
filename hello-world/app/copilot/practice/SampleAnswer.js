"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { answerBullets } from "@/lib/copilot/answerPoints";
import { answerStatusMessage, visuallyHidden } from "@/lib/copilot/answerStatus";
import AnswerAids from "../AnswerAids";

// G1: the toggleable sample answer for practice mode's current question.
// Purely presentational — every bit of state (whether it's shown, whether a
// draft is in flight, the cached answer, which engine drafted it) lives in
// PracticeClient's useSampleAnswer hook and arrives here as props, same
// contract as QuestionCard/AnswerFeedback. The toggle button lives here
// rather than in a separate control so its "Show/Hide" label and the panel
// it opens can never disagree about `visible`.
//
// AC-H9: `mode: "answer"`'s response returns `points` — bullets, each a
// complete, speakable sentence (STAR-labeled for a behavioral/leadership
// shape), replacing G2's earlier single prose string.
//
// AC-K1.1: what this panel RENDERS is `cues` — the same beats cut down to a
// few words each, because a sample answer is read in the seconds before
// speaking and a paragraph of complete sentences cannot be. The full points
// are still what the draft IS (and what the derived prose `answer` comes
// from); they are the fallback here only when no cues came back. That
// decision is answerBullets in lib/copilot/answerPoints.js, shared with
// CopilotDashboard.js's two answer panels and QuestionFeed.js's card rather
// than written out three times — see that module's doc for why (BUG-J6: two
// copies of its sibling filter had already drifted).

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
  // speakable sentence) — see useSampleAnswer.js and answerBullets
  // (lib/copilot/answerPoints.js) above.
  points,
  // AC-K1.1: one short prompt per point — what actually gets rendered.
  cues,
  // AC-K1.2/AC-K1.3: the posting's own vocabulary, and the resume role and
  // project this answer came out of. Straight through to AnswerAids, which
  // decides what (if anything) each one looks like.
  buzzwords,
  anchor,
  grounding,
  error,
  isEmbedded,
  onToggle,
  onRetry,
  onRegenerate,
}) {
  const bullets = answerBullets(cues, points);
  // AC-G1-11: only offered once a draft is actually on screen — not while
  // it's loading, not while hidden, and not in the error state (which has
  // its own "Retry" action instead).
  const canRegenerate = visible && status === "done" && bullets.length > 0;

  return (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Button size="small" variant="outlined" onClick={onToggle} aria-expanded={visible}>
          {visible ? "Hide sample answer" : "Show sample answer"}
        </Button>
        {canRegenerate ? (
          <Button size="small" variant="text" onClick={onRegenerate}>
            Regenerate
          </Button>
        ) : null}
      </Stack>

      {/* F9: deliberately OUTSIDE the `{visible ? ... : null}` block below —
          that panel is conditionally rendered, so a status region nested
          inside it would mount at the same instant `visible` turns true. On
          a cache hit (R-111) `status` is already "done" the moment it
          mounts, which is exactly the case NVDA/JAWS fail to announce: a
          region whose final text was already there when it appeared. Kept
          mounted (idle → "") for the whole life of this card so only its
          TEXT changes from here on. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {answerStatusMessage({ status, bulletCount: bullets.length })}
      </Box>

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

          {status === "done" && bullets.length > 0 ? (
            <>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {bullets.map((bullet, i) => (
                  <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5, color: "var(--text-primary)" }}>
                    {bullet}
                  </Typography>
                ))}
              </Box>
              <AnswerAids buzzwords={buzzwords} anchor={anchor} />
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
