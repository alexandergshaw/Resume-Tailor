"use client";

import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import TabHeader from "../TabHeader";
import PageTree from "./PageTree";
import DeletePageDialog from "./DeletePageDialog";
import MovePageDialog from "./MovePageDialog";
import PageEditor from "./PageEditor";
import AttachmentPanel from "./AttachmentPanel";
import BulkActionsBar from "./BulkActionsBar";
import TechWatchPanel from "./TechWatchPanel";
import { useExperiencePages } from "../../hooks/useExperiencePages";
import { toggleSelected, selectionSummary } from "../../../lib/experience/bulkSelection";
import { buildPageContext } from "../../../lib/experience/pageContext";
import { createClient } from "../../../lib/supabase/client";

// Attachment kinds whose bytes are actually downloaded and handed to the
// chat as a real file. Mirrors app/api/chat/route.js exactly: text/.docx get
// extracted, image/pdf get sent as inline data - video is never forwarded
// (its base64 would also blow the request size), so it is deliberately
// absent from this set. lib/experience/pageContext.js still describes a
// video in the pinned TEXT (name, notes, transcript) - this set is only
// about which kinds get their BYTES downloaded.
const DOWNLOADABLE_ATTACHMENT_KINDS = new Set(["text", "image", "pdf"]);

const ATTACHMENTS_BUCKET = "resumes";

// Mirrors PageEditor.js's ANNOUNCE_TOGGLE exactly, and for the same reason:
// built explicitly rather than typed as a literal character in source, so
// an invisible unicode character is never lost or mis-copied in an editor.
// Appended to the live-region text on alternating announcements so two
// consecutive identical announcements ("Deleted" then "Deleted") still
// produce a genuinely different DOM text node for assistive tech to notice.
const ANNOUNCE_TOGGLE = String.fromCodePoint(0x200b);

// The standard visually-hidden clip-rect style (same values as
// lib/copilot/answerStatus.js's own `visuallyHidden`, kept as a local copy
// rather than imported so this feature has no dependency on the copilot
// one) for a live region that exists purely for assistive tech - the
// create/rename/delete/move confirmations below have no sighted-user
// surface of their own to occupy.
const HIDDEN_STATUS_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// Finds the array a node with `id` currently sits in within `tree` (built
// tree, already sorted per lib/experience/tree.js's rules) - its siblings,
// its index among them, and its parent's id (null at the top level). Used
// only to pick a sensible focus target after that node disappears; never
// mutates `tree`.
function findNodeContext(tree, id) {
  function search(nodes, parentId) {
    const list = Array.isArray(nodes) ? nodes : [];
    const index = list.findIndex((n) => n.id === id);
    if (index !== -1) return { siblings: list, index, parentId };
    for (const node of list) {
      if (Array.isArray(node.children) && node.children.length > 0) {
        const found = search(node.children, node.id);
        if (found) return found;
      }
    }
    return null;
  }
  return search(Array.isArray(tree) ? tree : [], null);
}

// Where focus should land after `id` (and everything `removedIds` names,
// its cascaded descendants included) disappears from the tree: the next
// remaining sibling, else the previous remaining sibling, else the parent
// row (if it survives), else null - meaning no sensible in-tree target
// exists, which in practice only happens when the whole tree just emptied.
function pickNextFocusId(tree, id, removedIds) {
  const ctx = findNodeContext(tree, id);
  if (!ctx) return null;
  const { siblings, index, parentId } = ctx;
  const after = siblings.slice(index + 1).find((s) => !removedIds.has(s.id));
  if (after) return after.id;
  const before = siblings
    .slice(0, index)
    .reverse()
    .find((s) => !removedIds.has(s.id));
  if (before) return before.id;
  if (parentId && !removedIds.has(parentId)) return parentId;
  return null;
}

function queryTreeItem(root, id) {
  if (!root || !id) return null;
  return root.querySelector(`[role="treeitem"][data-page-id="${CSS.escape(id)}"]`);
}

