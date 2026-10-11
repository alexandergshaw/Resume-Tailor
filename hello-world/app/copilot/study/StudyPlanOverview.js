"use client";

import { useEffect, useId, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy";
import { unsourcedTopicIds } from "@/lib/studyPlan/studyPlanSchema";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";

// N157 SC-C (C-b): the plan outline (design r2 section 3.5) -- the "how much of
// the plan at once" answer. The card screen shows ONE card; the whole plan sits
// behind this one disclosure, a plain local `useState` and NOT CollapsibleAid,
// whose open state is a shared persisted choice that has no business following
// a learner between plans.
//
// Open, it lists modules (h4) and topics (h5) with done/total per topic and an
// "Unsourced" chip per topic the plan flags, and every topic is a touch-sized
// button that jumps to its first pending card (a jump writes nothing; the next
// grade records the cursor as usual). The low-frequency action lives at the
// bottom: "Rebuild plan", and only when the caller passed `onBuild`. An absent
// callback means no rebuild path exists, so neither the button nor the egress
// notice that explains it renders.
//
// REBUILD CONFIRMATION (the N156 armed-button shape). Rebuilding writes new
// cards and a rebuilt plan re-words nearly every card, so progress mostly does
// not carry over. With nothing done there is nothing to lose and one click
// builds; with progress the first click ARMS the same button (label becomes
// "Confirm rebuild?") for REBUILD_CONFIRM_WINDOW_MS and only a second click
// inside the window builds. A pending timer IS the armed window, so the click
// handler never reads a stale render closure. The armed sentence is spoken by a
// polite status span that is mounted whenever the outline is, so the TEXT change
// is what gets announced.
//
// The component returns a fragment on purpose: the toggle sits in the caller's
// secondary-action row (after "Previous card"), and the open panel takes the full
// width of that wrapping row.

// How long the armed Rebuild waits for its second click before reverting on its
// own. Exported so a test advances past this exact number.
export const REBUILD_CONFIRM_WINDOW_MS = 4000;

// The intent the plain rebuild emits: it rebuilds from the research already
// stored, so it spends nothing on a new search.
const REBUILD_INTENT = "rebuild";

const SECONDARY_TEXT_SX = { color: "var(--text-secondary)" };

function fillProgress(done, total) {
  return STUDY_COPY.card.progress.replace("<done>", () => String(done)).replace("<total>", () => String(total));
}

function visibleModules(plan, summary) {
  const modules = Array.isArray(plan?.modules) ? plan.modules : [];
  return modules
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      topics: (Array.isArray(entry.topics) ? entry.topics : []).filter((topic) => summary.perTopic[topic.id] !== undefined),
    }))
    .filter((entry) => entry.topics.length > 0);
}

function TopicRow({ topic, slot, unsourced, onJump }) {
  const label = topic.title || topic.area || topic.id;
  return (
    <Stack direction="row" useFlexGap sx={{ alignItems: "center", columnGap: 1, ...WRAP_ROW_SX }}>
      <Typography variant="subtitle2" component="h5" sx={{ m: 0, flex: 1, minWidth: 0 }}>
        <Button
          variant="text"
          onClick={onJump}
          sx={{ ...TOUCH_TARGET_SX, width: "100%", justifyContent: "space-between", textAlign: "left", ...BREAK_LONG_WORDS_SX }}
        >
          <Box component="span" sx={{ minWidth: 0 }}>
            {label}
          </Box>
          <Box component="span" sx={{ ml: 1.5, whiteSpace: "nowrap", ...SECONDARY_TEXT_SX }}>
            {fillProgress(slot.done, slot.total)}
          </Box>
        </Button>
      </Typography>
      {unsourced ? <Chip size="small" variant="outlined" label={STUDY_COPY.card.chipUnsourced} /> : null}
    </Stack>
  );
}

export default function StudyPlanOverview({ plan, summary, engine, onBuild, buildBusy, onJump }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const armTimerRef = useRef(null);
  const panelId = useId();

  useEffect(
    () => () => {
      if (armTimerRef.current !== null) clearTimeout(armTimerRef.current);
    },
    [],
  );

  const canBuild = typeof onBuild === "function";
  const hasProgress = summary.done > 0;
  const unsourced = new Set(unsourcedTopicIds(plan));

  const onRebuildClick = () => {
    if (!canBuild || buildBusy === true) return;
    if (!hasProgress) {
      onBuild(REBUILD_INTENT);
      return;
    }
    if (armTimerRef.current === null) {
      armTimerRef.current = setTimeout(() => {
        armTimerRef.current = null;
        setArmed(false);
      }, REBUILD_CONFIRM_WINDOW_MS);
      setArmed(true);
      return;
    }
    clearTimeout(armTimerRef.current);
    armTimerRef.current = null;
    setArmed(false);
    onBuild(REBUILD_INTENT);
  };

  const notice = engine === "embedded" ? STUDY_COPY.notice.embedded : STUDY_COPY.notice.gemini;

  return (
    <>
      <Button
        variant="outlined"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        sx={TOUCH_TARGET_SX}
      >
        {STUDY_COPY.card.outline}
      </Button>
      {open ? (
        <Box id={panelId} sx={{ flexBasis: "100%", minWidth: 0 }}>
          <Stack spacing={2}>
            {visibleModules(plan, summary).map((entry) => (
              <Box key={entry.id} sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 700, ...BREAK_LONG_WORDS_SX }}>
                  {entry.title}
                </Typography>
                <Stack spacing={0.5}>
                  {entry.topics.map((topic) => (
                    <TopicRow
                      key={topic.id}
                      topic={topic}
                      slot={summary.perTopic[topic.id]}
                      unsourced={unsourced.has(topic.id)}
                      onJump={() => {
                        onJump(topic.id);
                        setOpen(false);
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            ))}
            {canBuild ? (
              <Stack spacing={1}>
                <Typography variant="body2" sx={SECONDARY_TEXT_SX}>
                  {notice}
                </Typography>
                <Button
                  variant="outlined"
                  onClick={onRebuildClick}
                  disabled={buildBusy === true}
                  sx={{ ...TOUCH_TARGET_SX, alignSelf: "flex-start" }}
                >
                  {armed ? STUDY_COPY.remedy.confirmRebuild : STUDY_COPY.remedy.rebuildPlan}
                </Button>
                {armed ? (
                  <Typography variant="body2" sx={SECONDARY_TEXT_SX}>
                    {STUDY_COPY.remedy.armedAnnouncement}
                  </Typography>
                ) : null}
                <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
                  {armed ? STUDY_COPY.remedy.armedAnnouncement : ""}
                </Box>
              </Stack>
            ) : null}
          </Stack>
        </Box>
      ) : null}
    </>
  );
}
