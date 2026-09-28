"use client";

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
  const delivered = describeCadence(clampIntervalMinutes(value));
  const selectValue = CADENCE_OPTIONS_MINUTES.includes(value) ? value : "";

  return (
    <Box sx={{ mt: 1 }}>
      <FormControl size="small" sx={{ minWidth: 220 }}>
        <InputLabel>How often to check</InputLabel>
        <Select
          label="How often to check"
          value={selectValue}
          displayEmpty
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <MenuItem value="">
            <em>Not set ({describeCadence(clampIntervalMinutes(null))})</em>
          </MenuItem>
          {CADENCE_OPTIONS_MINUTES.map((minutes) => (
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
