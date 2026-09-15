// AC-N18.9/F-A1, AC-N18.13 "Label by state". Two small, pure decisions
// CopilotClient.js's confirm-gate wiring needs — split out purely to keep
// that file under its own line cap (CopilotClient.extraction.test.js), the
// same reasoning every other lib/copilot/ split in this codebase gives for
// pulling a decision out of a capped component file. Neither function
// touches React, the DOM, a network call or a clock; both are called
// straight from CopilotClient.js's render body and its onConfirmQuestion
// callback.

// The reveal control's own label, by the CURRENT entry's draft status. Read
// at DETECTION, not once drafting finishes — waiting for `done` before
// offering it would prompt the candidate only after the interviewer had
// already finished talking. "(drafting)" while a draft is still in flight;
// plain "Show answer" once it's ready, or before autoDraft has even started
// one (a click either reveals it or, per needsDraftOnConfirm below, starts
// that same draft).
export function confirmRevealLabel(status) {
  return status === "loading" ? "Show answer (drafting)" : "Show answer";
}

// AC-N18.9/F-A1: with autoDraft off, a freshly confirmed entry can still be
// `idle` — nothing has drafted it yet. Revealing it as-is would show an
// empty panel and force a second click on QuestionFeed's own "Draft answer"
// button. This is the predicate CopilotClient.js's onConfirmQuestion checks
// to start that same draft in the SAME click that confirms, instead.
export function needsDraftOnConfirm(entry) {
  return !!entry && entry.status === "idle";
}

// m9/m10: resolves an id to its LIVE entry in `questions`, never a snapshot
// taken earlier — the primitive both CopilotClient.js's "confirm next"
// control (m9, wiring useLiveSession's confirmNext) and its reveal button
// (m10) share, so a click always confirms the entry that id currently names
// rather than whatever a render-scope variable happened to equal when the
// closure was created. `fallback` (defaults `null`) is what a caller hands
// back when the id no longer resolves — the reveal button's own case, where
// falling through to the confirmed-current entry beats confirming nothing.
export function entryById(questions, id, fallback = null) {
  const list = Array.isArray(questions) ? questions : [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].id === id) return list[i];
  }
  return fallback;
}
