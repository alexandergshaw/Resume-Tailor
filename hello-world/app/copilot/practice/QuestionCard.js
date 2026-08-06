"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import SampleAnswer from "./SampleAnswer";

const TYPE_LABEL = {
  behavioral: "Behavioral",
  technical: "Technical",
  general: "General",
};

// Presentational card for practice mode's current question. All state (which
// question, whether a request is in flight, the asked list, whether an
// answer is being recorded) lives in PracticeClient — this only renders what
// it's given and calls back on Start answering / Done.
export default function QuestionCard({
  question,
  type,
  loading,
  error,
  exhausted,
  sessionActive,
  hasPosting,
  live,
  answering,
  settling,
  onNext,
  onRetry,
  onStartAnswer,
  onDoneAnswer,
  // G1: the toggleable sample answer for THIS question — all state lives in
  // PracticeClient's useSampleAnswer hook, threaded straight through to the
  // presentational SampleAnswer panel below, same as everything else on
  // this card. G2: `sampleAnswerText`/`sampleGrounding` carry mode
  // "answer"'s prose response in place of G1's bullet points.
  sampleVisible,
  sampleStatus,
  sampleAnswerText,
  sampleGrounding,
  sampleError,
  isEmbedded,
  onToggleSample,
  onRetrySample,
  onRegenerateSample,
}) {
  // The empty state is reached two different ways: before the first Start
  // (the Start button is on screen), and mid-session right after a posting
  // change (Start isn't rendered at all — Stop is). Word it for whichever is
  // actually true instead of always pointing at Start.
  const emptyText = sessionActive
    ? 'Press "Next question" to get a question.'
    : "Press Start to get your first question.";
  const exhaustedText = hasPosting
    ? "You've covered every question for this posting."
    : "You've covered every question in this generic set.";
  // "Live" (the Deepgram socket is actually open) is a stricter check than
  // sessionActive (which also covers "connecting") — recording an answer
  // before transcription is flowing would silently lose the first words.
  // Blocked while settling too — the previous answer's transcript is still
  // draining, and starting a new one before that finishes would mean two
  // answers competing for the same trailing finals.
  const canStartAnswering = !!live && !!question && !answering && !settling;

  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", mb: 1.5 }}>
        {loading ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", py: 0.5 }}>
            <CircularProgress size={20} sx={{ mr: 1.5 }} />
            <Typography sx={{ color: "var(--text-muted)" }}>
              Getting your next question…
            </Typography>
          </Box>
        ) : (
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 600, color: "var(--text-primary)" }}>
            {question || emptyText}
          </Typography>
        )}
        {!loading && question && type ? (
          <Chip
            size="small"
            label={TYPE_LABEL[type] || "General"}
            sx={{
              height: 22,
              fontSize: 11,
              color: "var(--text-secondary)",
              background: "var(--bg-soft)",
              border: "1px solid var(--border)",
            }}
          />
        ) : null}
      </Stack>

      {error ? (
        <Alert
          severity="error"
          sx={{ mb: 1.5 }}
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {exhausted ? (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          {exhaustedText}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Button variant="contained" onClick={onNext} disabled={loading || exhausted || answering || settling}>
          Next question
        </Button>
        {answering ? (
          <>
            <Typography variant="body2" sx={{ color: "var(--danger)", fontWeight: 600 }}>
              ● Recording your answer…
            </Typography>
            <Button variant="outlined" color="error" onClick={onDoneAnswer}>
              Done
            </Button>
          </>
        ) : settling ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <CircularProgress size={16} />
            <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
              Finishing up your answer…
            </Typography>
          </Stack>
        ) : (
          <Button variant="outlined" onClick={onStartAnswer} disabled={!canStartAnswering}>
            Start answering
          </Button>
        )}
      </Stack>

      {/* AC-G1-1: whenever there's a question on screen, whichever of the
          phases above is showing — never disabled by answering/settling.
          AC-G2-C-7 (BUG-G1-1): also gated on NOT loading — `loading` goes
          true the instant "Next question" is pressed, but `question` isn't
          cleared until the new one lands, so without this second condition
          the PREVIOUS question's sample answer (and its toggle) sat here,
          under a card already showing "Getting your next question…", for
          the whole in-flight request. */}
      {question && !loading ? (
        <SampleAnswer
          visible={sampleVisible}
          status={sampleStatus}
          answer={sampleAnswerText}
          grounding={sampleGrounding}
          error={sampleError}
          isEmbedded={isEmbedded}
          onToggle={onToggleSample}
          onRetry={onRetrySample}
          onRegenerate={onRegenerateSample}
        />
      ) : null}
    </Box>
  );
}
