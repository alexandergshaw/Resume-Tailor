// N92 Wave 1 (Control A) -- the shared move primitive `planMoveFact`
// (lib/acceptedFacts/factMove.js, design §1.1, plan W1-S1). Pure, isomorphic,
// no DOM/IO. Both Control A (the manual move handler) and Control C (the
// insert-time forward nudge, Wave 2) consume THIS function, so it is the one
// place the move behaviour is pinned.
//
// RED-on-HEAD: `factMove.js` does not exist at HEAD (grep
// moveFact|moveInsertedFact = none, 2026-09-28); the import throws at
// collection and every case is red by absence.
//
// Contract under test (design §1.1):
//   planMoveFact({ lines, records, id, direction, bounds? })
//     -> { lines, records, edits, changed, reason }
//   - no-op returns the SAME `lines` and `records` references, changed:false,
//     reason in {"boundary","stale-locator","not-found"};
//   - a real move returns a NEW `lines`, the FULL updated `records` (every
//     survivor locating its own text), and `edits` for applyCoverDocxEdits.
//
// INDEPENDENT ORACLES: every expected line is a hand-written literal (the
// real letter a human would read), and every offset comes from indexOf on
// the fixture -- never re-derived from planMoveFact. So a global mis-index in
// the primitive cannot move the fixture and its expectation together
// (loop-traps: "a canary built from the same source proves consistency, not
// correctness").

import { describe, it, expect } from "vitest";
import { planMoveFact } from "./factMove.js";

const FACT = "Acme opened a Dublin lab.";
const GREETING = "Dear Hiring Manager,";
const CLOSING = "Sincerely,";
const SIGNATURE = "Jordan Rivera";

// A body paragraph with THREE carrier sentences and a PRE-EXISTING DOUBLE
// SPACE ("mentor  two") in text unrelated to the fact -- the trap for a
// non-span-local move (AC-A4 / N92C-5): a `.replace(/\s{2,}/g," ")` anywhere
// on the line silently eats that double space and the round-trip is no longer
// byte-identical.
const BODY_3 = "I lead the platform team. I ship weekly. I mentor  two juniors.";

function singleParaLines() {
  // Fact sits AFTER the first carrier sentence (the after-first-sentence
  // placement insertFactText produces), so both forward and backward are live.
  return [GREETING, `I lead the platform team. ${FACT} I ship weekly. I mentor  two juniors.`];
}

// Build a located record for a fact whose text occurs once in lines[lineIndex].
function recordFor(lines, lineIndex, text, extra = {}) {
  const offset = String(lines[lineIndex]).indexOf(text);
  return { id: "art-1", text, lineIndex, offset, ...extra };
}

function joined(lines) {
  return lines.join("\n");
}

// Assert every record locates its OWN text at its stored (lineIndex, offset)
// -- the relocateSurvivors invariant (AC-A5).
function everyRecordLocatesItsText(lines, records) {
  for (const r of records) {
    const slice = String(lines[r.lineIndex] ?? "").slice(r.offset, r.offset + r.text.length);
    expect(slice, `record ${r.id} does not locate its own text at (${r.lineIndex},${r.offset})`).toBe(r.text);
  }
}

