"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { answerLines } from "@/lib/copilot/answerPoints";
import { answerStatusMessage, visuallyHidden } from "@/lib/copilot/answerStatus";
import AnswerAids from "./AnswerAids";
import AnswerLines from "./AnswerLines";
// BUG-3/R-121 group-L: the SAME "what's current" decision CopilotDashboard's
// panels use, not a second hand-rolled copy of it — see latestQuestionEntry's
// own doc for why `questions[questions.length - 1]` stopped being that
// decision once the dashboard started preferring the last NON-provisional
// entry. useCurrentQuestionAnnouncement is BUG-2's fix for composing this
// region's text, reused here for the identical reason: now that this feed
// can also land on an older, already-`done` entry instead of the array's
// true last one, its region is exposed to the same collision that hook
// exists to prevent.
import { latestQuestionEntry, useCurrentQuestionAnnouncement } from "./dashboard/CopilotDashboard";
import { BREAK_LONG_WORDS_SX, PHONE_PANE_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "./mobileSx";

const TYPE_LABEL = {
  behavioral: "Behavioral",
  technical: "Technical",
  general: "General",
};

// Right-hand feed of detected questions. Each card shows the question and, on
// demand, the drafted answer: a few-word cue per beat (AC-K1.1), the posting
// buzzwords to work in, and the resume role and project it came out of.
export default function QuestionFeed({ questions, onDraft }) {
  // F9/R-124: ONE status region for the whole feed, not one per card. A
  // REUSED answer (CopilotClient.js's `addQuestion` seeding `status:
  // "loading"` then `runDraft`'s cache-hit path landing on `status: "done"`
  // before any `await`) makes React 18 batch both into the card's FIRST
  // render — so a per-card region would mount already carrying its final
  // text, which NVDA/JAWS do not announce (see answerStatusMessage's doc).
  // Mounting this region here instead, outside the `questions.length === 0`
  // branch so it exists from the feed's very first render, means only its
  // TEXT ever changes from then on — a real text-change announcement even
  // for a card whose first render is already "done".
  //
  // BUG-3/R-121 group-L: reads `latestQuestionEntry(questions)`, the SAME
  // function CopilotDashboard's "Current question"/"Current answer" panels
  // use, rather than the array's literal last element. Before this, the
  // dashboard could be showing entry A (the last NON-provisional entry)
  // while this region announced the status of entry B (the array's true
  // last, provisional) — two components disagreeing about which question is
  // current. `latestQuestionEntry` degrades to the array's true last entry
  // whenever nothing non-provisional exists (its own fallback) or `questions`
  // is empty/malformed (its own guard), so this is never less defensive than
  // the direct-index read it replaces.
  const latest = latestQuestionEntry(questions);
  const latestLines = answerLines(latest?.cues, latest?.points);
  const latestStatusText = answerStatusMessage({ status: latest?.status, bulletCount: latestLines.length });
  // BUG-2: see useCurrentQuestionAnnouncement's doc (CopilotDashboard.js) —
  // `latest` can now swap to a different, already-`done` entry without a
  // natural loading -> done transition, which a bare answerStatusMessage(...)
  // call can render as silence (identical text) or as an ambiguous "same
  // answer, new count" instead of "the current question changed".
  const latestRegionText = useCurrentQuestionAnnouncement(latest, latestStatusText);
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        ...PHONE_PANE_SX,
        p: 2,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      {/* F10: one level under the tab's h2 (TabHeader.js) — `component=`
          only changes the rendered element, never the `variant` that
          governs how this looks. */}
      <Typography
        variant="subtitle2"
        component="h3"
        sx={{ mb: 1.5, color: "var(--text-secondary)", fontWeight: 700 }}
      >
        Detected questions
      </Typography>

      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {latestRegionText}
      </Box>

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
  // AC-K1.1/AC-L1: a cue plus the sentence behind it, per line — the cue is
  // what a candidate reads while the interviewer is still finishing the
  // question, the sentence is what they can actually speak from. Same
  // answerLines call practice mode's SampleAnswer.js and the shared
  // dashboard's answer panels make — one decision, one place.
  const lines = answerLines(q.cues, q.points);
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        border: "1px solid var(--border)",
        background: "var(--bg-soft)",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "flex-start", mb: 0.75, ...WRAP_ROW_SX, rowGap: 0.5 }}
      >
        <Typography
          sx={{
            flex: 1,
            minWidth: 0,
            flexBasis: { xs: "100%", sm: 0 },
            fontWeight: 600,
            color: "var(--text-primary)",
            ...BREAK_LONG_WORDS_SX,
          }}
        >
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
        // F11: matches the sibling error paths (SampleAnswer.js, the
        // dashboard panels) — role="alert" plus a non-color icon, rather
        // than a plain colored Typography (WCAG 1.4.1).
        <Alert severity="error" sx={{ mb: 1 }}>
          {q.error}
        </Alert>
      ) : null}

      {done && lines.length ? (
        <Box sx={{ mb: 1 }}>
          <AnswerLines lines={lines} />
          {/* AC-K1.2/AC-K1.3: the posting's own vocabulary to work in, and
              which role and project on the candidate's resume this answer
              came out of, plus the ideal-project benchmark for this posting.
              Renders nothing when the draft carries none of them. */}
          <AnswerAids buzzwords={q.buzzwords} anchor={q.anchor} idealProject={q.idealProject} />
        </Box>
      ) : null}

      <Button
        size="small"
        variant={done ? "text" : "contained"}
        onClick={() => onDraft(q.id)}
        disabled={loading}
        startIcon={loading ? <CircularProgress size={14} color="inherit" /> : null}
        sx={TOUCH_TARGET_SX}
      >
        {loading ? "Drafting…" : done ? "Redraft" : "Draft answer"}
      </Button>
    </Box>
  );
}
