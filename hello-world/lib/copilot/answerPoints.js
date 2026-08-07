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

// AC-K1.1: what a drafted answer actually RENDERS as bullets. The cues (a few
// words each — lib/copilot/answerCues.js) are the point of the exercise: they
// are read mid-question, in a glance. The full `points` are the fallback, for
// two real cases rather than as belt-and-braces:
//
//   - a draft cached before cues existed (useSampleAnswer's cache and live
//     mode's answerCacheRef both survive across a deploy within one open
//     session), and
//   - any response where the cues came back empty while the points did not.
//
// Showing the full sentences in either case is a worse read but a correct
// one; showing nothing would look like the draft failed. Defined here rather
// than in answerCues.js because this is a RENDER decision — the same reason
// cleanAnswerPoints lives here and not in the cache — and defined once
// because three surfaces make it (practice's SampleAnswer, live's
// QuestionFeed card, and the shared dashboard's answer panels), which is
// exactly the count that let this module's own filter drift last time.
export function answerBullets(cues, points) {
  const cleanCues = cleanAnswerPoints(cues);
  return cleanCues.length ? cleanCues : cleanAnswerPoints(points);
}
