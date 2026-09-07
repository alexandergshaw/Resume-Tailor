// The contract for the one thing every budgeted context builder in this repo
// has to do the same way: say WHICH things it left out, not just how many.
//
// lib/experience/tailorContext.js closed this for the tailoring prompt, and
// app/api/tailor/route.js's formatDroppedProjectPagesWarning is the sentence
// that renders its names. That function is the SHAPE this module generalises —
// head-plus-"and N more", curly-quoted — and the first test below pins the two
// against each other byte for byte, so the day app/api/tailor/route.js adopts
// this helper (it is owned by another pass right now) the migration is a
// deletion, not a rewrite, and cannot silently change what an owner reads.
//
// The second thing this module owns is the trap that makes naming harder than
// counting: A NOTICE THAT NAMES N ITEMS IS ITSELF TEXT, and it competes for the
// same budget it is describing. Every builder here reserves a FIXED
// NOTICE_RESERVE_CHARS for its notice, sized against a count-only sentence. A
// name list is not fixed — one page with sixty long-titled children would sail
// straight past that reserve, and the defensive final clamp every one of those
// builders ends with cuts from the TAIL, which is exactly where the notice
// lives. The notice describing the truncation would itself be truncated, mid
// name, mid quote.
//
// So `budget` is not an optimisation, it is the rule: the reserve never moves,
// the NAMES do. A list that cannot fit gives names back to the "and N more"
// tally until it fits, and gives up entirely — returning "" so the caller keeps
// its bare count — rather than emit a single character past the budget.

import { describe, it, expect } from "vitest";
import { formatDroppedNames, MAX_NAMED_DROPPED_ITEMS } from "./droppedNames.js";

// The literal app/api/tailor/route.js writes today, restated here as an
// ORACLE rather than imported: importing it would make this test pass no
// matter what either side said. Copied from that file's
// formatDroppedProjectPagesWarning, whose own cap is 10 — the number
// MAX_NAMED_DROPPED_ITEMS is required to equal.
function tailorRouteOracle(names) {
  const shown = names.slice(0, 10).map((name) => `“${name}”`);
  const remaining = names.length - shown.length;
  return remaining > 0 ? `${shown.join(", ")}, and ${remaining} more` : shown.join(", ");
}

