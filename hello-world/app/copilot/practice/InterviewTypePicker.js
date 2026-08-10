"use client";

import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { INTERVIEW_TYPES, interviewType as resolveInterviewType } from "@/lib/copilot/interviewTypes";
import { TOUCH_FIELD_SX } from "../mobileSx";

// G2: presentational picker for which interview format practice mode
// generates questions, sample answers, and evaluation for — sibling to
// PostingPicker, same sizing convention (size="small", maxWidth 480). All
// state (the selected value, persistence) lives in useInterviewType; this
// only renders what it's given and calls back on change (AC-G2-C-2).
// Changeable at any time, including mid-session, exactly like the posting
// picker.
//
// Defect 8 (mobile shell): `width: "100%"` alongside `maxWidth: 480` —
// without it, MUI's select TextField (an inline-flex FormControl whose
// select renders a div) sizes to its max-content, i.e. just the selected
// label (~202px), leaving it visibly narrower than the full-width
// PostingPicker beside it and forcing the 85-95 char helperText blurb to
// wrap to ~6 lines instead of ~3.
export default function InterviewTypePicker({ value, onChange, disabled }) {
  // Normalized through the shared module rather than re-declaring the
  // vocabulary here (AC-G2-0-3) — an unrecognized `value` resolves to the
  // "general" descriptor instead of rendering a select with nothing
  // selected.
  const selected = resolveInterviewType(value);

  return (
    <TextField
      select
      size="small"
      label="Interview type"
      value={selected.value}
      onChange={(e) => onChange(e.target.value)}
      helperText={selected.blurb}
      disabled={disabled}
      sx={{ maxWidth: 480, width: "100%", ...TOUCH_FIELD_SX }}
    >
      {INTERVIEW_TYPES.map((entry) => (
        <MenuItem key={entry.value} value={entry.value}>
          {entry.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
