// Shared sanitiser for a drafted answer's bullet points, used by both
// CopilotDashboard.js (CurrentAnswerPanel and PredictedAnswerPanel) and
// practice mode's SampleAnswer.js. Both call sites guard the exact same
// failure: a `points` array carrying a blank, whitespace-only, or otherwise
// malformed entry rendering as an empty `<li>` that a candidate cannot tell
// apart from a real bullet. The most concrete way that reaches the render
// layer is lib/copilot/sampleAnswerState.js's cachedSampleAnswerFor, which
// returns its cache entry's `points` array UNFILTERED on a hit — by design
// (see that function's own doc comment) — because the cleaning is meant to
// happen here, at the render boundary, not in the cache.
//
// This sanitiser used to be two separate module-local copies —
// CopilotDashboard.js's `cleanAnswerPoints` and SampleAnswer.js's
// `cleanPoints` — and they had already drifted from each other:
// SampleAnswer.js's copy also `.trim()`ed each surviving entry; the
// dashboard's copy did not. Two copies of the same guard is exactly how they
// drift apart unnoticed; this module exists so there is exactly one copy
// left to drift.
//
// Deliberately no React, no MUI, no DOM. This repo's vitest config
// (vitest.config.js) runs with `environment: "node"` — no jsdom, no
// testing-library anywhere in the suite — so a sanitiser defined inside a
// component module is permanently unreachable from a test. Pulling it out
// into its own pure module is what makes it testable at all.
//
// Trimming: chosen deliberately, not inherited by accident from whichever
// copy happened to be ported first. A surviving entry that keeps its
// leading/trailing whitespace renders with a ragged indent inside the `<ul>`
// both call sites build, which is a real (if minor) rendering defect the
// dashboard's un-trimmed copy was previously letting through. Trimming here
// is a small, intentional behaviour change for the dashboard's two panels —
// see the callers for confirmation this is safe.
export function cleanAnswerPoints(points) {
  return (Array.isArray(points) ? points : [])
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => p.trim());
}
