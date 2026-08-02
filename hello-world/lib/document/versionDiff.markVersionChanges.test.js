import { describe, it, expect } from "vitest";
import { markVersionChanges, classifyLineChanges, markChangedParagraphs } from "./versionDiff.js";
import { linesToModel } from "./docxPreview.js";

// Every run in the model, flattened, so mark state can be asserted across
// the whole document in one pass.
function allRuns(model) {
  return model.paragraphs.flatMap((p) => p.runs);
}

describe("markVersionChanges", () => {
  it("identical previous and current lines produce a model with no marks anywhere", () => {
    const lines = ["Header", "Line one", "Line two"];
    const model = linesToModel(lines);

    const result = markVersionChanges(model, lines, lines);

    expect(result.paragraphs).toHaveLength(3);
    expect(allRuns(result).length).toBeGreaterThan(0);
    for (const run of allRuns(result)) {
      expect(run.mark).toBeFalsy();
    }
  });

  it("empty previousLines (first-version case) produce a model with no marks", () => {
    const currentLines = ["Header", "Line one", "Line two"];
    const model = linesToModel(currentLines);

    const result = markVersionChanges(model, [], currentLines);

    expect(result.paragraphs).toHaveLength(3);
    for (const run of allRuns(result)) {
      expect(run.mark).toBeFalsy();
    }
  });

  it("a genuinely changed line marks exactly its paragraph and nowhere else", () => {
    const previousLines = ["Header", "Line one", "Line two", "Footer"];
    const currentLines = ["Header", "Line one CHANGED", "Line two", "Footer"];
    const model = linesToModel(currentLines);

    const result = markVersionChanges(model, previousLines, currentLines);

    expect(result.paragraphs).toHaveLength(4);
    result.paragraphs.forEach((p, i) => {
      const marked = p.runs.length > 0 && p.runs.every((r) => r.mark === true);
      if (i === 1) {
        expect(marked).toBe(true);
      } else {
        expect(p.runs.some((r) => r.mark)).toBe(false);
      }
    });
  });

  it("multiple non-contiguous changes (added + modified) mark only those paragraphs", () => {
    const previousLines = ["Header", "Line one", "Line two", "Footer"];
    const currentLines = ["Header", "Line one CHANGED", "Line two", "Brand new line", "Footer"];
    const model = linesToModel(currentLines);

    const result = markVersionChanges(model, previousLines, currentLines);

    expect(result.paragraphs).toHaveLength(5);
    const markedIndices = [1, 3];
    result.paragraphs.forEach((p, i) => {
      const marked = p.runs.length > 0 && p.runs.every((r) => r.mark === true);
      if (markedIndices.includes(i)) {
        expect(marked).toBe(true);
      } else {
        expect(p.runs.some((r) => r.mark)).toBe(false);
      }
    });
  });

  it("does not mutate the input model", () => {
    const previousLines = ["Header", "Line one", "Line two"];
    const currentLines = ["Header", "Line one CHANGED", "Line two"];
    const model = linesToModel(currentLines);
    const snapshot = JSON.parse(JSON.stringify(model));

    markVersionChanges(model, previousLines, currentLines);

    expect(model).toEqual(snapshot);
    for (const run of allRuns(model)) {
      expect(run.mark).toBeUndefined();
    }
  });

  it("composes classifyLineChanges and markChangedParagraphs identically to calling them by hand", () => {
    const previousLines = ["Header", "Line one", "Line two", "Footer"];
    const currentLines = ["Header", "Line one CHANGED", "Line two", "New closer", "Footer"];
    const modelA = linesToModel(currentLines);
    const modelB = linesToModel(currentLines);

    const wrapped = markVersionChanges(modelA, previousLines, currentLines);

    const changes = classifyLineChanges(previousLines, currentLines);
    const byHand = markChangedParagraphs(modelB, changes);

    expect(wrapped).toEqual(byHand);
    // Sanity check the composition actually flagged something, so the
    // equality above isn't trivially true over two all-unmarked models.
    expect(allRuns(wrapped).some((r) => r.mark)).toBe(true);
  });
});
