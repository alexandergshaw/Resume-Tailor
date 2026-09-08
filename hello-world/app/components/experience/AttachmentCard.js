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
import FolderZipIcon from "@mui/icons-material/FolderZip";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import TableChartIcon from "@mui/icons-material/TableChart";
import { TOUCH_FIELD_SX, TOUCH_ICON_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

const KIND_LABEL = {
  image: "Image",
  pdf: "PDF",
  video: "Video",
  text: "Text",
  slides: "Slides",
  sheet: "Spreadsheet",
  archive: "Archive",
  other: "File",
};

// The image/video preview. `width: 1` is 100% OF ITS BOX (a bare number at or
// below 1 is a multiplier in `sx`), which is 96px above `sm` and the full card
// width on a phone.
//
// The height cap exists only on the phone branch, where the box got wide: a
// phone camera shoots portrait, so an unbounded 9:16 capture at ~311px wide is
// ~550px tall and pushes the notes field - the only part of a video the
// tailoring engine ever reads - off the bottom of the screen. `objectFit:
// "contain"` is what makes the cap safe: without it the browser would squash
// the frame to fit rather than letterbox it. Both `sm` branches are the
// property's own initial value, so the 96px column above `sm` is unchanged.
const MEDIA_SX = {
  width: 1,
  borderRadius: 1,
  display: "block",
  maxHeight: { xs: 220, sm: "none" },
  objectFit: { xs: "contain", sm: "fill" },
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
        {/* COLUMN on a phone. As a row this spent 96 (thumbnail) + ~30 + ~30
            (two icon buttons) + three 16px gaps = ~204px of a ~237px card
            interior at 375, leaving the filename, the kind/size line, the
            notes field and up to three error Alerts about 33px between them.
            At 320 the fixed items exceed the interior outright and
            `html { overflow-x: hidden }` deletes the excess rather than
            offering it. Above `sm` the shipped row is unchanged. */}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
          {/* FULL WIDTH on a phone, the shipped 96px column above `sm`.
              Nothing sits beside the media once the card is a column, so the
              96px that was stealing width from the content no longer buys
              anything - and 56px (the narrower thumbnail this fix first used)
              would be actively worse: a `<video controls>` at 56px has no
              room for its own play button, and shooting a demo on a phone and
              describing it here is the most phone-first action on this
              surface. The img/video inside is `width: 1` (100% of THIS box),
              so both follow it without a breakpoint of their own. */}
          <Box sx={{ width: { xs: "100%", sm: 96 }, flexShrink: 0 }}>
            {attachment.kind === "image" && attachment.url && (
              <Box
                component="img"
                src={attachment.url}
                alt={attachment.notes || attachment.name}
                sx={{ ...MEDIA_SX }}
              />
            )}
            {attachment.kind === "video" && attachment.url && (
              <Box
                component="video"
                controls
                src={attachment.url}
                aria-label={attachment.notes || attachment.name}
                sx={{ ...MEDIA_SX }}
              />
            )}
            {/* Slides/sheet/archive get their own icon, distinct from each other and
                from the generic InsertDriveFileIcon every other non-preview kind
                still falls back to — the text label just below already says the
                kind, so none of these icons needs (or gets) an aria-hidden-defeating
                titleAccess. */}
            {attachment.kind === "slides" && <SlideshowIcon fontSize="large" color="action" />}
            {attachment.kind === "sheet" && <TableChartIcon fontSize="large" color="action" />}
            {attachment.kind === "archive" && <FolderZipIcon fontSize="large" color="action" />}
            {(attachment.kind !== "image" &&
              attachment.kind !== "video" &&
              attachment.kind !== "slides" &&
              attachment.kind !== "sheet" &&
              attachment.kind !== "archive") && (
              <InsertDriveFileIcon fontSize="large" color="action" />
            )}
          </Box>
          {/* `alignItems: "flex-start"` on the Stack makes a COLUMN child
              shrink to its content, so this needs an explicit full width on a
              phone or the notes field would size itself to the filename. In
              the `sm` row it is a flex item again and `auto` is its own
              initial value. */}
          <Box sx={{ flexGrow: 1, minWidth: 0, width: { xs: "100%", sm: "auto" } }}>
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
              // For a VIDEO attachment this field is the only description the
              // tailoring engine ever sees (video bytes are never forwarded -
              // see AttachmentPanel.js), and uploading from a camera roll is
              // a phone-first action. It has to be comfortably tappable.
              sx={TOUCH_FIELD_SX}
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
                    sx={TOUCH_TARGET_SX}
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
                  <Button color="inherit" size="small" sx={TOUCH_TARGET_SX} onClick={() => onRetryDelete(attachment)}>
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
                  <Button color="inherit" size="small" sx={TOUCH_TARGET_SX} onClick={() => onRetryDownload(attachment)}>
                    Retry
                  </Button>
                }
              >
                {downloadErrorText}
              </Alert>
            )}
          </Box>
          {/* The two buttons share a wrapper rather than being two direct
              Stack children, so that in the phone COLUMN they form one
              trailing-aligned row under the notes field instead of two
              full-width rows of their own. In the `sm` row the wrapper's own
              16px gap reproduces exactly the `spacing={2}` these two used to
              get from the Stack, so desktop geometry is unchanged. */}
          <Box
            sx={{
              display: "flex",
              flexShrink: 0,
              gap: 2,
              alignSelf: { xs: "flex-end", sm: "flex-start" },
            }}
          >
            <IconButton
              ref={downloadButtonRef}
              aria-label={`Download ${attachment.name}`}
              onClick={() => onDownload(attachment)}
              size="small"
              sx={TOUCH_ICON_SX}
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
              sx={TOUCH_ICON_SX}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
