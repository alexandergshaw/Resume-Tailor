"use client";

import { useId, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEngine } from "@/app/settings/engine";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { ensureStudyDigest, refreshStudyDigest } from "@/lib/studyPlan/ensureStudyDigest";
import { bindStudyPlan } from "@/lib/studyPlan/studyPlanBrowser";
import { BUILD_INTENTS, run, skipsResearch } from "@/lib/studyPlan/studyPlanBuild";
import { requestStudyPlanBuild } from "@/lib/studyPlan/studyPlanBuildClient";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy";
import { areaOptions, isBuildableKnobs, suggestFocusAreas } from "@/lib/studyPlan/studyPlanKnobs";
import { fillStudyCopy } from "@/lib/studyPlan/studyPlanNotices";
import { DIGEST_SECTIONS } from "@/lib/tracking/applicationDigest";
import PostingPicker from "../PostingPicker";
import { BuildSteps, CreateStep, FailureStep, RebuildFailedAlert } from "./StudyCreatePanel";
import StudyPlanControls from "./StudyPlanControls";
import StudyWalkthrough from "./StudyWalkthrough";
import useStudyKnobs from "./useStudyKnobs";
import useStudyPlanBuild from "./useStudyPlanBuild";
import useStudyPlanRecord from "./useStudyPlanRecord";

// N157 SC-C (design r2 sections 4.1, 4.2 and 6): the study-plan integration
// shell, mounted by PracticeSurface in its "Study plan" sub-view and nowhere else.
// It takes NO props: it picks its own application (a REQUIRED selection, through
// the shared PostingPicker) and reaches Supabase only through studyPlanBrowser.
//
// THE STATE SWITCH, derived from (selected application, store record, build
// state, engine); exactly one body renders:
//   S0  no application        a disabled Create and its visible reason
//   S1  loading the record    (the status line says so; no body)
//   S2  load failed           the error and Try again
//   S3  no plan yet           intro, egress notice, the customize panel, Create
//   S4  building              the two-step list (above the plan, on a rebuild)
//   S5  build failed          the reason, Try again, and for a failed research
//                             the "general plan" way out
//   S6  plan unavailable      a persisted failed row with nothing to walk through
//   S7  walkthrough           StudyWalkthrough, which owns the banner, the card
//                             and the outline (and with it every rebuild control)
//   S8  rebuild failed        S7 with an alert ABOVE the plan that is still there
//   S9  save failed           an alert inside StudyWalkthrough
//
// ONE LIVE REGION. A single role="status" span is mounted from the first render
// and only its TEXT changes: the build phase, the loading line, the ready line. It
// is visible while something is happening and visually hidden otherwise, so a
// sighted user is told what is going on and a screen-reader user is told what
// changed. It never carries card content, and failures are announced by their own
// alert, not here, so nothing is spoken twice.
//
// PRESERVE-LAST-GOOD (Layer 2). A failed or preserved rebuild never reloads the
// record, and useStudyPlanRecord keeps showing the last good plan through a
// loading or errored reload. The plan on screen is only ever replaced by a plan.
//
// BANNER INPUTS. The provenance banner reads `researchedAt` from the plan row
// as readStudyPlan returned it (the store's settled record drops it) and the
// reason from the stored research. `engine` is the CLIENT's engine choice, per the
// StudyWalkthrough contract: the banner reads the engine that built the plan from
// the plan itself, and the egress notice must follow what the client will send.

const LOADING_TEXT = "Loading your study plan...";
const BUILDING_TEXT_SX = { color: "var(--text-secondary)" };
const STATIC_EFFECTS = {
  ensureDigest: ensureStudyDigest,
  refreshDigest: refreshStudyDigest,
  requestBuild: requestStudyPlanBuild,
};

function statusFor({ build, company, loading }) {
  if (build.phase === "researching") {
    return fillStudyCopy(STUDY_COPY.build.statusResearching, { company: company || "this company" });
  }
  if (build.phase === "building") return STUDY_COPY.build.statusWriting;
  if (loading) return LOADING_TEXT;
  if (build.phase === "done") return STUDY_COPY.build.statusReady;
  return "";
}

