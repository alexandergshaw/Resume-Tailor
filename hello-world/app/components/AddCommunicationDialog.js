"use client";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";

export default function AddCommunicationDialog({
  addCommunicationDialog,
  setAddCommunicationDialog,
  communicationError,
  setCommunicationError,
  communicationSaving,
  handleSaveCommunication,
}) {
  const close = () => {
    setCommunicationError("");
    setAddCommunicationDialog({ open: false, applicationId: null, company: "", role: "", body: "" });
  };

  return (
    <Dialog
      open={addCommunicationDialog.open}
      onClose={close}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        Add Recruiter Communication
        {(addCommunicationDialog.company || addCommunicationDialog.role) ? ` — ${addCommunicationDialog.company || "Unknown Company"}${addCommunicationDialog.role ? ` / ${addCommunicationDialog.role}` : ""}` : ""}
      </DialogTitle>
      <DialogContent dividers sx={{ pt: 2 }}>
        <TextField
          label="Paste communication"
          placeholder="Paste the recruiter email, LinkedIn message, or call notes here..."
          value={addCommunicationDialog.body}
          onChange={(e) => setAddCommunicationDialog((prev) => ({ ...prev, body: e.target.value }))}
          fullWidth
          multiline
          minRows={12}
          sx={{
            "& .MuiOutlinedInput-root": {
              alignItems: "flex-start",
              borderRadius: 2.5,
            },
          }}
        />
        {communicationError ? (
          <p style={{ color: "var(--error, #d32f2f)", margin: "12px 0 0" }}>{communicationError}</p>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={communicationSaving || !addCommunicationDialog.body.trim()}
          onClick={handleSaveCommunication}
        >
          {communicationSaving ? "Saving..." : "Save Communication"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
