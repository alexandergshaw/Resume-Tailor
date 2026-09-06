// The residue scanner (SEC-F4 / AC-F9 item 2 / AC-F11 / AC-F12 / AC-F18 /
// AC-F32): the check that decides which model-written, citation-shaped text
// must never survive into stored markdown, and removes it.
//
// WHY THIS IS NOT A SECOND RECOGNISER FOR "WHAT IS A LINK".
//
// The obvious implementation is a regex, and this repo has already shipped
// one: LINK_RE, in applicationDigest.js and researchReport.js. MEASURED
// (1g-security-footnotes.md S-4.3, scratchpad/1gfn/p4-scanner-divergence.mjs):
// that regex disagrees with the renderer (parseMarkdown, lib/experience/
// markdown.js) on 6 of 9 inputs, and a single unbalanced "(" in a url —
// `[report](https://x/y?a=(1)` — makes the regex see NOTHING to remove while
// the renderer emits a live, clickable anchor. Silent in both directions: no
// throw, no log, a residue count of zero beside an anchor pointing at a url
// the model invented.
//
// So the DECISION of "does any link survive" is never this module's own
// opinion. `scanModelAuthoredLinks` below mirrors the renderer's own grammar
// (parseInline's single `[` handler, lib/experience/markdown.js:183-230:
// first "]", require an immediate "(", first ")", no balancing, an escaping
// backslash, and "!" before "[" forms an image rather than a link) so its
// candidates agree with what `parseMarkdown` will actually do — but the
// TERMINAL proof, `storedMarkdownHasNoLinks`, asks `parseMarkdown` itself.
// That is the total, un-fool-able check SEC-F4 requires: it cannot be
// defeated by a syntax nobody enumerated, because it asks the renderer.
//
// THE OTHER THREE RECOGNISERS ARE DELIBERATELY NAIVE, AND THAT IS SAFE HERE.
// `bareUrl`, `unmatchedMarker` and `referenceDefinition` do not decide
// whether anything is a *link* — parseMarkdown alone decides that, via the
// terminal proof. They decide whether raw, model-authored TEXT (an exposed
// url, a dangling "[1]", a hand-written source line) must not survive as
// prose either (AC-F11), which is a citation-shaped-artefact question, not a
// grammar question, and a plain substring scan is the right tool for it.
// Their overlap with `modelAuthoredLink` is not a bug: AC-F32's own measured
// fixture shows every model-authored link containing a bare url, and every
// reference definition containing both a marker and a bare url. Coalescing
// (below) is what keeps that overlap from being either double-counted or
// double-removed.
//
// AC-F12'S COUNT VS AC-F32'S RANGES ARE TWO DIFFERENT GROUPINGS OF THE SAME
// RAW HITS, ON PURPOSE. Two hits that share characters (one nested in, or
// partially overlapping, another) are components of the SAME citation and
// must not be double-counted — AC-F32's own six-raw-hits-become-three
// fixture is the falsifier for that. Two hits that merely TOUCH (e.g. two
// links with no separator between them) are DISTINCT citations and must not
// be under-counted just because removing them together is safe — "coalescing
// is a removal-safety measure and must not be allowed to under-report"
// (AC-F32). So `count` groups on genuine overlap only; `ranges` (for
// `removeResidue`) additionally merges merely-touching hits, because a single
// contiguous excision is always safe regardless of how many citations it
// spans.
//
// A LEGITIMATE CITATION MARKER IS ITSELF A MARKDOWN LINK.
// `emitMarker(n, url)` (lib/tracking/citationMarker.js) produces exactly
// `[n](url)` — syntactically indistinguishable from a model-authored link.
// The production write path never needs to tell them apart: this scanner
// runs on `interaction.output_text`, the model's raw prose, strictly BEFORE
// any marker is ever spliced in (digestCitations.js's buildCitedDigest,
// step 1), so there is nothing to protect on that path, and there must not
// be — a hostile posting instructing the model to write
// "[1](https://evil.example/x)" must get exactly the same treatment as any
// other model-authored link. Digit-only labels earn no exemption; that is
// the whole point of removing every model-authored link unconditionally.
//
// The optional second argument exists for a caller that is NOT that path —
// one that already holds a set of markers it inserted itself and knows, by
// construction, to be legitimate (e.g. a defensive re-scan of already-spliced
// presentation text) — and needs to re-run this scanner without eating its
// own citations. It is additive and opt-in: omitted, behaviour is identical
// to the single-argument contract the plan specifies, and every model-
// authored link is still flagged unconditionally. Per "use W1's exports
// rather than re-deriving the syntax", protection is BYTE-IDENTITY against
// `emitMarker`'s own output, not a second "does this look like a marker"
// pattern: `scanCitationResidue(text, { protectedMarkers: [emitMarker(3, url)] })`
// protects only that exact string, and a marker for the same url under a
// different number is not protected (see citationResidue.test.js's
// "byte-exact" case).

import { parseMarkdown } from "../experience/markdown.js";

