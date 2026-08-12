"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Typography from "@mui/material/Typography";
import { moveTargets } from "../../../lib/experience/moveTargets";

// The keyboard- and screen-reader-reachable route to re-parenting a page -
// drag-and-drop (PageTreeItem.js's draggable row, and the "drop here to move
// to top level" strip in PageTree.js) is pointer-only, which native HTML
// drag-and-drop always is: it emits no keyboard events and exposes nothing to
// assistive technology. This dialog is the other route to the SAME move.
// Both call the identical `onMove(id, newParentId)`, so there is exactly one
// place that actually performs a move - this dialog just offers a way to
// choose the destination without a pointer.
export default function MovePageDialog({ open, pages, page, onClose, onMove }) {
  const targets = page ? moveTargets(pages || [], page.id) : [];

  function choose(targetId) {
    if (!page) return;
    onMove(page.id, targetId);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{page ? `Move “${page.title}”` : "Move page"}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {targets.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            There is nowhere else to move this page.
          </Typography>
        ) : (
          <List dense disablePadding aria-label="Move to">
            {targets.map((target) => (
              <ListItemButton
                key={target.id ?? "top-level"}
                onClick={() => choose(target.id)}
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
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
