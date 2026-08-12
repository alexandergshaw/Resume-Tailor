import { describe, it, expect } from "vitest";
import { selectionSummary, bulkMoveTargets, toggleSelected } from "./bulkSelection.js";

// Checkbox selection across the Professional Experience page tree, and what a
// bulk action is allowed to do with it.
//
// The counting rules are the dangerous part. A bulk delete cascades through
// every selected page's whole subtree, so the number shown in the confirmation
// is the only thing standing between a mis-click and losing work - and it has
// to be right when the selection overlaps itself, which is the common case as
// soon as someone selects a parent and then one of its children.

function row(id, parentId, title) {
  return Object.freeze({
    id,
    user_id: "u1",
    parent_id: parentId,
    title,
    body: "",
    position: 0,
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
//   Zulu child
const ROWS = Object.freeze([
  row("n1", null, "Alpha"),
  row("n2", "n1", "Boeing"),
  row("n4", "n2", "Boeing detail"),
  row("n3", "n1", "Ceiling"),
  row("n7", null, "Zulu"),
  row("n8", "n7", "Zulu child"),
]);

describe("toggleSelected", () => {
  it("adds and removes without mutating the set it was given", () => {
    const empty = new Set();
    const one = toggleSelected(empty, "n1");
    expect([...one]).toEqual(["n1"]);
    expect(empty.size).toBe(0);

    const none = toggleSelected(one, "n1");
    expect([...none]).toEqual([]);
    expect([...one]).toEqual(["n1"]);
  });

  it("does not select a page's children implicitly", () => {
    // Implicit selection means a bulk delete removes pages the user never
    // ticked, and the count in the bar stops matching what they can see.
    expect([...toggleSelected(new Set(), "n1")]).toEqual(["n1"]);
  });
});

describe("selectionSummary", () => {
  it("reports the pages picked and the extra pages that go with them", () => {
    // Selecting Alpha takes Boeing, Boeing detail and Ceiling with it.
    expect(selectionSummary(ROWS, new Set(["n1"]))).toEqual({
      selected: 1,
      descendants: 3,
      total: 4,
    });
  });

  it("counts an overlapping selection once, never twice", () => {
    // Alpha AND its child Boeing. Boeing is both selected and a descendant of
    // Alpha; a naive sum reports 2 selected + 4 descendants = 6 pages deleted
    // from a tree that only loses 4. Over-stating the blast radius trains the
    // user to ignore the number; under-stating it loses their work.
    expect(selectionSummary(ROWS, new Set(["n1", "n2"]))).toEqual({
      selected: 2,
      descendants: 2,
      total: 4,
    });
  });

  it("counts two disjoint subtrees additively", () => {
    // Positive control for the dedup above: with no overlap the totals really
    // do add up, so the dedup cannot be a blanket under-count.
    expect(selectionSummary(ROWS, new Set(["n1", "n7"]))).toEqual({
      selected: 2,
      descendants: 4,
      total: 6,
    });
  });

  it("reports leaves as taking nothing with them", () => {
    expect(selectionSummary(ROWS, new Set(["n4"]))).toEqual({
      selected: 1,
      descendants: 0,
      total: 1,
    });
  });

  it("is empty for an empty selection", () => {
    expect(selectionSummary(ROWS, new Set())).toEqual({ selected: 0, descendants: 0, total: 0 });
  });

  it("ignores ids that are not in the tree", () => {
    // A stale id left over from a page deleted in another tab must not inflate
    // the count of what is about to be destroyed.
    expect(selectionSummary(ROWS, new Set(["n4", "ghost"]))).toEqual({
      selected: 1,
      descendants: 0,
      total: 1,
    });
  });
});

describe("bulkMoveTargets", () => {
  it("offers only destinations legal for EVERY selected page", () => {
    // Moving Boeing and Ceiling together: neither may land inside Boeing's own
    // subtree, so Boeing and Boeing detail are both out, and their shared
    // current parent Alpha is a no-op for both.
    const targets = bulkMoveTargets(ROWS, new Set(["n2", "n3"])).map((t) => t.id);
    expect(targets).not.toContain("n2");
    expect(targets).not.toContain("n4");
    expect(targets).not.toContain("n1");
    // Positive control: a genuinely legal destination is still offered, so this
    // cannot pass by returning nothing.
    expect(targets).toContain("n7");
    expect(targets).toContain(null);
  });

  it("excludes a destination that only ONE of the selection cannot use", () => {
    // Zulu child is a legal destination for Boeing but not for Zulu, its own
    // ancestor. The intersection has to drop it, not keep it because it worked
    // for the first page checked.
    const targets = bulkMoveTargets(ROWS, new Set(["n2", "n7"])).map((t) => t.id);
    expect(targets).not.toContain("n8");
    expect(targets).not.toContain("n7");
  });

  it("labels each destination with its full path", () => {
    const labels = bulkMoveTargets(ROWS, new Set(["n3"])).map((t) => t.label);
    expect(labels).toContain("Alpha / Boeing");
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("returns nothing for an empty selection", () => {
    expect(bulkMoveTargets(ROWS, new Set())).toEqual([]);
  });

  it("can legitimately return nothing when no destination suits everything", () => {
    // Selecting every page leaves nowhere to go but the top level, and pages
    // already at the top level make even that a no-op. The bulk Move action is
    // then disabled WITH an explanation rather than silently absent - assert
    // the empty result so the UI has something honest to key on.
    const all = new Set(ROWS.map((r) => r.id));
    expect(bulkMoveTargets(ROWS, all)).toEqual([]);
  });
});
