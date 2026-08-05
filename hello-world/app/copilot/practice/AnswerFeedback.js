"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

const STAR_LABELS = [
  ["situation", "Situation"],
  ["task", "Task"],
  ["action", "Action"],
  ["result", "Result"],
];

const SOURCE_LABEL = { gemini: "Gemini", embedded: "Embedded engine" };

function scoreColor(score) {
  if (score >= 75) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--danger)";
}

function BulletList({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" sx={{ color: "var(--text-secondary)", mb: 0.5 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {items.map((item, i) => (
          <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5, color: "var(--text-primary)" }}>
            {item}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

// Judgement of what was actually SAID in a completed practice answer — C4's
// half of the review panel, sitting alongside C3's AnswerReview (which
// covers only the measurable delivery facts). Renders the AC-C4-1 contract
// exactly as the server returns it, whichever engine produced it, and owns
// the repeat loop: "Next question" advances to a fresh question; "Try
// again" re-answers this same one. Both stay available through every
// status (loading/error included) so a slow or failed critique never
// blocks moving on. The running session total lives in PracticeClient, not
// here — it needs to stay visible even when this panel isn't mounted (e.g.
// right after "Next question" clears the just-reviewed answer).
export default function AnswerFeedback({
  status = "idle", // idle | loading | done | error
  feedback = null,
  error = "",
  onRetry,
  onNext,
  onTryAgain,
}) {
  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
        mb: 2,
      }}
    >
      <Typography variant="h6" sx={{ fontWeight: 600, color: "var(--text-primary)", mb: 1.5 }}>
        Answer feedback
      </Typography>

      {status === "loading" ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", py: 1, mb: 1 }}>
          <CircularProgress size={20} />
          <Typography sx={{ color: "var(--text-muted)" }}>Analyzing your answer…</Typography>
        </Stack>
      ) : null}

      {status === "error" ? (
        <Alert
          severity="error"
          sx={{ mb: 1.5 }}
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {error || "Could not analyze this answer."}
        </Alert>
      ) : null}

      {status === "done" && feedback ? (
        <>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline", mb: 1 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, color: scoreColor(feedback.score) }}>
              {feedback.score}
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
              / 100
            </Typography>
            <Chip
              size="small"
              label={SOURCE_LABEL[feedback.source] || feedback.source || "unknown"}
              sx={{
                height: 22,
                fontSize: 11,
                color: "var(--text-secondary)",
                background: "var(--bg-soft)",
                border: "1px solid var(--border)",
              }}
            />
          </Stack>
          <Typography variant="body1" sx={{ color: "var(--text-primary)", mb: 2 }}>
            {feedback.verdict}
          </Typography>

          {feedback.star ? (
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }}>
              {STAR_LABELS.map(([key, label]) => {
                const present = !!feedback.star[key];
                return (
                  <Chip
                    key={key}
                    size="small"
                    label={label}
                    sx={{
                      fontWeight: 600,
                      color: present ? "var(--success)" : "var(--text-muted)",
                      background: present ? "var(--success-soft)" : "var(--bg-soft)",
                      border: `1px solid ${present ? "var(--success)" : "var(--border)"}`,
                    }}
                  />
                );
              })}
            </Stack>
          ) : null}

          <Divider sx={{ mb: 2, borderColor: "var(--border)" }} />

          <BulletList title="Strengths" items={feedback.strengths} />
          <BulletList title="Improvements" items={feedback.improvements} />
          <BulletList title="What was missing" items={feedback.missing} />
          <BulletList title="Delivery notes" items={feedback.delivery} />
        </>
      ) : null}

      <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
        <Button variant="contained" onClick={onNext}>
          Next question
        </Button>
        <Button variant="outlined" onClick={onTryAgain}>
          Try again
        </Button>
      </Stack>
    </Box>
  );
}
