// N104 - what makes two review flags "the same gap", shared by the classifier, the
// before/after comparison and the regenerate's steering so none of them re-derives
// it. PURE: no analysis, no span ids minted, nothing read but the flags it is given.
//
// A posting-anchored `missing-keyword` flag names its keyword only inside its
// message. The reviewer writes `The posting asks for "<term>" ("<requirement>")
// but this draft never mentions it.` (mechanicalDetectors.js, detectMissingKeyword),
// one flag PER term, every one carrying the same requirement id. So the gap is
// (category, origin, requirementId, term), and the term is the text between the
// FIRST pair of double quotes. A message that does not have that shape yields no
// term, and a flag with no term is never given a per-gap identity: it is counted by
// category and nothing more, rather than being merged into a neighbour.

import { DRAFT_KIND } from "./flagPresentation.js";

export function missingKeywordTerm(flag) {
  const message = typeof flag?.message === "string" ? flag.message : "";
  const match = /^[^"]*"([^"]*)"/.exec(message);
  const term = match ? match[1].replace(/\s+/g, " ").trim() : "";
  return term === "" ? null : term;
}

// The form a term is compared in: case and spacing never make two gaps differ.
export const termKey = (term) => String(term).replace(/\s+/g, " ").trim().toLowerCase();

// The flags that describe the document that ships. A review run over both drafts
// carries the hypothetical's flags too; they say nothing about the file the user
// sends, so they are never counted, classified or closed.
export function shippedFlags(review) {
  return (Array.isArray(review?.flags) ? review.flags : []).filter(
    (flag) => flag !== null && typeof flag === "object" && flag.draftKind !== DRAFT_KIND.HYPOTHETICAL,
  );
}
