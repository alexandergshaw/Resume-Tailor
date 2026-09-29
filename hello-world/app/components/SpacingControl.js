"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import { BREAK_LONG_WORDS_SX, TOUCH_TARGET_SX } from "@/app/theme/mobileSx";

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

// N96: "Custom" must mean exactly "something is being applied" -- this MUST
// stay identical to applySpacingToHtml's own non-no-op condition
// (lib/document/docxPreview.js:356,358), or the indicator drifts from what
// the transform actually does (never Custom while nothing applies, never
// Default while something applies).
function isApplied(spacing) {
  return spacing != null && (spacing.lineSpacing != null || spacing.paragraphSpacingPt != null);
}

// N96: the document's own spacing is real and per-paragraph -- the app does
// not know it as "1x" or "0pt", so an unset axis is never rendered as a
// fabricated number (AC-1 domain trap). Same under-claiming phrasing for both
// axes so the readout never implies the app knows spacing it does not.
const SOURCE_LINE_PHRASE = "your document's own line spacing";
const SOURCE_PARAGRAPH_PHRASE = "your document's own paragraph spacing";

function spacingReadoutText(spacing) {
  const lineText = spacing?.lineSpacing != null ? `${spacing.lineSpacing}x line` : SOURCE_LINE_PHRASE;
  const paraText =
    spacing?.paragraphSpacingPt != null ? `${spacing.paragraphSpacingPt}pt paragraph` : SOURCE_PARAGRAPH_PHRASE;
  return `${isApplied(spacing) ? "Custom" : "Default"} spacing — ${lineText}, ${paraText}`;
}

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
  // N96/AC-4: bypasses setPartial entirely -- setPartial would build
  // {lineSpacing:null, paragraphSpacingPt:null}, an OBJECT that LOOKS like a
  // reset but is not `null` (the N82 one-way-door trap: it would defeat
  // source fidelity while claiming to restore it). The reset writes the
  // literal null onSetSpacing already accepts as "use the source's own spacing".
  const resetToDefault = () => onSetSpacing?.(scope, null);

  return (
    <Box data-testid="spacing-control" sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", my: 0.5 }}>
      <Box component="span" sx={{ fontSize: "0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
        Line
      </Box>
      {LINE_PRESETS.map((p) => {
        // N96/AC-2: aria-pressed uses the SAME predicate as the visual
        // `variant` below so the drawn and announced state cannot drift.
        const selected = current.lineSpacing === p.value;
        return (
          <Button
            key={p.value}
            size="small"
            data-testid={`spacing-line-${p.value}`}
            disabled={disabled}
            variant={selected ? "contained" : "outlined"}
            aria-pressed={selected}
            onClick={() => setPartial({ lineSpacing: p.value })}
            sx={{ textTransform: "none", minWidth: 0, px: 1 }}
          >
            {p.label}
          </Button>
        );
      })}
      <Box component="span" sx={{ fontSize: "0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap", ml: 1 }}>
        Paragraph
      </Box>
      {PARAGRAPH_PRESETS.map((p) => {
        const selected = current.paragraphSpacingPt === p.value;
        return (
          <Button
            key={p.value}
            size="small"
            data-testid={`spacing-para-${p.value}`}
            disabled={disabled}
            variant={selected ? "contained" : "outlined"}
            aria-pressed={selected}
            onClick={() => setPartial({ paragraphSpacingPt: p.value })}
            sx={{ textTransform: "none", minWidth: 0, px: 1 }}
          >
            {p.label}
          </Button>
        );
      })}
      {isApplied(spacing) ? (
        <Button
          size="small"
          data-testid="spacing-reset"
          disabled={disabled}
          onClick={resetToDefault}
          sx={{ textTransform: "none", minWidth: 0, px: 1, ...TOUCH_TARGET_SX }}
        >
          Reset to default
        </Button>
      ) : null}
      {disabled ? (
        <Tooltip title="Nothing to apply spacing to yet.">
          <Box component="span" sx={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            (nothing to apply yet)
          </Box>
        </Tooltip>
      ) : null}
      {/* N96/D-4 (BLOCKER): aria-live="polite" + aria-atomic="true", and
          NEVER role="status" -- SpacingControl mounts earlier in document
          order (DocumentPreviewDialog.js:748) than DriveResultRegion /
          CopyFeedbackStrip. A role="status" here would become the
          document-order-first [role="status"] and silently hijack the
          drive/copy suites' lookups (B-1).
          `component="span"` (with `display:"block"` below to keep the exact
          same visible, full-width layout a <div> would give): any element
          carrying aria-live="polite" collides with
          factAutoInsertMessage.rc.test.js's `spanless()` instrument, which
          treats every NON-span aria-live/role=status node as "a message was
          shown" -- the same tag-based signal DriveResultRegion.js/
          CopyFeedback.js already use for their own live regions. Staying a
          <div> here made an ordinary spacing readout register as a false
          auto-insert message on every render. */}
      <Box
        component="span"
        data-testid="spacing-current"
        aria-live="polite"
        aria-atomic="true"
        sx={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", width: "100%", ...BREAK_LONG_WORDS_SX }}
      >
        {spacingReadoutText(spacing)}
      </Box>
      <Box data-testid="spacing-scope-note" sx={{ fontSize: "0.7rem", color: "var(--text-muted)", width: "100%" }}>
        Whole document — applies to résumé and cover letter.
      </Box>
    </Box>
  );
}
