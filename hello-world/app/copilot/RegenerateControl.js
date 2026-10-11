"use client";

import { useId, useState } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";

import { TOUCH_FIELD_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "@/app/theme/mobileSx";

// THE SHARED "REGENERATE" CONTROL for an expanded-detail region (ExpansionPanel,
// the tech-term detail in AnswerAids, ProjectBulletDetail). Presentational and
// store-agnostic: it knows nothing about which family it sits in, what the item's
// key is, or how a fetch is issued. The host decides WHEN to render it (open, not
// loading, not disabled) and wires `onRegenerate(context)` to its own hook; this
// file only owns the two controls and the one transient string the second one holds.
//
// IT WORKS WITH ZERO TYPING. The Regenerate button always fires, passing the
// context field's current text, which is "" until the reader opens the disclosure
// and types. The field is OPTIONAL steering, never a gate.
//
// THE CONTEXT LIVES IN LOCAL STATE ONLY. It is not written to any storage and it
// is not part of any store key: it rides one request and is gone on unmount. The
// disclosure is a local `useState`, deliberately NOT a CollapsibleAid, whose open
// state is a shared persistent choice (one choice moves every card on the page),
// which is wrong for a per-region, one-off input.
//
// THE FIELD'S BOUND IS A PROP (`maxChars`). Each host passes its own family's
// MAX_USER_CONTEXT_CHARS, so this module imports no contract and stays family-
// agnostic. The bound goes in through `slotProps.htmlInput`: in this repo's MUI the
// older `inputProps` does not carry `maxlength` to the DOM.
//
// MOBILE FIRST. The two buttons take TOUCH_TARGET_SX and the field TOUCH_FIELD_SX
// (both from the theme module, never the copilot shim); the button row wraps so
// "Regenerate" and "Add context" never squeeze below tap size, and the field is
// full width so it cannot overflow at the 320px floor. A collapsed disclosure adds
// one short row and no input.
//
// EVERY TOP-LEVEL NODE CARRIES `data-regenerate`, so a host test that wants "the
// model's detail text" removes the control by that one attribute (the
// `data-expansion` / `data-bullet-detail` precedent).

const REGENERATE_LABEL = "Regenerate";
const SHOW_CONTEXT_LABEL = "Add context";
const HIDE_CONTEXT_LABEL = "Hide context";
const FIELD_LABEL = "Context for this section";

const BUTTON_SX = { ...TOUCH_TARGET_SX, textTransform: "none" };

export default function RegenerateControl({ name, disabled, maxChars, onRegenerate }) {
  const [showContext, setShowContext] = useState(false);
  const [context, setContext] = useState("");
  const fieldId = useId();

  // The host already omits the control on the kill-switch state; this is the
  // belt-and-braces guard so the control can never be the thing that offers a
  // re-issue of something an operator switched off.
  if (disabled) return null;

  return (
    <>
      <Box
        data-regenerate="control"
        sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, ...WRAP_ROW_SX }}
      >
        <Button
          type="button"
          size="small"
          variant="text"
          onClick={() => onRegenerate(context)}
          // WCAG 2.5.3 Label in Name: it begins with the word a speech-input user
          // can actually see on the control.
          aria-label={`${REGENERATE_LABEL}: ${name}`}
          sx={BUTTON_SX}
        >
          {REGENERATE_LABEL}
        </Button>
        <Button
          type="button"
          size="small"
          variant="text"
          color="inherit"
          onClick={() => setShowContext((open) => !open)}
          aria-expanded={showContext ? "true" : "false"}
          // Set ONLY while the field exists. A collapsed aria-controls would be a
          // dangling IDREF, which is invalid ARIA rather than merely untidy.
          aria-controls={showContext ? fieldId : undefined}
          sx={{ ...BUTTON_SX, color: "var(--text-secondary)" }}
        >
          {showContext ? HIDE_CONTEXT_LABEL : SHOW_CONTEXT_LABEL}
        </Button>
      </Box>
      {showContext ? (
        <Box data-regenerate="context" sx={{ mt: 0.5 }}>
          <TextField
            id={fieldId}
            size="small"
            label={FIELD_LABEL}
            value={context}
            onChange={(event) => setContext(event.target.value)}
            slotProps={{ htmlInput: { maxLength: maxChars } }}
            sx={{ ...TOUCH_FIELD_SX, width: "100%" }}
          />
        </Box>
      ) : null}
    </>
  );
}
