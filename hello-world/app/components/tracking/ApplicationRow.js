"use client";

import { memo, useMemo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { STAGE_TYPE_LABELS } from "@/lib/tracking/stages";
import { hasPreviewableDocs } from "@/lib/tracking/applicationPreviewEntry";

// Extracted from TrackingTab.js's desktop <TableBody> map (tracking-surface
// performance pass): the row used to be inline JSX in that map, so every
// re-render of the page -- any button click anywhere on it -- rebuilt every
// row's element tree. As its own React.memo component a row re-renders only
// when one of ITS props changes. This is the desktop twin of ApplicationCard
// (the phone layout's row), extracted for the same reason and kept in step
// with it.
//
// What this component deliberately does NOT receive, and why:
//   * Whole `applicationStages` / `emailClassificationsByAppId` maps and
//     `highlightedAppId`. It takes this row's own slice of each (`stages`,
//     `emailClassification`, `highlighted`), so a stage saved on ANOTHER row,
//     or the highlight moving, does not re-render this one.
//   * Raw handler props. `handlers` is the stable bundle TrackingTab builds
//     with useStableHandlers (one fixed-identity function per name, forwarding
//     to the latest), so a fresh closure from the page never breaks the memo.
//   * The drag/download control, the digest cell and the stage-dialog opener.
//     TrackingTab.js owns all three (the download control is the
//     census-pinned resume-only byte path, the digest cell is shared with the
//     phone cards, and the opener holds the stage-type default that
//     lib/applications/statusVocabularySweep.test.js pins to that file) and
//     passes them as callbacks, which change identity exactly when their
//     inputs do (the resume file, the digests) and not otherwise.
//
// `data-app-id` stays on the row root: the tracking tests select through it,
// roles and accessible names, never through file structure.

// The email-classification pill, built once per classification: a fixed
// lookup, not row data, so neither the colours nor the sx object are rebuilt
// on every render. ApplicationCard.js keeps its own copy for the phone layout.
const CHIP_BASE_SX = {
  fontSize: "0.72rem",
  fontWeight: 700,
  px: 0.75,
  py: 0.25,
  borderRadius: 1,
  flexShrink: 0,
  letterSpacing: "0.03em",
};
const emailChipStyle = (label, color, bg) => ({ label, sx: { ...CHIP_BASE_SX, color, bgcolor: bg } });
const EMAIL_CHIP_STYLES = {
  confirmation: emailChipStyle("Applied", "var(--accent-hover)", "var(--accent-soft)"),
  interview: emailChipStyle("Interview", "var(--success)", "var(--success-soft)"),
  rejection: emailChipStyle("Rejected", "var(--danger-hover)", "var(--danger-soft)"),
};

const NO_STAGES = [];

// Module-scope sx: static objects that used to be rebuilt per cell per render.
const ROW_SX = { cursor: "pointer" };
const ROW_HIGHLIGHTED_SX = {
  cursor: "pointer",
  outline: "2px solid var(--accent)",
  outlineOffset: "-2px",
  backgroundColor: "var(--accent-soft) !important",
};
const STICKY_CELL_BASE_SX = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  position: "sticky",
  zIndex: 2,
  backgroundColor: "var(--bg-surface)",
  boxShadow: "1px 0 0 var(--border)",
};
const NOWRAP_SX = { whiteSpace: "nowrap" };
const WIDE_CELL_SX = { maxWidth: 220 };
const RESUME_CELL_SX = { maxWidth: 200 };
const LINK_BUTTON_SX = { p: 0, minWidth: 0, fontSize: 11 };
const ACTION_BUTTON_SX = { minWidth: 0, p: 0.25, fontSize: 11 };
const POSTED_SX = { fontSize: "0.68rem", color: "var(--text-secondary)", fontWeight: 400, mt: 0.25 };
const STATUS_COLUMN_SX = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.75 };
const CHIP_ROW_SX = { display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" };
const STAGE_ROW_SX = { display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" };
const MORE_STAGES_SX = { fontSize: 12, color: "var(--text-secondary)" };
const COMMS_COLUMN_SX = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.2 };
const STACK_SX = { display: "flex", alignItems: "flex-start", gap: 0.5, flexDirection: "column" };
const BUTTON_ROW_SX = { display: "flex", gap: 1, flexWrap: "wrap" };
const ACTIONS_SX = { display: "flex", gap: 0.5 };
const CLAMPED_TEXT_STYLE = { fontSize: 12, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };
const AI_ICON_STYLE = { fontSize: 11, padding: "0 4px", color: "var(--accent)" };

function ApplicationRow({
  app,
  idx,
  stages = NO_STAGES,
  emailClassification,
  highlighted,
  companyColWidth,
  roleColWidth,
  renderDigestCell,
  renderDownloadControl,
  openStageDialog,
  openApplicationPreview,
  handlers,
}) {
  const {
    setAppDialog,
    openCommsInAppDialog,
    openAddCommunicationDialog,
    askAiAbout,
    buildApplicationContextString,
    buildStageContextString,
    openEditApplicationDialog,
    handleDeleteApplication,
  } = handlers;
  const pos = app.positions;
  // Same shared-catalogue hazard as the compact card layout: gate before it
  // can become an href.
  const postingHref = safeExternalHref(app.application_url || pos?.url);
  const resume = app.generated_resumes;
  // N132: View/Edit needs the opener AND stored documents.
  const canPreview = !!openApplicationPreview && hasPreviewableDocs(app);
  const emailChip = emailClassification ? EMAIL_CHIP_STYLES[emailClassification] : null;

  // The two sticky columns' widths are user-resizable and change on every
  // pointer-move of a drag; built once per width instead of per render.
  const companyCellSx = useMemo(
    () => ({
      ...STICKY_CELL_BASE_SX,
      fontWeight: 600,
      left: 0,
      width: companyColWidth,
      minWidth: companyColWidth,
      maxWidth: companyColWidth,
    }),
    [companyColWidth],
  );
  const roleCellSx = useMemo(
    () => ({
      ...STICKY_CELL_BASE_SX,
      left: companyColWidth,
      width: roleColWidth,
      minWidth: roleColWidth,
      maxWidth: roleColWidth,
    }),
    [companyColWidth, roleColWidth],
  );

  return (
    <TableRow
      data-app-id={app.id}
      hover
      onClick={(e) => {
        if (e.target.closest("a, button, input, textarea, select, [role='button']")) {
          return;
        }
        openEditApplicationDialog(app);
      }}
      sx={highlighted ? ROW_HIGHLIGHTED_SX : ROW_SX}
    >
      <TableCell sx={companyCellSx}>
        {pos?.company || "—"}
        {pos?.posted_at && (
          <Box sx={POSTED_SX}>
            Posted {new Date(pos.posted_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </Box>
        )}
      </TableCell>
      <TableCell sx={roleCellSx}>
        {pos?.title || "—"}
      </TableCell>
      <TableCell>
        <Box sx={STATUS_COLUMN_SX}>
          <Box sx={CHIP_ROW_SX}>
            {emailChip && (
              <Box sx={emailChip.sx}>
                {emailChip.label}
              </Box>
            )}
          </Box>
          {stages.length > 0 ? (
            <Box sx={STAGE_ROW_SX}>
              {stages.slice(0, 2).map((stage) => {
                const stageLabel = `${stage.stage_name || STAGE_TYPE_LABELS[stage.stage_type] || stage.stage_type}${stage.outcome && stage.outcome !== "pending" ? ` · ${stage.outcome}` : ""}`;
                return (
                  <Chip
                    key={stage.id}
                    label={stageLabel}
                    size="small"
                    variant="outlined"
                    onClick={() => openStageDialog(app, stage)}
                    onDelete={() => askAiAbout({
                      label: `${pos?.company || "Application"} · ${stageLabel}`,
                      content: buildStageContextString(app, stage),
                      prompt: `Help me prepare for my "${stage.stage_name || stage.stage_type || "interview"}" at ${pos?.company || "this company"}: `,
                    })}
                    deleteIcon={<span style={AI_ICON_STYLE} title="Ask AI">AI</span>}
                  />
                );
              })}
              {stages.length > 2 ? (
                <Box component="span" sx={MORE_STAGES_SX}>
                  +{stages.length - 2} more
                </Box>
              ) : null}
            </Box>
          ) : null}
        </Box>
      </TableCell>
      <TableCell sx={NOWRAP_SX}>
        {app.applied_at
          ? new Date(app.applied_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
          : "—"}
      </TableCell>
      <TableCell sx={NOWRAP_SX}>
        <Box sx={COMMS_COLUMN_SX}>
          <Button
            size="small"
            sx={LINK_BUTTON_SX}
            onClick={() => openCommsInAppDialog(app, idx)}
          >
            View
          </Button>
          <Button
            size="small"
            sx={LINK_BUTTON_SX}
            onClick={() => openAddCommunicationDialog(app)}
          >
            Add
          </Button>
        </Box>
      </TableCell>
      <TableCell sx={WIDE_CELL_SX}>
        {renderDigestCell(app, idx)}
      </TableCell>
      <TableCell sx={NOWRAP_SX}>
        {/* Same door as the phone card's "Prep" button
            (ApplicationCard.js) -- unconditional, no
            per-row prefetch of pack existence, honest
            absent-state copy lives inside the dialog once
            opened. */}
        <Button size="small" sx={LINK_BUTTON_SX} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "prep" })}>
          View prep
        </Button>
      </TableCell>
      <TableCell sx={WIDE_CELL_SX}>
        {pos?.description ? (
          <Box sx={STACK_SX}>
            <span style={CLAMPED_TEXT_STYLE}>
              {pos.description}
            </span>
            <Button size="small" sx={LINK_BUTTON_SX} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "jd" })}>
              View full
            </Button>
          </Box>
        ) : "—"}
      </TableCell>
      <TableCell sx={RESUME_CELL_SX}>
        {/* N132: a cover-only row has no resume text but still
            has documents to open, so the cell renders on
            either (not just `resume?.content`) and the
            View/Edit control is gated on stored documents. */}
        {resume?.content || canPreview ? (
          <Box sx={STACK_SX}>
            {resume?.content && (
              <span style={CLAMPED_TEXT_STYLE}>
                {resume.content}
              </span>
            )}
            <Box sx={BUTTON_ROW_SX}>
              {resume?.content && (
                <Button size="small" sx={LINK_BUTTON_SX} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "resume" })}>
                  View full
                </Button>
              )}
              {resume?.content && renderDownloadControl(pos, resume)}
              {canPreview && (
                <Button size="small" sx={LINK_BUTTON_SX} onClick={() => openApplicationPreview(app)}>
                  View/Edit
                </Button>
              )}
            </Box>
          </Box>
        ) : "—"}
      </TableCell>
      <TableCell>
        {postingHref && (
          <Button size="small" href={postingHref} target="_blank" rel="noopener noreferrer" sx={NOWRAP_SX}>
            Posting ↗
          </Button>
        )}
      </TableCell>
      <TableCell sx={NOWRAP_SX}>
        <Box sx={ACTIONS_SX}>
          <Button
            size="small"
            sx={ACTION_BUTTON_SX}
            onClick={() => askAiAbout({
              label: `${pos?.company || "Application"}${pos?.title ? ` — ${pos.title}` : ""}`,
              content: buildApplicationContextString(app),
            })}
          >
            Ask AI
          </Button>
          <Button
            size="small"
            sx={ACTION_BUTTON_SX}
            onClick={() => openEditApplicationDialog(app)}
          >
            Edit
          </Button>
          <Button
            size="small"
            color="error"
            sx={ACTION_BUTTON_SX}
            onClick={() => handleDeleteApplication(app)}
          >
            Delete
          </Button>
        </Box>
      </TableCell>
    </TableRow>
  );
}

export default memo(ApplicationRow);
