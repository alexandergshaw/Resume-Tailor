"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

// AC-I5: live mode's five-panel dashboard — current question, its answer,
// the predicted next question, that question's pre-drafted answer, and the
// user's current talking pace. Purely presentational (AC-I5.31): every
// value arrives as a prop, same contract as SampleAnswer.js/SubmittedDocs.js
// — this owns no fetching and no state beyond the trivial "is a panel
// expanded" kind SubmittedDocs already uses elsewhere, and here not even
// that. It does not replace QuestionFeed (AC-I5.30) — the caller renders
// both; this is a glanceable summary, QuestionFeed is the full history with
// its own redraft actions.
//
// `questions` is the SAME array CopilotClient already holds and passes to
// useLiveDashboard — panels 1/2 re-derive "the current question" from it
// directly (AC-I5.28) rather than through any prop this component invents,
// so there is exactly one place that array is read as "what's the latest
// question" (here) instead of two copies that could disagree.
const PACE_LABEL_TEXT = { slow: "Slow", conversational: "Conversational", rushed: "Rushed" };
const PACE_LABEL_COLOR = {
  slow: "var(--warning)",
  conversational: "var(--success)",
  rushed: "var(--warning)",
};

function latestQuestionEntry(questions) {
  const list = Array.isArray(questions) ? questions : [];
  return list.length ? list[list.length - 1] : null;
}

// The two "real" panels' shared card look — a plain surface, same as
// QuestionFeed's own question cards. Deliberately distinct from
// PredictionPanel's look below: a user glancing at this mid-interview must
// never mistake one for the other (AC-I3.20).
function RealPanel({ title, children }) {
  return (
    <Box
      sx={{
        p: 1.75,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-soft)",
        minWidth: 0,
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1, color: "var(--text-secondary)", fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

// The two prediction panels' shared card look — an accent-tinted surface
// plus an explicit "Prediction" chip repeated on BOTH, so a question and its
// answer can never be read as something the interviewer actually said or
// something already drafted for real (AC-I3.20, AC-I4's panel is "equally
// clearly tied to the predicted question").
function PredictionPanel({ title, children }) {
  return (
    <Box
      sx={{
        p: 1.75,
        borderRadius: 2,
        border: "1px solid var(--accent)",
        background: "var(--accent-soft)",
        minWidth: 0,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ color: "var(--text-secondary)", fontWeight: 700 }}>
          {title}
        </Typography>
        <Chip
          size="small"
          label="Prediction"
          sx={{
            height: 18,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            color: "var(--accent-contrast)",
            background: "var(--accent)",
          }}
        />
      </Stack>
      {children}
    </Box>
  );
}

function CurrentQuestionPanel({ current }) {
  return (
    <RealPanel title="Current question">
      {current ? (
        <Typography sx={{ color: "var(--text-primary)", fontWeight: 600 }}>{current.question}</Typography>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          No question has been detected yet this session.
        </Typography>
      )}
    </RealPanel>
  );
}

function CurrentAnswerPanel({ current }) {
  return (
    <RealPanel title="Answer to the current question">
      {!current ? (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          There is no current question to answer yet.
        </Typography>
      ) : current.status === "loading" ? (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <CircularProgress size={16} />
          <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
            Drafting…
          </Typography>
        </Stack>
      ) : current.status === "error" ? (
        <Typography variant="body2" sx={{ color: "var(--danger)" }}>
          {current.error || "Could not draft an answer."}
        </Typography>
      ) : current.status === "done" && current.points?.length ? (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {current.points.map((p, i) => (
            <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5, color: "var(--text-primary)" }}>
              {p}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          No talking points have been drafted for this question yet.
        </Typography>
      )}
    </RealPanel>
  );
}

function PredictedQuestionPanel({ status, question, error, onRetry }) {
  return (
    <PredictionPanel title="Predicted next question">
      {status === "loading" ? (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <CircularProgress size={16} />
          <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
            Guessing what might be asked next…
          </Typography>
        </Stack>
      ) : status === "error" ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {error || "Could not predict the next question."}
        </Alert>
      ) : status === "done" && question ? (
        <>
          <Typography sx={{ color: "var(--text-primary)", fontWeight: 600 }}>{question}</Typography>
          <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "var(--text-secondary)" }}>
            The interviewer has not asked this — it is only a guess at what might come next.
          </Typography>
        </>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          Once there is a posting selected or a question detected, a guess at the next question will
          appear here.
        </Typography>
      )}
    </PredictionPanel>
  );
}

function PredictedAnswerPanel({ predictionStatus, predictedQuestion, status, points, error, onRetry }) {
  const cleanPoints = (Array.isArray(points) ? points : []).filter((p) => typeof p === "string" && p.trim());
  return (
    <PredictionPanel title="Answer to the predicted question">
      {predictionStatus !== "done" || !predictedQuestion ? (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          A predicted question will need to appear above first.
        </Typography>
      ) : status === "idle" ? (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          Turn on Auto-draft to have an answer ready for this question before it is asked.
        </Typography>
      ) : status === "loading" ? (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <CircularProgress size={16} />
          <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
            Drafting an answer to the predicted question…
          </Typography>
        </Stack>
      ) : status === "error" ? (
        // A failed pre-draft used to be a dead end: this panel showed only
        // the error text, and the one thing a user could see to press —
        // PREDICTION's own Retry above — usually lands on the SAME
        // predicted question, which leaves this stuck failed (see
        // retryPredraft's doc in useLiveDashboard.js). Matching
        // SampleAnswer.js's error state (an Alert with an inline Retry
        // action) rather than the plain error text this panel used to
        // render, so a failed pre-draft has the same reachable recovery a
        // failed sample answer already does.
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {error || "Could not draft an answer to the predicted question."}
        </Alert>
      ) : cleanPoints.length ? (
        <>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {cleanPoints.map((p, i) => (
              <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5, color: "var(--text-primary)" }}>
                {p}
              </Typography>
            ))}
          </Box>
          <Typography variant="caption" sx={{ display: "block", mt: 0.75, color: "var(--text-secondary)" }}>
            Pre-drafted for the predicted question above — not the current one.
          </Typography>
        </>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          No talking points came back for the predicted question.
        </Typography>
      )}
    </PredictionPanel>
  );
}

