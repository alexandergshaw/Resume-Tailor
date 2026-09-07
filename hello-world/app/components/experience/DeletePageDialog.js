"use client";

import { breadcrumb, collectDescendantIds } from "../../../lib/experience/tree";
import FormDialog from "../FormDialog";

// The database cascades a page delete to every sub-page, so this dialog is
// the only thing standing between a mis-click and a lost subtree - it must
// name the blast radius, not just ask "are you sure?". `pages` is the full
// flat row list (not the tree), which is what collectDescendantIds expects.
//
// THE RADIUS GOT WIDER WHEN THE KNOWLEDGE PANEL SHIPPED, and this dialog is
// still the only place the user can learn it. Deleting a page now also
// destroys, in the same click:
//
//   * the stored summary and the ENTIRE question history for that page and
//     every page beneath it - the two composite FKs' `on delete cascade` in
//     supabase/migrations/20260906010000_experience_knowledge.sql; and
//   * the stored summary and question history for every scope that CONTAINED
//     it - each ancestor page, and the whole-knowledge-base scope - which no
//     cascade can reach and which the page-delete route purges instead.
//
// A summary can be written again. A QUESTION HISTORY CANNOT: it is the one
// thing in that feature the user authored, and it may have been built up over
// weeks. So the clause names it explicitly, in the real numbers.
//
// It is rendered UNCONDITIONALLY rather than only when a stored row exists.
// Knowing that would take a per-scope existence check across the subtree AND
// the whole ancestor chain - a round trip on every dialog open, for a dialog
// whose whole job is to open instantly. The wording carries the uncertainty
// instead ("Any saved summary or question history..."), which is true when
// there is none and true when there is a great deal.

// `pagesLost` is the page plus its sub-pages: the scopes whose OWN rows go.
// `ancestorCount` is the strict ancestors above it; the whole-knowledge-base
// scope is named separately because it is the one scope that is affected by
// EVERY delete at every depth and has no page to be counted among.
function knowledgeClause(pagesLost, ancestorCount) {
  const them = pagesLost === 1 ? "it" : "them";
  const subject = pagesLost === 1 ? "this page" : `those ${pagesLost} pages`;
  const first = `Any saved summary or question history for ${subject} goes with ${them}.`;
  if (ancestorCount === 0) {
    return `${first} The summary and question history for your whole knowledge base are cleared too, because they covered ${them}.`;
  }
  const above = `the ${ancestorCount} page${ancestorCount === 1 ? "" : "s"} above ${them}`;
  return `${first} The summary and question history for ${above}, and for your whole knowledge base, are cleared too — ${
    ancestorCount + 1
  } more that would have to be written again.`;
}

export default function DeletePageDialog({ open, pages, page, onClose, onConfirm, busy = false, error = "" }) {
  const rows = pages || [];
  const descendantCount = page ? collectDescendantIds(rows, page.id).length : 0;
  // breadcrumb returns root -> ... -> self, so the last entry is the page
  // itself and must not be counted as one of the pages above it.
  const ancestorCount = page ? Math.max(0, breadcrumb(rows, page.id).length - 1) : 0;

  const headline =
    page == null
      ? ""
      : descendantCount > 0
        ? `Delete “${page.title}” and its ${descendantCount} sub-page${descendantCount === 1 ? "" : "s"}? This cannot be undone.`
        : `Delete “${page.title}”? This cannot be undone.`;

  const message = page == null ? "" : `${headline} ${knowledgeClause(descendantCount + 1, ancestorCount)}`;

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
