// N113 - what one activation of the review control ended in, as a decision record
// for the app's activity log (lib/activityLog/activityChannels.js, DECISION_LEDGER
// "document-review"). PURE: no React, no IO, no clock.
//
//   reviewDecisionFor({ surface, request, result }) -> { outcome, fields }
//
//     surface   "modal" | "chat"
//     request   the review request (only its `scope` is read)
//     result    { outcome, covered } as DocumentReviewSection builds it: `covered`
//               when another surface already shows a live review of this text,
//               else `outcome` is a runDocumentReview ReviewOutcome
//
// Outcomes use the log's closed vocabulary: "acted" a review ran, "refused" there
// was no text to review, "skipped" the review above already covers this text,
// "failed" it could not run (and anything not recognised, so an unknown state can
// never read as a review that ran).
//
// COUNTS AND CODES ONLY. This log is downloaded and shared onward, so nothing of the
// document reaches it: not the title (a company and a job), not an excerpt, not a
// flag's message, not a line of the resume. Every value below is a whitelisted code,
// a boolean or a non-negative whole number; a value outside its whitelist is
// recorded as "unknown" rather than passed through, so a surprising input can only
// make a record less specific, never carry text. The field names are the ones the
// ledger entry declares (the recorder drops any other without a sound).

export const REVIEW_DECISION_ID = "document-review";

const SURFACES = ["modal", "chat"];
const SCOPES = ["resume", "cover", "hypothetical"];
const VERDICT_KINDS = ["none", "partial", "complete"];
const ENGINE_MODE_RE = /^[a-z][a-z-]{0,30}$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const oneOf = (value, allowed) => (allowed.includes(value) ? value : "unknown");
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

function baseFields(surface, request) {
  return {
    surface: oneOf(surface, SURFACES),
    scope: oneOf(isObject(request) ? request.scope : undefined, SCOPES),
  };
}

export function reviewDecisionFor({ surface, request, result } = {}) {
  const base = baseFields(surface, request);
  const covered = isObject(result) && result.covered === true;
  const outcome = isObject(result) && isObject(result.outcome) ? result.outcome : null;

  if (covered) return { outcome: "skipped", fields: { ...base, kind: "covered", reason: "already-covered" } };

  if (outcome?.status === "empty") return { outcome: "refused", fields: { ...base, kind: "empty", reason: "no-text" } };

  if (outcome?.status === "reviewed") {
    const kind = oneOf(outcome.verdictKind, VERDICT_KINDS);
    return {
      outcome: "acted",
      fields: {
        ...base,
        kind,
        reason: "reviewed",
        flagCount: Array.isArray(outcome.flags) ? outcome.flags.length : 0,
        lineCount: count(outcome.lineCount),
        engineMode: typeof outcome.engineMode === "string" && ENGINE_MODE_RE.test(outcome.engineMode) ? outcome.engineMode : "unknown",
        coverageComplete: kind === "complete",
      },
    };
  }

  return { outcome: "failed", fields: { ...base, kind: "failed", reason: "review-error" } };
}
