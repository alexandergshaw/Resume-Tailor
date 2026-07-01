"use client";

import TextField from "@mui/material/TextField";
import FormDialog from "./FormDialog";

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

  const heading =
    addCommunicationDialog.company || addCommunicationDialog.role
      ? ` — ${addCommunicationDialog.company || "Unknown Company"}${addCommunicationDialog.role ? ` / ${addCommunicationDialog.role}` : ""}`
      : "";

  return (
    <FormDialog
      open={addCommunicationDialog.open}
      onClose={close}
      title={`Add Recruiter Communication${heading}`}
      maxWidth="md"
      contentSx={{ pt: 2 }}
      error={communicationError}
      busy={communicationSaving}
      onSubmit={handleSaveCommunication}
      submitDisabled={!addCommunicationDialog.body.trim()}
      submitLabel="Save Communication"
    >
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
    </FormDialog>
  );
}
