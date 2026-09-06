// The falsifier for the module that owns the byte -> UTF-16 conversion.
//
// WHY THIS FILE IS SHAPED THE WAY IT IS.
//
// The vendor's citation offsets are documented "measured in bytes" (SDK
// `Segment`/`URLCitation`, Vertex REST `Segment` -- three independent
// declarations, all in agreement). `String.prototype.slice` is UTF-16. For
// ASCII prose the two units coincide; for anything else -- an accented
// letter, an em dash, a currency sign, an emoji, all routine in
// company-research prose -- they diverge, and the drift is CUMULATIVE: every
// non-ASCII character earlier in the document pushes every later offset
// further off target. Measured on Google's own published sample (1h R-6.1):
// 0 of 3 markers landed at a real passage boundary, and all 3 landed inside a
// different sentence, with drift of +3, +5, +8 bytes.
//
// Google's own published "new-surface" sample compounds this: it reads
// `annotation.startIndex`/`endIndex` while the wire and the installed SDK
// send `start_index`/`end_index`, so `slice(undefined, undefined)` returns
// the WHOLE STRING, silently, no throw. `DIGEST.slice(0, DIGEST.length) ===
// DIGEST.slice(undefined, undefined)` is `true` in JavaScript, which is why
// a whole-document span must be refused for what it CLAIMS (the whole
// document is not one passage's source), not merely because it looks wide.
//
// This module's rule, load-bearing everywhere below: REFUSE a byte offset
// that is not a character boundary. Never round it, never clamp it, never
// treat an out-of-range or absent value as "the whole string". A degraded
// citation (no marker, honest prose) is always available and always correct;
// a marker spliced at the wrong character is worse than no citation at all,
// because it names the wrong sentence as corroborated.
//
// Two named consumers of this fixture set (documented in the accompanying
// mutant-comparison script, not re-run automatically as part of this file):
// (a) a naive port of Google's legacy `text.slice(0, endIndex)` sample,
//     treating the byte offset as a UTF-16 index -- this is exactly the
//     defect measured above; and
// (b) a naive port of Google's new-surface sample reading the camelCase
//     `startIndex`/`endIndex` fields this repo's `startByte`/`endByte`
//     contract never uses.
// Both are refuted by name in the module's own header and by the tests
// below, which is how this file proves it discriminates a correct
// implementation from either plausible-wrong one.

import { describe, it, expect } from "vitest";
import { byteBoundaryMap, spanFor, spanRefusalReason, SPAN_REFUSAL } from "./citationSpans.js";

// ---------------------------------------------------------------------------
// The fixture. Deliberately the same hazard classes 1h's probe used: an
// accented letter (2-byte), an em dash (3-byte), a currency sign (3-byte),
// and an emoji (4-byte / surrogate pair) -- one of each UTF-8 width class,
// so every branch of the byte-walk is exercised by realistic prose, not a
// synthetic string built only to hit branches.
// ---------------------------------------------------------------------------

const FIXTURE =
  "Nestlé S.A. is headquartered in Vevey, Switzerland — a lakeside town near Lausanne. " +
  "The group reported organic growth of 2.1% and returned €1.2bn to shareholders in Q3. " +
  "Its Zürich office is hiring 🚀 across supply-chain analytics.";

// Independently-counted byte offsets for named boundaries in FIXTURE, so the
// tests do not depend on `byteBoundaryMap` to locate the very boundaries they
// are checking it against. Computed by hand against UTF-8:
//   é  = 2 bytes (was 1 UTF-16 unit)   -> "Nestlé" ends at byte 7, unit 6
//   —  = 3 bytes (was 1 UTF-16 unit)
//   €  = 3 bytes (was 1 UTF-16 unit)
//   🚀 = 4 bytes (was 2 UTF-16 units, a surrogate pair)
const UNIT_INDEX_OF = (needle) => FIXTURE.indexOf(needle);
const BYTE_LENGTH = new TextEncoder().encode(FIXTURE).length;
const UNIT_LENGTH = FIXTURE.length;

