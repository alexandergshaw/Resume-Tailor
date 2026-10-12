// N160: the study-plan surface remembers the last application the user BUILT a plan
// for, per viewer, so a return visit lands on it instead of an empty picker.
//
// localStorage, not Supabase: it is a per-device convenience (a stale or missing
// value costs one click), not data. EVERY read and write is wrapped, because the
// storage can throw or be absent in a private window, with site data blocked, or on
// the server; the surface must render and build the same without it.
//
// The id is only ever a HINT. StudyPlanClient hands it to PostingPicker as
// `initialId`, and the picker preselects it only if it matches a loaded option, so
// a deleted application falls back to the empty picker.

const STORAGE_KEY = "studyPlan:lastApplicationId";

// The remembered application id, or undefined when there is none (or storage is
// unreachable). Never throws.
export function readLastStudyApplicationId() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return typeof stored === "string" && stored !== "" ? stored : undefined;
  } catch {
    return undefined;
  }
}

// Remember `applicationId`. Anything but a non-empty string is ignored, so a blank
// id can never overwrite a good one. Never throws.
export function writeLastStudyApplicationId(applicationId) {
  if (typeof applicationId !== "string" || applicationId === "") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, applicationId);
  } catch {
    // Best effort: nothing depends on this having been stored.
  }
}
