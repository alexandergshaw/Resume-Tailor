// N104 Step 2 (4b) - compareReviewGaps: the before/after gap comparison that
// drives the "What regenerating changed" report (AC-4, design r2 §5, D-5).
//
// WHY THIS IS A POWER ROW (F1 defense-in-depth). The whole safety value of the
// regenerate report is that it reports a weakness "no longer flagged" ONLY when a
// re-review actually shows it gone. Two traps make a false closure easy, and this
// file is the instrument against both:
//   R2  the CORRESPONDENCE GUARD. req ids are `q${n}` minted by model output order
//       (idealStageResult.js:137); if the before/after id sets do not correspond,
//       a still-missing keyword whose req drifted id reads as "closed". The guard
//       must suppress ALL per-gap closure and fall back to count-deltas.
//   R3  the CLOSURE KEY (category, origin, requirementId, term). One requirement
//       emits one missing-keyword flag PER term, all sharing req.id
//       (mechanicalDetectors.js:190-199); without `term` in the key, two terms
//       under one requirement merge and one closing hides the other.
//
// RED on HEAD: lib/review/compareReviewGaps.js does not exist (import fails =
// collection failure); this unit is NET-NEW, so import-absence is the honest RED
// (there is no shipped unit to stub). Satisfiability proven by the scratchpad
// reference build; mutants R2 (drop guard) and R3 (drop term) watched there.
//
// The missing-keyword flags are built by the REAL detectMissingKeyword so the
// message format (and therefore the term-parse contract) is exactly the shipped
// one, never a convenient hand-typed string (rule: canary the parser on a real
// message).

import { describe, it, expect } from "vitest";
import { compareReviewGaps } from "./compareReviewGaps.js";
import { detectMissingKeyword } from "./mechanicalDetectors.js";
import { CATEGORY, ORIGIN } from "./contract.js";

// ---- real reviewer flags, not hand-typed -----------------------------------

const draftWith = (lines) => ({
  kind: "applicationReady",
  spans: lines.map((text, i) => ({ id: `s${i + 1}`, text })),
});

// The first double-quoted substring of a missing-keyword message IS the term
// (mechanicalDetectors.js:197). This is the parse the key depends on; the test
// derives its expectations from it so test and implementation agree only when the
// implementation reads the SAME substring.
const normTerm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");
function termOf(flag) {
  const m = /"([^"]+)"/.exec(flag.message || "");
  return m ? normTerm(m[1]) : null;
}

// A requirement that names two distinct taxonomy keywords, so one req yields >=2
// missing-keyword flags sharing req.id (the R3 collision the term disambiguates).
const TWO_TERM_REQ = {
  id: "q3",
  text: "Hands-on experience with payment processing, PCI compliance, and Kubernetes.",
};
const KW_POSTING = { requirements: [TWO_TERM_REQ] };

// A draft mentioning none of the req's keywords -> both terms flagged.
const BEFORE_DRAFT = draftWith(["Built internal tools and reporting dashboards", "Mentored two engineers"]);

const reviewOf = (flags, extra = {}) => ({
  status: "reviewed",
  draftKind: "applicationReady",
  flags,
  unresolvedQualifications: [],
  lineCount: 10,
  ...extra,
});

