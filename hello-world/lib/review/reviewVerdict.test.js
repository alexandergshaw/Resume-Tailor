// N105 Step 8 (4b) — the ONE shared complete-vs-partial rule (K3, UX-34).
// Binds to: N105.plan.r2.md Step 8 + PL-10; N105.ux.r2.md 5.8 Axis R; N106.ac
// AC-17 (a partial/absent review never reads clean); design §7 category enum.
//
// This is the shared pure rule N103/N104 inherit. It fails CLOSED: a missing,
// malformed or self-contradicting coverage is `partial`, never `complete`
// (defence in depth against an overclaiming producer). In slice 1 every real
// invocation is `complete:false`, so `complete` must be UNREACHABLE on real
// input; the `complete:true`+all-seven fixture proves the branch is live, not
// dead.
//
// RED on HEAD: module absent (collection failure); satisfiability proven by the
// scratchpad reference.

import { describe, it, expect } from "vitest";
import { reviewVerdict } from "./reviewVerdict.js";

// The seven adversarial-review categories (design §7). "complete" requires every
// one to be present in coverage.evaluatedCategories.
const SEVEN = [
  "missing-keyword",
  "vague-unsupported",
  "repetition",
  "unverifiable-metric",
  "employer-plausibility",
  "consistency",
  "unsupported-authority",
];

const kindOf = (review) => reviewVerdict(review).kind;

describe("reviewVerdict — Axis R (none / partial / complete)", () => {
  it("absent review is 'none'", () => {
    expect(kindOf(null)).toBe("none");
    expect(kindOf(undefined)).toBe("none");
  });

  it("a review with NO coverage is 'partial' (m4 guard: missing coverage is never complete)", () => {
    expect(kindOf({ flags: [], unresolvedQualifications: [] })).toBe("partial");
  });

  it("a review with a malformed coverage (not an object) is 'partial'", () => {
    expect(kindOf({ flags: [], coverage: true })).toBe("partial");
    expect(kindOf({ flags: [], coverage: "complete" })).toBe("partial");
  });

  it("coverage.complete === false is 'partial' (the slice-1 norm)", () => {
    expect(kindOf({ flags: [], coverage: { evaluatedCategories: SEVEN, complete: false } })).toBe(
      "partial",
    );
  });

  it("coverage.complete === true but MISSING a category is 'partial' (m2 guard)", () => {
    const sixOnly = SEVEN.slice(0, 6);
    expect(
      kindOf({ flags: [], coverage: { evaluatedCategories: sixOnly, complete: true } }),
    ).toBe("partial");
  });

  it("coverage.complete === true AND all seven categories is 'complete' (the only positive case)", () => {
    expect(
      kindOf({ flags: [], coverage: { evaluatedCategories: SEVEN, complete: true } }),
    ).toBe("complete");
  });

  it("the category order in evaluatedCategories does not matter", () => {
    const shuffled = [...SEVEN].reverse();
    expect(
      kindOf({ flags: [], coverage: { evaluatedCategories: shuffled, complete: true } }),
    ).toBe("complete");
  });
});

describe("reviewVerdict — missingChecks names the not-fully-checked categories", () => {
  it("lists the categories absent from evaluatedCategories on a partial review", () => {
    const sixOnly = SEVEN.slice(0, 6); // drops "unsupported-authority"
    const { missingChecks } = reviewVerdict({
      flags: [],
      coverage: { evaluatedCategories: sixOnly, complete: false },
    });
    expect(missingChecks).toContain("unsupported-authority");
    expect(missingChecks).not.toContain("missing-keyword");
  });

  it("names all seven when coverage is unusable", () => {
    const { missingChecks } = reviewVerdict({ flags: [], coverage: undefined });
    expect(new Set(missingChecks)).toEqual(new Set(SEVEN));
  });

  it("is empty on a complete review", () => {
    const { missingChecks } = reviewVerdict({
      flags: [],
      coverage: { evaluatedCategories: SEVEN, complete: true },
    });
    expect(missingChecks).toEqual([]);
  });
});
