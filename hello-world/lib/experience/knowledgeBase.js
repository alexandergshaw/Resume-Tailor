// The knowledge base — the user's own "Professional Experience" project
// pages, plus their attachments — as ranked, budgeted context for a model
// that is about to answer an interview question. See knowledgeBase.test.js
// for the full contract this file exists to satisfy; its comments explain
// WHY each rule is here, most of them because meeting copilot
// (lib/meeting/meetingContext.js) already paid for the same bug once.
//
// WHY THIS LIVES IN lib/experience/ AND NOT lib/copilot/: this directory is
// already the home for "a page, or several pages, offered as context to a
// model at some budget" — pageContext.js (one page -> chat), tailorContext.js
// (pages -> résumé tailoring) and this file (pages -> ranked model context
// for an interview answer) are the same shape at three different budgets.
// Both lib/copilot/** and lib/meeting/** already import from
// lib/experience/**, so putting the shared retrieval layer here grows
// neither domain's dependency on the other.
//
// Pure: no fetch, no Supabase, no React, no DOM. Every exported function
// treats its input as possibly missing, malformed, or hostile, and never
// throws — callers include a live interview draft loop that cannot afford a
// thrown error to become a broken answer.
//
// The inward imports (significantTerms/overlapScore, and rankPagesByBm25,
// below) reach into lib/copilot/projectStories.js and this file's own sibling
// lib/experience/pageRanking.js respectively. projectStories.js used to have
// ZERO imports of its own, which is the safety argument this comment used to
// make; it no longer does — hardening its honesty gate needed the repo's
// shared stopword list — so the argument is now the narrower one stated in
// that file's own header: it imports the smallest thing that does the job
// (one 1.4KB JSON array) and nothing else, because whatever it imports lands
// here, in lib/meeting/**, and in the browser bundle. pageRanking.js pulls in
// that same 1.4KB stopword JSON and lands here and in lib/meeting/** the same
// way — but NOT in the browser bundle: verified, this file's only
// non-test importers are app/api/copilot/answer/route.js and
// lib/meeting/meetingContext.js, and that file's only non-test importers are
// lib/meeting/insightsLocal.js and app/api/meeting/insights/route.js — all
// server-side. That "smallest import, nothing else" constraint is
// load-bearing for FOUR consumers now, not one.

import { formatAttachment } from "./pageContext.js";
import { significantTerms, overlapScore } from "@/lib/copilot/projectStories.js";
import { rankPagesByBm25 } from "./pageRanking.js";

// The marker placed on its own line between two kept runs of a page's
// content that are not adjacent in the source — the honest way of saying
// "material was skipped here" without claiming the excerpt is continuous
// when it isn't.
export const ELISION_MARKER = "[…]";

// Appended to a page's heading only when that page's own body had to be cut
// down to fit — never on a whole page (AC-2.3). Plain English rather than a
// symbol: this text is read by a MODEL, not a developer, and the entire
// point is that it be told plainly that the page continues beyond what it
// was shown (AC-2.2), not left to infer that from a marker's shape.
export const EXCERPT_HEADING_SUFFIX =
  " — excerpted; this page continues beyond what is shown here.";

// Joins two whole-or-excerpted page entries inside the block.
//
// THE BUG THIS PREVENTS: this used to be "\n\n---\n\n", matching
// lib/meeting/meetingContext.js's and lib/experience/tailorContext.js's own
// SEPARATOR verbatim. A page body is markdown, a body line of "---" is an
// ordinary thematic break, and block text reaches the prompt BYTE-EXACT (that
// guarantee is absolute — see splitBlocks' header), so such a line was
// indistinguishable from the page boundary itself. The model then reads one
// page as two and attributes the second half to no page id at all — which
// mattered little when nothing cited ids and matters a great deal now that
// every heading carries one and the prompt demands the model cite it back.
// No markdown construct renders a box-drawing rule, and no editor emits one,
// so this cannot be produced by a body the way "---" can. The divergence from
// the other modules' SEPARATOR is therefore deliberate: they do not put a
// citable id on each page, so they do not have this failure mode.
export const SEPARATOR = "\n\n──── PAGE BOUNDARY ────\n\n";

// How many of ONE page's attachments get a line before the rest are counted
// into the "not listed" notice instead. Mirrors
// lib/meeting/meetingContext.js's own constant of the same name and value —
// see MAX_ATTACHMENT_CHARS_PER_PAGE below for why a count cap alone is not
// enough here.
export const MAX_LISTED_ATTACHMENTS = 20;

// formatAttachment clips each notes/transcript field at 600 characters
// (lib/experience/pageContext.js's own MAX_FIELD_CHARS), so 20 listed
// attachments can reach roughly 12000 characters on a single page — this
// module's entire budget — spent on a file list alone, starving every page
// body including its own. This caps one page's attachment section by total
// characters as well as by count; whichever limit binds first stops the
// list, and everything past it is counted into the "not listed" notice
// (AC-7.8).
export const MAX_ATTACHMENT_CHARS_PER_PAGE = 1500;

