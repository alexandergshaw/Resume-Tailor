// Pure keyboard model for the sidebar page tree - no React, no DOM, no I/O.
// The W3C APG tree view pattern: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
//
// This file only ever answers two questions, and both are read-only: "what
// can the user currently see?" (visibleNodes) and "given a key press from
// some node, what should happen?" (nextFocus). app/components/experience/
// PageTree.js is the only thing that turns those answers into DOM focus
// calls, onSelect/onToggle calls, and preventDefault - the split exists so
// the keyboard DECISIONS can be asserted without a DOM at all, and so the
// wiring between decision and effect has its own dedicated (jsdom) test.
//
// See treeNav.test.js for the full contract, including the 14-mutant audit
// history that shaped the `nextFocus` signature below.

// Flattens `tree` into the rows a user actually sees, in document order, with
// the children of any collapsed node omitted entirely. `expandedIds` is a
// Set of ids the caller considers "open" - but a leaf (no children) is never
// reported as expanded even if its id lingers in that set (e.g. a deleted
// page's id, or an id reused after a delete+recreate), because a leaf
// carrying `expanded: true` tells the renderer to draw a disclosure twisty on
// a node that can never open.
export function visibleNodes(tree, expandedIds) {
  const roots = Array.isArray(tree) ? tree : [];
  const expanded = expandedIds instanceof Set ? expandedIds : new Set(expandedIds || []);
  const result = [];

  function walk(nodes, depth) {
    for (const node of nodes) {
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const isExpanded = hasChildren && expanded.has(node.id);
      result.push({ id: node.id, title: node.title, depth, hasChildren, expanded: isExpanded });
      if (isExpanded) walk(node.children, depth + 1);
    }
  }

  walk(roots, 0);
  return result;
}

// Single-key names the tree owns outright (Enter/Space activate; the rest
// move focus or toggle a node). Anything else either falls through to
// type-ahead (a lone printable character) or is reported as NOT handled.
const NAMED_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Enter", " "]);

// True when the tree owns this key at all - i.e. when `nextFocus` should
// report `handled: true` for it (even if that key turns out to be a no-op for
// the current node/position). Everything else - Tab, Escape, modifier keys,
// function keys - is passed straight through, because a tree that consumes
// Tab is a keyboard trap.
function isOwnedKey(key) {
  if (typeof key !== "string") return false;
  if (NAMED_KEYS.has(key)) return true;
  // A single printable character is a type-ahead candidate. Multi-character
  // key names (`"Tab"`, `"Shift"`, `"F2"`, ...) never reach here.
  return key.length === 1;
}

function baseResult(focusId, extra = {}) {
  return { focusId, expand: false, collapse: false, activate: false, handled: false, ...extra };
}

// Decides what a key press from `currentId` should do against the flattened
// `visible` list (as produced by `visibleNodes`). Always returns all five
// fields - `focusId`, `expand`, `collapse`, `activate`, `handled` - so a
// caller can never mistake "ignored" for "consumed to no effect": the two
// look identical on `focusId` alone, which is exactly what let a mutant make
// ArrowDown quietly expand every collapsed node it passed through the first
// draft of this contract.
export function nextFocus(visible, currentId, key) {
  const list = Array.isArray(visible) ? visible : [];

  if (list.length === 0) {
    return baseResult(null);
  }

  const owned = isOwnedKey(key);
  if (!owned) {
    return baseResult(currentId ?? null);
  }

  const idx = list.findIndex((n) => n.id === currentId);
  if (idx === -1) {
    // Focus was on a node that is no longer visible - its ancestor just
    // collapsed, or currentId was never set. Recover to the first visible
    // node rather than doing arithmetic on -1 (which lands somewhere
    // arbitrary) or throwing. The key's own effect is NOT also applied on
    // top of the recovery.
    return baseResult(list[0].id, { handled: true });
  }

  const node = list[idx];

  switch (key) {
    case "ArrowDown": {
      const next = idx < list.length - 1 ? list[idx + 1].id : node.id;
      return baseResult(next, { handled: true });
    }
    case "ArrowUp": {
      const prev = idx > 0 ? list[idx - 1].id : node.id;
      return baseResult(prev, { handled: true });
    }
    case "Home":
      return baseResult(list[0].id, { handled: true });
    case "End":
      return baseResult(list[list.length - 1].id, { handled: true });
    case "ArrowRight": {
      if (!node.hasChildren) return baseResult(node.id, { handled: true });
      if (!node.expanded) return baseResult(node.id, { expand: true, handled: true });
      // Already open: the flattened list places a parent's first child
      // immediately after it, by construction of visibleNodes.
      const child = list[idx + 1];
      return baseResult(child ? child.id : node.id, { handled: true });
    }
    case "ArrowLeft": {
      if (node.hasChildren && node.expanded) {
        return baseResult(node.id, { collapse: true, handled: true });
      }
      if (node.depth === 0) return baseResult(node.id, { handled: true });
      // The parent is the nearest PRECEDING node one depth shallower - true
      // of any pre-order flattening, regardless of what subtrees sit between
      // this node and its parent in the list.
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (list[i].depth === node.depth - 1) {
          return baseResult(list[i].id, { handled: true });
        }
      }
      return baseResult(node.id, { handled: true });
    }
    case "Enter":
    case " ":
      // Space is APG's selection key and must never fall through to
      // type-ahead below.
      return baseResult(node.id, { activate: true, handled: true });
    default: {
      // A single printable character: type-ahead. Search forward from the
      // node AFTER the current one, wrapping around, matching a PREFIX
      // (case-insensitive) of the node's title - never a substring, and
      // never the id. Stepping exactly `list.length` times covers every
      // other node once and then lands back on the current node itself,
      // which is how "the only match is the node already focused" resolves
      // to "stay put" without special-casing it.
      const needle = key.toLowerCase();
      for (let step = 1; step <= list.length; step += 1) {
        const candidate = list[(idx + step) % list.length];
        if (candidate.title.toLowerCase().startsWith(needle)) {
          return baseResult(candidate.id, { handled: true });
        }
      }
      return baseResult(node.id, { handled: true });
    }
  }
}
