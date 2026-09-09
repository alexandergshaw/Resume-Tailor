// WHICH PART of the candidate's own page a drafted point came from — the
// derivation behind "From your Management Experience page, under Automating
// compatibility checks." and behind the reveal that shows the words the claim
// rests on.
//
// THE FACT THIS MODULE EXISTS BECAUSE OF: a section is not stored anywhere.
// Every citation in this tree is `{ id, title }` and nothing else, on every
// path, in both caches — pageCitations.js's resolvePageSources builds a new
// two-key object and drops the rest deliberately; knowledgeBase.js's
// includedPages whitelist has the page `text` in hand and discards it;
// answerPoints.js's resolvePageSource validates those two keys and passes the
// entry through; answerLocal.js's embedded citation is `{ pageId, title }`;
// selectBestStory is page-level; the model channel asks for ids only. The
// section STRUCTURE exists and is thrown away: splitBlocks computes a
// `headingIndex` per block precisely so an excerpt can have its heading
// restored, then returns a joined string.
//
// SO THE SECTION IS RE-DERIVED, AND ONLY WHERE IT CAN BE SHOWN. The governing
// rule, and the direct answer to the false-employer bug this repo has already
// paid for once:
//
//   Every claim the citation line makes is backed by material the reveal
//   shows. If we cannot show the evidence, we do not make the claim.
//
// Two tiers, therefore, and no third:
//
//   LOCATED  the point shares a contiguous run of at least
//            GROUNDED_SPAN_MIN_WORDS normalised tokens with exactly ONE block
//            of the cited page's body, winning strictly over every block
//            outside its own section. The heading that block already sits
//            under is the section, and the block itself is the quote the
//            reveal shows.
//   PAGE     nothing located, or two sections tie. No section, no quote — but
//            the page's own OUTLINE (the headings splitBlocks found) is a fact
//            about the candidate's own page that needs no matching and no
//            guessing, so it is offered instead.
//
// AND WHERE THERE IS NEITHER, THE ENTRY IS RETURNED UNCHANGED. A page with no
// headings that nothing matched has nothing to reveal, and a control that
// opens on an empty panel is worse than no control at all. That is also what
// keeps the citation line — and the wire shape — byte-identical to what they
// were before this feature existed.
//
// KNOWN LIMITATION, stated here rather than hidden: that a located block is
// genuinely where the point CAME FROM is an inference, not a fact. A run of
// four consecutive tokens is strong evidence of provenance, not proof. It is
// mitigated three ways: the token floor, the cross-section uniqueness rule
// below, and — the real safety — the reveal shows the matched text, so a wrong
// section is falsifiable by the candidate in one glance. That is the
// structural difference from the false-employer bug, where nothing on screen
// let anyone check.
//
// SERVER-ONLY. It imports splitBlocks from lib/experience/knowledgeBase.js,
// which pulls in pageContext.js, projectStories.js, pageRanking.js and a
// stopword JSON. That weight is acceptable only because every importer of that
// module is server-side, and this module's only importer under app/ is
// app/api/copilot/answer/route.js. A sweep in citationDetail.test.js enforces
// it; that file's own header names this module in its importer list.
//
// MODULE-CYCLE DISCIPLINE, inherited. pointLength.js -> answerLocal.js ->
// materialQuote.js -> pointLength.js is a live ES module cycle. This module
// imports into it, so every constant below is a LITERAL and every reference to
// an imported binding is inside a function body. A top-level read throws a TDZ
// ReferenceError depending on which module the cycle is entered through.

import { splitBlocks } from "@/lib/experience/knowledgeBase.js";

import { normalizeForComparison, stripStarLabel } from "./answerPoints.js";
import { materialQuote } from "./materialQuote.js";
import { GROUNDED_SPAN_MIN_WORDS, pointWordCount } from "./pointLength.js";

// Six words, not the four the request names as a target. A hard four would
// silently discard legitimate five-word headings, and the only alternative to
// discarding is an ellipsis — which expansionContract.js has already ruled out
// in this repo: an em dash and an ellipsis are both SILENT at default
// screen-reader punctuation settings, so a caption whose meaning turns on one
// is not read out at all. A heading over either cap is therefore DROPPED, not
// trimmed. Typical headings land at two to five words, which is the requested
// outcome without a single truncated character.
export const MAX_SECTION_WORDS = 6;
export const MAX_SECTION_CHARS = 60;

