"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatRelative } from "@/lib/feed/liveFeedClient";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy";
import { isPartialPlan } from "@/lib/studyPlan/studyPlanSchema";
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

// N157 SC-C (C-b): the provenance banner (design r2 section 3.6). It says, from
// the PERSISTED facts alone, how much to trust the plan on screen, and offers
// the one remedy that actually changes the answer for that cause:
//
//   embedded plan                 text only. The engine is a global setting, so
//                                 the remedy is an instruction, not a button.
//   partial, "no-research"        "Research and rebuild" -> onBuild("research-rebuild")
//                                 (ensure re-researches a missing or failed digest)
//   partial, "unsourced"          "Refresh research"     -> onBuild("refresh-rebuild")
//                                 (the digest is already ready, so ensure would
//                                 be a no-op that loops back to the same plan;
//                                 only a forced refresh searches again)
//   partial, anything else        text only (no cause known, so no remedy is
//                                 claimed to work)
//   complete research             no banner, a quiet "Based on research from ..."
//
// Every remedy button needs `onBuild`: an absent callback is the single switch
// for the mode in which no rebuild path exists, and then only the text shows. A
// remedy also needs the CLIENT engine to be able to run it: researching under
// the embedded engine can only fail, so no button renders there either, just the
// switch-the-engine instruction. Disabled while a build is running.
//
// The banner is a persistent `note`, not a live alert: it states a standing
// fact about the plan every time the view opens and must not interrupt.

const REMEDY_BY_REASON = {
  "no-research": { label: STUDY_COPY.remedy.researchAndRebuild, intent: "research-rebuild" },
  unsourced: { label: STUDY_COPY.remedy.refreshResearch, intent: "refresh-rebuild" },
};

export default function StudyProvenanceBanner({ plan, engine, researchReason, researchedAt, nowMs, onBuild, buildBusy }) {
  const clientEmbedded = engine === "embedded";
  const switchHint = clientEmbedded ? (
    <Typography variant="body2">{STUDY_COPY.remedy.switchEngine}</Typography>
  ) : null;

  if (plan?.engine === "embedded") {
    return (
      <Alert severity="info" role="note">
        <Stack spacing={1}>
          <Typography variant="body2">{STUDY_COPY.banner.embedded}</Typography>
          {switchHint}
        </Stack>
      </Alert>
    );
  }

  if (isPartialPlan(plan)) {
    const remedy = Object.hasOwn(REMEDY_BY_REASON, researchReason) ? REMEDY_BY_REASON[researchReason] : null;
    const canAct = remedy !== null && !clientEmbedded && typeof onBuild === "function";
    const text = researchReason === "unsourced" ? STUDY_COPY.banner.unsourced : STUDY_COPY.banner.general;
    return (
      <Alert severity="warning" role="note">
        <Stack spacing={1}>
          <Typography variant="body2">{text}</Typography>
          {remedy !== null && clientEmbedded ? switchHint : null}
          {canAct ? (
            <Button
              variant="outlined"
              size="small"
              disabled={buildBusy === true}
              onClick={() => {
                if (buildBusy !== true) onBuild(remedy.intent);
              }}
              sx={{ ...TOUCH_TARGET_SX, alignSelf: "flex-start" }}
            >
              {remedy.label}
            </Button>
          ) : null}
        </Stack>
      </Alert>
    );
  }

  const relative = researchedAt ? formatRelative(researchedAt, nowMs) : "";
  if (relative === "") return null;
  return (
    <Typography variant="caption" sx={{ color: "var(--text-secondary)" }}>
      {STUDY_COPY.sources.researchLine.replace("<relative>", () => relative)}
    </Typography>
  );
}
