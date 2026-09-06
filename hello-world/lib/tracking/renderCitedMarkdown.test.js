// The falsifier for the single render-time splice.
//
// WHAT THIS FILE HAS TO DISCRIMINATE, and why the obvious assertions do not.
//
// Three plausible-wrong implementations of this module pass a naive suite:
//
//   (A) one that drops a refused citation SILENTLY -- no marker, no count.
//       Every "the markdown is right" assertion still passes; the digest
//       simply shows fewer footnotes than it had citations, which is the
//       exact defect this whole feature exists to make loud. Only an
//       assertion on `refused` can see it.
//   (B) one whose counts are computed AFTER filtering rather than before,
//       so `placed` is trivially equal to whatever survived and the F-2
//       binding can never fail. Only a case that hands it a placed count
//       DISAGREEING with the sources array can see it.
//   (C) one that splices by string search (`indexOf` of the cited passage)
//       instead of at the resolved offset. On ASCII prose it is
//       indistinguishable; on a repeated passage, or on the non-ASCII
//       company-research prose this feature actually renders, it lands
//       somewhere else entirely. Only a fixture with non-ASCII text and an
//       independently measured expected position can see it.
//
// So every group below carries at least one assertion aimed at one of those
// three, and the mutation run recorded in the chunk's report reports how many
// assertions each one turns red.
//
// FIXTURES ARE CONSTRUCTED, NOT OBSERVED. There is no GEMINI_API_KEY in this
// checkout, so no live Interaction was available. The stored-row shapes below
// are built from the documented `application_digests` column shapes
// (`markdown` text, `sources` jsonb of {url,title,start,end},
// `citation_outcome` jsonb) and from lib/tracking/digestCitations.js's own
// output contract, not from a captured response.

import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../experience/markdown.js";
import {
  CITATION_BINDING,
  CITATION_OUTCOME_VERSION,
  markdownStamp,
  renderCitedMarkdown,
} from "./renderCitedMarkdown.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REUTERS = "https://www.reuters.com/business/nestle-q3";
const AP = "https://apnews.com/article/zurich-depots";

// One character of every UTF-8 width class routine in company-research prose:
// an accented letter (2 bytes), a currency sign (3), an em dash (3). The
// divergence between the byte offsets the vendor sends and the UTF-16 indices
// `slice` uses is what mutant (C) cannot survive.
const FIRST_SENTENCE = "Nestlé raised €80M in Zürich — a record.";
const NON_ASCII = `${FIRST_SENTENCE} It runs depots.`;

const encoder = new TextEncoder();
const byteLength = (s) => encoder.encode(s).length;

// The three same-length edits a length-only stamp is measured to miss: a word
// swapped for a same-length word, a case flip, and a space replaced by a
// non-breaking space. The last one is written as an escape on purpose -- as a
// literal it is invisible in a diff, which is exactly why it is the edit a
// length check must not be trusted to catch.
const SAME_LENGTH_EDITS = [
  (s) => s.replace("runs", "owns"),
  (s) => s.replace("depots", "Depots"),
  (s) => s.replace("It runs", "It runs"),
  (s) => s.replace("€80M", "€80m"),
];

function sourcesWithSpans(...entries) {
  return entries.map(({ url, title, start, end }) => {
    const element = { url, title };
    if (start !== undefined) element.start = start;
    if (end !== undefined) element.end = end;
    return element;
  });
}

// Builds the outcome record a correct write pass would have produced for
// exactly this (markdown, sources) pair. Every binding test below works by
// corrupting ONE field of this record and asserting the renderer refuses.
function outcomeFor(markdown, sources, overrides = {}) {
  const { len, hash } = markdownStamp(markdown);
  const placed = sources.filter(
    (s) => Number.isInteger(s.start) && Number.isInteger(s.end)
  ).length;
  return {
    version: CITATION_OUTCOME_VERSION,
    surface: "interactions",
    searched: true,
    truncated: false,
    residueClean: true,
    counts: {
      annotations: sources.length,
      urlsUsable: sources.length,
      spansUsable: placed,
      splicesSafe: placed,
      placed,
    },
    len,
    hash,
    ...overrides,
  };
}

