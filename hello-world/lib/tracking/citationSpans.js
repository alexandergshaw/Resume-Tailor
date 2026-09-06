// The ONE byte -> UTF-16 conversion in the repo.
//
// THE DEFECT THIS MODULE EXISTS TO PREVENT.
//
// The vendor documents its citation offsets as "measured in bytes" -- three
// independent declarations agree (the SDK's `Segment` and `URLCitation`
// interfaces, and the Vertex REST `Segment` reference). `String.prototype.
// slice` operates on UTF-16 code units. For pure ASCII the two coincide; for
// anything else -- an accented letter, an em dash, a currency sign, an
// emoji, all routine in company-research prose -- they diverge, and the
// drift is CUMULATIVE: every non-ASCII character earlier in the document
// pushes every later offset further off target.
//
// Measured (1h R-6.1) on Google's own published sample, porting
// `text.slice(0, endIndex)` directly: 0 of 3 markers landed at a real
// passage boundary, all 3 landed inside a different sentence, with drift of
// +3, +5, +8 bytes -- so the LAST footnote in a long digest is the most
// wrong. Do not port that sample.
//
// Google's own published "new-surface" sample compounds this a second way:
// it reads `annotation.startIndex`/`endIndex`, but the wire and the
// installed SDK send `start_index`/`end_index`. Reading the wrong field name
// yields `undefined` for both bounds, and `text.slice(undefined, undefined)`
// silently returns the WHOLE STRING -- no throw, no NaN, nothing to notice.
// `DIGEST.slice(0, DIGEST.length) === DIGEST.slice(undefined, undefined)` is
// `true` in JavaScript, which is why a whole-document span must be refused
// for what it CLAIMS (one source cannot be the origin of an entire research
// digest), not merely because it looks wide -- the two are indistinguishable
// after conversion, so the check has to happen on the claim itself.
//
// THE RULE, load-bearing everywhere below: convert once, at write, against
// the exact string about to be stored, and REFUSE any offset that is not a
// character boundary. Never round it, never clamp it, never guess. A
// degraded citation -- no marker, honest unmarked prose -- is always
// available and always correct. A marker spliced at the wrong character is
// worse than no citation at all: it names the WRONG sentence as
// corroborated, which is a more convincing lie than an absent footnote.
//
// THE CONVERSION, and why it is cheap rather than merely correct.
// `TextEncoder.encode` is called exactly ONCE per document, producing the
// exact bytes the vendor's own offsets were computed against. The byte
// array is then walked jumping from one UTF-8 LEAD byte to the next (a byte
// that is not a continuation byte, i.e. does not match `10xxxxxx`): a lead
// byte < 0x80 starts a 1-byte character (1 UTF-16 unit), < 0xE0 a 2-byte
// character (1 unit), < 0xF0 a 3-byte character (1 unit -- this bucket also
// covers the 3-byte UTF-8 encoding TextEncoder gives an unpaired surrogate,
// EF BF BD, which is exactly right: an unpaired surrogate is one UTF-16
// unit), and otherwise a 4-byte character, which can only arise from a
// surrogate PAIR and is therefore 2 UTF-16 units. This makes the walk
// O(number of characters), not O(bytes) or O(N x document length) --
// measured at 0.013 ms for a realistic digest, flat as citation count N
// grows, linear only in document size (1h R-5.2/R-6.3). The alternative an
// implementer reaches for instead -- decode a fresh byte prefix per offset
// -- is O(N x doclen) and becomes the SLOWER choice above roughly two
// citations; 1b's often-quoted "6.1 ms" figure is that slower shape and must
// not be cited as this conversion's cost.

/**
 * Encodes `text` once and returns a Map from every valid UTF-8 byte offset
 * that begins a character (plus one sentinel entry at the total byte length)
 * to the UTF-16 code-unit index at which that character starts.
 *
 * A byte offset that is NOT a key in this map is not a character boundary --
 * `spanFor` refuses it rather than rounding or decoding it anyway.
 *
 * One extension beyond the bare byte walk, attached as an own property on
 * the returned Map rather than carried in a second return value, so the
 * exported shape stays exactly `Map<number, number>` for every consumer that
 * only calls `.get`/`.has`: `loneSurrogateAt`, the UTF-16 index of the FIRST
 * unpaired surrogate in `text`, or -1 if there is none. `spanFor` uses it;
 * nothing else needs to.
 *
 * @param {string} text
 * @returns {Map<number, number>}
 */
