"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy";
import { buildStudyPlanNotice, fillStudyCopy } from "@/lib/studyPlan/studyPlanNotices";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";

// N157 SC-C (design r2 sections 4.1 and 5.1): the compositions of the states in
// which there is no plan to walk through yet, split out of StudyPlanClient so the
// shell stays the state switch. Each export is one state:
//
//   CreateStep         S0 / S3  no posting picked (a disabled Create with a visible
//                               reason) or ready to create (intro, egress notice,
//                               the Create button)
//   BuildSteps         S4       the two-step list while a build runs
//   FailureStep        S2 / S5 / S6  an error with Try again, and for a failed
//                               research the "general plan" way out
//   RebuildFailedAlert S8       the alert shown ABOVE a plan that survived a failed
//                               rebuild
//
// The disabled Create names its reason with a visible sibling caption wired by
// aria-describedby, never a Tooltip (a Tooltip steals the control's accessible
// name). The egress notice is always visible, never collapsed to shorten the page.

const SECONDARY_TEXT_SX = { color: "var(--text-secondary)", ...BREAK_LONG_WORDS_SX };
const ACTION_ROW_SX = { alignItems: "center", columnGap: 1.5, ...WRAP_ROW_SX };

export function CreateStep({ posting, engine, onCreate, reasonId }) {
  if (!posting) {
    return (
      <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
        <Button variant="contained" disabled aria-describedby={reasonId} sx={TOUCH_TARGET_SX}>
          {STUDY_COPY.picker.createButton}
        </Button>
        <Typography id={reasonId} variant="body2" sx={SECONDARY_TEXT_SX}>
          {STUDY_COPY.picker.disabledCreateReason}
        </Typography>
      </Stack>
    );
  }

  const intro = fillStudyCopy(STUDY_COPY.picker.intro, {
    title: posting.title || "this role",
    company: posting.company || "this company",
  });
  return (
    <Stack spacing={1.5} sx={{ alignItems: "flex-start", minWidth: 0 }}>
      <Typography sx={BREAK_LONG_WORDS_SX}>{intro}</Typography>
      <Typography variant="body2" sx={SECONDARY_TEXT_SX}>
        {buildStudyPlanNotice({ engine })}
      </Typography>
      <Button variant="contained" onClick={onCreate} sx={TOUCH_TARGET_SX}>
        {STUDY_COPY.picker.createButton}
      </Button>
    </Stack>
  );
}

export function BuildSteps({ phase, skipResearch }) {
  const steps = [
    { id: "research", label: STUDY_COPY.build.stepResearch, current: phase === "researching" },
    { id: "write", label: STUDY_COPY.build.stepWrite, current: phase !== "researching" },
  ].filter((step) => !(skipResearch && step.id === "research"));

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start", minWidth: 0 }}>
      <CircularProgress size={20} aria-hidden="true" sx={{ flexShrink: 0, mt: 0.25 }} />
      <Box component="ol" sx={{ m: 0, pl: 2.5, minWidth: 0 }}>
        {steps.map((step) => (
          <Box
            component="li"
            key={step.id}
            aria-current={step.current ? "step" : undefined}
            sx={{ fontWeight: step.current ? 700 : 400, ...(step.current ? {} : { color: "var(--text-secondary)" }) }}
          >
            {step.label}
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

export function FailureStep({ message, onRetry, onGeneral }) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: "flex-start", minWidth: 0 }}>
      <Alert severity="error" sx={{ alignSelf: "stretch", ...BREAK_LONG_WORDS_SX }}>
        {message}
      </Alert>
      <Stack direction="row" useFlexGap sx={ACTION_ROW_SX}>
        <Button variant="contained" onClick={onRetry} sx={TOUCH_TARGET_SX}>
          {STUDY_COPY.failure.tryAgain}
        </Button>
        {onGeneral ? (
          <Button variant="outlined" onClick={onGeneral} sx={TOUCH_TARGET_SX}>
            {STUDY_COPY.failure.generalPlanOption}
          </Button>
        ) : null}
      </Stack>
      {onGeneral ? (
        <Typography variant="body2" sx={SECONDARY_TEXT_SX}>
          {STUDY_COPY.failure.generalPlanCaption}
        </Typography>
      ) : null}
    </Stack>
  );
}

export function RebuildFailedAlert({ message, onRetry }) {
  return (
    <Alert
      severity="warning"
      sx={BREAK_LONG_WORDS_SX}
      action={
        <Button color="inherit" size="small" onClick={onRetry} sx={TOUCH_TARGET_SX}>
          {STUDY_COPY.failure.tryAgain}
        </Button>
      }
    >
      {message}
    </Alert>
  );
}
