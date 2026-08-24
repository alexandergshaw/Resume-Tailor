"use client";

import { useRef, useState } from "react";
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
import { runWithConcurrency } from "../../../lib/tailor/runWithConcurrency";
import { wantsEmbedded } from "../../../lib/llm/featureEngine";
import { readEngine } from "../../settings/engine";
import { outlineFromPages } from "../../../lib/experience/deckOutline.js";
import { buildDeck } from "../../../lib/experience/pptxWriter.js";
import { fetchDeckTemplate, uploadDeckTemplate } from "../../../lib/experience/deckTemplateStore.js";
import { triggerBlobDownload } from "../../../lib/document/download.js";
import { sanitizeFileNamePart } from "../../../lib/document/docx.js";
import { fragmentsFromPages } from "../../../lib/experience/tailorSources.js";
import ImportToLibraryDialog from "./ImportToLibraryDialog.js";

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
const RESEARCH_CAPTION_ID = "bulk-actions-research-caption";
const DECK_CAPTION_ID = "bulk-actions-deck-caption";
const TEMPLATE_CAPTION_ID = "bulk-actions-template-caption";
const LIBRARY_CAPTION_ID = "bulk-actions-library-caption";

// Runs research requests RESEARCH_CONCURRENCY at a time, matching this
// chunk's own AC: a grounded search takes tens of seconds, so the client
// fans requests out one page per request rather than asking the route to do
// the whole selection in one call (a serverless timeout waiting to happen,
// and it makes partial success inexpressible). Mirrors startBatchTailor's
// own limit of 3.
const RESEARCH_CONCURRENCY = 3;

// Same cap, same reasoning, for fetching each selected image attachment's
// own bytes before buildDeck can embed it: a page can carry several images,
// and fetching every signed url for every selected page's every attachment
// all at once is the same unbounded-fan-out risk RESEARCH_CONCURRENCY exists
// to avoid.
const IMAGE_FETCH_CONCURRENCY = 3;

// Visually-disabled styling that matches MUI's own disabled look without
// actually setting `disabled` - see the comment above.
const DISABLED_LOOK_SX = { opacity: 0.38, cursor: "default" };

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// One GET per selected page, same reasoning as researchOne below: the
// outline needs { page, attachments } per entry (deckOutline.js's
// outlineFromPages), and the attachments route is already keyed by a single
// pageId with no bulk form. Never throws and never blocks the whole deck on
// one page's attachments failing to load - a network hiccup on one page
// degrades that page to "no attachments" rather than aborting a generation
// the user is sitting there waiting on.
async function fetchPageAttachments(pageId) {
  try {
    const res = await fetch(`/api/experience/attachments?pageId=${encodeURIComponent(pageId)}`);
    if (!res.ok) return [];
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json?.attachments) ? json.attachments : [];
  } catch {
    return [];
  }
}

// One GET per image attachment, of its OWN short-lived signed `url` (see
// app/api/experience/attachments/route.js's GET - it mints that url via
// signedAttachmentUrl for image/video kinds only, alongside the derived
// `kind` this function trusts rather than re-deriving). Never throws and
// never lets one attachment's failure - most commonly an expired signed url,
// since these are short-lived by design - stop the others or the deck
// itself: pptxWriter.js's buildDeck already degrades an "image" slide with
// no entry in `images` to its caption-only text, so returning null here is
// exactly the fallback path, not a special case this file has to handle
// again downstream.
async function fetchImageBytes(attachment) {
  if (!attachment || attachment.kind !== "image" || !attachment.url) return null;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return { bytes: new Uint8Array(buf), mime: attachment.mime || "" };
  } catch {
    return null;
  }
}

