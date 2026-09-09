// WHAT "RESEARCHED" MEANS. This module is the whole feature's load-bearing
// decision, and it is PURE: given one `interaction` object it returns, per
// definition, a provenance and (when earned) a source. No network, no SDK, no
// route knowledge, no database -- so the eight-condition predicate is testable
// against fixtures with no client at all.
//
// ---------------------------------------------------------------------------
// THE DEFINITION
// ---------------------------------------------------------------------------
// A stored definition has `provenance: "researched"` IF AND ONLY IF all eight
// conditions hold. Anything else is `"recalled"`. There is no third value and no
// default: `provenance` is COMPUTED HERE and is never read from the model.
//
//   1. A search actually happened -- a `google_search_call` step is present.
//   2. At least one `url_citation` exists at all.
//   3. The citation's offsets are trustworthy, MEASURED AGAINST ITS OWN BLOCK.
//      `spanFor` refuses -- never rounds, never clamps, never guesses -- a
//      non-integer, negative, inverted, non-boundary, past-the-end,
//      whole-document or unpaired-surrogate offset.
//   4. The citation attributes THIS definition and substantially only this one:
//        4a containment -- the definition lies entirely inside the citation's
//           OWN text block;
//        4b reach       -- overlap >= MIN_CITATION_OVERLAP_CHARS;
//        4c precision   -- overlap / width > CITATION_PRECISION_MIN, STRICTLY,
//           and a span touching more than MAX_CITATION_DEFINITIONS definition
//           ranges is refused for ALL of them.
//   5. The URL survives the href gate (`citationHost` !== null).
//   6. It is not the vendor grounding redirect.
//   7. It is not a third-party intermediary or interstitial.
//   8. The batch's join did not throw (the worker's per-batch try).
//
// Selection where several qualify: highest PRECISION; ties -> largest overlap;
// ties -> earliest startByte. Deterministic, so the same response yields the
// same row on every ingest.
//
// ---------------------------------------------------------------------------
// WHY EACH CONDITION EXISTS -- every one is a constructed attack that landed
// ---------------------------------------------------------------------------
// A rule that tested only "overlap >= 12 characters" was defeated by ONE
// citation spanning [0, byteLen-1) of a twelve-definition response: 12/12 terms
// marked researched, all twelve popovers offering one SEO farm to a candidate
// mid-interview, the row written `status: 'ready'` with `recalled_count: 0`, and
// every constraint satisfied. `SPAN_REFUSAL.WHOLE_DOCUMENT` did not save it --
// that rule is an EXACT equality on `[0, length)` and `citationSpans.js:218-227`
// says so deliberately: "Refused for what the span CLAIMS ... not for its
// width." One byte short is a different claim.
//
// AND THE ADVERSARY IS WEAKER THAN THAT MAKES THEM SOUND. They control neither
// the model's text nor the offsets. They need only be THE ONE PAGE GOOGLE
// GROUNDS A BATCH AGAINST -- which is the ordinary outcome when a model answers
// twelve related questions from one reference page. This fires on honest
// traffic, which is why the bound is structural rather than adversarial.
//
// THE PRECISION RULE IS A THEOREM. Definition ranges are pairwise disjoint.
// Suppose one citation `c` of width W qualified for two definitions d1 and d2.
// Then overlap(c,d1) > W/2 and overlap(c,d2) > W/2, so their sum exceeds W. But
// d1 and d2 are disjoint and both overlaps are subsets of c's span, so the sum
// is at most W. Contradiction. An exhaustive sweep over every span confirms it.
//
// MAX_CITATION_DEFINITIONS closes the residue the theorem does not: one very
// long definition among eleven short ones lets a near-whole-document citation
// exceed 0.5 precision on the long one. Two rather than one, so the ordinary
// one-definition-plus-a-bleed shape still keeps its CORRECT attribution.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE DOES NOT PROVE, AND CANNOT ON THIS SURFACE
// ---------------------------------------------------------------------------
// That the cited page SAYS what the definition says. Condition 4 is the VENDOR'S
// ATTRIBUTION -- Google asserted, by byte offsets, that this span of its own
// answer is supported by that source -- not our verification. It cannot be
// verification here: `GoogleSearchResult` carries only `search_suggestions`,
// with no retrieved snippet in the response to compare against. Any criterion
// phrased as "consistent with the retrieved text" would have to ask the model
// for the evidence, which is a restatement and not a check. Nothing this module
// produces may be described with a word stronger than "source".

