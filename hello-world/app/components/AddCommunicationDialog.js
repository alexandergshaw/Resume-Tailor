"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
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
    setAddCommunicationDialog({ open: false, applicationId: null, company: "", role: "", body: "", files: [] });
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    setAddCommunicationDialog((prev) => ({
      ...prev,
      files: [...(prev.files || []), ...selectedFiles],
    }));
    e.target.value = "";
  };

  const handleRemoveFile = (index) => {
    setAddCommunicationDialog((prev) => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index),
    }));
  };

  const heading =
    addCommunicationDialog.company || addCommunicationDialog.role
      ? ` — ${addCommunicationDialog.company || "Unknown Company"}${addCommunicationDialog.role ? ` / ${addCommunicationDialog.role}` : ""}`
      : "";

  const files = addCommunicationDialog.files || [];
  const submitDisabled = !addCommunicationDialog.body.trim() && files.length === 0;

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
      submitDisabled={submitDisabled}
      submitLabel="Save Communication"
    >
      <Stack spacing={2}>
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

        <Box>
          <Button
            variant="outlined"
            component="label"
            sx={{ mb: 1 }}
          >
            Attach Files
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.gif,.webp"
              hidden
              onChange={handleFileSelect}
            />
          </Button>
        </Box>

        {files.length > 0 && (
          <Box>
            <Box sx={{ mb: 1, fontSize: 12, color: "var(--text-secondary)" }}>
              Attached Files:
            </Box>
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
              {files.map((file, index) => (
                <Chip
                  key={index}
                  label={`${file.name} (${(file.size / 1024).toFixed(0)} KB)`}
                  onDelete={() => handleRemoveFile(index)}
                  size="small"
                  variant="outlined"
                />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </FormDialog>
  );
}
