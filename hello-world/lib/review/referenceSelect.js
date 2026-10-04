// The AC-2 authority-reference selection layer, kept as its own pure function so
// it is independently testable even when the plausibility JUDGMENT inside the
// selected reference is later model-augmented.
//
// Two kinds of draft need two different yardsticks for an authority claim:
//   user-material         judged against the candidate's REAL material.
//   internal-consistency  judged against the draft's OWN internal coherence
//                         (and posting plausibility) - never against real
//                         material, or a coherent hypothetical would be flagged
//                         for being more ambitious than the candidate's past.
//
// An unrecognised authorityReference is treated as user-material: with no
// reference the claims fail closed (get flagged), which is the safe direction
// for a value the caller got wrong.

const INTERNAL = "internal-consistency";

export function selectAuthorityReference(draft, realMaterial) {
  if (draft?.authorityReference === INTERNAL) {
    return {
      mode: "internal-coherence",
      referenceSpans: Array.isArray(draft.spans) ? draft.spans : [],
    };
  }
  return {
    mode: "real-material",
    referenceSpans: Array.isArray(realMaterial?.spans) ? realMaterial.spans : [],
  };
}
