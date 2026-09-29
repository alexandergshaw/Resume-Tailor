// N92 Wave 1 (Control A) -- SETTLING ROUND, BUG 3 (verifier NOT-SHIP on
// acaf645, MEDIUM). AC-A5/AC-A7: two DIFFERENT records (distinct ids/urls)
// carrying IDENTICAL text in one paragraph.
//
// relocateAffected (factMove.js:257) relocates each surviving record with
// `lineText.indexOf(r.text, cursor)`. When two DISTINCT records share the same
// text, indexOf cannot disambiguate them, and the per-line cursor does not
// reserve the span the MOVED record now occupies. So moving one identical-text
// fact past the other makes BOTH records resolve to the SAME offset -- one
// physical occurrence is double-claimed, the other is left unowned. Measured
// on HEAD acaf645, moving the SECOND fact backward past the first:
//   line  : "I lead teams. Acme grew fast. Acme grew fast. I ship weekly."
//   occ.  : offsets 14 and 30
//   result: art-1 offset 14, art-2 offset 14   <-- both on the first occurrence
//
// This passes the shipped everyRecordLocatesItsText check (both offsets DO
// slice to the fact text) -- which is exactly why it slipped: locating "a"
// valid copy is not the same as each record owning its OWN distinct physical
// occurrence. That is the property this file pins.
//
// RED-on-HEAD REASON: factMove.js exists at acaf645; the two records collide
// on one offset, so the "distinct offsets, one per occurrence" assertions
// fail. NOT red by absence. Goes GREEN under a relocateAffected that reserves
// the moved fact's occupied span so a same-text survivor claims the OTHER
// occurrence.
//
// INDEPENDENT ORACLE: the two expected occurrence offsets are read with
// indexOf off the RESULT line itself, and the claim is set-equality of the two
// records' offsets against those two physical positions -- never a value
// re-derived from planMoveFact's bookkeeping.

import { describe, it, expect } from "vitest";
import { planMoveFact } from "./factMove.js";

const GREETING = "Dear Hiring Manager,";
const T = "Acme grew fast.";

function occurrences(hay, needle) {
  const out = [];
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

describe("AC-A5/A7: two distinct records with identical text keep DISTINCT occurrences (BUG 3)", () => {
  // Two DIFFERENT sources (distinct ids AND urls) that happen to have produced
  // the same fact sentence, coalesced into one paragraph in screen order.
  function twoIdenticalLines() {
    return [GREETING, `I lead teams. ${T} ${T} I ship weekly.`];
  }

  it("moving the SECOND identical fact backward past the first: each still owns ONE distinct occurrence", () => {
    const lines = twoIdenticalLines();
    const both = occurrences(lines[1], T);
    expect(both.length, "fixture must contain the fact text exactly twice").toBe(2);
    const rec1 = { id: "art-1", url: "https://a.example/one", title: "Src one", text: T, lineIndex: 1, offset: both[0] };
    const rec2 = { id: "art-2", url: "https://b.example/two", title: "Src two", text: T, lineIndex: 1, offset: both[1] };

    const out = planMoveFact({ lines, records: [rec1, rec2], id: "art-2", direction: "backward" });
    expect(out.changed).toBe(true);

    const o1 = out.records.find((r) => r.id === "art-1");
    const o2 = out.records.find((r) => r.id === "art-2");

    // Both still located, still on line 1, both slicing to the fact text.
    for (const r of [o1, o2]) {
      expect(String(out.lines[r.lineIndex]).slice(r.offset, r.offset + T.length)).toBe(T);
    }
    // THE CORE PROPERTY: distinct offsets -- neither double-claimed.
    expect(o1.offset, "the two records must not collapse onto one offset").not.toBe(o2.offset);
    // And together they cover EXACTLY the two physical occurrences in the
    // result line (one unowned occurrence is the other half of the defect).
    const resultOccurrences = occurrences(out.lines[1], T);
    expect(resultOccurrences.length).toBe(2);
    expect([o1.offset, o2.offset].sort((a, b) => a - b)).toEqual(resultOccurrences);

    // provenance intact across the collision-prone path
    expect(o1.url).toBe("https://a.example/one");
    expect(o2.url).toBe("https://b.example/two");
  });

  // CONTROL (green on HEAD): moving the FIRST identical fact forward does NOT
  // collide on HEAD -- the moved fact takes the later occurrence and the
  // survivor's indexOf(cursor=0) finds the earlier one. Only the BACKWARD move
  // above collides on HEAD. This case pins that the direction HEAD already
  // gets right is not regressed by the fix.
  it("CONTROL: moving the FIRST identical fact forward past the second keeps one occurrence each", () => {
    const lines = twoIdenticalLines();
    const both = occurrences(lines[1], T);
    const rec1 = { id: "art-1", url: "https://a.example/one", text: T, lineIndex: 1, offset: both[0] };
    const rec2 = { id: "art-2", url: "https://b.example/two", text: T, lineIndex: 1, offset: both[1] };

    const out = planMoveFact({ lines, records: [rec1, rec2], id: "art-1", direction: "forward" });
    expect(out.changed).toBe(true);
    const o1 = out.records.find((r) => r.id === "art-1");
    const o2 = out.records.find((r) => r.id === "art-2");
    expect(o1.offset).not.toBe(o2.offset);
    const resultOccurrences = occurrences(out.lines[1], T);
    expect([o1.offset, o2.offset].sort((a, b) => a - b)).toEqual(resultOccurrences);
  });

  // CONTROL: the SAME move shape with DISTINCT texts, which HEAD already
  // handles. Green on HEAD -- proving the failures above are about the
  // identical-text collision specifically, not the two-fact move in general.
  it("CONTROL: two DISTINCT-text facts moved past each other keep distinct offsets", () => {
    const T2 = "Beta shipped an API.";
    const lines = [GREETING, `I lead teams. ${T} ${T2} I ship weekly.`];
    const rec1 = { id: "art-1", text: T, lineIndex: 1, offset: String(lines[1]).indexOf(T) };
    const rec2 = { id: "art-2", text: T2, lineIndex: 1, offset: String(lines[1]).indexOf(T2) };
    const out = planMoveFact({ lines, records: [rec1, rec2], id: "art-1", direction: "forward" });
    const o1 = out.records.find((r) => r.id === "art-1");
    const o2 = out.records.find((r) => r.id === "art-2");
    expect(o1.offset).not.toBe(o2.offset);
    expect(String(out.lines[o1.lineIndex]).slice(o1.offset, o1.offset + T.length)).toBe(T);
    expect(String(out.lines[o2.lineIndex]).slice(o2.offset, o2.offset + T2.length)).toBe(T2);
  });
});
