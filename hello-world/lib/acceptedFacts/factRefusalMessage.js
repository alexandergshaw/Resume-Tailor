// Maps a lib/acceptedFacts/factDocx.js refusal `reason` to plain,
// candidate-facing copy (N56 half b). A single keyed lookup -- never an
// if-chain ending in one specific message -- so the next refusal reason
// someone adds to factDocx.js degrades to an honest generic message instead
// of silently inheriting whatever copy came before it.
//
// NO value here is the R1 pre-check's own copy (useCompanyResearch.js's
// NO_ENGINE_BYTES_REASON, "...its saved file is missing... Regenerate...").
// That message belongs to the genuinely-missing-bytes case alone, checked
// before the splice even runs; every reason a SPLICE can fail with gets its
// own honest copy here, and none of them may claim the file is missing or
// tell the candidate to regenerate -- regenerating would destroy the very
// bytes a splice refusal needs to retry.

const REFUSAL_MESSAGES = {
  // Reachable only defensively today (the R1 pre-check already catches a
  // missing-bytes accept before the splice runs), but still a distinct,
  // honest message rather than a fallthrough to NO_ENGINE_BYTES_REASON.
  "no-cover-bytes":
    "We can't add this to your cover letter right now because we don't have its file for this session. " +
    "Reopen the preview and try again.",
  // The N56 defect: two or more facts land on the same paragraph and the
  // second edit no longer matches what the letter actually says. The
  // remedy that works today: accept them one at a time.
  "stale-plan":
    "We can't add these facts to your cover letter together. Try adding them one at a time.",
  // Every planned edit was dropped (e.g. the target paragraph was empty).
  "no-edits":
    "We couldn't find a spot in your cover letter for this fact. Try a different placement, or add it by hand.",
  // The paragraph text is no longer present in the letter's file (a
  // hand-edited letter, or template drift).
  "not-found":
    "We couldn't add this to your cover letter because we couldn't find where it belongs anymore. " +
    "Try again, or add it to the letter by hand.",
  // The bytes would not load or serialize.
  "docx-error":
    "We ran into a problem opening your cover letter's file. Try again in a moment.",
};

// Names WHAT failed and WHAT to try -- never WHY. Reached by any reason no
// key above covers, so the next unmapped reason degrades safely instead of
// inheriting a specific (and possibly false) cause.
const DEFAULT_MESSAGE = "We couldn't add this to your cover letter right now. Try again in a moment.";

// @param {string} reason  a factDocx.js `reason` string (or anything else)
// @returns {string} candidate-facing copy; DEFAULT_MESSAGE for any reason
//   the record above does not name.
export function messageForRefusal(reason) {
  return Object.prototype.hasOwnProperty.call(REFUSAL_MESSAGES, reason) ? REFUSAL_MESSAGES[reason] : DEFAULT_MESSAGE;
}
