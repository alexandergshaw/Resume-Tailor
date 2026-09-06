// The falsifier for the residue scanner (SEC-F4 / AC-F9 item 2 / AC-F11 /
// AC-F12 / AC-F18 / AC-F32).
//
// WHY THIS FILE'S FIRST TABLE IS THE ONE THAT MATTERS.
//
// The obvious implementation of "find every model-authored markdown link" is
// a regex, and this repo has already shipped one: `LINK_RE` in
// applicationDigest.js / researchReport.js. Measured (1g-security-footnotes.md
// S-4.3, `1gfn/p4-scanner-divergence.mjs`): that regex DISAGREES with the
// renderer (`parseMarkdown`, lib/experience/markdown.js) on 6 of 9 inputs, and
// a single unbalanced "(" in the URL — `[report](https://x/y?a=(1)` — makes
// the regex see NOTHING while `parseMarkdown` emits a live, clickable anchor.
// That is a defeat of the exact control this module exists to provide, and it
// is silent in both directions: no throw, no log, a residue count of zero
// beside a live anchor pointing at a URL the model invented.
//
// So this scanner does not get to have its own opinion about what counts as
// a link. SEC-F4 requires the removal DECISION to come from the renderer's
// own grammar, never from an independently-written pattern — the checkable
// form is `storedMarkdownHasNoLinks`, which asks `parseMarkdown` directly
// whether anything survived. The eight fixtures below are the ones that
// separate a grammar-mirroring finder from `LINK_RE`; four of them are total
// misses (the regex finds nothing to remove) and the rest recognise a
// DIFFERENT, wrong URL. Every one of them must still end with zero link
// tokens after removal.
//
// A citation-shaped artefact that never becomes a link at all — a nested
// bracket like `[a[b]c](url)`, which `parseMarkdown` renders as inert literal
// text with the raw URL exposed — is a different failure mode (AC-F11, a bare
// URL in recruiter-facing prose) and is covered by its own case.

import { describe, it, expect, vi, afterEach } from "vitest";
import { parseMarkdown } from "../experience/markdown.js";
import { emitMarker } from "./citationMarker.js";
import {
  scanCitationResidue,
  removeResidue,
  storedMarkdownHasNoLinks,
} from "./citationResidue.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// Applies the module's own two-step pipeline: scan, then remove exactly the
// ranges the scan reported. This is the shape every real caller uses; a test
// that only ever calls one half would not catch a scanner/remover mismatch.
function scanAndClean(text) {
  const scan = scanCitationResidue(text);
  const markdown = removeResidue(text, scan.ranges);
  return { scan, markdown };
}

describe("citationResidue — the eight forms that separate the renderer's grammar from LINK_RE", () => {
  // Byte-identical to the fixtures measured in 1g-security-footnotes.md S-4.3
  // and reproduced independently in scratchpad/plan-residue-check.mjs, minus
  // the baseline (which every implementation gets right) and the
  // backslash-escaped case (which is a harmless over-count, not a leak: the
  // renderer emits no link there either).
  const LEAKING_FORMS = [
    ["unbalanced '(' with no closing ')' at all — the load-bearing case",
      "See [report](https://evil.example/a(b)."],
    ["a second '(' still unbalanced",
      "See [report](https://evil.example/a(b(c))."],
    ["one balanced pair plus a trailing stray ')' — LINK_RE finds a DIFFERENT url",
      "See [report](https://evil.example/a(b)c)."],
    ["a literal space then a parenthesised '(title)' after the url",
      "See [report](https://evil.example/x (title))."],
    ["the url padded with spaces inside the parens",
      "See [report](  https://evil.example/x  )."],
    ["three unbalanced '(' in a row",
      "See [report](https://evil.example/((()))x)."],
    ["a nested '[' in the label — matches no link at all, but the url still leaks as prose",
      "See [a[b]c](https://evil.example/x)."],
    ["one unbalanced '(' from a query string — real URLs carry these constantly",
      "See [report](https://evil.example/x?a=(1)."],
  ];

  it.each(LEAKING_FORMS)("%s: leaves zero link tokens and no trace of the host", (_label, input) => {
    const { scan, markdown } = scanAndClean(input);
    expect(scan.count).toBeGreaterThan(0);
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
    expect(markdown).not.toContain("evil.example");
  });

  it("the load-bearing case specifically: LINK_RE sees nothing, parseMarkdown renders a live anchor", () => {
    const input = "See [report](https://evil.example/x?a=(1).";
    const LINK_RE = /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g;
    expect([...input.matchAll(LINK_RE)]).toHaveLength(0); // the regex: nothing to remove
    const rendered = parseMarkdown(input);
    const hasLiveAnchor = JSON.stringify(rendered).includes('"type":"link"');
    expect(hasLiveAnchor).toBe(true); // the renderer: a live anchor anyway
    // ...and the scanner under test must still catch it:
    const { scan, markdown } = scanAndClean(input);
    expect(scan.count).toBe(1);
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
  });
});