// Below this many characters of budget remaining, a page is not even
// attempted — not because nothing could theoretically fit (a very short
// page might), but because the packing loop must eventually stop chasing
// smaller and smaller fragments of a relevance-ranked list. Bypassed for the
// very first candidate page only: without the bypass, a real but small
// budget (remaining already under MIN_PAGE_CHARS before anything has even
// been tried) would abandon packing before a page that could actually fit
// was ever attempted — a real budget indistinguishable, from outside, from a
// packer that simply gave up. This is a different bypass from
// EXCERPT_SHARE_DIVISOR below, which is lifted for the LAST candidate rather
// than the first, and for a different reason — see that constant's own
// comment for why the two must not be confused for one rule.
export const MIN_PAGE_CHARS = 200;

// A page that cannot fit whole is excerpted at up to budget/EXCERPT_SHARE_
// DIVISOR characters of body, so that one very relevant, very long page
// cannot alone consume the entire remaining budget and starve every page
// ranked after it.
//
// TWO RULES, NOT ONE, and they must not be read as one:
//  - WHO it applies to: every candidate that still has another candidate
//    behind it in the ranking. The last candidate gets `remaining` instead,
//    because there is no page two left to starve — see the packing loop's own
//    comment on the 3973-of-12000 defect that capping anyway produced.
//  - MIN_PAGE_CHARS's separate "don't even attempt a fragment this small"
//    floor is skipped for the very FIRST candidate. That is a different
//    bypass, at the other end of the list, for a different reason.
export const EXCERPT_SHARE_DIVISOR = 3;

// Reserved out of the caller's budget for the "[Note: ...]" sentence(s),
// before page packing ever starts, and assembled last once we know how many
// notices are actually needed — the same pattern lib/experience/pageContext.js,
// lib/copilot/projectStories.js and lib/meeting/meetingContext.js each
// already use (ARCH §7.4). Without a reserve, the notices — the honesty
// apparatus telling the model what it was NOT shown — are exactly what a
// defensive final clamp would eat first, because they are assembled last.
const NOTICE_RESERVE_CHARS = 400;

