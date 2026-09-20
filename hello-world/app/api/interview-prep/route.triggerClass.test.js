// N29/N41 -- the manual "prepare me for this interview" control needs its
// OWN trigger_class value ("B2", design-structure.r1.md §2) so a
// candidate-initiated attempt is distinguishable from an automatic B1/B3
// one in interview_prep_events (the "Download prep log" control's own
// source, AC-N33.21). Two independent gates constrain this value; this
// file owns the ROUTE-level one, `triggerClassOf`, which TODAY collapses
// ANY value that is not the literal string "B3" to "B1"
// (route.js:148-150) -- so widening only the database CHECK (this repo's
// sibling effective-schema test) would still ship every manual attempt
// mislabelled as "B1", with no error anywhere.
//
// plan.r1.md §0.6's own canary: `grep triggerClassOf` repo-wide -> 1 file
// (route.js, the definition itself) -- ZERO existing test exercises this
// function directly. route.test.js is a deliberate SOURCE-TEXT-only
// instrument (its own header, :1-32) and never imports route.js at all, so
// it cannot and does not cover this.
//
// RED ON HEAD, confirmed this round by direct probe: `triggerClassOf` has
// no `export` keyword (route.js:148-150), so `import { triggerClassOf }
// from "./route.js"` binds it to `undefined` -- importing route.js itself
// does not throw (probed directly; the route has no import-time env-var
// crash), but every call below throws "triggerClassOf is not a function"
// the instant a test invokes it. Once route.js exports the widened,
// three-member-allowlist version plan.r1.md §1/§2 specifies, every case
// below becomes a real runtime assertion.
import { describe, it, expect } from "vitest";
import { triggerClassOf } from "./route.js";

describe("triggerClassOf -- allowlist membership, fail-safe default to B1", () => {
  it.each([
    ["B1", "B1"],
    ["B2", "B2"],
    ["B3", "B3"],
  ])("a known class %s round-trips to itself", (input, expected) => {
    expect(triggerClassOf(input)).toBe(expected);
  });

  it.each([
    ["bogus", "B1"],
    [undefined, "B1"],
    [null, "B1"],
    ["", "B1"],
    ["b2", "B1"], // membership is exact, not case-insensitive
    ["manual", "B1"], // a plausible-sounding but non-member string
  ])("collapses %s to the fail-safe default B1, never throws", (input, expected) => {
    expect(triggerClassOf(input)).toBe(expected);
  });

  it("[the mutant this whole file guards against] a widened CHECK with no matching route-level widening would silently mislabel B2 as B1 -- this assertion is what makes that visible", () => {
    // Restates the plan's own §0.1/§2 finding as an executable check: if the
    // implementer only touches the migration and forgets this function,
    // every case above using "B2" fails here, loudly, before a single
    // interview_prep_events row is ever written with the wrong label.
    expect(triggerClassOf("B2")).not.toBe("B1");
  });
});