describe("citationResidue — the modelAuthoredLink recogniser in isolation", () => {
  // The eight-forms table above proves the SYSTEM removes real hostile
  // citations end to end, but every one of those fixtures carries an
  // "https://" URL, and the independent bareUrl recogniser can (correctly)
  // remove that text on its own even when modelAuthoredLink itself misses
  // the link entirely — bareUrl is a real safety net, not a test artefact,
  // but it means the eight-forms table does not, by itself, prove
  // modelAuthoredLink is grammar-accurate rather than merely "backstopped".
  //
  // A same-origin path (accepted by markdown.js's sanitizeUrl with no
  // "http") is invisible to bareUrl, so it isolates modelAuthoredLink alone.
  it("an unbalanced '(' in a same-origin path — no http(s) scheme, so there is no bareUrl safety net", () => {
    const input = "See [report](/reports/a(b).";
    // Ground truth: the renderer DOES create a link here (sanitizeUrl admits
    // any same-origin path with no further validation of its content), so
    // this is a genuine SEC-F4 case, unlike the nested-bracket fixture below
    // where the renderer never forms a link at all.
    expect(storedMarkdownHasNoLinks(input)).toBe(false);
    const { scan, markdown } = scanAndClean(input);
    expect(scan.reasons.modelAuthoredLink).toBe(1);
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
    expect(markdown).not.toContain("/reports/a(b");
  });
});

describe("citationResidue — forms AC-F18/AC-F12 name explicitly", () => {
  it("a bare URL in prose, with no brackets at all", () => {
    const input = "See https://plain.example/path for details.";
    const { scan, markdown } = scanAndClean(input);
    expect(scan.count).toBe(1);
    expect(scan.reasons).toEqual({
      unmatchedMarker: 0,
      referenceDefinition: 0,
      bareUrl: 1,
      modelAuthoredLink: 0,
    });
    expect(markdown).not.toContain("plain.example");
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
  });

  it("a reference-style definition, plus its own unmatched [1] earlier in the prose", () => {
    // The exact fixture measured in AC-digest-footnotes.md §1.1.
    const input =
      "Nimbus raised $80M.[1] Next.\n\n[1]: https://www.reuters.com/business/nimbus-series-c";
    const { scan, markdown } = scanAndClean(input);
    // Two DISTINCT citation-shaped artefacts: the standalone "[1]" near
    // "$80M" and the reference-definition line (whose own nested "[1]" and
    // bare url are components of the SAME artefact, not separate ones).
    expect(scan.count).toBe(2);
    expect(scan.reasons.referenceDefinition).toBe(1);
    expect(scan.reasons.bareUrl).toBeGreaterThanOrEqual(1);
    expect(markdown).not.toMatch(/\[1\]/);
    expect(markdown).not.toContain("reuters.com");
    expect(markdown).toContain("Nimbus raised $80M.");
    expect(markdown).toContain("Next.");
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
  });

  it("an unmatched [[1]] double-bracket marker", () => {
    const input = "Nimbus raised $80M.[[1]] Next.";
    const { scan } = scanAndClean(input);
    expect(scan.count).toBe(1);
    expect(scan.reasons.unmatchedMarker).toBe(1);
  });

  it("an unmatched [source [1]] marker with a label", () => {
    const input = "Nimbus raised $80M. [source [1]] Next.";
    const { scan } = scanAndClean(input);
    expect(scan.count).toBe(1);
    expect(scan.reasons.unmatchedMarker).toBe(1);
  });

  it("a mixed document: one placeable-shaped sentence plus one unrecognised citation whose url leaks — yields 1, never 0", () => {
    // Mirrors AC-digest-footnotes.md §1.4's mixed-document measurement: a
    // count derived from `dropped` would read 0 here and print "0 citations
    // could not be verified" beside a naked URL. The residue scan must not
    // make the same mistake for the one artefact that is genuinely
    // unrecognised prose (no brackets, no markdown, just a bare URL).
    const input =
      "A raised $80M. B ships depots. See https://techcrunch.com/2026/01/nimbus for background.";
    const { scan, markdown } = scanAndClean(input);
    expect(scan.count).toBe(1);
    expect(markdown).not.toContain("techcrunch.com");
  });
});

