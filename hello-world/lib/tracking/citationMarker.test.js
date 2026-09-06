// The falsifier for the module that owns the citation marker's syntax.
//
// WHY THIS FILE IS SHAPED THE WAY IT IS.
//
// Three things in this feature reason about the string `[n](url)`: the render
// splice that emits one, the check that decides whether emitting one at a
// point is safe, and the check that decides whether a URL may appear inside
// one. They must agree BYTE FOR BYTE. This repo has already paid for the
// alternative: a link scanner written to its own regex disagreed with the
// renderer on 6 of 9 inputs -- on one of them a single unbalanced "(" made
// the scanner see nothing at all while the renderer emitted a live anchor.
//
// So neither predicate here carries a second copy of the syntax:
//
//   * `emitMarker` is the ONLY place the bytes "[", "](", ")" are written.
//   * `markerUrlAllowed` builds its probe with `emitMarker` and asks
//     `parseMarkdown` -- the renderer itself -- what came out.
//   * `differsOnlyByMarker` constructs nothing; it parses the caller's two
//     strings and compares the results.
//
// The last describe block is the executable proof of that claim: five
// NEIGHBOURING syntaxes an implementer might write instead are spliced at
// every one of the eight safe insertion points, and every one must be
// refused. If `emitMarker`'s bytes ever change without the predicates
// following, those rows are what goes red.
//
// Every expectation below was measured against the SHIPPED
// lib/experience/markdown.js before it was written down.

import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../experience/markdown.js";
import { citationHref } from "./citationHref.js";
import { emitMarker, markerUrlAllowed, precededByDigit, differsOnlyByMarker } from "./citationMarker.js";

const URL1 = "https://www.reuters.com/business/nimbus-80m";
const URL2 = "https://techcrunch.com/2026/nimbus-depots";

const splice = (s, at, ins) => s.slice(0, at) + ins + s.slice(at);

// An INDEPENDENT oracle: a second walk of the shipped parser's token tree,
// written here rather than imported, so a bug in the module's own walk cannot
// hide behind itself.
function render(markdown) {
  const hrefs = [];
  let text = "";
  const visit = (nodes) => {
    for (const t of nodes || []) {
      if (t.type === "text") {
        text += t.value;
        continue;
      }
      if (t.type === "code") {
        text += typeof t.value === "string" ? t.value : t.text || "";
        continue;
      }
      if (t.type === "link") hrefs.push(t.href);
      if (Array.isArray(t.children)) visit(t.children);
      if (Array.isArray(t.items)) for (const item of t.items) visit(item.children);
    }
  };
  visit(parseMarkdown(markdown));
  return { hrefs, text };
}

describe("emitMarker", () => {
  it("emits exactly `[n](url)` and nothing else", () => {
    expect(emitMarker(1, URL1)).toBe(`[1](${URL1})`);
    expect(emitMarker(12, "https://acme.com/x")).toBe("[12](https://acme.com/x)");
  });

  it("emits the same bytes for a numeric and a string n", () => {
    expect(emitMarker(7, URL1)).toBe(emitMarker("7", URL1));
  });
});

// ---------------------------------------------------------------------------
// markerUrlAllowed
// ---------------------------------------------------------------------------