const ZERO_REASONS = Object.freeze({
  unmatchedMarker: 0,
  referenceDefinition: 0,
  bareUrl: 0,
  modelAuthoredLink: 0,
});

// Reference-style definition line: "[label]: destination". AC-F12's own
// spelling of the rule.
const REFERENCE_DEFINITION_RE = /^\[[^\]]+\]:[ \t]*\S+/gm;

// Unmatched bracket markers AC-F12 names by example: "[1]", "[[1]]",
// "[source [1]]". Not gated on adjacency to "(" or ":" — those cases legitimately
// overlap modelAuthoredLink / referenceDefinition, and that overlap is
// resolved by coalescing, not by making this recogniser context-aware.
const UNMATCHED_MARKER_RE = /\[\[?(?:[A-Za-z][A-Za-z ]*\s+)?\d+\]?\]/g;

// A bare url in prose. Deliberately blind to markdown structure: it matches
// inside a link's own destination, inside a reference definition, inside an
// image — AC-F32's fixture measures exactly this overlap and requires it.
const BARE_URL_RE = /\bhttps?:\/\/\S+/g;

function findAll(re, text, reason) {
  const hits = [];
  let m;
  while ((m = re.exec(text))) {
    hits.push({ start: m.index, end: m.index + m[0].length, reason });
  }
  return hits;
}

// Mirrors parseInline's traversal (lib/experience/markdown.js:138-230) for
// exactly the two branches that decide whether a span becomes a link:
//   - a backslash escape consumes the next character. The renderer only
//     escapes when that character is in its ESCAPABLE set, but every
//     character this function reacts to ("[", "!") IS in that set, and for
//     any other character the renderer's non-escape path still advances
//     two positions before either function next reacts to anything — so
//     unconditionally consuming two characters on any backslash reproduces
//     the renderer's scan-trigger positions exactly, without importing or
//     duplicating its private ESCAPABLE table.
//   - "!" immediately before "[" is the renderer's IMAGE branch, checked
//     first: it consumes through the first ")" like a link would, but forms
//     no link token at all (the url is discarded; only alt text survives).
//     A finder that did not special-case this would flag an image's own
//     "[...](...)" as modelAuthoredLink residue it never needs to be —
//     images can never produce a link token, so there is nothing there for
//     SEC-F4 to care about.
//   - "[" then the FIRST "]", requiring an immediate "(", then the FIRST
//     ")" — no balancing. This is the one grammar rule the whole module
//     exists to mirror: `LINK_RE`'s balanced-paren group accepts a
//     DIFFERENT language, and that is precisely where it disagrees with
//     the renderer.
function scanModelAuthoredLinks(str) {
  const hits = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    const ch = str[i];

    if (ch === "\\" && i + 1 < n) {
      i += 2;
      continue;
    }

    if (ch === "!" && str[i + 1] === "[") {
      const closeBracket = str.indexOf("]", i + 2);
      if (closeBracket !== -1 && str[closeBracket + 1] === "(") {
        const closeParen = str.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          i = closeParen + 1; // an image: no link token, nothing to flag
          continue;
        }
      }
      i += 1;
      continue;
    }

    if (ch === "[") {
      const closeBracket = str.indexOf("]", i + 1);
      if (closeBracket !== -1 && str[closeBracket + 1] === "(") {
        const closeParen = str.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          hits.push({ start: i, end: closeParen + 1, reason: "modelAuthoredLink" });
          i = closeParen + 1;
          continue;
        }
      }
      i += 1;
      continue;
    }

    i += 1;
  }
  return hits;
}

function toProtectedSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

// Groups hits that share the same underlying citation. `mergeTouching`
// selects which of the two groupings AC-F32 requires: `false` (count) merges
// only hits that genuinely share a character; `true` (removal ranges)
// additionally merges hits that merely touch, because removing one
// contiguous block is always safe.
function groupSpans(hits, mergeTouching) {
  if (hits.length === 0) return [];
  const sorted = [...hits].sort((a, b) => a.start - b.start || a.end - b.end);
  const groups = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let k = 1; k < sorted.length; k++) {
    const h = sorted[k];
    const last = groups[groups.length - 1];
    const merges = mergeTouching ? h.start <= last.end : h.start < last.end;
    if (merges) {
      if (h.end > last.end) last.end = h.end;
    } else {
      groups.push({ start: h.start, end: h.end });
    }
  }
  return groups;
}

/**
 * Scans the model's raw text for every citation-shaped artefact that must
 * not survive into stored markdown.
 *
 * @param {unknown} text
 * @param {{protectedMarkers?: Set<string>|string[]}} [options] Additive,
 *   opt-in. See the module header: omit it on the write path.
 * @returns {{
 *   count: number,
 *   reasons: {unmatchedMarker: number, referenceDefinition: number, bareUrl: number, modelAuthoredLink: number},
 *   ranges: Array<{start: number, end: number}>,
 * }}
 */