describe("citationResidue — images never carry a href, but their url must not leak as prose", () => {
  it("does not treat an image as a modelAuthoredLink — the renderer's own '!' precedence rule", () => {
    const input = "See ![diagram](https://evil.example/pic.png) for details.";
    // Ground truth about the renderer itself: an image's url is discarded
    // entirely by parseInline (only the alt text survives), so it was never
    // a link-token risk in the first place — the assertion is precision, not
    // a link check.
    const rendered = parseMarkdown(input);
    expect(JSON.stringify(rendered)).not.toContain('"type":"link"');

    const scan = scanCitationResidue(input);
    expect(scan.reasons.modelAuthoredLink).toBe(0);
  });
});

describe("citationResidue — nested and adjacent links", () => {
  it("a nested '[' inside the label forms NO link at all, per the renderer's own first-']' rule — but the url is still bare prose", () => {
    const input = "See [a[b]c](https://evil.example/x) too.";
    // Ground truth: parseMarkdown never manages to close a link here, so this
    // was never a SEC-F4 case — it is an AC-F11 bare-url-in-prose case.
    expect(storedMarkdownHasNoLinks(input)).toBe(true);
    const { scan, markdown } = scanAndClean(input);
    expect(scan.count).toBeGreaterThan(0);
    expect(markdown).not.toContain("evil.example");
  });

  it("two links with no separator between them are counted as TWO distinct citations, not coalesced into one", () => {
    // Same-origin path destinations (no "http"), deliberately: two adjacent
    // "https://" urls with nothing between them give bareUrl's greedy \S+
    // nothing to stop on, so it bridges straight across both links into one
    // giant match and merges the count for a reason that has nothing to do
    // with the property this test checks. That would happen under a correct
    // implementation too, so it is not a meaningful fixture; a same-origin
    // path isolates the actual claim, exactly as the recogniser-isolation
    // block above does.
    const input = "See [a](/pages/a)[b](/pages/b) too.";
    const scan = scanCitationResidue(input);
    // Touching, non-overlapping spans: safe to remove as one contiguous
    // block, but they are two DISTINCT citations for AC-F12's count — this is
    // the distinction AC-F32 draws between "coalesced ranges" (removal
    // safety, may merge touching spans) and "count" (never allowed to
    // under-report).
    expect(scan.count).toBe(2);
    expect(scan.reasons.modelAuthoredLink).toBe(2);
    const markdown = removeResidue(input, scan.ranges);
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
    expect(markdown).not.toContain("/pages/a");
    expect(markdown).not.toContain("/pages/b");
  });
});

