// N50 fix round 4 (line-cap extraction): the pure, framework-free pack
// readers PrepPackPanel.js's own render functions (AnswerSection,
// AskThemSection, StagesSection) and its `allSupports` orphan-claims check
// all shared, pulled out so that file has room for this round's fixes under
// its own 1000-line cap (standing rule: pure logic moves to its own module,
// never trimmed comments or a raised ceiling). No React import, no JSX --
// every function here takes a plain pack object and returns a plain value,
// exactly as it did inline. PrepPackPanel.js is this module's own importer;
// ./PrepPackNamesStrip.js (N50 fix round 5, below) also imports `joinNames`.
//
// N50 fix round 5 (line-cap extraction, same standing rule): `runningSectionBannerText`
// and `joinNames` joined this module for the same reason -- neither touches
// React or JSX, and moving pure logic here, rather than trimming a comment or
// raising the 1000-line ceiling, is this repo's own standing rule for making
// room. `prepActionState` deliberately stayed in PrepPackPanel.js: its only
// CROSS-MODULE consumer today is PrepPackPanel.generate.test.js's own by-name
// import (lib/sourceScan/exportReachability.sweep.test.js's own TEST_REFERENCED
// bucket, pinned at 363, counts it there) -- moving it here would give it a
// real PRODUCTION consumer instead (this file's own PrepPackPanel.js
// importer), demoting it out of that bucket and moving a ledger this round is
// out of scope to update (lib/sourceScan). `sectionEnabled` (PrepPackPanel.js)
// stayed for the same reason: it calls `prepActionState` directly, and moving
// it here without also moving `prepActionState` would need a re-export or a
// circular import, either of which risks the same ledger.

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function answerLines(pack, name) {
  const section = asPlainObject(asPlainObject(pack?.sections)[name]);
  const answer = asPlainObject(section.answer);
  return Array.isArray(answer.lines) ? answer.lines : [];
}

export function askThemQuestions(pack) {
  const section = asPlainObject(asPlainObject(pack?.sections).askThem);
  return Array.isArray(section.questions) ? section.questions : [];
}

export function stageList(pack) {
  const section = asPlainObject(asPlainObject(pack?.sections).stages);
  return Array.isArray(section.stages) ? section.stages : [];
}

export function packClaims(pack) {
  return Array.isArray(pack?.claims) ? pack.claims : [];
}

/** Every `support` in the pack, from all four sections, in no particular
 *  order -- AC-N43.5's disclosure only needs which claim ids were
 *  referenced anywhere, never where. */
export function allSupports(pack) {
  return [
    ...answerLines(pack, "aboutYou").map((line) => line?.support),
    ...answerLines(pack, "whyRole").map((line) => line?.support),
    ...askThemQuestions(pack).map((question) => question?.support),
    ...stageList(pack).map((stage) => stage?.support),
  ];
}

// M2 (N50 fix round 1): while the server reports `running` for a SECTION
// action this session's own queue knows about, the banner must name that
// section rather than claim the whole pack is generating (AC-N50.16(c),
// extended to the reopen path) -- never a positional word (AC-N50.14).
export function runningSectionBannerText(label) {
  return `Regenerating ${label} — the rest of this pack stays as it is until it finishes.`;
}

// N50 fix round 7 (verify.r7.md minor m-5): the whole-pack queued line's own
// copy, kept here alongside this module's other pure text builders. A
// whole-pack regenerate can queue behind a live section action and then have
// its job description removed before it drains (AC-N50.15(c) crossed with an
// edit from the tracking row's own Edit form or another tab) -- until this
// round the queued line still promised "will regenerate once the current
// update finishes" while GenerateControl's own no-description text, right
// beside it, said there was nothing to generate from. Both sentences were
// true at different moments, but shown together they read as one
// contradiction, so the queued line now states the reason it will not run.
export function wholePackQueuedText(hasDescription) {
  return hasDescription
    ? "Queued — the whole pack will regenerate once the current update finishes."
    : "Queued, but the job description is gone — this action will not run until one is added back.";
}

/** `interviewerNames` -> the exact comma-joined text the edit field seeds
 *  itself from, and the inverse of `useApplicationDialogs.js`'s own
 *  `split(",").map(trim).filter(Boolean)` -- reused so a round trip through
 *  the field (load, no edit, Save) reproduces the identical stored list. */
export function joinNames(interviewerNames) {
  return (Array.isArray(interviewerNames) ? interviewerNames.filter(Boolean) : []).join(", ");
}
