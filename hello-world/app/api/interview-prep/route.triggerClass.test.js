// N29/N41 -- the manual "prepare me for this interview" control needs its
// OWN trigger_class value ("B2", design-structure.r1.md §2) so a
// candidate-initiated attempt is distinguishable from an automatic B1/B3
// one in interview_prep_events (the "Download prep log" control's own
// source, AC-N33.21). Two independent gates constrain this value; this
// file owns the ROUTE-level one, `triggerClassOf`.
//
// plan.r1.md §0.6's own canary: `grep triggerClassOf` repo-wide -> 1 file
// (route.js, the definition itself) -- ZERO existing test exercises this
// function directly. route.test.js is a deliberate SOURCE-TEXT-only
// instrument (its own header, :1-32) and never imports route.js at all, so
// it cannot and does not cover this.
//
// V-8 fix (N29/N41 verification round 2, owner ruling): `triggerClassOf`
// used to COLLAPSE any value outside {B1,B2,B3} to "B1" -- indistinguishable
// from a genuine automatic post-tailor trigger in interview_prep_events, a
// telemetry lie the "Download prep log" surface (AC-N33.21) would read as
// true. The owner's ruling: "an unknown class is a programming error, not a
// value to normalise" -- reject rather than coerce. The three known values
// still round-trip to themselves, UNCHANGED; every other input now THROWS,
// caught at route.js's own GATE 5 and turned into a 400
// (route.triggerClassReject.test.js drives that end of the seam through the
// real POST handler). The property this file has always pinned --  an
// unrecognized class must never silently round-trip as "B1" -- is preserved
// in a strictly stronger form: it now never round-trips as anything at all.
//
// Correction (regression fix, same day): the first cut of the V-8 ruling
// conflated "absent" with "unrecognized" and made `triggerClassOf(undefined)`
// throw too, which broke every caller that legitimately omits the field --
// caught by route.trustedNamesWiring.test.js failing both of its cases,
// including its own negative control. The owner's corrected ruling: an
// ABSENT value (undefined, null, or the key simply missing from the request
// body) is not a lie -- the caller said nothing, and "B1" is the documented
// default -- so it still defaults exactly as it did before the V-8 fix ever
// shipped. Only a value that was actually SUPPLIED and does not match the
// allowlist is the telemetry lie worth rejecting.
import { describe, it, expect } from "vitest";
import { triggerClassOf } from "./route.js";

describe("triggerClassOf -- allowlist membership, reject rather than coerce", () => {
  it.each([
    ["B1", "B1"],
    ["B2", "B2"],
    ["B3", "B3"],
  ])("a known class %s round-trips to itself, exactly as before", (input, expected) => {
    expect(triggerClassOf(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
  ])("absent (%p) defaults to B1, exactly as it did before the V-8 fix", (input) => {
    expect(triggerClassOf(input)).toBe("B1");
  });

  it("absent -- the key missing from the call entirely -- also defaults to B1", () => {
    expect(triggerClassOf()).toBe("B1");
  });

  it.each([
    ["bogus"],
    [""],
    ["b2"], // membership is exact, not case-insensitive
    ["manual"], // a plausible-sounding but non-member string
  ])("rejects %s -- a SUPPLIED but unrecognized value throws rather than silently coercing to B1", (input) => {
    expect(() => triggerClassOf(input)).toThrow();
  });

  it("[the mutant this whole file guards against] a widened CHECK with no matching route-level widening would silently mislabel B2 as B1 -- this assertion is what makes that visible", () => {
    // Restates the plan's own §0.1/§2 finding as an executable check: if the
    // implementer only touches the migration and forgets this function,
    // every case above using "B2" fails here, loudly, before a single
    // interview_prep_events row is ever written with the wrong label.
    expect(triggerClassOf("B2")).not.toBe("B1");
  });
});
