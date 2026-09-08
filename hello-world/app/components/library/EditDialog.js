"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import { TOUCH_FIELD_SX, TOUCH_MUI_SELECT_SX, TOUCH_SWITCH_SX } from "@/app/theme/mobileSx";
import { useIsMobile } from "../../hooks/useResponsive";
import ChipsInput from "./ChipsInput";

// Renders a single schema field (text/textarea/select/switch/chips).
export function FieldInput({ field, value, onChange, categories }) {
  if (field.type === "chips") {
    return <ChipsInput label={field.label || field.key} value={value} onChange={onChange} helperText={field.help} />;
  }
  if (field.type === "switch") {
    return (
      <FormControlLabel
        control={<Switch checked={!!value} onChange={(e) => onChange(e.target.checked)} />}
        label={field.label || field.key}
      />
    );
  }
  if (field.type === "select") {
    return (
      <TextField select fullWidth size="small" label={field.label || field.key} value={value || ""} helperText={field.help} onChange={(e) => onChange(e.target.value)}>
        {(categories || []).map((c) => (
          <MenuItem key={c} value={c}>{c}</MenuItem>
        ))}
      </TextField>
    );
  }
  return (
    <TextField
      fullWidth
      size="small"
      multiline={field.type === "textarea"}
      minRows={field.type === "textarea" ? 2 : undefined}
      label={field.label || field.key}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      helperText={field.help}
    />
  );
}

// Schema-driven add/edit dialog used by EntityTab.
export default function EditDialog({ open, title, schema, draft, setDraft, onClose, onSave, saving, error, categories }) {
  const isMobile = useIsMobile();
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={isMobile}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {/* The touch floors go on the CONTAINER, not on each FieldInput
            branch. All three constants are descendant-selector fragments
            (`& .MuiInputBase-root`, `& .MuiSelect-select.MuiSelect-select`,
            `& .MuiSwitch-switchBase::after`), so one spread here reaches
            every field this schema-driven dialog can render -- including a
            field type added to FieldInput later, which is exactly the case a
            per-branch spread would miss.

            The two Select constants are used TOGETHER, never one instead of
            the other: TOUCH_FIELD_SX raises the InputBase root (what the user
            sees), TOUCH_MUI_SELECT_SX stretches the display element inside it
            so the top and bottom bands are not a dead zone over a div. From
            here the doubled class resolves to (0,3,0), which is what that
            constant needs to beat MUI's own (0,2,0) rule. */}
        <Stack spacing={2} sx={{ mt: 1, ...TOUCH_FIELD_SX, ...TOUCH_MUI_SELECT_SX, ...TOUCH_SWITCH_SX }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {schema.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              categories={categories}
              value={draft[field.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: "none" }}>Cancel</Button>
        <Button variant="contained" size="small" disableElevation onClick={onSave} disabled={saving} sx={{ textTransform: "none", borderRadius: 1.5 }}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
