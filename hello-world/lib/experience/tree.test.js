import { describe, it, expect } from "vitest";
import {
  buildTree,
  collectDescendantIds,
  canMove,
  moveNode,
  breadcrumb,
} from "./tree.js";

// The page tree for the "Professional Experience" tab. Written against the
// acceptance criteria BEFORE the implementation exists; this file is the
// contract chunks 2-5 code against.
//
// Every fixture row is frozen, and so is every fixture array, so an
// implementation that sorts in place or hangs `children` off an input row fails
// here rather than corrupting a caller's state far away. Freezing is a backstop,
// not the coverage: purity is also asserted directly against unfrozen rows,
// because rows arriving from Supabase are not frozen.
//
// A peer audit mutated a reference implementation 29 ways against the first
// draft of this file; 6 mutants survived. The assertions that kill those six are
// marked [S1]..[S6] so nobody weakens them back.

function row(id, parentId, position, extra = {}) {
  return Object.freeze({
    id,
    user_id: "u1",
    parent_id: parentId,
    title: extra.title ?? id.toUpperCase(),
    body: extra.body ?? "",
    position,
    archived_at: null,
    created_at: extra.created_at ?? "2026-08-01T00:00:00.000Z",
    updated_at: extra.updated_at ?? "2026-08-01T00:00:00.000Z",
  });
}

function rows(...list) {
  return Object.freeze(list);
}

const ids = (nodes) => nodes.map((n) => n.id);
const sortById = (list) => [...list].sort((a, b) => a.id.localeCompare(b.id));

// Every id in the tree, in traversal order, so "no page ever disappears" can be
// asserted as an invariant rather than case by case.
function idsInTree(tree) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      out.push(n.id);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

// Apply a moveNode update set so a test can assert on the resulting STATE, not
// only on the diff. A diff that looks plausible but leaves a gap in the sibling
// positions is exactly the defect these assertions exist to catch.
//
// Note the one thing this helper cannot see: an update that writes a row's
// existing values is indistinguishable from no update at all. Minimality is
// therefore asserted on the raw update set, never through here.
function applyUpdates(list, updates) {
  const byId = new Map(updates.map((u) => [u.id, u]));
  return list.map((r) => {
    const u = byId.get(r.id);
    return u ? { ...r, parent_id: u.parent_id, position: u.position } : { ...r };
  });
}

// Every sibling group as "id@position", ordered by position, so "gap-free
// 0..n-1 on both sides of the move" is one exact assertion.
function positionsByParent(list) {
  const out = {};
  for (const r of list) {
    const key = r.parent_id === null ? "root" : r.parent_id;
    if (!out[key]) out[key] = [];
    out[key].push(r);
  }
  for (const key of Object.keys(out)) {
    out[key] = out[key]
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((r) => `${r.id}@${r.position}`);
  }
  return out;
}

// alpha
//   a1
//     a1x        <- deep branch, deliberately NOT the last branch, so
//   a2              depth-first and breadth-first give different sequences
// beta
const NESTED = rows(
  row("a1x", "a1", 0),
  row("beta", null, 1),
  row("a2", "alpha", 1),
  row("alpha", null, 0, { body: "# Alpha\n\nProject notes." }),
  row("a1", "alpha", 0),
);