export function byteBoundaryMap(text) {
  if (typeof text !== "string") {
    throw new TypeError("byteBoundaryMap: text must be a string");
  }

  const bytes = new TextEncoder().encode(text);
  const map = new Map();

  let unit = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    map.set(i, unit);

    let width;
    if (b < 0x80) {
      width = 1;
      unit += 1;
    } else if (b < 0xe0) {
      width = 2;
      unit += 1;
    } else if (b < 0xf0) {
      width = 3;
      unit += 1;
    } else {
      width = 4;
      unit += 2;
    }
    i += width;
  }
  // The end-of-string boundary. `end === byteLength(text)` is a legal span
  // end (rule: refuse only when it EXCEEDS the length); this is the one key
  // that makes that boundary resolvable via the same map lookup as every
  // other one, with no separate "is this past the end" arithmetic anywhere
  // else in this module.
  map.set(bytes.length, unit);

  map.loneSurrogateAt = firstLoneSurrogateIndex(text);
  return map;
}

/**
 * The UTF-16 index of the first unpaired (lone) surrogate code unit in
 * `text`, or -1 if every surrogate is properly paired.
 *
 * Why this matters here rather than being a generic string-validity check:
 * a valid surrogate PAIR encodes to one 4-byte UTF-8 character and consumes
 * exactly 2 UTF-16 units -- ordinary, handled by the byte walk above with no
 * special case. An UNPAIRED surrogate is not valid Unicode text; TextEncoder
 * silently substitutes the replacement character (U+FFFD, 3 bytes) for it,
 * a substitution some other byte-counter (including, potentially, whatever
 * produced the vendor's original offsets) is not obliged to make the same
 * way. Once one appears, this module's own conversion stays internally
 * self-consistent, but nothing can attest that it stays correct against
 * offsets computed elsewhere -- so a span whose end reaches at or past one
 * is refused rather than trusted. See `spanFor`'s SPAN_REFUSAL.UNPAIRED_
 * SURROGATE branch.
 */
function firstLoneSurrogateIndex(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1; // a real pair; skip its low half and keep walking
        continue;
      }
      return i; // high surrogate with no low surrogate following
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return i; // low surrogate with no high surrogate preceding it
    }
  }
  return -1;
}

/** Stable, named reasons `spanFor` refuses a span for. See `spanRefusalReason`. */
export const SPAN_REFUSAL = Object.freeze({
  BAD_SHAPE: "bad-shape",
  NON_NUMERIC: "non-numeric",
  NOT_INTEGER: "not-integer",
  NEGATIVE: "negative",
  INVERTED: "inverted",
  NOT_BOUNDARY: "not-boundary",
  WHOLE_DOCUMENT: "whole-document",
  UNPAIRED_SURROGATE: "unpaired-surrogate",
});

