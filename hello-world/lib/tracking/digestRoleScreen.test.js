// ---------------------------------------------------------------------------
// N49/N51 TDD hand-off -- the DIGEST NAME SCREEN (plan.r2.md sections 2.2 and
// 4.5, carried unchanged by plan.r4.md section 9; AC-N51.3, AC-N51.5).
//
// WHAT THIS IS FOR. The company digest is model prose about a real employer.
// Once N49 asks that prose for an "## Interview process" section, the model
// will start writing lines like "  - Conducted by: Sarah Chen." -- a named
// human being, attributed to the candidate's own interview, on a page the
// candidate reads as fact. This screen is what stops that line reaching any
// digest surface. It runs on the stored markdown, so it also covers digests
// written before the rule existed.
//
// TWO ROUTES, AND WHY THE SPLIT IS THE WHOLE POINT (plan.r2.md section 2.2).
//   Route B -- a STRONG label ("conducted by", "interviewed by", "led by",
//     "run by", "hosted by", "interviewer(s)", "panelist(s)") followed by a
//     colon or a dash. The remainder is CLAIMED to be who conducts the
//     interview, so it is withheld unless the allow-list ADMITS it as a job.
//     This is the only route that can catch "Interviewer: Sarah." and
//     "Conducted by: sarah chen." -- a lone first name is not a Title-Case
//     pair and lower case is not Title-Case at all, so no name detector, on
//     either side, sees either of them.
//   Route A -- a strong label followed by bare whitespace (ordinary prose:
//     "Interviewers were friendly."), or a WEAK colon-only label ("with",
//     "who", "people", "panel", "name(s)"). These are not claims about who
//     conducts anything, so the allow-list would withhold most ordinary
//     sentences. They are withheld only when the remainder contains a person
//     span.
// Mutant MD-1 deletes route B. The four rows below marked [MD-1] are what
// notices: two withheld under B, and two nearly identical controls that must
// stay KEPT under A. Without the controls, "withhold every attribution line"
// passes the first two and silently eats half the digest.
//
// ACCENTED NAMES (m4). The shipped detector's Title-Case run is ASCII, so
// "José García" walks straight through it today. The fix takes the UNION of
// an ASCII run and a Unicode run, and the union is load-bearing in BOTH
// directions: a Unicode run with a lookbehind misses "eSarah Chen" (the
// letter before "Sarah" stops the boundary) where the ASCII run finds it, and
// the ASCII run misses "Günter Weiß" where the Unicode run finds it. Mutants
// MN-8 and MN-9 are exactly those two halves; the rows below marked [union]
// are what kill them.
//
// RED ON HEAD: `lib/tracking/digestRoleScreen.js` does not exist. The
// dynamic import is deliberate -- a static one fails the file at collection
// and reports no `Tests` line, and a run with no test count is inconclusive,
// not red.
//
// WHAT THIS FILE CANNOT ASSERT:
//   * `DIGEST_SCREEN_RULE_ID`'s VALUE. It is a content hash over seven files
//     (plan.r2.md section 2.2 item 5) and T4b owns recomputing it. Here it is
//     only ever used as an opaque token, which is what the client does.
//   * The SERVER screen's own output. `digestNamedLines.js` is server-only
//     and holds the lexicon; T3 owns it. The superset property below asserts
//     the relationship between the two, which is the property that matters
//     for the client: it may over-withhold, never under-withhold.
//   * That a withheld line is presented WELL. DigestPanel files it under
//     "also searched"; T6 owns that rendering.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { markdownStamp } from "./renderCitedMarkdown.js";
import { GIVEN_NAMES } from "@/lib/interviewPrep/data/givenNames.generated.js";

let SCREEN = null;
let SCREEN_ERROR = null;
try {
  SCREEN = await import("./digestRoleScreen.js");
} catch (err) {
  SCREEN_ERROR = err;
}

function screen() {
  if (!SCREEN) throw new Error(`lib/tracking/digestRoleScreen.js is not written yet: ${SCREEN_ERROR?.message}`);
  return SCREEN;
}

const EMPLOYER = "Northwind Payments";

/** Every fixed row, as [line, verdict, why]. `true` means WITHHELD. The
 *  "why" is not decoration: when one of these flips, the question is always
 *  which route decided it, and the answer has to be in the row. */
