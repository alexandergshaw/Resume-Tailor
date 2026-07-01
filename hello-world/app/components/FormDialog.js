"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useIsMobile } from "../hooks/useResponsive";
import FieldError from "./FieldError";

// Shared scaffold for the app's form dialogs: a full-width dialog (fullscreen on
// mobile) with a title, a divided content area, an inline error, and a
// Cancel / primary-action footer. The body is wrapped in a <form> so Enter
// submits. Pass `actions` to fully replace the default footer.
export default function FormDialog({
  open,
  onClose,
  title,
  maxWidth = "sm",
  fullWidth = true,
  children,
  error = "",
  busy = false,
  onSubmit,
  submitLabel = "Save",
  busyLabel = "Saving…",
  submitDisabled = false,
  cancelLabel = "Cancel",
  contentSx,
  actionsSx,
  dividers = true,
  actions,
  allowCloseWhileBusy = false,
}) {
  const isMobile = useIsMobile();

  const requestClose = () => {
    if (busy && !allowCloseWhileBusy) return;
    onClose?.();
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy || submitDisabled) return;
    onSubmit?.();
  };

  return (
    <Dialog open={open} onClose={requestClose} maxWidth={maxWidth} fullWidth={fullWidth} fullScreen={isMobile}>
      <Box component="form" onSubmit={handleSubmit}>
        {title != null ? <DialogTitle>{title}</DialogTitle> : null}
        <DialogContent dividers={dividers} sx={contentSx}>
          {children}
          <FieldError sx={{ mt: 1.5 }}>{error}</FieldError>
        </DialogContent>
        {actions !== undefined ? (
          actions ? <DialogActions sx={actionsSx}>{actions}</DialogActions> : null
        ) : (
          <DialogActions sx={actionsSx}>
            <Button onClick={requestClose} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant="contained" disabled={busy || submitDisabled}>
              {busy ? busyLabel : submitLabel}
            </Button>
          </DialogActions>
        )}
      </Box>
    </Dialog>
  );
}
