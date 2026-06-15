"use client";

import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useIsMobile } from "../hooks/useResponsive";

import { AUTOFILL_FIELDS, buildBookmarklet, profileHasValues } from "@/lib/autofill/buildBookmarklet";

const EMPTY_PROFILE = AUTOFILL_FIELDS.reduce((acc, f) => {
  acc[f.key] = "";
  return acc;
}, {});

// Editable profile used to auto-fill application forms, plus a draggable
// bookmarklet generated from the saved values. Dragging the bookmarklet to the
// bookmarks bar is a one-time setup; clicking "Auto Fill" on a card opens the
// posting and copies the same bookmarklet to the clipboard for quick use.
export default function AutofillProfileDialog({ open, onClose, profile, onSaved }) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Reset the draft from the latest saved profile whenever the dialog opens.
  useEffect(() => {
    if (!open) return undefined;
    const handle = setTimeout(() => {
      setDraft({ ...EMPTY_PROFILE, ...(profile || {}) });
      setError("");
    }, 0);
    return () => clearTimeout(handle);
  }, [open, profile]);

  const bookmarklet = useMemo(() => buildBookmarklet(draft), [draft]);
  const hasValues = profileHasValues(draft);

  const setField = (key, value) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/user-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || `Request failed (${res.status})`);
      }
      if (typeof onSaved === "function") onSaved(payload.profile || {});
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save your autofill profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => (saving ? null : onClose())} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle>Autofill profile</DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          These values are used by <strong>Auto Fill</strong> to populate application forms on a
          posting page. Drag the button below to your bookmarks bar once; then on any posting click
          a card&apos;s <strong>Auto Fill</strong> to open it and copy the same bookmarklet.
        </Typography>

        {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
          {AUTOFILL_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              value={draft[f.key] || ""}
              onChange={(e) => setField(f.key, e.target.value)}
              size="small"
              fullWidth
            />
          ))}
        </Box>

        <Box
          sx={{
            mt: 0.5,
            p: 1.5,
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexWrap: "wrap",
          }}
        >
          <Link
            href={bookmarklet}
            underline="none"
            onClick={(e) => e.preventDefault()}
            sx={{
              px: 1.5,
              py: 0.75,
              borderRadius: 1,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "grab",
              "&:hover": { bgcolor: "primary.dark" },
            }}
            draggable
          >
            Auto Fill ⤳
          </Link>
          <Typography variant="caption" color="text.secondary">
            {hasValues
              ? "Drag me to your bookmarks bar."
              : "Add at least one field above to enable the bookmarklet."}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" disabled={saving} sx={{ textTransform: "none" }}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
