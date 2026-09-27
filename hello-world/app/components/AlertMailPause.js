"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";

// N60 S6 (AC-E4) -- the one account-level control that pauses ALL job-alert
// email, reachable in two actions from the app shell (open Settings, flip
// this switch). Reads its initial state from GET /api/alerts/status (S6's
// alertsPaused extension) and PUTs /api/alerts/pause on every flip -- no
// confirmation step, because turning mail OFF is the safe direction.
//
// Non-destructive by construction: the pause route writes only
// user_alert_settings, never any saved_searches row, so unpausing restores
// every search's own email/auto-tailor choices exactly as they were. Scoped
// to mail only -- a paused account still tailors and queues materials
// (contract §6.3/§6.4); this control does not touch auto-tailoring.
export default function AlertMailPause() {
  const [paused, setPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/alerts/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPaused(!!data?.alertsPaused))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function handleChange(e) {
    const next = e.target.checked;
    setPaused(next);
    try {
      await fetch("/api/alerts/pause", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
    } catch {
      // Best-effort: a failed write leaves the switch optimistic; the next
      // status read (a reload, or the next time Settings opens) reflects the
      // real server state.
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <FormControlLabel
        control={<Switch size="small" checked={paused} disabled={!loaded} onChange={handleChange} />}
        label={<Box sx={{ fontSize: "0.82rem" }}>Pause all job-alert emails</Box>}
        sx={{ m: 0 }}
      />
      <Typography sx={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
        Stops every alert email for this account without changing any saved search.
      </Typography>
    </Box>
  );
}
