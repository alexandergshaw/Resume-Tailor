"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { recordDecision } from "@/lib/activityLog/appActivityLog.js";
import { REGENERATE_STATE } from "@/lib/review/regenerateAvailability";
import { idealLevelEnabled } from "@/lib/tailor/idealDelivery";
import { applyRegenerated, attachReport, reportFor, restoreFromSnapshot, snapshotForUndo } from "@/lib/tailor/regenerateEntry";
import { createRegenerateJobs } from "@/lib/tailor/regenerateJob";
import { regenerateInputsFor, regenerateSurfaceFor } from "@/lib/tailor/regenerateSurface";
import { runRegenerate } from "@/lib/tailor/regenerateSubmit";
import RegenerateReport from "../components/preview/RegenerateReport";
import RegenerateRow from "../components/preview/RegenerateRow";

// N104 -- "regenerate to address weaknesses" for the preview modal, wired as the
// props the review strip gives its Regenerate row and report. The strip is keyed by
// job and tab and remounts when either changes, so nothing that must outlive it
// lives there: the in-flight guard, the Undo snapshot and the failure flag are held
// here (the guard in lib/tailor/regenerateJob.js), by the preview mount that stays
// mounted for the app's lifetime.
//
//   const regenerate = useRegenerateWeaknesses({ ... })
//   regenerate.forScope("resume") -> { busy, onReviewed, regenerateRow, regenerateReport }
//
// The regenerate reaches the server's Ideal route only (runRegenerate), whose branch
// re-enters the gated pipeline; it never calls the standard route or the revise
// handler, so its text cannot be an ungated one. It changes the job's entry through
// the same writer a first run uses (`updateTailoringJob`), in ONE write, and only
// after the run succeeded: a refused or failed run writes nothing.
//
//   jobId / tailoringMap    the open job and the entries
//   engine / engineLabel    the engine the next run would use, and its picker label
//   idealSurface            idealSurfaceFor(entry), null for a job with no Ideal run
//   reviewRequests          { [scope]: the review request of the text on that tab }
//   posting / url           where the posting comes from, as the revise path reads it
//   resumeFile, additionalContext, contextFiles   the run's other inputs
//   updateTailoringJob      page.js's entry writer
//   onPreviewReload         tells the open preview its text changed
//   announce                the preview's announcer ({ polite } | { alert, persist })

const DECISION_ID = "weakness-regenerate";

const SAY = {
  start: "Regenerating. This takes longer than a review.",
  failed: "The regenerate could not finish. Your resume is unchanged.",
  restored: "Restored the version from before the regenerate.",
};

