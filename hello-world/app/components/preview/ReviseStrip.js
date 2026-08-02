"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";

// Mirrors SCOPE_LABEL in DocumentPreviewDialog.js.
const SCOPE_LABEL = { resume: "Resume", cover: "Cover letter" };

// The revise/steering strip: free-text instructions to re-run the selected
// engine with, plus the Revise button. Shown only when `steeringEnabled`
// (computed by the orchestrator) is true — Gemini rewrites freely, and the
// embedded engine applies emphasize/avoid/tone directives offline.
export default function ReviseStrip({
  tab,
  isEmbedded,
  steerText,
  setSteerText,
  resubmitting,
  setResubmitting,
  busyActive,
  coverBlockedByResumeBusy,
  onResubmit,
}) {
  // Resubmit the active document to the selected engine with the typed steering
  // instructions. The parent re-runs the tailor and refreshes the preview; on
  // success we clear the box (see steeringEnabled below for which engines).
  const submitSteer = async () => {
    const text = steerText.trim();
    if (!text || resubmitting || busyActive || coverBlockedByResumeBusy) return;
    setResubmitting(true);
    try {
      const ok = await onResubmit?.(tab, text);
      if (ok !== false) setSteerText("");
    } finally {
      setResubmitting(false);
    }
  };

  return (
    <Box sx={{ px: { xs: 1.25, sm: 2 }, pt: 1.25, pb: 0.5, borderTop: "1px solid var(--border)", bgcolor: "var(--accent-soft)" }}>
      <Box sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", mb: 0.75 }}>
        {isEmbedded
          ? `Revise this ${SCOPE_LABEL[tab].toLowerCase()} offline (no AI)`
          : `Ask Gemini to revise this ${SCOPE_LABEL[tab].toLowerCase()}`}
      </Box>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <TextField
          multiline
          minRows={1}
          maxRows={4}
          fullWidth
          size="small"
          value={steerText}
          onChange={(e) => setSteerText(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitSteer();
            }
          }}
          placeholder={
            isEmbedded
              ? "e.g. Emphasize React and Kubernetes, remove Java, tone it down"
              : "e.g. Emphasize leadership, shorten the summary, and call out my Python experience"
          }
          disabled={resubmitting || busyActive || coverBlockedByResumeBusy}
          sx={{ bgcolor: "var(--bg-surface)", borderRadius: 1 }}
        />
        <Tooltip
          title={
            coverBlockedByResumeBusy
              ? "Waiting for the résumé revision to finish, so the cover letter grounds on the latest résumé text."
              : ""
          }
        >
          <span>
            <Button
              onClick={submitSteer}
              disabled={!steerText.trim() || resubmitting || busyActive || coverBlockedByResumeBusy}
              variant="contained"
              startIcon={resubmitting ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon fontSize="small" />}
              sx={{ textTransform: "none", whiteSpace: "nowrap", mt: 0.25 }}
            >
              {resubmitting ? "Revising…" : "Revise"}
            </Button>
          </span>
        </Tooltip>
      </Box>
      <Box sx={{ fontSize: "0.7rem", color: "var(--text-muted)", mt: 0.5 }}>
        {coverBlockedByResumeBusy
          ? "Waiting for the résumé revision to finish before revising the cover letter."
          : isEmbedded
            ? "Regenerates on-device, applying emphasize / remove / tone-it-down directives. Enter to submit, Shift+Enter for a new line."
            : "Regenerates this document with Gemini using your instructions. Enter to submit, Shift+Enter for a new line."}
      </Box>
    </Box>
  );
}
