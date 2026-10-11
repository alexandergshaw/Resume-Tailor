"use client";

import { useSyncExternalStore } from "react";
import { getBuildState, getSnapshot, subscribe } from "@/lib/studyPlan/studyPlanBuild";

// N157 SC-C (design r2 section 5.1): the React side of the build store. The build
// itself lives in a module (studyPlanBuild.js) so it survives this component
// unmounting; this hook only subscribes to it. It returns the state of one
// application's latest run and whether that run is still going. An empty
// application id reads as idle.

export default function useStudyPlanBuild(applicationId) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const build = getBuildState(applicationId);
  return { build, busy: build.phase === "researching" || build.phase === "building" };
}
