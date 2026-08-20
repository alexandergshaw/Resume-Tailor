"use client";

import TextField from "@mui/material/TextField";
import { ROLE_REGISTERS, roleRegister } from "@/lib/copilot/roleRegisters";
import { TOUCH_FIELD_SX, TOUCH_NATIVE_SELECT_SX } from "../mobileSx";

// AC-Q9.1 - a single labelled select naming every role in the registry, the
// current pick's own `blurb` as helper text. No nested menu, no wizard, no
// confirm step - choosing a value here is the whole interaction (AC-Q0.3).
//
// Deliberately a NATIVE select (`slotProps.select.native`), not MUI's
// listbox-based Select used elsewhere in this app (InterviewTypePicker,
// PostingPicker). MUI's non-native Select points its trigger's
// `aria-labelledby` at the field label ONLY - never at the element holding
// the selected value's own text - so the trigger's accessible name is just
// "Speak as", while its visible text is the selected role's label. That's a
// real accessible-name/visible-text mismatch (WCAG 2.5.3) the moment
// anything more than the label is checked, and it is exactly the shape this
// feature's own accessibility test asserts against for every control. A
// native `<select>` sidesteps it entirely: the real `<label for>` the
// TextField still renders names it correctly, and nothing about "which role
// is currently selected" is ever asserted as part of the control's name.
export default function RolePicker({ role, onChange }) {
  const selected = roleRegister(role);

  return (
    <TextField
      select
      size="small"
      label="Speak as"
      value={selected.value}
      onChange={(e) => onChange(e.target.value)}
      helperText={selected.blurb}
      slotProps={{ select: { native: true } }}
      sx={{ maxWidth: 480, width: "100%", ...TOUCH_FIELD_SX, ...TOUCH_NATIVE_SELECT_SX }}
    >
      {ROLE_REGISTERS.map((entry) => (
        <option key={entry.value} value={entry.value}>
          {entry.label}
        </option>
      ))}
    </TextField>
  );
}
