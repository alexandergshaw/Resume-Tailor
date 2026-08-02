"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import HighlightIcon from "@mui/icons-material/Highlight";

// Mirrors SCOPE_LABEL in DocumentPreviewDialog.js (lowercase for inline copy).
const SCOPE_NOUN = { resume: "resume", cover: "cover letter" };

// AC-4 control (+ legend) for line-level version highlighting: marks whole
// paragraphs that are new or changed relative to the previous saved
// generation of the ACTIVE scope. Defaults OFF — the caller owns that
// default via `on` — so the normal preview stays clean.
//
// AC-6: hidden entirely when there is no previous version to diff against.
// This mirrors VersionControl.js's own precedent (hidden, not disabled,
// when there's nothing useful to show) for the same underlying reasons: a
// signed-out user, a job with no position row yet, or a first generation
// all resolve to `hasPrevious=false` upstream.
//
// AC-5: shown but disabled, with an explanatory tooltip, when the active
// document is hand-edited. A hand-edited scope's saved HTML is shown as-is
// (DocumentPreviewDialog's ensureLoaded never calls loadModel for it), so
// there is no freshly parsed model to annotate — silently doing nothing
// would look broken, so the control explains why instead.
//
// AC-7: disabled while the ACTIVE scope specifically is busy.
export default function HighlightToggle({
  scope,
  on = false,
  onToggle,
  hasPrevious = false,
  handEdited = false,
  disabled = false,
}) {
  if (!hasPrevious) return null;

  const noun = SCOPE_NOUN[scope] || "document";
  const blockedReason = handEdited
    ? `Highlighting isn't available for a hand-edited ${noun} — switch to a saved version to compare it.`
    : `Highlight lines that are new or changed since the previous saved ${noun}.`;
  const isDisabled = disabled || handEdited;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, my: 0.5 }}>
      <Tooltip title={blockedReason}>
        <span>
          <ToggleButton
            size="small"
            value="highlight"
            selected={on}
            disabled={isDisabled}
            onChange={() => onToggle?.(!on)}
            sx={{ textTransform: "none", px: 1, height: 32 }}
          >
            <HighlightIcon fontSize="small" sx={{ mr: 0.5 }} />
            Highlight changes
          </ToggleButton>
        </span>
      </Tooltip>
      {on && !isDisabled ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.72rem", color: "var(--text-secondary)" }}>
          <Box component="span" sx={{ bgcolor: "rgba(255,213,79,0.55)", borderRadius: "2px", px: 0.5 }}>highlighted</Box>
          = new or changed since the previous version
        </Box>
      ) : null}
    </Box>
  );
}