const NO_REFUSALS = {
  unsafeInsertionPoint: 0,
  digitAdjacent: 0,
  unusableSpan: 0,
  unusableUrl: 0,
};

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
// 1. Marker placement on non-ASCII prose -- the measured positions
// ---------------------------------------------------------------------------

describe("renderCitedMarkdown -- marker placement on non-ASCII prose", () => {
  it("measures the divergence the whole conversion exists to close", () => {
    // These two numbers are what the feature turns on. They are asserted
    // rather than assumed so that a fixture edit cannot quietly make the
    // placement test tautological.
    expect(FIRST_SENTENCE.length).toBe(40); // UTF-16 code units
    expect(byteLength(FIRST_SENTENCE)).toBe(46); // UTF-8 bytes
    // Where a byte offset used as a UTF-16 index actually lands: six
    // characters into the NEXT sentence, mid-word.
    expect(NON_ASCII.slice(0, byteLength(FIRST_SENTENCE))).toBe(
      "Nestlé raised €80M in Zürich — a record. It ru"
    );
  });

  it("splices the marker at the resolved UTF-16 offset, not at a byte offset", () => {
    const sources = sourcesWithSpans({
      url: REUTERS,
      title: "Nestlé Q3",
      start: 0,
      end: 40,
    });
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));

    expect(result.stampOk).toBe(true);
    expect(result.bindingFailure).toBe(null);
    expect(result.markdown).toBe(
      `Nestlé raised €80M in Zürich — a record.[1](${REUTERS}) It runs depots.`
    );
    // The position, measured off the produced string rather than assumed.
    expect(result.markdown.indexOf("[1](")).toBe(40);
    expect(result.refused).toEqual(NO_REFUSALS);
  });

  it("places two markers on non-ASCII prose without cumulative drift", () => {
    const sources = sourcesWithSpans(
      { url: REUTERS, title: "Nestlé Q3", start: 0, end: 40 },
      { url: AP, title: "Zurich depots", start: 41, end: 56 }
    );
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));

    expect(result.markdown).toBe(
      `Nestlé raised €80M in Zürich — a record.[1](${REUTERS}) It runs depots.[2](${AP})`
    );
    // The second marker is at the END of the document. A per-character or
    // per-byte drift of even one unit moves it inside "depots.".
    expect(result.markdown.endsWith(`depots.[2](${AP})`)).toBe(true);
    expect(result.emitted.map((e) => e.n)).toEqual([1, 2]);
  });

  it("marks the passage the offset names, not the first passage that reads the same", () => {
    // Added after the mutation run: an implementation that re-finds the cited
    // passage with `indexOf` instead of using the resolved offset produces the
    // identical string on every fixture above, because every passage in them
    // is unique. A digest that repeats a sentence -- routine, since a company
    // digest restates the company name in section after section -- separates
    // them, and it separates them by attributing the wrong sentence.
    const prose = "Nimbus grew. Nimbus grew. It runs.";
    expect(prose.slice(13, 25)).toBe("Nimbus grew.");
    expect(prose.indexOf("Nimbus grew.")).toBe(0); // the decoy

    const sources = sourcesWithSpans({ url: REUTERS, title: "second", start: 13, end: 25 });
    const result = renderCitedMarkdown(prose, sources, outcomeFor(prose, sources));
    expect(result.markdown).toBe(`Nimbus grew. Nimbus grew.[1](${REUTERS}) It runs.`);
    expect(result.markdown.indexOf("[1](")).toBe(25);
  });

  it("honours an empty span as an insertion point with no extent", () => {
    // `start === end` is explicitly allowed: it names a point, not a passage.
    // An implementation that searches for the cited text has nothing to search
    // for and lands at index 0.
    const prose = "Nimbus grew. It runs.";
    const sources = sourcesWithSpans({ url: REUTERS, title: "point", start: 12, end: 12 });
    const result = renderCitedMarkdown(prose, sources, outcomeFor(prose, sources));
    expect(result.markdown).toBe(`Nimbus grew.[1](${REUTERS}) It runs.`);
    expect(result.markdown.startsWith("Nimbus")).toBe(true);
  });

  it("renders the digits as the only visible text, with the vendor url verbatim", () => {
    const sources = sourcesWithSpans({ url: REUTERS, title: "Nestlé Q3", start: 0, end: 40 });
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));
    expect(linkHrefs(result.markdown)).toEqual([REUTERS]);
  });
});

