"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";

export default function BatchTailorDialog({
  batchTailorDialog,
  setBatchTailorDialog,
  batchTailorState,
  startBatchTailor,
}) {
  return (
    <Dialog
      open={batchTailorDialog.open}
      onClose={() => {
        if (batchTailorState.running) return;
        setBatchTailorDialog({ open: false, candidates: [], selectedIds: [] });
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        Tailor {batchTailorDialog.selectedIds.length} of {batchTailorDialog.candidates.length} job
        {batchTailorDialog.candidates.length === 1 ? "" : "s"}?
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ fontSize: 13, color: "var(--text-secondary)", mb: 1 }}>
          Each selected job will be tracked, run through the LLM, and the
          tailored resume saved to your library. Choose whether to also
          download the .docx files now.
        </Box>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
          <Button
            size="small"
            onClick={() => {
              setBatchTailorDialog((prev) => {
                const allSelected = prev.selectedIds.length === prev.candidates.length;
                return {
                  ...prev,
                  selectedIds: allSelected ? [] : prev.candidates.map((c) => c.id),
                };
              });
            }}
            disabled={batchTailorState.running || batchTailorDialog.candidates.length === 0}
          >
            {batchTailorDialog.selectedIds.length === batchTailorDialog.candidates.length
              ? "Deselect all"
              : "Select all"}
          </Button>
        </Box>
        <Box
          sx={{
            maxHeight: 320,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 1,
          }}
        >
          {batchTailorDialog.candidates.map((job) => {
            const checked = batchTailorDialog.selectedIds.includes(job.id);
            return (
              <Box
                key={job.id}
                component="label"
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 1,
                  px: 1,
                  py: 0.5,
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                  "&:last-of-type": { borderBottom: "none" },
                }}
              >
                <Checkbox
                  size="small"
                  checked={checked}
                  disabled={batchTailorState.running}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setBatchTailorDialog((prev) => {
                      const set = new Set(prev.selectedIds);
                      if (next) set.add(job.id);
                      else set.delete(job.id);
                      return { ...prev, selectedIds: Array.from(set) };
                    });
                  }}
                  sx={{ p: 0.5, mt: 0.25 }}
                />
                <Box sx={{ fontSize: 13, lineHeight: 1.3 }}>
                  <strong>{job.company || "Unknown"}</strong>
                  {job.title ? ` — ${job.title}` : ""}
                </Box>
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => setBatchTailorDialog({ open: false, candidates: [], selectedIds: [] })}
          disabled={batchTailorState.running}
        >
          Cancel
        </Button>
        <Button
          onClick={() => startBatchTailor(true)}
          disabled={batchTailorState.running || batchTailorDialog.selectedIds.length === 0}
        >
          Tailor only (no download)
        </Button>
        <Button
          variant="contained"
          onClick={() => startBatchTailor(false)}
          disabled={batchTailorState.running || batchTailorDialog.selectedIds.length === 0}
        >
          Tailor &amp; download
        </Button>
      </DialogActions>
    </Dialog>
  );
}
