// The derivation behind "From your Management Experience page, under
// Automating compatibility checks." — and behind the reveal that shows the
// candidate the words the claim rests on.
//
// THE CLAIM THIS FILE POLICES. A section is NOT stored anywhere: every
// citation site in this tree carries `{ id, title }` and nothing else
// (verified at seven sites — pageCitations.js's resolvePageSources,
// knowledgeBase.js's includedPages whitelist, answerPoints.js's
// resolvePageSource, answerLocal.js's embedded citation, projectStories.js's
// selectBestStory, knowledgePrompts.js's model channel, and the two cache
// round-trips). So a section can only be RE-DERIVED, and a re-derivation that
// guesses is the false-employer bug in a new costume. The rule these cases
// exist to enforce:
//
//   Every claim the citation line makes is backed by material the reveal
//   shows. If we cannot show the evidence, we do not make the claim.
//
// Hence two tiers and no third. LOCATED names a section only when a
// contiguous run of >= GROUNDED_SPAN_MIN_WORDS of the candidate's own
// normalised tokens pins ONE block of the cited page, unambiguously across
// sections. Everything else names nothing new, and — where there is nothing
// at all to reveal — returns the citation entry UNCHANGED, which is what
// keeps four exact-shape `toEqual` assertions in
// app/api/copilot/answer/route.knowledgeBase.test.js green and what keeps the
// rendered line byte-identical to what it was before this feature existed.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  attachCitationDetail,
  citationDetail,
  headingText,
  MAX_HEADING_CHARS,
  MAX_OUTLINE_HEADINGS,
  MAX_QUOTE_CHARS,
  MAX_SECTION_CHARS,
  MAX_SECTION_WORDS,
} from "./citationDetail.js";
import { splitBlocks } from "@/lib/experience/knowledgeBase.js";
import { GROUNDED_SPAN_MIN_WORDS } from "./pointLength.js";

const SRC = readFileSync(path.join(process.cwd(), "lib/copilot/citationDetail.js"), "utf8");

// The bullet every fixture below quotes. Long enough to carry a run far past
// the four-token floor, and deliberately NOT date-bearing: materialQuote
// drops any candidate line isEmploymentHeaderLine accepts, so a fixture that
// looked like "Engineer, Acme | 2019 - 2021" would measure zero for a reason
// that has nothing to do with this module.
const BULLET = "- Built a service that ran compatibility checks against every partner release";
const POINT = "Action: Built a service that ran compatibility checks against every partner release.";

const pageOf = (body, extra = {}) => ({ id: "p1", title: "Management Experience", body, ...extra });
const cite = (extra = {}) => ({ id: "p1", title: "Management Experience", ...extra });

const detail = (body, point = POINT, citation = cite()) =>
  citationDetail(citation, { point, page: pageOf(body) });

