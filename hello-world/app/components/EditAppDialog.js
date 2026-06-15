"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { useIsMobile } from "../hooks/useResponsive";

export default function EditAppDialog({
  editAppDialog,
  setEditAppDialog,
  editAppSaving,
  editAppError,
  editAppResumeFile,
  setEditAppResumeFile,
  handleSaveEditApplication,
}) {
  const isMobile = useIsMobile();
  return (
    <Dialog
      open={editAppDialog.open}
      onClose={() => {
        if (editAppSaving) return;
        setEditAppDialog((prev) => ({ ...prev, open: false }));
      }}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (editAppSaving) return;
          handleSaveEditApplication();
        }}
      >
      <DialogTitle>Edit Application</DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
        <TextField
          label="Company"
          value={editAppDialog.company}
          onChange={(e) => setEditAppDialog((prev) => ({ ...prev, company: e.target.value }))}
          fullWidth
          size="small"
        />
        <TextField
          label="Role"
          value={editAppDialog.role}
          onChange={(e) => setEditAppDialog((prev) => ({ ...prev, role: e.target.value }))}
          fullWidth
          size="small"
        />
        <FormControl fullWidth size="small">
          <InputLabel id="edit-app-status-label">Status</InputLabel>
          <Select
            labelId="edit-app-status-label"
            label="Status"
            value={editAppDialog.status}
            onChange={(e) => setEditAppDialog((prev) => ({ ...prev, status: e.target.value }))}
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
          value={editAppDialog.appliedAt}
          onChange={(e) => setEditAppDialog((prev) => ({ ...prev, appliedAt: e.target.value }))}
          fullWidth
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="Application URL"
          value={editAppDialog.applicationUrl}
          onChange={(e) => setEditAppDialog((prev) => ({ ...prev, applicationUrl: e.target.value }))}
          fullWidth
          size="small"
          placeholder="https://..."
        />
        <TextField
          label="Job Description"
          value={editAppDialog.description}
          onChange={(e) => setEditAppDialog((prev) => ({ ...prev, description: e.target.value }))}
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
            onChange={(e) => setEditAppResumeFile(e.target.files?.[0] || null)}
          />
          {editAppResumeFile ? (
            <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
              New upload: {editAppResumeFile.name}
            </Box>
          ) : (
            <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Upload a .docx (or .txt) to replace the resume associated with this row. Leave empty to keep the existing resume.
            </Box>
          )}
        </Box>
        {editAppError ? (
          <p style={{ color: "var(--error, #d32f2f)", margin: 0 }}>{editAppError}</p>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => setEditAppDialog((prev) => ({ ...prev, open: false }))}
          disabled={editAppSaving}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSaveEditApplication}
          disabled={editAppSaving}
          type="submit"
        >
          {editAppSaving ? "Saving..." : "Save Changes"}
        </Button>
      </DialogActions>
      </Box>
    </Dialog>
  );
}
