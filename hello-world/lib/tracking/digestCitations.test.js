// The falsifier for the single WRITE-time pass.
//
// This module produces three things that go into three different places: the
// markdown column, the sources column, and the citation_outcome column. The
// tests below are organised around the three ways that can go wrong silently,
// because every one of them has already happened once in this repo:
//
//   1. A NARROWING STAGE THAT EATS EVERYTHING AND SAYS NOTHING. The defect
//      this whole chunk exists to fix was "grounding returned chunks and zero
//      citations survived", with both halves computed one line apart and
//      joined nowhere. So the outcome record must carry the count going IN to
//      every stage beside the count coming OUT, the chain must be monotone,
//      and a non-zero input becoming a zero output must be named as an
//      anomaly rather than stored as an ordinary empty. Section 5 and 6.
//
//   2. A CITATION DROPPED WITH NO REASON RECORDED. "Also searched" and
//      "we could not use this at all" mean opposite things about provenance,
//      and the disclosure has to tell them apart. Every refusal below is
//      asserted BOTH as a count and as a named reason. Section 4.
//
//   3. THE RECORD DESCRIBING A DIFFERENT STRING FROM THE ONE STORED. The
//      offsets are computed against one exact string; if anything touches it
//      afterwards every marker points at the wrong sentence. Section 7 pins
//      the stamp to the FINAL markdown and round-trips it through the
//      renderer, which is the only assertion that proves the two modules
//      agree about which string is which.
//
// FIXTURES ARE CONSTRUCTED, NOT OBSERVED. There is no GEMINI_API_KEY in this
// checkout. Every `sources` array below is built to the shape
// `extractCitationSources` documents ({uri, title, startByte, endByte}, byte
// offsets straight off the wire), and every `stageCounts` to the shape
// `interactionStageCounts` documents. None was captured from a live call.

import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../experience/markdown.js";
import { scanCitationResidue, storedMarkdownHasNoLinks } from "./citationResidue.js";
import { markdownStamp, renderCitedMarkdown } from "./renderCitedMarkdown.js";
import {
  CITATION_OUTCOME_VERSION,
  CITATION_STAGES,
  buildCitedDigest,
  citationCountsAnomaly,
  citationCountsViolation,
} from "./digestCitations.js";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const REUTERS = "https://www.reuters.com/business/nestle-q3";
const AP = "https://apnews.com/article/zurich-depots";

const encoder = new TextEncoder();
// The vendor sends BYTE offsets. Building every fixture's offsets this way,
// rather than typing a number, is what makes the non-ASCII cases below a
// measurement instead of an assumption.
const bytesTo = (text, index) => encoder.encode(text.slice(0, index)).length;

const FIRST_SENTENCE = "Nestlé raised €80M in Zürich — a record.";
const NON_ASCII = `${FIRST_SENTENCE} It runs depots.`;

// A digest carrying every residue class the scanner recognises.
const RESIDUE_TEXT =
  "Nimbus raised a Series C. [Report](https://invented.example/x) confirms it. [1]\n\n" +
  "[src]: https://other.example/y\nSee https://bare.example/z too.";

// A digest where residue sits BEFORE a cited passage, so the citation's byte
// offsets have to move when the residue is removed.
const SHIFTED_TEXT =
  "Nimbus raised a Series C. [Report](https://invented.example/x) confirms it. Nestlé grew 4%.";

function build(overrides = {}) {
  const text = overrides.text ?? NON_ASCII;
  const sources = overrides.sources ?? [];
  return buildCitedDigest({
    text,
    sources,
    searched: true,
    truncated: false,
    stageCounts: {
      steps: 3,
      modelOutputSteps: 1,
      textBlocks: 1,
      annotations: sources.length,
    },
    previousOutcome: null,
    ...overrides,
  });
}

function citation(text, { uri, title, from, to }) {
  return { uri, title, startByte: bytesTo(text, from), endByte: bytesTo(text, to) };
}

function linkHrefs(markdown) {
  const out = [];
  const visit = (nodes) => {
    for (const token of nodes || []) {
      if (token.type === "link") out.push(token.href);
      if (Array.isArray(token.children)) visit(token.children);
      if (Array.isArray(token.items)) for (const item of token.items) visit(item.children);
    }
  };
  visit(parseMarkdown(markdown));
  return out;
}

// ---------------------------------------------------------------------------
// 1. The record shape
// ---------------------------------------------------------------------------