// ---------------------------------------------------------------------------
// AC-CH.1 / AC-CH.2 — locating, and the floor that stops it
// ---------------------------------------------------------------------------
describe("a verbatim run pins one block, and reports the heading above it", () => {
  it("names the section, quotes the block verbatim, and says it located", () => {
    // MUTATION PROOF: return `section: null` unconditionally and this goes red.
    const entry = detail(`## Automating compatibility checks\n\n${BULLET}\n`);
    expect(entry.located).toBe(true);
    expect(entry.section).toBe("Automating compatibility checks");
    expect(entry.quote).toBe(BULLET);
    expect(entry.quoteTruncated).toBe(false);
    // The id/title half is untouched — this is an ADDITIVE enrichment, never a
    // rewrite of the two keys every consumer already reads.
    expect(entry.id).toBe("p1");
    expect(entry.title).toBe("Management Experience");
  });

  it("does not locate on a three-token overlap", () => {
    const body = "## Partner tooling\n\n- We rebuilt the settlement ledger for partner payouts\n";
    const entry = detail(body, "The settlement ledger was replaced.");
    expect(entry.located).toBe(false);
    expect(entry.section).toBe(null);
    expect(entry.quote).toBe(null);
  });

  it("takes its floor from pointLength.js rather than writing a second one", () => {
    // AC-D.1's rule: a threshold restated in a second module is a threshold
    // that drifts from the one the app applies.
    expect(GROUNDED_SPAN_MIN_WORDS).toBe(4);
    expect(SRC).toContain("GROUNDED_SPAN_MIN_WORDS");
    expect(SRC).toContain('from "./pointLength.js"');
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/words\s*[<>]=?\s*\d/);
  });

  it("locates a block that has no heading above it, and names no section", () => {
    // splitBlocks reports headingIndex -1 for a block with nothing above it.
    const entry = detail(`${BULLET}\n`);
    expect(entry.located).toBe(true);
    expect(entry.quote).toBe(BULLET);
    expect(entry.section).toBe(null);
  });

  it("never matches against a heading line itself", () => {
    // A heading is not evidence of where a body claim came from, and a heading
    // block's own headingIndex is -1, so a match there could never name a
    // section anyway. Blanking them out of the candidate set keeps
    // materialQuote's indices aligned with splitBlocks'.
    const heading = "## Built a service that ran compatibility checks";
    const entry = detail(`${heading}\n\n- Unrelated notes about the spring hive inspections\n`);
    expect(entry.located).toBe(false);
    expect(entry.quote).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// AC-CH.3 — ambiguity across sections refuses to guess
// ---------------------------------------------------------------------------
describe("an ambiguous match names no section", () => {
  it("refuses when the same run wins in two different sections", () => {
    // MUTATION PROOF: delete the uniqueness pass and this goes red.
    const body = `## Partner tooling\n\n${BULLET}\n\n## Release engineering\n\n${BULLET}\n`;
    const entry = detail(body);
    expect(entry.located).toBe(false);
    expect(entry.section).toBe(null);
    expect(entry.quote).toBe(null);
    // It still knows the page's own outline, which requires no matching at all.
    expect(entry.outline).toEqual(["Partner tooling", "Release engineering"]);
  });

  it("still locates when the tie is inside ONE section", () => {
    const body = `## Partner tooling\n\n${BULLET}\n\n${BULLET}\n`;
    const entry = detail(body);
    expect(entry.located).toBe(true);
    expect(entry.section).toBe("Partner tooling");
  });
});

// ---------------------------------------------------------------------------
// AC-CH.5 / AC-CH.6 — the blurb is the candidate's own heading or nothing
// ---------------------------------------------------------------------------
describe("the section cap drops the heading rather than truncating it", () => {
  it("drops a heading over the word cap, and keeps the location", () => {
    const long = "The quarterly partner release compatibility verification programme";
    const entry = detail(`## ${long}\n\n${BULLET}\n`);
    expect(entry.located).toBe(true);
    expect(entry.section).toBe(null);
  });

  it("drops a heading over the character cap", () => {
    const long = `Alpha ${"x".repeat(MAX_SECTION_CHARS)}`;
    expect(long.length).toBeGreaterThan(MAX_SECTION_CHARS);
    const entry = detail(`## ${long}\n\n${BULLET}\n`);
    expect(entry.located).toBe(true);
    expect(entry.section).toBe(null);
  });

  it("uses a six-word heading whole — the cap is a cliff, not a trim", () => {
    const six = "Automating the partner release compatibility checks";
    const entry = detail(`## ${six}\n\n${BULLET}\n`);
    expect(entry.section).toBe(six);
    expect(MAX_SECTION_WORDS).toBe(6);
  });

  it("never emits an ellipsis or an em dash in a section", () => {
    // expansionContract.js's rule, restated where it can fail: both are silent
    // at default screen-reader punctuation settings, so a caption whose meaning
    // turns on one is not read out at all.
    const bodies = [
      `## Automating compatibility checks\n\n${BULLET}\n`,
      `## ${"word ".repeat(9)}\n\n${BULLET}\n`,
      `## ${"y".repeat(MAX_SECTION_CHARS + 5)}\n\n${BULLET}\n`,
    ];
    for (const body of bodies) {
      const entry = detail(body);
      const section = entry.section || "";
      expect(section).not.toContain("…");
      expect(section).not.toContain("...");
      expect(section).not.toContain("—");
    }
  });

  it("refuses a heading with no alphanumeric character in it", () => {
    const entry = detail(`## ---\n\n${BULLET}\n`);
    expect(entry.located).toBe(true);
    expect(entry.section).toBe(null);
  });

  it("refuses a heading that merely repeats the page title", () => {
    // Otherwise the line reads "From your Management Experience page, under
    // Management experience."
    const entry = detail(`## Management experience\n\n${BULLET}\n`);
    expect(entry.located).toBe(true);
    expect(entry.section).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// AC-CH.7 — the outline is the page's own headings, in document order
// ---------------------------------------------------------------------------
describe("the outline", () => {
  it("is capped, in document order, with the remainder counted", () => {
    const headings = Array.from({ length: 12 }, (_, i) => `## Section ${i}`);
    const body = `${headings.join("\n\n")}\n\n- Unrelated notes about the spring hive inspections\n`;
    const entry = citationDetail(cite(), { point: "Nothing matches here at all.", page: pageOf(body) });
    expect(entry.outline).toHaveLength(MAX_OUTLINE_HEADINGS);
    expect(entry.outline[0]).toBe("Section 0");
    expect(entry.outline[MAX_OUTLINE_HEADINGS - 1]).toBe(`Section ${MAX_OUTLINE_HEADINGS - 1}`);
    expect(entry.outlineMore).toBe(12 - MAX_OUTLINE_HEADINGS);
    for (const heading of entry.outline) expect(heading).not.toMatch(/^#|\s$/);
  });

  it("drops an over-long heading from the outline rather than trimming it", () => {
    const body = `## Fine\n\n## ${"z".repeat(MAX_HEADING_CHARS + 1)}\n\n## Also fine\n\n- Hive notes\n`;
    const entry = citationDetail(cite(), { point: "Nothing matches.", page: pageOf(body) });
    expect(entry.outline).toEqual(["Fine", "Also fine"]);
  });

  it("returns the entry UNCHANGED when there is neither a location nor an outline", () => {
    // The byte-identity guarantee, at the wire. A page with no headings that
    // nothing matched has nothing to reveal, so a control over it would open on
    // an empty panel — worse than no control. This is also exactly what keeps
    // route.knowledgeBase.test.js's four `toEqual([{ id, title }, null])`
    // assertions green.
    const original = cite();
    const entry = citationDetail(original, {
      point: "Nothing here matches anything at all.",
      page: pageOf("- Unrelated notes about the spring hive inspections\n"),
    });
    expect(entry).toEqual({ id: "p1", title: "Management Experience" });
    expect(Object.keys(entry).sort()).toEqual(["id", "title"]);
  });
});

// ---------------------------------------------------------------------------
// AC-CH.10 — the strip agrees with knowledgeBase.js's own heading detector
// ---------------------------------------------------------------------------
describe("headingText agrees with splitBlocks about what a heading is", () => {
  it("strips exactly the lines splitBlocks calls headings", () => {
    // The three-space case is the defect knowledgeBase.js:215-221 records: the
    // leading ` {0,3}` is load-bearing, and a strip anchored at column 0 would
    // silently disagree on an indented heading.
    const cases = ["# A", "## A", "### A", "   ## A", "#NoSpace", "#### Four", "Not a heading", "  - a list item"];
    for (const line of cases) {
      const blocks = splitBlocks(line);
      const isHeading = blocks.length === 1 && blocks[0].kind === "heading";
      expect(headingText(line) !== line.trim(), `disagreed on ${JSON.stringify(line)}`).toBe(isHeading);
    }
  });

  it("[control] the agreement check can fail", () => {
    // Without this the loop above passes for a headingText that strips nothing.
    expect(headingText("### A")).toBe("A");
    expect(headingText("#### Four")).toBe("#### Four");
  });
});

// ---------------------------------------------------------------------------
// AC-CH.8 / AC-CH.9 — total by construction, and bounded
// ---------------------------------------------------------------------------
describe("attachCitationDetail is total, non-mutating and bounded", () => {
  const HOSTILE = [
    [null, null],
    [undefined, undefined],
    [[], {}],
    [[null, null], { points: ["a"], pages: null }],
    [[{ id: "p1", title: "T" }], { points: [], pages: [] }],
    [[{ id: "p1", title: "T" }], { points: ["...!?"], pages: [{ id: "p1", title: "T", body: 42 }] }],
    [[{ id: "nope", title: "T" }], { points: ["x"], pages: [{ id: "p1", title: "T", body: "# A\n\nb\n" }] }],
    [[{ id: "p1", title: "T" }, { id: "p1", title: "T" }], { points: ["only one"], pages: [{ id: "p1", title: "T", body: "x" }] }],
    [["not an object", 7], { points: ["a", "b"], pages: [] }],
    [[{ id: "p1", title: "T" }], { points: ["a"], pages: [{ id: "p1", title: "T", body: "q ".repeat(100000) }] }],
  ];

  it("never throws on any hostile input", () => {
    for (const [sources, options] of HOSTILE) {
      expect(() => attachCitationDetail(sources, options)).not.toThrow();
    }
  });

  it("never mutates the array it was given, nor any entry in it", () => {
    for (const [sources, options] of HOSTILE) {
      const before = JSON.parse(JSON.stringify(sources ?? null));
      attachCitationDetail(sources, options);
      expect(JSON.parse(JSON.stringify(sources ?? null))).toEqual(before);
    }
  });

  it("keeps [] as [] — the 'nothing to cite at all' signal downstream reads", () => {
    // pageCitations.js:38-43: [] rather than [null, null] is what makes the
    // render surface show nothing at all. This module must not launder it.
    expect(attachCitationDetail([], { points: [], pages: [] })).toEqual([]);
  });

  it("pairs each citation with its OWN point, positionally", () => {
    const other = "- Reconciled every settlement by hand for a week after the outage";
    const body = `## Automating compatibility checks\n\n${BULLET}\n\n## Incident response\n\n${other}\n`;
    const pages = [pageOf(body)];
    const out = attachCitationDetail([cite(), cite()], {
      points: ["Reconciled every settlement by hand for a week.", POINT],
      pages,
    });
    expect(out[0].section).toBe("Incident response");
    expect(out[1].section).toBe("Automating compatibility checks");
  });

  it("bounds what one enriched entry can put on the wire", () => {
    // The analytic worst case: MAX_QUOTE_CHARS (600, up to 2 bytes per
    // character once JSON-escaped) + MAX_SECTION_CHARS (60) +
    // MAX_OUTLINE_HEADINGS x MAX_HEADING_CHARS (480) + the key names.
    const filler = Array.from({ length: 12 }, (_, i) => `## Section ${i}\n\n${"detail ".repeat(400)}`).join("\n\n");
    const body = `## Automating compatibility checks\n\n${BULLET}\n\n${filler}\n`;
    expect(body.length).toBeGreaterThan(30000);
    const out = attachCitationDetail(Array.from({ length: 5 }, () => cite()), {
      points: Array.from({ length: 5 }, () => POINT),
      pages: [pageOf(body)],
    });
    for (const entry of out) {
      expect(entry.quote.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
      expect(JSON.stringify(entry).length).toBeLessThanOrEqual(2100);
    }
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(11000);
  });

  it("says so when the quote was cut, and cuts on a line boundary", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `- Ran compatibility checks against partner release ${i}`);
    const body = `## Automating compatibility checks\n\n${lines.join("\n  ")}\n`;
    const entry = detail(body, "Ran compatibility checks against partner release 3.");
    expect(entry.located).toBe(true);
    expect(entry.quoteTruncated).toBe(true);
    expect(entry.quote.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
    expect(entry.quote).not.toContain("…");
    expect(entry.quote).not.toContain("—");
  });
});

// ---------------------------------------------------------------------------
// AC-CH.11 — this module must not reach the browser bundle
// ---------------------------------------------------------------------------
describe("the bundle guard", () => {
  // An IMPORT SPECIFIER, not a bare substring: AnswerLines.js names this
  // module's path in prose, in a comment that exists to explain where the
  // enrichment comes from. A sweep that could not tell the two apart would
  // either fail on its own documentation or have to have that documentation
  // deleted to stay green.
  const IMPORT_RE = /(?:from|import)\s*\(?\s*["'][^"']*\/citationDetail(?:\.js)?["']/;

  function appFilesImporting() {
    const root = path.join(process.cwd(), "app");
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.jsx?$/.test(d.name) && !d.name.includes(".test."))
      .map((d) => path.relative(process.cwd(), path.join(d.parentPath || d.path, d.name)).split(path.sep).join("/"))
      .filter((rel) => IMPORT_RE.test(readFileSync(path.join(process.cwd(), rel), "utf8")));
  }

  it("is imported under app/ by the answer route and nothing else", () => {
    // It imports splitBlocks from lib/experience/knowledgeBase.js, which pulls
    // in pageContext.js, projectStories.js, pageRanking.js and a stopword JSON.
    // That weight is acceptable ONLY because every importer is server-side.
    expect(appFilesImporting()).toEqual(["app/api/copilot/answer/route.js"]);
  });

  it("[control] the sweep can actually fail, and does not fire on prose", () => {
    expect(IMPORT_RE.test('import { citationDetail } from "@/lib/copilot/citationDetail";')).toBe(true);
    expect(IMPORT_RE.test('const x = await import("../../lib/copilot/citationDetail.js");')).toBe(true);
    expect(IMPORT_RE.test("// see lib/copilot/citationDetail.js for the derivation")).toBe(false);
  });

  it("is named in knowledgeBase.js's own list of its importers", () => {
    // That header states its importer list as a VERIFIED FACT about the tree.
    // A new importer falsifies it, so it is corrected in the same commit.
    const kb = readFileSync(path.join(process.cwd(), "lib/experience/knowledgeBase.js"), "utf8");
    expect(kb).toContain("lib/copilot/citationDetail.js");
  });
});