import {
  interactionSearched,
  interactionTruncated,
  interactionStageCounts,
} from "@/lib/llm/interactionCitations";
import { byteBoundaryMap, spanFor, spanRefusalReason } from "@/lib/tracking/citationSpans";
import { citationHost, nonPublisherHosts } from "@/lib/tracking/citationHref";
import { extractCitationSourcesByBlock, assembleResearchDocument } from "./glossaryCitations.js";
import {
  RESEARCH_BATCH_SIZE,
  MIN_CITATION_OVERLAP_CHARS,
  CITATION_PRECISION_MIN,
  MAX_CITATION_DEFINITIONS,
  MAX_SOURCE_TITLE_CHARS,
} from "./glossaryConstants.js";

/**
 * One numbered definition line. `\r?$` is not a nicety: `.` excludes `\n` but
 * INCLUDES `\r`, so `/^(\d{1,3})\.\s(.+)$/` stores a trailing carriage return in
 * every definition of a CRLF response, shifting every `defEnd` by one and
 * storing a string the word-count contract was not written for.
 */
export const RESEARCH_LINE_RE = /^(\d{1,3})\.\s(.*\S)\r?$/;

/**
 * Every numbered definition in `text`, with its half-open UTF-16 range.
 *
 * A DUPLICATED INDEX DROPS THE LATER OCCURRENCE, never both: dropping both
 * destroys the unrelated real term whose number was reused -- which happens
 * whenever a wrapped definition's continuation begins "2. ".
 *
 * @param {string} text
 * @param {{ dropIncompleteFinalLine?: boolean }} [options] set when the vendor
 *   reported the interaction truncated: the final element of the split is a
 *   fragment unless the text ends in a newline, and half a definition parsed as
 *   a whole one is worse than no definition.
 */
export function parseResearchLines(text, { dropIncompleteFinalLine = false } = {}) {
  const source = typeof text === "string" ? text : "";
  const lines = source.split("\n");
  const usable =
    dropIncompleteFinalLine && !source.endsWith("\n") && lines.length > 0
      ? lines.slice(0, -1)
      : lines;

  const out = [];
  const seen = new Set();
  let cursor = 0;

  for (const raw of usable) {
    const match = RESEARCH_LINE_RE.exec(raw);
    if (match) {
      const index = Number(match[1]);
      if (!seen.has(index)) {
        seen.add(index);
        // The prefix is exactly `digits` + "." + ONE whitespace character, so
        // this is arithmetic rather than an indexOf that could find an earlier
        // occurrence of the same body text elsewhere on the line.
        const defStart = cursor + match[1].length + 2;
        out.push({ index, defStart, defEnd: defStart + match[2].length, text: match[2] });
      }
    }
    cursor += raw.length + 1;
  }

  return out;
}

// ---------------------------------------------------------------------------
// CONDITION 6 -- the vendor grounding redirect.
//
// REACHED THROUGH THE SHARED MODULE, NOT RESTATED. `citationHref.js:15-19`
// forbids a second copy of a URL allow-list, in its own words because "two
// copies drift, and the one that drifts is the one nobody re-reads". Its
// `servesGroundingRedirect` is module-private, but `nonPublisherHosts` is
// exported and its clause (a) IS that function.
//
// WHY CALLING IT WITH EXACTLY ONE ENTRY IS THE CORRECT REUSE AND NOT A TRICK.
// `nonPublisherHosts` carries a SECOND clause: a host byte-identical across
// EVERY entry, when there is more than one, and absent from every title, is
// also suppressed. On a glossary BATCH -- twelve related terms, very often one
// reference page -- that clause suppresses `en.wikipedia.org` outright, which is
// exactly why this feature must not hand it a whole batch. It is guarded by
// `hosts.length > 1`, so at n = 1 the clause is STRUCTURALLY INERT and the
// function reduces to clause (a) alone. The glossary's own test pins the
// positive half (a lone real publisher is NOT suppressed) so the reduction
// cannot silently stop holding.
//
// The alternative -- exporting the private function from a file this chunk is
// not permitted to edit, or copying its three host constants here -- is the
// duplication that file exists to prevent.
// ---------------------------------------------------------------------------
/**
 * @param {string} host the host `citationHost` derived from `href`
 * @param {unknown} href the citation's own URL
 */
export function servesVendorRedirect(host, href) {
  if (typeof host !== "string" || host === "") return false;
  return nonPublisherHosts([{ href, title: "" }]).has(host);
}