// [url, expected, label]. `expected` is what the SHIPPED parser produces, not
// what an enumerated rule predicts.
const URL_TABLE = [
  ["https://acme.com/story", true, "a plain https URL"],
  ["http://acme.com/story", true, "a plain http URL"],
  ["HTTPS://acme.com/story", true, "an upper-case scheme, passed through verbatim"],
  // AC-F31's zero-over-refusal cases: a "(" alone is harmless, and so is a
  // space. A rule that refuses every parenthesis loses a real citation.
  ["https://acme.com/x(y", true, "a URL containing ( but no )"],
  ["https://acme.com/a b", true, "a URL containing a space"],
  ["https://acme.com/a]b", true, "a URL containing ]"],

  // parseInline takes the FIRST ")", with no balancing, so this yields the
  // href ".../Nimbus_(company" -- a URL Google never supplied -- plus a stray
  // ")" in the prose. NEVER re-encode to make it pass: a URL we rewrote is
  // not the URL we were given.
  ["https://en.wikipedia.org/wiki/Nimbus_(company)", false, "a URL containing )"],

  // citationHref's own refusals: none of these may reach a marker either.
  ["https://acme.com@evil.example/x", false, "userinfo that reads as the real host"],
  ["https://user:pw@evil.example/x", false, "user:password before the real host"],
  ["https://", false, "https with an empty hostname"],
  ["  https://acme.com/x  ", false, "space-padded https"],
  ["javascript:alert(1)", false, "javascript:"],
  ["data:text/html,<script>alert(1)</script>", false, "data:"],
  ["//evil.example/x", false, "protocol-relative"],
  ["", false, "the empty string"],
  [null, false, "null"],
  [undefined, false, "undefined"],
  [{ url: "https://acme.com/x" }, false, "an object"],
];

