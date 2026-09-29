// N92 Wave 1 (Control A) -- AC-A13 / plan W1-S2: the LAST HOP for the
// highlight. After a move that changes a fact's paragraph, the run carrying
// the fact must be flagged `insertedFact` in the NEW paragraph of the
// docx-parsed model. `markInsertedFacts` matches per paragraph by (text,
// offset), NOT by lineIndex (versionDiff.js:154-175), so the ONLY thing that
// re-lands the highlight is the move writing the fact's NEW (text, offset)
// into the record. A `previewReloadKey` bump alone is not sufficient and is
// not what this test relies on (AC-A13; plan §8 W1-S2 SILENT row: an
// unreviewable fact reaching egress -- the N61 risk).
//
// RED-on-HEAD: imports planMoveFact from the not-yet-existing factMove.js.
//
// This test pins planMoveFact's OFFSET FRAME: the offset a move writes must
// be the offset within the DESTINATION paragraph's concatenated run text,
// exactly what markInsertedFacts consumes.

import { describe, it, expect } from "vitest";
import { planMoveFact } from "@/lib/acceptedFacts/factMove.js";
import { markInsertedFacts } from "@/lib/document/versionDiff.js";

const FACT = "Acme opened a Dublin lab.";
const LINES = [
  "Dear Hiring Manager,",
  `I lead the platform team. ${FACT}`,
  "I ship weekly. I mentor juniors.",
  "Sincerely,",
  "Jordan Rivera",
];

// Build a docx-parsed model whose every paragraph is a single run equal to
// the line -- so a run's concatenated text and offset frame match the line's.
function modelFromLines(lines) {
  return { paragraphs: lines.map((l) => ({ runs: [{ text: String(l) }] })) };
}

// The indices of paragraphs that carry at least one run flagged insertedFact.
function flaggedParagraphIndices(model) {
  const out = [];
  model.paragraphs.forEach((p, i) => {
    if ((p.runs || []).some((r) => r.insertedFact)) out.push(i);
  });
  return out;
}

describe("AC-A13: a cross-paragraph move re-lands the highlight on the moved fact", () => {
  it("flags the fact's run in the DESTINATION paragraph of the post-move model", () => {
    const rec = { id: "art-1", text: FACT, lineIndex: 1, offset: LINES[1].indexOf(FACT) };
    const moved = planMoveFact({ lines: LINES, records: [rec], id: rec.id, direction: "forward" });
    expect(moved.changed).toBe(true);
    const movedRec = moved.records.find((r) => r.id === "art-1");
    // The fact really changed paragraph (non-vacuity): source was line 1.
    expect(movedRec.lineIndex).toBe(2);

    const model = modelFromLines(moved.lines);
    const marked = markInsertedFacts(model, [{ text: movedRec.text, offset: movedRec.offset }]);

    // Destination paragraph (index 2) carries the flag; the old paragraph does not.
    expect(flaggedParagraphIndices(marked)).toEqual([2]);
    // and the flagged run text is exactly the fact
    const dest = marked.paragraphs[2];
    const flaggedText = dest.runs.filter((r) => r.insertedFact).map((r) => r.text).join("");
    expect(flaggedText).toBe(FACT);
  });

  it("CONTROL: the STALE (pre-move) locator loses the highlight -- proving the record's update is load-bearing", () => {
    const rec = { id: "art-1", text: FACT, lineIndex: 1, offset: LINES[1].indexOf(FACT) };
    const moved = planMoveFact({ lines: LINES, records: [rec], id: rec.id, direction: "forward" });

    // Mark the post-move model with the OLD locator (what a move that failed
    // to update the record would leave behind). The fact is no longer at that
    // (text, offset) in the source paragraph -> nothing is flagged anywhere.
    const model = modelFromLines(moved.lines);
    const markedStale = markInsertedFacts(model, [{ text: rec.text, offset: rec.offset }]);
    expect(flaggedParagraphIndices(markedStale)).toEqual([]);
  });
});