export default function StudyPlanClient() {
  const { engine } = useEngine();
  const [posting, setPosting] = useState(null);
  const reasonId = useId();
  const applicationId = typeof posting?.id === "string" ? posting.id : "";

  const binding = useMemo(() => (applicationId ? bindStudyPlan(applicationId) : null), [applicationId]);
  const { record, hasPlan, planKey, saveError, researchedAt, reload } = useStudyPlanRecord(applicationId, binding);
  const { build, busy } = useStudyPlanBuild(applicationId);

  // The customization draft (N157 SC-D). `effective` is what EVERY build sends, on
  // every intent: the draft over the stored knobs over the defaults, always an
  // object. The area list is the plan's own areas, or the digest headings before a
  // plan exists (the model does not import them; this shell is where they come in).
  const { effective, dirty, setKnobs } = useStudyKnobs(applicationId, record.knobs);
  const options = areaOptions({ plan: record.plan, knobs: effective, seedAreas: DIGEST_SECTIONS });
  const suggestions = suggestFocusAreas({ plan: record.plan, seen: record.progress?.seen });
  const blockedReason = isBuildableKnobs(effective, options) ? null : STUDY_COPY.knobs.lastIncludedReason;

  const startBuild = (intent) => {
    if (!applicationId || busy) return;
    run({ applicationId, engine, intent, knobs: effective, hadGoodPlan: hasPlan }, { ...STATIC_EFFECTS, reload });
  };
  const retryBuild = () => startBuild(build.intent ?? BUILD_INTENTS.CREATE);
  const researchFailed = build.kind === "research-failed" || build.kind === "research-error";

  const loading = applicationId !== "" && (!record.loaded || record.loading);
  const status = statusFor({ build, company: posting?.company, loading: loading && !hasPlan });

  // ONE panel element for both mounts (the create step and the open outline); the
  // key drops its local state (open, typed days) when the application changes.
  const controls = applicationId ? (
    <StudyPlanControls
      key={applicationId}
      label={hasPlan ? STUDY_COPY.knobs.disclosureOutline : STUDY_COPY.knobs.disclosureCreate}
      knobs={effective}
      onChange={setKnobs}
      options={options}
      suggestions={suggestions}
      engine={engine}
      disabled={busy}
    />
  ) : null;

  let body;
  if (!applicationId) {
    body = <CreateStep posting={null} engine={engine} reasonId={reasonId} />;
  } else if (busy && !hasPlan) {
    body = <BuildSteps phase={build.phase} skipResearch={skipsResearch(engine, build.intent)} />;
  } else if (hasPlan) {
    body = (
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        {busy ? <BuildSteps phase={build.phase} skipResearch={skipsResearch(engine, build.intent)} /> : null}
        {build.phase === "failed" ? (
          <RebuildFailedAlert
            message={build.preserved ? STUDY_COPY.failure.rebuildFailedKept : build.error}
            onRetry={retryBuild}
          />
        ) : null}
        <StudyWalkthrough
          key={planKey}
          applicationId={applicationId}
          plan={record.plan}
          progress={record.progress}
          writer={binding.writer}
          saveError={saveError}
          researchedAt={researchedAt}
          researchReason={record.cachedResearch?.reason ?? null}
          engine={engine}
          onBuild={startBuild}
          buildBusy={busy}
          settings={{ panel: controls, dirty: hasPlan && dirty, blockedReason }}
        />
      </Stack>
    );
  } else if (loading) {
    body = null;
  } else if (record.error !== null) {
    body = (
      <FailureStep message={fillStudyCopy(STUDY_COPY.failure.loadFailed, { error: record.error })} onRetry={reload} />
    );
  } else if (build.phase === "failed") {
    body = (
      <FailureStep
        message={build.error}
        onRetry={retryBuild}
        onGeneral={researchFailed ? () => startBuild(BUILD_INTENTS.GENERAL) : undefined}
      />
    );
  } else if (record.status !== null) {
    body = <FailureStep message={STUDY_COPY.failure.unavailable} onRetry={() => startBuild(BUILD_INTENTS.CREATE)} />;
  } else {
    body = (
      <CreateStep
        posting={posting}
        engine={engine}
        onCreate={() => startBuild(BUILD_INTENTS.CREATE)}
        reasonId={reasonId}
        settings={controls}
        createBlockedReason={blockedReason}
      />
    );
  }

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Typography variant="h6" component="h3">
        {STUDY_COPY.nav.viewHeading}
      </Typography>
      <PostingPicker
        required
        value={posting}
        onChange={setPosting}
        label={STUDY_COPY.picker.label}
        blankHint={STUDY_COPY.picker.hint}
      />
      <Box
        role="status"
        aria-live="polite"
        sx={busy || loading ? { ...BUILDING_TEXT_SX, typography: "body2" } : visuallyHidden}
      >
        {status}
      </Box>
      {body}
    </Stack>
  );
}
