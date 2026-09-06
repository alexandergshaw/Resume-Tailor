// The single render-time splice: stored prose in, presentation markdown out.
//
// TOTAL, in the strong sense. On ANY refusal -- a stamp that does not match,
// an outcome record that does not describe the spans it was handed, an
// unusable url, an unsafe insertion point -- this function returns the
// markdown it was given BYTE-IDENTICALLY. Degrading to unsourced prose is
// always available and always correct; emitting a corrupted string never is.
// It is pure: no React, no clock, no network, no TextEncoder. The byte ->
// UTF-16 conversion happened once, at write, in lib/tracking/citationSpans.js;
// by the time a stored row reaches here every offset is already a UTF-16 index
// over the exact string in the `markdown` column.
//
// WHY THE STAMP EXISTS, AND WHY IT REFUSES *ALL* SPANS RATHER THAN THE ONES
// THAT LOOK WRONG.
//
// An offset is only meaningful against one exact string. If the string it
// indexed is not the string in hand, no individual offset can be validated, so
// refusing them one at a time would be a fiction: there is no evidence with
// which to keep any of them. Measured, stamping an original and mutating it,
// three of seven mutation classes are INVISIBLE to a length check -- a word
// swapped for a same-length word, a case flip, a space replaced by a
// non-breaking space. A same-length word swap is exactly what a copy-edit
// looks like, and it moves nothing while changing everything a marker points
// at. So the hash is the load-bearing half and the length is a cheap
// early-out, and both are recomputed here over the string actually handed in.
//
// AND THE HOLE THE STAMP DOES NOT COVER, WHICH IS THE REASON THIS FILE HAS A
// SECOND BINDING CHECK.
//
// The stamp binds the outcome record to the markdown. The SPANS live in a
// different column. `upsertDigest` gates every field independently -- an
// `Array.isArray(fields.sources)` guard means a non-array `sources` is
// silently not written while `markdown` and `citation_outcome` are, and on the
// update branch the column keeps its PREVIOUS value. The result is new
// markdown, a stamp that matches it perfectly, and one-run-old offsets. Every
// marker then splices at an offset from the previous run, on a
// corroborated-looking footnote, with no disclosure at all. The converse
// direction is safe -- a dropped `citation_outcome` reads as null, takes the
// legacy path, and produces no markers -- which is exactly why the asymmetry
// is easy to miss.
//
// The close is one comparison on a field the record already carries:
// `citation_outcome.counts.placed` MUST equal the number of `sources` elements
// carrying a usable span over THIS markdown. A stale array of a different
// length fails on the count; a stale array of the same length fails because
// its offsets no longer resolve against a shorter or differently-shaped
// document. On mismatch every span is refused, exactly as for a stamp
// mismatch.
//
// THE SPLICE ITSELF RUNS RIGHT TO LEFT, AND THE SAFETY CHECK IS CUMULATIVE.
// Right to left means an accepted insertion never invalidates an offset that
// has not been used yet. Cumulative means each candidate is checked against
// the string as it now stands, with every previously accepted marker already
// in it -- measured, two markers each individually safe against the STORED
// string, where the second lands inside the first's emitted syntax, produce a
// raw url in the prose and the wrong surviving href, and both per-marker
// checks pass. Ties at one offset are broken on DESCENDING number so that,
// inserted right to left at the same index, they render ascending.
//
// NOTHING HERE CONSTRUCTS MARKER SYNTAX OR JUDGES A URL BY ITS CHARACTERS.
// `emitMarker` is the only producer of the bytes "[", "](" and ")";
// `markerUrlAllowed` asks the renderer whether a url survives a marker rather
// than enumerating the characters that break one; `differsOnlyByMarker`
// compares two parses. A second recogniser is the defect this feature exists
// to close, so there is not one in this file.

import { pageIdentityKey } from "../llm/grounding.js";
import { citationHost } from "./citationHref.js";
import {
  differsOnlyByMarker,
  emitMarker,
  markerUrlAllowed,
  precededByDigit,
} from "./citationMarker.js";

/**
 * The outcome record's shape version. Bumped only on an INCOMPATIBLE change.
 * An unrecognised version is never guessed at: the renderer refuses every
 * span and the panel shows honest, unmarked prose.
 */
export const CITATION_OUTCOME_VERSION = 1;