function str(value) {
  return typeof value === "string" ? value : "";
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// rankPagesByRelevance(pages, queryText) -> Page[]
//
// Delegates to pageRanking.js's rankPagesByBm25 — Okapi BM25 over exactly
// the pages passed in, with a stopword-filtered, unstemmed, 2-character-
// floor query tokenizer (see that file for the scoring rule itself and why
// it lives in its own module rather than here or in
// lib/copilot/projectStories.js). This function used to be a plain
// set-overlap count ("how many of significantTerms(queryText)'s terms
// appear anywhere in the page"), which could not tell a page that mentions a
// query term once from a page the term is the whole point of, and had no way
// to weight a rare, specific term over a common one repeated on every page
// in the knowledge base — see rankingQuality.test.js for the fixtures that
// rule got wrong and pageRanking.js for the replacement's arithmetic.
// Deliberately does NOT filter for eligibility — that decision belongs to
// each caller's own rule (AC-7.3/A4), never to this module.
//
// Semantics are byte-identical to lib/meeting/meetingContext.js's own
// rankMeetingPages, which delegates to this function directly (ARCH §4c) —
// one ranking rule, so the two surfaces can never disagree about what
// "relevant" means.
//
// AC-1.4's byte-identity guarantee still holds, for a different reason than
// it used to: with no query, rankingQueryTerms(queryText) is an empty set,
// so pageRanking.js's `weights` map stays empty and every page scores
// literal 0 before any BM25 arithmetic runs — the stable sort then falls
// through to `position` ascending, leaving the input order untouched for
// every existing caller that never asked a question.
export function rankPagesByRelevance(pagesInput, queryText) {
  return rankPagesByBm25(pagesInput, queryText);
}

// --- splitBlocks ------------------------------------------------------
//
// Restates four line-shape regexes rather than importing
// lib/experience/markdown.js's parser (ARCH §1.5 / §4a). parseMarkdown's
// tokens carry NO SOURCE OFFSETS — they are {type, level?, children|items}
// trees meant for rendering, not slices of the original text — so an
// excerpt rebuilt from them would be a RE-RENDERING: `**`, link hrefs and
// list markers dropped, putting words in the prompt the user never wrote,
// in a feature whose entire premise is that this is the user's own text.
// It would also silently break the embedded engine's own bullet mining
// (lib/copilot/projectStories.js's BULLET_LINE_RE), which matches a raw
// markdown bullet line and would stop matching a re-rendered one.
//
// What bounds the duplication: this function SEGMENTS, never INTERPRETS —
// no tokens, no HTML, no URL resolution — so it inherits none of
// markdown.js's sanitisation duties (its whole reason for being a hand-
// rolled parser in the first place). A block's `text` is always an exact,
// contiguous substring of `body`; this file only ever decides where one
// substring ends and the next begins.
// The leading ` {0,3}` is not decoration: lib/experience/markdown.js's own
// HEADING_RE is /^ {0,3}(#{1,3}) +(.*)$/, so a heading indented by one to
// three spaces IS a heading everywhere the user's page is rendered. Anchored
// at column 0, this file read the same line as a paragraph, so every block
// under it got headingIndex -1 and heading-context restoration silently did
// nothing on that page — the excerpt then started nowhere, which is the one
// thing headingIndex exists to prevent.
const HEADING_LINE_RE = /^ {0,3}#{1,3}\s+\S/;
const LIST_ITEM_START_RE = /^(?:[-*]|\d+\.)\s+\S/;
const FENCE_OPEN_RE = /^\s{0,3}```/;
const FENCE_CLOSE_RE = /^\s{0,3}```\s*$/;

function scanLines(body) {
  const lines = [];
  let i = 0;
  const n = body.length;
  while (i <= n) {
    let nl = body.indexOf("\n", i);
    if (nl === -1) nl = n;
    lines.push({ raw: body.slice(i, nl), start: i, end: nl });
    if (nl === n) break;
    i = nl + 1;
  }
  return lines;
}

function isBlank(line) {
  return line.raw.trim() === "";
}

function isIndentedContinuation(line) {
  return !isBlank(line) && /^[ \t]/.test(line.raw) && !HEADING_LINE_RE.test(line.raw) && !FENCE_OPEN_RE.test(line.raw);
}

// splitBlocks(body) -> Block[], Block = { text, kind, headingIndex }.
//
// kind: "heading" | "listItem" | "paragraph" | "code". A fenced block is
// atomic (blank lines inside it are part of the block, never a split point)
// — a fence split on an internal blank line would let either half be
// selected alone, putting an unterminated fence in the prompt. An ATX
// heading line (#-###) is always its own block. A top-level list item
// (`-`, `*`, or `N.`) plus its indented continuation lines is one block. Any
// other run of consecutive non-blank lines is one paragraph.
//
// headingIndex is the index of the nearest PRECEDING heading block, for a
// non-heading block, and -1 for a heading block itself and for any block
// with no heading above it (ARCH §7.1) — a heading does not sit under
// itself, and it does not sit under the heading before it either, or
// restoring context for one selected block would drag in every earlier
// heading on the page.
export function splitBlocks(bodyInput) {
  const body = str(bodyInput);
  if (!body) return [];
  const lines = scanLines(body);
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    if (FENCE_OPEN_RE.test(line.raw)) {
      let j = i + 1;
      while (j < lines.length && !FENCE_CLOSE_RE.test(lines[j].raw)) j += 1;
      const end = j < lines.length ? j : lines.length - 1;
      blocks.push({ text: body.slice(line.start, lines[end].end).trimEnd(), kind: "code" });
      i = end + 1;
      continue;
    }

    if (HEADING_LINE_RE.test(line.raw)) {
      blocks.push({ text: line.raw.trimEnd(), kind: "heading" });
      i += 1;
      continue;
    }

    if (LIST_ITEM_START_RE.test(line.raw)) {
      let end = i;
      let j = i + 1;
      while (j < lines.length && isIndentedContinuation(lines[j])) {
        end = j;
        j += 1;
      }
      blocks.push({ text: body.slice(line.start, lines[end].end).trimEnd(), kind: "listItem" });
      i = end + 1;
      continue;
    }

    // Paragraph: a maximal run of consecutive non-blank lines that isn't a
    // heading, list item, or fence start.
    let end = i;
    let j = i + 1;
    while (
      j < lines.length &&
      !isBlank(lines[j]) &&
      !HEADING_LINE_RE.test(lines[j].raw) &&
      !LIST_ITEM_START_RE.test(lines[j].raw) &&
      !FENCE_OPEN_RE.test(lines[j].raw)
    ) {
      end = j;
      j += 1;
    }
    blocks.push({ text: body.slice(line.start, lines[end].end).trimEnd(), kind: "paragraph" });
    i = end + 1;
  }

  let lastHeadingIndex = -1;
  return blocks.map((block, index) => {
    if (block.kind === "heading") {
      lastHeadingIndex = index;
      return { ...block, headingIndex: -1 };
    }
    return { ...block, headingIndex: lastHeadingIndex };
  });
}

// Assembles a chosen set of block indices into final excerpt text: blocks in
// document order, joined by "\n\n"; a heading restored immediately before
// the first run that needs it and was not itself selected (counts as part
// of that run — no marker between a restored heading and its own block,
// ARCH §7.6); ELISION_MARKER on its own line between two runs that are not
// adjacent in the source, and nowhere else.
function assembleExcerpt(blocks, indices) {
  const selected = [...indices].sort((a, b) => a - b);
  if (selected.length === 0) return "";

  // Restored headings join the set of EMITTED indices BEFORE runs are
  // computed, and that ordering is the whole fix here.
  //
  // THE BUG THIS PREVENTS (false elision): runs used to be computed from the
  // selected indices alone, so selected = {5, 7} — where block 7's own
  // heading is block 6 — split into two runs and emitted
  // `block5 […] heading6 block7`. Nothing was skipped between 5 and 7: the
  // restored heading IS block 6. The marker claimed material had been dropped
  // when the excerpt was in fact continuous, which is the same category of
  // lie as failing to mark a real gap. A restored heading is part of the run
  // that follows it (ARC §7.6), so folding it in first makes 5,6,7 the one
  // contiguous run it really is.
  const emitted = new Set(selected);
  for (const idx of selected) {
    const block = blocks[idx];
    if (block.kind !== "heading" && block.headingIndex >= 0) emitted.add(block.headingIndex);
  }
  const ordered = [...emitted].sort((a, b) => a - b);

  const pieces = [];
  for (let k = 0; k < ordered.length; k += 1) {
    if (k > 0 && ordered[k] !== ordered[k - 1] + 1) pieces.push(ELISION_MARKER);
    pieces.push(blocks[ordered[k]].text);
  }
  return pieces.join("\n\n");
}

