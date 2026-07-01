"use client";

import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";

// A freeSolo tag input for string-array fields.
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
          // eslint-disable-next-line react/jsx-key
          <Chip size="small" variant="outlined" label={option} {...getTagProps({ index })} />
        ))
      }
      renderInput={(params) => (
        <TextField {...params} label={label} helperText={helperText} placeholder="Type, press Enter" />
      )}
    />
  );
}
