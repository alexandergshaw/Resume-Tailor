"use client";

// AC-C6/AC-C9/AC-C10: the single "Copy text" control shown on every tab of the
// preview dialog. Owns the click handler, the enable-gate refusal, the
// click-time blank-document refusal, and the call into writePlainText -- and
// OWNS NO STRING of its own (every message comes from ./copyOutcome.js). Knows
// nothing of the dialog's in-flight flags, docState, scopes, or drive -- those
// stay in the dialog.
import { useRef } from "react";
import Button from "@mui/material/Button";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { writePlainText } from "@/lib/clipboard/plainText";
import { copyOutcome, disabledOutcome } from "./copyOutcome";

// The exact literal used at DriveActions.js (x2) and DriveOverwriteDialog.js's
// TOUCH_SX -- retyped rather than imported, since that constant is module-
// local there and not exported.
const TOUCH_TARGET_SX = { xs: "44px", sm: "36px" };

export default function CopyDocumentControl({ getText, copyState, scopeLabel, accessibleName, variant, mode, onOutcome, label = "Copy text" }) {
  // O-7: a monotonic counter, not a `useState` (which would re-render mid-
  // copy for no reason) -- only the NEWEST activation's outcome is ever
  // announced, so a slow permission prompt from an earlier click can never
  // overwrite what the user is already reading.
  const tokenRef = useRef(0);
  const disabled = copyState !== "ready";

  // O-10: the click handler's first three statements capture everything the
  // async tail needs, so nothing after the `await` reads a prop or a ref --
  // that is what keeps AC-C2's label snapshot true even if the tab changes,
  // and what keeps a stale earlier activation from emitting through a NEWER
  // render's callback.
  const handleClick = async () => {
    const seq = ++tokenRef.current;
    const label_ = scopeLabel;
    const emit = onOutcome;

    if (disabled) {
      emit(disabledOutcome(copyState, label_));
      return;
    }
    // AC-C10.1: refused at CLICK time, in BOTH modes -- never part of the
    // enable gate, so an available-but-blank scope (an entry whose lines are
    // ["",""]) still renders an enabled control rather than a dead one.
    // `.trim()`, not `.length` -- a whitespace-only document must be refused
    // too, or the user pastes nothing but blank lines into an ATS field.
    const text = String((typeof getText === "function" ? getText() : "") ?? "");
    if (text.trim().length === 0) {
      emit(copyOutcome({ ok: false, reason: "empty" }, label_));
      return;
    }

    const result = await writePlainText(text, { mode });
    if (tokenRef.current !== seq) return; // a newer activation already reported
    emit(copyOutcome(result, label_));
  };

  return (
    <Button
      type="button"
      variant={variant}
      startIcon={<ContentCopyIcon />}
      aria-disabled={disabled}
      aria-label={accessibleName}
      // The focus guard (AC-C4): a POINTER activation must never take focus
      // away from an editor mid-edit, or its blur-triggered auto-save would
      // fire. Carries ONLY preventDefault -- the action itself is on
      // onClick, and no handler is wired to any key event, so Enter/Space
      // (which a native button already turns into a synthesized click) can
      // never fire it twice.
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleClick}
      sx={{
        minHeight: TOUCH_TARGET_SX,
        "&:focus-visible": { outline: "2px solid var(--accent)", outlineOffset: "2px" },
        ...(disabled ? { opacity: 0.5 } : null),
      }}
    >
      {label}
    </Button>
  );
}
