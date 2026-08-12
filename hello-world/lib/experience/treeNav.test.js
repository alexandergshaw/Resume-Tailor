import { describe, it, expect } from "vitest";
import { visibleNodes, nextFocus } from "./treeNav.js";

// The page tree's keyboard model, kept out of the component so it can be
// asserted without a DOM. The behaviour is the W3C APG tree view pattern:
// https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
//
// Revision 2, after an audit ran 34 mutants against the first draft and 14
// survived. Three lessons are built into the shape of this file:
//
//  1. EVERY assertion compares the WHOLE result object. The first draft checked
//     `.focusId` alone in six tests, and eight surviving mutants were expansion
//     side-effects riding through them - including one where ArrowDown expands
//     every collapsed node you pass, unfolding the tree behind the user, under a
//     test whose own comment claimed to forbid it. The `res()` helper below
//     makes a full comparison as short as a partial one, so there is no
//     incentive to go back to spot-checks.
//  2. Titles and ids are DIFFERENT strings. The first draft used
//     `title: id.toUpperCase()`, which made the two fields interchangeable: an
//     implementation type-aheading over ids instead of visible labels passed.
//     Real ids are uuids and real titles are prose.
//  3. The fixture contains a title starting with "Shift" and a title starting
//     with a SPACE, so the "these keys are not type-ahead" test can actually
//     fail. Without them it was decoration - a mutant that let Space trigger
//     type-ahead (swallowing APG's selection key) sailed through.

const node = (id, title, children = []) => ({ id, title, children });

// Alpha                     n1, expanded
//   Boeing                  n2, has a child, collapsed
//     Boeing detail         n4, hidden while n2 is collapsed
//   Ceiling                 n3, leaf
// Shift handover            n5, root leaf - title starts with a modifier name
//  Spaced entry             n6, root leaf - title starts with a space
// Zulu                      n7, root parent, COLLAPSED
//   Zulu child              n8, hidden
// Boeing archive            n9, root leaf - second "b" for forward search
const TREE = [
  node("n1", "Alpha", [node("n2", "Boeing", [node("n4", "Boeing detail")]), node("n3", "Ceiling")]),
  node("n5", "Shift handover"),
  node("n6", " Spaced entry"),
  node("n7", "Zulu", [node("n8", "Zulu child")]),
  node("n9", "Boeing archive"),
];
const EXPANDED = new Set(["n1"]);

const VISIBLE = [
  { id: "n1", title: "Alpha", depth: 0, hasChildren: true, expanded: true },
  { id: "n2", title: "Boeing", depth: 1, hasChildren: true, expanded: false },
  { id: "n3", title: "Ceiling", depth: 1, hasChildren: false, expanded: false },
  { id: "n5", title: "Shift handover", depth: 0, hasChildren: false, expanded: false },
  { id: "n6", title: " Spaced entry", depth: 0, hasChildren: false, expanded: false },
  { id: "n7", title: "Zulu", depth: 0, hasChildren: true, expanded: false },
  { id: "n9", title: "Boeing archive", depth: 0, hasChildren: false, expanded: false },
];

// The full result contract. `handled` is what the component uses to decide
// whether to call preventDefault: a tree that swallows Tab is a focus trap, so
// "the tree ignores this key" and "the tree consumed this key to no effect" must
// be distinguishable.
const res = (focusId, extra = {}) => ({
  focusId,
  expand: false,
  collapse: false,
  activate: false,
  handled: true,
  ...extra,
});