function countOccurrences(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

describe("AC-A1: purity and no-op identity", () => {
  it("never mutates the input lines or records array on a successful move", () => {
    const lines = Object.freeze(singleParaLines().map((l) => l));
    const rec = recordFor(lines, 1, FACT);
    const records = Object.freeze([rec]);
    // A frozen input throws on mutation under ESM strict mode -- so a move
    // that writes back into the caller's array fails loudly here.
    const out = planMoveFact({ lines, records, id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    expect(out.lines, "a real move must return a NEW lines array").not.toBe(lines);
    // The caller's arrays are untouched.
    expect(lines[1]).toBe(`I lead the platform team. ${FACT} I ship weekly. I mentor  two juniors.`);
  });

  it("returns the SAME lines and records references on a boundary no-op", () => {
    // Fact at the last body slot of a single-paragraph body -> forward is a
    // boundary no-op (no next body paragraph). Same-ref return is what lets
    // callers skip a needless re-splice (AC-A1).
    const lines = [GREETING, `I lead the platform team. I ship weekly. I mentor  two juniors. ${FACT}`];
    const rec = recordFor(lines, 1, FACT);
    const records = [rec];
    const out = planMoveFact({ lines, records, id: rec.id, direction: "forward" });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("boundary");
    expect(out.lines, "boundary no-op must return the same lines reference").toBe(lines);
    expect(out.records, "boundary no-op must return the same records reference").toBe(records);
  });
});

describe("AC-A2: one click = one sentence slot, correct direction", () => {
  it("forward relocates the fact past exactly one sentence toward the end", () => {
    const lines = singleParaLines();
    const rec = recordFor(lines, 1, FACT);
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    expect(out.lines[1]).toBe(`I lead the platform team. I ship weekly. ${FACT} I mentor  two juniors.`);
    everyRecordLocatesItsText(out.lines, out.records);
  });

  it("backward relocates the fact before exactly one sentence toward the start", () => {
    const lines = singleParaLines();
    const rec = recordFor(lines, 1, FACT);
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "backward" });
    expect(out.changed).toBe(true);
    expect(out.lines[1]).toBe(`${FACT} I lead the platform team. I ship weekly. I mentor  two juniors.`);
    everyRecordLocatesItsText(out.lines, out.records);
  });

  it("two forward moves = two slots (order accumulates)", () => {
    const lines = singleParaLines();
    const rec = recordFor(lines, 1, FACT);
    const one = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    const two = planMoveFact({ lines: one.lines, records: one.records, id: rec.id, direction: "forward" });
    expect(two.changed).toBe(true);
    expect(two.lines[1]).toBe(`I lead the platform team. I ship weekly. I mentor  two juniors. ${FACT}`);
  });
});

describe("AC-A4: reversible, SPAN-LOCAL, byte-identical (resolves N92C-5)", () => {
  it("forward then backward returns byte-identical lines, preserving a pre-existing double space", () => {
    const lines = singleParaLines();
    const rec = recordFor(lines, 1, FACT);
    // Non-vacuity: the trap really is present outside the fact span.
    expect(lines[1]).toContain("mentor  two");
    const fwd = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    const back = planMoveFact({ lines: fwd.lines, records: fwd.records, id: rec.id, direction: "backward" });
    // TRUE byte identity -- not "modulo single-space normalization". If the
    // implementer must invoke AC-A4's sanctioned relaxation, THIS assertion
    // is what forces that to be an explicit, visible change here, never silent.
    expect(joined(back.lines)).toBe(joined(lines));
    expect(back.lines[1]).toContain("mentor  two");
    everyRecordLocatesItsText(back.lines, back.records);
  });

  it("backward then forward is also byte-identical", () => {
    const lines = singleParaLines();
    const rec = recordFor(lines, 1, FACT);
    const back = planMoveFact({ lines, records: [rec], id: rec.id, direction: "backward" });
    const fwd = planMoveFact({ lines: back.lines, records: back.records, id: rec.id, direction: "forward" });
    expect(joined(fwd.lines)).toBe(joined(lines));
  });
});

describe("AC-A3: crosses paragraph boundaries, bounded to the body", () => {
  const build = (bodyA, bodyB) => [GREETING, bodyA, bodyB, CLOSING, SIGNATURE];

  it("a fact at the last sentence of body paragraph A moves to the first slot of body paragraph B", () => {
    const lines = build(`I lead the platform team. ${FACT}`, "I ship weekly. I mentor juniors.");
    const rec = recordFor(lines, 1, FACT);
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    expect(out.lines[1]).toBe("I lead the platform team.");
    expect(out.lines[2]).toBe(`${FACT} I ship weekly. I mentor juniors.`);
    // greeting and closing untouched
    expect(out.lines[0]).toBe(GREETING);
    expect(out.lines[3]).toBe(CLOSING);
    expect(out.lines[4]).toBe(SIGNATURE);
    everyRecordLocatesItsText(out.lines, out.records);
    // two paragraph edits for the splice path (source + destination)
    expect(out.edits.map((e) => e.lineIndex).sort()).toEqual([1, 2]);
  });

  it("a cross-paragraph move round-trips byte-identically", () => {
    const lines = build(`I lead the platform team. ${FACT}`, "I ship weekly. I mentor juniors.");
    const rec = recordFor(lines, 1, FACT);
    const fwd = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    const movedRec = fwd.records.find((r) => r.id === rec.id);
    const back = planMoveFact({ lines: fwd.lines, records: fwd.records, id: movedRec.id, direction: "backward" });
    expect(joined(back.lines)).toBe(joined(lines));
  });

  it("forward at the last body sentence is a boundary no-op and never enters the closing", () => {
    const lines = build("I lead the platform team.", `I ship weekly. I mentor juniors. ${FACT}`);
    const rec = recordFor(lines, 2, FACT);
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("boundary");
    expect(out.lines).toBe(lines);
    // the closing/signature must never receive a fact (the unsafe direction)
    expect(out.lines[3]).toBe(CLOSING);
    expect(out.lines[4]).toBe(SIGNATURE);
    expect(joined(out.lines)).not.toContain(`${CLOSING} ${FACT}`);
  });

  it("backward at the first body sentence is a boundary no-op and never enters the greeting", () => {
    const lines = build(`${FACT} I lead the platform team.`, "I ship weekly. I mentor juniors.");
    const rec = recordFor(lines, 1, FACT);
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "backward" });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("boundary");
    expect(out.lines).toBe(lines);
    expect(out.lines[0]).toBe(GREETING);
  });
});