// AC-I2.14: `measured: false` is not "0 wpm" — it must read as "not
// measured", never as a real (if unflattering) reading. Rendered as plain
// text rather than a colored chip in that case, so an unmeasured signal
// never even LOOKS like the same kind of thing as a measured one.
function PacePanel({ pace }) {
  const measured = !!pace?.measured;
  return (
    <Box
      sx={{
        p: 1.75,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-soft)",
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1, color: "var(--text-secondary)", fontWeight: 700 }}>
        Your talking speed
      </Typography>
      {measured ? (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <Typography sx={{ color: "var(--text-primary)", fontWeight: 600 }}>
            {Math.round(pace.wordsPerMinute)} words/min
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, color: PACE_LABEL_COLOR[pace.paceLabel] || "var(--text-secondary)" }}
          >
            {PACE_LABEL_TEXT[pace.paceLabel] || pace.paceLabel}
          </Typography>
        </Stack>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          Pace is not being measured yet — keep talking and it will appear here.
        </Typography>
      )}
    </Box>
  );
}

export default function LiveDashboard({
  questions,
  pace,
  predictedQuestion,
  predictionStatus,
  predictionError,
  onRetryPrediction,
  predictedPoints,
  predictedAnswerStatus,
  predictedAnswerError,
  onRetryPredraft,
}) {
  const current = latestQuestionEntry(questions);

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1.5, color: "var(--text-secondary)", fontWeight: 700 }}>
        Live dashboard
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 1.5,
        }}
      >
        <CurrentQuestionPanel current={current} />
        <PredictedQuestionPanel
          status={predictionStatus}
          question={predictedQuestion}
          error={predictionError}
          onRetry={onRetryPrediction}
        />
        <CurrentAnswerPanel current={current} />
        <PredictedAnswerPanel
          predictionStatus={predictionStatus}
          predictedQuestion={predictedQuestion}
          status={predictedAnswerStatus}
          points={predictedPoints}
          error={predictedAnswerError}
          onRetry={onRetryPredraft}
        />
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <PacePanel pace={pace} />
      </Box>
    </Box>
  );
}