const LINES = [
  // ---- route B: a strong label with a separator; the allow-list decides ----
  ["  - Interviewer: Sarah.", true, "[MD-1] route B, remainder is not a job; no detector sees a lone first name"],
  ["  - Conducted by: sarah chen.", true, "[MD-1] route B, remainder is not a job; lower case defeats every Title-Case run"],
  ["  - Conducted by: Sarah Chen.", true, "route B, remainder is not a job"],
  ["  - Interviewers: Priya Nair and Dana Whitfield.", true, "route B, two names"],
  ["  - Panelists - Jordan Lee.", true, "route B with a dash separator"],
  ["  - Led by: Emily Nguyen.", true, "route B, remainder is not a job"],
  ["  - Interviewed by: Ana Ruiz, Director of Engineering.", true, "route B, a name beside a real title is still a name"],
  ["  - Conducted by: Hiring Manager.", false, "route B, remainder IS a job"],
  ["  - Interviewer: Talent Acquisition Partner.", false, "route B, remainder IS a job"],
  ["  - Panelists: the Platform team.", false, "route B, remainder IS a team"],
  ["  - Led by: Engineering Manager.", false, "route B, remainder IS a job"],
  // ---- route A: weak label, or a strong label in ordinary prose ----
  ["  - With: Sarah.", false, "[MD-1] control: weak label, no person SPAN, so route A keeps it"],
  ["  - With: sarah chen.", false, "[MD-1] control: weak label, lower case is not a span, so route A keeps it"],
  ["  - With: the Platform team.", false, "weak label, vocabulary phrase"],
  ["  - With: Sarah Chen.", true, "weak label, remainder carries a person span"],
  ["  - Panel: Priya Nair and Dana Whitfield.", true, "weak label, remainder carries person spans"],
  ["Panel: a take-home review and a debrief.", false, "weak label, no span -- an ordinary description of a stage"],
  ["Interviewers were friendly.", false, "strong label, BARE whitespace: prose, so route A, and no span"],
  ["Interviewers asked about my last project.", false, "strong label, bare whitespace, no span"],
  ["Led by example, the team ships weekly.", false, "strong label, bare whitespace, no span"],
  // ---- stage and question lines: the item carries the test ----
  ["- Stage: Onsite with Sarah Chen.", true, "item carries a person span"],
  ["  - Question: Sarah Chen asked about system design?", true, "item carries a person span"],
  ["- **Stage**: Onsite with Sarah Chen.", true, "bold markup variant"],
  ["- Stage - Onsite with Sarah Chen.", true, "dash separator variant"],
  ["- Stage: Onsite loop.", false, "no span"],
  ["  - Question: How do you roll back a release?", false, "no span"],
  ["  - Conducted by: the Platform team.", false, "a team is a legitimate answer to who conducts it"],
  // ---- m4, accented names. [union] marks the rows that kill MN-8/MN-9. ----
  ["- Stage: Onsite with José García.", true, "[union] Unicode run; the ASCII run misses it"],
  ["  - Question: Why did Günter Weiß leave?", true, "[union] Unicode run; the ASCII run misses it"],
  ["  - Conducted by: José García.", true, "route B; an accented name is not a job either"],
  ["  - With: Zoë Kravitz.", true, "[union] weak label, Unicode span"],
  ["  - Question: éSarah Chen asked about rollbacks?", true, "[union] the ASCII run; a Unicode lookbehind run misses it"],
  ["- Stage: Café chat.", false, "[union] control: one accented Title-Case word is not a PAIR"],
  // ---- the employer is not a person, but it is not a JOB either ----
  // Measured in the reference tree: this row is WITHHELD, and the first
  // draft of this table had it as KEPT. The employer exemption stops a
  // company name counting as a PERSON, which is a route-A and item-route
  // question; route B asks the different question "is the remainder a job
  // title", and a company is not one. The line is a fail-closed loss, of
  // exactly the kind design.r3.md section 8.5 names as the cost of route B,
  // and it is harmless: nothing is hidden about a human being.
  ["  - Conducted by: Northwind Payments.", true, "route B fail-closed: a company is not a job title"],
  ["- Stage: Onsite at Northwind Payments.", false, "item route: employer-covered span is not a person"],
];