// ---------------------------------------------------------------------------
// CONDITION 7 -- third-party intermediaries.
//
// A DIFFERENT, ORTHOGONAL RULE WITH NO EXISTING COPY ANYWHERE IN THE REPOSITORY,
// stated so it is not later "consolidated" into citationHref.js: that module
// owns the VENDOR REDIRECT list, this owns GLOSSARY POLICY about who may be
// named as a source. Measured: `t.co`, `webcache.googleusercontent.com`,
// `translate.google.com`, `l.facebook.com`, `r.jina.ai` and `www.google.com/url`
// all pass conditions 5 AND 6. A card would have said
// "webcache.googleusercontent.com" to a candidate mid-interview -- the precise
// harm citationHref.js:112-119 says the whole control exists to prevent.
//
// 7a IS THE GENERAL RULE AND 7b IS THE RESIDUE, which is the right way round.
// Deny-lists are incomplete by construction, so the structural test does the
// work and the named set only covers hosts that carry no embedded URL at all.
// ---------------------------------------------------------------------------
const INTERMEDIARY_HOSTS = new Set([
  "t.co",
  "bit.ly",
  "lnkd.in",
  "tinyurl.com",
  "ow.ly",
  "buff.ly",
  "goo.gl",
  "webcache.googleusercontent.com",
  "l.facebook.com",
  "l.instagram.com",
  "out.reddit.com",
]);
const INTERMEDIARY_SUFFIXES = ["jina.ai", "translate.goog"];

/**
 * @param {string} host
 * @param {unknown} href
 */
