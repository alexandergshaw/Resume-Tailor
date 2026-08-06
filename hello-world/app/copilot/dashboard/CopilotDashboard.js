"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { cleanAnswerPoints } from "@/lib/copilot/answerPoints";

// AC-I5/AC-J2: the copilot's five-panel dashboard — current question, its
// answer, the predicted next question, that question's pre-drafted answer,
// and the user's current talking pace. Purely presentational (AC-I5.31):
// every value arrives as a prop, same contract as
// SampleAnswer.js/SubmittedDocs.js — this owns no fetching and no state
// beyond the trivial "is a panel expanded" kind SubmittedDocs already uses
// elsewhere, and here not even that. It does not replace QuestionFeed
// (AC-I5.30) — the caller renders both; this is a glanceable summary,
// QuestionFeed is the full history with its own redraft actions.
//
// `questions` is the SAME array CopilotClient already holds and passes to
// useCopilotDashboard — panels 1/2 re-derive "the current question" from it
// directly (AC-I5.28) rather than through any prop this component invents,
// so there is exactly one place that array is read as "what's the latest
// question" (here) instead of two copies that could disagree. Practice mode
// has no such array; it synthesizes a one-entry list in the same shape (see
// PracticeClient.js), which is what lets both modes share this component
// rather than fork it.
//
// AC-J2.1: BOTH modes render this. The layout, the panel treatments and
// every state (loading, error, empty, measured/unmeasured) are shared
// verbatim — the whole point of practice mode having a dashboard is
// rehearsing against the instrument the candidate will be reading during
// the real interview, so a divergence here defeats the feature. Only the
// WORDS differ, via the `copy` prop below, and only where a live-mode
// sentence would be untrue in practice mode ("the interviewer has not
// asked this" when there is no interviewer).
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

// BUG-J6: shared by both answer panels below via lib/copilot/answerPoints.js
// rather than a module-local copy — cachedSampleAnswerFor
// (lib/copilot/sampleAnswerState.js) only filters a COPY of `entry.points`
// to length-check it, then returns `entry.points` itself unfiltered — so a
// cached pre-draft like ["", "a real point"] reaches the render layer with
// a blank entry still in it. PredictedAnswerPanel already guarded against
// this; CurrentAnswerPanel did not, which is the asymmetry BUG-J6 was filed
// for. That module is also the ONLY place this filter is written out — see
// its doc comment for why the same guard used to live here AND in
// SampleAnswer.js, and had already drifted between the two.

// AC-J2.2: live mode's wording, verbatim — every string this component
// rendered before practice mode shared it. It is the DEFAULT for the `copy`
// prop, so live mode passes nothing and its output is unchanged; the same
// "defaults are the incumbent mode's exact strings" discipline
// PostingPicker.js's `label`/`blankHint` already use. Keeping both modes'
// wording in one place, side by side, is also what makes a drift between
// them visible in review rather than spread across two components.
export const LIVE_COPY = {
  title: "Live dashboard",
  currentQuestionTitle: "Current question",
  noQuestion: "No question has been detected yet this session.",
  currentAnswerTitle: "Answer to the current question",
  noCurrentAnswer: "There is no current question to answer yet.",
  noPoints: "No talking points have been drafted for this question yet.",
  predictedQuestionTitle: "Predicted next question",
  predictionIdle:
    "Once there is a posting selected or a question detected, a guess at the next question will appear here.",
  predictionDisclaimer: "The interviewer has not asked this — it is only a guess at what might come next.",
  predictedAnswerTitle: "Answer to the predicted question",
  predraftIdle: "Turn on Auto-draft to have an answer ready for this question before it is asked.",
  predraftCaption: "Pre-drafted for the predicted question above — not the current one.",
  predraftEmpty: "No talking points came back for the predicted question.",
  paceTitle: "Your talking speed",
};

// AC-J2.2: practice mode's wording. Deliberately the SAME sentences
// wherever a live-mode sentence is still true with no interviewer in the
// room — the differences below are all places where live's wording would
// be a false statement here, not places where practice was given a
// different voice for its own sake.
//
// The prediction disclaimer carries the extra weight in this mode: practice
// mode picks its own next question, so a candidate could reasonably read
// "predicted next question" as "the question this app is about to ask me".
// It says plainly that it is neither — the same failure R-106 guards in
// live mode (answering a question nobody asked), in the form it takes here.
export const PRACTICE_COPY = {
  ...LIVE_COPY,
  title: "Practice dashboard",
  noQuestion: "No question yet — press Start practice to get your first one.",
  // R-109: `noCurrentAnswer` and `predraftCaption` are deliberately NOT
  // overridden. Live's wording for both turns on the word "current", which
  // is perfectly true in practice mode — there IS a current question — so
  // paraphrasing it to "on screen" was divergence for its own sake, and it
  // made this mode contradict itself: the panel titles below still say
  // "Current question" and "Answer to the current question", so the body
  // text would have called the same thing by a different name three lines
  // under its own heading. The bar for an override here is that live's
  // sentence would be FALSE with no interviewer in the room, not that a
  // different phrasing reads slightly better.
  noPoints: "No sample answer has been drafted for this question yet.",
  predictionIdle:
    "Once a posting is selected or a question is on screen, a guess at what an interviewer might ask next will appear here.",
  predictionDisclaimer:
    "This is a guess at what a real interviewer might ask next — it is not necessarily the question practice mode will give you next.",
  predraftIdle:
    'Turn on "Pre-draft predicted answer" to have an answer ready for this question before it comes up.',
  predraftEmpty: "No sample answer came back for the predicted question.",
};

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

