// N49 S2a: the per-block citation walk, promoted here so a second, unrelated
// caller (lib/tracking/citationLineAgreement.js) can reach it without
// forking a second copy. It was written first, additively, in
// lib/copilot/glossaryCitations.js -- that file's own header explains why
// (a "second caller, not before" promotion rule) -- and moved here verbatim
// once that second caller appeared; glossaryCitations.js now re-exports it,
// so the glossary's own walk and citationLineAgreement.js's walk can never
// drift apart. citationLineAgreement.test.js asserts the two import paths
// resolve to the SAME function object.

/** @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The same walk `extractCitationSources` (lib/llm/interactionCitations.js)
 * performs, but WITHOUT flattening: one entry per `type: "text"` content
 * block, in walk order, each carrying only its OWN block's `url_citation`
 * annotations and the index of the step it came from.
 *
 * Offsets are read snake_case (`start_index` / `end_index`) exactly as the
 * wire sends them, and are carried through VERBATIM. They are documented by
 * the vendor as BYTES, which is why they are named `startByte` / `endByte`
 * and why conversion to UTF-16 indices is each caller's own job, not this
 * one's. Nothing here falls back to `startIndex` / `endIndex`: that is the
 * spelling Google's own JS sample for this surface uses, the wire does not
 * send it, and `"x".slice(undefined, undefined)` returns the WHOLE STRING
 * rather than throwing -- so a camelCase read is silently wrong rather than
 * loud.
 *
 * NEVER THROWS, for any input. Any level of the walk that is missing or
 * malformed contributes nothing and is skipped.
 *
 * @param {unknown} interaction
 * @returns {Array<{ text: string, stepIndex: number,
 *   citations: Array<{ uri: unknown, title: unknown, startByte: unknown, endByte: unknown }> }>}
 */
export function extractCitationSourcesByBlock(interaction) {
  const out = [];
  const steps = interaction && typeof interaction === "object" ? interaction.steps : null;
  if (!Array.isArray(steps)) return out;

  steps.forEach((step, stepIndex) => {
    if (!isPlainObject(step) || step.type !== "model_output") return;
    if (!Array.isArray(step.content)) return;
    for (const block of step.content) {
      if (!isPlainObject(block) || block.type !== "text") continue;
      const citations = [];
      if (Array.isArray(block.annotations)) {
        for (const annotation of block.annotations) {
          if (!isPlainObject(annotation) || annotation.type !== "url_citation") continue;
          citations.push({
            uri: annotation.url,
            title: annotation.title,
            startByte: annotation.start_index,
            endByte: annotation.end_index,
          });
        }
      }
      out.push({
        text: typeof block.text === "string" ? block.text : "",
        stepIndex,
        citations,
      });
    }
  });

  return out;
}
