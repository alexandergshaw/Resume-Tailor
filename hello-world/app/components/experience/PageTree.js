"use client";

import { useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { visibleNodes, nextFocus } from "../../../lib/experience/treeNav";
import PageTreeItem from "./PageTreeItem";

// See PageTreeItem.js's identical constant/comment - a single shared empty
// Set rather than a fresh `new Set()` allocated on every render this prop
// is left at its default.
const EMPTY_SELECTION = new Set();

// Renders the W3C APG tree view pattern for the sidebar page tree:
// https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
//
// The keyboard DECISIONS - where focus goes, whether a key expands, collapses
// or activates a node, whether the tree owns the key at all - live in
// lib/experience/treeNav.js as pure functions with their own DOM-free test
// suite. This component's only job is the WIRING: read a key event, hand it
// to `nextFocus`, and carry out exactly what comes back - moving real DOM
// focus via `.focus()`, calling `onToggle`/`onSelect`, and calling
// `preventDefault` ONLY when `handled` is true. A tree that swallows Tab is a
// keyboard trap, which is why that flag exists at all.
//
// Prop contract fixed by PageTree.test.js:
//   <PageTree tree selectedId expandedIds onSelect onToggle />
// Everything below that is additive (inline rename, create, delete, drag to
// re-parent) and defaults to a no-op, so the fixed 5-prop contract keeps
// working on its own.
export default function PageTree({
  tree,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  renamingId = null,
  onRenameStart = () => {},
  onRenameCommit = () => {},
  onRenameCancel = () => {},
  onCreateChild = () => {},
  onDeleteRequest = () => {},
  onMoveRequest = () => {},
  onMove = () => {},
  selectedPageIds = EMPTY_SELECTION,
  onToggleSelect = () => {},
  onClearSelection = () => {},
}) {
  const rootRef = useRef(null);
  // `tree` (not the `nodes` fallback below) is the useMemo dependency: a
  // fresh `[]` literal on every render when `tree` is absent would otherwise
  // change identity every time and defeat the memo entirely.
  const visible = useMemo(() => visibleNodes(Array.isArray(tree) ? tree : [], expandedIds), [tree, expandedIds]);
  const nodes = Array.isArray(tree) ? tree : [];

  // Roving tabindex follows FOCUS, not selection - the W3C APG rule. Arrowing
  // through the tree moves real DOM focus via `nextFocus` (below) without
  // touching `selectedId` at all (that only changes on Enter/Space/click), so
  // `selectedId` alone cannot answer "which row is the tab stop right now".
  // `focusedId` starts at `null` - "nothing has been focused via the tree's
  // own keyboard handling yet" - and is set whenever `nextFocus` reports a
  // focus target. While it is null, `activeId` tracks `selectedId` live (so
  // mouse selection still moves the tab stop before any keyboard use), then
  // falls back to the first visible row if nothing is selected either.
  const [focusedId, setFocusedId] = useState(null);
  const activeId =
    focusedId && visible.some((n) => n.id === focusedId)
      ? focusedId
      : visible.some((n) => n.id === selectedId)
        ? selectedId
        : (visible[0]?.id ?? null);

  function focusItem(id) {
    const root = rootRef.current;
    if (!root || !id) return;
    const el = [...root.querySelectorAll('[role="treeitem"]')].find(
      (candidate) => candidate.getAttribute("data-page-id") === id,
    );
    el?.focus();
  }

  function handleKeyDown(event) {
    // Escape clears the bulk-selection checkbox set, and is checked BEFORE
    // the currentId gate below on purpose: unlike the four action buttons
    // (which the early return below also silently ignores keys from), the
    // checkbox is a real keyboard destination a user lands on to check a
    // box, and Escape has to work from there too, not only from the row
    // <li> itself. Escape is not a key nextFocus owns (isOwnedKey treats
    // any multi-character name other than the named arrow/Home/End/Enter/
    // Space keys as "not handled"), so this never calls preventDefault -
    // it only ever piggybacks the same keypress to also clear selection.
    if (event.key === "Escape") onClearSelection();

    // Events from inside an open rename <input> bubble here too, but that
    // input has no data-page-id, so this bails out and lets it handle its
    // own keys (Enter to commit, Escape to cancel) untouched.
    const currentId = event.target?.getAttribute?.("data-page-id");
    if (!currentId) return;

    const result = nextFocus(visible, currentId, event.key);
    if (result.handled) event.preventDefault();
    if (result.expand || result.collapse) onToggle(currentId);
    if (result.activate) onSelect(currentId);
    if (result.focusId) setFocusedId(result.focusId);
    if (result.focusId && result.focusId !== currentId) focusItem(result.focusId);
  }

  return (
    <Box
      ref={rootRef}
      role="tree"
      aria-label="Project pages"
      onKeyDown={handleKeyDown}
      sx={{ outline: "none" }}
    >
      {nodes.map((node) => (
        <PageTreeItem
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          activeId={activeId}
          expandedIds={expandedIds}
          onSelect={onSelect}
          onToggle={onToggle}
          renamingId={renamingId}
          onRenameStart={onRenameStart}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onCreateChild={onCreateChild}
          onDeleteRequest={onDeleteRequest}
          onMoveRequest={onMoveRequest}
          onMove={onMove}
          selectedPageIds={selectedPageIds}
          onToggleSelect={onToggleSelect}
        />
      ))}
      {nodes.length > 0 && (
        <Box
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const draggedId = event.dataTransfer.getData("text/plain");
            if (draggedId) onMove(draggedId, null);
          }}
          sx={{
            mt: 0.5,
            py: 0.75,
            border: "1px dashed transparent",
            borderRadius: 1,
            fontSize: 11.5,
            color: "var(--text-secondary)",
            textAlign: "center",
            "&:hover, &:focus-within": { border: "1px dashed var(--border)" },
          }}
        >
          Drop here to move to top level
        </Box>
      )}
    </Box>
  );
}
