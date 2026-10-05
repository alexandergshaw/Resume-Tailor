// N104 Step 1 (4b) - classifyWeaknesses: the 3-bucket split the summary renders
// and the regenerate steers from (AC-2 as amended G-1, design r2 §8, D-4).
//
// WHY A POWER ROW (R5, SAFETY). The regenerate may only ever target the
// RESOLVABLE bucket. A confirm-tier weakness ("Figure cannot be checked", a
// seniority claim) is one that only the user can verify; "addressing" it by
// changing the figure IS fabrication. So the classifier must put every
// confirm-tier flag - and every UNKNOWN category, which defaults to the cautious
// confirm tier (flagPresentation.js:142) - into `confirm`, never `resolvable`.
//
//   classifyWeaknesses(reviewOutcome) -> { resolvable, confirm, genuinelyUnqualified }
//
// The buckets come from the SHIPPED presentFlag(APPLICATION_READY, category).tier
// (no new category list - AC-3b census), so the classifier cannot drift from the
// panel. A missing-keyword whose requirement is itself unqualified is folded OUT
// of resolvable (it is a real gap, not a wording gap).
//
// RED on HEAD: lib/review/classifyWeaknesses.js does not exist (NET-NEW unit;
// import-absence is the honest RED). Satisfiability + the confirm-exclusion mutant
// are proven/watched in the scratchpad reference.
//
// NOTE (env-gated): the CONFIRM-ROW RENDER is INVALID-until-N110 - the mechanical
// floor emits no confirm-tier flag (flagPresentation confirm categories are
// judge-only). This file proves the BUCKETING with a pre-built review carrying a
// confirm flag; it does not assert a rendered confirm row.

import { describe, it, expect } from "vitest";
import { classifyWeaknesses } from "./classifyWeaknesses.js";
import { CATEGORY } from "./contract.js";
import { presentFlag, TIER, DRAFT_KIND } from "./flagPresentation.js";

const flag = (category, spanId, evidenceReqId) => ({
  draftKind: "applicationReady",
  spanId,
  category,
  message: `${category} on ${spanId}`,
  ...(evidenceReqId ? { evidenceRef: { origin: "posting", spanId: evidenceReqId } } : {}),
});

// A review carrying >=1 flag of each class, so the 3-way split actually has power.
const UNQUALIFIED = [{ requirementId: "qU", text: "Active TS/SCI security clearance." }];
const REVIEW = {
  status: "reviewed",
  draftKind: "applicationReady",
  flags: [
    flag(CATEGORY.MISSING_KEYWORD, "s1", "q1"), // IMPROVE -> resolvable
    flag(CATEGORY.VAGUE_UNSUPPORTED, "s2"), // IMPROVE -> resolvable
    flag(CATEGORY.UNVERIFIABLE_METRIC, "s3"), // CONFIRM -> confirm
    flag(CATEGORY.UNSUPPORTED_AUTHORITY, "s4"), // CONFIRM -> confirm
    { draftKind: "applicationReady", spanId: "s5", category: "mystery-category", message: "?" }, // unknown -> confirm
    flag(CATEGORY.MISSING_KEYWORD, "s6", "qU"), // keyword whose req is UNQUALIFIED -> NOT resolvable
  ],
  unresolvedQualifications: UNQUALIFIED,
};

describe("classifyWeaknesses - 3-bucket split (G-1)", () => {
  const out = classifyWeaknesses(REVIEW);

  it("resolvable holds ONLY improve-tier wording gaps whose requirement is supported", () => {
    const cats = out.resolvable.map((f) => f.category);
    expect(cats).toContain(CATEGORY.MISSING_KEYWORD);
    expect(cats).toContain(CATEGORY.VAGUE_UNSUPPORTED);
    // the keyword on the UNQUALIFIED requirement is folded out of resolvable
    const resolvableReqIds = out.resolvable.map((f) => f.evidenceRef?.spanId);
    expect(resolvableReqIds).not.toContain("qU");
  });

  it("confirm holds every confirm-tier flag AND any unknown category (cautious default)", () => {
    const cats = out.confirm.map((f) => f.category);
    expect(cats).toContain(CATEGORY.UNVERIFIABLE_METRIC);
    expect(cats).toContain(CATEGORY.UNSUPPORTED_AUTHORITY);
    expect(cats).toContain("mystery-category"); // MUTANT (unknown->resolvable) reds here
    // every confirm-bucket flag really is a confirm tier (or unknown) - no improve leak
    for (const f of out.confirm) {
      const tier = presentFlag(DRAFT_KIND.APPLICATION_READY, f.category).tier;
      expect(tier).toBe(TIER.CONFIRM);
    }
  });

  it("CONFIRM-tier flags are NEVER resolvable (the fabrication-guard invariant)", () => {
    for (const f of out.resolvable) {
      const tier = presentFlag(DRAFT_KIND.APPLICATION_READY, f.category).tier;
      // MUTANT: classify routes a confirm flag into resolvable -> this reds.
      expect(tier).toBe(TIER.IMPROVE);
    }
  });

  it("genuinelyUnqualified is the review's unresolvedQualifications, passed through", () => {
    expect(out.genuinelyUnqualified).toEqual(UNQUALIFIED);
  });

  it("the three buckets are pairwise disjoint", () => {
    const r = new Set(out.resolvable);
    const c = new Set(out.confirm);
    for (const f of out.resolvable) expect(c.has(f)).toBe(false);
    for (const f of out.confirm) expect(r.has(f)).toBe(false);
    // genuinelyUnqualified are entries (requirementId), not flags - disjoint by shape
    expect(out.genuinelyUnqualified.every((u) => typeof u.requirementId === "string")).toBe(true);
  });
});

describe("classifyWeaknesses - AC-3b: no local category list (reuse presentFlag)", () => {
  it("imports presentFlag from flagPresentation and defines no CATEGORY/TIER table of its own", async () => {
    // Source census: the only tier authority reached is presentFlag; the file
    // must not re-declare its own confirm/improve category set (that would be a
    // second classifier that drifts from the panel).
    const fs = await import("node:fs/promises");
    const url = new URL("./classifyWeaknesses.js", import.meta.url);
    const src = await fs.readFile(url, "utf8");
    expect(src).toMatch(/presentFlag/); // reuse the shipped tier map (canary)
    // no hand-rolled list of the four confirm categories
    expect(src).not.toMatch(/unsupported-authority[\s\S]{0,80}unverifiable-metric/);
  });
});
