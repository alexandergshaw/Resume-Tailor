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
//
// N82: the "" option below is a DISTINCT no-preference state, not a synonym
// for pinning the default placement -- it leaves the saved default unset so
// every consumer's `defaultPlacement || DEFAULT_PLACEMENT` fallback applies
// (and keeps following DEFAULT_PLACEMENT if that ever changes). displayEmpty
// is required so MUI shows this option's label instead of rendering blank
// when the control's value is "".
export default function CoverFactPlacementSetting() {
  const { placement, setPlacement } = useCoverFactPlacement();
  return (
    <Select
      size="small"
      fullWidth
      displayEmpty
      value={placement}
      onChange={(e) => setPlacement(e.target.value)}
      sx={{ fontSize: "0.82rem" }}
    >
      <MenuItem value="">Let the app decide</MenuItem>
      {OPTIONS.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  );
}
