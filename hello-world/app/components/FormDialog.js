"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import { useIsMobile } from "../hooks/useResponsive";
import { TOUCH_ICON_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";
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
}) {
  const isMobile = useIsMobile();

  // A busy save must still be escapable -- only the submit itself stays
  // blocked (see handleSubmit). `allowCloseWhileBusy` used to gate this and
  // had zero callers repo-wide, which meant every dialog's busy state was an
  // inescapable trap on a fullScreen phone (no backdrop, no Escape key). The
  // gate is gone rather than defaulted differently so nothing can bring the
  // trap back.
  const requestClose = () => {
    onClose?.();
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy || submitDisabled) return;
    onSubmit?.();
  };

  return (
    <Dialog open={open} onClose={requestClose} maxWidth={maxWidth} fullWidth={fullWidth} fullScreen={isMobile}>
      {/* This wrapper sits between the Paper and title/content/actions, so it
          must keep being the Paper's flex column itself -- a plain block here
          gives DialogContent's own `flex:1 1 auto` nothing to grow against,
          and the Paper scrolls in its place instead. `minHeight: 0` is the
          part that is easy to drop and breaks everything if you do: without
          it a flex child won't shrink below its content height, so the
          overflow this exists for never engages. */}
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}
      >
        {title != null || isMobile ? (
          // Rendered whenever there IS a title, OR we are fullScreen -- even
          // with no title, a phone dialog has no backdrop pixel to tap and no
          // Escape key, so the close control below cannot be conditioned on
          // `title` without reopening exactly the trap this file exists to
          // close for a future titleless caller. Desktop keeps skipping this
          // block entirely when there is no title: it already has a backdrop
          // and Escape, so an empty title bar would add nothing.
          //
          // `component` is forced to "div" in the no-title case. MUI's
          // DialogTitle otherwise always renders an <h2> (DialogTitle.js
          // hardcodes `component: "h2"`, which a caller's own `component`
          // prop overrides), and with no title text the only content left
          // inside it is the close IconButton below -- an <h2> with nothing
          // but a button in it is an empty/malformed heading (axe's
          // empty-heading rule), not a real title. `.MuiDialogTitle-root`'s
          // class and styling are unaffected either way; only the tag changes.
          <DialogTitle
            component={title != null ? "h2" : "div"}
            sx={{ position: "relative", pr: isMobile ? 7 : undefined }}
          >
            {title}
            {/* fullScreen (phone) leaves no backdrop pixel to tap and no
                Escape key, so this is the only pointer-reachable exit. */}
            {isMobile ? (
              <IconButton
                aria-label="Close"
                onClick={requestClose}
                sx={{ position: "absolute", right: 8, top: 8, color: "var(--text-secondary)", ...TOUCH_ICON_SX }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            ) : null}
          </DialogTitle>
        ) : null}
        <DialogContent dividers={dividers} sx={contentSx}>
          {children}
          <FieldError sx={{ mt: 1.5 }}>{error}</FieldError>
        </DialogContent>
        {actions !== undefined ? (
          actions ? (
            <DialogActions sx={{ ...WRAP_ROW_SX, ...actionsSx }}>{actions}</DialogActions>
          ) : null
        ) : (
          // `WRAP_ROW_SX` is spread before `actionsSx` so a caller's own value
          // (SlotReviewDialog) always wins. It carries `rowGap` as well as
          // `flexWrap`: MUI's DialogActions only spaces items horizontally
          // (`marginLeft: 8` between siblings), so a wrapped second row would
          // otherwise sit flush against the first -- and with the app-wide
          // focus ring, adjacent buttons' rings would bleed into each other.
          <DialogActions sx={{ ...WRAP_ROW_SX, ...actionsSx }}>
            {/* Cancel must stay enabled while busy -- see the comment above:
                Escape, the backdrop and the phone close control all already
                work while busy, so a greyed-out Cancel beside them is the
                one visible affordance saying "you cannot leave" while three
                invisible routes say otherwise. */}
            <Button onClick={requestClose}>{cancelLabel}</Button>
            <Button type="submit" variant="contained" disabled={busy || submitDisabled}>
              {busy ? busyLabel : submitLabel}
            </Button>
          </DialogActions>
        )}
      </Box>
    </Dialog>
  );
}
