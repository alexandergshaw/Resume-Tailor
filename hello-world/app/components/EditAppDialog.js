"use client";

import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import FormDialog from "./FormDialog";
import {
  USER_SELECTABLE_STATUSES,
  USER_SELECTABLE_STATUSES_ORDERED,
  STATUS_LABELS,
} from "../../lib/applications/statusVocabulary";

export default function EditAppDialog({
  editAppDialog,
  setEditAppDialog,
  editAppSaving,
  editAppError,
  editAppResumeFile,
  setEditAppResumeFile,
  handleSaveEditApplication,
}) {
  return (
    <FormDialog
      open={editAppDialog.open}
      onClose={() => setEditAppDialog((prev) => ({ ...prev, open: false }))}
      title="Edit Application"
      contentSx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
      error={editAppError}
      busy={editAppSaving}
      onSubmit={handleSaveEditApplication}
      submitLabel="Save Changes"
    >
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
          {USER_SELECTABLE_STATUSES_ORDERED.map((value) => (
            <MenuItem key={value} value={value}>
              {STATUS_LABELS[value]}
            </MenuItem>
          ))}
          {/* A row can sit at a status a human never picks (today: only
              "auto_queued", which loadApplications does not exclude from
              Tracking) — offer it as one appended, ENABLED item rather than
              silently coercing the Select to a value not in its own list. */}
          {editAppDialog.status && !USER_SELECTABLE_STATUSES.includes(editAppDialog.status) ? (
            <MenuItem value={editAppDialog.status}>
              {`${STATUS_LABELS[editAppDialog.status] || editAppDialog.status} (current)`}
            </MenuItem>
          ) : null}
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
    </FormDialog>
  );
}
