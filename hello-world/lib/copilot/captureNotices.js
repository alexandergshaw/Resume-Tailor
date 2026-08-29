// AC-X1b (headroom extraction, wave 0 of chunk C — NOT a chunk-C feature):
// split out of app/copilot/CopilotClient.js purely to buy that file room
// under its own hard, executable 950-line ceiling
// (CopilotClient.extraction.test.js:48-49) before chunk C's own edits land.
// Pure text logic only — no DOM, no React, no network — so it is
// unit-tested directly against the literal oracles in
// captureNotices.test.js. Sibling to groundingNotice.js, which already set
// this precedent for the same reason (see that module's own doc).
//
// Moved verbatim, comments included, from CopilotClient.js:464-480 — this
// is a relocation, not a rewording, and the strings below are pinned by
// EQUALITY in captureNotices.test.js so that stays true.

// The tab option keeps today's wording verbatim; the system option needs
// different share-dialog instructions plus a note on when to reach for it.
// AC-M1.5.3: "inperson" has no share dialog at all — mic-only capture via
// getUserMedia — so neither the tab nor the system wording may render for
// it; this branch says so instead of describing a picker that never
// appears for this source.
export function shareInstructionsFor(source) {
  return source === "inperson"
    ? // Extra (adversarial review): a period, not an em dash — this
      // codebase's screen-reader rule (see other copilot notices' own
      // comments) is that an em dash is not spoken as a pause at default
      // punctuation settings, so a sentence whose two independent clauses
      // depend on that pause for meaning is a defect, not a style choice.
      "Everyone speaks into your selected microphone. There is no tab or screen to share."
    : source === "system"
      ? 'Share your Entire Screen (with "Share system audio" enabled) and allow your mic — use this when the interview is running in a desktop app (Zoom, Teams, etc.) rather than a browser tab.'
      : 'Share the meeting tab (with "Share tab audio" enabled) and allow your mic.';
}