// ---------------------------------------------------------------------------
// 2. The stamp -- AC-F30 / A-R2
// ---------------------------------------------------------------------------

describe("renderCitedMarkdown -- the stamp binds the record to the markdown", () => {
  const sources = sourcesWithSpans({ url: REUTERS, title: "Nestlé Q3", start: 0, end: 40 });

  it("accepts the string it was stamped over", () => {
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));
    expect(result.stampOk).toBe(true);
    expect(result.emitted).toHaveLength(1);
  });

  it("proves the hash is the load-bearing half: a same-length word swap is invisible to len", () => {
    const edited = NON_ASCII.replace("runs", "owns");
    expect(edited).not.toBe(NON_ASCII);
    expect(markdownStamp(edited).len).toBe(markdownStamp(NON_ASCII).len);
    expect(markdownStamp(edited).hash).not.toBe(markdownStamp(NON_ASCII).hash);
  });

  it("refuses ALL spans when the markdown was copy-edited to the same length", () => {
    const edited = NON_ASCII.replace("runs", "owns");
    const result = renderCitedMarkdown(edited, sources, outcomeFor(NON_ASCII, sources));

    expect(result.markdown).toBe(edited); // byte-identical to the input
    expect(result.emitted).toEqual([]);
    expect(result.stampOk).toBe(false);
    expect(result.bindingFailure).toBe(CITATION_BINDING.STAMP);
  });

  it("refuses ALL spans when the markdown changed length", () => {
    const edited = `# Nimbus\n\n${NON_ASCII}`;
    const result = renderCitedMarkdown(edited, sources, outcomeFor(NON_ASCII, sources));
    expect(result.markdown).toBe(edited);
    expect(result.emitted).toEqual([]);
    expect(result.bindingFailure).toBe(CITATION_BINDING.STAMP);
  });

  it("also catches a case flip and a non-breaking space -- the other length-invisible edits", () => {
    for (const edit of SAME_LENGTH_EDITS) {
      const edited = edit(NON_ASCII);
      expect(edited).not.toBe(NON_ASCII);
      const result = renderCitedMarkdown(edited, sources, outcomeFor(NON_ASCII, sources));
      expect(markdownStamp(edited).len).toBe(markdownStamp(NON_ASCII).len);
      expect(result.markdown).toBe(edited);
      expect(result.bindingFailure).toBe(CITATION_BINDING.STAMP);
    }
  });

  it("refuses everything when there is no outcome record at all", () => {
    for (const outcome of [null, undefined, "{}", 7, []]) {
      const result = renderCitedMarkdown(NON_ASCII, sources, outcome);
      expect(result.markdown).toBe(NON_ASCII);
      expect(result.emitted).toEqual([]);
      expect(result.stampOk).toBe(false);
      expect(result.bindingFailure).toBe(CITATION_BINDING.NO_OUTCOME);
    }
  });

  it("never guesses at an unrecognised version", () => {
    const result = renderCitedMarkdown(
      NON_ASCII,
      sources,
      outcomeFor(NON_ASCII, sources, { version: CITATION_OUTCOME_VERSION + 1 })
    );
    expect(result.markdown).toBe(NON_ASCII);
    expect(result.emitted).toEqual([]);
    expect(result.bindingFailure).toBe(CITATION_BINDING.VERSION);
  });

  it("refuses everything when the write path could not prove the residue was gone", () => {
    const result = renderCitedMarkdown(
      NON_ASCII,
      sources,
      outcomeFor(NON_ASCII, sources, { residueClean: false })
    );
    expect(result.markdown).toBe(NON_ASCII);
    expect(result.emitted).toEqual([]);
    expect(result.bindingFailure).toBe(CITATION_BINDING.RESIDUE);
  });
});

