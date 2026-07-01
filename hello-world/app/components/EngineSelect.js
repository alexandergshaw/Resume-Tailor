"use client";

import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useEngine, ENGINE_OPTIONS } from "@/app/settings/engine";

// Compact engine picker for the top bar. Bound to the shared engine store so it
// stays in sync with the tailoring logic in page.js. The tooltip describes the
// currently selected engine.
export default function EngineSelect() {
  const { engine, setEngine } = useEngine();
  const active = ENGINE_OPTIONS.find((o) => o.value === engine) || ENGINE_OPTIONS[0];

  return (
    <Tooltip title={active.hint}>
      <Select
        size="small"
        value={engine}
        onChange={(e) => setEngine(e.target.value)}
        aria-label="Tailoring engine"
        sx={{
          minWidth: 132,
          fontSize: "0.85rem",
          bgcolor: "var(--bg-surface)",
          "& .MuiSelect-select": { py: 0.6 },
        }}
      >
        {ENGINE_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value} sx={{ fontSize: "0.85rem" }}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
    </Tooltip>
  );
}
