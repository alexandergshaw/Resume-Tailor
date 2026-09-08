// ARCH-sticky §2.7/§3.1. The live/practice copy for the copilot dashboard's
// panels, extracted from app/copilot/dashboard/CopilotDashboard.js so the
// sticky question strip (app/copilot/dashboard/StickyQuestionStrip.js) and
// the dashboard itself can share ONE merge over ONE set of defaults, instead
// of the panel's copy defaults living in a component it no longer renders.
//
// F10 (ARCH-sticky §2.7): `{...undefined}` is legal JS, so a residual import
// that resolves to `undefined` yields blank copy with nothing in eslint,
// jsdom or the build to see it. The fix needs no measurement, only one fact:
// a module cannot fail to import from itself. Both LIVE_COPY/PRACTICE_COPY
// below and the `dashboardCopy()` merge at the bottom read the SAME
// module-local `LIVE_COPY` binding, so neither caller (CopilotDashboard.js's
// own two remaining panels, or StickyQuestionStrip's relocated one) can ever
// drift from a copy that failed to resolve across a module boundary.

// AC-J2.2: live mode's wording, verbatim — every string this component
// rendered before practice mode shared it. It is the DEFAULT for the `copy`
// prop, so live mode passes nothing and its output is unchanged; the same
// "defaults are the incumbent mode's exact strings" discipline
// PostingPicker.js's `label`/`blankHint` already use. Keeping both modes'
// wording in one place, side by side, is also what makes a drift between
// them visible in review rather than spread across two components.
export const LIVE_COPY = {
  title: "Live dashboard",
  currentQuestionTitle: "Current question",
  noQuestion: "No question has been detected yet this session.",
  currentAnswerTitle: "Answer to the current question",
  noCurrentAnswer: "There is no current question to answer yet.",
  noPoints: "No talking points have been drafted for this question yet.",
  // Covers both readings in DeliveryPanel (speed and filler rate), not
  // speed alone any more.
  deliveryTitle: "Your delivery",
};

// AC-J2.2: practice mode's wording. Deliberately the SAME sentences
// wherever a live-mode sentence is still true with no interviewer in the
// room — the differences below are all places where live's wording would
// be a false statement here, not places where practice was given a
// different voice for its own sake.
export const PRACTICE_COPY = {
  ...LIVE_COPY,
  title: "Practice dashboard",
  noQuestion: "No question yet — press Start practice to get your first one.",
  // R-109: `noCurrentAnswer` is deliberately NOT overridden. Live's wording
  // turns on the word "current", which is perfectly true in practice mode —
  // there IS a current question — so paraphrasing it to "on screen" was
  // divergence for its own sake, and it made this mode contradict itself:
  // the panel titles still say "Current question" and "Answer to the
  // current question", so the body text would have called the same thing by
  // a different name three lines under its own heading. The bar for an
  // override here is that live's sentence would be FALSE with no
  // interviewer in the room, not that a different phrasing reads slightly
  // better.
  noPoints: "No sample answer has been drafted for this question yet.",
};

// ARCH-stats-in-strip r3 §2.3: the wpm/filler label -> display-text maps,
// moved here from app/copilot/dashboard/CopilotDashboard.js so StatsRow.js
// (the sticky strip's own reading, ARCH-stats-in-strip r3) and
// CopilotDashboard's DeliveryPanel import the SAME lookup rather than each
// keeping its own copy — two copies is exactly how the strip and the
// dashboard would come to call the same wpm figure two different things.
// The COLOR maps stay in CopilotDashboard.js: they are read only there
// (§2.5 — the strip carries the threshold in the word alone, never color,
// because `--warning` fails contrast on the strip's canvas ground).
export const PACE_LABEL_TEXT = { slow: "Slow", conversational: "Conversational", rushed: "Rushed" };
// `noticeable`/`heavy` deliberately share a label family with pace's
// `slow`/`rushed` — the LABEL TEXT is what tells them apart, never color
// alone (WCAG 1.4.1), same reasoning PACE_LABEL_TEXT's siting comment gives.
export const FILLER_LABEL_TEXT = { clean: "Clean", noticeable: "Some filler", heavy: "Heavy filler" };

// ARCH-sticky §2.7: the runtime merge. Called by BOTH
// app/copilot/dashboard/CopilotDashboard.js (for its own remaining panels'
// copy) and app/copilot/dashboard/StickyQuestionStrip.js (for the relocated
// CurrentQuestionPanel's copy) — the same call CopilotDashboard.js used to
// make alone, now made twice against the SAME module-local LIVE_COPY above,
// so a caller supplying a partial `copy` object still gets a complete one on
// both sides of the relocation, and neither side can silently disagree about
// what "the rest of the copy" is.
export function dashboardCopy(copy) {
  return { ...LIVE_COPY, ...(copy || {}) };
}