// ---------------------------------------------------------------------------
// 3. The F-2 binding -- the spans live in a DIFFERENT column
// ---------------------------------------------------------------------------

describe("renderCitedMarkdown -- the outcome record binds the SPANS, not only the markdown", () => {
  // The reachable failure, stated as the fixture builds it: `upsertDigest`
  // gates each field independently, so one write can land `markdown` and
  // `citation_outcome` while `sources` keeps the PREVIOUS run's value. New
  // markdown, a stamp that matches it, and one-run-old spans. The stamp alone
  // passes. Only the count comparison sees it.
  const LAST_RUN = "Nimbus raised $80M. It runs depots. Revenue grew.";
  const THIS_RUN = NON_ASCII;

  it("refuses all spans when the record claims more placed citations than sources carries", () => {
    const staleSources = sourcesWithSpans(
      { url: REUTERS, title: "Nimbus", start: 0, end: 19 } // an offset into LAST_RUN
    );
    expect(LAST_RUN.slice(0, 19)).toBe("Nimbus raised $80M.");

    // The record is CURRENT: stamped over THIS_RUN, and it says two
    // citations were placed. The sources column is one run old.
    const outcome = outcomeFor(THIS_RUN, staleSources, {
      counts: {
        annotations: 2,
        urlsUsable: 2,
        spansUsable: 2,
        splicesSafe: 2,
        placed: 2,
      },
    });

    const result = renderCitedMarkdown(THIS_RUN, staleSources, outcome);
    expect(result.stampOk).toBe(false);
    expect(result.bindingFailure).toBe(CITATION_BINDING.SPAN_COUNT);
    expect(result.markdown).toBe(THIS_RUN); // byte-identical
    expect(result.emitted).toEqual([]);
  });

  it("refuses all spans when the stale spans no longer address this markdown", () => {
    // Same count, so a naive `placed === sources.length` check passes. The
    // spans are out of range for the shorter current markdown, so the number
    // of USABLE spans is 0 and the comparison still fires.
    const staleSources = sourcesWithSpans({
      url: REUTERS,
      title: "Nimbus",
      start: 400,
      end: 420,
    });
    const outcome = outcomeFor(THIS_RUN, staleSources, {
      counts: {
        annotations: 1,
        urlsUsable: 1,
        spansUsable: 1,
        splicesSafe: 1,
        placed: 1,
      },
    });
    const result = renderCitedMarkdown(THIS_RUN, staleSources, outcome);
    expect(result.bindingFailure).toBe(CITATION_BINDING.SPAN_COUNT);
    expect(result.markdown).toBe(THIS_RUN);
    expect(result.emitted).toEqual([]);
  });

  it("refuses all spans when the record's placed count is absent or not an integer", () => {
    const sources = sourcesWithSpans({ url: REUTERS, title: "Nestlé Q3", start: 0, end: 40 });
    for (const placed of [undefined, null, "1", 1.5, -1]) {
      const outcome = outcomeFor(NON_ASCII, sources, {
        counts: { annotations: 1, urlsUsable: 1, spansUsable: 1, splicesSafe: 1, placed },
      });
      const result = renderCitedMarkdown(NON_ASCII, sources, outcome);
      expect(result.markdown).toBe(NON_ASCII);
      expect(result.bindingFailure).toBe(CITATION_BINDING.SPAN_COUNT);
    }
  });

  it("accepts a record whose placed count matches the spans it describes", () => {
    const sources = sourcesWithSpans(
      { url: REUTERS, title: "Nestlé Q3", start: 0, end: 40 },
      { url: AP, title: "Also searched" } // no span: an AC-F13(e) entry
    );
    const outcome = outcomeFor(NON_ASCII, sources, {
      counts: { annotations: 2, urlsUsable: 2, spansUsable: 1, splicesSafe: 1, placed: 1 },
    });
    const result = renderCitedMarkdown(NON_ASCII, sources, outcome);
    expect(result.bindingFailure).toBe(null);
    expect(result.emitted).toHaveLength(1);
    // The span-less entry is neither placed nor counted as a refusal: it was
    // already accounted for at write time.
    expect(result.refused).toEqual(NO_REFUSALS);
  });
});