// The single source of truth both `spanFor` and `spanRefusalReason` read
// from, so the two can never disagree about which spans are usable -- the
// exact hazard this feature exists to close everywhere else (two
// implementations of one decision drifting apart). Returns EITHER a usable
// `{ start, end }` pair OR a `reason` code, never both, never neither.
function resolve(text, source, map) {
  if (typeof text !== "string" || !(map instanceof Map)) {
    return { reason: SPAN_REFUSAL.BAD_SHAPE };
  }
  if (!source || typeof source !== "object") {
    return { reason: SPAN_REFUSAL.BAD_SHAPE };
  }

  const { startByte, endByte } = source;

  // Rule 1 (absent/null/non-numeric) and rule 4 (a numeric STRING). A strict
  // typeof check refuses both: `citation_outcome`/`sources` round-trip
  // through jsonb with no element-level type guarantee, and a naive
  // `slice(0, "12")` or `slice(0, undefined)` would coerce or default
  // instead of refusing.
  if (typeof startByte !== "number" || typeof endByte !== "number") {
    return { reason: SPAN_REFUSAL.NON_NUMERIC };
  }
  // Rule 2 (NaN) and rule 3 (not an integer, e.g. 5.5 -- a naive slice
  // silently truncates). `Number.isInteger(NaN)` is false, so one check
  // covers both.
  if (!Number.isInteger(startByte) || !Number.isInteger(endByte)) {
    return { reason: SPAN_REFUSAL.NOT_INTEGER };
  }
  // Rule 5. `subarray(0, -3)` would otherwise yield a plausible-looking
  // suffix-truncated prefix instead of an error.
  if (startByte < 0 || endByte < 0) {
    return { reason: SPAN_REFUSAL.NEGATIVE };
  }
  // Rule 6. Never silently swapped -- an inverted pair is a shape error,
  // not a hint about which end is which.
  if (startByte > endByte) {
    return { reason: SPAN_REFUSAL.INVERTED };
  }

  // Rules 7, 8, 9 (past the end / mid-character / whole-document's
  // constituent boundaries) collapse to one check each: a byte offset that
  // is not a key in the map is not a character boundary, full stop, whether
  // because it lands inside a multi-byte sequence or because it exceeds the
  // document's total byte length (the sentinel entry `byteBoundaryMap` adds
  // is the only key equal to that length, so "past the end" and "mid-
  // character" both fail the same lookup).
  if (!map.has(startByte) || !map.has(endByte)) {
    return { reason: SPAN_REFUSAL.NOT_BOUNDARY };
  }

  const start = map.get(startByte);
  const end = map.get(endByte);

  // Rule 11. Refused for what the span CLAIMS -- the entire document as one
  // citation's source -- not for its width. This is the only way to catch
  // the camelCase-field defect (1h R-6.2): after conversion,
  // `slice(0, length)` and `slice(undefined, undefined)` are the identical
  // string, so the claim must be rejected before that ambiguity is even
  // reachable. Guarded on a non-empty document so an empty digest's own
  // zero-width insertion point (start === end === 0) is not swept in here.
  if (text.length > 0 && start === 0 && end === text.length) {
    return { reason: SPAN_REFUSAL.WHOLE_DOCUMENT };
  }

  // The lone-surrogate hazard (1h R-6.3). Only checked once both boundaries
  // are already confirmed valid, so a span that never reaches the
  // problematic character is unaffected.
  const lone = map.loneSurrogateAt;
  if (typeof lone === "number" && lone !== -1 && lone < end) {
    return { reason: SPAN_REFUSAL.UNPAIRED_SURROGATE };
  }

  return { span: { start, end } };
}

/**
 * Converts one vendor citation's byte offsets into a UTF-16 `{start, end}`
 * pair over `text`, or `null` if the offsets cannot be trusted.
 *
 * `source` is read as `{ startByte, endByte }` -- this repo's own field
 * names (never the vendor's `start_index`/`end_index`, and never the OTHER
 * API surface's `startIndex`/`endIndex`). Reading the wrong name is not a
 * special case here: it is simply absent, which rule 1 already refuses.
 *
 * REFUSES, NEVER ROUNDS, NEVER CLAMPS, NEVER GUESSES. See `SPAN_REFUSAL` /
 * `spanRefusalReason` for which of the twelve rules fired.
 *
 * `start === end` is explicitly ALLOWED: an empty span names an insertion
 * point with no extent. Refusing it would discard a corroborated citation
 * over a vendor quirk that costs the caller nothing.
 *
 * @param {string} text
 * @param {unknown} source
 * @param {Map<number, number>} map  from `byteBoundaryMap(text)`
 * @returns {{start: number, end: number} | null}
 */
export function spanFor(text, source, map) {
  const result = resolve(text, source, map);
  return result.span ?? null;
}

/**
 * The observability half. `spanFor` alone tells a caller THAT an offset was
 * refused, not WHY -- and a pipeline stage that can silently narrow a
 * non-zero input to a zero output is exactly the defect this whole feature
 * exists to close (a total input becoming a total loss must be a named,
 * reportable anomaly, never a bare, unexplained empty). This function names
 * the reason so a caller aggregating outcomes (this chunk's `citation_
 * outcome.refused.reasons`) is never reduced to re-deriving "why" from a
 * bare `null`.
 *
 * Returns one of the `SPAN_REFUSAL` codes, or `null` when the span IS
 * usable -- `spanFor` and `spanRefusalReason` are two views of the exact
 * same decision (`resolve`, above) and can never disagree about which spans
 * pass.
 *
 * @param {string} text
 * @param {unknown} source
 * @param {Map<number, number>} map
 * @returns {string | null}
 */
export function spanRefusalReason(text, source, map) {
  const result = resolve(text, source, map);
  return result.reason ?? null;
}