// The reveal shows the matched block whole up to this, then says so in plain
// English. Bounds the payload: see citationDetail.test.js's arithmetic.
export const MAX_QUOTE_CHARS = 600;

export const MAX_OUTLINE_HEADINGS = 8;
export const MAX_HEADING_CHARS = 60;

/**
 * A markdown ATX heading line with its `#` markers removed.
 *
 * The shape restated here is knowledgeBase.js's HEADING_LINE_RE
 * (`/^ {0,3}#{1,3}\s+\S/`), whose leading ` {0,3}` is load-bearing — that
 * file's own comment records the defect where anchoring at column 0 silently
 * disabled heading restoration on an indented heading. The leading trim below
 * covers those up to three spaces. The two are pinned to agree by a fixture
 * test rather than by a shared export, because they have different jobs: one
 * DETECTS, one STRIPS.
 *
 * Returns the trimmed line unchanged when it is not a heading, so
 * `headingText(line) !== line.trim()` is exactly "this line is a heading".
 */
export function headingText(line) {
  const raw = typeof line === "string" ? line : "";
  return raw.trim().replace(/^#{1,3}\s+/, "").trim();
}

// The page's own headings, in DOCUMENT order — explicitly not a relevance
// ranking, so no section is implied to be the source of anything. An
// over-long heading is dropped rather than trimmed, for the same reason a
// section is.
function pageOutline(blocks) {
  const headings = [];
  for (const block of blocks) {
    if (block.kind !== "heading") continue;
    const text = headingText(block.text);
    if (!text || text.length > MAX_HEADING_CHARS) continue;
    headings.push(text);
  }
  return {
    outline: headings.slice(0, MAX_OUTLINE_HEADINGS),
    outlineMore: Math.max(0, headings.length - MAX_OUTLINE_HEADINGS),
  };
}

// The heading above a located block, or null. Refused when it is empty, when
// it carries no alphanumeric character at all, when it exceeds either cap, or
// when it merely repeats the page title — otherwise the line reads "From your
// Management Experience page, under Management experience." The title
// comparison goes through answerPoints.js's normalizeForComparison, this
// repo's one rule for "the same sentence modulo case and a trailing stop".
function sectionAbove(blocks, index, title) {
  const block = blocks[index];
  if (!block || block.headingIndex < 0) return null;
  const heading = blocks[block.headingIndex];
  if (!heading) return null;
  const text = headingText(heading.text);
  if (!text) return null;
  if (!/[a-z0-9]/i.test(text)) return null;
  if (text.length > MAX_SECTION_CHARS) return null;
  if (pointWordCount(text) > MAX_SECTION_WORDS) return null;
  if (normalizeForComparison(text) === normalizeForComparison(title)) return null;
  return text;
}

// Cut on a whole-line boundary where one exists, so the reveal never shows
// half a sentence. A single line longer than the cap falls back to a word
// boundary. No marker of any kind is appended: the panel says "This section
// continues beyond what is shown here." in words, because a symbol would be
// silent to a screen reader.
function clampQuote(text) {
  const raw = typeof text === "string" ? text : "";
  if (raw.length <= MAX_QUOTE_CHARS) return { text: raw, truncated: false };
  const kept = [];
  let used = 0;
  for (const line of raw.split("\n")) {
    const next = used + (kept.length > 0 ? 1 : 0) + line.length;
    if (next > MAX_QUOTE_CHARS) break;
    kept.push(line);
    used = next;
  }
  if (kept.length > 0) return { text: kept.join("\n"), truncated: true };
  const cut = raw.slice(0, MAX_QUOTE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return { text: (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd(), truncated: true };
}

function detailFor(citation, point, blocks) {
  const { outline, outlineMore } = pageOutline(blocks);

  // HEADINGS ARE OUT OF THE CANDIDATE SET. A heading is a label, not evidence
  // of where a body claim came from, and a heading block's own headingIndex is
  // -1, so a match there could never name a section anyway. Blanking them
  // (rather than filtering) keeps materialQuote's indices aligned with
  // splitBlocks' — materialQuote skips a blank entry.
  const texts = blocks.map((block) => (block.kind === "heading" ? "" : block.text));
  const text = stripStarLabel(typeof point === "string" ? point : "");
  const best = materialQuote(text, texts);

  // materialQuote already applies GROUNDED_SPAN_MIN_WORDS internally; this
  // states the contract where it can be read, and survives that floor moving.
  let located = best.lineIndex >= 0 && best.words >= GROUNDED_SPAN_MIN_WORDS;

  if (located) {
    // THE UNIQUENESS PASS. A generic phrase ("worked with the team on") can
    // reach four tokens against two different blocks; naming the section of
    // whichever one happened to come first is a guess dressed as a fact. A tie
    // INSIDE one section is harmless — the section is the same either way — so
    // only a cross-section tie refuses.
    const rest = texts.slice();
    rest[best.lineIndex] = "";
    const second = materialQuote(text, rest);
    if (
      second.lineIndex >= 0 &&
      second.words >= best.words &&
      blocks[second.lineIndex].headingIndex !== blocks[best.lineIndex].headingIndex
    ) {
      located = false;
    }
  }

  if (!located && outline.length === 0) return citation;

  const quote = located ? clampQuote(blocks[best.lineIndex].text) : null;
  return {
    ...citation,
    located,
    section: located ? sectionAbove(blocks, best.lineIndex, citation.title) : null,
    quote: quote ? quote.text : null,
    quoteTruncated: quote ? quote.truncated : false,
    outline,
    outlineMore,
  };
}

/**
 * One citation, enriched against the page it names and the point it sits
 * beside. Returns the citation UNCHANGED when there is nothing to reveal.
 *
 * Total by construction: never throws, never mutates its input.
 */
export function citationDetail(citation, options) {
  if (!citation || typeof citation !== "object") return citation;
  const opts = options && typeof options === "object" ? options : {};
  const page = opts.page && typeof opts.page === "object" ? opts.page : null;
  if (!page) return citation;
  const blocks = Array.isArray(opts.blocks)
    ? opts.blocks
    : splitBlocks(typeof page.body === "string" ? page.body : "");
  if (blocks.length === 0) return citation;
  return detailFor(citation, opts.point, blocks);
}

/**
 * attachCitationDetail(pageSources, { points, pages }) -> pageSources
 *
 * Maps over the already-resolved citations POSITIONALLY against `points` —
 * the same pairing answerLines and resolvePageSources already use, and
 * deliberately not a second parallel array, because a citation against the
 * wrong beat "attributes a claim to a project that did not produce it, and the
 * candidate says so out loud" (answerPoints.js). Riding the existing entry is
 * also what makes both answer caches carry this for free and what keeps every
 * rendering surface un-rethreaded: answerPoints.js's shape check validates
 * `id`/`title` and returns the whole object.
 *
 * `splitBlocks` is memoised per page id inside the one call (a drafted answer
 * cites at most five points and usually one page). Returns NEW entries; never
 * mutates the array it was given or anything in it.
 *
 * Total by construction: never throws, whatever it is handed.
 */
export function attachCitationDetail(pageSources, options) {
  if (!Array.isArray(pageSources) || pageSources.length === 0) return pageSources;
  const opts = options && typeof options === "object" ? options : {};
  const points = Array.isArray(opts.points) ? opts.points : [];
  const pages = Array.isArray(opts.pages) ? opts.pages : [];

  const byId = new Map();
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    if (typeof page.id !== "string" || page.id.trim() === "") continue;
    if (!byId.has(page.id)) byId.set(page.id, page);
  }
  if (byId.size === 0) return pageSources;

  const blocksById = new Map();
  return pageSources.map((entry, index) => {
    if (!entry || typeof entry !== "object") return entry;
    const page = byId.get(entry.id);
    if (!page) return entry;
    if (!blocksById.has(entry.id)) {
      blocksById.set(entry.id, splitBlocks(typeof page.body === "string" ? page.body : ""));
    }
    const blocks = blocksById.get(entry.id);
    if (blocks.length === 0) return entry;
    return detailFor(entry, points[index], blocks);
  });
}
