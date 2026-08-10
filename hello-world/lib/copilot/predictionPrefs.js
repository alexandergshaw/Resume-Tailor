// Preference that turns off the copilot dashboard's speculative pair: the
// PREDICTED next question and its pre-drafted answer, guessed and drafted
// before anyone asks. That guess-and-draft pair roughly DOUBLES the model
// calls a detected question costs (R-105), and mid-interview it is two more
// panels competing for a phone screen. This module owns the pure decisions
// around that one preference — no React, no localStorage access — so they
// stay testable: vitest.config.js runs `environment: "node"` with no jsdom,
// so any of this logic living inside a component or a hook could not be
// unit-tested at all.

// localStorage key this preference persists under — distinct from the
// audio-source and microphone keys (see SOURCE_STORAGE_KEY/MIC_STORAGE_KEY
// in app/copilot/useCaptureSetup.js) so one control can never overwrite
// another's stored choice.
export const PREDICTION_STORAGE_KEY = "copilot-show-predictions";

// The predicted pair is today's existing behaviour, so the default — and
// what an unrecognized stored value resolves to below — is ON: a user who
// never touches this control must see it unchanged.
export const DEFAULT_SHOW_PREDICTIONS = true;

// Reads a raw stored value back into a real boolean. ONLY the exact string
// "false" turns the feature off; a missing key, an empty string, and any
// corrupt or hand-edited junk value (numbers, objects, "0", "off", "FALSE",
// padded whitespace, ...) all resolve to ON. This mirrors how the
// audio-source and microphone preferences already resolve an unrecognized
// stored value (see resolveInterviewerSource in lib/copilot/captureSupport.js
// and resolveStoredMicDeviceId in lib/copilot/audioDevices.js): fall back to
// the INCUMBENT behaviour, never to a new one. Failing toward OFF here would
// silently disable two panels with no user action and nothing on screen to
// explain why they vanished.
export function normalizeShowPredictions(raw) {
  return raw !== "false";
}

// The inverse of normalizeShowPredictions, for writing back to storage —
// which only ever holds strings.
export function serializeShowPredictions(value) {
  return value ? "true" : "false";
}

// Gates the speculative prediction + pre-draft work itself: it may run only
// while a session is `active` AND the user has left predictions visible.
// Before this preference existed the gate was `active` alone — keeping that
// half intact means turning predictions ON must never hand back more than it
// used to: merely selecting a posting must still not be enough to fire a
// prediction.
export function speculativeWorkEnabled(active, showPredictions) {
  return Boolean(active) && Boolean(showPredictions);
}

// Whether practice mode's privacy notice may still carry the pre-draft
// clause (preDraftClauseFor in lib/copilot/practiceNotices.js), which states
// that a predicted question and the prep context are sent to Gemini
// AUTOMATICALLY, before the user reveals anything. Hiding predictions stops
// that send from happening, so the clause must fall silent along with it —
// a notice that keeps claiming a transfer that no longer occurs is a false
// statement about where the user's data goes. This exists as its own
// function, rather than the notice reading the predictions switch directly,
// so it is forced to agree with speculativeWorkEnabled about whether a
// pre-draft can actually run — which is exactly what this module's own test
// asserts the two functions against each other.
export function preDraftDisclosureApplies(preDraftSwitchOn, showPredictions) {
  return Boolean(preDraftSwitchOn) && Boolean(showPredictions);
}
