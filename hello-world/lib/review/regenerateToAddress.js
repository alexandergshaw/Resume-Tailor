// N104 - the ONE gated regenerate. Server side, engine-agnostic, no React.
//
//   regenerateToAddress({ engine, args, realMaterial, beforeReview, pinnedAnalysis })
//     -> { regenerated, closure, confirm, genuinelyUnqualified }
//
// WHY THIS IS SAFE. A "fill in the weaknesses" action is a fabrication engine by
// default: the shortest way to satisfy a missing requirement is to invent the
// experience. This is safe because of where the output comes from, not because of
// what the model is asked.
//
//   - It re-enters runIdealPipeline and nothing else, so the document it returns is
//     the pipeline's recomposed KEPT spans: whatever the engine wrote has already
//     been through the truthfulness gate and the chronology check, and a claim the
//     gate refused is absent from the output by construction. The engine's raw
//     draft is never read here.
//   - It never reaches the standard (level 1-5) generation route, which has no gate:
//     that route would replace the gated text with an ungated one.
//   - The resolvable weaknesses go in as EMPHASIS (weaknessSteering, see
//     idealChainPrompts.js), never as facts, and only the resolvable bucket: a
//     finding only the user can verify, or a requirement the user's material does
//     not support, is never steered toward.
//
// WHAT IT REPORTS. The closure report compares the review of the regenerated
// document with the review it started from (compareReviewGaps), both scored against
// the SAME posting analysis: the one the first run produced, passed back in as
// `pinnedAnalysis` so requirement ids cannot drift between the two reviews. The
// confirm findings and the unsupported requirements are reported, and stay open.
//
// `regenerated` is the whole pipeline result (the same shape a first run returns),
// so a caller can replace the on-screen run with it.

import { runIdealPipeline } from "../llm/ideal/idealPipeline.js";
import { classifyWeaknesses } from "./classifyWeaknesses.js";
import { compareReviewGaps } from "./compareReviewGaps.js";
import { missingKeywordTerm, shippedFlags, termKey } from "./gapIdentity.js";

const requirementIdsOf = (analysis) =>
  (Array.isArray(analysis?.requirements) ? analysis.requirements : [])
    .map((requirement) => requirement?.id)
    .filter((id) => typeof id === "string");

// The keyword terms of the resolvable gaps, one entry per distinct term. A wording
// gap with no keyword (a vague or repeated line) has nothing to name, so it adds no
// entry; its movement is reported as a count.
function steeringFor(resolvable) {
  const seen = new Set();
  const entries = [];
  for (const flag of resolvable) {
    const term = missingKeywordTerm(flag);
    if (term === null || seen.has(termKey(term))) continue;
    seen.add(termKey(term));
    entries.push({ category: flag.category, term });
  }
  return { resolvable: entries };
}

export async function regenerateToAddress({ engine, args, realMaterial, beforeReview, pinnedAnalysis } = {}) {
  const { resolvable, confirm } = classifyWeaknesses(beforeReview);

  const regenerated = await runIdealPipeline({
    engine,
    args: { ...args, weaknessSteering: steeringFor(resolvable) },
    realMaterial,
    pinnedAnalysis,
  });

  const ideal = regenerated.ideal;
  const closure = compareReviewGaps({
    before: beforeReview,
    // The review of the lines that ship, in the outcome shape the comparison reads.
    after: {
      flags: shippedFlags(ideal.review),
      unresolvedQualifications: ideal.review.unresolvedQualifications,
      lineCount: ideal.counts.kept,
    },
    resolvable,
    beforeRequirementIds: requirementIdsOf(pinnedAnalysis?.postingAnalysis),
    afterRequirementIds: requirementIdsOf(ideal.postingAnalysis),
  });

  return {
    regenerated,
    closure,
    confirm,
    genuinelyUnqualified: closure.genuinelyUnqualifiedStillOpen,
  };
}
