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
import { TOUCH_TARGET_SX } from "@/app/theme/mobileSx";
import { indentAtDepth, MOVE_INDENT } from "@/lib/experience/treeIndent";
import { useIsMobile } from "../../hooks/useResponsive";
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
  const isMobile = useIsMobile();
  const targets = page ? moveTargets(pages || [], page.id) : [];

  function choose(targetId) {
    if (!page) return;
    onMove(page.id, targetId);
    onClose();
  }

  return (
    // fullScreen on a phone: a `maxWidth="xs"` paper is 375 - 64 = 311px at
    // 375, and after DialogContent's own padding the label column at depth 5
    // is under 200px. This dialog is the keyboard/screen-reader route to
    // re-parenting (drag is pointer-only), so it is also the route that must
    // survive the narrowest viewport.
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth fullScreen={isMobile}>
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
                // Same capped-indent ruling as the tree itself, at this
                // list's own step - see lib/experience/treeIndent.js. Each
                // row's label is a full breadcrumb path, so a flattened
                // indent costs nothing here: the path text still says where
                // the destination sits.
                sx={{ pl: indentAtDepth(target.depth, MOVE_INDENT), py: 0.75, ...TOUCH_TARGET_SX }}
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
