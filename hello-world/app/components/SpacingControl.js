"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";

// N69: the whole-document spacing presets a candidate can pick, deliberately
// small (minimize-clicks) rather than free numeric entry -- entry.spacing is
// { lineSpacing, paragraphSpacingPt } | null, where null means "use the
// document's own spacing" (the source-fidelity default, CB-R-1). Kept as a
// standalone file directly under app/components/ (NOT app/components/preview/,
// which this chunk does not own) so DocumentPreviewDialog.js only needs one
// import line to reclaim the space this control needs.
const LINE_PRESETS = [
  { value: 1, label: "1x" },
  { value: 1.15, label: "1.15x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
];
const PARAGRAPH_PRESETS = [
  { value: 0, label: "0pt" },
  { value: 6, label: "6pt" },
  { value: 12, label: "12pt" },
];

// Present whenever the active tab is a docx scope, ENABLED or DISABLED but
// never ABSENT (CB-D-3 clause ii) -- the parent gates mounting this on
// DOCX_SCOPES.includes(tab) only, and passes `disabled` for the
// !available(tab) case so a candidate always sees why, instead of the
// control just vanishing.
export default function SpacingControl({ scope, spacing, onSetSpacing, disabled = false }) {
  const current = spacing || {};
  const setPartial = (partial) => {
    onSetSpacing?.(scope, {
      lineSpacing: current.lineSpacing ?? null,
      paragraphSpacingPt: current.paragraphSpacingPt ?? null,
      ...partial,
    });
  };

  return (
    <Box data-testid="spacing-control" sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", my: 0.5 }}>
      <Box component="span" sx={{ fontSize: "0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
        Line
      </Box>
      {LINE_PRESETS.map((p) => (
        <Button
          key={p.value}
          size="small"
          data-testid={`spacing-line-${p.value}`}
          disabled={disabled}
          variant={current.lineSpacing === p.value ? "contained" : "outlined"}
          onClick={() => setPartial({ lineSpacing: p.value })}
          sx={{ textTransform: "none", minWidth: 0, px: 1 }}
        >
          {p.label}
        </Button>
      ))}
      <Box component="span" sx={{ fontSize: "0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap", ml: 1 }}>
        Paragraph
      </Box>
      {PARAGRAPH_PRESETS.map((p) => (
        <Button
          key={p.value}
          size="small"
          data-testid={`spacing-para-${p.value}`}
          disabled={disabled}
          variant={current.paragraphSpacingPt === p.value ? "contained" : "outlined"}
          onClick={() => setPartial({ paragraphSpacingPt: p.value })}
          sx={{ textTransform: "none", minWidth: 0, px: 1 }}
        >
          {p.label}
        </Button>
      ))}
      {disabled ? (
        <Tooltip title="Nothing to apply spacing to yet.">
          <Box component="span" sx={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            (nothing to apply yet)
          </Box>
        </Tooltip>
      ) : null}
    </Box>
  );
}