describe("buildCitedDigest -- the outcome record", () => {
  it("records the version, the surface and the vendor's own two facts", () => {
    const { outcome } = build({ searched: true, truncated: true });
    expect(outcome.version).toBe(CITATION_OUTCOME_VERSION);
    expect(outcome.surface).toBe("interactions");
    expect(outcome.searched).toBe(true);
    expect(outcome.truncated).toBe(true);
    // NULL is the only honest encoding of "written before the feature
    // existed", so a record this module produces is never the legacy shape.
    expect(outcome.surface).not.toBe("legacy");
  });

  it("does NOT carry a researchedAt of its own — that fact has exactly one home", () => {
    // `application_digests.researched_at` is a real timestamptz column, added
    // by the same migration as `citation_outcome`, and the route writes it. A
    // copy inside the jsonb would be a second home for one fact: two writers,
    // two readers, and no way to tell which is right the first time they
    // disagree. The column wins because SQL wants to filter and order by
    // research recency, and a timestamp buried in jsonb needs a cast at every
    // call site and yields NULL on a typo in the key name.
    //
    // `previous.researchedAt` is NOT a second home: it is a historical
    // snapshot of a generation that no longer exists anywhere else, and the
    // route sources it FROM the column.
    const { outcome } = build();
    expect(Object.prototype.hasOwnProperty.call(outcome, "researchedAt")).toBe(false);
    expect(outcome.researchedAt).toBeUndefined();
  });

  it("carries exactly one generation of history, never a chain", () => {
    const { outcome } = build({
      previousOutcome: {
        counts: { placed: 4 },
        refused: { count: 1 },
        researchedAt: "2026-08-20T09:12:44.001Z",
        previous: { placed: 99, refusedCount: 99, researchedAt: "2026-01-01T00:00:00.000Z" },
      },
    });
    expect(outcome.previous).toEqual({
      placed: 4,
      refusedCount: 1,
      researchedAt: "2026-08-20T09:12:44.001Z",
    });
    // One generation, never a chain: the record must not grow without bound.
    expect(JSON.stringify(outcome.previous)).not.toContain("99");
  });

  it("has no previous generation when there was no previous run", () => {
    expect(build().outcome.previous).toBe(null);
  });

  it("carries no urls, no titles, no spans and no marker numbers", () => {
    const sources = [
      citation(NON_ASCII, { uri: REUTERS, title: "Nestlé posts record quarter", from: 0, to: 40 }),
      citation(NON_ASCII, { uri: AP, title: "Zurich depots expand", from: 41, to: 56 }),
    ];
    const { outcome } = build({ sources });
    const serialised = JSON.stringify(outcome);
    for (const forbidden of ["http", "reuters", "apnews", "Nestlé", "Zurich", "record quarter"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Marker placement on non-ASCII prose -- measured, end to end
// ---------------------------------------------------------------------------

describe("buildCitedDigest -- byte offsets on non-ASCII prose", () => {
  it("converts the vendor's byte offset to the UTF-16 index it actually means", () => {
    const sources = [citation(NON_ASCII, { uri: REUTERS, title: "Nestlé", from: 0, to: 40 })];
    // The two numbers, measured, that a naive `slice(0, endIndex)` conflates.
    expect(sources[0].endByte).toBe(46);
    expect(FIRST_SENTENCE.length).toBe(40);

    const result = build({ sources });
    expect(result.sources[0].start).toBe(0);
    expect(result.sources[0].end).toBe(40);
    // The vendor's byte numbers are never persisted.
    expect(result.sources[0].startByte).toBeUndefined();
    expect(result.sources[0].endByte).toBeUndefined();
  });

  it("places the marker at the sentence boundary, six characters before the naive one", () => {
    const sources = [citation(NON_ASCII, { uri: REUTERS, title: "Nestlé", from: 0, to: 40 })];
    const result = build({ sources });
    const rendered = renderCitedMarkdown(result.markdown, result.sources, result.outcome);

    expect(rendered.markdown).toBe(
      `Nestlé raised €80M in Zürich — a record.[1](${REUTERS}) It runs depots.`
    );
    expect(rendered.markdown.indexOf("[1](")).toBe(40);
    // Where the byte offset would have landed had it been used as an index:
    // inside the word "runs", in the following sentence.
    expect(NON_ASCII.slice(0, 46)).toBe("Nestlé raised €80M in Zürich — a record. It ru");
  });

  it("refuses a byte offset that is not a character boundary rather than rounding it", () => {
    // Byte 6 is the second byte of "é" -- a boundary that does not exist.
    const sources = [{ uri: REUTERS, title: "Nestlé", startByte: 0, endByte: 6 }];
    const result = build({ sources });
    expect(result.sources[0].start).toBeUndefined();
    expect(result.sources[0].end).toBeUndefined();
    expect(result.outcome.refused.spanReasons["not-boundary"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Residue never survives
// ---------------------------------------------------------------------------

describe("buildCitedDigest -- residue", () => {
  it("stores markdown the renderer produces zero link tokens from", () => {
    const { markdown } = build({ text: RESIDUE_TEXT });
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
    expect(linkHrefs(markdown)).toEqual([]);
    expect(markdown).not.toContain("invented.example");
    expect(markdown).not.toContain("http");
    expect(markdown).not.toContain("[1]");
  });

  it("never writes a marker into the stored markdown, on any path", () => {
    const sources = [citation(NON_ASCII, { uri: REUTERS, title: "Nestlé", from: 0, to: 40 })];
    const { markdown } = build({ sources });
    expect(markdown).toBe(NON_ASCII);
    expect(markdown).not.toMatch(/\[\d+\]\(/);
  });

  it("counts DISTINCT residue citations, taken before coalescing", () => {
    const { outcome } = build({ text: RESIDUE_TEXT });
    const scan = scanCitationResidue(RESIDUE_TEXT);
    expect(scan.count).toBe(4);
    expect(outcome.refused.count).toBe(4);
    expect(outcome.refused.reasons).toMatchObject({
      unmatchedMarker: 1,
      referenceDefinition: 1,
      bareUrl: 3,
      modelAuthoredLink: 1,
    });
  });

  it("reports the terminal proof it actually ran", () => {
    expect(build({ text: RESIDUE_TEXT }).outcome.residueClean).toBe(true);
    expect(build({ text: NON_ASCII }).outcome.residueClean).toBe(true);
  });

  it("moves an offset that lands after removed residue, so the marker follows its passage", () => {
    // The cited passage is "confirms it.", which sits AFTER a model-authored
    // link that is about to be deleted. Its byte offsets are over the ORIGINAL
    // text; its stored offsets must be over the SHORTER stored text.
    const to = SHIFTED_TEXT.indexOf("confirms it.") + "confirms it.".length;
    const sources = [citation(SHIFTED_TEXT, { uri: REUTERS, title: "Nimbus", from: 26, to })];
    expect(sources[0].endByte).toBe(75);

    const result = build({ text: SHIFTED_TEXT, sources });
    expect(result.markdown).toBe("Nimbus raised a Series C. confirms it. Nestlé grew 4%.");
    expect(result.sources[0].end).toBe(38);
    expect(result.markdown.slice(0, 38)).toBe("Nimbus raised a Series C. confirms it.");

    const rendered = renderCitedMarkdown(result.markdown, result.sources, result.outcome);
    expect(rendered.markdown).toBe(
      `Nimbus raised a Series C. confirms it.[1](${REUTERS}) Nestlé grew 4%.`
    );
  });

  it("relocates an offset that fell INSIDE removed residue rather than deleting the marker with it", () => {
    // The vendor cited the model's own invented link. The passage is about to
    // be deleted; the citation must survive as an insertion point, not vanish.
    const sources = [citation(SHIFTED_TEXT, { uri: REUTERS, title: "Nimbus", from: 26, to: 50 })];
    const result = build({ text: SHIFTED_TEXT, sources });
    expect(result.sources[0].start).toBe(26);
    expect(result.sources[0].end).toBe(26);
    expect(result.outcome.counts.placed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Every refusal is counted AND reasoned
// ---------------------------------------------------------------------------

describe("buildCitedDigest -- a refused citation is counted and reasoned, never dropped", () => {
  it("keeps a span-refused citation as a source entry with no span", () => {
    const sources = [
      { uri: REUTERS, title: "Nestlé", startByte: 0, endByte: 6 }, // mid-character
      { uri: AP, title: "Zurich", startByte: "0", endByte: "40" }, // jsonb strings
    ];
    const result = build({ sources });

    expect(result.sources).toEqual([
      { url: REUTERS, title: "Nestlé" },
      { url: AP, title: "Zurich" },
    ]);
    expect(result.outcome.refused.reasons.unusableSpan).toBe(2);
    expect(result.outcome.refused.spanReasons).toMatchObject({
      "not-boundary": 1,
      "non-numeric": 1,
    });
  });

  it("names every span refusal class it saw", () => {
    const wholeDoc = encoder.encode(NON_ASCII).length;
    const sources = [
      { uri: REUTERS, title: "a", startByte: 0, endByte: 6 },
      { uri: AP, title: "b", startByte: 0, endByte: wholeDoc },
      { uri: "https://x.example/c", title: "c", startByte: 10, endByte: 4 },
      { uri: "https://x.example/d", title: "d", startByte: -1, endByte: 4 },
      { uri: "https://x.example/e", title: "e", startByte: 1.5, endByte: 4 },
    ];
    const { outcome } = build({ sources });
    expect(outcome.refused.spanReasons).toEqual({
      "not-boundary": 1,
      "whole-document": 1,
      inverted: 1,
      negative: 1,
      "not-integer": 1,
    });
    expect(outcome.refused.reasons.unusableSpan).toBe(5);
  });

  it("counts a url the link control refuses and does NOT store it", () => {
    const sources = [
      { uri: "https://acme.com@evil.example/x", title: "hostile", startByte: 0, endByte: 46 },
      citation(NON_ASCII, { uri: REUTERS, title: "Nestlé", from: 0, to: 40 }),
    ];
    const result = build({ sources });

    expect(result.outcome.refused.reasons.unusableAnnotationUrl).toBe(1);
    expect(result.sources).toHaveLength(1);
    expect(JSON.stringify(result.sources)).not.toContain("evil.example");
    expect(result.outcome.counts.urlsUsable).toBe(1);
  });

  it("counts a digit-adjacent insertion point separately from an unsafe one", () => {
    const text = "Nimbus employs 400 people. Run `npm run build` now.";
    expect(text.slice(0, 18)).toBe("Nimbus employs 400");
    expect(text.slice(0, 37)).toBe("Nimbus employs 400 people. Run `npm r");
    const sources = [
      citation(text, { uri: REUTERS, title: "a", from: 0, to: 18 }),
      citation(text, { uri: AP, title: "b", from: 27, to: 37 }),
    ];
    const { outcome } = build({ text, sources });

    expect(outcome.refused.reasons.digitAdjacent).toBe(1);
    expect(outcome.refused.reasons.unsafeInsertionPoint).toBe(1);
    expect(outcome.counts.spansUsable).toBe(2);
    expect(outcome.counts.splicesSafe).toBe(0);
    expect(outcome.counts.placed).toBe(0);
  });

  it("keeps a splice-refused citation as an entry with no span -- it is 'also searched'", () => {
    const text = "Nimbus employs 400 people.";
    const sources = [citation(text, { uri: REUTERS, title: "a", from: 0, to: 18 })];
    const result = build({ text, sources });
    expect(result.sources).toEqual([{ url: REUTERS, title: "a" }]);
    expect(result.markdown).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// 5. The stage counts and the monotone chain
// ---------------------------------------------------------------------------

describe("buildCitedDigest -- the stage counts", () => {
  it("names its stages in narrowing order", () => {
    expect(CITATION_STAGES).toEqual([
      "annotations",
      "urlsUsable",
      "spansUsable",
      "splicesSafe",
      "placed",
    ]);
  });

  it("records the vendor's raw annotation count, not the count that survived our filtering", () => {
    // Three annotations reached us; one is a file_citation the extractor
    // dropped, one has a hostile url, one is good. `annotations` must still
    // read 3 or the ratio that names the defect is uncomputable.
    const sources = [
      { uri: "https://acme.com@evil.example/x", title: "hostile", startByte: 0, endByte: 46 },
      citation(NON_ASCII, { uri: REUTERS, title: "Nestlé", from: 0, to: 40 }),
    ];
    const { outcome } = build({
      sources,
      stageCounts: { steps: 4, modelOutputSteps: 1, textBlocks: 1, annotations: 3 },
    });
    expect(outcome.counts).toEqual({
      annotations: 3,
      urlsUsable: 1,
      spansUsable: 1,
      splicesSafe: 1,
      placed: 1,
    });
  });

  it("keeps the chain monotone across every fixture in this file", () => {
    const fixtures = [
      build(),
      build({ text: RESIDUE_TEXT }),
      build({
        sources: [citation(NON_ASCII, { uri: REUTERS, title: "a", from: 0, to: 40 })],
      }),
      build({
        sources: [
          { uri: REUTERS, title: "a", startByte: 0, endByte: 6 },
          { uri: "javascript:alert(1)", title: "b", startByte: 0, endByte: 46 },
          citation(NON_ASCII, { uri: AP, title: "c", from: 41, to: 56 }),
        ],
        stageCounts: { steps: 4, modelOutputSteps: 1, textBlocks: 1, annotations: 5 },
      }),
      build({
        text: "Nimbus employs 400 people.",
        sources: [
          citation("Nimbus employs 400 people.", { uri: REUTERS, title: "a", from: 0, to: 18 }),
        ],
      }),
    ];

    for (const { outcome } of fixtures) {
      const c = outcome.counts;
      expect(c.annotations).toBeGreaterThanOrEqual(c.urlsUsable);
      expect(c.urlsUsable).toBeGreaterThanOrEqual(c.spansUsable);
      expect(c.spansUsable).toBeGreaterThanOrEqual(c.splicesSafe);
      expect(c.splicesSafe).toBeGreaterThanOrEqual(c.placed);
      expect(outcome.countsViolation).toBe(null);
    }
  });

  it("makes `placed` equal the number of source elements carrying a span -- the F-2 binding", () => {
    const sources = [
      citation(NON_ASCII, { uri: REUTERS, title: "a", from: 0, to: 40 }),
      citation(NON_ASCII, { uri: AP, title: "b", from: 41, to: 56 }),
      { uri: "https://x.example/c", title: "c", startByte: 0, endByte: 6 },
    ];
    const result = build({ sources });
    const withSpans = result.sources.filter(
      (s) => Number.isInteger(s.start) && Number.isInteger(s.end)
    );
    expect(result.outcome.counts.placed).toBe(withSpans.length);
    expect(result.outcome.counts.placed).toBe(2);
    expect(result.sources).toHaveLength(3);
  });

  it("RECORDS a broken chain rather than repairing it silently", () => {
    // A stageCounts that under-reports is a wiring bug, not an input to
    // clamp. The record has to say so or the invariant is decorative.
    const sources = [
      citation(NON_ASCII, { uri: REUTERS, title: "a", from: 0, to: 40 }),
      citation(NON_ASCII, { uri: AP, title: "b", from: 41, to: 56 }),
    ];
    const { outcome } = build({
      sources,
      stageCounts: { steps: 1, modelOutputSteps: 1, textBlocks: 1, annotations: 0 },
    });
    expect(outcome.counts.annotations).toBe(0);
    expect(outcome.counts.urlsUsable).toBe(2);
    expect(outcome.countsViolation).toEqual(expect.stringContaining("annotations"));
    expect(outcome.countsViolation).toEqual(expect.stringContaining("urlsUsable"));
  });
});

describe("citationCountsViolation", () => {
  it("returns null for a monotone chain", () => {
    expect(
      citationCountsViolation({
        annotations: 11,
        urlsUsable: 10,
        spansUsable: 9,
        splicesSafe: 7,
        placed: 7,
      })
    ).toBe(null);
  });

  it("names the first pair that breaks, at every position in the chain", () => {
    const base = { annotations: 5, urlsUsable: 5, spansUsable: 5, splicesSafe: 5, placed: 5 };
    expect(citationCountsViolation({ ...base, urlsUsable: 6 })).toEqual(
      expect.stringContaining("urlsUsable")
    );
    expect(citationCountsViolation({ ...base, spansUsable: 6 })).toEqual(
      expect.stringContaining("spansUsable")
    );
    expect(citationCountsViolation({ ...base, splicesSafe: 6 })).toEqual(
      expect.stringContaining("splicesSafe")
    );
    expect(citationCountsViolation({ ...base, placed: 6 })).toEqual(
      expect.stringContaining("placed")
    );
  });

  it("treats a missing or non-integer count as a violation, never as a zero", () => {
    const base = { annotations: 5, urlsUsable: 5, spansUsable: 5, splicesSafe: 5, placed: 5 };
    expect(citationCountsViolation({ ...base, spansUsable: undefined })).not.toBe(null);
    expect(citationCountsViolation({ ...base, placed: "5" })).not.toBe(null);
    expect(citationCountsViolation(null)).not.toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 6. The anomaly -- a non-zero input becoming a zero output
// ---------------------------------------------------------------------------

describe("buildCitedDigest -- the reportable anomaly", () => {
  it("is null when the input was also zero", () => {
    const { outcome } = build({
      searched: false,
      stageCounts: { steps: 1, modelOutputSteps: 1, textBlocks: 1, annotations: 0 },
    });
    expect(outcome.counts.annotations).toBe(0);
    expect(outcome.anomaly).toBe(null);
  });

  it("is null on a healthy digest", () => {
    const sources = [citation(NON_ASCII, { uri: REUTERS, title: "a", from: 0, to: 40 })];
    expect(build({ sources }).outcome.anomaly).toBe(null);
  });

  it("names 'extraction' when the model searched and the walk produced nothing", () => {
    // This is the exact shape of the defect the chunk exists to fix, one API
    // surface later: a five-level optional walk yielding [] with no throw.
    const { outcome } = build({
      searched: true,
      stageCounts: { steps: 4, modelOutputSteps: 1, textBlocks: 1, annotations: 0 },
    });
    expect(outcome.anomaly).toEqual({
      stage: "extraction",
      from: "searched",
      to: "annotations",
      inputCount: 1,
      outputCount: 0,
    });
  });

  it("names 'url-control' when every annotation carried an unusable url", () => {
    const sources = [
      { uri: "javascript:alert(1)", title: "a", startByte: 0, endByte: 46 },
      { uri: "https://", title: "b", startByte: 0, endByte: 46 },
    ];
    const { outcome } = build({ sources });
    expect(outcome.anomaly).toEqual({
      stage: "url-control",
      from: "annotations",
      to: "urlsUsable",
      inputCount: 2,
      outputCount: 0,
    });
  });

  it("names 'span-conversion' when every span was refused", () => {
    const sources = [
      { uri: REUTERS, title: "a", startByte: 0, endByte: 6 },
      { uri: AP, title: "b", startByte: "0", endByte: "40" },
      { uri: "https://x.example/c", title: "c", startByte: 10, endByte: 4 },
    ];
    const { outcome } = build({ sources });
    expect(outcome.anomaly).toEqual({
      stage: "span-conversion",
      from: "urlsUsable",
      to: "spansUsable",
      inputCount: 3,
      outputCount: 0,
    });
    // And the reason each one died is recorded beside the anomaly.
    expect(outcome.refused.spanReasons).toEqual({
      "not-boundary": 1,
      "non-numeric": 1,
      inverted: 1,
    });
  });

  it("names 'insertion-safety' when every usable span was an unsafe place to splice", () => {
    const text = "Nimbus employs 400 people. It grew.";
    const sources = [citation(text, { uri: REUTERS, title: "a", from: 0, to: 18 })];
    const { outcome } = build({ text, sources });
    expect(outcome.anomaly).toEqual({
      stage: "insertion-safety",
      from: "spansUsable",
      to: "splicesSafe",
      inputCount: 1,
      outputCount: 0,
    });
  });

  it("reports the FIRST stage that ate everything, not the last", () => {
    const sources = [
      { uri: "javascript:alert(1)", title: "a", startByte: 0, endByte: 46 },
      { uri: "javascript:alert(2)", title: "b", startByte: 0, endByte: 46 },
    ];
    const { outcome } = build({ sources });
    // urlsUsable, spansUsable, splicesSafe and placed are ALL zero here. Only
    // the first transition is the anomaly; the rest are honest zeros.
    expect(outcome.anomaly.stage).toBe("url-control");
  });
});

describe("citationCountsAnomaly", () => {
  it("is a pure function of the counts, so the route can log the same verdict", () => {
    expect(
      citationCountsAnomaly({
        searched: true,
        counts: { annotations: 11, urlsUsable: 0, spansUsable: 0, splicesSafe: 0, placed: 0 },
      })
    ).toEqual({
      stage: "url-control",
      from: "annotations",
      to: "urlsUsable",
      inputCount: 11,
      outputCount: 0,
    });
  });

  it("does not fire when the output is merely smaller, only when it is zero", () => {
    expect(
      citationCountsAnomaly({
        searched: true,
        counts: { annotations: 11, urlsUsable: 10, spansUsable: 9, splicesSafe: 7, placed: 7 },
      })
    ).toBe(null);
  });

  it("does not fire for a model that never searched", () => {
    expect(
      citationCountsAnomaly({
        searched: false,
        counts: { annotations: 0, urlsUsable: 0, spansUsable: 0, splicesSafe: 0, placed: 0 },
      })
    ).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 7. The stamp binds the record to the string that was actually stored
// ---------------------------------------------------------------------------

describe("buildCitedDigest -- the stamp", () => {
  it("stamps the FINAL markdown, after residue removal, not the model's raw text", () => {
    const { markdown, outcome } = build({ text: RESIDUE_TEXT });
    expect(markdown).not.toBe(RESIDUE_TEXT);
    expect(outcome.len).toBe(markdown.length);
    expect(outcome.hash).toBe(markdownStamp(markdown).hash);
    expect(outcome.hash).not.toBe(markdownStamp(RESIDUE_TEXT).hash);
  });

  it("round-trips: what this module writes is what the renderer accepts", () => {
    const sources = [
      citation(NON_ASCII, { uri: REUTERS, title: "a", from: 0, to: 40 }),
      citation(NON_ASCII, { uri: AP, title: "b", from: 41, to: 56 }),
    ];
    const result = build({ sources });
    const rendered = renderCitedMarkdown(result.markdown, result.sources, result.outcome);

    expect(rendered.bindingFailure).toBe(null);
    expect(rendered.stampOk).toBe(true);
    expect(rendered.emitted).toHaveLength(result.outcome.counts.placed);
    expect(rendered.markdown).toBe(
      `Nestlé raised €80M in Zürich — a record.[1](${REUTERS}) It runs depots.[2](${AP})`
    );
  });

  it("makes the one-run-old sources column detectable at render", () => {
    // Two runs. The second write lands `markdown` and `citation_outcome` and
    // silently keeps the FIRST run's `sources` -- the reachable failure the
    // field whitelist allows. The stamp alone cannot see it, because the stamp
    // describes the markdown and the markdown IS current.
    const firstText = "Nimbus raised $80M. It runs depots. Revenue grew.";
    const first = build({
      text: firstText,
      sources: [
        citation(firstText, { uri: REUTERS, title: "a", from: 0, to: 19 }),
        citation(firstText, { uri: AP, title: "b", from: 20, to: 35 }),
      ],
    });
    expect(first.outcome.counts.placed).toBe(2);

    const second = build({
      sources: [citation(NON_ASCII, { uri: REUTERS, title: "a", from: 0, to: 40 })],
    });
    expect(second.outcome.counts.placed).toBe(1);

    // The row as it would then read: current markdown, current outcome, stale
    // sources.
    const rendered = renderCitedMarkdown(second.markdown, first.sources, second.outcome);
    expect(rendered.markdown).toBe(second.markdown);
    expect(rendered.emitted).toEqual([]);
    expect(rendered.bindingFailure).toBe("span-count");
  });
});

// ---------------------------------------------------------------------------
// 8. Totality
// ---------------------------------------------------------------------------

describe("buildCitedDigest -- totality", () => {
  it("does not throw on a malformed sources array", () => {
    const result = build({ sources: [null, 7, "x", {}, { uri: REUTERS }] });
    expect(result.markdown).toBe(NON_ASCII);
    expect(result.outcome.counts.placed).toBe(0);
    expect(result.sources.every((s) => typeof s.url === "string")).toBe(true);
  });

  it("does not throw on a non-string text", () => {
    for (const bad of [null, undefined, 7, {}]) {
      const result = build({ text: bad, sources: [] });
      expect(result.markdown).toBe("");
      expect(result.sources).toEqual([]);
      expect(result.outcome.counts.placed).toBe(0);
    }
  });

  it("does not throw when stageCounts is missing entirely", () => {
    const sources = [citation(NON_ASCII, { uri: REUTERS, title: "a", from: 0, to: 40 })];
    const { outcome } = build({ sources, stageCounts: undefined });
    expect(outcome.counts.annotations).toBe(1);
    expect(outcome.countsViolation).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 9. The chain engine moved out; the VOCABULARY did not
// ---------------------------------------------------------------------------
//
// The monotone-chain engine these two functions used to hold privately now
// lives in lib/tracking/stageCounts.js, parameterised by a stage list, because
// a second feature needing a chain had no way to reuse it and would have
// hand-copied it -- a second recogniser, the exact defect this area exists to
// close.
//
// Every string and every field below is DATA ALREADY IN THE DATABASE:
// `citation_outcome.countsViolation` and `citation_outcome.anomaly` are stored
// verbatim on application_digests rows, and app/api/application-digest/route.js
// logs the same verdict. The sections above assert these with
// `stringContaining` and `not.toBe(null)`, which is enough to prove a violation
// was detected and NOT enough to prove the sentence is unchanged -- so an
// extraction could rewrite every message and leave this file green.
//
// These cases exist for exactly that gap. They were written and run GREEN
// against the pre-extraction implementation, so they are a characterisation
// pin, not a red-first specification: their whole job is to fail if the
// refactor changed a byte of the published vocabulary.

describe("citationCountsViolation -- the exact published sentences", () => {
  it("keeps the 'citation' label on the not-an-object sentence", () => {
    expect(citationCountsViolation(null)).toBe("citation counts are missing or not an object");
    expect(citationCountsViolation(undefined)).toBe("citation counts are missing or not an object");
    expect(citationCountsViolation([1, 2])).toBe("citation counts are missing or not an object");
    expect(citationCountsViolation("nine")).toBe("citation counts are missing or not an object");
  });

  it("keeps the exact wording of the non-negative-integer sentence", () => {
    const base = { annotations: 5, urlsUsable: 5, spansUsable: 5, splicesSafe: 5, placed: 5 };
    expect(citationCountsViolation({ ...base, spansUsable: undefined })).toBe(
      "spansUsable is not a non-negative integer"
    );
    expect(citationCountsViolation({ ...base, placed: "5" })).toBe(
      "placed is not a non-negative integer"
    );
  });

  it("keeps the exact wording of the exceeds sentence, with both numbers", () => {
    const base = { annotations: 5, urlsUsable: 5, spansUsable: 5, splicesSafe: 5, placed: 5 };
    expect(citationCountsViolation({ ...base, urlsUsable: 6 })).toBe(
      "urlsUsable (6) exceeds annotations (5)"
    );
    expect(citationCountsViolation({ ...base, placed: 6 })).toBe(
      "placed (6) exceeds splicesSafe (5)"
    );
  });
});

describe("citationCountsAnomaly -- the exact published record", () => {
  it("keeps the boolean `searched` head of the chain, valued as one or zero", () => {
    // `searched` is not a count and does not live in `counts`. The extraction
    // must keep reading it off the record, or a model that searched and
    // produced no annotations reports no anomaly -- the original defect.
    expect(
      citationCountsAnomaly({
        searched: true,
        counts: { annotations: 0, urlsUsable: 0, spansUsable: 0, splicesSafe: 0, placed: 0 },
      })
    ).toEqual({
      stage: "extraction",
      from: "searched",
      to: "annotations",
      inputCount: 1,
      outputCount: 0,
    });
  });

  it("keeps every process-stage name, at every position in the chain", () => {
    const zeroed = { annotations: 0, urlsUsable: 0, spansUsable: 0, splicesSafe: 0, placed: 0 };
    const at = (counts) => citationCountsAnomaly({ searched: true, counts })?.stage;
    expect(at({ ...zeroed, annotations: 3 })).toBe("url-control");
    expect(at({ ...zeroed, annotations: 3, urlsUsable: 3 })).toBe("span-conversion");
    expect(at({ ...zeroed, annotations: 3, urlsUsable: 3, spansUsable: 3 })).toBe(
      "insertion-safety"
    );
    expect(at({ ...zeroed, annotations: 3, urlsUsable: 3, spansUsable: 3, splicesSafe: 3 })).toBe(
      "placement"
    );
  });

  it("keeps its own field names and reports the first breach only", () => {
    expect(
      citationCountsAnomaly({
        searched: true,
        counts: { annotations: 4, urlsUsable: 0, spansUsable: 0, splicesSafe: 0, placed: 0 },
      })
    ).toEqual({
      stage: "url-control",
      from: "annotations",
      to: "urlsUsable",
      inputCount: 4,
      outputCount: 0,
    });
  });

  it("still tolerates a missing or malformed record, and keeps what each one means", () => {
    // No record, or no `searched`, is a chain whose head is zero: a normal
    // empty, not an anomaly.
    expect(citationCountsAnomaly(undefined)).toBe(null);
    expect(citationCountsAnomaly(null)).toBe(null);
    expect(citationCountsAnomaly({})).toBe(null);
    expect(citationCountsAnomaly({ searched: false, counts: "nine" })).toBe(null);

    // But `searched: true` with counts we cannot read is NOT a normal empty --
    // the model searched and this record can account for nothing, which is the
    // original defect wearing a different hat. It must still name `extraction`.
    for (const counts of [null, undefined, "nine", [1, 2]]) {
      expect(citationCountsAnomaly({ searched: true, counts })?.stage).toBe("extraction");
    }
  });

  it("does not mutate the record or its counts", () => {
    const record = { searched: true, counts: { annotations: 4, urlsUsable: 0 } };
    citationCountsAnomaly(record);
    expect(record).toEqual({ searched: true, counts: { annotations: 4, urlsUsable: 0 } });
    expect(Object.keys(record.counts)).toEqual(["annotations", "urlsUsable"]);
  });
});
