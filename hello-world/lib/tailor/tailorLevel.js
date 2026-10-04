// N105 Step 1 - the level <-> request vocabulary, PURE.
//
// The tailoring slider gains a sixth stop, "Ideal". That stop is a MODE, not an
// intensity: it travels to the server as the distinct request field
// `tailorMode: "ideal"` and is NEVER sent as `aggressiveness=6`. The route
// clamps `aggressiveness` to 1..5 (parseAggressiveness), so a 6 in that field
// would be silently absorbed into "Strong" and the Ideal pipeline would never
// run. `tailorMode` and `aggressiveness` are therefore separate state: choosing
// Ideal never overwrites the user's saved 1..5 level, which stays available for
// the runs that must not use Ideal (a cover-letter regenerate).
//
// This file is the one place the stop table, its a11y text, its captions and
// the refusal sentences live, so the slider, the caption leaf, the route and
// the tests cannot drift apart. It imports nothing and touches no storage.

export const IDEAL_STOP = 6;
export const TAILOR_MODE_IDEAL = "ideal";

const MIN_STANDARD = 1;
const MAX_STANDARD = 5;
const DEFAULT_STANDARD = 3;

// The six stops. `mark` is the visible label under the slider (only four of the
// six carry one); `ariaValueText` is what a screen reader announces at the stop.
export const LEVEL_STOPS = Object.freeze([
  Object.freeze({ value: 1, mark: "Light", ariaValueText: "Light" }),
  Object.freeze({ value: 2, mark: null, ariaValueText: "Level 2 of 5" }),
  Object.freeze({ value: 3, mark: "Balanced", ariaValueText: "Balanced" }),
  Object.freeze({ value: 4, mark: null, ariaValueText: "Level 4 of 5" }),
  Object.freeze({ value: 5, mark: "Strong", ariaValueText: "Strong" }),
  Object.freeze({ value: IDEAL_STOP, mark: "Ideal", ariaValueText: "Ideal, builds two resumes" }),
]);

export function levelAriaValueText(value) {
  const stop = LEVEL_STOPS.find((s) => s.value === Number(value));
  return stop ? stop.ariaValueText : "";
}

// Captions under the slider. The level 1-5 caption deliberately avoids the word
// "hypothetical" so no sweep outside the Ideal path can trip on it.
export const LEVEL_CAPTIONS = Object.freeze({
  standard:
    "Ideal, the top level, builds two resumes: a best-case one to study and a truthful one to send.",
  ideal:
    "Ideal builds two files in one run: a HYPOTHETICAL best-case resume (to study, never to submit) and an application-ready resume limited to what your own resume supports. Resume only - no cover letter or email. Expect it to take longer than other levels.",
  switchedToGemini: "Engine switched to Gemini (AI).",
});

// Visible caption when Ideal is selected on an engine that cannot run it.
export function idealCannotRunCaption(engineLabel) {
  return `Ideal needs the Gemini AI engine. You are on ${labelOr(engineLabel)}, which cannot build it.`;
}

// The hidden announcer's short form of the same state.
export function idealCannotRunAnnouncement(engineLabel) {
  return `Ideal needs the Gemini AI engine. You are on ${labelOr(engineLabel)}.`;
}

function labelOr(engineLabel) {
  const label = typeof engineLabel === "string" ? engineLabel.trim() : "";
  return label || "the current engine";
}

function clampStandard(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_STANDARD, Math.max(MIN_STANDARD, n));
}

// Ideal builds a resume pair, so it only applies to a run whose scope includes
// the resume. The main tailor form passes no scope at all, which is the resume
// path. A "cover" (or "email") scope never takes it.
function scopeIncludesResume(scope) {
  return scope === undefined || scope === null || scope === "" || scope === "resume" || scope === "both";
}

// Maps the slider's value to the request fields. Returns EITHER
// `{ tailorMode: "ideal" }` OR `{ aggressiveness: <1..5> }`, never both and never
// an aggressiveness outside 1..5.
//
//   sliderValue          the live slider value, 1..6
//   savedAggressiveness  the user's saved 1..5 level (untouched by Ideal)
//   scope                "resume" | "both" | undefined run the resume path;
//                        "cover" | "email" always take the standard path with
//                        the SAVED level, even when the slider sits on Ideal
export function levelToRequestFields(sliderValue, savedAggressiveness, { scope } = {}) {
  const saved = clampStandard(savedAggressiveness, DEFAULT_STANDARD);
  if (Number(sliderValue) === IDEAL_STOP) {
    return scopeIncludesResume(scope) ? { tailorMode: TAILOR_MODE_IDEAL } : { aggressiveness: saved };
  }
  return { aggressiveness: clampStandard(sliderValue, saved) };
}

// The one source for the two refusal sentences the route returns (HTTP 422) and
// the caption mirrors. Each leads with the requirement and states the remedy;
// none opens with "Error", "Failed", "Sorry" or "Unable".
//
//   "engine-unsupported"  the resolved engine cannot run Ideal
//   "empty-resume"        the uploaded resume yielded no text to ground on
export function idealRefusalMessage(code, { engineLabel, fileName } = {}) {
  if (code === "engine-unsupported") {
    return `The Ideal level needs the Gemini AI engine, and you are on ${labelOr(engineLabel)}. Switch the engine in the top bar, or pick another level.`;
  }
  if (code === "empty-resume") {
    const name = typeof fileName === "string" && fileName.trim() ? fileName.trim() : "your resume";
    return `We could not read any text in "${name}". The Ideal level needs your resume's text to keep the application-ready version truthful. Upload a .docx, .txt or .md resume with selectable text (not a scan or image) on the Materials tab, then try again.`;
  }
  throw new TypeError(`Unknown Ideal refusal code: ${String(code)}`);
}
