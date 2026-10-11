"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getSnapshot,
  getStudyPlanRecord,
  loadStudyPlanRecord,
  subscribe,
} from "@/lib/studyPlan/studyPlanProgressStore";
import { flattenPlan, planSignature } from "@/lib/studyPlan/studyWalkthroughModel";

// N157 SC-C (design r2 sections 4.3 and 5.1): the study-plan record for one
// application, read from the shared progress store, loaded when an application is
// selected, with the LAST-GOOD display rule.
//
// LAST GOOD (preserve-last-good, Layer 2). loadStudyPlanRecord replaces the
// in-memory record WHOLESALE: a reload that fails settles to `{ plan: null,
// error }`, and a reload in flight reads as an empty loading record. Showing the
// store's record as it stands would therefore blank a good plan on screen after a
// transient read error, the same defect the server guard prevents one layer down.
// So the DISPLAY record is the last record that held a usable plan whenever the
// store's record has none because it is loading or errored; a settled, error-free
// record with no plan (the row is gone) is shown as it is.
//
// WHERE `researchedAt` COMES FROM. The store's settled record drops the plan row's
// `researchedAt` (it keeps the plan, knobs, progress, cachedResearch). The banner's
// "Based on research from <date>" line needs it, so the reader handed to the store
// is wrapped here to take it from the readStudyPlan result as that result passes
// through, keyed by application so a later errored read cannot erase it.

// A plan with no cards renders nothing in the walkthrough, so it is not usable.
function usable(record) {
  return record.status !== "unavailable" && flattenPlan(record.plan).length > 0;
}

export default function useStudyPlanRecord(applicationId, binding) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const raw = getStudyPlanRecord(applicationId);
  const rawUsable = usable(raw);

  const [good, setGood] = useState(null);
  if (rawUsable && (good === null || good.record !== raw || good.applicationId !== applicationId)) {
    setGood({ applicationId, record: raw });
  }
  const keepGood = !rawUsable && good !== null && good.applicationId === applicationId && (!raw.loaded || raw.loading || raw.error !== null);
  const record = keepGood ? good.record : raw;

  const [researched, setResearched] = useState({});
  const reader = binding === null ? null : binding.reader;
  const reload = useCallback(() => {
    if (!applicationId || reader === null) return Promise.resolve();
    return loadStudyPlanRecord(applicationId, async () => {
      const result = await reader();
      if (result !== null && typeof result === "object" && result.error == null) {
        const at = typeof result.researchedAt === "string" ? result.researchedAt : null;
        setResearched((prev) => (prev[applicationId] === at ? prev : { ...prev, [applicationId]: at }));
      }
      return result;
    });
  }, [applicationId, reader]);

  useEffect(() => {
    if (applicationId) reload();
  }, [applicationId, reload]);

  // The kept record was usable when it was stored, so only the live one is checked.
  const hasPlan = keepGood || rawUsable;
  return {
    record,
    hasPlan,
    // The remount key: stable across an identical reload (a reconcile must not
    // un-reveal the card on screen), different for a rebuilt plan.
    planKey: hasPlan ? `${applicationId}:${planSignature(flattenPlan(record.plan))}` : "",
    // True only when the displayed record IS the store's live one, so its `error`
    // can only be a failed progress write and not a failed load.
    saveError: record === raw ? raw.error : null,
    researchedAt: researched[applicationId] ?? null,
    reload,
  };
}