describe("AC-A11: a multi-sentence fact moves as ONE atomic unit (resolves N92C-4)", () => {
  const MULTI = "We won a national award. It made the news.";
  const multiLines = () => [GREETING, `I lead the platform team. ${MULTI} I ship weekly.`];

  it("moves both of the fact's sentences together; its internal boundary is NOT a slot", () => {
    const lines = multiLines();
    const rec = recordFor(lines, 1, MULTI);
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    // The WHOLE fact jumped past "I ship weekly." -- not just its first
    // sentence. A mutant that split at the internal period would leave "It
    // made the news." behind.
    expect(out.lines[1]).toBe(`I lead the platform team. I ship weekly. ${MULTI}`);
    const moved = out.records.find((r) => r.id === rec.id);
    expect(moved.text).toBe(MULTI);
    everyRecordLocatesItsText(out.lines, out.records);
    // the two sentences remain contiguous, appearing exactly once as a unit
    expect(countOccurrences(joined(out.lines), MULTI)).toBe(1);
  });

  it("round-trips byte-identically as a unit", () => {
    const lines = multiLines();
    const rec = recordFor(lines, 1, MULTI);
    const fwd = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    const back = planMoveFact({ lines: fwd.lines, records: fwd.records, id: rec.id, direction: "backward" });
    expect(joined(back.lines)).toBe(joined(lines));
  });
});

describe("AC-A5 / AC-A7: two adjacent facts moved past each other stay valid", () => {
  const FACT2 = "Beta shipped a new API.";
  // Two coalesced facts in one paragraph, screen order fact1 then fact2.
  const twoFactLines = () => [GREETING, `I lead the platform team. ${FACT} ${FACT2} I ship weekly.`];

  it("moving fact1 forward past fact2 keeps BOTH facts, once each, both locating their own text", () => {
    const lines = twoFactLines();
    const rec1 = recordFor(lines, 1, FACT, { id: "art-1" });
    const rec2 = recordFor(lines, 1, FACT2, { id: "art-2" });
    const out = planMoveFact({ lines, records: [rec1, rec2], id: "art-1", direction: "forward" });
    expect(out.changed).toBe(true);
    // fact1 is now AFTER fact2 (moved past exactly one sentence, which is fact2)
    expect(out.lines[1]).toBe(`I lead the platform team. ${FACT2} ${FACT} I ship weekly.`);
    // both present exactly once -- neither excised nor merged
    const all = joined(out.lines);
    expect(countOccurrences(all, FACT)).toBe(1);
    expect(countOccurrences(all, FACT2)).toBe(1);
    // the FULL records array is returned and every survivor locates its own text
    expect(out.records.map((r) => r.id).sort()).toEqual(["art-1", "art-2"]);
    everyRecordLocatesItsText(out.lines, out.records);
  });
});

describe("AC-A8: a stale / hand-edited locator is a safe no-op, never a guessed relocation", () => {
  it("returns unchanged lines when the text no longer sits at the stored offset", () => {
    const lines = singleParaLines();
    const rec = recordFor(lines, 1, FACT);
    // The candidate hand-edited the paragraph, shifting the fact off its offset.
    const staleRec = { ...rec, offset: rec.offset + 5 };
    const out = planMoveFact({ lines, records: [staleRec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("stale-locator");
    expect(out.lines, "a stale locator must leave lines byte-identical (same ref)").toBe(lines);
  });

  it("returns a not-found no-op when the id is absent", () => {
    const lines = singleParaLines();
    const rec = recordFor(lines, 1, FACT);
    const out = planMoveFact({ lines, records: [rec], id: "no-such-id", direction: "forward" });
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("not-found");
    expect(out.lines).toBe(lines);
  });
});

describe("AC-A12: a move preserves provenance (id/url/title/text)", () => {
  it("changes only lineIndex/offset; id, url, title and text survive", () => {
    const lines = singleParaLines();
    const rec = recordFor(lines, 1, FACT, {
      id: "art-dublin",
      url: "https://news.example.com/acme/dublin-lab",
      title: "Acme opens a Dublin telemetry lab",
    });
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    const moved = out.records.find((r) => r.id === "art-dublin");
    expect(moved.id).toBe("art-dublin");
    expect(moved.url).toBe("https://news.example.com/acme/dublin-lab");
    expect(moved.title).toBe("Acme opens a Dublin telemetry lab");
    expect(moved.text).toBe(FACT);
    // and it actually moved
    expect(moved.offset).not.toBe(rec.offset);
    everyRecordLocatesItsText(out.lines, out.records);
  });
});