function CurrentQuestionPanel({ current, copy }) {
  return (
    <RealPanel title={copy.currentQuestionTitle}>
      {current ? (
        <Typography sx={{ color: "var(--text-primary)", fontWeight: 600 }}>{current.question}</Typography>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          {copy.noQuestion}
        </Typography>
      )}
    </RealPanel>
  );
}

// AC-J2.3: `answerHidden` is practice mode's reveal gate, and it is checked
// BEFORE any of the status branches below. Practice mode deliberately keeps
// a sample answer hidden until the candidate asks for it (AC-G1) — the
// whole drill is answering cold, and a dashboard that put the model's
// answer on screen the moment a question appeared would quietly remove the
// thing being practised. Live mode passes neither `answerHidden` nor
// `onReveal`, so it never reaches this branch and renders exactly as it did
// before the gate existed.
//
// The button is the same control SampleAnswer.js offers on the question
// card, driven by the SAME useSampleAnswer instance (see PracticeClient),
// so revealing in either place reveals in both — two independent visibility
// flags for one draft would let the card and this panel disagree about
// whether the answer is showing.
function CurrentAnswerPanel({ current, copy, answerHidden, onReveal, revealLabel }) {
  // BUG-J6: filtered here (not `current.points` directly) — see
  // lib/copilot/answerPoints.js's doc for why an unfiltered array can reach
  // this component with blank entries in it. The `done` branch below tests
  // THIS filtered length, not `current.points?.length` — an all-blank array
  // must fall through to the copy.noPoints branch rather than rendering an
  // empty `<ul>`.
  const cleanPoints = cleanAnswerPoints(current?.points);
  return (
    <RealPanel title={copy.currentAnswerTitle}>
      {!current ? (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          {copy.noCurrentAnswer}
        </Typography>
      ) : answerHidden ? (
        <Button size="small" variant="outlined" onClick={onReveal}>
          {revealLabel}
        </Button>
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
      ) : current.status === "done" && cleanPoints.length ? (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {cleanPoints.map((p, i) => (
            <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5, color: "var(--text-primary)" }}>
              {p}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-muted)" }}>
          {copy.noPoints}
        </Typography>
      )}
    </RealPanel>
  );
}

function PredictedQuestionPanel({ status, question, error, onRetry, copy }) {
  return (
    <PredictionPanel title={copy.predictedQuestionTitle}>
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
            {copy.predictionDisclaimer}
          </Typography>
        </>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          {copy.predictionIdle}
        </Typography>
      )}
    </PredictionPanel>
  );
}

function PredictedAnswerPanel({ predictionStatus, predictedQuestion, status, points, error, onRetry, copy }) {
  // BUG-J6: now shared with CurrentAnswerPanel via cleanAnswerPoints rather
  // than each panel writing this filter out separately — see that helper's
  // doc.
  const cleanPoints = cleanAnswerPoints(points);
  return (
    <PredictionPanel title={copy.predictedAnswerTitle}>
      {predictionStatus !== "done" || !predictedQuestion ? (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          A predicted question will need to appear above first.
        </Typography>
      ) : status === "idle" ? (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          {copy.predraftIdle}
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
        // retryPredraft's doc in useCopilotDashboard.js). Matching
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
            {copy.predraftCaption}
          </Typography>
        </>
      ) : (
        <Typography variant="body2" sx={{ color: "var(--text-secondary)" }}>
          {copy.predraftEmpty}
        </Typography>
      )}
    </PredictionPanel>
  );
}

// AC-I2.14: `measured: false` is not "0 wpm" — it must read as "not
// measured", never as a real (if unflattering) reading. Rendered as plain
// text rather than a colored chip in that case, so an unmeasured signal
// never even LOOKS like the same kind of thing as a measured one.
function PacePanel({ pace, copy }) {
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
        {copy.paceTitle}
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

export default function CopilotDashboard({
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
  // AC-J2.2: merged OVER live mode's strings rather than replacing them, so
  // a caller supplying a partial set still gets a complete one and a string
  // added here later can never leave a mode rendering `undefined`.
  copy,
  // AC-J2.3: practice mode's reveal gate — see CurrentAnswerPanel above.
  answerHidden = false,
  onRevealAnswer,
  revealLabel = "Show sample answer",
}) {
  const current = latestQuestionEntry(questions);
  const text = { ...LIVE_COPY, ...(copy || {}) };

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
        {text.title}
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 1.5,
        }}
      >
        <CurrentQuestionPanel current={current} copy={text} />
        <PredictedQuestionPanel
          status={predictionStatus}
          question={predictedQuestion}
          error={predictionError}
          onRetry={onRetryPrediction}
          copy={text}
        />
        <CurrentAnswerPanel
          current={current}
          copy={text}
          answerHidden={answerHidden}
          onReveal={onRevealAnswer}
          revealLabel={revealLabel}
        />
        <PredictedAnswerPanel
          predictionStatus={predictionStatus}
          predictedQuestion={predictedQuestion}
          status={predictedAnswerStatus}
          points={predictedPoints}
          error={predictedAnswerError}
          onRetry={onRetryPredraft}
          copy={text}
        />
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <PacePanel pace={pace} copy={text} />
      </Box>
    </Box>
  );
}
