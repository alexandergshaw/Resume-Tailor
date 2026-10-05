// N104 - the gap identity helpers, and the two places the landed classify/compare
// suites do not reach: a hypothetical-draft flag, and a "closed" claim for a gap the
// before review never carried.

import { describe, it, expect } from "vitest";
import { missingKeywordTerm, shippedFlags, termKey } from "./gapIdentity.js";
import { classifyWeaknesses } from "./classifyWeaknesses.js";
import { compareReviewGaps } from "./compareReviewGaps.js";
import { detectMissingKeyword } from "./mechanicalDetectors.js";
import { CATEGORY } from "./contract.js";

const draft = { kind: "applicationReady", spans: [{ id: "s1", text: "Built internal tools" }] };
const posting = { requirements: [{ id: "q1", text: "Experience with Kubernetes and PCI compliance." }] };
const realFlags = detectMissingKeyword(draft, posting);

describe("missingKeywordTerm - the text between the FIRST pair of double quotes", () => {
  it("reads the term out of every message the real detector writes (canary: it writes some)", () => {
    expect(realFlags.length).toBeGreaterThan(0);
    for (const flag of realFlags) {
      const term = missingKeywordTerm(flag);
      expect(term).not.toBeNull();
      // the requirement text is quoted second; the parse must not return it
      expect(term).not.toMatch(/Experience with/);
      expect(flag.message).toContain(`"${term}"`);
    }
  });

  it("returns null for a message with no quoted span, an empty one, or no message at all", () => {
    expect(missingKeywordTerm({ message: "A keyword is missing." })).toBeNull();
    expect(missingKeywordTerm({ message: 'The posting asks for "" ("x")' })).toBeNull();
    expect(missingKeywordTerm({ message: 'The posting asks for "   " ("x")' })).toBeNull();
    expect(missingKeywordTerm({})).toBeNull();
    expect(missingKeywordTerm(null)).toBeNull();
  });

  it("collapses inner whitespace in the term it returns", () => {
    expect(missingKeywordTerm({ message: 'asks for "PCI   compliance" ("x")' })).toBe("PCI compliance");
  });
});

describe("termKey", () => {
  it("makes case and spacing irrelevant", () => {
    expect(termKey("  PCI   Compliance ")).toBe(termKey("pci compliance"));
  });
});

describe("shippedFlags", () => {
  it("drops the hypothetical draft's flags and anything that is not a flag object", () => {
    const flags = [
      { draftKind: "applicationReady", category: CATEGORY.REPETITION, message: "a" },
      { draftKind: "hypothetical", category: CATEGORY.MISSING_KEYWORD, message: "b" },
      { category: CATEGORY.VAGUE_UNSUPPORTED, message: "no draft kind" },
      null,
      "text",
    ];
    expect(shippedFlags({ flags }).map((f) => f.message)).toEqual(["a", "no draft kind"]);
    expect(shippedFlags(undefined)).toEqual([]);
    expect(shippedFlags({ flags: "nope" })).toEqual([]);
  });
});

describe("a review of both drafts (the pipeline's shape) is read as the shipped document only", () => {
  const hypotheticalKeyword = { ...realFlags[0], draftKind: "hypothetical" };

  it("classifyWeaknesses puts a hypothetical flag in no bucket", () => {
    const out = classifyWeaknesses({ flags: [hypotheticalKeyword], unresolvedQualifications: [] });
    expect(out.resolvable).toEqual([]);
    expect(out.confirm).toEqual([]);
  });

  it("compareReviewGaps does not count a hypothetical flag on either side", () => {
    const report = compareReviewGaps({
      before: { flags: [...realFlags, hypotheticalKeyword] },
      after: { flags: [hypotheticalKeyword] },
      resolvable: realFlags,
      beforeRequirementIds: ["q1"],
      afterRequirementIds: ["q1"],
    });
    expect(report.countsBefore.missingKeyword).toBe(realFlags.length);
    expect(report.countsAfter.missingKeyword).toBe(0);
  });
});

describe("compareReviewGaps - only a gap the before review carried can be reported", () => {
  it("claims neither closed nor stillOpen for a resolvable gap absent from the before review", () => {
    const report = compareReviewGaps({
      before: { flags: [] },
      after: { flags: [] },
      resolvable: realFlags,
      beforeRequirementIds: ["q1"],
      afterRequirementIds: ["q1"],
    });
    expect(report.closed).toEqual([]);
    expect(report.stillOpen).toEqual([]);
  });

  it("keeps a keyword flag that has no parseable term out of the per-gap lists (counted only)", () => {
    const noTerm = { ...realFlags[0], message: "A posting keyword is missing from this draft." };
    const report = compareReviewGaps({
      before: { flags: [noTerm] },
      after: { flags: [] },
      resolvable: [noTerm],
      beforeRequirementIds: ["q1"],
      afterRequirementIds: ["q1"],
    });
    expect(report.closed).toEqual([]);
    expect(report.countsBefore.missingKeyword).toBe(1);
    expect(report.countsAfter.missingKeyword).toBe(0);
  });

  it("is total over unusable input: nothing throws and nothing is claimed", () => {
    for (const input of [undefined, {}, { before: null, after: null }, { resolvable: "x", beforeRequirementIds: "y" }]) {
      const report = compareReviewGaps(input);
      expect(report.closed).toEqual([]);
      expect(report.stillOpen).toEqual([]);
      expect(report.genuinelyUnqualifiedStillOpen).toEqual([]);
    }
  });

  it("reports an unusable line count as null, not zero", () => {
    const report = compareReviewGaps({ before: { flags: [] }, after: { flags: [], lineCount: 7 } });
    expect(report.lineCountBefore).toBeNull();
    expect(report.lineCountAfter).toBe(7);
  });
});
