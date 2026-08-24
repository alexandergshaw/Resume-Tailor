"use client";

// One attachment's card, extracted out of AttachmentPanel.js's own
// attachments.map(...) — the panel is pinned under a 1000-line ceiling and a
// focus fix lands there next, so this card had to come out first. Pure
// extraction: this component owns no state of its own, only the
// already-resolved props the panel hands it below.
//
// notesErrorText/deleteErrorText/downloadErrorText arrive as plain, already-
// announced STRINGS, not the panel's own { text, seq } objects —
// announcedText's toggle logic (see AttachmentPanel.js) stays in the panel,
// which is why this file never imports it. An empty string means "no
// alert"; each Alert below renders only when its string is non-empty.

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import TableChartIcon from "@mui/icons-material/TableChart";

const KIND_LABEL = {
  image: "Image",
  pdf: "PDF",
  video: "Video",
  text: "Text",
  slides: "Slides",
  sheet: "Spreadsheet",
  other: "File",
};

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentCard({
  attachment,
  downloading,
  notesErrorText,
  deleteErrorText,
  downloadErrorText,
  onNotesInput,
  onSaveNotes,
  onRetryNotes,
  onDownload,
  onRetryDownload,
  onDelete,
  onRetryDelete,
  notesFieldRef,
  downloadButtonRef,
  deleteButtonRef,
}) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
          <Box sx={{ width: 96, flexShrink: 0 }}>
            {attachment.kind === "image" && attachment.url && (
              <Box
                component="img"
                src={attachment.url}
                alt={attachment.notes || attachment.name}
                sx={{ width: 1, borderRadius: 1, display: "block" }}
              />
            )}
            {attachment.kind === "video" && attachment.url && (
              <Box
                component="video"
                controls
                src={attachment.url}
                aria-label={attachment.notes || attachment.name}
                sx={{ width: 1, borderRadius: 1, display: "block" }}
              />
            )}
            {/* Slides/sheet get their own icon, distinct from each other and from
                the generic InsertDriveFileIcon every other non-preview kind still
                falls back to — the text label just below already says the kind, so
                neither icon needs (or gets) an aria-hidden-defeating titleAccess. */}
            {attachment.kind === "slides" && <SlideshowIcon fontSize="large" color="action" />}
            {attachment.kind === "sheet" && <TableChartIcon fontSize="large" color="action" />}
            {(attachment.kind !== "image" &&
              attachment.kind !== "video" &&
              attachment.kind !== "slides" &&
              attachment.kind !== "sheet") && (
              <InsertDriveFileIcon fontSize="large" color="action" />
            )}
          </Box>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
              {attachment.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {KIND_LABEL[attachment.kind] || "File"}
              {formatBytes(attachment.bytes) ? ` • ${formatBytes(attachment.bytes)}` : ""}
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={1}
              size="small"
              margin="dense"
              label="Notes for the AI"
              // The visible floating label stays identical for every
              // card on purpose (it's the field's PURPOSE, and that is
              // the same everywhere) — the accessible name is what has
              // to be distinct, since it's what a screen reader's
              // form-field list shows in place of visible position.
              // slotProps.htmlInput is MUI's documented way to reach
              // the underlying <textarea> itself, matching
              // JobDescriptionTab.js's own reasoning: a plain
              // aria-label prop on TextField would land on the root
              // FormControl, not the field an AT is actually focused
              // on.
              slotProps={{ htmlInput: { "aria-label": `Notes for the AI for ${attachment.name}` } }}
              inputRef={notesFieldRef}
              value={attachment.notes || ""}
              onChange={(event) => onNotesInput(attachment.id, event.target.value)}
              onBlur={(event) => onSaveNotes(attachment.id, attachment.name, event.target.value)}
            />
            {notesErrorText && (
              <Alert
                severity="error"
                sx={{ mt: 0.5 }}
                action={
                  // onRetryNotes, not onSaveNotes — same PATCH, but this is
                  // the one path that also has to move focus (see
                  // AttachmentPanel.js's pendingFocus): an ordinary onBlur
                  // save must never do that, or it would fight the user for
                  // the caret every time they simply leave the field.
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => onRetryNotes(attachment.id, attachment.name, attachment.notes || "")}
                  >
                    Retry
                  </Button>
                }
              >
                {notesErrorText}
              </Alert>
            )}
            {deleteErrorText && (
              <Alert
                severity="error"
                sx={{ mt: 0.5 }}
                action={
                  <Button color="inherit" size="small" onClick={() => onRetryDelete(attachment)}>
                    Retry
                  </Button>
                }
              >
                {deleteErrorText}
              </Alert>
            )}
            {downloadErrorText && (
              <Alert
                severity="error"
                sx={{ mt: 0.5 }}
                action={
                  // onRetryDownload, not onDownload — same download, but see
                  // onRetryNotes just above for why the Retry path alone
                  // moves focus.
                  <Button color="inherit" size="small" onClick={() => onRetryDownload(attachment)}>
                    Retry
                  </Button>
                }
              >
                {downloadErrorText}
              </Alert>
            )}
          </Box>
          <IconButton
            ref={downloadButtonRef}
            aria-label={`Download ${attachment.name}`}
            onClick={() => onDownload(attachment)}
            size="small"
            // Never disabled and never pulled out of the tab order —
            // see downloadingRef's own comment: the button that
            // vanishes from tab order the moment it's used is a bug
            // this repo has already shipped once. aria-busy plus the
            // spinner below is the whole in-flight signal.
            aria-busy={downloading ? "true" : undefined}
          >
            {downloading ? <CircularProgress size={16} /> : <DownloadIcon fontSize="small" />}
          </IconButton>
          <IconButton
            ref={deleteButtonRef}
            aria-label={`Delete ${attachment.name}`}
            onClick={() => onDelete(attachment)}
            size="small"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </CardContent>
    </Card>
  );
}
