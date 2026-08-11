"use client";

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

// Per-status presentation shared by every "queue of tracked jobs" surface in
// Manual Applying (Screenshots, and the multi-posting Job Description tab).
// Extracted from ScreenshotTab so both tabs render status the same way, and
// so status is always TEXT, never colour alone.
const STATUS_STYLE = {
  pending: { color: "var(--text-muted)", bg: "rgba(0,0,0,0.04)", label: "Queued" },
  processing: { color: "var(--accent-hover)", bg: "var(--accent-soft)", label: "Working…" },
  done: { color: "var(--success)", bg: "var(--success-soft)", label: "Ready" },
  error: { color: "var(--danger-hover)", bg: "var(--danger-soft)", label: "Failed" },
};

export default function StatusPill({ status, statusLabel, id }) {
  // "idle" means this item has never been run -- show no pill at all rather
  // than a misleading "Queued".
  if (status === "idle") return null;
  const s = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <Box
      component="span"
      id={id}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        fontSize: "0.72rem",
        fontWeight: 600,
        color: s.color,
        bgcolor: s.bg,
        borderRadius: 999,
        px: 1,
        py: 0.25,
        whiteSpace: "nowrap",
      }}
    >
      {status === "processing" ? <CircularProgress size={11} thickness={6} /> : null}
      {statusLabel || s.label}
    </Box>
  );
}