describe("buildTree", () => {
  it("nests children under their parent, ordered by position regardless of input order", () => {
    const tree = buildTree(NESTED);
    expect(ids(tree)).toEqual(["alpha", "beta"]);
    expect(ids(tree[0].children)).toEqual(["a1", "a2"]);
    expect(ids(tree[0].children[0].children)).toEqual(["a1x"]);
    expect(ids(tree[1].children)).toEqual([]);
  });

  it("[S1] gives each node the whole row, not just its id and children", () => {
    // Chunks 2 and 3 render title and body straight off these nodes. An
    // implementation returning {id, children} passed every other assertion here.
    const tree = buildTree(NESTED);
    const alphaRow = NESTED.find((r) => r.id === "alpha");
    const betaRow = NESTED.find((r) => r.id === "beta");
    expect(tree[0]).toEqual({ ...alphaRow, children: expect.any(Array) });
    expect(tree[1]).toEqual({ ...betaRow, children: [] });
  });

  it("[S2] breaks a tied position by created_at first, and only then by id", () => {
    // The ids sort OPPOSITE to the timestamps, so falling through to the id
    // comparison gives the wrong answer instead of accidentally the right one.
    const tied = rows(
      row("aaa", null, 0, { created_at: "2026-08-02T00:00:00.000Z" }),
      row("zzz", null, 0, { created_at: "2026-08-01T00:00:00.000Z" }),
    );
    expect(ids(buildTree(tied))).toEqual(["zzz", "aaa"]);

    const fullyTied = rows(row("b", null, 0), row("a", null, 0));
    expect(ids(buildTree(fullyTied))).toEqual(["a", "b"]);
  });

  it("still orders deterministically when a row has no created_at yet", () => {
    // Chunk 2 creates a page optimistically on the client, before the insert
    // comes back, so created_at can be missing. Date.parse of a missing value is
    // NaN; NaN !== NaN is true, so a comparator that subtracts them returns NaN,
    // which the sort spec coerces to 0 - silently skipping the id tiebreaker and
    // leaving the order at the mercy of whatever order the rows arrived in.
    // Input order here is the reverse of the expected output, so that failure is
    // visible rather than accidentally correct.
    const optimistic = rows(
      Object.freeze({ ...row("zzz", null, 0), created_at: undefined }),
      Object.freeze({ ...row("aaa", null, 0), created_at: undefined }),
    );
    expect(ids(buildTree(optimistic))).toEqual(["aaa", "zzz"]);
  });

  it("surfaces a page whose parent is absent as a root instead of dropping it", () => {
    // Positive control: with the parent present the child is NOT a root, so this
    // pair cannot both pass by treating every row as a root.
    const withParent = rows(row("p", null, 0), row("kid", "p", 0));
    expect(ids(buildTree(withParent))).toEqual(["p"]);
    expect(ids(buildTree(withParent)[0].children)).toEqual(["kid"]);

    const orphaned = rows(row("kid", "p", 0));
    expect(ids(buildTree(orphaned))).toEqual(["kid"]);
  });

  it("[S6] never loses a page, whatever the parent links say", () => {
    const broken = rows(
      row("orphan", "ghost", 0), // parent not in the set
      row("selfie", "selfie", 1), // its own parent
      row("cycA", "cycB", 2), // two-page loop
      row("cycB", "cycA", 3),
      row("ok", null, 4),
    );
    const found = idsInTree(buildTree(broken));
    expect([...found].sort()).toEqual(["cycA", "cycB", "ok", "orphan", "selfie"]);
    expect(found).toHaveLength(5); // each exactly once, none duplicated into two branches
  });

  it("does not mutate the rows it was given", () => {
    const tree = buildTree(NESTED);
    expect(ids(tree[0].children)).toEqual(["a1", "a2"]); // positive control
    for (const r of NESTED) {
      expect(Object.prototype.hasOwnProperty.call(r, "children")).toBe(false);
    }
  });
});

describe("collectDescendantIds", () => {
  it("[S3] returns every descendant depth-first, excluding the page itself", () => {
    // Depth-first is ["a1","a1x","a2"]; breadth-first would be ["a1","a2","a1x"].
    expect(collectDescendantIds(NESTED, "alpha")).toEqual(["a1", "a1x", "a2"]);
    expect(collectDescendantIds(NESTED, "a1")).toEqual(["a1x"]);
  });

  it("returns nothing for a leaf or an unknown id", () => {
    expect(collectDescendantIds(NESTED, "a1x")).toEqual([]);
    expect(collectDescendantIds(NESTED, "nope")).toEqual([]);
  });

  it("terminates on a cyclic parent chain in the data", () => {
    // Asserts the guarantees the AC actually makes - it returns, nothing
    // repeats, the page itself is excluded - plus a positive control that
    // traversal happened at all. Pinning one exact output here would fail a
    // conforming implementation that seeds its visited set differently.
    const cyclic = rows(row("a", "b", 0), row("b", "a", 0));
    const result = collectDescendantIds(cyclic, "a");
    expect(result).toContain("b");
    expect(result).not.toContain("a");
    expect(new Set(result).size).toBe(result.length);
  });
});