describe("citationResidue — AC-F32's coalescing fixture, verbatim", () => {
  // The exact 126-character fixture from AC-digest-footnotes.md / 1b's own
  // ruling: a model-authored link (containing a bare url), an independent
  // bare url, and a reference-style definition (containing both an unmatched
  // marker and a bare url) — six raw recogniser hits, three overlapping
  // pairs. The naive right-to-left removal without coalescing eats 26
  // characters beyond the correct answer, including the whole sentence
  // "It runs depots." This is the test that catches that.
  const FIXTURE =
    "Nimbus raised $80M.[Reuters](https://www.reuters.com/x) It runs depots. " +
    "See https://tc.example/y too.\n[1]: https://z.example/q";

  it("coalesces six overlapping raw hits into three counted, disjoint removals", () => {
    const scan = scanCitationResidue(FIXTURE);
    expect(scan.count).toBe(3);
    expect(scan.reasons).toEqual({
      unmatchedMarker: 1,
      referenceDefinition: 1,
      bareUrl: 3,
      modelAuthoredLink: 1,
    });
    // Disjoint: no range may start before the previous one ends.
    for (let i = 1; i < scan.ranges.length; i++) {
      expect(scan.ranges[i].start).toBeGreaterThanOrEqual(scan.ranges[i - 1].end);
    }
  });

  it("removal repairs the whitespace seam — no double space, matching the plan's own measured (uncorrected) output", () => {
    const scan = scanCitationResidue(FIXTURE);
    const markdown = removeResidue(FIXTURE, scan.ranges);
    // The plan's own measurement of coalesced-but-unrepaired removal is
    // "Nimbus raised $80M. It runs depots. See  too.\n" — note the double
    // space before "too.". T-1 requires that seam repaired.
    expect(markdown).toBe("Nimbus raised $80M. It runs depots. See too.\n");
    expect(markdown).not.toMatch(/ {2}/);
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
  });
});

describe("citationResidue — the whitespace seam (T-1), isolated from coalescing", () => {
  it("a removal with a space on both sides collapses to exactly one space", () => {
    const input = "Word [1](https://evil.example/x) word.";
    const scan = scanCitationResidue(input);
    const markdown = removeResidue(input, scan.ranges);
    expect(markdown).toBe("Word word.");
  });

  it("a removal preceded by a space and followed by punctuation drops the leading space, not the punctuation", () => {
    // An unmatched marker, deliberately with no URL: a link's own bareUrl
    // component greedily consumes trailing non-whitespace (correct, and
    // measured in the AC-F32 fixture above — "https://www.reuters.com/x)"
    // keeps its trailing ')'), so a fixture built from a real link would
    // fold this rule into the double-space rule instead of isolating it.
    const input = "Word [1]. Next.";
    const scan = scanCitationResidue(input);
    const markdown = removeResidue(input, scan.ranges);
    expect(markdown).toBe("Word. Next.");
  });

  it("a removal preceded by '(' and followed by a space drops the trailing space, not the paren", () => {
    const input = "Contact us (https://evil.example/x here) today.";
    const scan = scanCitationResidue(input);
    const markdown = removeResidue(input, scan.ranges);
    expect(markdown).toBe("Contact us (here) today.");
  });

  it("removeResidue is total: unknown/empty ranges return the input untouched", () => {
    expect(removeResidue("plain prose", [])).toBe("plain prose");
    expect(removeResidue("plain prose", undefined)).toBe("plain prose");
  });
});

