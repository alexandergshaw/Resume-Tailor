"use client";

import { collectDescendantIds } from "../../../lib/experience/tree";
import FormDialog from "../FormDialog";

// The database cascades a page delete to every sub-page, so this dialog is
// the only thing standing between a mis-click and a lost subtree - it must
// name the blast radius, not just ask "are you sure?". `pages` is the full
// flat row list (not the tree), which is what collectDescendantIds expects.
export default function DeletePageDialog({ open, pages, page, onClose, onConfirm, busy = false, error = "" }) {
  const descendantCount = page ? collectDescendantIds(pages || [], page.id).length : 0;

  const message =
    page == null
      ? ""
      : descendantCount > 0
        ? `Delete “${page.title}” and its ${descendantCount} sub-page${descendantCount === 1 ? "" : "s"}? This cannot be undone.`
        : `Delete “${page.title}”? This cannot be undone.`;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Delete page"
      error={error}
      busy={busy}
      onSubmit={() => page && onConfirm(page.id)}
      submitLabel="Delete"
      busyLabel="Deleting…"
    >
      {message}
    </FormDialog>
  );
}