describe("canMove", () => {
  it("accepts a move to another parent and to the top level", () => {
    expect(canMove(NESTED, { id: "a1", newParentId: "beta" })).toStrictEqual({ ok: true });
    expect(canMove(NESTED, { id: "a1", newParentId: null })).toStrictEqual({ ok: true });
    // A JSON body omits keys rather than sending null, so undefined must mean
    // the same thing at this layer.
    expect(canMove(NESTED, { id: "a1" })).toStrictEqual({ ok: true });
  });

  it("rejects each invalid move with its own reason code", () => {
    expect(canMove(NESTED, { id: "nope", newParentId: null })).toStrictEqual({
      ok: false,
      reason: "unknown-page",
    });
    expect(canMove(NESTED, { id: "a1", newParentId: "nope" })).toStrictEqual({
      ok: false,
      reason: "unknown-parent",
    });
    expect(canMove(NESTED, { id: "a1", newParentId: "a1" })).toStrictEqual({
      ok: false,
      reason: "self-parent",
    });
    // alpha -> a1x would put alpha inside its own grandchild.
    expect(canMove(NESTED, { id: "alpha", newParentId: "a1x" })).toStrictEqual({
      ok: false,
      reason: "cycle",
    });
  });

  it("[S5] applies the reason codes in precedence order when several apply", () => {
    // The route puts this code in front of the user in a 400, so which one wins
    // is observable behavior, not an implementation detail.
    expect(canMove(NESTED, { id: "nope", newParentId: "alsoNope" })).toStrictEqual({
      ok: false,
      reason: "unknown-page",
    });
    expect(canMove(NESTED, { id: "nope", newParentId: "nope" })).toStrictEqual({
      ok: false,
      reason: "unknown-page",
    });
  });
});

