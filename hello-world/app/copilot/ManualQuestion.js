"use client";

import { useId, useRef, useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { normalizeManualQuestion, MAX_MANUAL_QUESTION_CHARS } from "@/lib/copilot/manualQuestion";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { TOUCH_FIELD_SX, TOUCH_TARGET_SX, WRAP_ROW_SX } from "./mobileSx";

const DEFAULT_CONFIRM_LABEL = "Added to the feed";

// AC-O1/AC-O5: the box that lets a candidate TYPE a question and have it
// behave exactly like a detected one. Presentational only — normalization
// (lib/copilot/manualQuestion.js, its own tests) decides what counts as
// submittable, and `onSubmit` decides what happens with an accepted one;
// this component owns only the field, the button, and the announcement.
// Modelled on MicPicker.js / PostingPicker.js: the caller passes behavior
// in, this renders it.
export default function ManualQuestion({
  onSubmit,
  label = "Type a question",
  placeholder,
  helperText,
  confirmLabel = DEFAULT_CONFIRM_LABEL,
  buttonLabel = "Add",
  disabled,
}) {
  const inputId = useId();
  const helperTextId = useId();
  const inputRef = useRef(null);
  const [value, setValue] = useState("");
  // "" until an add succeeds, and only ever set from a submit that actually
  // lands — never pre-filled at mount. See the region below for why.
  const [announcement, setAnnouncement] = useState("");

  const { ok, question } = normalizeManualQuestion(value);
  const submitDisabled = !!disabled || !ok;

  function handleSubmit(e) {
    e.preventDefault();
    if (submitDisabled) return;

    const accepted = onSubmit(question);
    // A caller that refuses (returns anything other than exactly `true`)
    // means the question landed nowhere — leave the typed text on screen
    // instead of silently discarding it, and say nothing was added.
    if (accepted === true) {
      setValue("");
      setAnnouncement(`${confirmLabel}: "${question}"`);
      // Mid-interview this control is used repeatedly; without this the
      // field would lose focus to <body> after every single add — the same
      // WCAG 2.4.3 failure CopilotDashboard's reveal button already had to
      // fix. The input stays mounted across a submit (only its value
      // changes), so focusing it back synchronously here is enough; no
      // effect/ref-timing dance like the reveal-button fix needed.
      inputRef.current?.focus();
    }
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      {/*
        The helper text used to be MUI's own `helperText` prop, which renders
        INSIDE the TextField's FormControl — making that flex item taller
        than the Button beside it, which then stretched (this row's default
        `align-items: stretch`) to match. Keeping the row to ONLY the field
        and the button means the FormControl is exactly the input's own
        height and the button's stretch has nothing taller to match, at any
        TextField `size` — no hard-coded height, no `alignItems:
        "flex-start"` needed.
      */}
      <Box sx={{ display: "flex", gap: 1, ...WRAP_ROW_SX }}>
        <TextField
          id={inputId}
          inputRef={inputRef}
          size="small"
          label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          slotProps={{
            htmlInput: {
              maxLength: MAX_MANUAL_QUESTION_CHARS,
              "aria-describedby": helperText ? helperTextId : undefined,
            },
          }}
          sx={{ flex: "1 1 240px", ...TOUCH_FIELD_SX }}
        />
        <Button type="submit" variant="outlined" disabled={submitDisabled} sx={TOUCH_TARGET_SX}>
          {buttonLabel}
        </Button>
      </Box>
      {/*
        Moved out of the row above, but the a11y association MUI's own
        `helperText` prop used to wire for free (aria-describedby on the
        input) still has to hold — `helperTextId` is what the input's
        slotProps points at above. Rendered only when there is text, so a
        caller that drops the helper text mid-session (live mode, to buy
        back vertical space) never leaves aria-describedby pointing at an
        empty or absent node.
      */}
      {helperText ? (
        <Typography id={helperTextId} variant="caption" sx={{ color: "var(--text-muted)" }}>
          {helperText}
        </Typography>
      ) : null}
      {/*
        F9-style contract (lib/copilot/answerStatus.js): mounted from the
        FIRST render, empty, so a screen reader only ever hears a TEXT
        CHANGE on an already-mounted region, never a region that appears
        already carrying its final content (which NVDA/JAWS do not announce).
        Known limit: submitting the identical question twice in a row
        produces identical region text, which React treats as no change, so
        the second add is silent here. Not worth a counter to work around —
        three other signals already cover it: the field visibly clears, the
        feed gains a row, and the dashboard's own answer region moves
        idle -> loading -> done for the new entry.
      */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}
