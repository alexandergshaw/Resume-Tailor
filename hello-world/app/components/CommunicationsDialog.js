"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useIsMobile } from "../hooks/useResponsive";

export default function CommunicationsDialog({
  communicationsDialog,
  setCommunicationsDialog,
}) {
  const isMobile = useIsMobile();
  const close = () =>
    setCommunicationsDialog({
      open: false,
      applicationId: null,
      company: "",
      role: "",
      loading: false,
      error: "",
      items: [],
    });

  return (
    <Dialog
      open={communicationsDialog.open}
      onClose={close}
      maxWidth="md"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>
        Recruiter Communications
        {(communicationsDialog.company || communicationsDialog.role) ? ` — ${communicationsDialog.company || "Unknown Company"}${communicationsDialog.role ? ` / ${communicationsDialog.role}` : ""}` : ""}
      </DialogTitle>
      <DialogContent dividers sx={{ maxHeight: "70vh" }}>
        {communicationsDialog.loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : communicationsDialog.error ? (
          <p style={{ color: "var(--danger)", margin: 0 }}>{communicationsDialog.error}</p>
        ) : communicationsDialog.items.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>No recruiter communications logged yet.</p>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {communicationsDialog.items.map((item) => (
              <Box
                key={item.id}
                sx={{
                  p: 1.5,
                  borderRadius: 2.5,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-soft)",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
                  <Chip size="small" label={item.direction || "inbound"} variant="outlined" />
                  <Chip size="small" label={item.type || "email"} variant="outlined" />
                  <Box component="span" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {item.communicated_at ? new Date(item.communicated_at).toLocaleString() : "Logged communication"}
                  </Box>
                </Box>
                {item.subject ? (
                  <Box sx={{ fontWeight: 700, mb: 0.75 }}>{item.subject}</Box>
                ) : null}
                {(item.sender_name || item.sender_email || item.sender_title) ? (
                  <Box sx={{ mb: 0.75, fontSize: 12, color: "var(--text-secondary)" }}>
                    {[item.sender_name, item.sender_title, item.sender_email].filter(Boolean).join(" · ")}
                  </Box>
                ) : null}
                <Box sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 13.5 }}>
                  {item.body || "—"}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
