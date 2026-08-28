"use client";

import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { INTERVIEW_TYPES, interviewType as resolveInterviewType } from "@/lib/copilot/interviewTypes";
import { TOUCH_FIELD_SX, TOUCH_MUI_SELECT_SX } from "./mobileSx";
import { useInterviewTypeStorageBlocked } from "./useInterviewType";

// G2: presentational picker for which interview format BOTH copilot surfaces
// generate questions, drafts, sample answers and evaluation for — live mode
// mounts it from SessionSetup.js and practice mode from PracticeSetup.js.
// Sibling to PostingPicker, same sizing convention (size="small",
// maxWidth 480).
// Moved out of practice/ (chunk A) alongside useInterviewType.js so the
// live surface can mount it too. The selected value and its persistence
// still live entirely in useInterviewType — this component never owns
// them, and is handed the value and a change callback exactly as before
// (AC-G2-C-2) — except for one persistence FACT it now reads for itself:
// whether the store's last write actually reached storage (contract 10).
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

  // AC-A8b: read the storage-blocked fact directly from the store rather
  // than have it prop-drilled through CopilotClient/PracticeClient and
  // SessionSetup/PracticeSetup — this is the element that displays it.
  const storageBlocked = useInterviewTypeStorageBlocked();
  const helperText = storageBlocked
    ? `${selected.blurb} Not saved. This browser is blocking stored settings.`
    : selected.blurb;

  return (
    <TextField
      select
      size="small"
      label="Interview type"
      value={selected.value}
      onChange={(e) => onChange(e.target.value)}
      helperText={helperText}
      disabled={disabled}
      sx={{ maxWidth: 480, width: "100%", ...TOUCH_FIELD_SX, ...TOUCH_MUI_SELECT_SX }}
    >
      {INTERVIEW_TYPES.map((entry) => (
        <MenuItem key={entry.value} value={entry.value}>
          {entry.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
