"use client";

import { useEffect, useId, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy";
import { normalizeProgress } from "@/lib/studyPlan/studyPlanSchema";
import { GRADE, flattenPlan, planSignature } from "@/lib/studyPlan/studyWalkthroughModel";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";
import StudyEvidenceCitation from "./StudyEvidenceCitation";
import StudyPlanOverview from "./StudyPlanOverview";
import StudyProvenanceBanner from "./StudyProvenanceBanner";
import useStudyWalkthrough from "./useStudyWalkthrough";

// N157 SC-C (C-b): the study-plan step player (design r2 sections 3.2 and 5.5).
// ONE focused card at a time. A card with a stored `reveal` is a self-test --
// primary "Show answer", then "Missed it" / "Got it" -- and a card without one
// is read-through -- primary "Next". Presentational over useStudyWalkthrough.js.
//
// THE PROPS ARE THE CONTRACT C-c BUILDS TO (section 5.5), and exactly these are
// taken: nothing is spread onto the DOM.
//   applicationId   required, non-empty. Empty renders NOTHING and never calls
//                   the writer. Deliberately no `= ""` default: an empty id must
//                   be refused here, not defaulted into a write.
//   plan            the normalized plan. A plan with no cards (zero modules, or
//                   null) renders nothing -- the belt to the caller's brace.
//   progress        the normalized progress, read from the store snapshot so the
//                   store's optimistic merge re-renders this. No copy of `seen`
//                   is kept here.
//   writer          ({ cursor, seenDelta }) => Promise<{ written, error }>
//   saveError       record.error after a failed write: the save-failed alert
//   researchedAt, researchReason, engine   the provenance banner's inputs
//   onBuild         (intent) => void; OPTIONAL. Absent means no rebuild path
//                   exists, so no rebuild or remedy control renders anywhere
//   buildBusy       disables those controls while a build runs
//   settings        optional { panel, dirty, blockedReason } (N157 SC-D), passed
//                   through to the outline untouched; absent, nothing renders
//   now             optional () => ISO string; the clock for `revealedAt`
//
// COLD REVEAL. The answer text is not in the DOM until "Show answer" is
// activated (conditional render, never CSS-hidden) and never inside a live
// region. Focus is what announces a step: it moves to the answer group on
// reveal and to the new card's heading on every advance, and never on mount.
//
// One primary (contained) button per step; every other control is outlined or
// text. Headings: h4 for the card, h5 for "Answer" (the page owns h2 and h3).

const ANSWER_HEADING = "Answer";
const PROGRESS_LABEL = "Study plan progress";

const SECONDARY_TEXT_SX = { color: "var(--text-secondary)" };
const PRIMARY_BUTTON_SX = { ...TOUCH_TARGET_SX, width: { xs: "100%", sm: "auto" } };
const GRADE_BUTTON_SX = { ...TOUCH_TARGET_SX, flex: 1 };
const HEADING_SX = { fontSize: "1.15rem", fontWeight: 600, ...BREAK_LONG_WORDS_SX };

const defaultNow = () => new Date().toISOString();

function fill(template, slots) {
  return Object.entries(slots).reduce((out, [key, value]) => out.replaceAll(`<${key}>`, () => String(value)), template);
}

function CardStep({ walk, headingRef, answerRef, answerId }) {
  const { card, entry, revealed, summary } = walk;
  const { item } = card;
  const citations = Array.isArray(item.citations) ? item.citations : [];
  const promptText = item.text || (typeof item.prompt === "string" ? item.prompt : "");
  const progressText = fill(STUDY_COPY.card.progress, { done: summary.done, total: summary.total });
  const percent = summary.total === 0 ? 0 : (summary.done / summary.total) * 100;
  const revisit =
    revealed && entry?.grade === GRADE.GOT_IT
      ? STUDY_COPY.card.revisitGotIt
      : revealed && entry?.grade === GRADE.AGAIN
        ? STUDY_COPY.card.revisitMissedIt
        : null;

  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: "center", columnGap: 1, ...WRAP_ROW_SX }}>
        <Typography variant="caption" sx={{ ...SECONDARY_TEXT_SX, ...BREAK_LONG_WORDS_SX }}>
          {card.hasReveal ? card.topicTitle : card.moduleTitle}
        </Typography>
        <Chip size="small" variant="outlined" label={item.kind === "review" ? STUDY_COPY.card.chipReview : STUDY_COPY.card.chipNew} />
        {citations.length === 0 ? <Chip size="small" variant="outlined" label={STUDY_COPY.card.chipNoSource} /> : null}
      </Stack>
      <Stack direction="row" useFlexGap sx={{ columnGap: 1.5, ...WRAP_ROW_SX }}>
        <Typography variant="caption" sx={SECONDARY_TEXT_SX}>
          {fill(STUDY_COPY.card.position, { i: card.indexInTopic + 1, n: card.topicSize })}
        </Typography>
        <Typography variant="caption" sx={SECONDARY_TEXT_SX}>
          {progressText}
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={percent} aria-label={PROGRESS_LABEL} aria-valuetext={progressText} />
      {walk.secondPass ? (
        <Typography variant="caption" sx={SECONDARY_TEXT_SX}>
          {STUDY_COPY.card.secondPass}
        </Typography>
      ) : null}

      <Typography
        key={card.id}
        variant="subtitle1"
        component="h4"
        tabIndex={-1}
        ref={headingRef}
        sx={HEADING_SX}
      >
        {card.hasReveal ? promptText : card.topicTitle || card.moduleTitle || STUDY_COPY.nav.viewHeading}
      </Typography>

      {card.hasReveal ? null : (
        <>
          <Typography sx={BREAK_LONG_WORDS_SX}>{promptText}</Typography>
          <StudyEvidenceCitation key={card.id} citations={citations} />
          <Button variant="contained" onClick={walk.onNext} sx={PRIMARY_BUTTON_SX}>
            {STUDY_COPY.card.next}
          </Button>
        </>
      )}

      {card.hasReveal && !revealed ? (
        <>
          {walk.fresh ? (
            <Typography variant="body2" sx={SECONDARY_TEXT_SX}>
              {STUDY_COPY.card.hint}
            </Typography>
          ) : null}
          <Button variant="contained" onClick={walk.onReveal} sx={PRIMARY_BUTTON_SX}>
            {STUDY_COPY.card.showAnswer}
          </Button>
        </>
      ) : null}

      {card.hasReveal && revealed ? (
        <>
          <Box
            role="group"
            tabIndex={-1}
            aria-labelledby={answerId}
            ref={answerRef}
            sx={{
              p: { xs: 1.25, sm: 1.75 },
              borderRadius: 2,
              border: "1px solid var(--border)",
              background: "var(--bg-soft)",
              minWidth: 0,
            }}
          >
            <Typography variant="subtitle2" component="h5" id={answerId} sx={{ mb: 1, ...SECONDARY_TEXT_SX, fontWeight: 700 }}>
              {ANSWER_HEADING}
            </Typography>
            <Typography sx={{ whiteSpace: "pre-line", ...BREAK_LONG_WORDS_SX }}>{item.reveal}</Typography>
            <StudyEvidenceCitation key={card.id} citations={citations} />
          </Box>
          {revisit === null ? null : (
            <Typography variant="body2" sx={SECONDARY_TEXT_SX}>
              {revisit}
            </Typography>
          )}
          <Stack direction="row" useFlexGap sx={{ columnGap: 1.5 }}>
            <Button variant="contained" onClick={() => walk.onGrade(GRADE.GOT_IT)} sx={GRADE_BUTTON_SX}>
              {STUDY_COPY.card.gotIt}
            </Button>
            <Button variant="outlined" onClick={() => walk.onGrade(GRADE.AGAIN)} sx={GRADE_BUTTON_SX}>
              {STUDY_COPY.card.missedIt}
            </Button>
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}

function CompleteStep({ walk, headingRef }) {
  return (
    <Stack spacing={1.5} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle1" component="h4" tabIndex={-1} ref={headingRef} sx={HEADING_SX}>
        {STUDY_COPY.complete.heading}
      </Typography>
      <Typography>{fill(STUDY_COPY.complete.body, { total: walk.summary.total })}</Typography>
      <Button variant="contained" onClick={walk.onReviewAll} sx={PRIMARY_BUTTON_SX}>
        {STUDY_COPY.complete.reviewAll}
      </Button>
    </Stack>
  );
}

function WalkthroughBody({
  applicationId,
  plan,
  cards,
  progress,
  writer,
  saveError,
  researchedAt,
  researchReason,
  engine,
  onBuild,
  buildBusy,
  settings,
  now,
}) {
  const clock = typeof now === "function" ? now : defaultNow;
  // The reference time for "Based on research from <relative>", read once so a
  // re-render never re-words it under the learner.
  const [nowMs] = useState(() => Date.parse(clock()));
  const walk = useStudyWalkthrough({
    applicationId,
    cards,
    progress: normalizeProgress(progress),
    writer,
    clock,
    saveError,
  });

  const headingRef = useRef(null);
  const answerRef = useRef(null);
  const answerId = useId();

  const { focusRequest } = walk;
  useEffect(() => {
    if (focusRequest === null) return;
    const target = focusRequest.target === "answer" ? answerRef.current : headingRef.current;
    if (target) target.focus();
  }, [focusRequest]);

  return (
    <Stack spacing={2} sx={{ minWidth: 0, maxWidth: 720 }}>
      <StudyProvenanceBanner
        plan={plan}
        engine={engine}
        researchReason={researchReason}
        researchedAt={researchedAt}
        nowMs={nowMs}
        onBuild={onBuild}
        buildBusy={buildBusy}
      />
      {walk.saveAlert ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={walk.onRetry} sx={TOUCH_TARGET_SX}>
              {STUDY_COPY.save.retry}
            </Button>
          }
        >
          {STUDY_COPY.save.failed}
        </Alert>
      ) : null}
      {walk.complete ? (
        <CompleteStep walk={walk} headingRef={headingRef} />
      ) : (
        <CardStep walk={walk} headingRef={headingRef} answerRef={answerRef} answerId={answerId} />
      )}
      <Stack direction="row" useFlexGap sx={{ alignItems: "center", columnGap: 1, ...WRAP_ROW_SX }}>
        {walk.complete ? null : (
          <Button variant="outlined" onClick={walk.onPrevious} disabled={!walk.canPrevious} sx={TOUCH_TARGET_SX}>
            {STUDY_COPY.card.previous}
          </Button>
        )}
        <StudyPlanOverview
          plan={plan}
          summary={walk.summary}
          engine={engine}
          onBuild={onBuild}
          buildBusy={buildBusy}
          onJump={walk.onJump}
          settings={settings}
        />
      </Stack>
    </Stack>
  );
}

export default function StudyWalkthrough({
  applicationId,
  plan,
  progress,
  writer,
  saveError,
  researchedAt,
  researchReason,
  engine,
  onBuild,
  buildBusy,
  settings,
  now,
}) {
  const cards = flattenPlan(plan);
  if (!applicationId || planSignature(cards) === "") return null;
  return (
    <WalkthroughBody
      applicationId={applicationId}
      plan={plan}
      cards={cards}
      progress={progress}
      writer={writer}
      saveError={saveError}
      researchedAt={researchedAt}
      researchReason={researchReason}
      engine={engine}
      onBuild={onBuild}
      buildBusy={buildBusy}
      settings={settings}
      now={now}
    />
  );
}