describe("formatDroppedNames", () => {
  it("names every dropped item when there are few of them", () => {
    expect(formatDroppedNames(["Rollout plan", "Risk log"])).toBe("“Rollout plan”, “Risk log”");
  });

  it("quotes each name so a title containing a comma is still one item", () => {
    // Unquoted, "Payments, phase two" and two separate pages are the same
    // string. The reader cannot tell three pages from two.
    expect(formatDroppedNames(["Payments, phase two", "Kafka"])).toBe(
      "“Payments, phase two”, “Kafka”",
    );
  });

  it("says nothing at all when nothing was dropped", () => {
    // Positive control: a helper that always produced a fragment would let
    // every caller emit "left out: " with nothing after it.
    expect(formatDroppedNames([])).toBe("");
    expect(formatDroppedNames(null)).toBe("");
    expect(formatDroppedNames(undefined)).toBe("");
    expect(formatDroppedNames("Rollout plan")).toBe("");
  });

  it("caps the names at MAX_NAMED_DROPPED_ITEMS and counts the rest", () => {
    // THE BOUNDARY, pinned on both sides. An owner who dropped ten pages sees
    // all ten; the eleventh is what turns the sentence into a summary.
    const ten = Array.from({ length: MAX_NAMED_DROPPED_ITEMS }, (_, i) => `Page ${i + 1}`);
    expect(formatDroppedNames(ten)).toBe(tailorRouteOracle(ten));
    expect(formatDroppedNames(ten)).not.toMatch(/more/);
    expect(formatDroppedNames(ten)).toContain(`“Page ${MAX_NAMED_DROPPED_ITEMS}”`);

    const eleven = [...ten, "Page 11"];
    expect(formatDroppedNames(eleven)).toBe(tailorRouteOracle(eleven));
    expect(formatDroppedNames(eleven)).toContain("and 1 more");
    expect(formatDroppedNames(eleven)).not.toContain("Page 11");
  });

  it("counts the remainder, never the whole list, in 'and N more'", () => {
    // Mutation caught: `names.length` instead of `names.length - shown.length`.
    // "…and 25 more" after naming ten of twenty-five is a lie the reader has
    // no way to check.
    const twentyFive = Array.from({ length: 25 }, (_, i) => `Page ${i + 1}`);
    expect(formatDroppedNames(twentyFive)).toContain("and 15 more");
    expect(formatDroppedNames(twentyFive)).not.toContain("and 25 more");
  });

  it("reproduces app/api/tailor/route.js's warning list byte for byte", () => {
    // The precedent this generalises. Asserted across the three shapes that
    // sentence can take so an adopting change there is provably a no-op.
    for (const names of [
      ["Payments migration"],
      ["Payments migration", "Kafka ingestion", "Community garden rota"],
      Array.from({ length: 14 }, (_, i) => `Project ${i + 1}`),
    ]) {
      expect(formatDroppedNames(names)).toBe(tailorRouteOracle(names));
    }
  });

  it("honours an explicit `max` below the default", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(formatDroppedNames(five, { max: 2 })).toBe("“a”, “b”, and 3 more");
  });

  describe("the budget, which is what stops the notice eating its own reserve", () => {
    it("never returns a string longer than the budget it was given", () => {
      // The load-bearing property, asserted over a sweep rather than one
      // fixture: every budget from 0 to well past the full list must hold.
      const names = Array.from({ length: 12 }, (_, i) => `A rather long project page title number ${i}`);
      for (let budget = 0; budget <= 400; budget += 1) {
        expect(formatDroppedNames(names, { budget }).length).toBeLessThanOrEqual(budget);
      }
    });

    it("gives names back to 'and N more' rather than overflowing", () => {
      // Not merely "shorter" — the count has to ABSORB what the list gave up,
      // or the sentence quietly under-reports how much was lost.
      const names = ["Payments migration", "Kafka ingestion", "Community garden rota", "Beekeeping minutes"];
      const full = formatDroppedNames(names);
      const squeezed = formatDroppedNames(names, { budget: 40 });
      expect(full).not.toMatch(/more/);
      expect(squeezed.length).toBeLessThanOrEqual(40);
      expect(squeezed).toContain("“Payments migration”");
      expect(squeezed).toMatch(/and 3 more$/);
    });

    it("returns nothing rather than half a name when not even one fits", () => {
      // THE OUTCOME THE BRIEF CALLS REAL: a truncation notice that is itself
      // truncated. The caller keeps its bare count — which is honest — instead
      // of printing `“Payments mig` and a dangling quote.
      const names = ["Payments migration", "Kafka ingestion"];
      expect(formatDroppedNames(names, { budget: 5 })).toBe("");
      expect(formatDroppedNames(names, { budget: 0 })).toBe("");
      expect(formatDroppedNames(names, { budget: -50 })).toBe("");
      // Mutation caught: a `.slice(0, budget)` clamp instead of dropping the
      // name. It would satisfy the length sweep above and print a broken name.
      expect(formatDroppedNames(names, { budget: 8 })).not.toMatch(/^“[^”]*$/);
    });

    it("treats a missing or non-numeric budget as unlimited", () => {
      const names = Array.from({ length: 3 }, (_, i) => `Page ${i}`);
      expect(formatDroppedNames(names, {})).toBe(formatDroppedNames(names));
      expect(formatDroppedNames(names, { budget: "300" })).toBe(formatDroppedNames(names));
      expect(formatDroppedNames(names, { budget: NaN })).toBe(formatDroppedNames(names));
    });
  });

  it("never throws on junk entries, and never prints an empty pair of quotes", () => {
    // Callers are required to supply a display name (each has its own
    // "Untitled …" fallback, pinned in its own tests). This is the backstop:
    // a blank that reaches here is DROPPED from the names rather than
    // rendered as “”, which would tell the reader a page they own is
    // called nothing at all.
    expect(() => formatDroppedNames([null, undefined, 0, {}])).not.toThrow();
    expect(formatDroppedNames(["Real page", "", "   "])).toBe("“Real page”");
    expect(formatDroppedNames(["", "   "])).toBe("");
    expect(formatDroppedNames(["Real page", "", "   "])).not.toContain("“”");
  });
});