// excerptForQuery(body, { queryTerms, budget }) -> { text, excerpted }.
//
// `queryTerms` is a Set from significantTerms, computed ONCE by the caller
// (never re-derived per page/per call here) — the same relevance rule as
// page ranking, one level down, so this module has exactly one definition
// of "relevant" (ARCH §3.1.3).
//
// 1. The whole trimmed body, byte-identical, when it already fits.
// 2. Otherwise, blocks are ranked by overlapScore (score desc, index asc —
//    the tie-break is what keeps the degenerate all-zero-score case in
//    document order, protecting AC-1.4 one level down) and selected
//    greedily: each candidate block is tried IN FULL against the budget —
//    simulating the whole final assembly (heading restoration and elision
//    markers included), not merely the block's own length — before being
//    committed, so `text.length <= budget` holds by construction rather
//    than needing a clamp that could cut mid-line. A candidate that does not
//    fit is skipped, not stopped on (ARCH §4b): unlike page-level packing,
//    this list is already labelled an excerpt and its gaps are already
//    marked, so taking a smaller lower-ranked block after skipping an
//    oversized higher-ranked one misleads no one and recovers real
//    material.
//
// Never cuts inside a line, therefore never inside a sentence: every piece
// assembled into the result is a whole splitBlocks() block, which is itself
// always a contiguous run of whole source lines.
export function excerptForQuery(bodyInput, { queryTerms, budget } = {}) {
  const body = str(bodyInput);
  const trimmed = body.trim();
  const cap = typeof budget === "number" && budget >= 0 ? budget : 0;
  if (trimmed.length <= cap) return { text: trimmed, excerpted: false };

  const blocks = splitBlocks(body);
  if (blocks.length === 0) return { text: "", excerpted: false };

  const terms = queryTerms instanceof Set ? queryTerms : new Set();
  const ranked = blocks
    .map((block, index) => ({ index, score: overlapScore(terms, block.text) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = new Set();
  for (const candidate of ranked) {
    if (selected.has(candidate.index)) continue;
    const block = blocks[candidate.index];
    // A block longer than the entire cap can never fit — every assembly
    // containing it is at least as long as it is — so building and
    // discarding a whole excerpt for it is pure waste, on exactly the long
    // pages this function exists to serve. Pure short-circuit: the assembly
    // below would have rejected it anyway.
    if (block.text.length > cap) continue;
    const tentative = new Set(selected);
    tentative.add(candidate.index);
    if (block.kind !== "heading" && block.headingIndex >= 0) tentative.add(block.headingIndex);

    const assembled = assembleExcerpt(blocks, tentative);
    if (assembled.length <= cap) {
      for (const idx of tentative) selected.add(idx);
    }
    // Skip and continue past a block that does not fit — see this
    // function's own doc comment on why block-level packing must not stop
    // the way page-level packing does.
  }

  return {
    text: assembleExcerpt(blocks, selected),
    excerpted: selected.size < blocks.length,
  };
}

// stripLinePrefixes(text) -> string.
//
// THE BUG THIS PREVENTS (ARCH §1.1): the live transcript handed to the
// answer route is a LABELLED conversation — "Them: ...", "You: ...", or a
// user-entered display name, one prefix per line. significantTerms
// tokenises /[a-z0-9]{4,}/, so "them" clears that bar, appears once per
// interviewer turn, becomes the single most frequent token in the whole
// ranking query, and scores every page containing the word "them" above
// zero — surfacing a page whose only real overlap with the conversation is
// a label this app itself wrote. Exactly the bug
// lib/meeting/meetingContext.js's stripSpeakerLabels exists to prevent, one
// domain over — but that function is anchored on MEETING_LABELS, a closed
// set that contains neither "Them" nor an arbitrary display name, so it
// cannot be reused here; this is the label-agnostic generalisation of it.
//
// A leading "<prefix>: " is dropped from a line only when ALL hold (ARCH
// §7.7, each clause with its own test — a first draft covered only the
// word-count clause and three mutants of the others survived):
//  - the colon is followed by at least one space (so "Them:tell",
//    "ratio:14" and "Node:js" are left as content, not stripped);
//  - the prefix is at most 5 words;
//  - the prefix is at most 40 characters;
//  - the prefix contains none of . ! ? — a sentence that merely ENDS in a
//    colon ("Yes. Well: we sharded by tenant") is not a speaker label.
// Blank lines are removed from the result (they are harmless to scoring,
// but the stripped text is also handed to callers who may log or splice it,
// and a run of empty lines in the middle reads as missing transcript).
export function stripLinePrefixes(textInput) {
  const lines = str(textInput).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    let result = line;
    const idx = line.indexOf(": ");
    if (idx !== -1) {
      const prefix = line.slice(0, idx);
      const rest = line.slice(idx + 2);
      const wordCount = prefix.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > 0 && wordCount <= 5 && prefix.length <= 40 && !/[.!?]/.test(prefix)) {
        result = rest;
      }
    }
    if (result.trim() !== "") out.push(result);
  }
  return out.join("\n");
}

// noAttachmentBytesNotice(surfaceLabel) -> string.
//
// noAttachmentBytesNotice("this meeting") reproduces
// lib/meeting/meetingContext.js:58-59's NO_ATTACHMENT_BYTES_NOTICE constant
// BYTE FOR BYTE — asserted directly in this file's test — so that module can
// adopt this helper later with zero test churn. Do not change that
// constant; this string is required to keep matching it, not the other way
// around.
//
// KNOWN GAP, recorded rather than fixed: the sentence says "the file names and
// any saved notes above were seen", but formatAttachment
// (lib/experience/pageContext.js) also emits a `transcript` field. Nothing in
// this repo writes that column today, so the sentence is vacuously true right
// now — and it is BYTE-LOCKED to lib/meeting/meetingContext.js's
// NO_ATTACHMENT_BYTES_NOTICE by a test in this module, so it cannot be widened
// here unilaterally. The day anything starts writing `transcript`, this
// sentence becomes false on THREE surfaces at once and must be widened on all
// three at once — it is a claim about what the model was shown, which is the
// one kind of claim this module exists to keep honest. The three:
//   1. this function,
//   2. lib/meeting/meetingContext.js's NO_ATTACHMENT_BYTES_NOTICE, and
//   3. lib/copilot/practiceNotices.js's KNOWLEDGE_BASE_CLAUSE, which makes
//      the same "file names and any saved notes" claim to the USER rather
//      than to the model, and is rendered by practice mode, live mode
//      (lib/copilot/groundingNotice.js) and the room-question clause
//      (app/copilot/practice/practiceRoomQuestionPrivacy.js) from that one
//      constant.
export function noAttachmentBytesNotice(surfaceLabel) {
  return `No attachment file contents were read for ${surfaceLabel} — only the file names and any saved notes above were seen.`;
}

function hasUsableId(page) {
  return !!page && typeof page === "object" && typeof page.id === "string" && page.id.trim() !== "";
}

// A page must bring real material — its own prose, or at least one surviving
// attachment line — before it can be included at all.
//
// THE GUARD THE PORT LOST, restored. The block builder this module replaced
// (lib/copilot/projectStories.js's buildProjectStoriesBlock) filtered on
// `p.title || p.body`; nothing here replaced it. So an EMPTY page stub — which
// every real user has, because creating a page in the tree and filling it in
// later is the normal way to use it — passed eligibility, produced a heading
// with no body, and, being tiny, always fit. The prompt then carried
//
//   ## Draft page I never wrote (page id: empty2)
//
// a real title and a real CITABLE id with nothing behind it, in a prompt that
// asks the model to cite page ids back. resolvePageSources validates that id
// happily — it is genuinely in `includedPages` — so the candidate is shown
// "From your Draft page I never wrote page." under a point the model invented.
// That is the same failure as the loop's own no-body break below, arriving
// through a different door.
//
// It also breaks AC-3.4's byte identity in a common state: a stub gives `block`
// a non-empty value, which flips BOTH prompt builders into their pages variant
// — reordered blocks, a changed authority sentence, `pageIds` demanded — on
// behalf of pages that say nothing at all.
//
// Enforced here rather than in the packing loop so an empty stub is never
// counted into "N pages not included to fit the budget": the budget is not why
// it was left out.
//
// A BARE FILENAME IS NOT MATERIAL, and this is the door the guard above was
// left open on. `formatAttachment` returns a line for an attachment that has
// nothing but a name, and the WHOLE-PAGE path has no prose check of its own —
// only the excerpt path does (hasProseContent). So a page with an empty body
// and one named attachment shipped
//
//   ## Payments platform (page id: p1)
//
//   Attachments:
//   - architecture.pdf (PDF)
//
// into a prompt that demands page-id citations. The model invents a point,
// the id validates against includedPages because the page really was
// included, and the candidate reads "From your Payments platform page." under
// a claim nothing on that page supports. Exactly the defect the empty-stub
// rule above closes, arriving through a different door.
//
// So an attachment only counts when it carries something to READ — saved
// notes or a cached transcript. Those are the only fields whose contents ever
// reach the model (the bytes never do, which is what noAttachmentBytesNotice
// says in words), so they are the only fields that can make a page worth
// citing.
//
// A HEADINGS-ONLY BODY IS NOT MATERIAL EITHER, and that is the third door.
// `hasProseContent` below was applied only on the EXCERPT path, so a page
// whose entire body is
//
//   ## Overview
//
// passed this check on `str(page.body).trim()` alone, was short enough to
// always fit WHOLE (never reaching the excerpt path where the prose check
// lives), and shipped a real title and a real citable page id with nothing
// readable behind it. That is precisely the defect hasProseContent's own
// comment describes, reached through the one door left open — so the same
// rule is applied here, at the precondition, where it belongs.
function contributesMaterial(page) {
  if (hasProseContent(str(page?.body).trim())) return true;
  const attachments = Array.isArray(page?.attachments) ? page.attachments : [];
  return attachments.some(
    (attachment) =>
      !!formatAttachment(attachment) &&
      (!!str(attachment?.notes).trim() || !!str(attachment?.transcript).trim()),
  );
}

// Whether an assembled excerpt carries any of the user's own prose, as
// opposed to nothing but the page's own `##` section headings and the
// markers between them.
//
// THE BUG THIS PREVENTS: block packing is skip-and-continue (see
// excerptForQuery), so on a page whose every CONTENT block is larger than
// that page's share, the only blocks that fit are its headings — and a table
// of contents was accepted as an excerpt. Reproduced at the real production
// budget of 12000: a 26863-character page yielded 186 characters that were
// nothing but headings and `[…]` markers, carrying a citable page id and a
// suffix promising the page continues. A heading-only excerpt is a heading
// with nothing under it by another name, so the packer treats it exactly the
// same way (see the loop's own break).
function hasProseContent(text) {
  return str(text)
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      return trimmed !== "" && trimmed !== ELISION_MARKER && !HEADING_LINE_RE.test(line);
    });
}