/**
 * Why the renderer refused to splice anything at all. `null` when it did not.
 * These are whole-digest verdicts, not per-citation ones -- a per-citation
 * refusal is counted in `refused` and costs one marker, not all of them.
 */
export const CITATION_BINDING = Object.freeze({
  /** No outcome record: a legacy row, or the hook's synthetic failed object. */
  NO_OUTCOME: "no-outcome",
  /** A shape this build does not know how to read. */
  VERSION: "version",
  /** The write path could not prove the model's own links were removed. */
  RESIDUE: "residue",
  /** The markdown is not the string the offsets were computed against. */
  STAMP: "stamp",
  /** The record does not describe the spans it was handed (the F-2 hole). */
  SPAN_COUNT: "span-count",
});

function emptyRefusals() {
  return { unsafeInsertionPoint: 0, digitAdjacent: 0, unusableSpan: 0, unusableUrl: 0 };
}

function refuseEverything(markdown, bindingFailure) {
  return {
    markdown,
    emitted: [],
    accepted: [],
    refused: emptyRefusals(),
    stampOk: false,
    bindingFailure,
  };
}

/**
 * The A-R2 stamp: the UTF-16 length of `markdown` and a short hash of it.
 *
 * FNV-1a in two lanes, because this has to be SYNCHRONOUS. The renderer is
 * pure and node-testable by contract, and the only digest primitive in this
 * repo (`lib/drive/contentHash.js`'s `sha256Hex`) is async and needs
 * `crypto.subtle`; making the render path async to reach it would change what
 * this module is. The stamp's job is to detect that the string CHANGED --
 * a copy-edit, a normalisation, a stale write -- not to resist an adversary
 * who can already write the row. The defence against hostile content is the
 * url control, which runs regardless of what the stamp says.
 *
 * The second lane mixes the character's POSITION as well as its value, so a
 * transposition (which leaves an unmixed FNV state unchanged in aggregate) is
 * still separated.
 *
 * @param {unknown} markdown
 * @returns {{len: number|null, hash: string|null}}
 */
export function markdownStamp(markdown) {
  if (typeof markdown !== "string") return { len: null, hash: null };

  let h1 = 0x811c9dc5;
  let h2 = 0xc59d1c81;
  for (let i = 0; i < markdown.length; i++) {
    const code = markdown.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x01000193);
  }

  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return { len: markdown.length, hash: `${hex(h1)}${hex(h2).slice(-4)}` };
}

// Whether an element CLAIMS a span at all. An element with neither `start` nor
// `end` is an "also searched" entry: Google supplied it, the write path could
// not place it, and it was already counted there. It is not a refusal here and
// must not be counted as one, or the disclosure double-reports it.
function claimsSpan(source) {
  return (
    !!source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    (source.start !== undefined || source.end !== undefined)
  );
}

// A claimed span resolved against THIS markdown, or null. Deliberately strict
// in the same directions `spanFor` is at write time: a non-integer, a negative
// bound, an inverted pair or an end past the document are refused, never
// clamped. `start === end` is allowed -- an empty span names an insertion
// point with no extent.
function resolveSpan(markdown, source) {
  const { start, end } = source;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end < start || end > markdown.length) return null;
  return { start, end };
}

/**
 * Splices citation markers into stored digest prose.
 *
 * @param {unknown} markdown  the stored `application_digests.markdown` value
 * @param {unknown} sources   the stored `sources` jsonb array, elements
 *                            `{url, title, start?, end?}` with UTF-16 offsets
 * @param {unknown} outcome   the stored `citation_outcome` jsonb record
 * @returns {{
 *   markdown: string,
 *   emitted: Array<{n: number, href: string, label: string, host: string, key: string}>,
 *   accepted: Array<{index: number, n: number, href: string, start: number, end: number}>,
 *   refused: {unsafeInsertionPoint: number, digitAdjacent: number, unusableSpan: number, unusableUrl: number},
 *   stampOk: boolean,
 *   bindingFailure: string|null,
 * }}
 */
