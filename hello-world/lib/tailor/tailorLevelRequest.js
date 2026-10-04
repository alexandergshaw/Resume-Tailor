// N105 Step 6 - the client half of the tailoring-level control, kept out of
// ApplyingControls and app/page.js (both are line-capped god files).
//
// Two jobs, both thin wrappers over the committed vocabulary in tailorLevel.js:
//
//   1. levelSliderModel: what the slider shows (its max, its marks, its value).
//      The Ideal stop is DARK-LAUNCHED (idealDelivery.js's idealLevelEnabled, off
//      in slice 1): with the gate off the slider ends at the fifth stop and a
//      saved "ideal" mode is ignored, so a user can neither reach nor be silently
//      carried into a review-less Ideal run.
//
//   2. appendTailorLevel: write the level onto a tailor request's FormData. The
//      Ideal stop travels as the distinct `tailorMode` field and NEVER as
//      aggressiveness=6 (the route clamps aggressiveness to 1..5). The gate is
//      consulted here too, not only on the slider, so every send site inherits
//      the dark launch from one place.
//
// An Ideal request is also recorded as an activity-log decision (id
// "n105-ideal-run", registered in DECISION_LEDGER) with closed, content-free
// fields only: a canned reason code, the engine's code name and the level.

import { recordDecision } from "@/lib/activityLog/appActivityLog";
import { LEVEL_STOPS, IDEAL_STOP, TAILOR_MODE_IDEAL, levelToRequestFields } from "./tailorLevel.js";
import { idealLevelEnabled } from "./idealDelivery.js";

const MAX_ENGINE_CODE_CHARS = 32;

// `tailorMode` is "ideal" or "" (anything else counts as standard); `aggressiveness`
// is the user's saved 1..5 level, which choosing Ideal never overwrites.
function onIdealStop(tailorMode, idealOn) {
  return idealOn && tailorMode === TAILOR_MODE_IDEAL;
}

export function levelSliderModel(tailorMode, aggressiveness, idealOn = idealLevelEnabled()) {
  const stops = idealOn ? LEVEL_STOPS : LEVEL_STOPS.filter((stop) => stop.value !== IDEAL_STOP);
  return {
    min: stops[0].value,
    max: stops[stops.length - 1].value,
    marks: stops.filter((stop) => stop.mark).map((stop) => ({ value: stop.value, label: stop.mark })),
    value: onIdealStop(tailorMode, idealOn) ? IDEAL_STOP : aggressiveness,
  };
}

function engineCode(engine) {
  return typeof engine === "string" && engine.trim() ? engine.trim().slice(0, MAX_ENGINE_CODE_CHARS) : "unknown";
}

// The request fields for the user's current level: `{ tailorMode: "ideal" }` or
// `{ aggressiveness: 1..5 }`, never both. `scope` is passed through for callers
// whose run does not include the resume (such a run stays on the saved level).
function tailorLevelFields(tailorMode, aggressiveness, { scope } = {}) {
  const idealOn = idealLevelEnabled();
  const value = onIdealStop(tailorMode, idealOn) ? IDEAL_STOP : aggressiveness;
  return levelToRequestFields(value, aggressiveness, { scope });
}

// Writes the level fields onto `formData` and, when the request is an Ideal
// generation (or an Ideal selection the gate turned back into a standard run),
// records the decision. Returns the fields it wrote.
export function appendTailorLevel(formData, tailorMode, aggressiveness, { engine, scope } = {}) {
  const fields = tailorLevelFields(tailorMode, aggressiveness, { scope });
  for (const [name, value] of Object.entries(fields)) formData.append(name, String(value));
  if (fields.tailorMode === TAILOR_MODE_IDEAL) {
    recordDecision("n105-ideal-run", "acted", {
      reason: "ideal-requested",
      engine: engineCode(engine),
      level: TAILOR_MODE_IDEAL,
    });
  } else if (tailorMode === TAILOR_MODE_IDEAL && !idealLevelEnabled()) {
    recordDecision("n105-ideal-run", "skipped", { reason: "gate-off", engine: engineCode(engine), level: "standard" });
  }
  return fields;
}
