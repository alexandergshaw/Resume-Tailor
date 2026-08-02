import { describe, it, expect } from "vitest";
import { markChangedParagraphs } from "./versionDiff";

function buildModel() {
  return {
    align: "left",
    paragraphs: [
      {
        align: "left",
        runs: [
          { text: "Heading", bold: true, sizePt: 14 },
        ],
      },
      {
        align: "left",
        runs: [
          { text: "First ", bold: false, sizePt: 11 },
          { text: "second ", bold: true, sizePt: 11 },
          { text: "third", bold: false, sizePt: 11 },
        ],
      },
      {
        align: "center",
        runs: [{ text: "Footer", bold: false, sizePt: 9 }],
      },
    ],
  };
}

describe("markChangedParagraphs", () => {
  it("does not mutate the original model and returns a different object", () => {
    const model = buildModel();
    const changes = new Map([[0, "added"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result).not.toBe(model);
    expect(model.paragraphs[0].runs[0].mark).toBeUndefined();
    expect(model.paragraphs[1].runs[0].mark).toBeUndefined();
    expect(model.paragraphs[2].runs[0].mark).toBeUndefined();
  });

  it("sets mark true on every run of a flagged paragraph", () => {
    const model = buildModel();
    const changes = new Map([[1, "modified"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result.paragraphs[1].runs).toHaveLength(3);
    result.paragraphs[1].runs.forEach((run) => {
      expect(run.mark).toBe(true);
    });
  });

  it("leaves runs of paragraphs absent from the changes map without a mark property", () => {
    const model = buildModel();
    const changes = new Map([[1, "modified"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result.paragraphs[0].runs[0].mark).toBeUndefined();
    expect(result.paragraphs[2].runs[0].mark).toBeUndefined();
  });

  it("returns unaffected paragraphs by the same object reference", () => {
    const model = buildModel();
    const changes = new Map([[1, "modified"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result.paragraphs[0]).toBe(model.paragraphs[0]);
    expect(result.paragraphs[2]).toBe(model.paragraphs[2]);
    expect(result.paragraphs[1]).not.toBe(model.paragraphs[1]);
  });

  it("returns a model whose paragraphs are all the same references when changes is an empty map", () => {
    const model = buildModel();
    const changes = new Map();

    const result = markChangedParagraphs(model, changes);

    expect(result).not.toBe(model);
    result.paragraphs.forEach((p, i) => {
      expect(p).toBe(model.paragraphs[i]);
    });
  });

  it("keeps existing run properties like text, bold and sizePt intact on marked runs", () => {
    const model = buildModel();
    const changes = new Map([[0, "added"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result.paragraphs[0].runs[0]).toEqual({
      text: "Heading",
      bold: true,
      sizePt: 14,
      mark: true,
    });
  });

  it("marks all runs of a paragraph that has multiple runs", () => {
    const model = buildModel();
    const changes = new Map([[1, "modified"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result.paragraphs[1].runs.map((r) => r.text)).toEqual([
      "First ",
      "second ",
      "third",
    ]);
    expect(result.paragraphs[1].runs.every((r) => r.mark === true)).toBe(true);
  });

  it("handles a model with no paragraphs without throwing", () => {
    const model = { paragraphs: [] };
    const changes = new Map([[0, "added"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result.paragraphs).toEqual([]);
  });

  it("handles a flagged paragraph that has no runs without throwing", () => {
    const model = {
      paragraphs: [{ align: "left", runs: [] }],
    };
    const changes = new Map([[0, "added"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result.paragraphs[0].runs).toEqual([]);
    expect(result.paragraphs[0]).toBe(model.paragraphs[0]);
  });

  it("preserves paragraph-level properties like align on marked paragraphs", () => {
    const model = buildModel();
    const changes = new Map([[2, "modified"]]);

    const result = markChangedParagraphs(model, changes);

    expect(result.paragraphs[2].align).toBe("center");
    expect(result.paragraphs[2].runs[0].mark).toBe(true);
  });
});
