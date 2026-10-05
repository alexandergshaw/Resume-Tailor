// N104 - the three-way split of a review's findings: what rewording can address,
// what only the user can check, and what the user's material does not support.
// PURE; it reads a ReviewOutcome and returns buckets of the findings it was given.
//
//   classifyWeaknesses(reviewOutcome)
//     -> { resolvable: Flag[], confirm: Flag[], genuinelyUnqualified: Entry[] }
//
//   resolvable            wording gaps (improve tier) whose requirement the user's
//                         material supports. The ONLY bucket a regenerate acts on.
//   confirm               findings only the user can verify (a figure, a seniority
//                         claim, an employer fit), plus any category this build does
//                         not know. Never a target: "fixing" an unverifiable figure
//                         by changing it IS fabrication.
//   genuinelyUnqualified  the review's own unresolvedQualifications, passed through:
//                         requirements nothing the user wrote supports. Always
//                         reported open, never filled.
//
// The bucket of a flag is the tier the SHIPPED presentation gives its category
// (presentFlag), so this cannot drift from the panel that shows the same groups and
// holds no category table of its own. An unknown category is a confirm-tier flag
// there (the cautious default), and so it is here. The three buckets are disjoint:
// a keyword flag whose requirement is itself unqualified is already presented
// through genuinelyUnqualified, so it joins neither flag bucket.
//
// It takes a ReviewOutcome, not an Ideal entry, so any surface that holds a review
// of the document on screen can ask the same question.

import { CATEGORY, ORIGIN } from "./contract.js";
import { DRAFT_KIND, TIER, presentFlag } from "./flagPresentation.js";
import { shippedFlags } from "./gapIdentity.js";

export function classifyWeaknesses(reviewOutcome) {
  const unresolved = Array.isArray(reviewOutcome?.unresolvedQualifications) ? reviewOutcome.unresolvedQualifications : [];
  const unqualifiedIds = new Set(unresolved.map((entry) => entry?.requirementId).filter((id) => typeof id === "string"));

  const resolvable = [];
  const confirm = [];
  for (const flag of shippedFlags(reviewOutcome)) {
    if (presentFlag(DRAFT_KIND.APPLICATION_READY, flag.category).tier !== TIER.IMPROVE) {
      confirm.push(flag);
      continue;
    }
    const ref = flag.evidenceRef;
    const onUnqualifiedRequirement =
      flag.category === CATEGORY.MISSING_KEYWORD &&
      ref?.origin === ORIGIN.POSTING &&
      unqualifiedIds.has(ref.spanId);
    if (!onUnqualifiedRequirement) resolvable.push(flag);
  }
  return { resolvable, confirm, genuinelyUnqualified: unresolved };
}
