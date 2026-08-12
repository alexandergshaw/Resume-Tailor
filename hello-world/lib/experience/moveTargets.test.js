import { describe, it, expect } from "vitest";
import { moveTargets } from "./moveTargets.js";

// Where a page is allowed to move to, as a list a dialog can render.
//
// This exists because chunk 2 shipped re-parenting as drag-and-drop ONLY.
// Dragging is unreachable by keyboard and unusable with a screen reader, so a
// core operation of the feature was pointer-only. The keyboard path needs the
// same legality rules the drag path gets from canMove, and those rules are
// worth asserting once, here, rather than inside a dialog.
//
// Rows are experience_pages rows, the same shape lib/experience/tree.js takes.

function row(id, parentId, position, title) {
  return Object.freeze({
    id,
    user_id: "u1",
    parent_id: parentId,
    title,
    body: "",
    position,
    archived_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  });
}

// Alpha
//   Boeing
//     Boeing detail
//   Ceiling
// Zulu
const ROWS = Object.freeze([
  row("n1", null, 0, "Alpha"),
  row("n2", "n1", 0, "Boeing"),
  row("n4", "n2", 0, "Boeing detail"),
  row("n3", "n1", 1, "Ceiling"),
  row("n7", null, 1, "Zulu"),
]);

const ids = (targets) => targets.map((t) => t.id);

describe("moveTargets", () => {
  it("offers the top level first, then every page in tree order", () => {
    expect(moveTargets(ROWS, "n4")).toEqual([
      { id: null, label: "Top level", depth: 0 },
      { id: "n1", label: "Alpha", depth: 0 },
      { id: "n3", label: "Alpha / Ceiling", depth: 1 },
      { id: "n7", label: "Zulu", depth: 0 },
    ]);
  });

  it("excludes the page itself and everything under it", () => {
    // Moving Boeing: n2 itself and its child n4 are impossible destinations,
    // and the API would reject them as `cycle` anyway.
    const targets = moveTargets(ROWS, "n2");
    expect(ids(targets)).not.toContain("n2");
    expect(ids(targets)).not.toContain("n4");
    // Positive control: pages that are NOT descendants are still offered, so
    // this cannot pass by returning an empty list.
    expect(ids(targets)).toContain("n3");
    expect(ids(targets)).toContain("n7");
  });

  it("excludes the page's current parent, which would be a no-op", () => {
    expect(ids(moveTargets(ROWS, "n4"))).not.toContain("n2");
    // A page already at the top level is not offered the top level again.
    expect(ids(moveTargets(ROWS, "n7"))).not.toContain(null);
    // Positive control: a nested page IS offered the top level.
    expect(ids(moveTargets(ROWS, "n4"))).toContain(null);
  });

  it("labels each destination with its full path, so same-named pages differ", () => {
    const dupes = [
      row("a", null, 0, "Notes"),
      row("b", "a", 0, "Q3"),
      row("c", null, 1, "Archive"),
      row("d", "c", 0, "Q3"),
      row("x", null, 2, "Mover"),
    ];
    const labels = moveTargets(dupes, "x").map((t) => t.label);
    expect(labels).toContain("Notes / Q3");
    expect(labels).toContain("Archive / Q3");
    // Two destinations both reading "Q3" would be an unusable dialog.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("reports depth for indentation without relying on the label", () => {
    const byId = new Map(moveTargets(ROWS, "n7").map((t) => [t.id, t.depth]));
    expect(byId.get("n1")).toBe(0);
    expect(byId.get("n2")).toBe(1);
    expect(byId.get("n4")).toBe(2);
  });

  it("returns nothing for a page that is not in the set", () => {
    expect(moveTargets(ROWS, "nope")).toEqual([]);
    expect(moveTargets([], "n1")).toEqual([]);
  });

  it("survives a broken parent link without hiding a destination", () => {
    // buildTree surfaces an orphan as a root, so it is a legal destination and
    // must still be offered rather than silently dropped.
    const broken = [row("ghost", "missing", 0, "Ghost"), row("real", null, 1, "Real")];
    expect(ids(moveTargets(broken, "real"))).toContain("ghost");
  });
});
