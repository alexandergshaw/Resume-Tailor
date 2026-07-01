"use client";

import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import FormDialog from "./FormDialog";

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
  const close = () => {
    setStageError("");
    setStageDialog(createStageDialogState());
  };

  return (
    <FormDialog
      open={stageDialog.open}
      onClose={close}
      title={stageDialog.stageId ? "Edit Interview Stage" : "Add Interview Stage"}
      contentSx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}
      error={stageError}
      busy={stageSaving}
      onSubmit={handleSaveStage}
      submitLabel="Save Stage"
    >
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
    </FormDialog>
  );
}