describe("moveNode", () => {
  const FLAT = rows(row("alpha", null, 0), row("beta", null, 1), row("gamma", null, 2));

  it("renumbers the siblings it displaces when reordering", () => {
    const updates = moveNode(FLAT, { id: "gamma", newParentId: null, newIndex: 0 });
    expect(sortById(updates)).toEqual([
      { id: "alpha", parent_id: null, position: 1 },
      { id: "beta", parent_id: null, position: 2 },
      { id: "gamma", parent_id: null, position: 0 },
    ]);
  });

  it("emits only the rows that actually changed, on the side it left", () => {
    const pair = rows(row("alpha", null, 0), row("beta", null, 1));
    // beta leaves the root list from the end and lands as alpha's only child, so
    // alpha's own position never changes and must not be written back.
    expect(moveNode(pair, { id: "beta", newParentId: "alpha", newIndex: 0 })).toEqual([
      { id: "beta", parent_id: "alpha", position: 0 },
    ]);
  });

  it("[S4] emits only the rows that actually changed, on the side it joined", () => {
    const source = rows(
      row("p", null, 0),
      row("q", null, 1),
      row("x", "p", 0),
      row("y", "p", 1),
    );
    // q appends after p's existing children, so x and y keep both their parent
    // and their position. Rewriting them is an N-row write per drag instead of
    // one, and applying the update set makes the two outcomes identical - so
    // this has to be asserted on the raw set.
    expect(moveNode(source, { id: "q", newParentId: "p", newIndex: 2 })).toEqual([
      { id: "q", parent_id: "p", position: 2 },
    ]);
  });

  it("leaves both the vacated and the destination sibling lists gap-free", () => {
    const source = rows(
      row("p", null, 0),
      row("q", null, 1),
      row("x", "p", 0),
      row("y", "p", 1),
      row("z", "p", 2),
    );
    const updates = moveNode(source, { id: "y", newParentId: null, newIndex: 0 });
    expect(positionsByParent(applyUpdates(source, updates))).toEqual({
      root: ["y@0", "p@1", "q@2"],
      p: ["x@0", "z@1"],
    });
  });

  it("clamps an out-of-range index to the ends of the sibling list", () => {
    const high = applyUpdates(FLAT, moveNode(FLAT, { id: "alpha", newParentId: null, newIndex: 999 }));
    expect(positionsByParent(high)).toEqual({ root: ["beta@0", "gamma@1", "alpha@2"] });

    const low = applyUpdates(FLAT, moveNode(FLAT, { id: "gamma", newParentId: null, newIndex: -5 }));
    expect(positionsByParent(low)).toEqual({ root: ["gamma@0", "alpha@1", "beta@2"] });
  });

  it("appends when the index is missing or not a number", () => {
    // NaN < 0 and NaN > len are both false, so a naive implementation silently
    // inserts at 0 here - the opposite end from the specified behavior.
    for (const newIndex of [undefined, null, Number.NaN]) {
      const applied = applyUpdates(FLAT, moveNode(FLAT, { id: "alpha", newParentId: null, newIndex }));
      expect(positionsByParent(applied)).toEqual({ root: ["beta@0", "gamma@1", "alpha@2"] });
    }
  });

  it("returns no updates for a move that changes nothing", () => {
    expect(moveNode(FLAT, { id: "beta", newParentId: null, newIndex: 1 })).toEqual([]);
  });

  it("treats a missing newParentId as a move to the top level", () => {
    const pair = rows(row("p", null, 0), row("kid", "p", 0));
    const applied = applyUpdates(pair, moveNode(pair, { id: "kid", newIndex: 0 }));
    expect(positionsByParent(applied)).toEqual({ root: ["kid@0", "p@1"] });
  });

  it("[G5] renumbers the root list when an orphan leaves it", () => {
    // buildTree shows an orphan as a root, so this is the list it vacates.
    // Positions are chosen so the two candidate readings differ: leaving the
    // root list alone gives real@1/target@2 with a hole at 0.
    const source = rows(row("ghosted", "missing", 0), row("real", null, 1), row("target", null, 2));
    const updates = moveNode(source, { id: "ghosted", newParentId: "target", newIndex: 0 });
    expect(positionsByParent(applyUpdates(source, updates))).toEqual({
      root: ["real@0", "target@1"],
      target: ["ghosted@0"],
    });
  });

  it("throws with the reason code instead of returning a partial update set", () => {
    expect(() => moveNode(NESTED, { id: "alpha", newParentId: "a1x", newIndex: 0 })).toThrow(/cycle/);
    expect(() => moveNode(NESTED, { id: "a1", newParentId: "a1", newIndex: 0 })).toThrow(/self-parent/);
    expect(() => moveNode(NESTED, { id: "nope", newParentId: null, newIndex: 0 })).toThrow(/unknown-page/);
    expect(() => moveNode(NESTED, { id: "a1", newParentId: "nope", newIndex: 0 })).toThrow(/unknown-parent/);
  });

  it("leaves unfrozen rows untouched, the way they arrive from the database", () => {
    const live = FLAT.map((r) => ({ ...r }));
    const snapshot = JSON.parse(JSON.stringify(live));
    moveNode(live, { id: "gamma", newParentId: null, newIndex: 0 });
    buildTree(live);
    collectDescendantIds(live, "alpha");
    breadcrumb(live, "alpha");
    expect(live).toEqual(snapshot);
  });
});

describe("breadcrumb", () => {
  it("returns the path from the root down to the page, inclusive", () => {
    expect(breadcrumb(NESTED, "a1x")).toEqual([
      { id: "alpha", title: "ALPHA" },
      { id: "a1", title: "A1" },
      { id: "a1x", title: "A1X" },
    ]);
    expect(breadcrumb(NESTED, "alpha")).toEqual([{ id: "alpha", title: "ALPHA" }]);
  });

  it("returns nothing for an unknown id", () => {
    expect(breadcrumb(NESTED, "nope")).toEqual([]);
  });

  it("terminates on a cyclic parent chain in the data", () => {
    const cyclic = rows(row("a", "b", 0), row("b", "a", 0));
    const path = breadcrumb(cyclic, "a");
    const pathIds = path.map((e) => e.id);
    expect(pathIds[pathIds.length - 1]).toBe("a");
    expect(new Set(pathIds).size).toBe(pathIds.length);
  });
});
