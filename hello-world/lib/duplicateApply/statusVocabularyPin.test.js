import { describe, it, expect } from "vitest";

import {
  APPLIED_OR_LATER_STATUSES,
  PRE_APPLY_STATUSES,
  classifyStatus,
} from "@/lib/applications/statusVocabulary.js";

// ---------------------------------------------------------------------------
// AC-duplicate-apply-r4.md C-11: this chunk IMPORTS the applied-or-later
// status set rather than declaring a second copy. This pin is what makes
// that import safe -- it is asserted against the VOCABULARY MODULE ITSELF
// (imported live, not re-typed here), so it goes red the moment another
// chunk moves a status across the pre-apply / applied-or-later partition --
// the only failure this chunk's import can suffer from.
//
// Asserted on a SORTED COPY, never on written order: statusVocabulary.js's
// own APPLICATION_STATUSES is alphabetical; this pin's list below is grouped
// by meaning. The two are set-identical and array-UNEQUAL if compared
// unsorted -- comparing unsorted would make this pin flaky on a harmless
// internal re-ordering, not just on a real partition change.
// ---------------------------------------------------------------------------

describe("[pin] the applied-or-later status set is exactly the seven at-or-past-applied statuses (AC C-11)", () => {
  const EXPECTED_APPLIED_OR_LATER_SORTED = [
    "accepted",
    "applied",
    "interviewing",
    "offer",
    "phone_screen",
    "rejected",
    "withdrawn",
  ].sort();

  const EXPECTED_PRE_APPLY_SORTED = ["auto_queued", "auto_tailored", "tailored", "tracking"].sort();

  it("APPLIED_OR_LATER_STATUSES, as imported, is exactly the seven -- length and set membership, not written order", () => {
    expect(APPLIED_OR_LATER_STATUSES.length).toBe(7);
    expect([...APPLIED_OR_LATER_STATUSES].sort()).toEqual(EXPECTED_APPLIED_OR_LATER_SORTED);
  });

  it("PRE_APPLY_STATUSES, as imported, is exactly the four excluded statuses", () => {
    expect(PRE_APPLY_STATUSES.length).toBe(4);
    expect([...PRE_APPLY_STATUSES].sort()).toEqual(EXPECTED_PRE_APPLY_SORTED);
  });

  it("the two sets are disjoint and cover the whole vocabulary between them (11 total)", () => {
    const union = new Set([...APPLIED_OR_LATER_STATUSES, ...PRE_APPLY_STATUSES]);
    expect(union.size).toBe(11);
    for (const status of APPLIED_OR_LATER_STATUSES) {
      expect(PRE_APPLY_STATUSES).not.toContain(status);
    }
  });

  it("each of the four pre-apply statuses classifies as 'pre-apply', not 'applied-or-later'", () => {
    for (const status of EXPECTED_PRE_APPLY_SORTED) {
      expect(classifyStatus(status)).toBe("pre-apply");
    }
  });

  it("each of the seven applied-or-later statuses classifies as 'applied-or-later'", () => {
    for (const status of EXPECTED_APPLIED_OR_LATER_SORTED) {
      expect(classifyStatus(status)).toBe("applied-or-later");
    }
  });

  it("an off-vocabulary status classifies as 'unknown', neither pre-apply nor applied-or-later", () => {
    expect(classifyStatus("submitted")).toBe("unknown");
    expect(APPLIED_OR_LATER_STATUSES).not.toContain("submitted");
  });

  it("is frozen -- this chunk (or any caller) cannot widen the guard by mutating the imported array", () => {
    expect(Object.isFrozen(APPLIED_OR_LATER_STATUSES)).toBe(true);
    expect(() => APPLIED_OR_LATER_STATUSES.push("submitted")).toThrow();
  });

  it("[mutation guard] this pin goes red the moment a status crosses the partition -- e.g. simulating 'rejected' moving to pre-apply", () => {
    // Reproduces the ONE failure this chunk's import can suffer from,
    // without touching the real module: recompute the derived set the way
    // statusVocabulary.js itself derives it, under a hypothetical widened
    // PRE_APPLY_STATUSES, and show the sorted-seven pin would then fail.
    const simulatedPreApply = [...PRE_APPLY_STATUSES, "rejected"];
    const ALL = [...APPLIED_OR_LATER_STATUSES, ...PRE_APPLY_STATUSES];
    const simulatedAppliedOrLater = ALL.filter((status) => !simulatedPreApply.includes(status));
    expect([...simulatedAppliedOrLater].sort()).not.toEqual(EXPECTED_APPLIED_OR_LATER_SORTED);
  });
});
