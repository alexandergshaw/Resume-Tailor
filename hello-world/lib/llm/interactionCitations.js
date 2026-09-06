// ---------------------------------------------------------------------------
// The Interactions-surface citation extractor (`client.interactions.create`).
//
// `lib/llm/grounding.js` reads the LEGACY `models.generateContent` shape:
// `response.candidates[0].groundingMetadata.groundingChunks[].web.{uri,title}`.
// That surface's `web.uri` is a `vertexaisearch.cloud.google.com` redirect
// proxy, never the publisher's own URL (scratchpad/3b-gemini-grounding-facts.md
// Q1) — which is why every company-research citation was silently demoted to
// plain text and `sources` was persisted `[]` on every digest, forever.
//
// The Interactions API is a DIFFERENT API, not a response variant of the
// first one: a different endpoint, a different request shape (`tools` is
// TOP-LEVEL, not nested in `config`), and a completely different response
// shape carrying REAL publisher URLs:
//
//   interaction.steps[]
//     -> { type: "model_output", content: [
//          { type: "text", text, annotations: [
//              { type: "url_citation", url, title, start_index, end_index },
//              ... other annotation types this module ignores ...
//          ] },
//          ...
//        ] }
//     -> { type: "google_search_call", ... }   (proof a search happened)
//     -> { type: "google_search_result", ... } (search suggestions widget)
//
// Verified against the installed `@google/genai` 2.6.0 `.d.ts`
// (`Interaction`, `ModelOutputStep`, `TextContent`, `URLCitation`,
// `GoogleSearchCallStep`) and Google's own worked example at
// https://ai.google.dev/gemini-api/docs/google-search (see
// scratchpad/3b-grounding-surfaces.md Q1/Q2). No live call was available to
// make (no GEMINI_API_KEY in this checkout) — every fixture in this file's
// test is built from that documented shape, not observed on the wire.
//
// TWO TRAPS THIS MODULE EXISTS TO AVOID, both measured, neither hypothetical:
//
//   1. THE WIRE IS SNAKE_CASE. `URLCitation.start_index` / `end_index` is
//      what the SDK actually carries. Google's own JS sample for THIS surface
//      reads `annotation.startIndex` (camelCase) — silently wrong, because
//      `"x".slice(undefined, undefined)` returns the WHOLE STRING instead of
//      throwing. Neither Google sample is ported here; the field names below
//      are read directly off the annotation object, snake_case, and nothing
//      falls back to a camelCase spelling.
//   2. THE WALK IS FIVE LEVELS OF OPTIONAL. steps -> model_output -> content
//      -> text -> annotations. A walk that silently returns `[]` on ANY miss
//      is indistinguishable from "the model found nothing" — the exact shape
//      of the defect this whole feature migration exists to fix, one API
//      surface later (this repo's own `extractGroundingSources` failed the
//      same way at three levels). `interactionStageCounts` exists so a miss
//      is visible AT THE LEVEL IT HAPPENED, and a genuinely empty result
//      (the walk reached `annotations` and found none) is never laundered
//      into looking the same as a walk that broke two levels higher.
//
// This module makes NO judgement about whether an empty or reduced result is
// acceptable — that decision (an anomaly vs. an honest empty) belongs to
// `lib/tracking/digestCitations.js` and the route, which have the `searched`
// flag and the full observability record to reason with. This module's only
// job is to report faithfully.
//
// `extractGroundingSources` in `lib/llm/grounding.js` is UNCHANGED and MUST
// NOT be modified: it has eight production importers, seven of which are not
// this chunk, and every one of them reads its `[]` as "the model did not
// search". This is an ADDITIVE, separate extractor for the one call site
// migrating to the new surface.
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Every `type: "model_output"` step, in wire order. `[]`, never throws, for
// anything that is not shaped like an Interaction — the "is this even an
// Interaction" question is `interactionOutputText`'s job (it throws), not
// this function's.
function modelOutputStepsOf(interaction) {
  if (!Array.isArray(interaction?.steps)) return [];
  return interaction.steps.filter((step) => isPlainObject(step) && step.type === "model_output");
}

// Every `type: "text"` content block within one model_output step's
// `content[]`, in order. A non-array `content` (missing entirely, or a
// malformed shape) yields `[]` — this is the level-3 break `interactionStageCounts`
// must be able to tell apart from a text block that genuinely carries no
// annotations (a level-5 "empty").
function textBlocksOf(step) {
  if (!Array.isArray(step?.content)) return [];
  return step.content.filter((block) => isPlainObject(block) && block.type === "text");
}

/**
 * The model's response text, read from `interaction.output_text` (the field
 * the real SDK synthesises from the last `model_output` step — 1b N3), never
 * from `response.text` (a `generateContent` habit that silently yields ""
 * on an Interaction, since `Interaction` has no `.text`).
 *
 * THROWS a TypeError when `!Array.isArray(interaction?.steps)` — this is not
 * an Interaction at all (for example, a `generateContent`-shaped body reached
 * this path because the migration was reverted underneath a caller).
 *
 * Also THROWS a TypeError when `interaction.output_text` is not a non-empty
 * string. This is deliberate, not an oversight: the real SDK's own
 * `addOutputProperties` OMITS the `output_text` key entirely whenever the
 * text is empty (`Object.assign(..., output_text && { output_text }, ...)`,
 * and "" is falsy), so `output_text === undefined` on its own cannot tell
 * "not an Interaction" apart from "a real Interaction that said nothing".
 * Checking `Array.isArray(interaction?.steps)` FIRST is what makes the
 * second throw meaningful: by the time it fires, the input is already known
 * to be a real Interaction, just one with nothing to show. Never returns "".
 *
 * A caller that needs to distinguish these two throw cases without a second
 * round trip through this function can check `Array.isArray(interaction?.steps)`
 * itself before calling, exactly as this function does, or read
 * `interactionStageCounts(interaction).textBlocks` to see whether any text
 * was produced at all.
 */
