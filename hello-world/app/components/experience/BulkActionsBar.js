"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import FormDialog from "../FormDialog";
import { selectionSummary, bulkMoveTargets } from "../../../lib/experience/bulkSelection";

// Ids for the visible explanations disabled actions point at via
// aria-describedby - same B3 fix JobDescriptionTab.js already shipped: a
// disabled action keeps a REAL `disabled` attribute only when there is
// nothing further to say about it. Here every disabled action has a reason,
// so none of the three uses the native attribute - a native `disabled`
// pulls the control out of the tab order at exactly the moment its
// explanation appears, so the only users who could not reach the reason
// would be the ones who could not see it either. `aria-disabled` keeps the
// button focusable and reachable; the click handler refuses the action
// itself instead of the DOM attribute doing it.
const MOVE_CAPTION_ID = "bulk-actions-move-caption";
const COMING_SOON_CAPTION_ID = "bulk-actions-coming-soon-caption";

// Visually-disabled styling that matches MUI's own disabled look without
// actually setting `disabled` - see the comment above.
const DISABLED_LOOK_SX = { opacity: 0.38, cursor: "default" };

// The toolbar that appears once at least one page is checked in the
// sidebar tree, plus the two dialogs its own two working actions open.
// Delete and Move cannot literally reuse DeletePageDialog/MovePageDialog -
// both hard-code a SINGLE `page` prop and compute their own targets
// on-instance, and neither is on this chunk's editable-files list - so this
// mirrors their shape instead: same FormDialog primitive and message
// cadence for delete, the same Dialog/List/ListItemButton layout MovePageDialog
// itself uses for move, both driven by the bulk-aware
// lib/experience/bulkSelection.js helpers rather than the single-page ones.
//
// Research report (chunk 9) and PowerPoint (chunk 10) are left as visible,
// clearly-labelled, permanently disabled seams - not built here, not
// silently absent either. Whoever wires them up only needs to swap their
// aria-disabled/onClick for a real handler; the bar's layout and the
// "disabled needs a reason" pattern already fit them.
export default function BulkActionsBar({ pages, selectedIds, onDeleteSelected, onMoveSelected }) {
  const [dialog, setDialog] = useState(null); // null | "delete" | "move"
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const summary = selectionSummary(pages, selectedIds);
  if (summary.selected === 0) return null;

  const ids = [...selectedIds].filter((id) => (pages || []).some((p) => p.id === id));
  const targets = bulkMoveTargets(pages, selectedIds);
  const moveBlocked = targets.length === 0;

  function closeDialog() {
    setDialog(null);
    setDialogError("");
  }

  async function handleDeleteConfirm() {
    setBusy(true);
    const result = await onDeleteSelected(ids);
    setBusy(false);
    if (result.ok) {
      closeDialog();
    } else {
      setDialogError(result.error || "Some pages could not be deleted.");
    }
  }

  function chooseMoveDestination(destinationId) {
    onMoveSelected(ids, destinationId);
    // Mirrors MovePageDialog's own choose(): fire the move and close right
    // away rather than making the user wait on a spinner. A failure
    // surfaces through the app's existing shared error Alert, the same
    // place a single move's failure already does.
    closeDialog();
  }

  return (
    <>
      <Box
        role="region"
        aria-label="Bulk actions"
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1.25,
          mb: 2,
          p: 1.25,
          border: "1px solid var(--border)",
          borderRadius: 1.5,
          backgroundColor: "var(--bg-soft)",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13.5 }}>
          {summary.selected} selected
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setDialog("delete")}
            sx={{ textTransform: "none" }}
          >
            Delete selected
          </Button>

          <Button
            variant="outlined"
            size="small"
            aria-disabled={moveBlocked || undefined}
            aria-describedby={moveBlocked ? MOVE_CAPTION_ID : undefined}
            onClick={() => {
              if (moveBlocked) return;
              setDialog("move");
            }}
            sx={{ textTransform: "none", ...(moveBlocked ? DISABLED_LOOK_SX : {}) }}
          >
            Move selected
          </Button>

          {/* Seams for chunk 9 (Research report) and chunk 10 (PowerPoint):
              neither is built yet, so both stay permanently disabled with an
              explanation rather than being silently absent from the bar. */}
          <Button
            variant="outlined"
            size="small"
            aria-disabled="true"
            aria-describedby={COMING_SOON_CAPTION_ID}
            onClick={() => {}}
            sx={{ textTransform: "none", ...DISABLED_LOOK_SX }}
          >
            Research report
          </Button>
          <Button
            variant="outlined"
            size="small"
            aria-disabled="true"
            aria-describedby={COMING_SOON_CAPTION_ID}
            onClick={() => {}}
            sx={{ textTransform: "none", ...DISABLED_LOOK_SX }}
          >
            PowerPoint
          </Button>
        </Stack>

        {moveBlocked ? (
          <Typography id={MOVE_CAPTION_ID} sx={{ fontSize: "0.72rem", color: "var(--text-muted)", width: 1 }}>
            No destination fits every selected page.
          </Typography>
        ) : null}
        <Typography id={COMING_SOON_CAPTION_ID} sx={{ fontSize: "0.72rem", color: "var(--text-muted)", width: 1 }}>
          Research report and PowerPoint are not available yet.
        </Typography>
      </Box>

      <FormDialog
        open={dialog === "delete"}
        onClose={closeDialog}
        title="Delete pages"
        error={dialogError}
        busy={busy}
        onSubmit={handleDeleteConfirm}
        submitLabel="Delete"
        busyLabel="Deleting…"
      >
        {`Delete ${summary.total} page${summary.total === 1 ? "" : "s"}? This cannot be undone.`}
      </FormDialog>

      <Dialog open={dialog === "move"} onClose={closeDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{`Move ${summary.selected} page${summary.selected === 1 ? "" : "s"}`}</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {targets.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              There is nowhere every selected page can move to.
            </Typography>
          ) : (
            <List dense disablePadding aria-label="Move to">
              {targets.map((target) => (
                <ListItemButton
                  key={target.id ?? "top-level"}
                  onClick={() => chooseMoveDestination(target.id)}
                  sx={{ pl: 2 + target.depth * 2, py: 0.75 }}
                >
                  <Typography variant="body2" sx={{ fontSize: 13.5 }}>
                    {target.label}
                  </Typography>
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
