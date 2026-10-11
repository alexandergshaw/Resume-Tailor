// N157 SC-C: the client wrapper over POST /api/study-plan -- phase 2 of the
// create-time ordering (phase 1 is ensureStudyDigest / refreshStudyDigest in
// ensureStudyDigest.js). It issues NO grounded call of its own: the route reads
// the already-persisted digest and writes one non-grounded generation.
//
// The route answers `{ status, partial, reason, preserved?, preservedReason?,
// error? }` and NEVER the plan (the client re-reads the row through RLS), so this
// resolves to that small status object and the caller branches on `status`. An
// ABSENT `preserved` is read as false by the caller, which keeps this wrapper
// correct against the route both with and without the preserve-last-good guard.
//
// Every build must carry the STORED knobs: the route normalizes an omitted
// `knobs` to the defaults and writes them, so a rebuild that left them out would
// silently reset the learner's customization. `knobs` is therefore sent whenever
// the caller has an object, and the caller (studyPlanBuild.run) always passes the
// stored one.
//
// A blank application id is refused here before any request is made: the route
// would answer 400 anyway, but it would spend one of the 12-per-10-minutes rate
// limit tokens on the way.

import { STUDY_COPY } from "./studyPlanCopy.js";

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * One POST to the study-plan route. Resolves to the route's 2xx JSON; throws an
 * Error whose message is the user-facing copy on a non-ok response: the switched-
 * off copy for the kill switch (`503 { status: "disabled" }`, which carries no
 * `error` key), else the server's `error`, else a status-bearing fallback.
 *
 * @param {{ applicationId: string, engine: string, knobs?: object | null }} args
 */
export async function requestStudyPlanBuild({ applicationId, engine, knobs } = {}) {
  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    throw new Error(STUDY_COPY.picker.disabledCreateReason);
  }
  const body = { applicationId, engine };
  if (knobs !== null && typeof knobs === "object") body.knobs = knobs;

  const res = await fetch("/api/study-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) {
    if (res.status === 503 && json?.status === "disabled") throw new Error(STUDY_COPY.failure.switchedOff);
    throw new Error(json?.error || `Request failed (${res.status})`);
  }
  return json;
}