// A single selected page names the deck after that page; more than one gets
// a generic count-based name, mirroring lib/document/docx.js's own
// "<Company> - <Position> - Resume.docx" fallback shape (a sanitized,
// human name rather than a raw id list).
function deckFileName(selectedPages) {
  if (selectedPages.length === 1) {
    const title = sanitizeFileNamePart(selectedPages[0]?.title || "").slice(0, 90);
    return `${title || "Untitled project"}.pptx`;
  }
  return `Project pages (${selectedPages.length}).pptx`;
}

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
// Research report (chunk 9) is wired below to POST /api/experience/research
// once per selected page (never the whole selection in one call - see
// RESEARCH_CONCURRENCY's comment). PowerPoint (chunk 10) composes the same
// three already-hardened layers - deckOutline.js turns { page, attachments }
// into an abstract slide outline, pptxWriter.js's buildDeck turns that
// outline plus an optional uploaded template into finished .pptx bytes,
// entirely client-side (jszip runs in the browser, the page data is already
// loaded, and the attachments route already returns everything the outline
// needs - no new API route). "One click" per this project's minimize-clicks
// directive: no dialog, no format picker, and the last template the user
// uploaded is reused silently rather than re-asked for.
//
// `onPagesChanged` is an optional callback, invoked once after a research
// batch finishes if at least one page succeeded, so a parent that owns the
// page list (ExperienceTab's useExperiencePages) can reload it and the new
// child pages show up in the tree without the user going to find them. This
// component only creates its own local per-click state - it does not (and
// cannot, without holding the page list itself) update `pages` in place.
export default function BulkActionsBar({ pages, selectedIds, onDeleteSelected, onMoveSelected, onPagesChanged }) {
  const [dialog, setDialog] = useState(null); // null | "delete" | "move"
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  // null before the first run; afterwards { running, results, refusal }.
  // `results` is a { [pageId]: { status: "pending"|"running"|"ok"|"error", message? } }
  // map, one entry per page that run targeted - the per-page success/failure
  // reporting this action's own AC requires, distinct from `dialogError`
  // above (delete/move's single shared error slot).
  const [research, setResearch] = useState(null);
  // null | { status: "generating" } | { status: "templateError", message } -
  // the third status is the ONLY one that renders a caption after settling:
  // a plain success clears back to null (this action already has nothing
  // else to report - the download itself is the confirmation, same as
  // clicking "Move" fires and closes with no lingering banner).
  const [deck, setDeck] = useState(null);
  const [templateStatus, setTemplateStatus] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  const templateInputRef = useRef(null);
  // Whether ImportToLibraryDialog (a sibling chunk) is open. No per-run
  // status lives here - the dialog owns its own import progress/results,
  // the same division of labour PowerPoint's `deck` state above does NOT
  // have (that one has to report back to THIS bar because it has no dialog
  // of its own); this action always has one.
  const [libraryOpen, setLibraryOpen] = useState(false);

  const summary = selectionSummary(pages, selectedIds);
  if (summary.selected === 0) return null;

  const ids = [...selectedIds].filter((id) => (pages || []).some((p) => p.id === id));
  const targets = bulkMoveTargets(pages, selectedIds);
  const moveBlocked = targets.length === 0;
  const researchRunning = !!research?.running;
  const deckRunning = deck?.status === "generating";

  // The real selected ROWS (body, generated_kind and all - see
  // useExperiencePages.js's listPages, which already selects "*"), not just
  // their ids - fragmentsFromPages needs generated_kind to enforce its own
  // exclusion rule, and needs body to have anything to mine at all. Computed
  // eagerly (fragmentsFromPages is pure and cheap) so the button itself can
  // reflect whether the CURRENT selection has any candidate material, the
  // same aria-disabled-with-a-reason pattern Move already uses above.
  const librarySelectedPages = ids.map((id) => pages.find((p) => p.id === id)).filter(Boolean);
  const libraryFragments = fragmentsFromPages(librarySelectedPages);
  const libraryBlocked = libraryFragments.length === 0;

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

  // One page, one request - see this file's own RESEARCH_CONCURRENCY
  // comment for why the whole selection is never sent in a single call.
  // Never throws: runWithConcurrency below treats a thrown worker as a
  // silent per-item failure, which would report this page as neither
  // succeeded nor failed - so every path here, including a network
  // exception, resolves into an explicit result entry instead.
  async function researchOne(pageId) {
    setResearch((prev) => ({ ...prev, results: { ...prev.results, [pageId]: { status: "running" } } }));
    let result;
    try {
      const res = await fetch("/api/experience/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, engine: readEngine() }),
      });
      const json = await res.json().catch(() => ({}));
      result = res.ok
        ? { status: "ok" }
        : { status: "error", message: json?.error || "Research failed. Please try again." };
    } catch (err) {
      result = { status: "error", message: err?.message || "Research failed. Please try again." };
    }
    setResearch((prev) => ({ ...prev, results: { ...prev.results, [pageId]: result } }));
  }

  // Generates immediately on the first click (no dialog - generating a
  // report is not destructive, see this project's own "minimize clicks"
  // directive) and cannot be double-fired: a click while `researchRunning`
  // is already true is a no-op, both here and at the button's own
  // aria-disabled below.
  async function handleResearchSelected() {
    if (researchRunning || ids.length === 0) return;

    // The embedded engine has no offline equivalent for a search-grounded
    // report (every OTHER AI feature in this app has a deterministic local
    // path; this one genuinely cannot). Checked client-side first so an
    // explicit "Embedded (no AI)" choice refuses instantly with zero
    // requests, rather than firing N requests that would each 503 the same
    // way - the route re-checks this itself regardless (defense in depth,
    // and the only check that matters for any OTHER caller of the route).
    if (wantsEmbedded(readEngine())) {
      setResearch({
        running: false,
        results: null,
        refusal: "A research report needs the Gemini engine. Switch off the embedded engine in Settings and try again.",
      });
      return;
    }

    setResearch({
      running: true,
      results: Object.fromEntries(ids.map((id) => [id, { status: "pending" }])),
      refusal: "",
    });
    await runWithConcurrency(ids, RESEARCH_CONCURRENCY, researchOne);
    setResearch((prev) => ({ ...prev, running: false }));
    onPagesChanged?.();
  }

  // The text next to the button: the refusal, or live per-page progress
  // while running, or a post-run summary naming how many succeeded and, if
  // any failed, the first failure's own reason - never a bare "failed",
  // and never silence about a partial failure. `null` (not the empty
  // string) means nothing to show, which is what keeps the caption/
  // aria-describedby pairing off entirely before the first click.
  function researchCaptionText() {
    if (!research) return null;
    if (research.refusal) return research.refusal;
    const values = Object.values(research.results || {});
    if (research.running) {
      const done = values.filter((r) => r.status === "ok" || r.status === "error").length;
      return `Researching… ${done} of ${values.length} done.`;
    }
    const okCount = values.filter((r) => r.status === "ok").length;
    const failed = values.filter((r) => r.status === "error");
    if (failed.length === 0) {
      return `${okCount} report${okCount === 1 ? "" : "s"} generated.`;
    }
    return `${okCount} generated, ${failed.length} failed: ${failed[0].message || "Research failed."}`;
  }

  const researchCaption = researchCaptionText();

  // Generates and downloads on the SAME click, no dialog and no format
  // picker (this project's minimize-clicks directive - "generating a
  // document is not destructive"), and cannot be double-fired the same way
  // Research report above cannot: a click while `deckRunning` is already
  // true is a no-op, both here and at the button's own aria-disabled below.
  //
  // `skipTemplate` is only ever true for the "Generate without it" retry
  // offered after a stored template fails to read - see the templateError
  // branch below. It is never something the FIRST click can request; the
  // remembered template is always tried first, silently, exactly per this
  // action's own AC.
  async function generateDeck({ skipTemplate = false } = {}) {
    if (deckRunning || ids.length === 0) return;
    setDeck({ status: "generating" });

    const selectedPages = ids.map((id) => pages.find((p) => p.id === id)).filter(Boolean);
    const attachmentsByPage = await Promise.all(ids.map((id) => fetchPageAttachments(id)));
    const entries = selectedPages.map((page, i) => ({ page, attachments: attachmentsByPage[i] }));
    const outline = outlineFromPages(entries);

    // Every image attachment across every selected page, fetched
    // IMAGE_FETCH_CONCURRENCY at a time (same runner, same cap, as the
    // research action above) into the `attachmentId -> bytes` map
    // pptxWriter.js's buildDeck needs to actually embed a picture rather
    // than just naming it. A page with no image attachments costs nothing
    // extra here - runWithConcurrency on an empty list resolves immediately.
    const imageAttachments = attachmentsByPage.flat().filter((a) => a && a.kind === "image" && a.id);
    const images = {};
    await runWithConcurrency(imageAttachments, IMAGE_FETCH_CONCURRENCY, async (attachment) => {
      const result = await fetchImageBytes(attachment);
      if (result) images[attachment.id] = result;
    });

    let templateBytes = null;
    let templateName = null;
    if (!skipTemplate) {
      const stored = await fetchDeckTemplate();
      if (stored?.blob) {
        templateBytes = new Uint8Array(await stored.blob.arrayBuffer());
        templateName = stored.name;
      }
    }

    try {
      const bytes = await buildDeck({
        outline,
        template: templateBytes,
        templateFileName: templateName || undefined,
        images,
      });
      const blob = new Blob([bytes], { type: PPTX_MIME });
      triggerBlobDownload(blob, deckFileName(selectedPages));
      setDeck(null);
    } catch (err) {
      // buildDeck rejects for exactly one reason: a SUPPLIED template that
      // could not be read as a usable PowerPoint file (never for "no
      // template" - that resolves to the built-in skeleton instead, see
      // pptxWriter.js). Reported by name, offering "Generate without it"
      // below rather than silently retrying without the template - a quiet
      // fallback would hand back an off-brand deck the user presents
      // believing it followed their own template.
      setDeck({
        status: "templateError",
        message: err?.message || `Could not read "${templateName || "the template"}".`,
      });
    }
  }

  function deckCaptionText() {
    if (!deck) return null;
    if (deck.status === "generating") return "Generating PowerPoint…";
    if (deck.status === "templateError") return deck.message;
    return null;
  }

  const deckCaption = deckCaptionText();

  function openTemplatePicker() {
    if (templateInputRef.current) templateInputRef.current.click();
  }

  async function handleTemplateFileChosen(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = ""; // lets the same file be re-chosen later
    if (!file) return;
    setTemplateBusy(true);
    const result = await uploadDeckTemplate(file);
    setTemplateBusy(false);
    setTemplateStatus(result.error ? result.error : `Template saved: ${result.name}.`);
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

          <Button
            variant="outlined"
            size="small"
            aria-disabled={researchRunning || undefined}
            aria-describedby={researchCaption ? RESEARCH_CAPTION_ID : undefined}
            onClick={() => {
              if (researchRunning) return;
              handleResearchSelected();
            }}
            sx={{ textTransform: "none", ...(researchRunning ? DISABLED_LOOK_SX : {}) }}
          >
            Research report
          </Button>

          <Button
            variant="outlined"
            size="small"
            aria-disabled={deckRunning || undefined}
            aria-describedby={deckCaption ? DECK_CAPTION_ID : undefined}
            onClick={() => {
              if (deckRunning) return;
              generateDeck();
            }}
            sx={{ textTransform: "none", ...(deckRunning ? DISABLED_LOOK_SX : {}) }}
          >
            PowerPoint
          </Button>

          {/* Opens ImportToLibraryDialog over the current selection's
              candidate fragments (lib/experience/tailorSources.js). A
              resume bullet goes out under the user's name, so - unlike
              every other action on this bar - this one always stops at a
              review dialog rather than firing on the first click; see that
              dialog's own header comment for why that friction is
              deliberate here specifically. */}
          <Button
            variant="outlined"
            size="small"
            aria-disabled={libraryBlocked || undefined}
            aria-describedby={libraryBlocked ? LIBRARY_CAPTION_ID : undefined}
            onClick={() => {
              if (libraryBlocked) return;
              setLibraryOpen(true);
            }}
            sx={{ textTransform: "none", ...(libraryBlocked ? DISABLED_LOOK_SX : {}) }}
          >
            Add to library
          </Button>

          {/* Changing the template is its OWN secondary control, never a
              step the "PowerPoint" click above makes the user pass through
              - the last uploaded template (lib/experience/deckTemplateStore.js)
              is remembered and reused silently. A plain <input type="file">
              driven by this button, same shape as the hidden trigger any
              native file picker needs. */}
          <Button
            variant="text"
            size="small"
            aria-disabled={templateBusy || undefined}
            aria-describedby={templateStatus ? TEMPLATE_CAPTION_ID : undefined}
            onClick={() => {
              if (templateBusy) return;
              openTemplatePicker();
            }}
            sx={{ textTransform: "none", minWidth: 0, fontSize: 12.5, color: "var(--text-secondary)" }}
          >
            {templateBusy ? "Uploading template…" : "Template"}
          </Button>
          <input
            ref={templateInputRef}
            type="file"
            accept=".pptx,.potx,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.presentationml.template"
            style={{ display: "none" }}
            onChange={handleTemplateFileChosen}
          />
        </Stack>

        {moveBlocked ? (
          <Typography id={MOVE_CAPTION_ID} sx={{ fontSize: "0.72rem", color: "var(--text-muted)", width: 1 }}>
            No destination fits every selected page.
          </Typography>
        ) : null}
        {libraryBlocked ? (
          <Typography id={LIBRARY_CAPTION_ID} sx={{ fontSize: "0.72rem", color: "var(--text-muted)", width: 1 }}>
            No accomplishment lines found in the selected pages.
          </Typography>
        ) : null}
        {researchCaption ? (
          <Typography
            id={RESEARCH_CAPTION_ID}
            role="status"
            aria-live="polite"
            sx={{ fontSize: "0.72rem", color: "var(--text-muted)", width: 1 }}
          >
            {researchCaption}
          </Typography>
        ) : null}
        {deckCaption ? (
          <Typography
            id={DECK_CAPTION_ID}
            role="status"
            aria-live="polite"
            sx={{ fontSize: "0.72rem", color: "var(--text-muted)", width: 1 }}
          >
            {deckCaption}
            {deck?.status === "templateError" ? (
              <Button
                size="small"
                onClick={() => {
                  if (deckRunning) return;
                  generateDeck({ skipTemplate: true });
                }}
                sx={{ textTransform: "none", ml: 1, fontSize: "0.72rem", p: 0, minWidth: 0 }}
              >
                Generate without it
              </Button>
            ) : null}
          </Typography>
        ) : null}
        {templateStatus ? (
          <Typography
            id={TEMPLATE_CAPTION_ID}
            role="status"
            aria-live="polite"
            sx={{ fontSize: "0.72rem", color: "var(--text-muted)", width: 1 }}
          >
            {templateStatus}
          </Typography>
        ) : null}
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

      {/* Re-keyed on the selection itself so opening this dialog on a NEW
          selection always starts from a clean review (every fragment
          checked, no stale import results from a previous selection) - the
          same key-driven reset LibraryEditor.js already uses for ProfileTab,
          rather than an effect that has to be told to ignore `fragments`
          changing identity on every render. */}
      <ImportToLibraryDialog
        key={ids.slice().sort().join(",")}
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        fragments={libraryFragments}
      />
    </>
  );
}