export function interactionOutputText(interaction) {
  if (!Array.isArray(interaction?.steps)) {
    throw new TypeError("interactionOutputText: not an Interaction (steps is not an array)");
  }
  const text = interaction.output_text;
  if (typeof text !== "string" || text === "") {
    throw new TypeError("interactionOutputText: Interaction produced no output text");
  }
  return text;
}

/**
 * The citations Google actually returned, walking
 * `steps[] -> model_output -> content[] -> text -> annotations[] -> url_citation`.
 * Returns the SAME `{ uri, title }` shape `extractGroundingSources` returns
 * (so `groundedHostnames` / `isGroundedHost` / `isGroundedUrl` /
 * `pageIdentityKey` in `lib/llm/grounding.js` accept this list unmodified),
 * plus `startByte` / `endByte` — named for their UNIT, since `URLCitation`
 * documents both as "measured in bytes", not UTF-16 code units. This module
 * does NOT convert them; it only carries the vendor's own numbers through
 * verbatim, snake_case field names read exactly as the wire sends them
 * (`start_index` / `end_index` — never `startIndex` / `endIndex`, which is
 * what Google's own newer-surface sample uses and which the wire does not
 * send). Conversion to UTF-16 offsets is `lib/tracking/citationSpans.js`'s
 * job, one wave over.
 *
 * Never throws. Any level of the walk that is missing or malformed — not an
 * Interaction, no model_output step, non-array content, a non-"text" block,
 * a missing or non-array `annotations` — contributes nothing and is skipped,
 * exactly like `extractGroundingSources` skips a chunk with no `web.uri`.
 * Annotation types other than `url_citation` (`file_citation`,
 * `place_citation`) are skipped; only `url_citation` names a source with a
 * URL.
 */
export function extractCitationSources(interaction) {
  const out = [];
  for (const step of modelOutputStepsOf(interaction)) {
    for (const block of textBlocksOf(step)) {
      if (!Array.isArray(block.annotations)) continue;
      for (const annotation of block.annotations) {
        if (!isPlainObject(annotation) || annotation.type !== "url_citation") continue;
        out.push({
          uri: annotation.url,
          title: annotation.title,
          startByte: annotation.start_index,
          endByte: annotation.end_index,
        });
      }
    }
  }
  return out;
}

/**
 * Whether a `google_search_call` step is present — proof the model actually
 * searched, independent of whether that search produced any citations
 * (AC-F13 (b) "no search step at all" vs (c) "searched, found nothing to
 * cite" are different, differently-worded disclosures downstream). `false`
 * for anything not shaped like an Interaction, never throws.
 */
export function interactionSearched(interaction) {
  if (!Array.isArray(interaction?.steps)) return false;
  return interaction.steps.some((step) => isPlainObject(step) && step.type === "google_search_call");
}

/**
 * Whether the interaction ended in a state other than fully completed —
 * `interaction.status` is a string and it is not `"completed"`. A missing or
 * non-string status is treated as "not asserted truncated" (`false`) rather
 * than guessed at either way; this only ever reports what the vendor stated.
 */
export function interactionTruncated(interaction) {
  const status = interaction?.status;
  return typeof status === "string" && status !== "completed";
}

/**
 * The input/output counts for every level of the walk `extractCitationSources`
 * performs, so that walk's five optional levels never collapse a genuine
 * structural miss and a genuine "found nothing" into the same indistinguishable
 * `[]` — the exact shape of the defect this whole migration exists to fix, one
 * surface later (`extractGroundingSources` failed the same way at three
 * levels, silently, and every one of its eight callers still reads `[]` as
 * "did not search").
 *
 *   steps            — `interaction.steps.length`, or 0 if not an array.
 *   modelOutputSteps — steps with `type === "model_output"`.
 *   textBlocks       — `type === "text"` content blocks found across those
 *                       steps' `content[]` arrays. This is the level that
 *                       distinguishes "the walk broke before annotations"
 *                       (textBlocks: 0, because no text block was ever
 *                       reachable — a model_output step existed but its
 *                       `content` was missing or malformed) from "the walk
 *                       reached annotations and there were none" (textBlocks
 *                       is non-zero; annotations is 0). Both cases yield
 *                       `annotations: 0`; only `textBlocks` tells them apart.
 *   annotations      — every annotation object found on those text blocks,
 *                       of ANY type (`url_citation`, `file_citation`,
 *                       `place_citation`), counted BEFORE
 *                       `extractCitationSources` filters to `url_citation`
 *                       only. This is the raw "received from the vendor"
 *                       number the citation_outcome record's
 *                       `counts.annotations` is built from — it is always
 *                       >= `extractCitationSources(interaction).length`.
 *
 * Never throws, for any input.
 */
export function interactionStageCounts(interaction) {
  const steps = Array.isArray(interaction?.steps) ? interaction.steps.length : 0;
  const modelOutput = modelOutputStepsOf(interaction);
  let textBlocks = 0;
  let annotations = 0;
  for (const step of modelOutput) {
    for (const block of textBlocksOf(step)) {
      textBlocks += 1;
      if (Array.isArray(block.annotations)) {
        annotations += block.annotations.filter((annotation) => isPlainObject(annotation)).length;
      }
    }
  }
  return { steps, modelOutputSteps: modelOutput.length, textBlocks, annotations };
}
