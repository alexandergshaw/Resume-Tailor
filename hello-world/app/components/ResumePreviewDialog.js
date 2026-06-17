"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import DescriptionIcon from "@mui/icons-material/Description";
import { useIsMobile } from "../hooks/useResponsive";

// Preview + edit the tailored resume for a tracked posting. Edits are saved back
// as the resume associated with that posting; the .docx can be downloaded here.
export default function ResumePreviewDialog({
  open,
  jobTitle = "",
  company = "",
  initialValue = "",
  onClose,
  onSave,
  onDownload,
  downloadDisabled = false,
  downloadHint = "",
  busy = false,
  notice = "",
  error = "",
}) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState(initialValue);
  const [prevOpen, setPrevOpen] = useState(open);

  // Re-seed the editor each time the dialog transitions to open (React's
  // "adjust state during render" pattern — no effect needed).
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDraft(initialValue);
  }

  const heading = [company, jobTitle].filter(Boolean).join(" · ");

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 1 }}>
        Tailored resume{heading ? ` — ${heading}` : ""}
      </DialogTitle>
      <DialogContent dividers>
        <TextField
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          multiline
          fullWidth
          minRows={isMobile ? 12 : 20}
          placeholder="The tailored resume text will appear here."
          sx={{
            "& .MuiInputBase-input": {
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "0.82rem",
              lineHeight: 1.55,
            },
          }}
        />
        {error ? (
          <Box sx={{ mt: 1, color: "var(--danger, #d32f2f)", fontSize: "0.85rem" }}>{error}</Box>
        ) : notice ? (
          <Box sx={{ mt: 1, color: "#2e7d32", fontSize: "0.85rem" }}>{notice}</Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Close
        </Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={downloadDisabled ? downloadHint : ""}>
          <span>
            <Button
              onClick={() => onDownload(draft)}
              disabled={downloadDisabled || busy || !draft.trim()}
              startIcon={<DescriptionIcon />}
              variant="outlined"
              sx={{ textTransform: "none" }}
            >
              Download .docx
            </Button>
          </span>
        </Tooltip>
        <Button
          onClick={() => onSave(draft)}
          disabled={busy || !draft.trim()}
          variant="contained"
          sx={{ textTransform: "none" }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