export default function useRegenerateWeaknesses({
  jobId,
  tailoringMap,
  engine,
  engineLabel,
  idealSurface,
  reviewRequests,
  posting,
  url,
  resumeFile,
  additionalContext,
  contextFiles,
  updateTailoringJob,
  onPreviewReload,
  announce,
}) {
  const [jobs] = useState(() => createRegenerateJobs({ submit: runRegenerate }));
  useSyncExternalStore(jobs.subscribe, jobs.version, jobs.version);
  // The latest review the user ran in each strip, by job and tab.
  const [strips, setStrips] = useState({});
  const [failed, setFailed] = useState({});
  const [restored, setRestored] = useState({});
  const [focusSignal, setFocusSignal] = useState(0);

  // A run's callbacks fire long after the render that started it; they read the
  // newest of these, not the ones that were current at the click.
  const latest = useRef(null);
  useEffect(() => {
    latest.current = { jobId, tailoringMap, updateTailoringJob, onPreviewReload, announce };
  });

  const record = (outcome, reason, fields = {}) => recordDecision(DECISION_ID, outcome, { reason, engine, ...fields });
  const clearFlag = (setter) => setter((flags) => (flags[jobId] ? { ...flags, [jobId]: false } : flags));

  function onReplace(id, result) {
    const now = latest.current;
    const entry = now?.tailoringMap?.[id];
    if (!entry?.ideal || typeof now.updateTailoringJob !== "function") {
      throw new Error("The resume is no longer open for regenerating.");
    }
    const view = reportFor(entry, result);
    if (view.unchanged) {
      now.updateTailoringJob(id, (current) => attachReport(current, view));
    } else {
      now.updateTailoringJob(id, (current) => applyRegenerated(current, result, view));
      now.onPreviewReload?.();
    }
    record("acted", view.unchanged ? "unchanged" : "regenerated", {
      suggestionsBefore: view.facts.before,
      suggestionsAfter: view.facts.after,
      newlyFlagged: view.facts.newlyFlagged,
      unqualifiedCount: result.genuinelyUnqualified?.length ?? 0,
      confirmCount: result.confirm?.length ?? 0,
      coverageComplete: result.regenerated.ideal?.review?.coverage?.complete === true,
    });
    if (id === now.jobId) now.announce?.({ polite: view.announcement });
    // Nothing was replaced when the text came out the same, so there is nothing to undo.
    return !view.unchanged;
  }

  function onFail(id) {
    setFailed((flags) => ({ ...flags, [id]: true }));
    record("failed", "failed");
    if (id === latest.current?.jobId) latest.current.announce?.({ alert: SAY.failed, persist: true });
  }

  function start(surface) {
    // The guard is the controller's, set synchronously; this early exit only spares
    // a second click in the same tick from announcing again.
    if (jobs.running(jobId) || surface.state !== REGENERATE_STATE.READY) return;
    const { pinnedAnalysis, beforeReview } = regenerateInputsFor({ idealSurface, live: surface.live });
    clearFlag(setFailed);
    clearFlag(setRestored);
    announce?.({ polite: SAY.start });
    jobs.start(
      jobId,
      {
        request: { posting, url, resumeFile, engine, additionalContext, contextFiles, pinnedAnalysis, beforeReview },
        snapshot: snapshotForUndo(tailoringMap[jobId]),
      },
      { onReplace, onFail },
    );
  }

  function undo() {
    jobs.undo(jobId, {
      onRestore: (id, snapshot) => {
        const now = latest.current;
        now?.updateTailoringJob?.(id, (entry) => restoreFromSnapshot(entry, snapshot));
        now?.onPreviewReload?.();
        setRestored((flags) => ({ ...flags, [id]: true }));
        setFocusSignal((n) => n + 1);
        record("acted", "undone");
        if (id === now?.jobId) now.announce?.({ polite: SAY.restored });
      },
    });
  }

  function forScope(scope) {
    const key = `${jobId}|${scope}`;
    const surface = regenerateSurfaceFor({
      scope,
      idealSurface,
      request: reviewRequests?.[scope],
      strip: strips[key],
      engine,
      idealEnabled: idealLevelEnabled(),
      inFlight: jobs.running(jobId),
    });
    const showReport = scope === "resume" && surface.report;
    return {
      // A review of a text that is about to be replaced is noise, so the resume's
      // Review button waits for the run.
      busy: scope === "resume" && jobs.running(jobId),
      onReviewed: (payload) => setStrips((all) => ({ ...all, [key]: payload })),
      regenerateReport: showReport ? (
        <RegenerateReport view={surface.report} onUndo={jobs.hasUndo(jobId) ? undo : undefined} />
      ) : null,
      regenerateRow: (
        <RegenerateRow
          state={surface.state}
          counts={surface.counts}
          inputs={surface.inputs}
          engineLabel={engineLabel}
          handEdited={surface.handEdited}
          hasReport={Boolean(showReport)}
          failed={Boolean(failed[jobId])}
          note={restored[jobId] ? SAY.restored : ""}
          focusSignal={focusSignal}
          onRegenerate={() => start(surface)}
          onUnavailable={(state) => record("refused", state)}
          announce={announce}
        />
      ),
    };
  }

  return { forScope };
}
