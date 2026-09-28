"use client";

import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { placementOptions } from "@/lib/document/coverLetterWeave";
import { useCoverFactPlacement } from "../hooks/useCoverFactPlacement";

const OPTIONS = placementOptions();

// N62 Capability A (AC-A3): the one discoverable settings control for the
// per-user default placement of auto-inserted cover-letter facts. Reads and
// writes through useCoverFactPlacement, the SAME hook page.js reads, so a
// change here applies to every application with no per-application
// re-selection step.
export default function CoverFactPlacementSetting() {
  const { placement, setPlacement } = useCoverFactPlacement();
  return (
    <Select
      size="small"
      fullWidth
      value={placement}
      onChange={(e) => setPlacement(e.target.value)}
      sx={{ fontSize: "0.82rem" }}
    >
      {OPTIONS.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  );
}