// ---------------------------------------------------------------------------
// 4. Every refusal is COUNTED, never silent
// ---------------------------------------------------------------------------

describe("renderCitedMarkdown -- a refused citation is counted and reasoned", () => {
  it("counts a url the link control refuses, and still renders the other marker", () => {
    const sources = sourcesWithSpans(
      { url: "https://acme.com@evil.example/x", title: "Nimbus", start: 0, end: 40 },
      { url: AP, title: "Zurich depots", start: 41, end: 56 }
    );
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));

    expect(result.refused.unusableUrl).toBe(1);
    expect(result.emitted).toHaveLength(1);
    expect(linkHrefs(result.markdown)).toEqual([AP]);
    // The refused url never reaches the rendered string in any form.
    expect(result.markdown).not.toContain("evil.example");
  });

  it("counts a url whose parenthesis would silently rewrite the href", () => {
    const wiki = "https://en.wikipedia.org/wiki/Nimbus_(company)";
    const sources = sourcesWithSpans({ url: wiki, title: "Nimbus", start: 0, end: 40 });
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));
    expect(result.refused.unusableUrl).toBe(1);
    expect(result.markdown).toBe(NON_ASCII);
    // Never re-encoded: a url we rewrote is not the url we were given.
    expect(result.markdown).not.toContain("%28");
  });

  it("counts a digit-adjacent insertion point rather than nudging it", () => {
    const digits = "Nimbus employs 400 people.";
    const sources = sourcesWithSpans({ url: REUTERS, title: "Nimbus", start: 0, end: 18 });
    expect(digits.slice(0, 18)).toBe("Nimbus employs 400");

    const result = renderCitedMarkdown(digits, sources, outcomeFor(digits, sources));
    expect(result.refused.digitAdjacent).toBe(1);
    expect(result.markdown).toBe(digits);
    expect(result.markdown).not.toContain("4001");
    expect(result.emitted).toEqual([]);
  });

  it("counts an unsafe insertion point rather than emitting a raw url into the prose", () => {
    const code = "Run `npm run build` now. Nimbus grew.";
    const sources = sourcesWithSpans({ url: REUTERS, title: "Nimbus", start: 0, end: 10 });
    expect(code.slice(0, 10)).toBe("Run `npm r");

    const result = renderCitedMarkdown(code, sources, outcomeFor(code, sources));
    expect(result.refused.unsafeInsertionPoint).toBe(1);
    expect(result.markdown).toBe(code);
    expect(result.markdown).not.toContain("reuters.com");
    expect(result.emitted).toEqual([]);
  });

  it("counts an element that CLAIMS a span the markdown cannot honour", () => {
    const sources = sourcesWithSpans(
      { url: REUTERS, title: "Nestlé Q3", start: 0, end: 40 },
      { url: AP, title: "Zurich depots", start: 41, end: 9000 }
    );
    const outcome = outcomeFor(NON_ASCII, sources, {
      counts: { annotations: 2, urlsUsable: 2, spansUsable: 1, splicesSafe: 1, placed: 1 },
    });
    const result = renderCitedMarkdown(NON_ASCII, sources, outcome);
    expect(result.refused.unusableSpan).toBe(1);
    expect(result.emitted).toHaveLength(1);
  });

  it("reports every refusal class on one digest, so the disclosure can tell them apart", () => {
    const prose = "Nimbus employs 400 people. Run `npm run build` now. It grew.";
    expect(prose.slice(0, 26)).toBe("Nimbus employs 400 people.");
    const sources = sourcesWithSpans(
      { url: REUTERS, title: "digit", start: 0, end: 18 }, // digit adjacent
      { url: AP, title: "code", start: 27, end: 37 }, // inside inline code
      { url: "javascript:alert(1)", title: "bad url", start: 0, end: 26 },
      { url: "https://example.com/ok", title: "bad span", start: 0, end: 9000 }
    );
    const outcome = outcomeFor(prose, sources, {
      counts: { annotations: 4, urlsUsable: 3, spansUsable: 3, splicesSafe: 0, placed: 3 },
    });
    const result = renderCitedMarkdown(prose, sources, outcome);
    expect(result.refused).toEqual({
      unsafeInsertionPoint: 1,
      digitAdjacent: 1,
      unusableSpan: 1,
      unusableUrl: 1,
    });
    // Total: nothing was placed, so the stored prose comes back untouched.
    expect(result.markdown).toBe(prose);
  });
});