function isEligibleSafe(isEligible, page) {
  try {
    return !!isEligible(page);
  } catch {
    // buildKnowledgeBaseBlock must never throw (this file's header
    // comment). A caller-supplied `isEligible` throwing on one malformed
    // row is treated the same as that row failing eligibility — skipped,
    // not fatal to the whole block.
    return false;
  }
}

// Caps one page's attachment inventory by BOTH count (MAX_LISTED_ATTACHMENTS)
// and total characters (MAX_ATTACHMENT_CHARS_PER_PAGE), whichever binds
// first — see that constant's own comment for why a count cap alone is not
// enough (ARC §7.8).
function capAttachmentLines(lines) {
  const shown = [];
  let used = 0;
  for (const line of lines) {
    if (shown.length >= MAX_LISTED_ATTACHMENTS) break;
    const addLen = line.length + (shown.length > 0 ? 1 : 0);
    if (used + addLen > MAX_ATTACHMENT_CHARS_PER_PAGE) break;
    shown.push(line);
    used += addLen;
  }
  return { shown, notListedCount: lines.length - shown.length };
}

// buildKnowledgeBaseBlock({ pages, query, isEligible, budget, budgetLabel,
// attachmentNotice }) -> { block, includedPages, includedPageIds,
// droppedPageCount, truncated }.
//
// `isEligible` is REQUIRED, with no default (ARC §3.1.6) — this is what
// preserves AC-7.3/A4 STRUCTURALLY: the interview copilot passes
// isEligiblePage (generated + archived excluded), the meeting copilot would
// pass isEligibleMeetingPage (archived only). This module never decides
// eligibility itself, so the two rules cannot be harmonised by accident.
//
// A page also needs a non-empty string `id` (mirrors
// lib/meeting/meetingContext.js's isUsablePage) — a precondition enforced
// HERE, not by `isEligible`, because the prompt asks the model to cite a
// page id back, and an uncitable page in a prompt demanding citations is a
// page the model will attribute to something else.
//
// Packing is rank order, whole page if it fits, else excerpted; STOPS (does
// not skip) once a page can't fit at all, because — unlike excerptForQuery's
// block-level packing — this list IS the relevance ranking itself: skipping
// a page that doesn't fit to try a smaller, less relevant one later would
// silently promote it, and neither the model nor the user could tell it
// happened (ARC §4b, matching lib/meeting/meetingContext.js's own STOP
// rule). A page that cannot contribute any body — no whole page, no excerpt
// that fits — is simply not included; see the loop's own comment below on
// why a heading with nothing under it is never emitted as a substitute
// (block === "" iff includedPages.length === 0, always).
//
// A page must also bring real material — its own prose, or at least one
// surviving attachment line — to be a candidate at all (contributesMaterial),
// which is a precondition, not a budget decision: an empty stub is not "a page
// that didn't fit".
//
// Two bypasses, at opposite ends of the ranked list, for different reasons —
// do not let them read as one rule with two names:
//  - MIN_PAGE_CHARS's "don't even attempt a fragment this small" floor is
//    skipped for the very FIRST candidate only (see MIN_PAGE_CHARS's own
//    comment): that floor exists to stop the packer chasing ever-smaller
//    fragments of a long ranked list, which has nothing to protect when
//    nothing has been included yet.
//  - EXCERPT_SHARE_DIVISOR caps how much of the budget any ONE page's excerpt
//    may spend, and is lifted for the LAST candidate only, because by then
//    there is no page two left for it to starve.
export function buildKnowledgeBaseBlock(input) {
  const src = input && typeof input === "object" ? input : {};
  const pagesInput = Array.isArray(src.pages) ? src.pages : [];
  const budget = typeof src.budget === "number" && src.budget >= 0 ? src.budget : 0;
  const budgetLabel = str(src.budgetLabel);
  const attachmentNotice = str(src.attachmentNotice);
  const isEligible = typeof src.isEligible === "function" ? src.isEligible : () => false;

  const usable = pagesInput
    .filter((page) => isEligibleSafe(isEligible, page))
    .filter(hasUsableId)
    .filter(contributesMaterial);

  // The query is now tokenised TWICE, not once, and that comment used to say
  // otherwise — it stopped being true the moment page ranking moved onto its
  // own tokenizer. `rankPagesByRelevance` runs pageRanking.js's
  // rankingQueryTerms (stopword-filtered, 2-character floor, no stemmer) to
  // rank pages; `queryTerms` below is the shared significantTerms (4-character
  // floor, no stopword filter) that excerptForQuery needs to rank BLOCKS
  // inside a page's excerpt further down. The two tokenizers are
  // deliberately different — see pageRanking.js's header for why the ranking
  // tokenizer cannot be significantTerms — so unifying them onto one call
  // would either regress page ranking back to the four-character floor or
  // change block-level excerpting, which knowledgeBase.test.js pins. The
  // honest cost of leaving excerptForQuery alone is one extra regex pass over
  // a single question string per call — cheap, and correct beats "once".
  const queryTerms = significantTerms(src.query);
  const ranked = rankPagesByRelevance(usable, src.query);

  const budgetForPages = Math.max(0, budget - NOTICE_RESERVE_CHARS);

  const included = [];
  let used = 0;

  for (let pageIndex = 0; pageIndex < ranked.length; pageIndex += 1) {
    const page = ranked[pageIndex];
    const remaining = budgetForPages - used;
    // Bypassed for the very first candidate — see this function's own doc
    // comment above.
    if (included.length > 0 && remaining < MIN_PAGE_CHARS) break;

    const title = str(page.title).trim() || "Untitled project";
    const id = str(page.id).trim();
    const headingBase = `## ${title} (page id: ${id})`;

    const rawAttachments = Array.isArray(page.attachments) ? page.attachments : [];
    const allAttachmentLines = rawAttachments.map(formatAttachment).filter(Boolean);
    const { shown: attachmentLines, notListedCount } = capAttachmentLines(allAttachmentLines);
    const attachmentPart = attachmentLines.length > 0 ? `Attachments:\n${attachmentLines.join("\n")}` : "";

    const bodyFull = str(page.body).trim();
    const sepCost = included.length > 0 ? SEPARATOR.length : 0;

    const wholeParts = [headingBase];
    if (attachmentPart) wholeParts.push(attachmentPart);
    if (bodyFull) wholeParts.push(bodyFull);
    const wholeText = wholeParts.join("\n\n");
    const wholeCandidateLen = wholeText.length + sepCost;

    if (wholeCandidateLen <= remaining) {
      included.push({ id, title, text: wholeText, excerpted: false, hasAttachments: attachmentLines.length > 0, notListedCount });
      used += wholeCandidateLen;
      continue;
    }

    // Doesn't fit whole — try an excerpt. The per-page share is a budget
    // for the BODY ALONE (ARC §7.3): the heading (with its excerpt suffix),
    // the attachment lines and the join to the body must all be subtracted
    // first, or a literal min(remaining, budget/DIVISOR) hands
    // excerptForQuery a number bigger than the space actually left once
    // this page's own overhead is paid for — and only the defensive final
    // clamp would save it, which then cuts mid-line.
    //
    // The divisor applies only while there is still another candidate that
    // could use the budget. It exists so a long, highly-ranked page one cannot
    // starve pages two and three (see EXCERPT_SHARE_DIVISOR's own comment);
    // with no page two there is nothing to protect, and rationing anyway
    // handed a single relevant page 3973 of 12000 characters — LESS than the
    // 6000-char cap this whole change exists to raise, in exactly the
    // one-relevant-page case the feature is about.
    const moreCandidatesFollow = pageIndex < ranked.length - 1;
    const perPageShare = moreCandidatesFollow
      ? Math.min(remaining, Math.floor(budget / EXCERPT_SHARE_DIVISOR))
      : remaining;
    const overheadParts = [`${headingBase}${EXCERPT_HEADING_SUFFIX}`];
    if (attachmentPart) overheadParts.push(attachmentPart);
    const overheadText = overheadParts.join("\n\n");
    const bodyBudget = perPageShare - overheadText.length - sepCost - "\n\n".length;

    const excerpt = bodyBudget > 0 ? excerptForQuery(bodyFull, { queryTerms, budget: bodyBudget }) : { text: "", excerpted: true };

    // `hasProseContent` is the second half of the test: an excerpt made of
    // nothing but this page's own section headings is not material, however
    // long it is — see that helper for the 186-character table of contents
    // this rejects.
    if (excerpt.text && hasProseContent(excerpt.text)) {
      const excerptedParts = [excerpt.excerpted ? `${headingBase}${EXCERPT_HEADING_SUFFIX}` : headingBase];
      if (attachmentPart) excerptedParts.push(attachmentPart);
      excerptedParts.push(excerpt.text);
      const excerptedText = excerptedParts.join("\n\n");
      const excerptedCandidateLen = excerptedText.length + sepCost;

      if (excerptedCandidateLen <= remaining) {
        included.push({
          id,
          title,
          text: excerptedText,
          excerpted: excerpt.excerpted,
          hasAttachments: attachmentLines.length > 0,
          notListedCount,
        });
        used += excerptedCandidateLen;
        continue;
      }
    }

    // This page yields nothing (no body budget at all, an empty excerpt, an
    // excerpt that was nothing but the page's own section headings, or one
    // that still didn't fit `remaining`). A heading with no body
    // under it is not an honest report of a real budget — it would hand the
    // model a real page TITLE, a real citable page id, and a suffix saying
    // the page continues, with no content at all backing any of it. That is
    // an invitation to invent a project and attribute the invention to a
    // page the candidate really has, which they would then read aloud in an
    // interview (the same reason formatAttachment, lib/experience/
    // pageContext.js:116-130, says in words that a video was not watched
    // rather than leaving a bare filename). So this page is simply not
    // included, and packing stops here, same as the STOP rule above.
    //
    // EXCEPT when the page never had a body to begin with — a page kept by
    // contributesMaterial for its attachment NOTES. `excerptForQuery("")`
    // returns "" for it however much budget is left, so no excerpt can ever
    // rescue it and the unconditional break dropped every lower-ranked page
    // behind it.
    //
    // WHAT THE CONDITION ACTUALLY TESTS, stated plainly because the comment
    // here used to claim more than the code checks. It said such a page
    // "arrives here with certainty rather than because anything was too big to
    // fit". That is not true and cannot be: a body-less page is included whole
    // at the top of this loop whenever `wholeCandidateLen <= remaining`, so
    // reaching this line at all means its heading plus attachment lines did
    // NOT fit the remaining budget. It is a size failure, like every other
    // page that gets here. The only thing `!bodyFull` establishes is that
    // there is no body to excerpt.
    //
    // So this IS a deliberate exception to the STOP rule, not a case the rule
    // was never about, and the cost is real: a lower-ranked page WITH a body
    // can be admitted after this one is skipped. It is accepted because what
    // did not fit here is bounded by MAX_ATTACHMENT_CHARS_PER_PAGE (1500) and
    // is computed independently of every other page's size, so this page's
    // exclusion says nothing about how much BODY the remaining budget can
    // hold — which is the comparison ARCH §4b's STOP rule exists to protect.
    // Breaking instead would sacrifice every page behind it to a page that
    // could contribute no prose whatsoever.
    if (!bodyFull) continue;
    break;
  }

  const droppedPageCount = ranked.length - included.length;

  if (included.length === 0) {
    return { block: "", includedPages: [], includedPageIds: [], droppedPageCount, truncated: droppedPageCount > 0 };
  }

  const body = included.map((p) => p.text).join(SEPARATOR);
  const attachmentNotListedTotal = included.reduce((sum, p) => sum + p.notListedCount, 0);
  const anyAttachmentShown = included.some((p) => p.hasAttachments);

  const notices = [];
  // FIRST, deliberately. The defensive clamp below cuts from the END, so
  // whatever is assembled last is what it eats first. This sentence — "no
  // attachment file contents were read" — is the one that makes the
  // attachment lines above it honest, and it used to be assembled THIRD: a
  // clamp would have removed the disclaimer while leaving every file name it
  // guards standing, which reads to the model as "these files were opened".
  // A dropped-page or not-listed COUNT lost to the same clamp costs the model
  // a number; this one costs it the truth.
  if (anyAttachmentShown) notices.push(attachmentNotice);
  if (droppedPageCount > 0) {
    notices.push(`${pluralize(droppedPageCount, "page", "pages")} not included to fit the ${budgetLabel}.`);
  }
  if (attachmentNotListedTotal > 0) {
    // "not listed" rather than "not included" so it can never be confused
    // with the dropped-PAGE sentence above (ARC §7.2, matching
    // lib/meeting/meetingContext.js's own reasoning).
    notices.push(`${pluralize(attachmentNotListedTotal, "attachment", "attachments")} not listed to fit the ${budgetLabel}.`);
  }

  const noticeBlock = notices.length > 0 ? `[Note: ${notices.join(" ")}]` : "";
  let block = [body, noticeBlock].filter(Boolean).join("\n\n");

  // Defensive final clamp, mirroring every precedent module's own (ARC
  // §7.10): the budgeting above is designed so this is never reached — page
  // blocks always precede notices in `block`, so a cut here can only ever
  // remove notice text, never a page already promised to be whole or
  // honestly labelled an excerpt.
  if (block.length > budget) block = block.slice(0, budget);

  return {
    block,
    includedPages: included.map((p) => ({ id: p.id, title: p.title, excerpted: p.excerpted })),
    includedPageIds: included.map((p) => p.id),
    droppedPageCount,
    truncated: droppedPageCount > 0 || included.some((p) => p.excerpted),
  };
}
