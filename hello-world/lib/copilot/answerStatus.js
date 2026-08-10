// F9: the sentence read aloud by the persistently-mounted, visually-hidden
// status region beside every surface that shows a drafted answer —
// QuestionFeed.js's single feed-level region, CopilotDashboard.js's
// CurrentAnswerPanel and PredictedAnswerPanel, and practice mode's
// SampleAnswer.js. Pure and side-effect free so it is reachable from this
// repo's node-only vitest setup at all (the suite defaults to
// `environment: "node"` — the same discipline answerPoints.js and
// answerProvenance.js already follow). Amended: this used to read "no jsdom
// anywhere in the suite", which is no longer true — a single file can opt
// in with a `// @vitest-environment jsdom` docblock (see vitest.config.js's
// own comment). That does not change anything here: keeping this pure is
// still the right call, and the escape hatch is for wiring no pure function
// can express, not for retreating from extraction.
//
// A REAL SUBTLETY this module exists to get right: a live region that
// MOUNTS at the same moment its final text is already inside it usually
// does NOT get announced by NVDA/JAWS — only a TEXT CHANGE on an
// already-mounted region does. Every caller must therefore render its
// status element UNCONDITIONALLY (never nested inside a
// conditionally-rendered panel) and feed it this string on every render, so
// "" (idle) -> "Drafting an answer" (loading) -> "Answer ready, N points"
// (done) are all text changes on the SAME node, never a region that just
// appeared already carrying its final content. practice mode's
// SampleAnswer.js is the case that bites hardest: its whole panel is
// conditionally rendered on `visible`, so its hidden status span must live
// OUTSIDE that conditional, not nested inside it, or revealing an
// already-cached (R-111) answer would mount the region and its final text
// in the same frame and say nothing.
//
// `bulletCount` is the caller's already-computed `answerLines(...).length`
// (lib/copilot/answerPoints.js) — this module does not recompute cues vs.
// points, the same "one decision, one place" reasoning that module's own
// doc comment gives for why it is shared rather than reimplemented per
// caller.
//
// F11/R-123: an "error" status deliberately returns "" here, same as idle —
// there is no `error` parameter at all. Every surface that can reach
// `status: "error"` also renders an MUI `Alert severity="error"` for that
// same failure, and `Alert` sets `role="alert"` on its own — so this
// `role="status"` region announcing the error too would be a SECOND,
// redundant announcement of the same failure, worded independently of the
// first (that drift already happened once: SampleAnswer.js's Alert said
// "Could not draft a sample answer." while this region said "Could not
// draft an answer."). The Alert is the single source of truth for an error
// announcement; this region just stays silent so it can never repeat or
// contradict it.
export function answerStatusMessage({ status, bulletCount } = {}) {
  if (status === "loading") return "Drafting an answer";
  if (status === "done") {
    const n = Number.isFinite(bulletCount) && bulletCount > 0 ? bulletCount : 0;
    return `Answer ready, ${n} point${n === 1 ? "" : "s"}`;
  }
  // idle, error (see above), undefined/unknown status, or no question yet
  // at all — nothing to announce rather than a generic "not started"
  // sentence read out on every question card the instant it appears.
  return "";
}

// F9/BUG (phantom dependency): the standard visually-hidden clip-rect style,
// shared by every caller of answerStatusMessage above rather than each
// importing `visuallyHidden` from `@mui/utils` — a package this repo's
// package.json does not declare as a dependency (only `@mui/material` and
// `@mui/icons-material` are). Resolving it depended entirely on npm's
// hoisting; a different install layout (`npm ci`, pnpm, a hoisting change)
// is free to break that. This module is already the one thing every one of
// those call sites imports, so the style lives here instead of adding a
// dependency for one object literal.
// Every length here carries an EXPLICIT unit, and that is load-bearing rather
// than stylistic. All six call sites pass this object to MUI's `sx`, which
// reinterprets bare numbers: in the sizing system `width: 1` / `height: 1`
// mean "100%" (any number in 0..1 is a fraction), and in the spacing system
// `margin: -1` means -1 * 8px = -8px. So the plain-CSS reading of this object
// -- a 1px box nudged 1px -- is not what shipped. It computed to
// `width: 100%; height: 100%; margin: -8px`, i.e. a full-size absolutely
// positioned element at its static position, measured in the browser as a real
// 320x900px box. It stayed invisible (clip + overflow still do their job), so
// nothing looked wrong; what it did instead was silently extend the document's
// scroll width, which on a phone is indistinguishable from a layout bug
// because app/globals.css:20 clips horizontal overflow at the root.
// Do not "simplify" these back to bare numbers.
export const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};