describe("isWithheldDigestLine -- the fixed rows, each naming the route that decides it", () => {
  it.each(LINES)("%s", (line, withheld) => {
    expect(screen().isWithheldDigestLine(line, { employer: EMPLOYER })).toBe(withheld);
  });

  it("[control] the row table exercises BOTH verdicts and both accent classes", () => {
    // A table that drifted to all-withheld would make "withhold everything"
    // pass every row above, and a table with no accented rows would make
    // MN-8/MN-9 unkillable. This is the canary on the corpus, not on the
    // build.
    const withheld = LINES.filter(([, w]) => w).length;
    expect(withheld).toBeGreaterThanOrEqual(10);
    expect(LINES.length - withheld).toBeGreaterThanOrEqual(10);
    expect(LINES.filter(([line]) => /[^ -]/.test(line)).length).toBeGreaterThanOrEqual(6);
  });

  it("never throws, and treats every non-string as not-withheld", () => {
    const { isWithheldDigestLine } = screen();
    for (const value of [undefined, null, 0, {}, [], true]) {
      expect(isWithheldDigestLine(value, { employer: EMPLOYER })).toBe(false);
    }
    // No context at all is the tracking-cell call shape.
    expect(isWithheldDigestLine("  - Conducted by: Sarah Chen.")).toBe(true);
  });

  it("without an employer, the employer rows fail CLOSED rather than open", () => {
    // The exemption can only ever SUBTRACT. A call with no employer must
    // therefore withhold at least as much as a call with one -- never less.
    // A build that read a missing employer as "exempt everything" would pass
    // every row above and hide every name on the tracking cell, which is the
    // one surface that has no employer to hand.
    const { isWithheldDigestLine } = screen();
    for (const [line, withheld] of LINES) {
      if (withheld) expect(isWithheldDigestLine(line, {})).toBe(true);
    }
  });
});

describe("attributionMatch and itemMatch -- the two parsers the rule is built on", () => {
  it("reports the label's strength and whether it was separated", () => {
    const { attributionMatch } = screen();
    expect(attributionMatch("  - Conducted by: Hiring Manager.")).toMatchObject({ strong: true, separated: true });
    expect(attributionMatch("Interviewers were friendly.")).toMatchObject({ strong: true, separated: false });
    expect(attributionMatch("  - With: Sarah Chen.")).toMatchObject({ strong: false, separated: true });
    expect(attributionMatch("The team ships weekly.")).toBeNull();
  });

  it("returns the remainder without the label or the list marker", () => {
    const { attributionMatch } = screen();
    expect(attributionMatch("  - Conducted by: Hiring Manager.").remainder).toBe("Hiring Manager.");
    expect(attributionMatch("- **Interviewer**: Hiring Manager.").remainder).toBe("Hiring Manager.");
  });

  it("requires a non-letter after the label, so a longer word is not a label", () => {
    // "Panelists" must match and "Withdrawn" must not: without the
    // `(?![A-Za-z])` guard, "with" matches the first four letters of
    // "Withdrawn from the process." and a normal sentence is screened as an
    // attribution.
    const { attributionMatch } = screen();
    expect(attributionMatch("Withdrawn from the process.")).toBeNull();
    expect(attributionMatch("Panelist: Hiring Manager.")).not.toBeNull();
  });

  it("normalises the spaces and zero-width characters a model actually emits", () => {
    // A non-breaking space between the label and the colon, or a zero-width
    // joiner inside the name, is how a screen gets bypassed without anybody
    // typing anything unusual. Both appear in real model output.
    const { isWithheldDigestLine } = screen();
    expect(isWithheldDigestLine("  - Conducted by : Sarah Chen.", { employer: EMPLOYER })).toBe(true);
    expect(isWithheldDigestLine("  - With: Sar​ah Chen.", { employer: EMPLOYER })).toBe(true);
  });

  it("itemMatch reads a stage or question line's own item, through its markup", () => {
    const { itemMatch } = screen();
    expect(itemMatch("- Stage: Onsite loop.")).toEqual({ kind: "stage", item: "Onsite loop." });
    expect(itemMatch("  - Question: How do you roll back a release?")).toEqual({
      kind: "question",
      item: "How do you roll back a release?",
    });
    expect(itemMatch("- **Stage**: Onsite loop.")).toMatchObject({ kind: "stage" });
    expect(itemMatch("Just a sentence.")).toBeNull();
  });
});

