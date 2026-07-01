"use client";

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

export default function StageDialog({
  stageDialog,
  setStageDialog,
  stageError,
  setStageError,
  stageSaving,
  handleSaveStage,
  createStageDialogState,
  STAGE_TYPE_OPTIONS,
  STAGE_OUTCOME_OPTIONS,
}) {
  const isMobile = useIsMobile();
  return (
    <Dialog
      open={stageDialog.open}
      onClose={() => {
        setStageError("");
        setStageDialog(createStageDialogState());
      }}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>{stageDialog.stageId ? "Edit Interview Stage" : "Add Interview Stage"}</DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
        <TextField
          label="Stage Name"
          value={stageDialog.stageName}
          onChange={(e) => setStageDialog((prev) => ({ ...prev, stageName: e.target.value }))}
          fullWidth
          size="small"
          placeholder="e.g. Technical Round 1"
        />
        <FormControl fullWidth size="small">
          <InputLabel id="stage-type-label">Type</InputLabel>
          <Select
            labelId="stage-type-label"
            value={stageDialog.stageType}
            label="Type"
            onChange={(e) => setStageDialog((prev) => ({ ...prev, stageType: e.target.value }))}
          >
            {STAGE_TYPE_OPTIONS.map(([value, label]) => (
              <MenuItem key={value} value={value}>{label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          type="datetime-local"
          label="Scheduled"
          value={stageDialog.scheduledAt}
          onChange={(e) => setStageDialog((prev) => ({ ...prev, scheduledAt: e.target.value }))}
          fullWidth
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          type="number"
          label="Duration (minutes)"
          value={stageDialog.durationMinutes}
          onChange={(e) => setStageDialog((prev) => ({ ...prev, durationMinutes: e.target.value }))}
          fullWidth
          size="small"
        />
        <FormControl fullWidth size="small">
          <InputLabel id="stage-outcome-label">Outcome</InputLabel>
          <Select
            labelId="stage-outcome-label"
            value={stageDialog.outcome}
            label="Outcome"
            onChange={(e) => setStageDialog((prev) => ({ ...prev, outcome: e.target.value }))}
          >
            {STAGE_OUTCOME_OPTIONS.map(([value, label]) => (
              <MenuItem key={value} value={value}>{label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Interviewer Names"
          value={stageDialog.interviewerNames}
          onChange={(e) => setStageDialog((prev) => ({ ...prev, interviewerNames: e.target.value }))}
          fullWidth
          size="small"
          placeholder="Comma-separated names"
          helperText="Separate multiple names with commas"
        />
        <TextField
          label="Notes"
          value={stageDialog.notes}
          onChange={(e) => setStageDialog((prev) => ({ ...prev, notes: e.target.value }))}
          fullWidth
          multiline
          rows={4}
          size="small"
        />
        {stageError ? (
          <p style={{ color: "var(--danger)", margin: 0 }}>{stageError}</p>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            setStageError("");
            setStageDialog(createStageDialogState());
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSaveStage}
          disabled={stageSaving}
        >
          {stageSaving ? "Saving..." : "Save Stage"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
