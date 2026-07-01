"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "./libraryApi";
import ChipsInput from "./ChipsInput";

// Profile tab: key/value placeholder map + default teaching subjects.
export default function ProfileTab({ profile, onChanged }) {
  const [values, setValues] = useState(() => ({ ...(profile?.values || {}) }));
  const [subjects, setSubjects] = useState(() => [...(profile?.default_teaching_subjects || [])]);
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api("/api/library/profile", "PUT", { values, default_teaching_subjects: subjects });
      setSaved(true);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>Profile values</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Static placeholder values the posting can&apos;t supply (name, rank, scale figures, skills-row headings).
      </Typography>
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
      {saved ? <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSaved(false)}>Saved.</Alert> : null}
      <Stack spacing={1}>
        {Object.keys(values).sort().map((k) => (
          <Stack direction="row" spacing={1} key={k} sx={{ alignItems: "center" }}>
            <TextField label={k} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} sx={{ flex: 1 }} size="small" />
            <IconButton aria-label="remove" onClick={() => setValues((v) => { const n = { ...v }; delete n[k]; return n; })}><DeleteIcon fontSize="small" /></IconButton>
          </Stack>
        ))}
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2, alignItems: { xs: "stretch", sm: "center" } }}>
        <TextField label="New key" value={newKey} onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_"))} size="small" />
        <Button onClick={() => { if (newKey && !(newKey in values)) { setValues((v) => ({ ...v, [newKey]: "" })); setNewKey(""); } }}>Add key</Button>
      </Stack>
      <Box sx={{ mt: 3, maxWidth: 640 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Default teaching subjects</Typography>
        <ChipsInput label="Subjects" value={subjects} onChange={setSubjects} helperText="Drive the adjunct emphasis when no focus area matches a teaching posting." />
      </Box>
      <Button variant="contained" size="small" disableElevation sx={{ mt: 3, textTransform: "none", borderRadius: 1.5 }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
    </Box>
  );
}
