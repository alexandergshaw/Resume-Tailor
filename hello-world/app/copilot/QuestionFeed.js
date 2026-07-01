"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

const TYPE_LABEL = {
  behavioral: "Behavioral",
  technical: "Technical",
  general: "General",
};

// Right-hand feed of detected questions. Each card shows the question and, on
// demand, LLM-drafted talking points the candidate can speak from.
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

      {done && q.points?.length ? (
        <Box component="ul" sx={{ m: 0, mb: 1, pl: 2.5 }}>
          {q.points.map((p, i) => (
            <Typography
              key={i}
              component="li"
              variant="body2"
              sx={{ mb: 0.5, color: "var(--text-primary)" }}
            >
              {p}
            </Typography>
          ))}
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
