// Pure decision logic for what practice mode is allowed to CLAIM about who
// looked at the user's recorded video. Extracted out of AnswerFeedback.js
// (K1) so it is reachable from the repo's node-only vitest setup — no React,
// no DOM, nothing that lives inside a component module can be exercised by
// a test at all (the same reason answerWindow.js and answerPoints.js exist).
//
// Context a caller needs to have straight before using these: the "Include
// camera frames in AI feedback" switch (PracticeClient.js) is LIVE state,
// rendered on the same screen as the feedback panel it also feeds. If the
// panel's caption were re-derived from that switch's current value, toggling
// it after a critique has already returned would silently rewrite the
// caption for a request that already happened — no new request is made, the
// claim just changes under the user. The switch being on also does not mean
// a frame was sent: with the opt-in on but no camera present, the camera
// switched off, or the sampler having failed to capture anything, the frames
// array sent to Gemini is empty. The only honest signal for either function
// below is what actually left the browser for THIS request, not the flag
// that selected it — see usePracticeAnswer.js's runCritique and
// critiqueFramesSent.

// Whether the frames array actually handed to a critique request carried at
// least one frame. Deliberately tolerant of anything that isn't a non-empty
// array (missing, null, a string, an array-like object, a number) rather
// than throwing — callers pass this the literal `frames` array a request
// was built from, and a malformed value here must read as "nothing was
// sent", not crash the caption.
export function framesWereSent(frames) {
  return Array.isArray(frames) && frames.length > 0;
}

// Whether a human/model actually reviewed this answer's video: true only
// when the engine that produced the critique was Gemini AND frames were
// actually sent for that same request. The embedded engine never
// constructs a Gemini client or parses a frame, so this is never true for
// it regardless of framesSent. The Gemini-failed-and-fell-back-to-embedded
// path reports source "embedded" even though frames may already have been
// transmitted for the failed attempt — frames leaving the browser is a
// privacy fact, a review having happened is a separate fact, and this
// function reports the second one. Coerces `framesSent` with `!!` and
// compares `source` with `===` so the result is always a real boolean
// (never a truthy-but-not-`true` passthrough) — AnswerFeedback renders one
// of two different sentences off this value, so a sloppy passthrough would
// still pick the right branch and hide itself from a naive assertion.
export function videoWasReviewed(source, framesSent) {
  return source === "gemini" && !!framesSent;
}
