// The depth-indent geometry, as a pure unit. No DOM: this module decides two
// numbers per depth and nothing else, which is exactly the kind of decision
// this repo extracts out of a component so it can be asserted without a
// renderer (see lib/experience/treeNav.js for the same split).
//
// WHAT THE CAP IS FOR. The page tree is an UNBOUNDED drill-down: nothing in
// lib/experience/tree.js limits nesting, and PageTreeItem recurses on
// `depth + 1` forever. A fixed per-level indent therefore consumes the title
// column without limit, and on a 375px phone the tree pane has ~253px of
// interior to spend. At the tree's own 12px-per-level step the title column
// is gone somewhere around depth 12 -- and `app/globals.css`'s
// `html { overflow-x: hidden }` means the row is CLIPPED rather than
// scrollable, i.e. the page title is deleted, not merely cramped.
//
// The ruling this module encodes: on phones the indent is a BOUNDED
// affordance that stops growing after PHONE_INDENT_MAX_DEPTH levels, and the
// depth information the flattened indent no longer carries is moved onto
// `aria-level`, which PageTreeItem sets explicitly (asserted in
// app/components/experience/experienceTree.mobile.test.js). Above `sm` the
// existing uncapped indent is unchanged, because a 280px desktop sidebar with
// a mouse is not the surface this pass is about and changing it would move
// shipped rendering for no measured reason.

import { describe, it, expect } from "vitest";
import { TREE_INDENT, MOVE_INDENT, indentAtDepth } from "./treeIndent.js";

// The cap is NOT imported: the module keeps it private on purpose (see its own
// comment), so it is pinned here through the behaviour it produces rather than
// by reading the number back. That is the stronger assertion anyway -- a cap
// that is declared but never applied would still satisfy a constant read.
const CAP = 3;

describe("the indent geometry constants", () => {
  it("caps phone indentation at three levels", () => {
    expect(indentAtDepth(CAP, TREE_INDENT).xs).toBe(indentAtDepth(CAP + 1, TREE_INDENT).xs);
    expect(indentAtDepth(CAP - 1, TREE_INDENT).xs).not.toBe(indentAtDepth(CAP, TREE_INDENT).xs);
  });

  // Pinned against the values the two call sites shipped with, so a change to
  // either reds here rather than silently re-flowing a tree.
  it("carries each call site's own base/step, unchanged from what it shipped with", () => {
    // PageTreeItem.js's row: `pl: depth * 1.5 + 0.5`.
    expect(TREE_INDENT).toEqual({ base: 0.5, step: 1.5 });
    // MovePageDialog.js / BulkActionsBar.js's destination list: `pl: 2 + depth * 2`.
    expect(MOVE_INDENT).toEqual({ base: 2, step: 2 });
  });
});

describe("indentAtDepth", () => {
  it("returns both breakpoint branches, each carrying a real value", () => {
    // The `{ xs: A, sm: undefined }` anti-pattern does not switch a rule off,
    // it just leaves `sm` inheriting `xs`. Every branch here must be a number.
    for (const depth of [0, 1, 3, 4, 9, 40]) {
      const value = indentAtDepth(depth, TREE_INDENT);
      expect(Object.keys(value).sort()).toEqual(["sm", "xs"]);
      expect(typeof value.xs).toBe("number");
      expect(typeof value.sm).toBe("number");
    }
  });

  it("is identical on both branches at or below the cap -- the shallow tree is untouched", () => {
    for (const depth of [0, 1, 2, 3]) {
      const { xs, sm } = indentAtDepth(depth, TREE_INDENT);
      expect(xs, `depth ${depth}`).toBe(sm);
    }
    expect(indentAtDepth(0, TREE_INDENT)).toEqual({ xs: 0.5, sm: 0.5 });
    expect(indentAtDepth(3, TREE_INDENT)).toEqual({ xs: 5, sm: 5 });
  });

  it("stops growing past the cap on xs while sm keeps going", () => {
    // 0.5 + 3 * 1.5 = 5 spacing units = 40px, at every depth from 3 up.
    expect(indentAtDepth(4, TREE_INDENT)).toEqual({ xs: 5, sm: 6.5 });
    expect(indentAtDepth(9, TREE_INDENT)).toEqual({ xs: 5, sm: 14 });
    expect(indentAtDepth(40, TREE_INDENT)).toEqual({ xs: 5, sm: 60.5 });
  });

  it("caps the move-destination list on the same rule, at its own step", () => {
    expect(indentAtDepth(0, MOVE_INDENT)).toEqual({ xs: 2, sm: 2 });
    expect(indentAtDepth(3, MOVE_INDENT)).toEqual({ xs: 8, sm: 8 });
    expect(indentAtDepth(7, MOVE_INDENT)).toEqual({ xs: 8, sm: 16 });
  });

  it("treats a missing, negative or non-numeric depth as the root, never NaN", () => {
    // A NaN reaching `sx` is not an error -- MUI serialises it and the rule is
    // silently dropped, so the row would lose its indent with no failure
    // anywhere. Pinned so that can never be how this behaves.
    for (const bad of [undefined, null, -3, "x", NaN]) {
      expect(indentAtDepth(bad, TREE_INDENT), String(bad)).toEqual({ xs: 0.5, sm: 0.5 });
    }
  });

  it("floors a fractional depth rather than emitting a fractional indent", () => {
    expect(indentAtDepth(2.7, TREE_INDENT)).toEqual({ xs: 3.5, sm: 3.5 });
  });
});
