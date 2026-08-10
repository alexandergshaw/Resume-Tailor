// Decides which interviewer-audio capture sources a device can actually run.
//
// `getDisplayMedia` (tab/screen capture) is unsupported on EVERY mobile
// browser -- Safari on iOS, Chrome for Android, Samsung Internet, Android
// Browser and Opera Mobile are all unsupported per caniuse
// (mdn-api_mediadevices_getdisplaymedia). lib/copilot/session.js's
// THEM_CAPTURE_BY_SOURCE maps "tab" -> captureTabAudio and
// "system" -> captureSystemAudio, and both of those call
// navigator.mediaDevices.getDisplayMedia directly, so on a phone those two
// options are controls that can only ever throw. "inperson" captures only
// the microphone (getUserMedia) and works everywhere.
//
// This module decides what a device can offer and gates the UI accordingly.
// It is pure on purpose: no component or hook in this repo can be rendered
// in a test (vitest runs with `environment: "node"`, no jsdom), so the
// decision has to live somewhere testable outside CopilotClient.
//
// This module does NOT change lib/copilot/session.js. Its fallback to
// captureTabAudio for an unrecognized source is pinned by regression cases
// R-034/R-038/R-144 and is left exactly as-is.

// The full source vocabulary, in the order the UI presents them.
export const INTERVIEWER_SOURCES = ["tab", "system", "inperson"];

// Matches today's CopilotClient behaviour: useState("tab").
export const DEFAULT_INTERVIEWER_SOURCE = "tab";

// Feature detection only -- never user-agent sniffing. `getDisplayMedia`
// must be a callable function; a key that merely exists (e.g. set to `true`
// by some shim) would still throw if invoked, so presence alone is not
// enough. Optional chaining keeps this safe to call with null/undefined.
export function displayCaptureSupported(mediaDevices) {
  return typeof mediaDevices?.getDisplayMedia === "function";
}

// Which of the three interviewer-audio sources this device can run.
// "inperson" is always true -- it is what keeps a live session runnable on
// a phone even when display capture does not exist at all.
export function sourceAvailability(supported) {
  return {
    tab: supported,
    system: supported,
    inperson: true,
  };
}

// Resolves a stored source preference against what this device can
// actually run. An unrecognized/empty/missing stored value falls back to
// the default; a display-capture choice ("tab"/"system") that this device
// cannot run is coerced to "inperson" so the result is always usable (e.g.
// a value picked on a laptop, then read back on a phone via the same
// localStorage key).
export function resolveInterviewerSource(stored, displayCapture) {
  const value = INTERVIEWER_SOURCES.includes(stored) ? stored : DEFAULT_INTERVIEWER_SOURCE;
  if (value !== "inperson" && !displayCapture) {
    return "inperson";
  }
  return value;
}

// One-sentence explanation for why `source` can't be used on this device,
// or "" when it is usable. Deliberately phrased as a device/browser
// capability gap, not a permissions problem -- the browser never even gets
// a chance to prompt for permission because the API does not exist here.
export function unavailableSourceReason(source, displayCapture) {
  if (source === "inperson" || displayCapture) {
    return "";
  }
  // Wording notes: states the capability gap as the cause (the API is absent,
  // so the browser never even gets to prompt), names the option that does
  // work, and offers the desktop route for the call case. No dashes as
  // connectors -- they are not spoken at default screen-reader punctuation
  // levels, and a literal "--" also just reads as a typo on screen.
  return (
    "This browser can't share a tab or your screen. Pick the In person " +
    "(same microphone) option instead, or open the copilot in desktop " +
    "Chrome or Edge to capture a call."
  );
}
