"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  // Labels the title text ALONE (see the id split below `DialogTitle` for
  // why) -- stable for the component instance's lifetime, SSR-safe.
  const titleId = useId();

  // A busy save must still be escapable -- only the submit itself stays
  // blocked (see handleSubmit). `allowCloseWhileBusy` used to gate this and
  // had zero callers repo-wide, which meant every dialog's busy state was an
  // inescapable trap on a fullScreen phone (no backdrop, no Escape key). The
  // gate is gone rather than defaulted differently so nothing can bring the
  // trap back.
  //
  // But an UNCONDITIONAL close creates a different trap of its own. Every
  // real caller's own `onClose` reacts to Escape/backdrop/Cancel by setting
  // its `open` state to false regardless of `busy` (AddAppDialog.js,
  // EditAppDialog.js, StageDialog.js, AddCommunicationDialog.js,
  // experience/BulkActionsBar.js's bulk-delete confirm all do this). That is
  // right for a save that SUCCEEDS after the user leaves. It is wrong for
  // one that FAILS: the caller's async handler still calls its own
  // `setXError(message)` once the request settles, but by then this dialog
  // has already unmounted, so that error's only display (the FieldError
  // below, fed by `error`) never shows. The user sees nothing and believes
  // the save went through.
  //
  // `closedWhileBusyRef` remembers a close requested while `busy`; if `busy`
  // later clears with a non-empty `error` -- the failure the exit outran --
  // `reopenForError` brings the dialog back so that failure is not silently
  // lost. A successful save clears `error` before it finishes (every real
  // caller does), so a completed save never re-triggers this. This does NOT
  // reintroduce a busy lock: Escape/backdrop/Cancel still close the dialog
  // the instant they fire, exactly as before -- only a FAILURE that arrives
  // afterward brings it back.
  const closedWhileBusyRef = useRef(false);
  const [reopenForError, setReopenForError] = useState(false);

  useEffect(() => {
    // A genuine open (the parent, not this reopen mechanism, set `open`
    // true) always supersedes a stale reopen from a previous cycle -- see
    // `requestClose` below, which is the path that actually clears
    // `reopenForError` once the user dismisses it.
    if (open) {
      closedWhileBusyRef.current = false;
      return;
    }
    if (!busy && error && closedWhileBusyRef.current) {
      closedWhileBusyRef.current = false;
      setReopenForError(true);
    }
  }, [open, busy, error]);

  const requestClose = () => {
    if (busy) closedWhileBusyRef.current = true;
    setReopenForError(false);
    onClose?.();
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy || submitDisabled) return;
    onSubmit?.();
  };

  const effectiveOpen = open || reopenForError;

  return (
    <Dialog
      open={effectiveOpen}
      onClose={requestClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      fullScreen={isMobile}
      // Overrides MUI's own auto-generated `aria-labelledby` (Dialog.js's
      // `useId(ariaLabelledbyProp)`), which otherwise points at whatever
      // element ends up with `id={titleId}` -- DialogTitle itself, per
      // DialogTitle.js. That element also holds the close IconButton on a
      // phone (same title bar), so its "name from content" pulls in that
      // button's OWN accessible name too: "Add application" + "Close". This
      // points at the dedicated span around JUST the title text instead (see
      // below), and is blank when there is no title to label by (DialogTitle
      // then holds only the close button, which is correctly nameless on its
      // own -- there is nothing here to build a dialog name FROM).
      aria-labelledby={title != null ? titleId : ""}
    >
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
            // Deliberately NOT `titleId`: MUI's DialogContext would hand this
            // element that same id by default (Dialog's own `aria-labelledby`
            // and DialogTitle's `id` both resolve from the SAME context
            // value), which would put the close IconButton right back inside
            // the labelled element below. An explicit, different id here
            // breaks that link; nothing points at this one.
            id={`${titleId}-bar`}
            component={title != null ? "h2" : "div"}
            sx={{ position: "relative", pr: isMobile ? 7 : undefined }}
          >
            {/* The dialog's `aria-labelledby` (above) points at ONLY this
                span, not the whole title bar -- so the close button below,
                whose own name comes from `aria-label` rather than visible
                text, is never pulled into the dialog's computed name. */}
            {title != null ? <Box component="span" id={titleId}>{title}</Box> : null}
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
