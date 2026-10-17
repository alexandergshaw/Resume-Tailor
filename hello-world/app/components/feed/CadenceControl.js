"use client";

import { useId } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { describeCadence, clampIntervalMinutes } from "@/lib/feed/cronSchedule";

// N60 second chunk, Step D (AC2-C4c review half). The ONE shared cadence
// control (AC2-C2 reuses it, never a second copy) -- a picker plus a STATED
// summary of the cadence that will actually be delivered.
//
// The stated summary is load-bearing, not decorative: it is always
// `describeCadence(clampIntervalMinutes(value))`, so a sub-floor ask reads as
// the floor it will actually get and an above-default value is never masked
// by a hardcoded "about every hour". A picker whose OPTIONS merely list every
// cadence string is not enough -- the delivered value must be STATED (the
// mutant this file's test caught: a hardcoded default survived until the
// review's own test started asserting the stated text instead of container
// membership).
const CADENCE_OPTIONS_MINUTES = [15, 30, 60, 180, 360, 1440];

export default function CadenceControl({ value, onChange }) {
  const labelId = useId();
  const supplied = (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value));
  const normalized = supplied ? Number(value) : null;
  const effective = clampIntervalMinutes(normalized);
  const delivered = describeCadence(effective);
  const selectValue = normalized === null ? "" : effective;
  const options = CADENCE_OPTIONS_MINUTES.includes(effective) ? CADENCE_OPTIONS_MINUTES : [...CADENCE_OPTIONS_MINUTES, effective].sort((a, b) => a - b);

  return (
    <Box sx={{ mt: 1 }}>
      <FormControl size="small" sx={{ minWidth: 220 }}>
        <InputLabel id={labelId}>How often to check</InputLabel>
        <Select
          labelId={labelId}
          label="How often to check"
          value={selectValue}
          displayEmpty
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <MenuItem value="">
            <em>Not set ({describeCadence(clampIntervalMinutes(null))})</em>
          </MenuItem>
          {options.map((minutes) => (
            <MenuItem key={minutes} value={minutes}>
              {describeCadence(clampIntervalMinutes(minutes))}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography sx={{ color: "text.secondary", fontSize: "0.78rem", mt: 0.5 }}>
        Checked {delivered}.
      </Typography>
    </Box>
  );
}
