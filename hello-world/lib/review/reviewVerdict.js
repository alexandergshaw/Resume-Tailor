// The ONE shared complete-versus-partial rule for a document review, PURE.
//
// Every consumer of the shared reviewer (N105's band, N103, N104) asks this
// module whether a review is complete before it may say anything reassuring
// about it. It fails CLOSED: a missing, malformed or self-contradicting
// `coverage` is `partial`, never `complete`, so an overclaiming producer cannot
// make an unanalysed draft read clean.
//
//   none      no review at all
//   partial   a review exists but is not provably complete
//   complete  coverage.complete === true AND all seven categories evaluated
//             AND the engine mode does not contradict it
//
// `missingChecks` names the categories not fully checked, in the enum's own
// order (all seven when coverage is unusable, and for `none`); `checkedChecks`
// is the complement (empty in those same cases).

import { CATEGORY } from "./contract.js";

export const REVIEW_KIND = Object.freeze({
  NONE: "none",
  PARTIAL: "partial",
  COMPLETE: "complete",
});

const ALL_CATEGORIES = Object.values(CATEGORY);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function reviewVerdict(review) {
  if (!isObject(review)) {
    return { kind: REVIEW_KIND.NONE, missingChecks: [...ALL_CATEGORIES], checkedChecks: [] };
  }

  const coverage = review.coverage;
  if (!isObject(coverage) || !Array.isArray(coverage.evaluatedCategories)) {
    return { kind: REVIEW_KIND.PARTIAL, missingChecks: [...ALL_CATEGORIES], checkedChecks: [] };
  }

  const evaluated = new Set(coverage.evaluatedCategories);
  const missingChecks = ALL_CATEGORIES.filter((c) => !evaluated.has(c));
  const checkedChecks = ALL_CATEGORIES.filter((c) => evaluated.has(c));
  const claimsComplete = coverage.complete === true;
  // A mechanical-only run can never have evaluated everything; if it says it
  // did, one of the two statements is false and we trust the closed side.
  const contradicted = coverage.engineMode === "mechanical-only";

  const kind =
    claimsComplete && missingChecks.length === 0 && !contradicted
      ? REVIEW_KIND.COMPLETE
      : REVIEW_KIND.PARTIAL;
  return { kind, missingChecks, checkedChecks };
}
