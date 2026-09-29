// N95 -- unit coverage for moveOptimism.js's pure helpers, in particular the
// TDD-flagged open decision this chunk resolves: whether a SUCCESSFUL bytes
// move reconciles coverLetterDocxPath (rather than leaving it nulled by the
// optimistic write). Resolved as: reconcile from the commit's own fresh
// path when a splice actually ran; mirror the server's null when the move
// never had bytes to begin with; restore the pre-move path when the docx was
// never touched at all (an already hand-edited letter). See this module's
// own header comment for the full reasoning.

import { describe, it, expect } from "vitest";
import { captureCoverSnapshot, moveOptimisticPatch, moveSuccessPatch } from "./moveOptimism.js";

// resolveMoveDocxPath (the path-reconcile decision) is a module-private
// helper -- moveSuccessPatch is its one caller and its public seam, so the
// three cases below are driven through THAT export rather than importing an
// internal function (which would give it a second, test-only "importer" and
// misstate the module's real shipping surface -- see moveOptimism.js's own
// header comment on why it stays unexported).
function moveSuccessDocxPath(args) {
  return moveSuccessPatch({
    moved: { lines: ["x"], records: [] },
    curCoverDocxB64: "",
    commit: { coverDocxB64: "fresh-b64", ...args.commit },
    ...args,
  }).coverLetterDocxPath;
}

describe("captureCoverSnapshot", () => {
  it("captures exactly the five cover-scoped fields, by reference", () => {
    const lines = ["a", "b"];
    const facts = [{ id: "f1" }];
    const entry = {
      coverLetterResultLines: lines,
      insertedFacts: facts,
      coverLetterDocxB64: "b64",
      coverLetterDocxPath: "covers/x.docx",
      coverLetterPreviewHtml: "<p>x</p>",
      unrelatedField: "must not leak in",
    };
    const snap = captureCoverSnapshot(entry);
    expect(snap).toEqual({
      coverLetterResultLines: lines,
      insertedFacts: facts,
      coverLetterDocxB64: "b64",
      coverLetterDocxPath: "covers/x.docx",
      coverLetterPreviewHtml: "<p>x</p>",
    });
    // Same references, not copies -- planMoveFact never mutates its inputs,
    // so a rollback restoring these must be byte-identical to the originals.
    expect(snap.coverLetterResultLines).toBe(lines);
    expect(snap.insertedFacts).toBe(facts);
    expect(snap).not.toHaveProperty("unrelatedField");
  });

  it("degrades to all-undefined for a missing/empty entry, never throws", () => {
    expect(captureCoverSnapshot(undefined)).toEqual({
      coverLetterResultLines: undefined,
      insertedFacts: undefined,
      coverLetterDocxB64: undefined,
      coverLetterDocxPath: undefined,
      coverLetterPreviewHtml: undefined,
    });
  });
});

describe("moveOptimisticPatch", () => {
  it("carries the moved lines/records and nulls BOTH docx byte sources plus the stale preview html", () => {
    const moved = { lines: ["new"], records: [{ id: "f1", lineIndex: 0, offset: 0 }] };
    expect(moveOptimisticPatch(moved)).toEqual({
      coverLetterResultLines: moved.lines,
      insertedFacts: moved.records,
      coverLetterPreviewHtml: undefined,
      coverLetterDocxB64: undefined,
      coverLetterDocxPath: undefined,
    });
  });
});

describe("moveSuccessPatch's coverLetterDocxPath reconciliation (the open decision)", () => {
  const preMove = { coverLetterDocxPath: "covers/pre-move.docx" };

  it("no cover bytes -> null, mirroring the PUT's own docxPath:null (AC-A9)", () => {
    expect(
      moveSuccessDocxPath({ hasCoverBytes: false, coverAlreadyEdited: false, preMove, commit: { coverDocxPath: "covers/fresh.docx" } }),
    ).toBeNull();
  });

  it("bytes + already hand-edited -> restores the PRE-MOVE path (the docx was never touched)", () => {
    expect(
      moveSuccessDocxPath({ hasCoverBytes: true, coverAlreadyEdited: true, preMove, commit: { coverDocxPath: null } }),
    ).toBe("covers/pre-move.docx");
  });

  it("bytes + spliced -> the commit's fresh path", () => {
    expect(
      moveSuccessDocxPath({ hasCoverBytes: true, coverAlreadyEdited: false, preMove, commit: { coverDocxPath: "covers/fresh.docx" } }),
    ).toBe("covers/fresh.docx");
  });

  it("bytes + spliced but the best-effort upload failed -> null, not the stale pre-move path", () => {
    expect(
      moveSuccessDocxPath({ hasCoverBytes: true, coverAlreadyEdited: false, preMove, commit: { coverDocxPath: null } }),
    ).toBeNull();
  });
});
