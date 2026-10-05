// N104 Waves D/E - how a regenerate rewrites a tailoring entry and how Undo puts it
// back. Pure functions over plain entries.

import { describe, it, expect } from "vitest";
import { applyRegenerated, attachReport, reportFor, restoreFromSnapshot, snapshotForUndo } from "./regenerateEntry.js";

const BEFORE = "Line one\nLine two";
const AFTER = "Line one\nBuilt GraphQL APIs\nLine two";

const closure = (over = {}) => ({
  correspondenceUnavailable: false,
  closed: [{ category: "missing-keyword", requirementId: "q1", term: "GraphQL", label: "Posting keyword missing" }],
  stillOpen: [],
  countsBefore: { missingKeyword: 1, vague: 0, repetition: 0 },
  countsAfter: { missingKeyword: 0, vague: 0, repetition: 0 },
  lineCountBefore: 2,
  lineCountAfter: 3,
  genuinelyUnqualifiedStillOpen: [],
  ...over,
});

const result = ({ text = AFTER, ideal = {}, ...over } = {}) => ({
  regenerated: {
    result: text,
    resultLines: text.split("\n"),
    docxB64: "",
    ideal: {
      hypothetical: { result: "Hypothetical" },
      review: { flags: [], unresolvedQualifications: [], coverage: { complete: false } },
      counts: { kept: 3, removed: 0, leftOut: 0 },
      ...ideal,
    },
  },
  closure: closure(),
  confirm: [],
  genuinelyUnqualified: [],
  ...over,
});

const entry = () => ({
  status: "done",
  result: BEFORE,
  resultLines: BEFORE.split("\n"),
  docxB64: "old-bytes",
  resumePreviewHtml: "<p>hand edited</p>",
  edited: { resume: true, cover: true },
  jobDescription: "posting",
  generatedJobTitle: "Staff Engineer",
  ideal: { hypothetical: { result: "Hypothetical" }, applicationReady: { result: BEFORE } },
});

describe("reportFor", () => {
  it("is the report view of the closure, with the new run's set-aside and confirm counts", () => {
    const view = reportFor(
      entry(),
      result({
        ideal: {
          counts: { kept: 3, removed: 2, leftOut: 1 },
          review: { flags: [{ category: "unsupported-authority", message: "m" }], unresolvedQualifications: [] },
        },
      }),
    );
    expect(view.unchanged).toBe(false);
    expect(view.headline).toBe("Regenerated. 1 of 1 suggestion is no longer flagged.");
    expect(view.lines.some((l) => /2 lines were set aside/.test(l) && /1 left out/.test(l))).toBe(true);
    expect(view.lines.some((l) => /Still listed in the review: 1 to confirm\./.test(l))).toBe(true);
  });

  it("is unchanged when the regenerated text equals the text on screen, ignoring line endings and edge whitespace", () => {
    const view = reportFor(entry(), result({ text: `${BEFORE.replace("\n", "\r\n")}\n` }));
    expect(view.unchanged).toBe(true);
  });

  it("says the hypothetical was rebuilt only when its text changed", () => {
    const rebuilt = reportFor(entry(), result({ ideal: { hypothetical: { result: "A different hypothetical" } } }));
    expect(rebuilt.lines).toContain("The HYPOTHETICAL version was also rebuilt.");
    expect(reportFor(entry(), result()).lines).not.toContain("The HYPOTHETICAL version was also rebuilt.");
  });

  it("carries the guard through: an unavailable correspondence yields no per-suggestion rows", () => {
    const view = reportFor(entry(), result({ closure: closure({ correspondenceUnavailable: true }) }));
    expect(view.correspondenceUnavailable).toBe(true);
    expect(view.groups.some((g) => g.title === "No longer flagged")).toBe(false);
  });
});

describe("applyRegenerated", () => {
  it("writes the text, its lines and the whole ideal block with the report inside it", () => {
    const view = reportFor(entry(), result());
    const next = applyRegenerated(entry(), result(), view);
    expect(next.result).toBe(AFTER);
    expect(next.resultLines).toEqual(AFTER.split("\n"));
    expect(next.docxB64).toBe("");
    expect(next.status).toBe("done");
    expect(next.ideal.regenerateReport).toBe(view);
    expect(next.ideal.applicationReady).toBeUndefined(); // the NEW block, not a merge with the old one
  });

  it("clears the saved hand-edit html and only the resume's edited flag, and touches nothing else", () => {
    const next = applyRegenerated(entry(), result(), reportFor(entry(), result()));
    expect(next.resumePreviewHtml).toBeUndefined();
    expect(next.edited).toEqual({ resume: false, cover: true });
    expect(next.jobDescription).toBe("posting");
    expect(next.generatedJobTitle).toBe("Staff Engineer");
  });

  it("normalises a legacy boolean edited flag", () => {
    const next = applyRegenerated({ ...entry(), edited: true }, result(), reportFor(entry(), result()));
    expect(next.edited).toEqual({ resume: false, cover: true });
  });
});

describe("snapshotForUndo and restoreFromSnapshot", () => {
  it("round-trips: applying then restoring returns exactly what was on screen", () => {
    const original = entry();
    const snapshot = snapshotForUndo(original);
    const applied = applyRegenerated(original, result(), reportFor(original, result()));
    const restored = restoreFromSnapshot(applied, snapshot);
    for (const key of ["result", "resultLines", "docxB64", "resumePreviewHtml", "edited", "ideal"]) {
      expect(restored[key]).toBe(original[key]);
    }
    expect(restored.jobDescription).toBe("posting");
  });
});

describe("attachReport", () => {
  it("adds only the report to the existing ideal block", () => {
    const original = entry();
    const next = attachReport(original, { headline: "x" });
    expect(next.result).toBe(original.result);
    expect(next.ideal.applicationReady).toBe(original.ideal.applicationReady);
    expect(next.ideal.regenerateReport).toEqual({ headline: "x" });
    expect(original.ideal.regenerateReport).toBeUndefined();
  });
});
