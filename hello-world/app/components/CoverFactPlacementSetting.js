"use client";

import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
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
//
// N92 Wave 2 (Control C): the same section also carries the persisted
// "position facts forward on all future generated cover letters" toggle
// (`forward`/`setForward`, off this SAME hook instance) -- kept in this one
// component rather than a sibling with its own useCoverFactPlacement() call,
// so opening Settings issues one /api/user-prefs fetch for this section, not
// two (the N86 hazard this must not add to). Reversible (AC-C5/N82): both
// on and off are settable and persist.
export default function CoverFactPlacementSetting() {
  const { placement, setPlacement, forward, setForward } = useCoverFactPlacement();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
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
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <FormControlLabel
          control={<Switch size="small" checked={forward} onChange={(e) => setForward(e.target.checked)} />}
          label={<Box sx={{ fontSize: "0.82rem" }}>Position facts forward on future letters</Box>}
          sx={{ m: 0 }}
        />
        <Typography sx={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
          Nudges each newly inserted fact one sentence later, automatically, the next time a letter is generated.
        </Typography>
      </Box>
    </Box>
  );
}
