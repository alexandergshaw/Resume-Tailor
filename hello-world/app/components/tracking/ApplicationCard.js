"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import DescriptionIcon from "@mui/icons-material/Description";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import {
  STAGE_TYPE_LABELS,
  createStageDialogState,
  formatDateTimeLocalInputValue,
} from "@/lib/tracking/stages";
import { TOUCH_TARGET_SX, BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";

// Extracted from TrackingTab.js (AC-T: tracking cards' touch targets and text
// wrapping) -- that file sat at 955 of its 1000-line cap, and this row body
// alone cost 60-90 lines to fix in place. This is a faithful move, not a
// rewrite: the tests that cover this card (TrackingTab.touch.test.js,
// TrackingTab.digest.test.js, TrackingTab.keyboard.test.js) all select
// through `[data-app-id]`, roles and accessible names, never through file
// structure, so the extraction is invisible to them as long as `data-app-id`
// stays on this component's root -- it does.
//
// Below the `md` breakpoint TrackingTab.js renders one of these per visible
// application instead of the desktop table's <TableRow>. `renderDigestCell`
// is passed in rather than duplicated here because it is ALSO called from
// the desktop table cell in TrackingTab.js -- one decision tree, two render
// call sites, per that function's own comment.

// The email-classification pill's colours. A fixed lookup, not row data, so
// it lives at module scope rather than being rebuilt on every render or
// threaded through as a prop. TrackingTab.js's own desktop table branch
// keeps an identical copy for its own cell -- out of scope for this pass.
const EMAIL_CHIP_STYLES = {
  confirmation: { label: "Applied", color: "var(--accent-hover)", bg: "var(--accent-soft)" },
  interview: { label: "Interview", color: "var(--success)", bg: "var(--success-soft)" },
  rejection: { label: "Rejected", color: "var(--danger-hover)", bg: "var(--danger-soft)" },
};

export default function ApplicationCard({
  app,
  idx,
  applicationStages,
  emailClassificationsByAppId,
  resumeFile,
  isDocxResume,
  highlightedAppId,
  renderDigestCell,
  setAppDialog,
  setStageError,
  setStageDialog,
  openCommsInAppDialog,
  askAiAbout,
  buildApplicationContextString,
  openEditApplicationDialog,
  handleDeleteApplication,
  downloadDocxFiles,
}) {
  const pos = app.positions;
  // `positions` is a SHARED catalogue - no user_id column, and
  // positions_update_authenticated lets any signed-in account overwrite any
  // row - so `pos.url` is a value another user controls. Refused URLs render
  // no anchor at all, not a dead one; see lib/url/safeExternalHref.js.
  const postingHref = safeExternalHref(app.application_url || pos?.url);
  const resume = app.generated_resumes;
  const stages = applicationStages[app.id] || [];
  const emailClassification = emailClassificationsByAppId[app.id] ?? null;
  const emailChip = emailClassification ? EMAIL_CHIP_STYLES[emailClassification] : null;
  const canDownloadResume = !!resume?.content && !!resumeFile && isDocxResume(resumeFile);

  return (
    <Box
      data-app-id={app.id}
      sx={{
        border: "1px solid var(--border)",
        borderRadius: 2,
        p: 1.75,
        backgroundColor: "var(--bg-surface)",
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
        ...(highlightedAppId === app.id && {
          outline: "2px solid var(--accent)",
          outlineOffset: "-2px",
          backgroundColor: "var(--accent-soft)",
        }),
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          {/* AC-T5: bare Boxes had no `overflowWrap`, and app/globals.css sets
              `html { overflow-x: hidden }`, so a long unbroken company/title
              value was DELETED rather than scrollable. BREAK_LONG_WORDS_SX is
              deliberately not breakpoint-scoped -- see its own comment in
              app/theme/mobileSx.js -- because that clipping happens at every
              width, not just on phones. */}
          <Box sx={{ fontWeight: 700, fontSize: "1rem", lineHeight: 1.25, ...BREAK_LONG_WORDS_SX }}>
            {pos?.company || "—"}
          </Box>
          <Box sx={{ color: "var(--text-secondary)", fontSize: "0.9rem", mt: 0.25, ...BREAK_LONG_WORDS_SX }}>
            {pos?.title || "—"}
          </Box>
          {pos?.posted_at && (
            <Box sx={{ fontSize: "0.7rem", color: "var(--text-secondary)", mt: 0.25 }}>
              Posted {new Date(pos.posted_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </Box>
          )}
        </Box>
        {emailChip && (
          <Box sx={{ fontSize: "0.72rem", fontWeight: 700, color: emailChip.color, bgcolor: emailChip.bg, px: 0.75, py: 0.25, borderRadius: 1, flexShrink: 0, letterSpacing: "0.03em" }}>
            {emailChip.label}
          </Box>
        )}
      </Box>

      <Box sx={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
        Applied: {app.applied_at ? new Date(app.applied_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
      </Box>

      {/* Company & role research - card layout's version of the desktop
          table's digest column; the table alone would make this invisible on
          a phone. */}
      <Box sx={{ fontSize: "0.8rem" }}>{renderDigestCell(app, idx)}</Box>

      {stages.length > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
          {stages.map((stage) => {
            const stageLabel = `${stage.stage_name || STAGE_TYPE_LABELS[stage.stage_type] || stage.stage_type}${stage.outcome && stage.outcome !== "pending" ? ` · ${stage.outcome}` : ""}`;
            return (
              <Chip
                key={stage.id}
                label={stageLabel}
                size="small"
                variant="outlined"
                // AC-T3: the ONLY route into the stage dialog from the phone
                // card. Raised to the shared 44px floor instead of Chip's
                // native 24px -- a clickable Chip already renders through
                // ButtonBase, so it stays inside the app-wide focus-ring
                // system (`.MuiButtonBase-root.Mui-focusVisible`) for free.
                sx={TOUCH_TARGET_SX}
                onClick={() => {
                  setStageError("");
                  setStageDialog(createStageDialogState({
                    open: true,
                    applicationId: app.id,
                    stageId: stage.id,
                    stageName: stage.stage_name || "",
                    // No "phone_screen" fallback literal here: omitting the key
                    // when the stage has no stage_type lets
                    // createStageDialogState's OWN default (lib/tracking/stages.js)
                    // apply -- the single home for that default, rather than a
                    // second hand-typed copy of it in this file. (This is
                    // interview_stages.stage_type, not applications.status --
                    // the two vocabularies coincidentally share this one
                    // spelling; see lib/applications/statusVocabularySweep.test.js's
                    // KNOWN_FALSE_POSITIVES entry for TrackingTab.js, which
                    // documents the exact same construct.)
                    ...(stage.stage_type ? { stageType: stage.stage_type } : {}),
                    scheduledAt: formatDateTimeLocalInputValue(stage.scheduled_at),
                    durationMinutes: stage.duration_minutes ? String(stage.duration_minutes) : "",
                    outcome: stage.outcome || "pending",
                    interviewerNames: (stage.interviewer_names || []).join(", "),
                    notes: stage.notes || "",
                  }));
                }}
              />
            );
          })}
        </Box>
      )}

      {/* AC-T1: eight `size="small"` action buttons with no height override
          computed to ~30.75px against this repo's 44px bar -- raised with
          the shared TOUCH_TARGET_SX contract, whose `sm: "auto"` branch
          makes it a no-op above the phone breakpoint. */}
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
        {pos?.description && (
          <Button size="small" variant="outlined" sx={TOUCH_TARGET_SX} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "jd" })}>JD</Button>
        )}
        {resume?.content && (
          <Button size="small" variant="outlined" sx={TOUCH_TARGET_SX} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "resume" })}>Resume</Button>
        )}
        {canDownloadResume && (
          <Button
            size="small"
            variant="outlined"
            sx={TOUCH_TARGET_SX}
            startIcon={<DescriptionIcon fontSize="small" />}
            onClick={async () => {
              const lines = Array.isArray(resume.content_lines) && resume.content_lines.length > 0
                ? resume.content_lines
                : (resume.content || "").split("\n");
              const err = await downloadDocxFiles({ jobTitle: pos?.title || "resume", company: pos?.company, result: resume.content, resultLines: lines, coverLetterResultLines: [], docxPath: resume.docx_path || "" });
              if (err) window.alert(err);
            }}
          >
            Download
          </Button>
        )}
        <Button size="small" variant="outlined" sx={TOUCH_TARGET_SX} onClick={() => openCommsInAppDialog(app, idx)}>Comms</Button>
        {postingHref && (
          <Button size="small" variant="outlined" sx={TOUCH_TARGET_SX} href={postingHref} target="_blank" rel="noopener noreferrer">Posting ↗</Button>
        )}
      </Box>

      {/* AC-T4: Delete used to sit `gap: 0.5` (4px) from Edit, both
          undersized -- raised to the theme's 1-unit (8px) gap along with the
          floor above. Either an 8px gap or `ml: "auto"` on Delete clears the
          criterion; a uniform row gap was chosen so Ask AI keeps the same
          spacing as Edit/Delete rather than reading as a separate group. */}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", borderTop: "1px solid var(--border)", pt: 1 }}>
        <Button
          size="small"
          sx={TOUCH_TARGET_SX}
          onClick={() => askAiAbout({
            label: `${pos?.company || "Application"}${pos?.title ? ` — ${pos.title}` : ""}`,
            content: buildApplicationContextString(app),
          })}
        >
          Ask AI
        </Button>
        <Button size="small" sx={TOUCH_TARGET_SX} onClick={() => openEditApplicationDialog(app)}>Edit</Button>
        <Button size="small" color="error" sx={TOUCH_TARGET_SX} onClick={() => handleDeleteApplication(app)}>Delete</Button>
      </Box>
    </Box>
  );
}
