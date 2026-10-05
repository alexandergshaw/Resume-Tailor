// N104 - when the Regenerate row may offer to run, as ONE state. PURE and TOTAL:
// every input it does not recognise falls to a not-ready state, never to `ready`,
// so the button is reachable only when a gated regenerate can really run.
//
//   regenerateAvailability(descriptor) -> REGENERATE_STATE value
//
//   descriptor = {
//     tab              "resume" | "cover" | "hypothetical" | "email"
//     jobKind          "ideal" when the job carries an Ideal run, else "standard"
//     idealEnabled     idealLevelEnabled(), the single switch every Ideal surface asks
//     engine           the engine the next run would use
//     reviewSource     the live review of the text on screen, or null when none
//     fresh            that review still describes the text on screen
//     inputs           { posting, realMaterial }: what the review was given
//     resolvableCount  wording gaps the regenerate would act on
//     inFlight         a regenerate for THIS job is running
//   }
//
// Precedence, first match wins:
//   hidden, unsupported-scope, unsupported-job, running, engine-cannot,
//   needs-material, stale, nothing-to-address, ready.
//
// `hidden` covers a surface nothing is sent from (hypothetical, email), a switched-
// off Ideal level, and "no review exists yet". The two `unsupported-*` states are
// the honest sentences for a cover letter and for a result built below the Ideal
// level: the gated chain is resume-only and Ideal-only, so neither is offered a
// regenerate. A failed run is an overlay the row draws above itself, not a rung.

export const REGENERATE_STATE = Object.freeze({
  HIDDEN: "hidden",
  UNSUPPORTED_SCOPE: "unsupported-scope",
  UNSUPPORTED_JOB: "unsupported-job",
  RUNNING: "running",
  ENGINE_CANNOT: "engine-cannot",
  NEEDS_MATERIAL: "needs-material",
  STALE: "stale",
  NOTHING_TO_ADDRESS: "nothing-to-address",
  READY: "ready",
});

// The one engine whose Ideal chain checks every line against the user's resume.
const REGENERATING_ENGINE = "gemini";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function regenerateAvailability(descriptor) {
  const d = isObject(descriptor) ? descriptor : {};

  if (d.idealEnabled !== true || !d.reviewSource) return REGENERATE_STATE.HIDDEN;
  if (d.tab === "cover") return REGENERATE_STATE.UNSUPPORTED_SCOPE;
  if (d.tab !== "resume") return REGENERATE_STATE.HIDDEN;
  if (d.jobKind !== "ideal") return REGENERATE_STATE.UNSUPPORTED_JOB;
  if (d.inFlight === true) return REGENERATE_STATE.RUNNING;
  if (d.engine !== REGENERATING_ENGINE) return REGENERATE_STATE.ENGINE_CANNOT;
  if (!isObject(d.inputs) || d.inputs.posting !== true || d.inputs.realMaterial !== true) {
    return REGENERATE_STATE.NEEDS_MATERIAL;
  }
  if (d.fresh !== true) return REGENERATE_STATE.STALE;
  if (!(Number.isFinite(d.resolvableCount) && d.resolvableCount > 0)) return REGENERATE_STATE.NOTHING_TO_ADDRESS;
  return REGENERATE_STATE.READY;
}
