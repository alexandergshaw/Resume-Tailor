// N92 Wave 1 (Control A) -- SETTLING ROUND, BUG 1 (verifier NOT-SHIP on
// acaf645, CRITICAL). AC-A4 byte-identity, the case the shipped fixture
// missed.
//
// The shipped AC-A4 test (factMove.test.js) put its pre-existing double space
// in "I mentor  two juniors." -- an UNRELATED later sentence, far from the
// fact. That double space is never adjacent to the excise/insert seam, so the
// round trip was byte-identical BY LUCK and the seam's real defect slipped
// through 33 green tests.
//
// The defect: exciseSpanLocal (factMove.js:110) "prefer the space before, fall
// back to after" ALWAYS eats the head's trailing space. When a fact has a
// SINGLE space before it and a PRE-EXISTING DOUBLE space AFTER it, the excise
// eats the wrong space and the surviving double space is misattributed to the
// other side of the fact -- so forward-then-backward relocates the fact AND
// the double space, and the letter is NOT restored. Measured on HEAD acaf645:
//   orig : "I lead the platform team. Acme opened a Dublin lab.  I ship weekly. I mentor peers."
//   F    : "I lead the platform team.  Acme opened a Dublin lab. I ship weekly. I mentor peers."
//   F->B : "Acme opened a Dublin lab. I lead the platform team.  I ship weekly. I mentor peers."
// (the fact ends up at the very start; the double space migrates left). The
// mirror case -- a DOUBLE space BEFORE the fact, single after -- round-trips
// fine on HEAD, so the CONTROL below stays green on HEAD and pins that this
// file is catching the after-side specifically, not asserting a truism.
//
// RED-on-HEAD REASON: this file fails on acaf645 because F->B is not
// byte-identical for the double-space-AFTER fixture (the assertion below).
// It is NOT red by absence -- factMove.js exists at this commit. It goes GREEN
// only under a seam that inverts regardless of which side holds the double
// space (AC-A4 pins TRUE byte-identity; any use of AC-A4's sanctioned
// single-space relaxation would have to make THIS assertion an explicit,
// visible change here, never silent).
//
// INDEPENDENT ORACLE: the expected result of a round trip is the ORIGINAL
// input itself (a hand-written literal), never a value re-derived from
// planMoveFact -- so a global mis-index cannot move input and expectation
// together.

import { describe, it, expect } from "vitest";
import { planMoveFact } from "./factMove.js";

const FACT = "Acme opened a Dublin lab.";
const GREETING = "Dear Hiring Manager,";

function recordFor(lines, lineIndex, text, extra = {}) {
  const offset = String(lines[lineIndex]).indexOf(text);
  return { id: "art-1", text, lineIndex, offset, ...extra };
}

const joined = (lines) => lines.join("\n");

// The fact sits after the FIRST carrier sentence, with a single space BEFORE
// it and a PRE-EXISTING DOUBLE space immediately AFTER it (between the fact's
// terminal "." and "I ship weekly."). This is the exact class the shipped
// fixture failed to cover.
function doubleAfterLines() {
  return [GREETING, `I lead the platform team. ${FACT}  I ship weekly. I mentor peers.`];
}

// Mirror fixture: DOUBLE space BEFORE the fact, single after. This one
// round-trips even on HEAD -- it is the CONTROL proving the assertions below
// are discriminating the after-side, not passing for any fact with a nearby
// double space.
function doubleBeforeLines() {
  return [GREETING, `I lead the platform team.  ${FACT} I ship weekly. I mentor peers.`];
}

describe("AC-A4 byte-identity: a DOUBLE space immediately AFTER the fact (BUG 1)", () => {
  it("forward-then-backward restores the letter byte-for-byte, double space intact", () => {
    const lines = doubleAfterLines();
    // Non-vacuity: the trap really is present, and immediately after the fact.
    expect(lines[1]).toContain(`${FACT}  I ship weekly.`);
    const rec = recordFor(lines, 1, FACT);

    const fwd = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(fwd.changed, "forward must actually move the fact").toBe(true);
    const moved = fwd.records.find((r) => r.id === rec.id);

    const back = planMoveFact({ lines: fwd.lines, records: fwd.records, id: moved.id, direction: "backward" });
    // TRUE byte identity -- the whole point of the settling round.
    expect(joined(back.lines)).toBe(joined(lines));
    // and the pre-existing double space is still exactly where it was.
    expect(back.lines[1]).toContain(`${FACT}  I ship weekly.`);
  });

  it("the record returns to its exact original (lineIndex, offset) after the round trip", () => {
    const lines = doubleAfterLines();
    const rec = recordFor(lines, 1, FACT);
    const fwd = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    const moved = fwd.records.find((r) => r.id === rec.id);
    const back = planMoveFact({ lines: fwd.lines, records: fwd.records, id: moved.id, direction: "backward" });
    const restored = back.records.find((r) => r.id === rec.id);
    expect(restored.lineIndex).toBe(rec.lineIndex);
    expect(restored.offset).toBe(rec.offset);
    // and it still locates its own text at that offset
    expect(String(back.lines[restored.lineIndex]).slice(restored.offset, restored.offset + FACT.length)).toBe(FACT);
  });

  it("CONTROL: the forward move preserves the double space (never collapsed to a single space)", () => {
    // Green on HEAD (HEAD relocates the double space rather than collapsing
    // it) and green under the fix. This guards a DIFFERENT failure mode than
    // the byte-identity tests above: the unsafe silent outcome AC-A4 forbids
    // is a line-global normalize that eats the candidate's own spacing. It
    // does NOT catch BUG 1 itself (the misplacement) -- the round-trip
    // assertions above do that.
    const lines = doubleAfterLines();
    const rec = recordFor(lines, 1, FACT);
    const fwd = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(fwd.lines[1]).toContain("  "); // the pre-existing double space survived the move
  });

  // CONTROL: this stays green even on HEAD, proving the fixtures above pin the
  // after-side defect specifically -- not "any double space breaks it".
  it("CONTROL: a double space BEFORE the fact also round-trips byte-identically", () => {
    const lines = doubleBeforeLines();
    expect(lines[1]).toContain(`team.  ${FACT}`);
    const rec = recordFor(lines, 1, FACT);
    const fwd = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    const moved = fwd.records.find((r) => r.id === rec.id);
    const back = planMoveFact({ lines: fwd.lines, records: fwd.records, id: moved.id, direction: "backward" });
    expect(joined(back.lines)).toBe(joined(lines));
  });
});