describe("visibleNodes", () => {
  it("flattens only what the user can see, with title, depth and child state", () => {
    expect(visibleNodes(TREE, EXPANDED)).toEqual(VISIBLE);
  });

  it("reveals a collapsed node's children when it opens", () => {
    const opened = visibleNodes(TREE, new Set(["n1", "n2"]));
    expect(opened.map((n) => n.id)).toEqual(["n1", "n2", "n4", "n3", "n5", "n6", "n7", "n9"]);
    expect(opened.find((n) => n.id === "n4")).toEqual({
      id: "n4",
      title: "Boeing detail",
      depth: 2,
      hasChildren: false,
      expanded: false,
    });
  });

  it("shows only the roots when nothing is expanded", () => {
    expect(visibleNodes(TREE, new Set()).map((n) => n.id)).toEqual(["n1", "n5", "n6", "n7", "n9"]);
  });

  it("never reports a leaf as expanded, even if its id lingers in the set", () => {
    // Deleting a page and re-adding one with the same id leaves stale entries.
    // A leaf reporting expanded:true makes the renderer draw a disclosure
    // twisty on a node that can never open.
    const stale = visibleNodes(TREE, new Set(["n1", "n3"]));
    expect(stale.find((n) => n.id === "n3")).toEqual({
      id: "n3",
      title: "Ceiling",
      depth: 1,
      hasChildren: false,
      expanded: false,
    });
  });

  it("survives an empty tree", () => {
    expect(visibleNodes([], new Set())).toEqual([]);
    expect(visibleNodes(null, new Set())).toEqual([]);
  });
});

describe("nextFocus - vertical movement", () => {
  it("moves down and up the visible list with no side effects", () => {
    expect(nextFocus(VISIBLE, "n1", "ArrowDown")).toEqual(res("n2"));
    expect(nextFocus(VISIBLE, "n3", "ArrowUp")).toEqual(res("n2"));
  });

  it("steps over a collapsed node's hidden children", () => {
    expect(nextFocus(VISIBLE, "n2", "ArrowDown")).toEqual(res("n3"));
  });

  it("stays put at both ends without expanding or collapsing anything", () => {
    expect(nextFocus(VISIBLE, "n9", "ArrowDown")).toEqual(res("n9"));
    expect(nextFocus(VISIBLE, "n1", "ArrowUp")).toEqual(res("n1"));
  });

  it("jumps to the first and last visible node", () => {
    expect(nextFocus(VISIBLE, "n3", "Home")).toEqual(res("n1"));
    expect(nextFocus(VISIBLE, "n3", "End")).toEqual(res("n9"));
    // Already there: still a no-op, still no side effect.
    expect(nextFocus(VISIBLE, "n1", "Home")).toEqual(res("n1"));
    expect(nextFocus(VISIBLE, "n9", "End")).toEqual(res("n9"));
  });
});

describe("nextFocus - ArrowRight", () => {
  it("opens a closed parent and keeps focus on it", () => {
    expect(nextFocus(VISIBLE, "n2", "ArrowRight")).toEqual(res("n2", { expand: true }));
    expect(nextFocus(VISIBLE, "n7", "ArrowRight")).toEqual(res("n7", { expand: true }));
  });

  it("moves into the first child of a parent that is already open", () => {
    expect(nextFocus(VISIBLE, "n1", "ArrowRight")).toEqual(res("n2"));
  });

  it("does nothing on a leaf, at any depth", () => {
    expect(nextFocus(VISIBLE, "n3", "ArrowRight")).toEqual(res("n3"));
    expect(nextFocus(VISIBLE, "n5", "ArrowRight")).toEqual(res("n5"));
  });
});

describe("nextFocus - ArrowLeft", () => {
  it("closes an open parent and keeps focus on it", () => {
    expect(nextFocus(VISIBLE, "n1", "ArrowLeft")).toEqual(res("n1", { collapse: true }));
  });

  it("moves to the parent from a closed node or a leaf", () => {
    expect(nextFocus(VISIBLE, "n2", "ArrowLeft")).toEqual(res("n1"));
    expect(nextFocus(VISIBLE, "n3", "ArrowLeft")).toEqual(res("n1"));
  });

  it("does nothing at the top level, whether leaf or closed parent", () => {
    expect(nextFocus(VISIBLE, "n5", "ArrowLeft")).toEqual(res("n5"));
    expect(nextFocus(VISIBLE, "n7", "ArrowLeft")).toEqual(res("n7"));
  });

  it("finds the parent across an intervening subtree", () => {
    // Fed from visibleNodes rather than the literal fixture, so a depth
    // convention that drifted between the two functions shows up here.
    const deep = visibleNodes(TREE, new Set(["n1", "n2"]));
    expect(nextFocus(deep, "n4", "ArrowLeft")).toEqual(res("n2"));
    // n3 sits AFTER the n2/n4 subtree; its parent is still n1.
    expect(nextFocus(deep, "n3", "ArrowLeft")).toEqual(res("n1"));
  });
});

