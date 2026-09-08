"use client";

import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import { BREAK_LONG_WORDS_SX, TOUCH_FIELD_SX } from "@/app/theme/mobileSx";

// A freeSolo tag input for string-array fields.
//
// The touch floor lives HERE rather than at each call site: this one component
// is the chips field in EditDialog, ImportDialog, PersonaTab and ProfileTab,
// so a single spread covers all four and a fifth consumer inherits it for
// free. `size="small"` only trims padding -- the resting control is ~40px,
// under MOBILE_TAP_MIN.
export default function ChipsInput({ label, value, onChange, helperText }) {
  return (
    <Autocomplete
      multiple
      freeSolo
      size="small"
      options={[]}
      value={value || []}
      onChange={(_, next) => onChange(next.map((s) => String(s).trim()).filter(Boolean))}
      renderTags={(vals, getTagProps) =>
        vals.map((option, index) => (
          // A library alias or keyword can be a long unbroken token (a package
          // name, a slug). Without the label rule below, the chip's text is
          // clipped by `html { overflow-x: hidden }` rather than wrapped, at
          // any width. `height: "auto"` is required alongside it: a Chip is a
          // fixed-height control, so a wrapped label would otherwise overflow
          // its own box rather than growing it.
          //
          // The key comes from getTagProps({ index }), which the spread below
          // applies - hence the disable, which must sit immediately above the
          // element for the rule to see it.
          // eslint-disable-next-line react/jsx-key
          <Chip
            size="small"
            variant="outlined"
            label={option}
            {...getTagProps({ index })}
            sx={{ height: "auto", "& .MuiChip-label": { ...BREAK_LONG_WORDS_SX, whiteSpace: "normal", py: 0.25 } }}
          />
        ))
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          helperText={helperText}
          placeholder="Type, press Enter"
          sx={TOUCH_FIELD_SX}
        />
      )}
    />
  );
}