// ---------------------------------------------------------------------------
// 5. Numbering
// ---------------------------------------------------------------------------

describe("renderCitedMarkdown -- numbering", () => {
  it("numbers by insertion point, not by array order", () => {
    const sources = sourcesWithSpans(
      { url: AP, title: "second sentence", start: 41, end: 56 },
      { url: REUTERS, title: "first sentence", start: 0, end: 40 }
    );
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));
    expect(result.markdown).toBe(
      `Nestlé raised €80M in Zürich — a record.[1](${REUTERS}) It runs depots.[2](${AP})`
    );
    expect(result.emitted.map((e) => [e.n, e.href])).toEqual([
      [1, REUTERS],
      [2, AP],
    ]);
  });

  it("gives one number to one page, however many passages cite it", () => {
    const sources = sourcesWithSpans(
      { url: REUTERS, title: "Nestlé Q3", start: 0, end: 40 },
      { url: REUTERS, title: "Nestlé Q3", start: 41, end: 56 }
    );
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));
    expect(result.markdown).toBe(
      `Nestlé raised €80M in Zürich — a record.[1](${REUTERS}) It runs depots.[1](${REUTERS})`
    );
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0].n).toBe(1);
  });

  it("treats two urls for the same page as one number", () => {
    // pageIdentityKey strips tracking params and www., so these are one page.
    const tagged = `${REUTERS}?utm_source=news`;
    const sources = sourcesWithSpans(
      { url: REUTERS, title: "Nestlé Q3", start: 0, end: 40 },
      { url: tagged, title: "Nestlé Q3", start: 41, end: 56 }
    );
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));
    expect(result.emitted.map((e) => e.n)).toEqual([1, 1]);
    // Each marker keeps its own url VERBATIM -- never normalised to the first.
    expect(linkHrefs(result.markdown)).toEqual([REUTERS, tagged]);
  });

  it("renders two markers at one insertion point in ASCENDING order", () => {
    // The splice runs right to left; ties must break on DESCENDING n or the
    // reader sees [2][1]. This is the assertion an ascending-order splice
    // fails.
    const prose = "Nimbus raised $80M. It runs depots.";
    const sources = sourcesWithSpans(
      { url: REUTERS, title: "a", start: 0, end: 19 },
      { url: AP, title: "b", start: 5, end: 19 }
    );
    const result = renderCitedMarkdown(prose, sources, outcomeFor(prose, sources));
    expect(result.markdown).toBe(
      `Nimbus raised $80M.[1](${REUTERS})[2](${AP}) It runs depots.`
    );
    expect(linkHrefs(result.markdown)).toEqual([REUTERS, AP]);
  });

  it("is deterministic for citations that differ only in start", () => {
    const prose = "Nimbus raised $80M. It runs depots.";
    const forward = sourcesWithSpans(
      { url: REUTERS, title: "a", start: 0, end: 19 },
      { url: AP, title: "b", start: 5, end: 19 }
    );
    const reversed = [...forward].reverse();
    const a = renderCitedMarkdown(prose, forward, outcomeFor(prose, forward));
    const b = renderCitedMarkdown(prose, reversed, outcomeFor(prose, reversed));
    expect(b.markdown).toBe(a.markdown);
  });
});

