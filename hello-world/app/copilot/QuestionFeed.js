"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { answerBullets } from "@/lib/copilot/answerPoints";
import AnswerAids from "./AnswerAids";

const TYPE_LABEL = {
  behavioral: "Behavioral",
  technical: "Technical",
  general: "General",
};

// Right-hand feed of detected questions. Each card shows the question and, on
// demand, the drafted answer: a few-word cue per beat (AC-K1.1), the posting
// buzzwords to work in, and the resume role and project it came out of.
export default function QuestionFeed({ questions, onDraft }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 340,
        maxHeight: "62vh",
        overflowY: "auto",
        p: 2,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{ mb: 1.5, color: "var(--text-secondary)", fontWeight: 700 }}
      >
        Detected questions
      </Typography>

      {questions.length === 0 ? (
        <Typography sx={{ color: "var(--text-muted)" }}>
          Questions the interviewer asks will show up here.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {questions.map((q) => (
            <QuestionCard key={q.id} q={q} onDraft={onDraft} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function QuestionCard({ q, onDraft }) {
  const loading = q.status === "loading";
  const done = q.status === "done";
  // AC-K1.1: the cues are what a candidate reads while the interviewer is
  // still finishing the question; the full points are the fallback for a
  // draft that has none (one cached before cues existed). Same answerBullets
  // call practice mode's SampleAnswer.js and the shared dashboard's answer
  // panels make — one decision, one place.
  const bullets = answerBullets(q.cues, q.points);
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-soft)",
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", mb: 0.75 }}>
        <Typography sx={{ flex: 1, fontWeight: 600, color: "var(--text-primary)" }}>
          {q.question}
        </Typography>
        {done && q.cached ? (
          <Typography
            variant="caption"
            sx={{ color: "var(--text-muted)", whiteSpace: "nowrap", pt: 0.25 }}
          >
            reused
          </Typography>
        ) : null}
        {done && q.type ? (
          <Chip
            size="small"
            label={TYPE_LABEL[q.type] || "General"}
            sx={{
              height: 20,
              fontSize: 11,
              color: "var(--text-secondary)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
            }}
          />
        ) : null}
      </Stack>

      {q.error ? (
        <Typography variant="body2" sx={{ color: "var(--danger)", mb: 1 }}>
          {q.error}
        </Typography>
      ) : null}

      {done && bullets.length ? (
        <Box sx={{ mb: 1 }}>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {bullets.map((bullet, i) => (
              <Typography
                key={i}
                component="li"
                variant="body2"
                sx={{ mb: 0.5, color: "var(--text-primary)" }}
              >
                {bullet}
              </Typography>
            ))}
          </Box>
          {/* AC-K1.2/AC-K1.3: the posting's own vocabulary to work in, and
              which role and project on the candidate's resume this answer
              came out of. Renders nothing when the draft carries neither. */}
          <AnswerAids buzzwords={q.buzzwords} anchor={q.anchor} />
        </Box>
      ) : null}

      <Button
        size="small"
        variant={done ? "text" : "contained"}
        onClick={() => onDraft(q.id)}
        disabled={loading}
        startIcon={loading ? <CircularProgress size={14} color="inherit" /> : null}
      >
        {loading ? "Drafting…" : done ? "Redraft" : "Draft answer"}
      </Button>
    </Box>
  );
}