describe("compareReviewGaps - R3 closure key keeps the term (two terms, one req id)", () => {
  const beforeFlags = detectMissingKeyword(BEFORE_DRAFT, KW_POSTING);

  it("the fixture really produces two flags that SHARE req.id but differ by term (power check)", () => {
    expect(beforeFlags.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(beforeFlags.map((f) => f.evidenceRef.spanId));
    expect([...ids]).toEqual(["q3"]); // one requirement
    const terms = new Set(beforeFlags.map(termOf));
    expect(terms.size).toBeGreaterThanOrEqual(2); // distinct terms
    expect([...terms].every((t) => t !== null)).toBe(true);
  });

  it("closes ONLY the term the re-review shows gone; the other stays open (no merge)", () => {
    // Pick two distinct terms from the real flags.
    const terms = [...new Set(beforeFlags.map(termOf))];
    const [closedTerm, openTerm] = terms;
    // After: the re-review still flags only `openTerm` under q3.
    const afterFlags = beforeFlags.filter((f) => termOf(f) === openTerm);

    const report = compareReviewGaps({
      before: reviewOf(beforeFlags),
      after: reviewOf(afterFlags),
      resolvable: beforeFlags,
      beforeRequirementIds: ["q3"],
      afterRequirementIds: ["q3"],
    });

    expect(report.correspondenceUnavailable).toBe(false);
    const closedTerms = report.closed.map((c) => normTerm(c.term));
    const openTerms = report.stillOpen.map((c) => normTerm(c.term));
    expect(closedTerms).toContain(closedTerm);
    expect(closedTerms).not.toContain(openTerm); // MUTANT (drop term): both merge -> this reds
    expect(openTerms).toContain(openTerm);
    expect(openTerms).not.toContain(closedTerm);
    // Every closed/stillOpen row carries the posting key components.
    for (const row of [...report.closed, ...report.stillOpen]) {
      expect(row.category).toBe(CATEGORY.MISSING_KEYWORD);
      expect(row.requirementId).toBe("q3");
      expect(typeof row.term).toBe("string");
    }
  });
});

describe("compareReviewGaps - R2 runtime correspondence guard (F1 backstop)", () => {
  const beforeFlags = detectMissingKeyword(BEFORE_DRAFT, KW_POSTING);

  it("NON-corresponding id sets suppress ALL per-gap closure (count deltas only)", () => {
    // Same flags persist (nothing actually closed), but the id sets differ, as
    // they would when a fresh posting analysis re-minted ids. A build that trusts
    // per-gap identity here would emit a FALSE "no longer flagged".
    const report = compareReviewGaps({
      before: reviewOf(beforeFlags),
      after: reviewOf(beforeFlags), // identical -> nothing closed in truth
      resolvable: beforeFlags,
      beforeRequirementIds: ["q3"],
      afterRequirementIds: ["q4"], // DRIFTED
    });
    expect(report.correspondenceUnavailable).toBe(true);
    expect(report.closed).toEqual([]); // MUTANT (remove guard): emits false closed -> reds
    expect(report.stillOpen).toEqual([]);
    // Count deltas are still reported even under the guard.
    expect(report.countsBefore.missingKeyword).toBe(beforeFlags.length);
    expect(report.countsAfter.missingKeyword).toBe(beforeFlags.length);
  });

  it("POSITIVE control: corresponding sets WITH a genuinely-closed gap do report it", () => {
    const terms = [...new Set(beforeFlags.map(termOf))];
    const afterFlags = beforeFlags.filter((f) => termOf(f) !== terms[0]); // first term closed
    const report = compareReviewGaps({
      before: reviewOf(beforeFlags),
      after: reviewOf(afterFlags),
      resolvable: beforeFlags,
      beforeRequirementIds: ["q3"],
      afterRequirementIds: ["q3"], // CORRESPOND
    });
    expect(report.correspondenceUnavailable).toBe(false);
    expect(report.closed.map((c) => normTerm(c.term))).toContain(terms[0]);
  });
});

describe("compareReviewGaps - draft-anchored gaps are count deltas, never per-line closed (G-2)", () => {
  const vague = (spanId) => ({
    draftKind: "applicationReady",
    spanId,
    category: CATEGORY.VAGUE_UNSUPPORTED,
    message: "Vague and unsupported: it opens with \"worked on\" and states no concrete outcome.",
  });
  const rep = (spanId) => ({
    draftKind: "applicationReady",
    spanId,
    category: CATEGORY.REPETITION,
    message: "Repeats \"led the team\", which another span already uses.",
    evidenceRef: { origin: ORIGIN.DRAFT, draftKind: "applicationReady", spanId: "s1" },
  });

  it("vague/repetition report as category count deltas and never appear in `closed`", () => {
    const report = compareReviewGaps({
      before: reviewOf([vague("s2"), vague("s4"), rep("s5")]),
      after: reviewOf([vague("s2")]),
      resolvable: [vague("s2"), vague("s4"), rep("s5")],
      beforeRequirementIds: [],
      afterRequirementIds: [],
    });
    expect(report.countsBefore.vague).toBe(2);
    expect(report.countsAfter.vague).toBe(1);
    expect(report.countsBefore.repetition).toBe(1);
    expect(report.countsAfter.repetition).toBe(0);
    // No draft-anchored category is ever reported as a per-line closure.
    const closedCats = report.closed.map((c) => c.category);
    expect(closedCats).not.toContain(CATEGORY.VAGUE_UNSUPPORTED);
    expect(closedCats).not.toContain(CATEGORY.REPETITION);
  });
});

describe("compareReviewGaps - closure-by-deletion visibility + unqualified pass-through", () => {
  it("carries line counts both sides and passes after.unresolvedQualifications through (G-6, AC-2)", () => {
    const unq = [{ requirementId: "q9", text: "Active TS/SCI clearance." }];
    const report = compareReviewGaps({
      before: reviewOf([], { lineCount: 24 }),
      after: reviewOf([], { lineCount: 18, unresolvedQualifications: unq }),
      resolvable: [],
      beforeRequirementIds: ["q1"],
      afterRequirementIds: ["q1"],
    });
    expect(report.lineCountBefore).toBe(24);
    expect(report.lineCountAfter).toBe(18); // shorter resume must be visible, not read as "better"
    expect(report.genuinelyUnqualifiedStillOpen).toEqual(unq);
  });
});
