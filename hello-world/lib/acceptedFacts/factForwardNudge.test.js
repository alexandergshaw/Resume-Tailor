// N92 Wave 2 (Control C) -- the insert-time forward nudge, PURE planner tests.
//
// Scope: Control C ONLY (the persisted "position facts forward on all future
// generated cover letters" preference). Binds to N92.ac.r1.md AC-C1 (composition
// with placement), AC-C2 (shares Control A's exact primitive), AC-C9 (per-fact,
// N56 coalescing order preserved), and the plan's W2-S4 silent-failure rows
// (group shift reorders/merges; nudge changes WHICH placement is used).
//
// WHAT THE NUDGE IS (design section 4.3, plan W2-S4): `planAcceptForEntry`
// gains an additive `forwardNudge` option. When true, AFTER `planCoverFacts`
// resolves each fact at its placement, EACH newly located fact is moved exactly
// one sentence slot FORWARD via `planMoveFact` from factMove.js -- the SAME pure
// primitive Control A (Wave 1) uses, no divergent copy (AC-C2). When false (or
// omitted) the fact stays at today's placed position.
//
// RED ON HEAD (93afb75): `planAcceptForEntry(entry, { facts, coverRecord })`
// ignores any `forwardNudge` key, so a nudged plan is byte-identical to an
// un-nudged one. Every "moved forward" assertion below fails on HEAD because
// nothing moves. The false-path control and the last-slot overflow no-op are
// GUARDS -- vacuously green on HEAD (nothing nudges) -- and are made meaningful
// by the mutants in the notes artifact (an always-nudge build reds the control;
// an overflow-wrap/throw build reds the no-op). Disclosed as guards, not counted
// as HEAD-red coverage.
//
// WHY THE C2 EQUIVALENCE IS THE PRIMARY ASSERTION. Rather than hand-computing
// every nudged string (fragile: a wrong oracle would mislead the implementer),
// most cases assert `nudged.lines === planMoveFact(placed, "forward").lines`.
// That pins composition (AC-C1: place FIRST, then one forward move) AND the
// shared-primitive requirement (AC-C2) at once, delegating the move's own
// direction/magnitude to planMoveFact, which Wave 1 already tests. One exact
// oracle (the intro case) is kept so a mutation that swaps the primitive for a
// look-alike is not silently green, and every case asserts nudged != placed
// (the nudge fired -- the HEAD red) and nudged != planMoveFact(placed,"backward")
// (the direction is FORWARD, not backward).

import { describe, it, expect } from "vitest";
import { planAcceptForEntry } from "./factInsertion.js";
import { planMoveFact } from "./factMove.js";

const GREETING = "Dear Hiring Manager,";
const INTRO = "I am excited to apply for this role. I bring years of relevant experience. I would love to contribute to your mission.";
const CURRENT = "In my current role I lead a platform team. I ship features weekly every sprint.";
const TEACHING = "As an adjunct professor I teach data science. I mentor students often at night.";
const WHY = "What draws me to your company is the bold mission. I admire your product deeply too.";
const CLOSING = "Sincerely,";
const SIGNATURE = "Jane Doe";

// minLine=1 (greeting excluded); the "Sincerely," + "Jane Doe" tail makes
// bodyBounds' maxLine the WHY paragraph, so the whole 1..4 range is body.
function letter() {
  return [GREETING, INTRO, CURRENT, TEACHING, WHY, CLOSING, SIGNATURE];
}
function entryWith(lines) {
  return { coverLetterResultLines: lines };
}
const FACT_TEXT = "Acme opened a Dublin lab.";
function factAt(placement) {
  return { id: "f1", text: FACT_TEXT, placement };
}

function planNudged(lines, facts) {
  return planAcceptForEntry(entryWith(lines), { facts, forwardNudge: true });
}
function planPlaced(lines, facts) {
  return planAcceptForEntry(entryWith(lines), { facts });
}

function occurrences(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}
function eachRecordLocatesOwnText(lines, records) {
  for (const r of records) {
    const span = String(lines[r.lineIndex] ?? "").slice(r.offset, r.offset + String(r.text).length);
    expect(span, `record ${JSON.stringify(r.text)} does not locate its own text at its recorded offset`).toBe(r.text);
  }
}