// The tab shell for the "Professional Experience" knowledge base: a sidebar
// page tree (PageTree.js, wired through lib/experience/treeNav.js) next to
// the markdown editor and attachments panel for whichever page is selected.
// AttachmentPanel is a contract stub owned by chunk 4 - this file imports it
// by its fixed prop signature and never edits it. PageEditor is now also
// wired for "Ask AI" (see handleAskAi below).
//
// Loading/signed-out states follow app/components/LibraryEditor.js's shape:
// a spinner, then an Alert severity="info" for a 401.
//
// `askAiAbout` / `addChatAttachments`: the same two chat-hook functions
// every other "Ask AI" button in this app is wired through (see e.g.
// app/page.js's own askAiAboutMaterial) - pin context and open the chat
// panel, and text-extract-or-inline a File onto that same conversation.
// This component only ever calls them through handleAskAi below, and it
// calls them DIRECTLY (never `askAiAbout?.(...)`): app/page.js is the only
// place that can actually pass the real chat instance down, and if some
// future change to that call site drops these props, Ask AI must fail
// loudly the moment it's pressed, not silently do nothing.
export default function ExperienceTab({ askAiAbout, addChatAttachments }) {
  const {
    pages,
    tree,
    loading,
    signedOut,
    error,
    setError,
    reload,
    createPage,
    renamePage,
    savePage,
    deletePage,
    movePage,
    breadcrumbFor,
    descendantsOf,
  } = useExperiencePages();

  const [selectedId, setSelectedId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [renamingId, setRenamingId] = useState(null);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState(null);
  // The bulk-selection checkbox set (chunk 8) - deliberately separate state
  // from `selectedId` above, which is "the page open in the editor". A page
  // can be open AND unchecked, or checked AND not open; the tree only ever
  // reads this to decide which checkboxes render checked, never to decide
  // aria-selected.
  const [selectedPageIds, setSelectedPageIds] = useState(() => new Set());
  // { text, seq } - same pattern as PageEditor.js's own status region.
  // Covers the PAGE-level operations this file owns: created, renamed,
  // deleted, moved, and (chunk 8) the bulk-selection count and bulk
  // delete/move. Attachment upload/delete belong to AttachmentPanel.js, a
  // different agent's file, and are NOT covered by this region.
  const [announcement, setAnnouncement] = useState({ text: "", seq: 0 });
  // { type: "page", pageId } | { type: "emptyState" } | null - a focus
  // target requested by a delete or a move, carried out by the effect
  // below once the corresponding DOM actually exists (which may take a
  // render or two: a move into a collapsed parent first has to expand it).
  const [focusRequest, setFocusRequest] = useState(null);

  const sidebarRef = useRef(null);
  const emptyStateCreateButtonRef = useRef(null);

  const selectedPage = pages.find((p) => p.id === selectedId) || null;
  const deleteTargetPage = pages.find((p) => p.id === deleteTargetId) || null;
  const moveTargetPage = pages.find((p) => p.id === moveTargetId) || null;
  const crumbs = selectedId ? breadcrumbFor(selectedId) : [];

  function announce(text) {
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }));
  }

  // Toggles one page's bulk-selection checkbox. `announce` is called
  // unconditionally on every toggle, never skipped because the resulting
  // count happens to repeat a PREVIOUS count - `announce` always bumps
  // `seq`, so React never bails out on an unchanged setState the way it
  // would for a bare repeated string, which is what makes going
  // 3 selected -> 2 -> 3 announce the second 3. The count itself comes from
  // `selectionSummary`'s own ghost-id filtering, so a page deleted
  // elsewhere while still checked here can never inflate what gets spoken.
  function toggleSelect(id) {
    const next = toggleSelected(selectedPageIds, id);
    setSelectedPageIds(next);
    const count = selectionSummary(pages, next).selected;
    announce(count > 0 ? `${count} page${count === 1 ? "" : "s"} selected` : "Selection cleared");
  }

  function clearSelection() {
    if (selectedPageIds.size === 0) return;
    setSelectedPageIds(new Set());
    announce("Selection cleared");
  }

  // The ids a bulk action should actually act on: every selected id that is
  // NOT itself a descendant of some OTHER selected id. Deleting (or moving)
  // a selected parent already cascades to a selected child by construction
  // - acting on the child too would either error (delete: the row is
  // already gone server-side by the time its own request lands) or, worse
  // for a move, silently flatten it out from under its still-selected
  // parent into a direct child of the destination instead of moving WITH
  // its parent, which is what the user's two checkmarks actually implied.
  function selectionRoots(ids) {
    const idSet = new Set(ids);
    return ids.filter((id) => !breadcrumbFor(id).slice(0, -1).some((ancestor) => idSet.has(ancestor.id)));
  }

  // Awaited by BulkActionsBar's own confirm dialog, mirroring
  // handleDeleteConfirm below: stays open with an error on partial or total
  // failure, closes (by the selection emptying, which is what the bar's own
  // visibility is keyed on) only once every root page is actually gone.
  async function handleBulkDelete(ids) {
    const roots = selectionRoots(ids);
    const removedIds = new Set(roots.flatMap((id) => [id, ...descendantsOf(id)]));
    const anchorId = roots[0] ?? null;
    const nextFocusId = anchorId ? pickNextFocusId(tree, anchorId, removedIds) : null;
    const remainingCount = pages.length - removedIds.size;

    const results = [];
    for (const id of roots) {
      // Sequential, not Promise.all: each DELETE is itself a full-subtree
      // server-side cascade, and there is no correctness reason to race N
      // of them at once for what is already a fire-once confirmed action.
      results.push(await deletePage(id));
    }

    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      return {
        ok: false,
        error: `${failed} of ${roots.length} page${roots.length === 1 ? "" : "s"} could not be deleted.`,
      };
    }

    if (selectedId && removedIds.has(selectedId)) setSelectedId(null);
    setSelectedPageIds(new Set());
    announce(`Deleted ${roots.length} page${roots.length === 1 ? "" : "s"}`);
    if (remainingCount <= 0) {
      setFocusRequest({ type: "emptyState" });
    } else if (nextFocusId) {
      setFocusRequest({ type: "page", pageId: nextFocusId });
    }
    return { ok: true };
  }

  // Mirrors MovePageDialog's own choose(): fires the move(s) and lets the
  // dialog close immediately rather than making the user wait on a
  // spinner - a failure surfaces through the SAME shared error Alert a
  // single move already uses (movePage's own setError calls below), not a
  // bespoke one here.
  function handleBulkMove(ids, destinationId) {
    const roots = selectionRoots(ids);
    if (destinationId) setExpandedIds((prev) => new Set(prev).add(destinationId));
    setSelectedPageIds(new Set());
    (async () => {
      let succeeded = 0;
      for (const id of roots) {
        // Sequential on purpose - see handleBulkDelete above.
        const result = await movePage(id, destinationId);
        if (result.ok) succeeded += 1;
      }
      if (succeeded > 0) {
        announce(`Moved ${succeeded} page${succeeded === 1 ? "" : "s"}`);
      }
    })();
  }

  // Carries out a pending focus request once its target actually exists in
  // the DOM. Depends on `tree`/`expandedIds` too (not just `focusRequest`
  // itself) so that a move into a COLLAPSED parent - which this file now
  // expands as part of the same move, see handleMove below - gets a second
  // chance to find the row once that expansion has actually rendered,
  // rather than only trying once at the moment the request was made.
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.type === "emptyState") {
      emptyStateCreateButtonRef.current?.focus();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusRequest(null);
      return;
    }
    if (focusRequest.type === "page") {
      const el = queryTreeItem(sidebarRef.current, focusRequest.pageId);
      if (el) {
        el.focus();
        setFocusRequest(null);
      }
    }
  }, [focusRequest, tree, expandedIds]);

  // The one handler both re-parent routes converge on: PageTree's drag path
  // (pointer-only - native HTML drag-and-drop emits no keyboard events) and
  // MovePageDialog's picker (the keyboard/screen-reader route to the same
  // move) both call this and nothing else.
  function handleMove(id, newParentId) {
    // A move into a COLLAPSED parent used to hide the moved page with no
    // cue at all - the row vanishes from the sidebar, focus lands nowhere,
    // nothing is announced. handleCreate already expands the parent for a
    // new child; do the same here, synchronously, before the move even
    // resolves, so the row is renderable the instant the tree updates.
    if (newParentId) setExpandedIds((prev) => new Set(prev).add(newParentId));
    const movedPage = pages.find((p) => p.id === id);
    movePage(id, newParentId).then((result) => {
      if (result.ok) {
        announce(`Moved "${movedPage ? movedPage.title : "page"}"`);
        setFocusRequest({ type: "page", pageId: id });
      }
    });
  }

  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Shared by the toolbar "New top-level page" button (always parent =
  // null - see its own comment below) and each row's "Add sub-page" hover
  // action (parent = that specific row). The new page's title field (the
  // sidebar's inline rename input - the only real title field this chunk
  // owns, PageEditor being a stub until chunk 3) gets focus once the
  // create round-trip resolves.
  async function handleCreate(parentId) {
    const result = await createPage({ title: "Untitled page", parentId: parentId ?? null });
    if (result.ok && result.page) {
      if (parentId) setExpandedIds((prev) => new Set(prev).add(parentId));
      setSelectedId(result.page.id);
      setRenamingId(result.page.id);
      announce(`Created "${result.page.title}"`);
    }
  }

  async function handleRenameCommit(id, rawTitle) {
    setRenamingId(null);
    const title = (rawTitle || "").trim();
    const current = pages.find((p) => p.id === id);
    if (!title || !current || current.title === title) return;
    const result = await renamePage(id, title);
    if (result.ok) announce(`Renamed to "${title}"`);
  }

  async function handleDeleteConfirm(id) {
    // Snapshot who's about to disappear BEFORE the delete resolves - the
    // `pages` this closure sees stays fixed at its pre-delete value across
    // the await, so this is the only reliable way to know whether the
    // currently-selected page just went away as part of the cascade. The
    // same pre-delete snapshot is also the only place a sensible focus
    // target (the next remaining sibling, etc.) can be computed from -
    // once the delete resolves, the row it would have been computed
    // against is already gone.
    const removedIds = new Set([id, ...descendantsOf(id)]);
    const deletedPage = pages.find((p) => p.id === id);
    const nextFocusId = pickNextFocusId(tree, id, removedIds);
    const remainingCount = pages.length - removedIds.size;
    setDeleting(true);
    const result = await deletePage(id);
    setDeleting(false);
    if (result.ok) {
      setDeleteTargetId(null);
      if (selectedId && removedIds.has(selectedId)) setSelectedId(null);
      announce(`Deleted "${deletedPage ? deletedPage.title : "page"}"`);
      // Focus used to be left stranded at document.body here - stranded
      // once for a real delete, and (combined with there being no live
      // region at all before this fix) completely silently: a row
      // disappears, the main pane swaps, and nothing tells a screen reader
      // user any of that happened.
      if (remainingCount <= 0) {
        setFocusRequest({ type: "emptyState" });
      } else if (nextFocusId) {
        setFocusRequest({ type: "page", pageId: nextFocusId });
      }
    }
  }

  // PageEditor's own onAskAi callback: `{ title, body }` as currently shown
  // on screen (see PageEditor.js's own comment - it may be ahead of the
  // last-saved row by up to its 800ms autosave debounce). This is the ONE
  // place breadcrumb, child pages and attachments all come together with
  // that live text into a single pinned context - none of the three pieces
  // live in PageEditor, and AttachmentPanel keeps its own attachment list
  // private (a different agent's file), so this fetches its own copy from
  // the same GET route AttachmentPanel itself calls rather than reaching
  // into that component's state.
  async function handleAskAi({ title, body }) {
    if (!selectedPage) return;
    const pageId = selectedPage.id;
    const childPages = pages.filter((p) => (p.parent_id ?? null) === pageId);

    let attachments = [];
    try {
      const res = await fetch(`/api/experience/attachments?pageId=${encodeURIComponent(pageId)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) attachments = Array.isArray(data.attachments) ? data.attachments : [];
    } catch {
      // Best-effort: a page's title/body/breadcrumb/child-pages are still
      // worth pinning even when the attachment inventory could not be
      // fetched - see lib/experience/pageContext.js, which treats a missing
      // `attachments` array as simply empty rather than throwing.
      attachments = [];
    }

    const { label, content } = buildPageContext({
      page: { id: pageId, title, body },
      breadcrumb: crumbs,
      childPages,
      attachments,
    });

    // Hard call - see this component's own header comment on why this is
    // never `askAiAbout?.(...)`.
    askAiAbout({ label, content });

    // Video is deliberately excluded here (see DOWNLOADABLE_ATTACHMENT_KINDS'
    // own comment) - its bytes are never sent to the model, only the notice
    // pageContext.js already wrote into `content` above.
    const downloadable = attachments.filter(
      (a) => a && DOWNLOADABLE_ATTACHMENT_KINDS.has(a.kind) && a.storage_path,
    );
    if (downloadable.length === 0) return;

    const supabase = createClient();
    const files = (
      await Promise.all(
        downloadable.map(async (a) => {
          try {
            const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(a.storage_path);
            if (error || !data) return null;
            // Mirrors app/page.js's askAiAboutMaterial exactly: wrap the
            // downloaded Blob in a File so addChatAttachments' own
            // extension/mime sniffing (isDocxResume/isTextResume/image/pdf)
            // works unchanged.
            return new File([data], a.name, { type: data.type || a.mime || undefined });
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);

    if (files.length > 0) await addChatAttachments(files);
  }

  if (loading) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (signedOut) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="info">Please sign in to manage your professional experience.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", maxWidth: 1200, minWidth: 0, mx: "auto", p: { xs: 2, md: 4 } }}>
      <TabHeader
        title="Professional Experience"
        description="A project-by-project knowledge base the tailoring engine can pull real detail from."
        actions={
          pages.length > 0 ? (
            <Button
              startIcon={<AddIcon sx={{ fontSize: 18 }} />}
              variant="outlined"
              size="small"
              // Always the top level - NOT `handleCreate(selectedId)`. This
              // button used to inherit whatever page happened to be
              // selected as the new page's parent, silently, with no
              // indication that is what "New page" meant - once anything
              // was selected there was no way left to create a second
              // top-level page except creating a child and re-parenting it
              // through the Move dialog. Each row's own "Add sub-page"
              // hover action already covers nesting in one click, so a
              // split button is unnecessary here.
              onClick={() => handleCreate(null)}
              sx={{ textTransform: "none", borderRadius: 1.5, whiteSpace: "nowrap" }}
            >
              New top-level page
            </Button>
          ) : null
        }
        sx={{ mb: 2.5 }}
      />

      {/* Announces the page-level operations this file owns - create,
          rename, delete, move, and (chunk 8) the bulk-selection count and
          bulk delete/move - to assistive tech. Attachment upload/delete
          announcements belong to AttachmentPanel.js, a different agent's
          file, and are intentionally NOT covered here. Visually hidden:
          these are one-shot confirmations with no sighted-user surface of
          their own (contrast PageEditor.js's OWN status region, which is
          visible because it also doubles as the save-in-progress
          indicator). */}
      <Box component="span" role="status" aria-live="polite" sx={HIDDEN_STATUS_SX}>
        {announcement.text}
        {announcement.seq % 2 === 1 ? ANNOUNCE_TOGGLE : ""}
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {/* Rendered ahead of the sidebar tree entirely (not nested inside its
          box) so it sits early in DOM/tab order - reachable without tabbing
          through any tree row - and vanishes on its own once nothing is
          checked (BulkActionsBar returns null for an empty selection). */}
      <BulkActionsBar
        pages={pages}
        selectedIds={selectedPageIds}
        onDeleteSelected={handleBulkDelete}
        onMoveSelected={handleBulkMove}
        // Research report (chunk 9) creates its new child pages entirely
        // server-side - this is the only way this tab's own `pages` state
        // (and therefore the tree) learns about them, the same reload()
        // already used on mount and by the create/edit dialogs elsewhere in
        // this file.
        onPagesChanged={reload}
      />

      {/* Sits outside the empty-project-pages branch below on purpose - the
          briefing falls back to a default watchlist with no pages at all,
          so a brand-new user with nothing else on this tab still sees it. */}
      <TechWatchPanel />

      {pages.length === 0 ? (
        <Box sx={{ border: "1px dashed var(--border)", borderRadius: 1.5, py: 6, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No project pages yet.
          </Typography>
          <Button
            variant="contained"
            disableElevation
            ref={emptyStateCreateButtonRef}
            onClick={() => handleCreate(null)}
            sx={{ textTransform: "none", borderRadius: 1.5 }}
          >
            Create your first project page
          </Button>
        </Box>
      ) : (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} sx={{ alignItems: "flex-start" }}>
          <Box
            ref={sidebarRef}
            sx={{
              width: { xs: "100%", md: 280 },
              flexShrink: 0,
              border: "1px solid var(--border)",
              borderRadius: 1.5,
              p: 1,
            }}
          >
            <PageTree
              tree={tree}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={setSelectedId}
              onToggle={toggleExpanded}
              renamingId={renamingId}
              onRenameStart={setRenamingId}
              onRenameCommit={handleRenameCommit}
              onRenameCancel={() => setRenamingId(null)}
              onCreateChild={handleCreate}
              onDeleteRequest={setDeleteTargetId}
              onMoveRequest={setMoveTargetId}
              onMove={handleMove}
              selectedPageIds={selectedPageIds}
              onToggleSelect={toggleSelect}
              onClearSelection={clearSelection}
            />
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            {selectedPage ? (
              <>
                {crumbs.length > 1 && (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexWrap: "wrap", mb: 1.5 }}>
                    {crumbs.map((crumb, i) => (
                      <Box key={crumb.id} sx={{ display: "flex", alignItems: "center" }}>
                        {i > 0 && (
                          <NavigateNextIcon sx={{ fontSize: 16, color: "var(--text-secondary)", mx: 0.25 }} />
                        )}
                        <Button
                          size="small"
                          onClick={() => setSelectedId(crumb.id)}
                          disabled={crumb.id === selectedId}
                          sx={{ textTransform: "none", fontSize: 12.5, minWidth: 0, px: 0.75, py: 0.25 }}
                        >
                          {crumb.title}
                        </Button>
                      </Box>
                    ))}
                  </Stack>
                )}

                <PageEditor
                  page={selectedPage}
                  // A single combined save: PageEditor's autosave always
                  // sends both title and body together, and this must issue
                  // exactly ONE PATCH for that - firing two independent
                  // requests (one per field) here raced them against each
                  // other, and the loser's stale reply silently overwrote
                  // the winner's just-saved text in local state.
                  onChange={(patch) => savePage(selectedPage.id, patch)}
                  onAskAi={handleAskAi}
                />

                <Box sx={{ mt: 3 }}>
                  <AttachmentPanel pageId={selectedPage.id} />
                </Box>
              </>
            ) : (
              <Box sx={{ border: "1px dashed var(--border)", borderRadius: 1.5, py: 6, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  Select a page, or create one, to get started.
                </Typography>
              </Box>
            )}
          </Box>
        </Stack>
      )}

      <DeletePageDialog
        open={!!deleteTargetId}
        pages={pages}
        page={deleteTargetPage}
        busy={deleting}
        error={deleteTargetId ? error : ""}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={handleDeleteConfirm}
      />

      <MovePageDialog
        open={!!moveTargetId}
        pages={pages}
        page={moveTargetPage}
        onClose={() => setMoveTargetId(null)}
        onMove={handleMove}
      />
    </Box>
  );
}