function byteOffsetOfUnit(unit) {
  // An independent oracle, built without using byteBoundaryMap at all: slice
  // the string in UTF-16 space and ask TextEncoder how many bytes that
  // prefix takes. Used only to construct fixtures/assert against, never used
  // by the module under test.
  return new TextEncoder().encode(FIXTURE.slice(0, unit)).length;
}

describe("byteBoundaryMap", () => {
  const map = byteBoundaryMap(FIXTURE);

  it("returns a Map", () => {
    expect(map).toBeInstanceOf(Map);
  });

  it("maps byte 0 to UTF-16 unit 0", () => {
    expect(map.get(0)).toBe(0);
  });

  it("maps the total byte length to the total UTF-16 length (the end-of-string boundary)", () => {
    expect(map.get(BYTE_LENGTH)).toBe(UNIT_LENGTH);
  });

  it("agrees with the independent oracle at every character boundary in the fixture", () => {
    // Walk the fixture one CODE POINT at a time (respecting surrogate pairs)
    // and assert the map's value at each character's starting byte offset
    // equals that character's UTF-16 start index -- checked against
    // `byteOffsetOfUnit`, an oracle built by a completely different method
    // (slice + re-encode) than the module's single-pass byte walk.
    let unit = 0;
    let checked = 0;
    while (unit < UNIT_LENGTH) {
      const cp = FIXTURE.codePointAt(unit);
      const width = cp > 0xffff ? 2 : 1; // surrogate pair vs single unit
      const byteOffset = byteOffsetOfUnit(unit);
      expect(map.get(byteOffset)).toBe(unit);
      checked += 1;
      unit += width;
    }
    // Guard against a vacuous pass: the fixture must actually contain more
    // than a couple of characters, or "every boundary" checks almost nothing.
    expect(checked).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// spanFor -- multi-byte class boundaries, exactly at the passage ends 1h's
// probe measured Google's own sample missing by +3, +5 and +8 bytes.
// ---------------------------------------------------------------------------

describe("spanFor -- multi-byte class boundaries", () => {
  const map = byteBoundaryMap(FIXTURE);

  it("places a span ending right after a 2-byte character (é)", () => {
    const unitEnd = UNIT_INDEX_OF("Nestlé") + "Nestlé".length;
    const byteEnd = byteOffsetOfUnit(unitEnd);
    const span = spanFor(FIXTURE, { startByte: 0, endByte: byteEnd }, map);
    expect(span).toEqual({ start: 0, end: unitEnd });
    expect(FIXTURE.slice(span.start, span.end)).toBe("Nestlé");
  });

  it("places a span ending right after a 3-byte character (an em dash)", () => {
    const unitEnd = UNIT_INDEX_OF("—") + 1;
    const byteEnd = byteOffsetOfUnit(unitEnd);
    const unitStart = UNIT_INDEX_OF("Switzerland");
    const byteStart = byteOffsetOfUnit(unitStart);
    const span = spanFor(FIXTURE, { startByte: byteStart, endByte: byteEnd }, map);
    expect(span).toEqual({ start: unitStart, end: unitEnd });
    expect(FIXTURE.slice(span.start, span.end)).toBe("Switzerland —");
  });

  it("places a span ending right after a 3-byte currency sign (€)", () => {
    const unitEnd = UNIT_INDEX_OF("€1.2bn") + "€1.2bn".length;
    const byteEnd = byteOffsetOfUnit(unitEnd);
    const span = spanFor(FIXTURE, { startByte: 0, endByte: byteEnd }, map);
    expect(span.end).toBe(unitEnd);
    expect(FIXTURE.slice(0, span.end).endsWith("€1.2bn")).toBe(true);
  });

  it("places a span ending right after a 4-byte surrogate-pair character (an emoji)", () => {
    const emoji = "🚀";
    expect(emoji.length).toBe(2); // confirm the fixture really carries a surrogate pair
    const unitEnd = UNIT_INDEX_OF(emoji) + emoji.length;
    const byteEnd = byteOffsetOfUnit(unitEnd);
    const span = spanFor(FIXTURE, { startByte: 0, endByte: byteEnd }, map);
    expect(span.end).toBe(unitEnd);
    expect(FIXTURE.slice(0, span.end).endsWith(emoji)).toBe(true);
  });

  it("reproduces 1h's exact fixture: three passage-end spans land exactly at their sentence boundaries", () => {
    // Mirrors 1h-fn/offsets.mjs's three annotations: one per sentence, ending
    // at "Lausanne.", at "in Q3.", and at the end of the document.
    const ends = [
      UNIT_INDEX_OF("near Lausanne.") + "near Lausanne.".length,
      UNIT_INDEX_OF("in Q3.") + "in Q3.".length,
      UNIT_LENGTH,
    ];
    for (const unitEnd of ends) {
      const byteEnd = byteOffsetOfUnit(unitEnd);
      const span = spanFor(FIXTURE, { startByte: 0, endByte: byteEnd }, map);
      if (unitEnd === UNIT_LENGTH) {
        // The whole-document span must be refused for what it claims (see
        // the dedicated describe block below) -- not asserted here.
        continue;
      }
      expect(span.end).toBe(unitEnd);
      expect(FIXTURE.slice(0, span.end).endsWith(FIXTURE.slice(0, unitEnd).split(/(?<=\. )/).pop())).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The mid-character refusal -- REFUSED, never rounded.
// ---------------------------------------------------------------------------

describe("spanFor -- an offset landing mid-character is refused, not rounded", () => {
  const map = byteBoundaryMap(FIXTURE);

  it("refuses a byte offset landing inside the 2-byte é", () => {
    const eByte = byteOffsetOfUnit(UNIT_INDEX_OF("é"));
    const midE = eByte + 1; // the second byte of "é"'s 2-byte encoding
    expect(map.has(midE)).toBe(false); // confirm the fixture actually is mid-character
    const span = spanFor(FIXTURE, { startByte: 0, endByte: midE }, map);
    expect(span).toBeNull();
  });

  it("refuses a byte offset landing inside the 3-byte em dash", () => {
    const dashByte = byteOffsetOfUnit(UNIT_INDEX_OF("—"));
    const mid = dashByte + 1;
    expect(map.has(mid)).toBe(false);
    expect(spanFor(FIXTURE, { startByte: 0, endByte: mid }, map)).toBeNull();
  });

  it("refuses a byte offset landing inside the 3-byte €", () => {
    const euroByte = byteOffsetOfUnit(UNIT_INDEX_OF("€"));
    const mid = euroByte + 2; // third byte still not a boundary
    expect(map.has(mid)).toBe(false);
    expect(spanFor(FIXTURE, { startByte: 0, endByte: mid }, map)).toBeNull();
  });

  it("refuses a byte offset landing inside the 4-byte emoji's surrogate pair", () => {
    const emojiByte = byteOffsetOfUnit(UNIT_INDEX_OF("🚀"));
    const mid = emojiByte + 2; // halfway through the 4-byte sequence
    expect(map.has(mid)).toBe(false);
    expect(spanFor(FIXTURE, { startByte: 0, endByte: mid }, map)).toBeNull();
  });

  it("never returns a decoded replacement character instead of refusing", () => {
    // A conversion without a boundary check silently decodes to U+FFFD here
    // (1h R-6.1's "failure mode A2"). Confirm OUR module does not do that by
    // showing what a raw decode WOULD produce, then showing spanFor refuses.
    const bytes = new TextEncoder().encode(FIXTURE);
    const eByte = byteOffsetOfUnit(UNIT_INDEX_OF("é"));
    const decoded = new TextDecoder().decode(bytes.subarray(0, eByte + 1));
    expect(decoded.endsWith("�")).toBe(true); // the silent-corruption shape
    expect(spanFor(FIXTURE, { startByte: 0, endByte: eByte + 1 }, map)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ascending and non-ascending order -- spanFor is a pure, stateless query
// against a map built once; the ORDER callers ask in must not matter.
// ---------------------------------------------------------------------------

describe("spanFor -- order independence", () => {
  const map = byteBoundaryMap(FIXTURE);
  const b1 = 0;
  const b2 = byteOffsetOfUnit(UNIT_INDEX_OF("near Lausanne.") + "near Lausanne.".length);
  const b3 = byteOffsetOfUnit(UNIT_INDEX_OF("in Q3.") + "in Q3.".length);

  it("gives the same answer regardless of query order (ascending)", () => {
    const first = spanFor(FIXTURE, { startByte: b1, endByte: b2 }, map);
    const second = spanFor(FIXTURE, { startByte: b2, endByte: b3 }, map);
    expect(first).toEqual({ start: 0, end: map.get(b2) });
    expect(second).toEqual({ start: map.get(b2), end: map.get(b3) });
  });

  it("gives the same answer when queried in descending order", () => {
    const second = spanFor(FIXTURE, { startByte: b2, endByte: b3 }, map);
    const first = spanFor(FIXTURE, { startByte: b1, endByte: b2 }, map);
    expect(second).toEqual({ start: map.get(b2), end: map.get(b3) });
    expect(first).toEqual({ start: 0, end: map.get(b2) });
  });

  it("gives the same answer when queried in an arbitrary scrambled order, repeatedly", () => {
    const sources = [
      { startByte: b2, endByte: b3 },
      { startByte: b1, endByte: b2 },
      { startByte: b2, endByte: b3 }, // repeated, must be idempotent
      { startByte: b1, endByte: b2 },
    ];
    const results = sources.map((s) => spanFor(FIXTURE, s, map));
    expect(results[0]).toEqual(results[2]);
    expect(results[1]).toEqual(results[3]);
  });
});

// ---------------------------------------------------------------------------
// Twelve refusal rules from the plan's exact exported surface (3-plan-
// footnotes.md §4.6). Each gets its own case so a regression in one rule
// cannot hide behind another passing.
// ---------------------------------------------------------------------------

describe("spanFor -- refusal rules", () => {
  const map = byteBoundaryMap(FIXTURE);
  const validEnd = byteOffsetOfUnit(10);

  it("refuses when startByte/endByte are absent", () => {
    expect(spanFor(FIXTURE, {}, map)).toBeNull();
    expect(spanFor(FIXTURE, { startByte: 0 }, map)).toBeNull();
  });

  it("refuses null and undefined offsets", () => {
    expect(spanFor(FIXTURE, { startByte: null, endByte: validEnd }, map)).toBeNull();
    expect(spanFor(FIXTURE, { startByte: 0, endByte: undefined }, map)).toBeNull();
  });

  it("refuses a numeric-STRING offset rather than coercing it", () => {
    expect(spanFor(FIXTURE, { startByte: "0", endByte: validEnd }, map)).toBeNull();
    expect(spanFor(FIXTURE, { startByte: 0, endByte: String(validEnd) }, map)).toBeNull();
  });

  it("refuses NaN", () => {
    expect(spanFor(FIXTURE, { startByte: NaN, endByte: validEnd }, map)).toBeNull();
  });

  it("refuses a non-integer (silently truncated by a naive slice)", () => {
    expect(spanFor(FIXTURE, { startByte: 0.5, endByte: validEnd }, map)).toBeNull();
    expect(spanFor(FIXTURE, { startByte: 0, endByte: validEnd + 0.5 }, map)).toBeNull();
  });

  it("refuses a negative start or end", () => {
    expect(spanFor(FIXTURE, { startByte: -1, endByte: validEnd }, map)).toBeNull();
    expect(spanFor(FIXTURE, { startByte: 0, endByte: -1 }, map)).toBeNull();
  });

  it("refuses start > end (does not silently swap them)", () => {
    expect(spanFor(FIXTURE, { startByte: validEnd, endByte: 0 }, map)).toBeNull();
  });

  it("allows start === end (an insertion point with no extent)", () => {
    const span = spanFor(FIXTURE, { startByte: 0, endByte: 0 }, map);
    expect(span).toEqual({ start: 0, end: 0 });
  });

  it("refuses an offset past the end of the document", () => {
    expect(spanFor(FIXTURE, { startByte: 0, endByte: BYTE_LENGTH + 100 }, map)).toBeNull();
  });

  it("refuses when only ONE of start/end is a real boundary", () => {
    const eByte = byteOffsetOfUnit(UNIT_INDEX_OF("é"));
    expect(spanFor(FIXTURE, { startByte: eByte + 1, endByte: validEnd }, map)).toBeNull();
    expect(spanFor(FIXTURE, { startByte: 0, endByte: eByte + 1 }, map)).toBeNull();
  });

  it("refuses a span reading the camelCase startIndex/endIndex fields by construction", () => {
    // Our contract is startByte/endByte. A source shaped with the OTHER
    // API's field names carries none of those keys, so it is absent -> rule
    // 1 -> refused. No special-casing needed; naming the fields correctly
    // IS the fix for Google's own "new-surface" sample bug (1h R-6.2).
    const camelCaseShaped = { startIndex: 0, endIndex: validEnd };
    expect(spanFor(FIXTURE, camelCaseShaped, map)).toBeNull();
  });

  it("refuses a whole-document span, for what it claims rather than its width", () => {
    const span = spanFor(FIXTURE, { startByte: 0, endByte: BYTE_LENGTH }, map);
    expect(span).toBeNull();
  });

  it("refuses the whole-document span even though it IS a valid pair of boundaries", () => {
    // The point of rule 11: `map.has(0)` and `map.has(BYTE_LENGTH)` are both
    // true, and 0/BYTE_LENGTH resolve to a perfectly well-formed {start,end}
    // pair. It must be refused anyway, because it is indistinguishable from
    // the camelCase defect's `slice(undefined, undefined)` after conversion:
    // `FIXTURE.slice(0, FIXTURE.length) === FIXTURE.slice(undefined, undefined)`.
    expect(map.has(0)).toBe(true);
    expect(map.has(BYTE_LENGTH)).toBe(true);
    expect(FIXTURE.slice(0, FIXTURE.length)).toBe(FIXTURE.slice(undefined, undefined));
    expect(spanFor(FIXTURE, { startByte: 0, endByte: BYTE_LENGTH }, map)).toBeNull();
  });

  it("does not refuse a large span that merely starts after 0 or ends before the very end", () => {
    // Guards against an over-eager whole-document rule that refuses anything
    // wide, rather than specifically start===0 && end===length.
    const span = spanFor(FIXTURE, { startByte: 1 === 0 ? 0 : byteOffsetOfUnit(1), endByte: BYTE_LENGTH }, map);
    expect(span).not.toBeNull();
    const span2 = spanFor(FIXTURE, { startByte: 0, endByte: BYTE_LENGTH - 1 === BYTE_LENGTH ? BYTE_LENGTH : byteOffsetOfUnit(UNIT_LENGTH - 1) }, map);
    expect(span2).not.toBeNull();
  });

  it("rejects a non-object source rather than throwing", () => {
    expect(spanFor(FIXTURE, null, map)).toBeNull();
    expect(spanFor(FIXTURE, undefined, map)).toBeNull();
    expect(spanFor(FIXTURE, "not an object", map)).toBeNull();
    expect(spanFor(FIXTURE, 42, map)).toBeNull();
  });

  it("never throws, whatever it is handed", () => {
    const wild = [null, undefined, {}, [], () => {}, new Date(), NaN, Infinity, -Infinity, "x", Symbol("x")];
    for (const startByte of wild) {
      for (const endByte of wild) {
        expect(() => spanFor(FIXTURE, { startByte, endByte }, map)).not.toThrow();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Lone surrogates and other pathological Unicode -- named in 1h R-6.3 as
// additional hazards the AC's probe reproduces.
// ---------------------------------------------------------------------------

describe("spanFor -- a lone (unpaired) surrogate before the span's end", () => {
  it("refuses a span whose end lies at or after an unpaired surrogate", () => {
    const text = "abc\uD83Ddef"; // 7 UTF-16 units, 9 bytes: "abc"(3) + U+FFFD(3) + "def"(3)
    const map = byteBoundaryMap(text);

    // "abc" alone (ending strictly before the lone surrogate) is unaffected.
    const before = spanFor(text, { startByte: 0, endByte: 3 }, map);
    expect(before).toEqual({ start: 0, end: 3 });

    // A span whose end reaches PAST the surrogate (byte 6, unit 4 --
    // "abc\uD83D") is refused: the byte accounting for this document
    // cannot be attested to match whatever produced the vendor's original
    // offsets once an unpaired surrogate has been crossed.
    expect(spanFor(text, { startByte: 3, endByte: 6 }, map)).toBeNull();
    expect(spanFor(text, { startByte: 0, endByte: 6 }, map)).toBeNull();
  });

  it("does not corrupt the map for text before the unpaired surrogate", () => {
    const text = "abc\uD83Ddef";
    const map = byteBoundaryMap(text);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(1);
    expect(map.get(2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// spanRefusalReason -- the observability half. §0.4's invariant requires the
// pipeline to name WHY a non-zero input became zero usable spans, not merely
// report the zero. This module cannot itself write to the outcome record
// (that is the caller's job, per the plan's §4.4/§6 design), but it exposes
// a stable, named reason for every refusal so the caller is never reduced to
// re-deriving "why" from a bare null.
// ---------------------------------------------------------------------------

describe("spanRefusalReason", () => {
  const map = byteBoundaryMap(FIXTURE);
  const validEnd = byteOffsetOfUnit(10);

  it("returns null when the span is usable", () => {
    expect(spanRefusalReason(FIXTURE, { startByte: 0, endByte: validEnd }, map)).toBeNull();
  });

  it("names each refusal reason distinctly, and every named reason is a refusal", () => {
    const cases = [
      [null, SPAN_REFUSAL.BAD_SHAPE],
      [{}, SPAN_REFUSAL.NON_NUMERIC], // an object missing the fields is a NON_NUMERIC undefined, not a bad shape
      [{ startByte: "0", endByte: validEnd }, SPAN_REFUSAL.NON_NUMERIC],
      [{ startByte: 0.5, endByte: validEnd }, SPAN_REFUSAL.NOT_INTEGER],
      [{ startByte: -1, endByte: validEnd }, SPAN_REFUSAL.NEGATIVE],
      [{ startByte: validEnd, endByte: 0 }, SPAN_REFUSAL.INVERTED],
      // Guaranteed mid-character, unlike an arbitrary "+1": "é" is a real
      // 2-byte character in the fixture, so one byte past its start can
      // never be a boundary.
      [{ startByte: 0, endByte: byteOffsetOfUnit(UNIT_INDEX_OF("é")) + 1 }, SPAN_REFUSAL.NOT_BOUNDARY],
      [{ startByte: 0, endByte: BYTE_LENGTH }, SPAN_REFUSAL.WHOLE_DOCUMENT],
    ];
    for (const [source, expected] of cases) {
      const reason = spanRefusalReason(FIXTURE, source, map);
      expect(reason).toBe(expected);
      // Every named reason must correspond to spanFor actually refusing --
      // the two must never disagree, or the reason is a lie about the span.
      expect(spanFor(FIXTURE, source, map)).toBeNull();
    }
  });

  it("distinguishes an unpaired surrogate as its own reason, not whole-document", () => {
    const text = "abc\uD83Ddef"; // 7 UTF-16 units, 9 bytes: "abc" (3) + U+FFFD (3) + "def" (3)
    const map2 = byteBoundaryMap(text);
    // A span ending right after the lone surrogate ("abc\uD83D", byte 6) --
    // NOT the whole document (byte 9) -- so only the surrogate rule can fire.
    const partialEnd = 6;
    expect(map2.has(partialEnd)).toBe(true);
    expect(partialEnd).not.toBe(new TextEncoder().encode(text).length);
    const reason = spanRefusalReason(text, { startByte: 0, endByte: partialEnd }, map2);
    expect(reason).toBe(SPAN_REFUSAL.UNPAIRED_SURROGATE);
  });

  it("agrees with spanFor on every case in the twelve-rule table above", () => {
    const table = [
      { startByte: null, endByte: validEnd },
      { startByte: 0, endByte: undefined },
      { startByte: NaN, endByte: validEnd },
      { startByte: 0, endByte: -1 },
      { startByte: 0, endByte: 0 },
      { startByte: 0, endByte: validEnd },
    ];
    for (const source of table) {
      const usable = spanFor(FIXTURE, source, map) !== null;
      const reason = spanRefusalReason(FIXTURE, source, map);
      expect(usable).toBe(reason === null);
    }
  });
});

// ---------------------------------------------------------------------------
// The performance case (1h R-5.2 / R-6.3: 0.013 ms per digest, flat in N,
// linear in document size -- and the trap the report names by name: a
// per-offset decode is O(N x doclen) and becomes the slower choice above
// roughly two citations).
// ---------------------------------------------------------------------------

describe("spanFor -- performance on a realistically long digest", () => {
  it("builds the map once and resolves many spans well inside a generous server-side budget", () => {
    // ~14,000 UTF-16 units of realistic non-ASCII company-research prose,
    // repeated -- in 1h's own measurement, comparable in order of magnitude
    // to its 13,918-unit fixture point (0.0646 ms for the byte walk alone).
    const paragraph =
      "Nestlé S.A. is headquartered in Vevey, Switzerland — a lakeside town near Lausanne. " +
      "The group reported organic growth of 2.1% and returned €1.2bn to shareholders in Q3. " +
      "Its Zürich office is hiring 🚀 across supply-chain analytics. ";
    const longDigest = paragraph.repeat(80); // ~13,760 UTF-16 units

    // 40 citations at realistic-ish positions across the document, exactly
    // the upper end 1h benchmarked (0.0130 ms at N=40 on a smaller doc).
    const sources = [];
    for (let i = 1; i <= 40; i++) {
      const unit = Math.floor((longDigest.length * i) / 41);
      const byteEnd = new TextEncoder().encode(longDigest.slice(0, unit)).length;
      sources.push({ startByte: 0, endByte: byteEnd });
    }

    // Run several times and take the MINIMUM, which is the standard way to
    // strip one-off JIT-warmup/scheduler noise out of a micro-benchmark
    // without loosening the bound past the point of meaning anything -- a
    // single sample on a shared CI box can spike for reasons that have
    // nothing to do with this algorithm's complexity class.
    let buildMs = Infinity;
    let queryMs = Infinity;
    let usableCount = 0;
    for (let trial = 0; trial < 5; trial++) {
      const buildStart = performance.now();
      const map = byteBoundaryMap(longDigest);
      buildMs = Math.min(buildMs, performance.now() - buildStart);

      const queryStart = performance.now();
      const results = sources.map((s) => spanFor(longDigest, s, map));
      queryMs = Math.min(queryMs, performance.now() - queryStart);
      usableCount = results.filter((r) => r !== null).length;
    }

    // All (or effectively all) resolve, since these are real character
    // boundaries by construction.
    expect(usableCount).toBeGreaterThan(30);

    // 1h measured ~0.06-0.32 ms for a walk in this size range and ~0.013 ms
    // per digest end to end. This ceiling is deliberately generous (this
    // environment's timer showed several-ms one-off spikes even on a
    // trivial map build) so the assertion stays meaningful rather than
    // flaky, while still sitting nowhere near the O(N x doclen) shape the
    // comparative test below measures directly.
    expect(buildMs).toBeLessThan(30);
    expect(queryMs).toBeLessThan(30);
  });

  it("beats a naive per-offset decode by a wide margin on the same document -- the actual regression this guards against", () => {
    // The trap named explicitly in 1h/§0.5: an implementer who wants "the
    // cost of a single offset" reaches for decoding a fresh byte prefix per
    // citation. That is O(N x doclen). This module's shape -- encode once,
    // O(1) map lookup per query -- must not regress toward it. A RELATIVE
    // comparison on one run of one process is robust to machine speed and
    // CI noise in a way an absolute millisecond ceiling is not.
    const paragraph =
      "Nestlé S.A. is headquartered in Vevey, Switzerland — a lakeside town near Lausanne. " +
      "The group reported organic growth of 2.1% and returned €1.2bn to shareholders in Q3. " +
      "Its Zürich office is hiring 🚀 across supply-chain analytics. ";
    const longDigest = paragraph.repeat(160); // ~27,500 UTF-16 units

    const byteEnds = [];
    for (let i = 1; i <= 40; i++) {
      const unit = Math.floor((longDigest.length * i) / 41);
      byteEnds.push(new TextEncoder().encode(longDigest.slice(0, unit)).length);
    }

    function naiveDecodePrefixEnd(text, byteEnd) {
      // Exactly the anti-pattern named in the module header: decode a fresh
      // byte prefix for every single offset, discarding the work each time.
      const bytes = new TextEncoder().encode(text);
      return new TextDecoder().decode(bytes.subarray(0, byteEnd)).length;
    }

    const REPS = 20;

    const naiveStart = performance.now();
    for (let r = 0; r < REPS; r++) {
      for (const byteEnd of byteEnds) naiveDecodePrefixEnd(longDigest, byteEnd);
    }
    const naiveMs = performance.now() - naiveStart;

    const oursStart = performance.now();
    for (let r = 0; r < REPS; r++) {
      const map = byteBoundaryMap(longDigest);
      for (const byteEnd of byteEnds) spanFor(longDigest, { startByte: 0, endByte: byteEnd }, map);
    }
    const oursMs = performance.now() - oursStart;

    // Not a tight ratio -- just proof the O(1)-per-query shape is
    // meaningfully faster than the O(N x doclen) shape it must not regress
    // into, on the same document, same process, same run.
    expect(oursMs).toBeLessThan(naiveMs);
  });

  it("query cost does not grow with document size the way a per-offset decode would", () => {
    const unit = "É — the same character, thrice, to keep width realistic. ";
    const small = unit.repeat(5); // short document
    const large = unit.repeat(500); // ~100x longer

    const mapSmall = byteBoundaryMap(small);
    const mapLarge = byteBoundaryMap(large);

    const endSmall = new TextEncoder().encode(small.slice(0, Math.floor(small.length / 2))).length;
    const endLarge = new TextEncoder().encode(large.slice(0, Math.floor(large.length / 2))).length;

    // Run each many times and take the total, to smooth out timer noise --
    // the property under test is "does not scale with document length", not
    // "runs faster than N ms once".
    const REPS = 2000;

    const t0 = performance.now();
    for (let i = 0; i < REPS; i++) spanFor(small, { startByte: 0, endByte: endSmall }, mapSmall);
    const smallMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < REPS; i++) spanFor(large, { startByte: 0, endByte: endLarge }, mapLarge);
    const largeMs = performance.now() - t1;

    // A single map lookup is O(1) regardless of document size. Generous
    // multiplier (not a tight ratio assertion) to stay non-flaky on CI while
    // still catching an O(doclen)-per-call regression, which would make
    // largeMs balloon roughly 100x with the document.
    expect(largeMs).toBeLessThan(Math.max(50, smallMs * 10));
  });
});
