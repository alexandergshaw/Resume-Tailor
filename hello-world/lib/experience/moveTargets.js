// Legal re-parent destinations for a page, as a flat list a dialog can
// render directly - the keyboard/screen-reader route to the same move that
// drag-and-drop reaches by pointer. Pure: no React, no DOM, no I/O.
//
// The legality rules mirror lib/experience/tree.js's canMove (a page cannot
// move into itself, its own descendants, or a no-op back into its current
// parent) - asserted once here rather than re-derived inside a dialog.

import { collectDescendantIds, breadcrumb, buildTree } from "./tree.js";

export function moveTargets(rows, id) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map(list.map((r) => [r.id, r]));
  if (!byId.has(id)) return [];

  const current = byId.get(id);
  const parentId = current.parent_id === undefined ? null : current.parent_id;

  // Illegal destinations: the page itself, everything under it (both would
  // be rejected by canMove as `cycle`/`self-parent`), and its current
  // parent (a legal move, but a no-op not worth offering).
  const excluded = new Set([id, ...collectDescendantIds(list, id)]);
  if (parentId !== null) excluded.add(parentId);

  const targets = [];
  // A page already at the top level is not offered the top level again -
  // that would be the same no-op the current-parent exclusion exists for.
  if (parentId !== null) {
    targets.push({ id: null, label: "Top level", depth: 0 });
  }

  // Walk every node in pre-order regardless of whether IT was excluded -
  // exclusion only skips adding that one node to the results. A sibling of
  // the moved page nested under its (excluded) parent is still a fully
  // legal destination, so the walk must not stop at an excluded node.
  function walk(nodes, depth) {
    for (const node of nodes) {
      if (!excluded.has(node.id)) {
        const path = breadcrumb(list, node.id);
        targets.push({ id: node.id, label: path.map((p) => p.title).join(" / "), depth });
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  }
  walk(buildTree(list), 0);

  return targets;
}
