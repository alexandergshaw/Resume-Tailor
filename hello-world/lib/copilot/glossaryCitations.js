// The per-text-block citation walk, and the document the definitions are parsed
// from.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AND WHY IT IS NOT `extractCitationSources`
// ---------------------------------------------------------------------------
// `lib/llm/interactionCitations.js` offers two things a join could be built on,
// and BOTH are wrong for this one:
//
//   1. `extractCitationSources(interaction)` walks every step FORWARDS and
//      FLATTENS every block's annotations into one list with NO per-block base
//      offset. The block a citation came from is lost.
//   2. `interaction.output_text` is the only text it offers, and that field is
//      NOT the string those offsets were measured against. The SDK builds it
//      (`addOutputProperties`, @google/genai dist/node/index.cjs:19018-19074) as
//      a BACKWARDS, BARRIER-TERMINATED scan:
//
//        outer: for (let i = steps.length - 1; i >= 0; i--) {
//          if (step.type === 'user_input') break;
//          if (step.type !== 'model_output' || !step.content) {
//            if (collecting) break outer;              // <-- THE BARRIER
//            continue;
//          }
//          for (let j = content.length - 1; j >= 0; j--) { ... }
//        }
//        const output_text = textParts.reverse().join('');
//
//      Three consequences, all load-bearing here:
//        (a) In `model_output -> google_search_call -> model_output` -- THE
//            CANONICAL GROUNDED FLOW -- the barrier fires on the search step and
//            THE FIRST TEXT BLOCK IS EXCLUDED. Its annotations are still
//            returned by the flattening walk, so a citation measured over an
//            excluded preamble resolves CLEANLY onto definition #1.
//        (b) When it spans several blocks it is their CONCATENATION, while each
//            block's annotation offsets are relative to its OWN text. Two blocks
//            in one step mis-map every annotation on the second by len(block1).
//        (c) The key is OMITTED ENTIRELY when the text is empty, because the SDK
//            writes `Object.assign(..., output_text && { output_text }, ...)`
//            and "" is falsy.
//
// In cases (a) and (b) NOTHING IS MALFORMED. The offsets are integers,
// non-negative, ordered and land on character boundaries, so `spanFor` returns a
// span, `spanRefusalReason` is null, and `interactionStageCounts` reports a
// healthy `{steps:4, modelOutputSteps:2, textBlocks:2, annotations:1}`. They are
// simply offsets into a DIFFERENT STRING. No refusal rule and no stage count can
// see it, which is why the fix has to be structural rather than another check.
//
// This module is ADDITIVE and local to the glossary. It does not modify
// `interactionCitations.js`, whose eight importers all read that module's `[]`
// as "the model did not search" and whose stability rule is stated in its own
// header.
//
// N49 S2a: `extractCitationSourcesByBlock` was written here first,
// additively, and this file's own header said "a second copy is not" the
// right move once a second caller appeared. One has:
// lib/tracking/citationLineAgreement.js. So the walk itself now lives in
// lib/llm/interactionBlocks.js and this module re-exports it -- a RELATIVE
// path is deliberately not used (only the build catches a wrong depth; the
// `@/` alias sidesteps that hazard entirely). `assembleResearchDocument`
// below is glossary-specific (it assembles the document definitions are
// parsed from, which is a glossary concern, not a general citation one) and
// stays here.
export { extractCitationSourcesByBlock } from "@/lib/llm/interactionBlocks";

/**
 * The document the definitions are parsed from, assembled by US with a stated
 * rule, plus the half-open UTF-16 range each block occupies inside it.
 *
 *   WITHIN one model_output step:  join with ""    (the SDK's own rule, :19048)
 *   BETWEEN steps:                 join with "\n"
 *
 * BOTH DIRECTIONS OF ERROR DEGRADE TO `recalled`, NEVER TO A WRONG ATTRIBUTION,
 * and that is what makes the rule safe to state without wire evidence:
 *
 *   - An UNWANTED "\n" splits one definition into two fragments that match no
 *     index and are dropped; that term keeps its harvest definition.
 *   - A MISSING "\n" glues two definitions into one over-long line, which the
 *     80-word cap rejects; both terms fall back and stay `recalled`.
 *
 * Definitions are parsed ONCE over this whole document, never per block. Parsing
 * per block silently LOSES any definition that straddles a block boundary -- the
 * measured symptom is 11 definitions reported where 12 were sent. The block
 * ranges exist ONLY for the containment half of the attribution test.
 *
 * @param {ReturnType<typeof extractCitationSourcesByBlock>} blocks
 * @returns {{ text: string, ranges: Array<[number, number]> }}
 */
export function assembleResearchDocument(blocks) {
  const parts = [];
  const ranges = [];
  let base = 0;

  blocks.forEach((block, index) => {
    if (index > 0 && block.stepIndex !== blocks[index - 1].stepIndex) {
      parts.push("\n");
      base += 1;
    }
    ranges.push([base, base + block.text.length]);
    parts.push(block.text);
    base += block.text.length;
  });

  return { text: parts.join(""), ranges };
}
