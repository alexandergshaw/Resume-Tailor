// Pure tree logic for the "Professional Experience" knowledge base — no I/O,
// no Supabase, no wall-clock reads. Every function here treats its inputs as
// read-only: rows arrive from Supabase unfrozen, so purity is never allowed
// to lean on Object.freeze in a caller's fixtures.
//
// A row's place in the tree is decided by whether its parent link actually
// resolves: `parent_id === null` is a genuine top-level row, but a row whose
// parent is missing from the given set, is itself, or sits in a parent-chain
// loop is ALSO treated as a root rather than dropped — see `isRoot` below.
// That promotion is what buildTree, collectDescendantIds's sibling grouping,
// and moveNode's "which list does this row currently occupy" question all
// share, so it lives in one place.

// Siblings sort by position, then created_at, then id — in that order, with
// every earlier key checked before falling through to the next.
function compareSiblings(a, b) {
  if (a.position !== b.position) return a.position - b.position;
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// True when `row`'s parent link cannot be trusted: absent, pointing at
// itself, or part of a cycle that loops back to `row`. A cycle further up
// the chain that never returns to `row` itself does not promote `row` — only
// the rows actually inside that cycle get promoted, each independently.
function isRoot(byId, row) {
  if (row.parent_id === null || row.parent_id === undefined) return true;
  if (!byId.has(row.parent_id)) return true;
  let cur = row.parent_id;
  const guard = new Set();
  while (cur !== null && cur !== undefined) {
    if (cur === row.id) return true;
    if (!byId.has(cur)) return false;
    if (guard.has(cur)) return false;
    guard.add(cur);
    cur = byId.get(cur).parent_id;
  }
  return false;
}

function toMap(rows) {
  const byId = new Map();
  for (const r of rows) byId.set(r.id, r);
  return byId;
}

export function buildTree(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = toMap(list);

  const childrenOf = new Map();
  const roots = [];
  for (const r of list) {
    if (isRoot(byId, r)) {
      roots.push(r);
      continue;
    }
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id).push(r);
  }
  for (const arr of childrenOf.values()) arr.sort(compareSiblings);
  roots.sort(compareSiblings);

  function buildNode(row) {
    const kids = childrenOf.get(row.id) || [];
    return { ...row, children: kids.map(buildNode) };
  }

  return roots.map(buildNode);
}

export function collectDescendantIds(rows, id) {
  const list = Array.isArray(rows) ? rows : [];
  const byParent = new Map();
  for (const r of list) {
    const key = r.parent_id === undefined ? null : r.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(r);
  }
  for (const arr of byParent.values()) arr.sort(compareSiblings);

  const result = [];
  const visited = new Set([id]);
  const walk = (parentId) => {
    const kids = byParent.get(parentId) || [];
    for (const kid of kids) {
      if (visited.has(kid.id)) continue;
      visited.add(kid.id);
      result.push(kid.id);
      walk(kid.id);
    }
  };
  walk(id);
  return result;
}

export function canMove(rows, { id, newParentId } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = toMap(list);

  if (!byId.has(id)) return { ok: false, reason: "unknown-page" };
  if (newParentId === id) return { ok: false, reason: "self-parent" };
  if (newParentId !== null && newParentId !== undefined) {
    if (!byId.has(newParentId)) return { ok: false, reason: "unknown-parent" };
    if (collectDescendantIds(list, id).includes(newParentId)) {
      return { ok: false, reason: "cycle" };
    }
  }
  return { ok: true };
}

export function moveNode(rows, { id, newParentId, newIndex } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const check = canMove(list, { id, newParentId });
  if (!check.ok) {
    throw new Error(`Cannot move page: ${check.reason}`);
  }

  const byId = toMap(list);
  const movingRow = byId.get(id);
  const destKey = newParentId === undefined ? null : newParentId;
  const keyFor = (row) => (isRoot(byId, row) ? null : row.parent_id);

  const groups = new Map();
  for (const r of list) {
    const key = keyFor(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const arr of groups.values()) arr.sort(compareSiblings);

  const sourceKey = keyFor(movingRow);
  const sourceList = (groups.get(sourceKey) || []).filter((r) => r.id !== id);
  const destListRaw =
    sourceKey === destKey ? sourceList : (groups.get(destKey) || []).filter((r) => r.id !== id);

  const clamped = Number.isFinite(newIndex)
    ? Math.max(0, Math.min(destListRaw.length, newIndex))
    : destListRaw.length;

  const destList = destListRaw.slice();
  destList.splice(clamped, 0, movingRow);

  const updates = [];
  destList.forEach((r, index) => {
    if (r.id === id) {
      if (r.parent_id !== destKey || r.position !== index) {
        updates.push({ id: r.id, parent_id: destKey, position: index });
      }
      return;
    }
    if (r.position !== index) {
      updates.push({ id: r.id, parent_id: r.parent_id, position: index });
    }
  });

  if (sourceKey !== destKey) {
    sourceList.forEach((r, index) => {
      if (r.position !== index) {
        updates.push({ id: r.id, parent_id: r.parent_id, position: index });
      }
    });
  }

  return updates;
}

export function breadcrumb(rows, id) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = toMap(list);
  if (!byId.has(id)) return [];

  const path = [];
  const visited = new Set();
  let cur = id;
  while (cur !== null && cur !== undefined && byId.has(cur) && !visited.has(cur)) {
    visited.add(cur);
    const row = byId.get(cur);
    path.push({ id: row.id, title: row.title });
    cur = row.parent_id;
  }
  path.reverse();
  return path;
}
