"use client";

import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { revokeAttachmentPreview } from "@/lib/chat/chatbot";

// N123: the attachment chips and the attach error, as one strip in the panel body
// directly above the composer dock (the dock never holds them, so adding a file does
// not move the controls the user is about to use). It shrinks before the dock does,
// is capped, and scrolls inside itself, so a pile of chips cannot take the thread's
// height. Renders nothing when there is neither a chip nor an error.
//
//   files        the tray (`chatAttachedFiles`)
//   setFiles     its functional setter (`setChatAttachedFiles`)
//   attachError  the refusal text for the last add, or ""
const STRIP_SX = {
  flex: "0 1 auto",
  minHeight: 0,
  maxHeight: 120,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 0.5,
  px: 1,
  py: 0.5,
  borderTop: "1px solid var(--border)",
  backgroundColor: "var(--bg-surface)",
};

export default function ChatAttachmentStrip({ files, setFiles, attachError }) {
  if (files.length === 0 && !attachError) return null;
  return (
    <Box sx={STRIP_SX}>
      {files.length > 0 ? (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {files.map((f, i) => {
            // AC-27b: the refusal names this control as the remedy, so it
            // has to be OPERABLE, not just present. Shipped as a bare
            // `onDelete`, MUI binds only `isDeleteKeyboardEvent`
            // (Backspace/Delete) to it -- Enter and Space, ButtonBase's own
            // keys, have no `onClick` to call, so they do nothing, and the
            // real ✕ (`MuiChip-deleteIcon`) is `aria-hidden` with no name
            // and no tab stop of its own: mouse-only. `onClick` running the
            // SAME removal makes ButtonBase's Enter/Space path fire it too,
            // and `aria-label` gives the root a name that says what
            // activating it does (SC 4.1.2) while still containing the
            // visible label, the file name (SC 2.5.3). Backspace/Delete via
            // `onDelete` stay wired -- this ADDS keys, it does not swap
            // them. Deliberately NOT a real `<button>` inside `deleteIcon`:
            // the chip root is already a ButtonBase, and a button nested in
            // a button is invalid markup no AT handles predictably.
            const removeThisAttachment = () => {
              // M6: revoke this chip's own preview blob URL before it's
              // dropped from the tray.
              revokeAttachmentPreview(f);
              setFiles((prev) => prev.filter((_, idx) => idx !== i));
            };
            return (
              <Chip
                key={`${f.name}-${i}`}
                size="small"
                label={f.name}
                avatar={f.previewUrl ? <Avatar src={f.previewUrl} alt="" variant="rounded" /> : undefined}
                onDelete={removeThisAttachment}
                onClick={removeThisAttachment}
                aria-label={`Remove ${f.name}`}
                sx={{ maxWidth: 220 }}
              />
            );
          })}
        </Box>
      ) : null}
      {attachError ? (
        <Box sx={{ fontSize: 12, color: "var(--danger)" }}>
          {attachError}
        </Box>
      ) : null}
    </Box>
  );
}
