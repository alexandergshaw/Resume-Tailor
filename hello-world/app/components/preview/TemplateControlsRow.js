"use client";

import Box from "@mui/material/Box";
import SetDefaultTemplateControl from "./SetDefaultTemplateControl";
import SwitchTemplateControl from "./SwitchTemplateControl";

// The template controls shared by the preview modal's DOCX tabs: "Set as
// default template" (N97) and "Switch template…" (N151c). Rendered by
// DocumentPreviewDialog as a SIBLING of DialogActions, never inside it --
// DocumentPreviewDialog.copy.test.js's AC-C12 census pins the action bar's
// button-shaped-control count exactly. Extracted from the dialog, whose line
// ceiling (AC-C13.3) leaves no room for a second control inline. The caller
// gates it to DOCX_SCOPES with an available document, so it is absent on the
// email tab (resume_templates.kind has no 'email').
export default function TemplateControlsRow({
  scope,
  busy,
  onSetDefault,
  currentUser,
  hasVersions,
  commitDraft,
  onRegenerate,
}) {
  return (
    <Box sx={{ px: { xs: 1.25, sm: 2 }, pt: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
      <SetDefaultTemplateControl scope={scope} disabled={busy} onClick={onSetDefault} />
      {/* Keyed by scope: the picker's library list and last outcome belong to one document kind. */}
      <SwitchTemplateControl
        key={scope}
        scope={scope}
        busy={busy}
        currentUser={currentUser}
        hasVersions={hasVersions}
        commitDraft={commitDraft}
        onRegenerate={onRegenerate}
      />
    </Box>
  );
}