export function renderCitedMarkdown(markdown, sources, outcome) {
  const text = typeof markdown === "string" ? markdown : "";
  const list = Array.isArray(sources) ? sources : [];

  // ---- the whole-digest gates, in the order that makes each one meaningful
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
    return refuseEverything(text, CITATION_BINDING.NO_OUTCOME);
  }
  if (outcome.version !== CITATION_OUTCOME_VERSION) {
    return refuseEverything(text, CITATION_BINDING.VERSION);
  }
  // Only an explicit `false` refuses. `undefined` on a record that predates
  // the field is not evidence that residue survived.
  if (outcome.residueClean === false) {
    return refuseEverything(text, CITATION_BINDING.RESIDUE);
  }
  if (typeof markdown !== "string") {
    return refuseEverything("", CITATION_BINDING.STAMP);
  }

  const stamp = markdownStamp(text);
  if (stamp.len !== outcome.len || stamp.hash !== outcome.hash) {
    return refuseEverything(text, CITATION_BINDING.STAMP);
  }

  // ---- the F-2 binding: does this record describe THESE spans?
  const claimed = [];
  list.forEach((source, index) => {
    if (claimsSpan(source)) claimed.push({ source, index });
  });
  const resolved = claimed.map((c) => ({ ...c, span: resolveSpan(text, c.source) }));
  const usableSpans = resolved.filter((r) => r.span !== null);

  const placed = outcome.counts?.placed;
  if (!Number.isInteger(placed) || placed < 0 || placed !== usableSpans.length) {
    return refuseEverything(text, CITATION_BINDING.SPAN_COUNT);
  }

  const refused = emptyRefusals();
  refused.unusableSpan = resolved.length - usableSpans.length;

  // ---- candidates: a usable span AND a url that survives a marker
  const candidates = [];
  for (const entry of usableSpans) {
    const href = entry.source.url;
    if (!markerUrlAllowed(href)) {
      refused.unusableUrl += 1;
      continue;
    }
    candidates.push({
      index: entry.index,
      href,
      start: entry.span.start,
      end: entry.span.end,
    });
  }

  // ---- numbering: one number per distinct PAGE, in first-appearance order by
  // insertion point. The total order (end, then start, then the element's
  // original position) makes the numbering deterministic for any input,
  // including two citations that differ only in where their passage began.
  // The number itself is never stored: it is assigned here, every render.
  const byAppearance = [...candidates].sort(
    (a, b) => a.end - b.end || a.start - b.start || a.index - b.index
  );
  const numbers = new Map();
  for (const candidate of byAppearance) {
    // A url `markerUrlAllowed` admitted always yields a key; the fallback
    // exists so a future change to either function cannot produce an
    // unnumbered candidate.
    const key = pageIdentityKey(candidate.href) ?? candidate.href;
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    candidate.key = key;
    candidate.n = numbers.get(key);
  }

  // ---- the cumulative splice, right to left
  const spliceOrder = [...byAppearance].sort(
    (a, b) => b.end - a.end || b.n - a.n || b.index - a.index
  );
  let out = text;
  const accepted = [];
  for (const candidate of spliceOrder) {
    const digits = String(candidate.n);
    // Parse-identical and still wrong: "Nimbus employs 400 people." becomes
    // "Nimbus employs 4001 people.", which a candidate reads aloud.
    if (precededByDigit(out, candidate.end)) {
      refused.digitAdjacent += 1;
      continue;
    }
    const next =
      out.slice(0, candidate.end) + emitMarker(digits, candidate.href) + out.slice(candidate.end);
    if (!differsOnlyByMarker(out, next, digits, candidate.href)) {
      refused.unsafeInsertionPoint += 1;
      continue;
    }
    out = next;
    accepted.push(candidate);
  }

  // ---- what the panel reads. One entry per distinct (number, href) pair, in
  // ascending number then first-appearance order. Host and label are derived
  // from the anchor's OWN href in the same expression that produces it -- no
  // host lookup, ever, because a host welded to a url from somewhere else is
  // how an invented path acquires a real publisher's name.
  const emitted = [];
  const seen = new Set();
  for (const candidate of [...accepted].sort(
    (a, b) => a.n - b.n || a.end - b.end || a.index - b.index
  )) {
    const dedupe = `${candidate.n} ${candidate.href}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const host = citationHost(candidate.href);
    emitted.push({
      n: candidate.n,
      href: candidate.href,
      host,
      label: `Source ${candidate.n}: ${host}`,
      key: candidate.key,
    });
  }

  return {
    markdown: out,
    emitted,
    accepted: accepted.map((c) => ({
      index: c.index,
      n: c.n,
      href: c.href,
      start: c.start,
      end: c.end,
    })),
    refused,
    stampOk: true,
    bindingFailure: null,
  };
}