// ---------------------------------------------------------------------------
// Harness sanity: the fixture places facts where the anchors say, so a nudge
// really has a placement to compose ON TOP OF (not a fallback that collapses
// every placement to the intro line and hides mis-composition).
// ---------------------------------------------------------------------------
describe("N92-C fixture precondition (wrong-reason trap)", () => {
  it("each placement id lands the fact in the paragraph its anchor names", () => {
    const lines = letter();
    // current -> the 'in my current role' line (index 2), end position.
    expect(planPlaced(lines, [factAt("current")]).cover.lines[2]).toContain(FACT_TEXT);
    // teaching -> the 'adjunct professor' line (index 3).
    expect(planPlaced(lines, [factAt("teaching")]).cover.lines[3]).toContain(FACT_TEXT);
    // why -> the 'draws me to' line (index 4).
    expect(planPlaced(lines, [factAt("why")]).cover.lines[4]).toContain(FACT_TEXT);
    // intro -> the first substantive body line (index 1), after its first sentence.
    expect(planPlaced(lines, [factAt("intro")]).cover.lines[1]).toContain(FACT_TEXT);
  });
});

// ---------------------------------------------------------------------------
// AC-C1 + AC-C2: composition per placement value. "on" = place, THEN one
// forward move via the SHARED planMoveFact.
// ---------------------------------------------------------------------------
describe("AC-C1/AC-C2 forward nudge composes AFTER placement, via Control A's primitive (RED on HEAD)", () => {
  for (const placement of ["intro", "current", "teaching", "why"]) {
    it(`placement "${placement}": nudged lines === planMoveFact(placed, "forward"); nudged != placed`, () => {
      const lines = letter();
      const placed = planPlaced(lines, [factAt(placement)]);
      const nudged = planNudged(lines, [factAt(placement)]);

      // The exact composition contract: the nudged result is the PLACED result
      // with one forward move applied by the shared primitive (AC-C2 -- same
      // function, not a divergent copy; AC-C1 -- place first, nudge after).
      const viaPrimitive = planMoveFact({
        lines: placed.cover.lines,
        records: placed.cover.record,
        id: "f1",
        direction: "forward",
      });
      expect(viaPrimitive.changed, `fixture unsound: placement "${placement}" leaves no forward slot to move into`).toBe(true);
      expect(
        nudged.cover.lines,
        `nudged output does not equal place-then-forward-move via planMoveFact (placement "${placement}")`,
      ).toEqual(viaPrimitive.lines);

      // The nudge actually fired (the HEAD red): a build that ignores
      // forwardNudge returns the placed lines unchanged.
      expect(nudged.cover.lines, `the forward nudge did not move the fact (placement "${placement}")`).not.toEqual(placed.cover.lines);

      // Direction is FORWARD, not backward.
      const backward = planMoveFact({ lines: placed.cover.lines, records: placed.cover.record, id: "f1", direction: "backward" });
      if (backward.changed) {
        expect(nudged.cover.lines, `the nudge moved the fact BACKWARD, not forward (placement "${placement}")`).not.toEqual(backward.lines);
      }

      // Safety: the fact still appears exactly once and its record locates it.
      expect(occurrences(nudged.cover.lines.join("\n"), FACT_TEXT), "the nudge duplicated or dropped the fact").toBe(1);
      eachRecordLocatesOwnText(nudged.cover.lines, nudged.cover.record);
    });
  }

  it('EXACT ORACLE (intro, in-paragraph): the fact moves past exactly one sentence, forward (RED on HEAD)', () => {
    const lines = letter();
    const nudged = planNudged(lines, [factAt("intro")]);
    // Placed after sentence 1, then swapped one slot later with sentence 2.
    const expected =
      "I am excited to apply for this role. I bring years of relevant experience. Acme opened a Dublin lab. I would love to contribute to your mission.";
    expect(nudged.cover.lines[1]).toBe(expected);
  });

  it("CONTROL (over-fire): forwardNudge omitted/false leaves the fact at its placed position", () => {
    // Guards against a build that always nudges. Green on HEAD (nothing nudges)
    // and in the reference (the false path must not move the fact).
    const lines = letter();
    const placedOmitted = planAcceptForEntry(entryWith(lines), { facts: [factAt("intro")] });
    const placedFalse = planAcceptForEntry(entryWith(lines), { facts: [factAt("intro")], forwardNudge: false });
    expect(placedFalse.cover.lines, "forwardNudge:false must equal the un-nudged placement").toEqual(placedOmitted.cover.lines);
    // And it is the plain after-first-sentence placement (fact right after S1).
    expect(placedFalse.cover.lines[1]).toBe(
      "I am excited to apply for this role. Acme opened a Dublin lab. I bring years of relevant experience. I would love to contribute to your mission.",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-C1 overflow: a nudge past the last movable body slot is a defined no-op,
// never an error and never a wrap into the closing/greeting. GUARD (green on
// HEAD); power via the overflow mutant in the notes artifact.
// ---------------------------------------------------------------------------
describe("AC-C1 last-slot overflow: forward from the final body slot is a defined no-op (GUARD)", () => {
  it("a fact already at the last body slot stays put under the nudge -- no error, no wrap", () => {
    // Body is a single paragraph (index 1); "Sincerely,"/"Jane Doe" are the
    // closing tail. A "current" (end) fact lands at the last slot of the only
    // body paragraph, so a forward move overflows.
    const lines = [GREETING, CURRENT, CLOSING, SIGNATURE];
    const placed = planPlaced(lines, [factAt("current")]);

    // Validate the fixture really is an overflow case (else this no-op is
    // vacuous for the wrong reason): planMoveFact reports a boundary no-op.
    const attempt = planMoveFact({ lines: placed.cover.lines, records: placed.cover.record, id: "f1", direction: "forward" });
    expect(attempt.changed, "fixture unsound: the fact is NOT at the last body slot, so overflow is not exercised").toBe(false);
    expect(attempt.reason).toBe("boundary");

    const nudged = planNudged(lines, [factAt("current")]);
    expect(nudged.cover.lines, "an overflowing nudge changed the letter instead of being a no-op").toEqual(placed.cover.lines);
    // Never leaked into greeting (line 0) or the closing/signature tail.
    expect(nudged.cover.lines[0]).toBe(GREETING);
    expect(nudged.cover.lines[nudged.cover.lines.length - 1]).toBe(SIGNATURE);
    expect(occurrences(nudged.cover.lines.join("\n"), FACT_TEXT)).toBe(1);
    eachRecordLocatesOwnText(nudged.cover.lines, nudged.cover.record);
  });
});

// ---------------------------------------------------------------------------
// AC-C9: the nudge is PER-FACT, not a per-group/per-paragraph block shift, and
// N56 same-paragraph coalescing SCREEN ORDER survives it -- no reorder, no
// merge, no duplicate. (plan W2-S4 silent-failure row A.)
// ---------------------------------------------------------------------------
describe("AC-C9 two coalesced facts in one paragraph: per-fact nudge preserves order, never merges/duplicates (RED on HEAD)", () => {
  const F1 = { id: "f1", text: "Acme opened a Dublin lab.", placement: "intro" };
  const F2 = { id: "f2", text: "Acme raised fifty million dollars.", placement: "intro" };

  it("both facts survive once, in their original relative order, each locating its own text", () => {
    const lines = letter();
    const placed = planAcceptForEntry(entryWith(lines), { facts: [F1, F2] });
    const nudged = planAcceptForEntry(entryWith(lines), { facts: [F1, F2], forwardNudge: true });

    const joinedPlaced = placed.cover.lines.join("\n");
    const joinedNudged = nudged.cover.lines.join("\n");

    // Precondition: coalescing put both facts in ONE paragraph, in F1-before-F2
    // screen order (so "order preserved" below is a real claim).
    expect(occurrences(joinedPlaced, F1.text)).toBe(1);
    expect(occurrences(joinedPlaced, F2.text)).toBe(1);
    expect(joinedPlaced.indexOf(F1.text)).toBeLessThan(joinedPlaced.indexOf(F2.text));

    // The nudge fired at all (HEAD red): with two trailing sentences after the
    // coalesced pair there is room to move forward.
    expect(joinedNudged, "the per-fact forward nudge did not move the coalesced facts").not.toBe(joinedPlaced);

    // SAFETY invariants (the failure directions AC-C9 names):
    // - no merge / no duplicate: each fact appears exactly once.
    expect(occurrences(joinedNudged, F1.text), "F1 was merged, duplicated, or dropped by the nudge").toBe(1);
    expect(occurrences(joinedNudged, F2.text), "F2 was merged, duplicated, or dropped by the nudge").toBe(1);
    // - order preserved: F1 still precedes F2 (a group-block shift that swaps
    //   them, e.g. leftmost-first threading that cancels/reorders, fails here).
    expect(
      joinedNudged.indexOf(F1.text),
      "the nudge reordered the coalesced facts (F2 now precedes F1) -- a group shift, not a per-fact nudge",
    ).toBeLessThan(joinedNudged.indexOf(F2.text));
    // - every record still locates its own text (AC-A5 invariant carried in).
    eachRecordLocatesOwnText(nudged.cover.lines, nudged.cover.record);
  });

  it("CONTROL: without the nudge the two coalesced facts are already once-each and in order", () => {
    // Establishes that the invariants above are not vacuously true of the
    // placement itself -- the nudge must PRESERVE what placement produced.
    const lines = letter();
    const placed = planAcceptForEntry(entryWith(lines), { facts: [F1, F2] });
    const joined = placed.cover.lines.join("\n");
    expect(occurrences(joined, F1.text)).toBe(1);
    expect(occurrences(joined, F2.text)).toBe(1);
    expect(joined.indexOf(F1.text)).toBeLessThan(joined.indexOf(F2.text));
  });
});