describe("the client fallback is a SUPERSET of the person test, over the real lexicon", () => {
  // The client screen cannot hold 100,364 given names -- shipping the lexicon
  // to a browser is the thing every purity sweep in this repo exists to
  // prevent -- so it uses a shape rule instead: any Title-Case pair, minus
  // vocabulary, minus a closed list of first words that are not given names,
  // minus employer-covered spans. That is only safe if it withholds
  // EVERYTHING the lexicon-backed rule would. This property is that claim.
  //
  // The pairs are built from the REAL lexicon rather than from a list this
  // test wrote, so the property is measured against the same names the server
  // screen keys on. Deterministic sampling with a printed stride, not a PRNG:
  // there is no distribution here to explore, only coverage of a sorted list.
  const SURNAMES = ["Chen", "Garcia", "Okafor", "Whitfield", "Nguyen", "Kowalski", "Haddad", "Silva"];

  function samplePairs(count) {
    const stride = Math.max(1, Math.floor(GIVEN_NAMES.length / count));
    const pairs = [];
    for (let i = 0; pairs.length < count && i < GIVEN_NAMES.length; i += stride) {
      const given = GIVEN_NAMES[i];
      if (typeof given !== "string" || given.length < 2) continue;
      const first = given[0].toUpperCase() + given.slice(1).toLowerCase();
      pairs.push(`${first} ${SURNAMES[pairs.length % SURNAMES.length]}`);
    }
    return pairs;
  }

  it("withholds a weak-label line for at least 800 real given-name pairs", () => {
    const { isWithheldDigestLine } = screen();
    const pairs = samplePairs(800);
    console.log(`[N49 superset] lexicon=${GIVEN_NAMES.length} sampled=${pairs.length} stride=${Math.floor(GIVEN_NAMES.length / 800)}`);
    expect(pairs.length).toBe(800);
    const missed = pairs.filter((pair) => !isWithheldDigestLine(`  - With: ${pair}.`, { employer: EMPLOYER }));
    expect(missed).toEqual([]);
  });

  it("[canary] the lexicon really is the one the server keys on", () => {
    // A canary built from the same source as the thing under test proves
    // consistency, not correctness -- so this asserts against outside facts:
    // "maria" is one of the most common given names in the world and must be
    // present, and "qzxlon" is not a name in any language and must not be.
    const set = new Set(GIVEN_NAMES);
    expect(set.has("maria")).toBe(true);
    expect(set.has("qzxlon")).toBe(false);
    expect(GIVEN_NAMES.length).toBeGreaterThan(50000);
  });

  it("[permitted drop] over-withholding is allowed and is what the fallback is FOR", () => {
    // The fallback may withhold a line the server would keep -- a Title-Case
    // pair that happens not to be a name. That is the accepted direction, and
    // it is stated here so nobody later "fixes" it by narrowing the shape
    // rule. The disclosed example the design names: a place whose first word
    // is in the lexicon.
    const { isWithheldDigestLine } = screen();
    expect(isWithheldDigestLine("  - Question: Why São Paulo?", { employer: EMPLOYER })).toBe(true);
  });
});