describe("citationResidue — a pipeline-inserted marker is never mistaken for model residue", () => {
  it("the default (write-time) path flags a marker-shaped link exactly like any other model-authored link — there is no free pass by shape alone", () => {
    // This is the security property: a hostile posting instructing the model
    // to write "[1](https://evil.example/x)" must not slip past the scanner
    // just because it happens to look like our own marker syntax. Digit-only
    // labels are not special; `citationResidue` has no third argument on the
    // write path and none is used here.
    const marker = emitMarker(1, "https://evil.example/x");
    const input = `Nimbus raised $80M.${marker} Next.`;
    const scan = scanCitationResidue(input);
    expect(scan.reasons.modelAuthoredLink).toBe(1);
    const markdown = removeResidue(input, scan.ranges);
    expect(storedMarkdownHasNoLinks(markdown)).toBe(true);
    expect(markdown).not.toContain("evil.example");
  });

  it("a caller that KNOWS a specific marker is legitimate (built via W1's emitMarker) may protect exactly that byte-identical span, and only that one", () => {
    const goodUrl = "https://good.example/story";
    const legitimateMarker = emitMarker(3, goodUrl);
    const input = `Nimbus raised $80M.${legitimateMarker} It runs depots.`;

    const unprotected = scanCitationResidue(input);
    expect(unprotected.count).toBe(1); // proven flagged by default, above

    const protectedScan = scanCitationResidue(input, {
      protectedMarkers: [legitimateMarker],
    });
    expect(protectedScan.count).toBe(0);
    expect(protectedScan.ranges).toEqual([]);
    expect(protectedScan.reasons).toEqual({
      unmatchedMarker: 0,
      referenceDefinition: 0,
      bareUrl: 0,
      modelAuthoredLink: 0,
    });

    const markdown = removeResidue(input, protectedScan.ranges);
    expect(markdown).toBe(input); // untouched: the marker and its url both survive
    expect(markdown).toContain(goodUrl);
  });

  it("protection is byte-exact: a near-miss (different digits) for the same url is still flagged", () => {
    const goodUrl = "https://good.example/story";
    const actualMarker = emitMarker(3, goodUrl); // "[3](https://good.example/story)"
    const differentDigits = emitMarker(4, goodUrl); // NOT the string in the text
    const input = `Nimbus raised $80M.${actualMarker} It runs depots.`;

    const scan = scanCitationResidue(input, { protectedMarkers: [differentDigits] });
    expect(scan.count).toBe(1); // the protection list named a different exact string
  });
});

describe("citationResidue — normal empties are not anomalies", () => {
  it("plain prose with nothing citation-shaped scans to a true zero", () => {
    const scan = scanCitationResidue("Nimbus is a cold-chain logistics company.");
    expect(scan).toEqual({
      count: 0,
      reasons: { unmatchedMarker: 0, referenceDefinition: 0, bareUrl: 0, modelAuthoredLink: 0 },
      ranges: [],
    });
  });

  it("empty and non-string input degrade to the same zero shape rather than throwing", () => {
    expect(scanCitationResidue("").count).toBe(0);
    expect(scanCitationResidue(null).count).toBe(0);
    expect(scanCitationResidue(undefined).count).toBe(0);
  });
});

describe("storedMarkdownHasNoLinks — the SEC-F4 terminal proof", () => {
  it("is false when a plain link survives", () => {
    expect(storedMarkdownHasNoLinks("[a](https://x.example)")).toBe(false);
  });

  it("is true for plain prose", () => {
    expect(storedMarkdownHasNoLinks("Nimbus raised $80M. It runs depots.")).toBe(true);
  });

  it("finds a link nested inside a list item and inside a blockquote, not only top-level paragraphs", () => {
    expect(storedMarkdownHasNoLinks("- see [a](https://x.example)")).toBe(false);
    expect(storedMarkdownHasNoLinks("> see [a](https://x.example)")).toBe(false);
  });

  it("degrades to true rather than throwing on non-string input", () => {
    expect(storedMarkdownHasNoLinks(null)).toBe(true);
    expect(storedMarkdownHasNoLinks(undefined)).toBe(true);
    expect(storedMarkdownHasNoLinks("")).toBe(true);
  });

  // OBSERVABILITY (plan §0.4 / harness): a non-zero input (real markdown)
  // producing a non-zero, security-relevant finding (a surviving link) is a
  // reportable anomaly, not a normal empty, and this proof is exactly where
  // that anomaly must be loud.
  it("warns when a link survives, naming the count", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storedMarkdownHasNoLinks("[a](https://x.example) and [b](https://y.example)");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/2/);
  });

  it("does not warn on a clean pass", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storedMarkdownHasNoLinks("Nimbus raised $80M.");
    expect(warn).not.toHaveBeenCalled();
  });
});
