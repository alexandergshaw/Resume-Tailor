// N104 - the before/after comparison behind "what regenerating changed". PURE: it
// compares two reviews it is handed; it analyses nothing and mints nothing.
//
//   compareReviewGaps({ before, after, resolvable, beforeRequirementIds,
//                       afterRequirementIds }) -> ClosureReport
//
//   before / after   ReviewOutcome-shaped ({ flags, unresolvedQualifications,
//                    lineCount }): the review the regenerate started from, and the
//                    re-review of the regenerated document
//   resolvable       the named gaps (classifyWeaknesses(before).resolvable): the
//                    only ones whose closure is claimed
//   *RequirementIds  the requirement ids each review was scored against, supplied
//                    by the caller from the two posting analyses
//
//   ClosureReport = { correspondenceUnavailable, closed, stillOpen,
//                     countsBefore, countsAfter, lineCountBefore, lineCountAfter,
//                     genuinelyUnqualifiedStillOpen }
//
// A gap is reported CLOSED only when a re-review shows it gone, so the report can
// never claim a fix that was not measured. Two things make that claim fragile and
// each is handled here rather than hoped away:
//
//   IDENTITY. A posting-anchored gap is (category, origin, requirementId, term).
//   One requirement yields one keyword flag PER term, all sharing its id, so
//   without the term two gaps collapse into one and closing either would hide the
//   other. Draft-anchored gaps (vague, repetition) have no id that survives a
//   rewritten draft; they are reported as category COUNTS and never as a per-line
//   "closed".
//
//   CORRESPONDENCE. Requirement ids come from a model's output order, so a re-review
//   scored against a fresh analysis could rename a requirement and make a gap that
//   is still missing look gone. The ids both reviews were scored against must be the
//   same set. When they are not, every per-gap claim is withheld (closed and
//   stillOpen are empty, correspondenceUnavailable is true) and only the counts,
//   which need no identity, are reported.
//
// Counts and line counts are always reported, so a shorter document cannot read as a
// better one without the user seeing it got shorter.

import { CATEGORY, ORIGIN } from "./contract.js";
import { DRAFT_KIND, presentFlag } from "./flagPresentation.js";
import { missingKeywordTerm, shippedFlags, termKey } from "./gapIdentity.js";

const idSet = (ids) => new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string"));

function sameIds(a, b) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

// category -> how many flags the review carries, for the three wording categories.
function countsOf(review) {
  const flags = shippedFlags(review);
  const count = (category) => flags.filter((flag) => flag.category === category).length;
  return {
    missingKeyword: count(CATEGORY.MISSING_KEYWORD),
    vague: count(CATEGORY.VAGUE_UNSUPPORTED),
    repetition: count(CATEGORY.REPETITION),
  };
}

// The per-gap identity of a posting-anchored keyword flag, or null when the flag
// has none (not a posting-anchored keyword flag, or no term in its message).
function gapOf(flag) {
  if (flag.category !== CATEGORY.MISSING_KEYWORD) return null;
  const ref = flag.evidenceRef;
  if (ref?.origin !== ORIGIN.POSTING || typeof ref.spanId !== "string") return null;
  const term = missingKeywordTerm(flag);
  if (term === null) return null;
  return {
    key: `${flag.category}\u0000${ref.origin}\u0000${ref.spanId}\u0000${termKey(term)}`,
    row: {
      category: flag.category,
      requirementId: ref.spanId,
      term,
      label: presentFlag(DRAFT_KIND.APPLICATION_READY, flag.category).label,
    },
  };
}

// key -> the report row for that gap, first occurrence wins.
function gapsByKey(flags) {
  const out = new Map();
  for (const flag of flags) {
    const gap = gapOf(flag);
    if (gap && !out.has(gap.key)) out.set(gap.key, gap.row);
  }
  return out;
}

const lineCountOf = (review) => (Number.isFinite(review?.lineCount) ? review.lineCount : null);

export function compareReviewGaps({ before, after, resolvable, beforeRequirementIds, afterRequirementIds } = {}) {
  const correspond = sameIds(idSet(beforeRequirementIds), idSet(afterRequirementIds));
  const closed = [];
  const stillOpen = [];

  if (correspond) {
    const inBefore = gapsByKey(shippedFlags(before));
    const inAfter = gapsByKey(shippedFlags(after));
    for (const [key, row] of gapsByKey(Array.isArray(resolvable) ? resolvable : [])) {
      // Only a gap the before review really carried can be reported either way.
      if (!inBefore.has(key)) continue;
      (inAfter.has(key) ? stillOpen : closed).push(row);
    }
  }

  return {
    correspondenceUnavailable: !correspond,
    closed,
    stillOpen,
    countsBefore: countsOf(before),
    countsAfter: countsOf(after),
    lineCountBefore: lineCountOf(before),
    lineCountAfter: lineCountOf(after),
    genuinelyUnqualifiedStillOpen: Array.isArray(after?.unresolvedQualifications) ? after.unresolvedQualifications : [],
  };
}
