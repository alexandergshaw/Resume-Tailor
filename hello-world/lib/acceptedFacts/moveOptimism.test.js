// N92: successful commit outputs, rather than old byte/edited flags, govern
// client reconciliation. Native session-only output and explicit null remain
// meaningful; recovered-original rebuilds may return fresh bytes and paths.

import { describe, it, expect } from "vitest";
import { captureCoverSnapshot, moveOptimisticPatch, moveSuccessPatch, resolveNoopMove } from "./moveOptimism.js";

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

describe("resolveNoopMove", () => {
  it("boundary reason -> skipped, with the boundary reason text", () => {
    expect(resolveNoopMove({ reason: "boundary" })).toEqual({
      outcome: "skipped",
      reason: "That fact can't move any further in that direction.",
    });
  });

  it("any other reason (e.g. stale) -> refused, with the reopen-the-letter reason text", () => {
    expect(resolveNoopMove({ reason: "stale" })).toEqual({
      outcome: "refused",
      reason: "That fact is no longer where it was recorded -- try reopening the letter.",
    });
  });

  it("a missing/undefined reason also falls to refused (not boundary)", () => {
    expect(resolveNoopMove({})).toEqual({
      outcome: "refused",
      reason: "That fact is no longer where it was recorded -- try reopening the letter.",
    });
  });

  it("boundary and non-boundary produce different outcomes AND different reason text", () => {
    const boundary = resolveNoopMove({ reason: "boundary" });
    const other = resolveNoopMove({ reason: "stale" });
    expect(boundary.outcome).not.toBe(other.outcome);
    expect(boundary.reason).not.toBe(other.reason);
  });
});

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

  it("no prior cover bytes -> adopt the fresh path returned by the successful commit", () => {
    expect(
      moveSuccessDocxPath({ hasCoverBytes: false, coverAlreadyEdited: false, preMove, commit: { coverDocxPath: "covers/fresh.docx" } }),
    ).toBe("covers/fresh.docx");
  });

  it("already hand-edited -> adopt the successful commit null path rather than stale pre-move path", () => {
    expect(
      moveSuccessDocxPath({ hasCoverBytes: true, coverAlreadyEdited: true, preMove, commit: { coverDocxPath: null } }),
    ).toBeNull();
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

// N92-DOCX6: the successful commit output, including explicit empty/null,
// is authoritative; stale pre-operation availability must not revive old data.
describe("current commit output reconciliation sentinels", () => {
  const moved = { lines: ["CURRENT BODY"], records: [{ id: "current", lineIndex: 0, offset: 0 }] };
  it("native empty/null success clears stale bytes and path without touching unrelated fields", () => {
    const current = { unrelated: "keep", coverLetterDocxB64: "STALE BYTES", coverLetterDocxPath: "stale/path" };
    const patch = moveSuccessPatch({ moved, hasCoverBytes: false, coverAlreadyEdited: true, preMove: current, curCoverDocxB64: current.coverLetterDocxB64, commit: { coverDocxB64: "", coverDocxPath: null } });
    expect({ ...current, ...patch }).toMatchObject({ unrelated: "keep", coverLetterResultLines: moved.lines, insertedFacts: moved.records, coverLetterDocxB64: "", coverLetterDocxPath: null });
  });
  it("recovered edited success adopts returned bytes and path despite absent old bytes", () => {
    const patch = moveSuccessPatch({ moved, hasCoverBytes: false, coverAlreadyEdited: true, preMove: { coverLetterDocxPath: "STALE PATH" }, curCoverDocxB64: "STALE BYTES", commit: { coverDocxB64: "FRESH COMMIT BYTES", coverDocxPath: "fresh/commit.docx" } });
    expect(patch.coverLetterDocxB64).toBe("FRESH COMMIT BYTES"); expect(patch.coverLetterDocxPath).toBe("fresh/commit.docx");
  });
});
