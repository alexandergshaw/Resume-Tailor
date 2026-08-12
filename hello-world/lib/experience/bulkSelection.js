// Checkbox selection across the Professional Experience page tree, and what
// a bulk action is allowed to do with it. Pure, no React, no DOM, no I/O -
// same discipline as lib/experience/tree.js and moveTargets.js, which this
// file reuses rather than re-walking the tree itself.
//
// The counting rule is the dangerous one: a bulk delete cascades through
// every selected page's whole subtree, so the number a caller shows in a
// confirmation is the only thing standing between a mis-click and lost
// work. A selected parent and its selected child must be counted ONCE, not
// twice - see selectionSummary below.

import { collectDescendantIds } from "./tree.js";
import { moveTargets } from "./moveTargets.js";

// Adds or removes `id` from `selectedIds`, returning a NEW Set and never
// mutating the one it was given - callers (React state setters) rely on
// that for correct re-renders. Deliberately ignorant of the tree: selecting
// a page never implicitly selects its children, so this never needs `rows`
// at all.
export function toggleSelected(selectedIds, id) {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// The three numbers a bulk delete confirmation needs:
//   selected    - pages the user actually ticked (ids present in `rows`;
//                 a stale id left over from a page deleted elsewhere is
//                 dropped rather than inflating the count)
//   descendants - EXTRA pages the cascade would take with them, counted
//                 once even when a descendant is ALSO its own ancestor's
//                 selection overlap (ticking both a parent and its child)
//   total       - the deduplicated blast radius: selected + descendants
export function selectionSummary(rows, selectedIds) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const ids = [...(selectedIds || [])].filter((id) => byId.has(id));

  const total = new Set(ids);
  for (const id of ids) {
    for (const descendantId of collectDescendantIds(list, id)) total.add(descendantId);
  }

  return {
    selected: ids.length,
    descendants: total.size - ids.length,
    total: total.size,
  };
}

// Legal re-parent destinations for the WHOLE selection at once: the
// intersection of what lib/experience/moveTargets.js's moveTargets() would
// offer each selected page individually. A destination that only one of
// the selected pages cannot use (its own subtree, its own current parent)
// is dropped for the whole group, not kept because it worked for whichever
// page happened to be checked first - so this can legitimately return an
// empty list when no single destination suits every selected page, which
// callers must treat as "disable Move, with an explanation", not an error.
//
// A target's label/depth come from whichever selected page's own list
// happens to supply the base to intersect against; both are independent of
// which page is being moved (moveTargets derives them from the tree alone),
// so that choice never changes what a given target id is labelled.
export function bulkMoveTargets(rows, selectedIds) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const ids = [...(selectedIds || [])].filter((id) => byId.has(id));
  if (ids.length === 0) return [];

  const [firstId, ...restIds] = ids;
  const first = moveTargets(list, firstId);
  const restIdSets = restIds.map((id) => new Set(moveTargets(list, id).map((t) => t.id)));

  return first.filter((target) => restIdSets.every((set) => set.has(target.id)));
}
