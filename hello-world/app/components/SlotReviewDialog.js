"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useIsMobile } from "../hooks/useResponsive";

// Review/override the external Resume Tailor API's proposed slot values, then
// generate the .docx with the edited values. Slots arrive asynchronously after
// the dialog opens, so the editable draft re-seeds whenever the slots change.
export default function SlotReviewDialog({
  open,
  loading = false,
  error = "",
  slots = [],
  onClose,
  onGenerate,
  busy = false,
}) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState({});
  const [prevSlots, setPrevSlots] = useState(slots);

  if (slots !== prevSlots) {
    setPrevSlots(slots);
    const seeded = {};
    for (const slot of slots || []) {
      if (slot?.key) seeded[slot.key] = typeof slot.value === "string" ? slot.value : "";
    }
    setDraft(seeded);
  }

  const setValue = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 1 }}>Review fields</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Box sx={{ color: "var(--danger, #d32f2f)", fontSize: "0.9rem" }}>{error}</Box>
        ) : slots.length === 0 ? (
          <Box sx={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            No fields to review for this posting.
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Edit any proposed value, then generate the document with your changes.
            </Box>
            {slots.map((slot) => (
              <Box key={slot.key} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
                  <Box sx={{ fontWeight: 600, fontSize: "0.85rem" }}>{slot.name || slot.key}</Box>
                  {slot.strategy ? (
                    <Box sx={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                      {slot.strategy}
                    </Box>
                  ) : null}
                </Box>
                {slot.note ? (
                  <Box sx={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{slot.note}</Box>
                ) : null}
                <TextField
                  size="small"
                  fullWidth
                  multiline
                  maxRows={6}
                  value={draft[slot.key] ?? ""}
                  onChange={(e) => setValue(slot.key, e.target.value)}
                  placeholder={slot.value ? "" : "Needs your input"}
                />
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          onClick={() => onGenerate(draft)}
          disabled={busy || loading || slots.length === 0}
          sx={{ textTransform: "none" }}
        >
          {busy ? "Generating…" : "Generate with these fields"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