export function scanCitationResidue(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) {
    return { count: 0, reasons: { ...ZERO_REASONS }, ranges: [] };
  }

  const protectedMarkers = toProtectedSet(options?.protectedMarkers);

  const linkHitsRaw = scanModelAuthoredLinks(text);
  const protectedSpans = [];
  const linkHits = [];
  for (const hit of linkHitsRaw) {
    if (protectedMarkers.size > 0 && protectedMarkers.has(text.slice(hit.start, hit.end))) {
      protectedSpans.push(hit);
    } else {
      linkHits.push(hit);
    }
  }

  const isInsideProtected = (hit) =>
    protectedSpans.some((p) => hit.start >= p.start && hit.end <= p.end);

  REFERENCE_DEFINITION_RE.lastIndex = 0;
  UNMATCHED_MARKER_RE.lastIndex = 0;
  BARE_URL_RE.lastIndex = 0;
  const otherHits = [
    ...findAll(REFERENCE_DEFINITION_RE, text, "referenceDefinition"),
    ...findAll(UNMATCHED_MARKER_RE, text, "unmatchedMarker"),
    ...findAll(BARE_URL_RE, text, "bareUrl"),
  ].filter((hit) => !isInsideProtected(hit));

  const rawHits = [...linkHits, ...otherHits];

  const reasons = { ...ZERO_REASONS };
  for (const hit of rawHits) reasons[hit.reason] += 1;

  const countGroups = groupSpans(rawHits, false);
  const ranges = groupSpans(rawHits, true);

  return { count: countGroups.length, reasons, ranges };
}

// The whitespace seam a removal can create (1c §0.3.1 / 1e T-1), and only
// the three shapes actually measured: a space on both sides of the removed
// span collapses to one; a space before trailing punctuation is dropped
// rather than the punctuation; a space right after "(" is dropped rather
// than the paren. Each is checked against the ORIGINAL text at the range's
// exact boundary, so only a seam the removal itself creates is touched —
// never a pre-existing double space elsewhere in the prose.
function widenForSeam(text, { start, end }) {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  if (before === " " && after === " ") return { start, end: end + 1 };
  if (before === " " && after !== "" && ".,;:!?)".includes(after)) return { start: start - 1, end };
  if (before === "(" && after === " ") return { start, end: end + 1 };
  return { start, end };
}

/**
 * Removes the given (coalesced, disjoint) ranges from `text`, repairing the
 * whitespace seam each removal can leave. Total: malformed or empty input
 * degrades to returning `text` unchanged rather than throwing.
 *
 * @param {unknown} text
 * @param {Array<{start: number, end: number}>} ranges
 * @returns {string}
 */
export function removeResidue(text, ranges) {
  if (typeof text !== "string") return text;
  if (!Array.isArray(ranges) || ranges.length === 0) return text;

  const valid = ranges.filter(
    (r) =>
      r &&
      Number.isInteger(r.start) &&
      Number.isInteger(r.end) &&
      r.start >= 0 &&
      r.end <= text.length &&
      r.start < r.end
  );
  if (valid.length === 0) return text;

  const sorted = [...valid].sort((a, b) => a.start - b.start || a.end - b.end);
  const widened = sorted.map((r) => widenForSeam(text, r));
  // Widening can turn two seam-adjacent ranges into overlapping ones; a
  // second coalescing pass over the widened ranges keeps the final removal
  // disjoint and correctly ordered regardless.
  const merged = groupSpans(widened, true);

  let result = "";
  let prevEnd = 0;
  for (const r of merged) {
    result += text.slice(prevEnd, r.start);
    prevEnd = r.end;
  }
  result += text.slice(prevEnd);
  return result;
}

function countLinkTokens(tokens) {
  let n = 0;
  for (const token of tokens || []) {
    if (token?.type === "link") n += 1;
    if (Array.isArray(token?.children)) n += countLinkTokens(token.children);
    if (Array.isArray(token?.items)) {
      for (const item of token.items) n += countLinkTokens(item.children);
    }
  }
  return n;
}

/**
 * SEC-F4's terminal proof: `parseMarkdown(markdown)` yields zero `link`
 * tokens. This is the ONLY thing that actually decides whether residue
 * survived — total, and impossible to fool with a syntax nobody enumerated,
 * because it asks the renderer directly rather than a second pattern.
 *
 * OBSERVABILITY (plan §0.4): a real, non-empty markdown string producing a
 * non-zero survivor count is a reportable anomaly — the exact failure this
 * whole module exists to prevent — so it is logged with the count, not
 * silently returned as `false`.
 *
 * @param {unknown} markdown
 * @returns {boolean}
 */
export function storedMarkdownHasNoLinks(markdown) {
  if (typeof markdown !== "string" || markdown.length === 0) return true;
  const survivors = countLinkTokens(parseMarkdown(markdown));
  if (survivors > 0) {
    console.warn(
      `[citationResidue] storedMarkdownHasNoLinks: ${survivors} model-authored link token(s) survived residue removal`
    );
  }
  return survivors === 0;
}
