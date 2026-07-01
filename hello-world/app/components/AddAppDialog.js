"use client";

import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import FormDialog from "./FormDialog";

export default function AddAppDialog({
  addAppDialog,
  setAddAppDialog,
  addAppSaving,
  addAppError,
  addAppResumeFile,
  setAddAppResumeFile,
  handleSaveAddApplication,
}) {
  return (
    <FormDialog
      open={addAppDialog.open}
      onClose={() => setAddAppDialog((prev) => ({ ...prev, open: false }))}
      title="Add Application"
      contentSx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
      error={addAppError}
      busy={addAppSaving}
      onSubmit={handleSaveAddApplication}
      submitLabel="Add Application"
    >
      <TextField
        label="Company"
        value={addAppDialog.company}
        onChange={(e) => setAddAppDialog((prev) => ({ ...prev, company: e.target.value }))}
        fullWidth
        size="small"
        required
      />
      <TextField
        label="Role"
        value={addAppDialog.role}
        onChange={(e) => setAddAppDialog((prev) => ({ ...prev, role: e.target.value }))}
        fullWidth
        size="small"
        required
      />
      <FormControl fullWidth size="small">
        <InputLabel id="add-app-status-label">Status</InputLabel>
        <Select
          labelId="add-app-status-label"
          label="Status"
          value={addAppDialog.status}
          onChange={(e) => setAddAppDialog((prev) => ({ ...prev, status: e.target.value }))}
        >
          <MenuItem value="tailored">Tailored</MenuItem>
          <MenuItem value="applied">Applied</MenuItem>
          <MenuItem value="phone_screen">Phone Screen</MenuItem>
          <MenuItem value="interviewing">Interviewing</MenuItem>
          <MenuItem value="offer">Offer</MenuItem>
          <MenuItem value="accepted">Accepted</MenuItem>
          <MenuItem value="rejected">Rejected</MenuItem>
          <MenuItem value="withdrawn">Withdrawn</MenuItem>
        </Select>
      </FormControl>
      <TextField
        type="date"
        label="Applied"
        value={addAppDialog.appliedAt}
        onChange={(e) => setAddAppDialog((prev) => ({ ...prev, appliedAt: e.target.value }))}
        fullWidth
        size="small"
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label="Application URL"
        value={addAppDialog.applicationUrl}
        onChange={(e) => setAddAppDialog((prev) => ({ ...prev, applicationUrl: e.target.value }))}
        fullWidth
        size="small"
        placeholder="https://..."
      />
      <TextField
        label="Job Description"
        value={addAppDialog.description}
        onChange={(e) => setAddAppDialog((prev) => ({ ...prev, description: e.target.value }))}
        fullWidth
        multiline
        minRows={6}
        size="small"
      />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Box component="label" sx={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          Resume used for this application (optional)
        </Box>
        <input
          type="file"
          accept=".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          onChange={(e) => setAddAppResumeFile(e.target.files?.[0] || null)}
        />
        {addAppResumeFile ? (
          <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Selected: {addAppResumeFile.name}
          </Box>
        ) : (
          <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Optional. Upload a .docx (or .txt) of the resume you sent with this application.
          </Box>
        )}
      </Box>
    </FormDialog>
  );
}
