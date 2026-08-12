"use client";

import { useRef, useState } from "react";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteIcon from "@mui/icons-material/Delete";
import DriveFileMoveOutlinedIcon from "@mui/icons-material/DriveFileMoveOutlined";
import EditIcon from "@mui/icons-material/Edit";

// A stable empty-Set default for `selectedPageIds` - a literal `new Set()`
// as a default parameter value would still be a NEW object every render,
// which is harmless here (this component doesn't memoize on it) but there
// is no reason to allocate one per row per render when a single shared
// instance reads identically.
const EMPTY_SELECTION = new Set();

// One row of the sidebar page tree, and (recursively) its expanded children.
// This is where the APG roles/attributes actually land on DOM nodes -
// role="treeitem"/"group", aria-expanded only on parents, aria-selected on
// every row, and roving tabindex (exactly one row is a tab stop: `activeId`,
// computed once by PageTree.js). Which key does what is decided in
// lib/experience/treeNav.js and dispatched by PageTree.js's onKeyDown; this
// file never calls nextFocus itself.
//
// `selectedPageIds` is the BULK-SELECTION checkbox set - deliberately named
// apart from `selectedId`/`isSelected` below, which is aria-selected: "this
// is the page currently being viewed" (one row at most, and mouse/keyboard
// driven). The two are unrelated ideas that happen to both live on a
// treeitem: a page can be the one open in the editor AND unchecked, or
// checked AND not the one open in the editor.
export default function PageTreeItem({
  node,
  depth,
  selectedId,
  activeId,
  expandedIds,
  onSelect,
  onToggle,
  renamingId,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onCreateChild,
  onDeleteRequest,
  onMoveRequest,
  onMove,
  selectedPageIds = EMPTY_SELECTION,
  onToggleSelect = () => {},
}) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isExpanded = hasChildren && expandedIds.has(node.id);
  const isSelected = node.id === selectedId;
  const isRenaming = renamingId === node.id;

  // Uncontrolled on purpose: the input's initial value is read once, at the
  // moment it mounts (rename starts) via `defaultValue`, and its live value
  // is read back from the DOM node on commit. That avoids threading every
  // keystroke back through parent state just to redraw the same input, and
  // means cancelling never has to "revert" anything - the tree's own
  // `node.title` was never touched while typing.
  const inputElRef = useRef(null);
  const skipBlurCommitRef = useRef(false);
  const rowRef = useRef(null);
  const [draggingOver, setDraggingOver] = useState(false);

  function commitFromInput() {
    onRenameCommit(node.id, inputElRef.current ? inputElRef.current.value : node.title);
  }

  return (
    <Box component="li" role="treeitem"
      ref={rowRef}
      data-page-id={node.id}
      aria-label={node.title}
      aria-selected={isSelected ? "true" : "false"}
      {...(hasChildren ? { "aria-expanded": isExpanded ? "true" : "false" } : {})}
      tabIndex={node.id === activeId ? 0 : -1}
      draggable={!isRenaming}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.id);
      }}
      onDragOver={(event) => {
        if (isRenaming) return;
        event.preventDefault();
        event.stopPropagation();
        setDraggingOver(true);
      }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDraggingOver(false);
        const draggedId = event.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== node.id) onMove(draggedId, node.id);
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (!isRenaming) onSelect(node.id);
      }}
      sx={{
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        outline: "none",
        "&:focus-visible": { outline: "2px solid var(--accent)", outlineOffset: -2, borderRadius: 1 },
        "&:hover .page-tree-item-actions": { opacity: 1, pointerEvents: "auto" },
        // Reveals the actions row (including Move, the one action that is
        // ALSO in the tab order for this row - see the tabIndex below) when
        // the row or anything inside it has focus, not just on mouse hover.
        // Without this, a keyboard user tabs onto an invisible button.
        "&:focus-within .page-tree-item-actions": { opacity: 1, pointerEvents: "auto" },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          pl: depth * 1.5 + 0.5,
          pr: 0.5,
          py: 0.5,
          borderRadius: 1,
          cursor: isRenaming ? "text" : "pointer",
          backgroundColor: draggingOver || isSelected ? "var(--bg-soft)" : "transparent",
          border: draggingOver ? "1px dashed var(--accent)" : "1px solid transparent",
        }}
      >
        <Box
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            onToggle(node.id);
          }}
          sx={{
            width: 18,
            height: 18,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            visibility: hasChildren ? "visible" : "hidden",
          }}
        >
          <ChevronRightIcon
            sx={{
              fontSize: 16,
              transform: isExpanded ? "rotate(90deg)" : "none",
              transition: "transform 120ms",
            }}
          />
        </Box>

        {/* Bulk-selection checkbox. Wrapped in its own Box so a click (or
            the synthetic click a Space keypress fires on a native checkbox)
            never bubbles up to the row's own onClick, which would also
            select this page as the one being VIEWED - the exact conflation
            the "selection is independent of aria-selected" rule forbids.
            tabIndex mirrors the four action buttons below (and nothing
            else): 0 only for the row currently holding the tree's roving
            tabindex, -1 for every other row. A hardcoded 0 here would add a
            tab stop per row - a 40-page tree becoming 40 extra stops is
            exactly what that rule exists to prevent; a hardcoded -1 would
            make the checkbox mouse-only, the same class of bug the four
            action buttons' own comment documents. */}
        <Box onClick={(event) => event.stopPropagation()} sx={{ display: "flex", flexShrink: 0 }}>
          <Checkbox
            size="small"
            checked={selectedPageIds.has(node.id)}
            tabIndex={node.id === activeId ? 0 : -1}
            onChange={() => onToggleSelect(node.id)}
            slotProps={{ input: { "aria-label": `Select ${node.title}` } }}
            sx={{ p: 0.5 }}
          />
        </Box>

        {isRenaming ? (
          <InputBase
            inputRef={(el) => {
              inputElRef.current = el;
              if (el) {
                el.focus();
                el.select();
              }
            }}
            defaultValue={node.title}
            inputProps={{ "aria-label": "Page title" }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                // Committing unmounts this input on the NEXT render (once
                // the parent clears `renamingId`), but that is asynchronous
                // and this element still has focus right now - so without
                // the explicit focus() below, focus would fall back to
                // document.body once the unmount actually happens. Skip the
                // blur-triggered commit below: moving focus off the input
                // ourselves would otherwise fire it a second time.
                skipBlurCommitRef.current = true;
                commitFromInput();
                rowRef.current?.focus();
              } else if (event.key === "Escape") {
                event.preventDefault();
                // APG requires Escape on an inline edit to return focus to
                // the treeitem it was opened from - cancelling must not be
                // punished harder than committing.
                skipBlurCommitRef.current = true;
                onRenameCancel();
                rowRef.current?.focus();
              }
            }}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }
              commitFromInput();
            }}
            sx={{ fontSize: 13.5, flex: 1, minWidth: 0, "& input": { py: 0 } }}
          />
        ) : (
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              minWidth: 0,
              fontSize: 13.5,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {node.title}
          </Typography>
        )}

        {!isRenaming && (
          <Box
            className="page-tree-item-actions"
            sx={{ opacity: 0, pointerEvents: "none", display: "flex", flexShrink: 0 }}
          >
            {/* Hidden with opacity, not `visibility: hidden` - the latter
                removes the buttons from the accessibility tree entirely, so a
                screen-reader user browsing with a virtual cursor (rather than
                tabbing) would never discover them on any row, including the
                selected one. Opacity hides the same way visually without
                that side effect; `pointer-events: none` at rest stops a
                sighted mouse user from clicking a button they cannot see
                (harmless in practice since hovering a button also hovers its
                ancestor row, which is what reveals it - but kept for parity
                with the old `visibility` behaviour's un-clickability). All
                four row actions share Move's treatment: tabIndex tracks
                the tree's own roving tabindex (`activeId`), not a hardcoded
                -1. Only the row currently holding the roving tabindex exposes
                its actions to Tab; every other row exposes none. Four tab
                stops appearing/disappearing together as focus moves through
                the tree is the intended shape of this pattern - it is what
                the `:focus-within` reveal above exists for - and is not the
                same failure as making every row's buttons tabbable at once
                (which would turn a forty-page tree into a hundred and sixty
                tab stops). A hardcoded -1 here is exactly the earlier bug:
                reachable by mouse only. */}
            <Tooltip title={`Add sub-page to ${node.title}`}>
              <IconButton
                size="small"
                tabIndex={node.id === activeId ? 0 : -1}
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateChild(node.id);
                }}
              >
                <AddIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={`Rename ${node.title}`}>
              <IconButton
                size="small"
                tabIndex={node.id === activeId ? 0 : -1}
                onClick={(event) => {
                  event.stopPropagation();
                  onRenameStart(node.id);
                }}
              >
                <EditIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={`Delete ${node.title}`}>
              <IconButton
                size="small"
                tabIndex={node.id === activeId ? 0 : -1}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteRequest(node.id);
                }}
              >
                <DeleteIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            {/* The keyboard/screen-reader route to re-parenting - drag-and-drop
                is pointer-only by construction (native HTML DnD emits no
                keyboard events). */}
            <Tooltip title={`Move ${node.title}`}>
              <IconButton
                size="small"
                tabIndex={node.id === activeId ? 0 : -1}
                aria-label={`Move ${node.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveRequest(node.id);
                }}
              >
                <DriveFileMoveOutlinedIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {hasChildren && isExpanded && (
        <Box component="ul" role="group" sx={{ listStyle: "none", m: 0, p: 0, width: 1 }}>
          {node.children.map((child) => (
            <PageTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
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
        </Box>
      )}
    </Box>
  );
}