describe("markerUrlAllowed", () => {
  for (const [url, expected, label] of URL_TABLE) {
    it(`${expected ? "admits" : "refuses"} ${label}`, () => {
      expect(markerUrlAllowed(url)).toBe(expected);
    });
  }

  it("refuses the )-bearing URL for the measured reason: the parser invents a different href", () => {
    const url = "https://en.wikipedia.org/wiki/Nimbus_(company)";
    const out = render(emitMarker(1, url));
    expect(out.hrefs).toEqual(["https://en.wikipedia.org/wiki/Nimbus_(company"]);
    expect(out.hrefs[0]).not.toBe(url);
    expect(markerUrlAllowed(url)).toBe(false);
  });

  // THE divergence, and the reason this predicate asks the parser instead of
  // enumerating ")". The enumerated rule -- "citationHref admits it and it
  // contains no ')'" -- ADMITS a URL carrying a blank line. The renderer then
  // produces NO link at all and prints the raw URL in the prose. `url` is
  // vendor-supplied and its own type constrains nothing, and a `sources`
  // element read back from jsonb carries no element-level guarantee, so this
  // population is reachable.
  it("refuses a URL carrying a blank line, which the enumerated ) rule admits", () => {
    const url = "https://acme.com/a\n\nb";
    expect(citationHref(url)).toBe(url); // the enumerated rule's first half passes
    expect(url.includes(")")).toBe(false); // and its second half passes too
    const out = render(emitMarker(1, url));
    expect(out.hrefs).toEqual([]); // yet the renderer emits no link
    expect(out.text).toBe("[1](https://acme.com/ab)"); // and shows the URL as prose
    expect(markerUrlAllowed(url)).toBe(false);
  });

  it("agrees with the enumerated ) rule everywhere else in the table", () => {
    for (const [url, expected] of URL_TABLE) {
      const enumerated = citationHref(url) !== null && !String(url).includes(")");
      expect(enumerated).toBe(expected);
    }
  });

  it("never throws, whatever it is handed", () => {
    for (const v of [Object.create(null), () => "x", new Date(), NaN, "https://[", "%%%"]) {
      expect(() => markerUrlAllowed(v)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// precededByDigit -- AC-F31's final clause. The one harm the differential
// check cannot see, because it is parse-IDENTICAL.
// ---------------------------------------------------------------------------

describe("precededByDigit", () => {
  it("sees a marker about to turn 400 into 4001", () => {
    const text = "Nimbus employs 400 people.";
    expect(precededByDigit(text, text.indexOf(" people."))).toBe(true);
  });

  it("sees a marker about to turn 3.5x into 3.5x1 only when a digit actually precedes", () => {
    expect(precededByDigit("Revenue grew 3.5x", 17)).toBe(false); // "x" precedes
    expect(precededByDigit("Revenue grew 3.5", 16)).toBe(true); // "5" precedes
  });

  it("does not fire at the end of an ordinary sentence", () => {
    const text = "Nimbus raised $80M. It runs depots.";
    expect(precededByDigit(text, text.indexOf(" It runs"))).toBe(false);
  });

  it("does not fire at offset 0, where nothing precedes", () => {
    expect(precededByDigit("400 people", 0)).toBe(false);
  });

  // A digest names non-ASCII companies, so "decimal digit" is read as the
  // Unicode Nd category rather than as [0-9]. Over-refusal is the cheap
  // direction here: the citation goes to "Also searched", which is honest.
  it("fires on a non-ASCII decimal digit, including one outside the BMP", () => {
    const arabicIndic = "٤٠٠"; // ARABIC-INDIC DIGITS FOUR, ZERO, ZERO
    expect(precededByDigit(arabicIndic, arabicIndic.length)).toBe(true);
    const boldZero = String.fromCodePoint(0x1d7ce); // MATHEMATICAL BOLD DIGIT ZERO
    expect(boldZero.length).toBe(2); // a surrogate pair, so a naive text[at-1] misses it
    expect(precededByDigit(boldZero, boldZero.length)).toBe(true);
  });

  it("reports no preceding character for an out-of-range or non-string input", () => {
    expect(precededByDigit("400", 4)).toBe(false);
    expect(precededByDigit("400", -1)).toBe(false);
    expect(precededByDigit("400", 1.5)).toBe(false);
    expect(precededByDigit("400", "3")).toBe(false);
    expect(precededByDigit(null, 1)).toBe(false);
    expect(precededByDigit(undefined, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// differsOnlyByMarker -- AC-F31's differential check.
// ---------------------------------------------------------------------------

const SAFE = [
  ["end of a sentence", "Nimbus raised $80M. It runs depots.", (s) => s.indexOf(" It runs")],
  ["end of the document", "Nimbus raised $80M.", (s) => s.length],
  ["start of the document", "Nimbus raised $80M.", () => 0],
  ["after a bold run", "**Nimbus** raised $80M.", (s) => s.indexOf("** raised") + 2],
  ["inside a blockquote", "> Nimbus raised $80M.", (s) => s.length],
  ["end of a list item", "- Nimbus raised $80M.\n- It runs depots.", (s) => s.indexOf("\n- It runs")],
  ["end of a heading line", "## Nimbus\n\nIt raised $80M.", (s) => s.indexOf("\n\nIt raised")],
  ["mid-word", "Nimbus raised $80M.", (s) => s.indexOf("raised") + 3],
];

// The measured rendering is recorded beside each row, because "it is refused"
// is worth much less than "it is refused, and here is the string a candidate
// would otherwise have read aloud".
const UNSAFE = [
  [
    "inside an inline code span",
    "Run `npm run build` now.",
    (s) => s.indexOf("npm ru") + 6,
    "Run npm ru[1](https://www.reuters.com/business/nimbus-80m)n build now.",
  ],
  [
    "inside a fenced code block",
    "```js\nconst a = 1;\n```",
    (s) => s.indexOf(";"),
    "const a = 1[1](https://www.reuters.com/business/nimbus-80m);",
  ],
  [
    "inside an emphasis delimiter run",
    "Nimbus is **bold** now.",
    (s) => s.indexOf("**") + 1,
    "Nimbus is 1bold** now.",
  ],
  [
    "inside a link destination",
    "See the [report](https://tc.example/x) now.",
    (s) => s.indexOf("https://tc.example") + 3,
    "See the reportps://tc.example/x) now.",
  ],
  [
    "inside a link label",
    "See the [report](https://tc.example/x) now.",
    (s) => s.indexOf("report") + 2,
    "See the re[1port](https://tc.example/x) now.",
  ],
  [
    "inside an unmatched bracket run",
    "Series B [led by Acme Ventures of London]",
    (s) => s.indexOf(" of London"),
    "Series B led by Acme Ventures[1 of London]",
  ],
  [
    "immediately after a !",
    "Chart! shows growth.",
    (s) => s.indexOf("! shows") + 1,
    "Chart1 shows growth.",
  ],
  [
    "immediately after a backslash",
    "Cost is 50\\% now.",
    (s) => s.indexOf("\\") + 1,
    "Cost is 50[1](https://www.reuters.com/business/nimbus-80m)% now.",
  ],
  [
    "between the two newlines of a blank-line break",
    "Nimbus raised $80M.\n\nIt runs depots.",
    (s) => s.indexOf("\n\n") + 1,
    "Nimbus raised $80M.\n1\nIt runs depots.",
  ],
];

describe("differsOnlyByMarker", () => {
  for (const [label, before, atOf] of SAFE) {
    it(`accepts a marker at ${label}`, () => {
      const after = splice(before, atOf(before), emitMarker(1, URL1));
      expect(differsOnlyByMarker(before, after, "1", URL1)).toBe(true);
    });
  }

  for (const [label, before, atOf, renderedAfter] of UNSAFE) {
    it(`refuses a marker ${label}`, () => {
      const after = splice(before, atOf(before), emitMarker(1, URL1));
      // The harm, pinned: this is what the reader would have seen.
      expect(render(after).text).toBe(renderedAfter);
      expect(differsOnlyByMarker(before, after, "1", URL1)).toBe(false);
    });
  }

  it("refuses a marker whose URL contains ), because the href it gains is not the URL supplied", () => {
    const url = "https://en.wikipedia.org/wiki/Nimbus_(company)";
    const before = "Nimbus raised $80M.";
    const after = splice(before, before.length, emitMarker(1, url));
    expect(differsOnlyByMarker(before, after, "1", url)).toBe(false);
  });

  // Clause isolation. Both halves of the rule are load-bearing, and each has
  // a case the other cannot catch.
  it("clause (1) alone catches a splice that keeps the href but mangles the prose", () => {
    const before = "Nimbus is **bold** now.";
    const after = splice(before, before.indexOf("**") + 1, emitMarker(1, URL1));
    expect(render(after).hrefs).toEqual([URL1]); // clause (2) is satisfied
    expect(differsOnlyByMarker(before, after, "1", URL1)).toBe(false);
  });

  it("clause (2) alone catches a bare digit spliced with no marker at all", () => {
    const before = "Nimbus raised $80M.";
    const after = splice(before, before.length, "1"); // reads identically
    expect(render(after).text).toBe("Nimbus raised $80M.1"); // clause (1) is satisfied
    expect(differsOnlyByMarker(before, after, "1", URL1)).toBe(false);
  });

  // AC-F31's one blind spot, stated as a test so nobody assumes otherwise:
  // the differential check CANNOT see digit adjacency, because the splice is
  // parse-identical. precededByDigit is the whole of the defence.
  it("cannot see digit adjacency -- that is precededByDigit's job, not this one", () => {
    const before = "Nimbus employs 400 people.";
    const at = before.indexOf(" people.");
    const after = splice(before, at, emitMarker(1, URL1));
    expect(render(after).text).toBe("Nimbus employs 4001 people.");
    expect(differsOnlyByMarker(before, after, "1", URL1)).toBe(true);
    expect(precededByDigit(before, at)).toBe(true);
  });

  // P7: the pair failure. Two markers, each provably safe against the stored
  // string, where the second lands inside the first's emitted syntax.
  it("refuses the second of two markers when it lands inside the first's syntax", () => {
    const before = "Nimbus raised $80M. It runs depots.";
    const at = before.indexOf(" It runs");

    // Each is individually safe against the stored string.
    expect(differsOnlyByMarker(before, splice(before, at, emitMarker(1, URL1)), "1", URL1)).toBe(true);
    expect(differsOnlyByMarker(before, splice(before, at, emitMarker(2, URL2)), "2", URL2)).toBe(true);

    // Cumulatively they are not: the check must run against the string that
    // already carries marker 1, never against the stored string.
    const first = splice(before, at, emitMarker(1, URL1));
    const both = splice(first, at + 1, emitMarker(2, URL2));
    expect(render(both).text).toBe(`Nimbus raised $80M.[21](${URL1}) It runs depots.`); // URL1 as prose
    expect(render(both).hrefs).toEqual([URL2]); // and URL1's own href is gone
    expect(differsOnlyByMarker(first, both, "2", URL2)).toBe(false);
  });

  it("refuses when a link is lost, even if a marker is also gained", () => {
    const before = "See the [report](https://tc.example/x) now.";
    const after = "See the [report](https://tc.example/x now.[1](" + URL1 + ")";
    expect(differsOnlyByMarker(before, after, "1", URL1)).toBe(false);
  });

  it("accepts an unchanged pair only when a marker really was added", () => {
    const before = "Nimbus raised $80M.";
    expect(differsOnlyByMarker(before, before, "1", URL1)).toBe(false);
  });

  it("refuses non-string arguments and empty digits rather than guessing", () => {
    const before = "Nimbus raised $80M.";
    const after = splice(before, before.length, emitMarker(1, URL1));
    expect(differsOnlyByMarker(null, after, "1", URL1)).toBe(false);
    expect(differsOnlyByMarker(before, null, "1", URL1)).toBe(false);
    expect(differsOnlyByMarker(before, after, "", URL1)).toBe(false);
    expect(differsOnlyByMarker(before, after, 1, URL1)).toBe(false);
    expect(differsOnlyByMarker(before, after, "1", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE DRIFT PROOF.
//
// `differsOnlyByMarker` accepts the bytes `emitMarker` produces and refuses
// every neighbouring syntax an implementer might write instead. So a change
// to `emitMarker` that the predicates did not follow cannot be silent: the
// eight rows in the first test go red, at every insertion point at once.
// ---------------------------------------------------------------------------

const ALTERNATIVE_SYNTAXES = [
  ["a space between the label and the destination", (n, u) => `[${n}] (${u})`],
  ["doubled brackets", (n, u) => `[[${n}]](${u})`],
  ["an angle-bracketed destination", (n, u) => `[${n}](<${u}>)`],
  ["the label and destination swapped", (n, u) => `(${n})[${u}]`],
  ["an html superscript", (n) => `<sup>${n}</sup>`],
];

describe("the marker syntax and its predicates cannot drift apart", () => {
  it("accepts emitMarker's exact bytes at all eight safe insertion points", () => {
    const verdicts = SAFE.map(([, before, atOf]) =>
      differsOnlyByMarker(before, splice(before, atOf(before), emitMarker(1, URL1)), "1", URL1),
    );
    expect(verdicts).toEqual(SAFE.map(() => true));
  });

  for (const [label, alternative] of ALTERNATIVE_SYNTAXES) {
    it(`refuses ${label} at every one of those same points`, () => {
      const verdicts = SAFE.map(([, before, atOf]) =>
        differsOnlyByMarker(before, splice(before, atOf(before), alternative(1, URL1)), "1", URL1),
      );
      expect(verdicts).toEqual(SAFE.map(() => false));
    });
  }

  it("derives markerUrlAllowed from emitMarker's own output, not from a second copy of the syntax", () => {
    for (const [url] of URL_TABLE) {
      const admitted = citationHref(url) !== null;
      const out = admitted ? render(emitMarker("1", url)) : { hrefs: [], text: "" };
      const parserAgrees = admitted && out.hrefs.length === 1 && out.hrefs[0] === url && out.text === "1";
      expect(markerUrlAllowed(url)).toBe(parserAgrees);
    }
  });
});
