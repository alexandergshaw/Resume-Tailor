// AC-11.2 / PLAN §4.7 — the two additions expandable bullets needs out of
// answerPoints.js, and nothing else.
//
// This is a SEPARATE file from answerPoints.test.js on purpose: AC-11.1(a)
// requires every existing answerLines test to pass UNMODIFIED, and the
// cheapest way to guarantee that is not to open them.
//
// 1. `sourceIndex` — the index into `cleanAnswerPoints(points)`, which is the
//    array the expand route validates against. It is NOT the rendered line
//    index: `answerLines` maps 1:1 over the cleaned points and only THEN drops
//    label-only lines, so the two indices diverge the moment a point is
//    nothing but its own STAR label. A client sending the rendered index
//    elaborates the wrong bullet — silently, with the right count and the
//    right citation shape.
//
// 2. `stripStarLabel` — the three lines answerLines already performs inline,
//    exported so the expand route's identity check (AC-4.14a) can reuse the
//    ONE regex instead of open-coding a fourth consumer beside a decoy
//    (questionVocabulary.js declares a different, module-private
//    STAR_LABEL_RE).

import { describe, it, expect } from "vitest";
import { answerLines, cleanAnswerPoints, stripStarLabel } from "./answerPoints.js";

describe("answerLines — sourceIndex", () => {
  // The shortest array in which the rendered index and the source index
  // differ: "Situation:" survives cleanAnswerPoints (it is not blank) and is
  // only dropped after the map, once its label is stripped and nothing is
  // left; "" is dropped by cleanAnswerPoints itself.
  const POINTS = ["Situation:", "A sentence.", "", "B sentence."];

  it("indexes cleanAnswerPoints, not the rendered line array", () => {
    const cleaned = cleanAnswerPoints(POINTS);
    expect(cleaned).toEqual(["Situation:", "A sentence.", "B sentence."]);

    const lines = answerLines([], POINTS);
    expect(lines.map((l) => l.point)).toEqual(["A sentence.", "B sentence."]);
    expect(lines.map((l) => l.sourceIndex)).toEqual([1, 2]);
  });

  it("is NOT the rendered line index", () => {
    // The trap this criterion exists for. A test that only asserted
    // `sourceIndex === arrayIndex` would pass against an implementation that
    // hands back the post-filter position.
    const lines = answerLines([], POINTS);
    lines.forEach((line, renderedIndex) => {
      expect(line.sourceIndex).not.toBe(renderedIndex);
    });
  });

  it("round-trips: cleanPoints[line.sourceIndex] is the line's own raw point", () => {
    const cleaned = cleanAnswerPoints(POINTS);
    for (const line of answerLines([], POINTS)) {
      expect(stripStarLabel(cleaned[line.sourceIndex])).toBe(line.point);
    }
  });

  it("adds nothing else — the existing five fields are untouched", () => {
    const [line] = answerLines(["moved settlement"], ["Situation: We moved settlement onto Kafka."], [
      { id: "p1", title: "Payments" },
    ]);
    expect(Object.keys(line).sort()).toEqual(
      ["cue", "emphasis", "label", "pageSource", "point", "sourceIndex"].sort(),
    );
    expect(line.label).toBe("Situation");
    expect(line.point).toBe("We moved settlement onto Kafka.");
    expect(line.pageSource).toEqual({ id: "p1", title: "Payments" });
  });
});

describe("stripStarLabel", () => {
  it("removes a leading STAR label and trims", () => {
    expect(stripStarLabel("Situation: We lost settlements.")).toBe("We lost settlements.");
    expect(stripStarLabel("Result:   I cut latency.")).toBe("I cut latency.");
  });

  it("leaves an unlabelled sentence exactly as it is", () => {
    expect(stripStarLabel("Plain sentence.")).toBe("Plain sentence.");
  });

  it("does not throw on a non-string, and never returns a non-string", () => {
    expect(stripStarLabel(null)).toBe("");
    expect(stripStarLabel(undefined)).toBe("");
    expect(stripStarLabel(42)).toBe("");
    expect(stripStarLabel({})).toBe("");
  });

  it("is the same rule answerLines applies inline", () => {
    // The point of exporting it: the route's identity check and the render
    // path must agree, byte for byte, on what "the label-stripped point" is.
    const raw = "Action: I rebuilt the ledger.";
    const [line] = answerLines([], [raw]);
    expect(stripStarLabel(raw)).toBe(line.point);
  });
});