// ---------------------------------------------------------------------------
// 6. `emitted` -- what the panel and markerFor read
// ---------------------------------------------------------------------------

describe("renderCitedMarkdown -- the emitted record", () => {
  it("derives host and label from the anchor's OWN href, in one expression", () => {
    const sources = sourcesWithSpans(
      { url: REUTERS, title: "A headline from somewhere else", start: 0, end: 40 },
      { url: AP, title: "Another", start: 41, end: 56 }
    );
    const result = renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));
    expect(result.emitted).toEqual([
      {
        n: 1,
        href: REUTERS,
        host: "reuters.com",
        label: "Source 1: reuters.com",
        key: "https://reuters.com/business/nestle-q3",
      },
      {
        n: 2,
        href: AP,
        host: "apnews.com",
        label: "Source 2: apnews.com",
        key: "https://apnews.com/article/zurich-depots",
      },
    ]);
  });

  it("emits nothing at all when nothing was placed", () => {
    const result = renderCitedMarkdown(NON_ASCII, [], outcomeFor(NON_ASCII, []));
    expect(result.emitted).toEqual([]);
    expect(result.markdown).toBe(NON_ASCII);
    expect(result.stampOk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Totality -- it can never return corrupted markdown, and it never throws
// ---------------------------------------------------------------------------

describe("renderCitedMarkdown -- totality", () => {
  it("returns the input unchanged for every malformed shape, without throwing", () => {
    const sources = sourcesWithSpans({ url: REUTERS, title: "x", start: 0, end: 40 });
    const outcome = outcomeFor(NON_ASCII, sources);
    for (const badSources of [null, undefined, "sources", 7, [null, 7, "x", {}]]) {
      const result = renderCitedMarkdown(NON_ASCII, badSources, outcome);
      expect(result.markdown).toBe(NON_ASCII);
      expect(result.emitted).toEqual([]);
    }
  });

  it("returns an empty string for a non-string markdown rather than throwing", () => {
    for (const bad of [null, undefined, 7, {}]) {
      const result = renderCitedMarkdown(bad, [], { version: CITATION_OUTCOME_VERSION });
      expect(result.markdown).toBe("");
      expect(result.emitted).toEqual([]);
      expect(result.stampOk).toBe(false);
    }
  });

  it("never emits a marker whose number is stored anywhere in the sources it was given", () => {
    const sources = sourcesWithSpans({ url: REUTERS, title: "x", start: 0, end: 40 });
    const before = JSON.stringify(sources);
    renderCitedMarkdown(NON_ASCII, sources, outcomeFor(NON_ASCII, sources));
    expect(JSON.stringify(sources)).toBe(before); // the input is never mutated
    expect(before).not.toContain('"n"');
  });
});

// ---------------------------------------------------------------------------
// 8. markdownStamp
// ---------------------------------------------------------------------------

describe("markdownStamp", () => {
  it("is stable, and its length is UTF-16 code units", () => {
    expect(markdownStamp(NON_ASCII)).toEqual(markdownStamp(NON_ASCII));
    expect(markdownStamp(NON_ASCII).len).toBe(NON_ASCII.length);
    expect(markdownStamp(NON_ASCII).len).not.toBe(byteLength(NON_ASCII));
  });

  it("produces a short fixed-width hex hash", () => {
    expect(markdownStamp(NON_ASCII).hash).toMatch(/^[0-9a-f]{12}$/);
    expect(markdownStamp("").hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("separates strings that differ only by a character a length check cannot see", () => {
    const seen = new Set();
    for (const s of [NON_ASCII, ...SAME_LENGTH_EDITS.map((edit) => edit(NON_ASCII))]) {
      expect(s.length).toBe(NON_ASCII.length);
      seen.add(markdownStamp(s).hash);
    }
    expect(seen.size).toBe(5);
  });

  it("returns a null stamp for a non-string", () => {
    for (const bad of [null, undefined, 7, {}]) {
      expect(markdownStamp(bad)).toEqual({ len: null, hash: null });
    }
  });
});