describe("nextFocus - activation", () => {
  it("activates on Enter and on Space", () => {
    // Space is APG's selection key. It must never reach type-ahead, which is
    // why the fixture contains a title beginning with a space.
    expect(nextFocus(VISIBLE, "n3", "Enter")).toEqual(res("n3", { activate: true }));
    expect(nextFocus(VISIBLE, "n3", " ")).toEqual(res("n3", { activate: true }));
  });
});

describe("nextFocus - type-ahead", () => {
  it("jumps to the next visible node whose TITLE starts with the character", () => {
    expect(nextFocus(VISIBLE, "n1", "b")).toEqual(res("n2"));
    expect(nextFocus(VISIBLE, "n1", "c")).toEqual(res("n3"));
    expect(nextFocus(VISIBLE, "n1", "z")).toEqual(res("n7"));
  });

  it("is case-insensitive", () => {
    expect(nextFocus(VISIBLE, "n1", "B")).toEqual(res("n2"));
  });

  it("searches forward from the current node, not from the top", () => {
    // Two titles begin with "b". From n2 the answer is the LATER one.
    expect(nextFocus(VISIBLE, "n2", "b")).toEqual(res("n9"));
  });

  it("wraps around the end of the list", () => {
    expect(nextFocus(VISIBLE, "n9", "a")).toEqual(res("n1"));
    expect(nextFocus(VISIBLE, "n9", "b")).toEqual(res("n2"));
  });

  it("matches a PREFIX, not a substring", () => {
    // "Boeing" and "Ceiling" both contain "e"; neither starts with it.
    expect(nextFocus(VISIBLE, "n1", "e")).toEqual(res("n1"));
    // Positive control: "c" does match, so this is about prefix semantics and
    // not about type-ahead being broken outright.
    expect(nextFocus(VISIBLE, "n1", "c")).toEqual(res("n3"));
  });

  it("stays put when nothing matches", () => {
    expect(nextFocus(VISIBLE, "n1", "q")).toEqual(res("n1"));
  });

  it("stays put when the only match is the node already focused", () => {
    expect(nextFocus(VISIBLE, "n7", "z")).toEqual(res("n7"));
  });

  it("leaves keys it does not own unhandled, so the page still sees them", () => {
    // handled:false is the whole point. A tree that consumes Tab is a keyboard
    // trap. The fixture has a title starting with "Shift" and one starting with
    // a space, so an implementation that fed these names into type-ahead as
    // whole-string prefixes would move focus here and fail.
    for (const key of ["Tab", "Escape", "Shift", "Control", "Alt", "Meta", "PageDown", "F2"]) {
      expect(nextFocus(VISIBLE, "n1", key)).toEqual({
        focusId: "n1",
        expand: false,
        collapse: false,
        activate: false,
        handled: false,
      });
    }
  });
});

describe("nextFocus - degenerate input", () => {
  it("recovers to the first visible node when focus is on a page that is gone", () => {
    // Collapse a parent while focus sits inside it, then press a key. Without
    // this the lookup returns -1 and arithmetic on it silently lands somewhere
    // arbitrary, or throws.
    expect(nextFocus(VISIBLE, "n4", "ArrowDown")).toEqual(res("n1"));
    expect(nextFocus(VISIBLE, null, "ArrowDown")).toEqual(res("n1"));
  });

  it("returns a null focus for an empty list instead of throwing", () => {
    expect(nextFocus([], "n1", "ArrowDown")).toEqual({
      focusId: null,
      expand: false,
      collapse: false,
      activate: false,
      handled: false,
    });
  });
});
