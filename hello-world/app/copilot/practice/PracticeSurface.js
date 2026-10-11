"use client";

import { useState } from "react";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy";
import { TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";
import StudyPlanClient from "../study/StudyPlanClient";
import PracticeClient from "./PracticeClient";

// N157 SC-C (design r2 section 5.2): the mount seam for practice mode. CopilotClient
// renders this where it used to render PracticeClient, with the same four props,
// and this decides which of the two practice tools is on screen:
//
//   "Answer aloud"  the existing PracticeClient, untouched, with those four props
//                   forwarded as they came. This is the default and it is not
//                   persisted, so practice mode opens exactly as it always did.
//   "Study plan"    StudyPlanClient, which takes no props.
//
// Exactly one child is mounted: switching UNMOUNTS the other, the same as
// switching modes does today, so no effect of the study tree ever runs while
// the user is answering aloud (and the study tree is never mounted hidden or
// ahead of time). PracticeClient is imported from "./PracticeClient", the exact
// module id the CopilotClient suites mock, so those mocks keep intercepting
// through this parent.
//
// The labels are "Answer aloud" and "Study plan", never "Practice": the mode
// toggle above already has a button named exactly "Practice", and a second one
// would match the mode button's accessible-name query twice. Re-clicking the
// selected button reports `null` from the group; it is swallowed here, as
// ModeSwitch does, so a view is never left unset.

const VIEW_PRACTICE = "practice";
const VIEW_STUDY = "study";
const BUTTON_SX = { textTransform: "none", px: 1.5, ...TOUCH_TARGET_SX };

export default function PracticeSurface({
  sttProviderName,
  micDeviceId,
  onMicDeviceChange,
  onInterviewTypeAnnouncement,
}) {
  const [view, setView] = useState(VIEW_PRACTICE);

  return (
    <>
      <Stack direction="row" sx={{ mb: 2, alignItems: "center", ...WRAP_ROW_SX }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          aria-label={STUDY_COPY.nav.groupLabel}
          onChange={(_e, next) => {
            if (next === null) return;
            setView(next);
          }}
        >
          <ToggleButton value={VIEW_PRACTICE} sx={BUTTON_SX}>
            {STUDY_COPY.nav.answerAloud}
          </ToggleButton>
          <ToggleButton value={VIEW_STUDY} sx={BUTTON_SX}>
            {STUDY_COPY.nav.studyPlan}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {view === VIEW_STUDY ? (
        <StudyPlanClient />
      ) : (
        <PracticeClient
          sttProviderName={sttProviderName}
          micDeviceId={micDeviceId}
          onMicDeviceChange={onMicDeviceChange}
          onInterviewTypeAnnouncement={onInterviewTypeAnnouncement}
        />
      )}
    </>
  );
}
