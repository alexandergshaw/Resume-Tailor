"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";

// N92 Wave 3 (Control B) -- the CONFIRM-BEFORE-PERSIST surface (owner ruling
// D7, AC-B10/B11/B12). Shows the smoothed before/after for exactly the one
// fact a "Smooth" click just proposed; nothing about this candidate has been
// written anywhere yet. Apply persists EXACTLY `candidate.after` (AC-B12);
// Discard throws the candidate away, changing nothing (AC-B11). No Tooltip
// wrapper on either button, matching InsertedFactsStrip's own rule -- each
// button's aria-label IS its reachability contract.
//
// N95: `pending` (Apply in flight) disables BOTH buttons -- Discard too, so a
// candidate cannot discard out from under an apply that is still persisting
// -- and swaps Apply's icon for an aria-hidden spinner. Cleared in a
// `finally` by the caller (DocumentPreviewMount's handleApplySmooth), so a
// thrown persist never leaves Apply stuck disabled.
export default function CoverFactSmoothConfirm({ candidate, pending = false, onApply, onDiscard }) {
  if (!candidate || candidate.status !== "proposed") return null;
  const preview = candidate.preview || {};
  return (
    <Box sx={{ mt: 0.5, mb: 0.5, p: 1, border: "1px solid var(--border)", borderRadius: 1, bgcolor: "var(--surface)" }}>
      <Box sx={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-secondary)", mb: 0.25 }}>
        Smoothed transition
      </Box>
      <Box sx={{ fontSize: "0.75rem", color: "var(--text-secondary)", textDecoration: "line-through", mb: 0.25 }}>
        {preview.originalText}
      </Box>
      <Box data-smooth-after sx={{ fontSize: "0.8rem" }}>
        {preview.smoothedText}
      </Box>
      <Box sx={{ display: "flex", gap: 1, mt: 0.75, alignItems: "center" }}>
        <Button size="small" variant="contained" aria-label="Apply the smoothed version" disabled={pending} onClick={onApply}>
          {pending ? <CircularProgress size={14} aria-hidden="true" sx={{ color: "currentColor", mr: 0.75 }} /> : null}
          Apply
        </Button>
        <Button size="small" aria-label="Discard the smoothed version" disabled={pending} onClick={onDiscard}>
          Discard
        </Button>
      </Box>
    </Box>
  );
}