export function isThirdPartyIntermediary(host, href) {
  if (typeof host !== "string" || host === "") return false;
  if (INTERMEDIARY_HOSTS.has(host)) return true;
  if (INTERMEDIARY_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return true;
  if (host.startsWith("translate.google.")) return true;
  try {
    // 7a, structural: an embedded http(s) URL anywhere after the origin. Catches
    // the whole interstitial class -- google.com/url?q=, r.jina.ai/https://...,
    // translate.google.com/...?u=, l.facebook.com/l.php?u= (percent-encoded) --
    // WITHOUT a list. `slice(1)` skips the leading "/" so a path that merely
    // STARTS at the origin is not mistaken for one.
    const url = new URL(String(href));
    const tail = decodeURIComponent(url.pathname + url.search);
    return /https?:\/\//i.test(tail.slice(1));
  } catch {
    // A malformed href never reaches here -- condition 5 refused it -- and a
    // decodeURIComponent that throws on a malformed escape is not evidence of
    // an intermediary either way.
    return false;
  }
}

const overlapOf = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * The join for ONE research batch.
 *
 * `interaction.output_text` IS NEVER READ, and that is structural rather than
 * stylistic: `interactionOutputText` THROWS when the SDK omitted the key -- which
 * it does whenever the text is empty -- while `interactionSearched` is still
 * true, so a "did it search?" criterion never fires because the code reaches the
 * throw first. Not reading the field removes the throw by construction. See
 * glossaryCitations.js for the two ways that field also mis-maps offsets.
 *
 * @param {unknown} interaction
 * @param {{ batchSize?: number }} [options]
 */
export function joinResearchBatch(interaction, { batchSize = RESEARCH_BATCH_SIZE } = {}) {
  const searched = interactionSearched(interaction);
  const truncated = interactionTruncated(interaction);
  const stage = interactionStageCounts(interaction);
  const blocks = extractCitationSourcesByBlock(interaction);
  const document = assembleResearchDocument(blocks);

  // Truncation salvage is per batch and operates on LINES, which is the other
  // half of why the response format is line-delimited rather than JSON.
  const parsed = parseResearchLines(document.text, { dropIncompleteFinalLine: truncated });
  // The index is validated against the batch WE SENT, never trusted. A line
  // whose index is out of range is dropped and counted.
  const definitions = parsed.filter((d) => d.index >= 1 && d.index <= batchSize);
  const droppedLines = parsed.length - definitions.length;

  const refusalReasons = {};
  let refusalCount = 0;
  let sawLoneSurrogate = false;
  const resolved = [];

  blocks.forEach((block, index) => {
    if (block.citations.length === 0) return;
    const map = byteBoundaryMap(block.text);
    if (map.loneSurrogateAt !== -1) sawLoneSurrogate = true;
    const [lo, hi] = document.ranges[index];
    for (const citation of block.citations) {
      const span = spanFor(block.text, citation, map);
      if (!span) {
        const reason = spanRefusalReason(block.text, citation, map) || "unknown";
        refusalReasons[reason] = (refusalReasons[reason] || 0) + 1;
        refusalCount += 1;
        continue;
      }
      resolved.push({ citation, lo, hi, start: lo + span.start, end: lo + span.end });
    }
  });

  const anyCitation = blocks.some((b) => b.citations.length > 0);
  const results = [];

  for (const definition of definitions) {
    let best = null;

    for (const candidate of resolved) {
      // 4a. A citation may only speak for definitions lying ENTIRELY inside its
      // own text block -- which is what stops an annotation measured over an
      // excluded preamble resolving cleanly onto definition #1.
      if (definition.defStart < candidate.lo || definition.defEnd > candidate.hi) continue;

      const width = candidate.end - candidate.start;
      const touched = definitions.filter(
        (d) =>
          d.defStart >= candidate.lo &&
          d.defEnd <= candidate.hi &&
          overlapOf(candidate.start, candidate.end, d.defStart, d.defEnd) >= 1,
      ).length;
      if (touched > MAX_CITATION_DEFINITIONS) continue;

      const overlap = overlapOf(
        candidate.start,
        candidate.end,
        definition.defStart,
        definition.defEnd,
      );
      if (overlap < MIN_CITATION_OVERLAP_CHARS) continue;

      const precision = width === 0 ? 0 : overlap / width;
      if (!(precision > CITATION_PRECISION_MIN)) continue;

      const host = citationHost(candidate.citation.uri);
      if (host === null) continue;
      if (servesVendorRedirect(host, candidate.citation.uri)) continue;
      if (isThirdPartyIntermediary(host, candidate.citation.uri)) continue;

      // PRECISION FIRST. Selecting on overlap alone makes the widest -- and
      // therefore wrongest -- citation beat a correct narrow one on EVERY term
      // including the one that had a correct citation: it ties on overlap and
      // then wins the earliest-offset tie-break. The rule actively preferred the
      // least specific citation available.
      const contender = { overlap, precision, host, citation: candidate.citation };
      if (
        !best ||
        contender.precision > best.precision ||
        (contender.precision === best.precision && contender.overlap > best.overlap) ||
        (contender.precision === best.precision &&
          contender.overlap === best.overlap &&
          contender.citation.startByte < best.citation.startByte)
      ) {
        best = contender;
      }
    }

    const sourced = searched && anyCitation && best !== null;
    results.push({
      index: definition.index,
      definition: definition.text,
      provenance: sourced ? "researched" : "recalled",
      sourceUrl: sourced ? best.citation.uri : null,
      sourceHost: sourced ? best.host : null,
      sourceTitle: sourced ? truncateTitle(best.citation.title) : null,
      overlap: sourced ? best.overlap : 0,
      precision: sourced ? best.precision : 0,
    });
  }

  const researchedCount = results.filter((r) => r.provenance === "researched").length;

  return {
    searched,
    truncated,
    blockCount: blocks.length,
    textBlocks: stage.textBlocks,
    annotations: stage.annotations,
    stageCounts: stage,
    definitionCount: definitions.length,
    droppedLines,
    researchedCount,
    refusalReasons,
    results,
    // A TOTAL INPUT BECOMING A TOTAL LOSS MUST BE A NAMED, REPORTABLE ANOMALY --
    // never a bare empty, which is indistinguishable from "the model found
    // nothing" and is the exact class of defect this whole design exists to
    // close. Each slug names the level the walk actually reached.
    reason: batchReason({
      textBlocks: stage.textBlocks,
      annotations: stage.annotations,
      definitionCount: definitions.length,
      researchedCount,
      refusalCount,
      sawLoneSurrogate,
      refusalReasons,
    }),
  };
}

function truncateTitle(title) {
  if (typeof title !== "string") return null;
  return title.length > MAX_SOURCE_TITLE_CHARS ? title.slice(0, MAX_SOURCE_TITLE_CHARS) : title;
}

function batchReason({
  textBlocks,
  annotations,
  definitionCount,
  researchedCount,
  refusalCount,
  sawLoneSurrogate,
  refusalReasons,
}) {
  if (textBlocks === 0) return "walk-broke";
  if (annotations === 0) return "no-citations";
  if (definitionCount === 0) return "unparsed-lines";
  if (researchedCount > 0) return null;
  const surrogateRefusals = refusalReasons["unpaired-surrogate"] || 0;
  if (sawLoneSurrogate && refusalCount > 0 && surrogateRefusals === refusalCount) {
    return "surrogate-cliff";
  }
  return "all-citations-refused";
}
