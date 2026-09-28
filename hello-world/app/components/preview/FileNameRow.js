"use client";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CopyDocumentControl from "./CopyDocumentControl";
import { titleCopyOutcome } from "./copyOutcome";

// Presentational extraction of the docx File-name row (previously inline in
// DocumentPreviewDialog.js). The dialog decides WHETHER to render this at all
// (DOCX_SCOPES.includes(tab) && available(tab)) -- this component assumes it
// should.
//
// N63 ("give copyable titles for each document"): the file-name/title copy
// control is co-located here, beside the field it copies, rather than
// crowding DialogActions' already-dense bar -- keeping the affordance next to
// its referent. It is enabled UNCONDITIONALLY (copyState="ready", a constant,
// never `copyStateFor`/`docState`-derived): the title is resolvable from props
// the instant the scope is available, and must not go dark just because the
// preview body is still loading (unlike the document-TEXT copy control, which
// does gate on that).
//
// DOM invariant the drive suite depends on (DocumentPreviewDialog.drive.test.js
// fileNameInput()): a <span> reading exactly "File name" whose PARENT element
// contains the TextField's <input> -- both stay siblings under the same outer
// Box as before the extraction.
export default function FileNameRow({
  tab,
  fileNameDraft,
  setFileNameDraft,
  commitFileName,
  placeholder,
  mode,
  saveStatus,
  title,
  onCopyOutcome,
}) {
  return (
    <Box sx={{ px: { xs: 1.25, sm: 2 }, py: 0.75, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
      <Box component="span" sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
        File name
      </Box>
      <TextField
        size="small"
        value={fileNameDraft}
        onChange={(e) => setFileNameDraft(e.target.value)}
        onBlur={commitFileName}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        placeholder={placeholder}
        InputProps={{
          endAdornment: <InputAdornment position="end" sx={{ color: "var(--text-muted)" }}>.docx</InputAdornment>,
        }}
        sx={{ flex: 1, minWidth: 200, maxWidth: 460, bgcolor: "var(--bg-surface)", borderRadius: 1 }}
      />
      <CopyDocumentControl
        getText={() => title}
        copyState="ready"
        scopeLabel={placeholder}
        accessibleName={`Copy the ${String(placeholder).toLowerCase()} file name`}
        label="Copy file name"
        variant="outlined"
        mode={mode}
        onOutcome={onCopyOutcome}
        outcomeFor={titleCopyOutcome}
      />
      {mode === "edit" ? (
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {saveStatus === "saving" ? (
            <>
              <CircularProgress size={13} sx={{ color: "var(--text-muted)" }} />
              Saving…
            </>
          ) : (
            <>
              <CheckCircleIcon sx={{ fontSize: 15, color: "var(--success)" }} />
              Saved
            </>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