describe("withholdDigestLines -- which set it trusts, and the splice invariant", () => {
  const MARKDOWN = [
    "## Interview process",
    "- Stage: Recruiter screen.",
    "  - Conducted by: Sarah Chen.",
    "  - Question: How do you roll back a release?",
    "- Stage: Onsite loop.",
  ].join("\n");

  const storedOutcome = (overrides = {}) => ({
    ...markdownStamp(MARKDOWN),
    withheldLines: [2],
    withheldLinesRule: screen().DIGEST_SCREEN_RULE_ID,
    ...overrides,
  });

  it("uses the STORED set when the rule id and the markdown stamp both match", () => {
    const out = screen().withholdDigestLines({ markdown: MARKDOWN, outcome: storedOutcome(), context: { employer: EMPLOYER } });
    expect(out.basis).toBe("stored");
    expect(out.withheld).toBe(1);
    expect(out.presentation.split("\n")).toHaveLength(MARKDOWN.split("\n").length - 1);
    expect(out.presentation).not.toContain("Sarah Chen");
  });

  it("falls back to re-screening when the stored rule id is a DIFFERENT rule's", () => {
    // Every step from S3 to S5 edits a hashed file, so a digest researched
    // mid-chunk carries a stale id. Trusting it would apply an older rule's
    // verdicts to today's prose -- which is how a line that a NEW rule
    // withholds gets shown because an OLD run said it was fine.
    const out = screen().withholdDigestLines({
      markdown: MARKDOWN,
      outcome: storedOutcome({ withheldLinesRule: "dsr-0000000000000000", withheldLines: [] }),
      context: { employer: EMPLOYER },
    });
    expect(out.basis).toBe("fallback");
    expect(out.presentation).not.toContain("Sarah Chen");
  });

  it("falls back when the markdown no longer matches the stamp the set was computed over", () => {
    const tampered = MARKDOWN.replace("Onsite loop.", "Onsite with Priya Nair.");
    const out = screen().withholdDigestLines({ markdown: tampered, outcome: storedOutcome(), context: { employer: EMPLOYER } });
    expect(out.basis).toBe("fallback");
    expect(out.presentation).not.toContain("Sarah Chen");
    expect(out.presentation).not.toContain("Priya Nair");
  });

  it.each([
    ["a non-array", { withheldLines: "2" }],
    ["an out-of-range index", { withheldLines: [99] }],
    ["a non-integer index", { withheldLines: [1.5] }],
    ["a duplicated index", { withheldLines: [2, 2] }],
    ["a negative index", { withheldLines: [-1] }],
  ])("falls back when the stored set is %s", (_why, overrides) => {
    const out = screen().withholdDigestLines({ markdown: MARKDOWN, outcome: storedOutcome(overrides), context: { employer: EMPLOYER } });
    expect(out.basis).toBe("fallback");
    expect(out.presentation).not.toContain("Sarah Chen");
  });

  it("returns its inputs unchanged, with basis \"none\", when nothing is withheld", () => {
    const clean = "## Interview process\n- Stage: Onsite loop.";
    const accepted = [{ start: 0, end: 10 }];
    const out = screen().withholdDigestLines({ markdown: clean, presentation: clean, accepted, context: { employer: EMPLOYER } });
    expect(out.basis).toBe("none");
    expect(out.presentation).toBe(clean);
    expect(out.accepted).toEqual(accepted);
    expect(out.withheld).toBe(0);
  });

  it("drops every accepted citation whose span lies inside a withheld line, and keeps the rest", () => {
    // The citation markers are offsets into the presentation string. Splice a
    // line out and leave its markers behind and the digest renders a
    // superscript pointing at text that is no longer there -- or, worse, at
    // whatever moved into those bytes.
    const lines = MARKDOWN.split("\n");
    const startOf = (i) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    const accepted = [
      { start: startOf(1), end: startOf(1) + 5 },
      { start: startOf(2), end: startOf(2) + 5 },
      { start: startOf(4), end: startOf(4) + 5 },
    ];
    const out = screen().withholdDigestLines({
      markdown: MARKDOWN,
      presentation: MARKDOWN,
      accepted,
      outcome: storedOutcome(),
      context: { employer: EMPLOYER },
    });
    expect(out.accepted).toHaveLength(2);
    expect(out.accepted.map((a) => a.start)).toEqual([accepted[0].start, accepted[2].start]);
  });

  it("fails CLOSED when the presentation has a different line count from the stored markdown", () => {
    // Residue removal, a re-render, or an older writer can leave the
    // presentation and the stored markdown out of step. An index-based splice
    // is then cutting the wrong lines, so the rule stops indexing and
    // re-screens the presentation itself, dropping every accepted entry
    // because none of their offsets can be trusted either.
    const presentation = `${MARKDOWN}\nA line the stored markdown does not have.`;
    const out = screen().withholdDigestLines({
      markdown: MARKDOWN,
      presentation,
      accepted: [{ start: 0, end: 5 }],
      outcome: storedOutcome(),
      context: { employer: EMPLOYER },
    });
    expect(out.presentation).not.toContain("Sarah Chen");
    expect(out.accepted).toEqual([]);
  });

  it("[control] a clean digest survives the whole path with every line intact", () => {
    // The over-fire control for this entire describe block. Without it,
    // `withholdDigestLines = () => ({ presentation: "", accepted: [], ... })`
    // passes every "does not contain a name" row above.
    const clean = ["## Interview process", "- Stage: Recruiter screen.", "  - Conducted by: Hiring Manager."].join("\n");
    const out = screen().withholdDigestLines({ markdown: clean, outcome: storedOutcome({ withheldLines: [] }), context: { employer: EMPLOYER } });
    expect(out.presentation.split("\n")).toHaveLength(3);
    expect(out.presentation).toContain("Hiring Manager");
    expect(out.withheld).toBe(0);
  });

  it("DIGEST_SCREEN_RULE_ID is a non-empty dsr- prefixed literal", () => {
    // Its VALUE is T4b's; all this file needs is that it exists and is the
    // shape the client compares against.
    expect(screen().DIGEST_SCREEN_RULE_ID).toMatch(/^dsr-[0-9a-f]{16}$/);
  });
});
