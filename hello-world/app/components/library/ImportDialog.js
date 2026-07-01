"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useIsMobile } from "../../hooks/useResponsive";
import { api } from "./libraryApi";
import ChipsInput from "./ChipsInput";

// Import from a posting (URL or paste): analyze, then selectively add
// buzzwords / a focus area / a skill group to the library.
export default function ImportDialog({ open, onClose, onChanged }) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState("url");
  const [value, setValue] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [buzz, setBuzz] = useState([]);
  const [fa, setFa] = useState({ include: false });
  const [sg, setSg] = useState({ include: false });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const reset = () => {
    setValue(""); setResult(null); setError(""); setBuzz([]);
    setFa({ include: false }); setSg({ include: false }); setImportResult(null);
  };
  const close = () => { reset(); onClose(); };

  const analyze = async () => {
    setAnalyzing(true); setError(""); setResult(null); setImportResult(null);
    try {
      const payload = mode === "url" ? { url: value.trim() } : { posting: value };
      const data = await api("/api/library/extract", "POST", payload);
      setResult(data);
      setBuzz(data.buzzwords.map((b) => ({ ...b, selected: !!b.category })));
      setFa({ include: false, ...data.suggestedFocusArea });
      setSg({ include: false, ...data.suggestedSkillGroup });
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const doImport = async () => {
    const taxonomy = buzz.filter((b) => b.selected && b.category).map((b) => ({ canonical: b.canonical, category: b.category, aliases: [] }));
    const focusAreas = fa.include ? [{ name: fa.name, match: fa.match, subjects: fa.subjects, job_emphases: fa.job_emphases, technical_capabilities: fa.technical_capabilities, domain_capabilities: fa.domain_capabilities }] : [];
    const skillGroups = sg.include ? [{ heading: sg.heading, categories: sg.categories, keywords: sg.keywords, conditional: false }] : [];
    if (!taxonomy.length && !focusAreas.length && !skillGroups.length) {
      setError("Select at least one item to add (buzzwords need a category).");
      return;
    }
    setImporting(true); setError("");
    try {
      const res = await api("/api/library/import", "POST", { taxonomy, focusAreas, skillGroups });
      setImportResult(res);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const categories = result?.categories || [];
  const selectedCount = buzz.filter((b) => b.selected && b.category).length + (fa.include ? 1 : 0) + (sg.include ? 1 : 0);

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md" fullScreen={isMobile}>
      <DialogTitle>Import from a job posting</DialogTitle>
      <DialogContent dividers>
        <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, m) => m && setMode(m)} sx={{ mb: 1.5 }}>
          <ToggleButton value="url">Fetch a URL</ToggleButton>
          <ToggleButton value="paste">Paste text</ToggleButton>
        </ToggleButtonGroup>
        {mode === "url" ? (
          <TextField fullWidth size="small" label="Job posting URL" value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…" />
        ) : (
          <TextField fullWidth multiline minRows={5} label="Paste the job posting" value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        <Button variant="contained" size="small" disableElevation sx={{ mt: 1.5, textTransform: "none", borderRadius: 1.5 }} onClick={analyze} disabled={analyzing || !value.trim()}>
          {analyzing ? "Analyzing…" : "Analyze posting"}
        </Button>
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}

        {result ? (
          <Box sx={{ mt: 2 }}>
            {result.title ? <Typography variant="subtitle2" sx={{ mb: 1 }}>Detected: {result.title}{result.company ? ` @ ${result.company}` : ""}</Typography> : null}

            <Typography variant="subtitle2" sx={{ mt: 1 }}>New buzzwords ({buzz.length})</Typography>
            <Typography variant="caption" color="text.secondary">Terms not already in your library. Assign a category to include one.</Typography>
            <Stack spacing={0.5} sx={{ mt: 1, maxHeight: 260, overflow: "auto", pr: 1 }}>
              {buzz.length === 0 ? <Typography variant="body2" color="text.secondary">Nothing new — your library already covers this posting.</Typography> : null}
              {buzz.map((b, i) => (
                <Stack key={`${b.canonical}-${i}`} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Checkbox size="small" checked={b.selected} onChange={(e) => setBuzz((arr) => arr.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} sx={{ p: 0.5 }} />
                  <Typography variant="body2" sx={{ flex: 1, wordBreak: "break-word" }}>{b.canonical}</Typography>
                  <TextField select size="small" value={b.category} onChange={(e) => setBuzz((arr) => arr.map((x, j) => j === i ? { ...x, category: e.target.value, selected: true } : x))} sx={{ minWidth: 150 }}>
                    <MenuItem value=""><em>(pick category)</em></MenuItem>
                    {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                  </TextField>
                </Stack>
              ))}
            </Stack>

            <Divider sx={{ my: 2 }} />
            <FormControlLabel control={<Checkbox checked={!!fa.include} onChange={(e) => setFa((f) => ({ ...f, include: e.target.checked }))} />} label="Add a focus area from this posting" />
            {fa.include ? (
              <Stack spacing={1.5} sx={{ mt: 1, mb: 1 }}>
                <TextField size="small" label="Name" value={fa.name || ""} onChange={(e) => setFa((f) => ({ ...f, name: e.target.value }))} />
                <ChipsInput label="Match terms" value={fa.match} onChange={(v) => setFa((f) => ({ ...f, match: v }))} helperText="Discriminative phrases that activate this area." />
                <ChipsInput label="Subjects" value={fa.subjects} onChange={(v) => setFa((f) => ({ ...f, subjects: v }))} />
                <ChipsInput label="Job emphases" value={fa.job_emphases} onChange={(v) => setFa((f) => ({ ...f, job_emphases: v }))} />
                <ChipsInput label="Technical capabilities" value={fa.technical_capabilities} onChange={(v) => setFa((f) => ({ ...f, technical_capabilities: v }))} />
                <ChipsInput label="Domain capabilities" value={fa.domain_capabilities} onChange={(v) => setFa((f) => ({ ...f, domain_capabilities: v }))} />
              </Stack>
            ) : null}

            <Divider sx={{ my: 2 }} />
            <FormControlLabel control={<Checkbox checked={!!sg.include} onChange={(e) => setSg((s) => ({ ...s, include: e.target.checked }))} />} label="Add a skill group from this posting" />
            {sg.include ? (
              <Stack spacing={1.5} sx={{ mt: 1, mb: 1 }}>
                <TextField size="small" label="Heading" value={sg.heading || ""} onChange={(e) => setSg((s) => ({ ...s, heading: e.target.value }))} />
                <ChipsInput label="Keywords" value={sg.keywords} onChange={(v) => setSg((s) => ({ ...s, keywords: v }))} />
              </Stack>
            ) : null}

            {importResult ? (
              <Alert severity="success" sx={{ mt: 2 }}>
                Added {importResult.added.taxonomy} buzzword(s), {importResult.added.focusAreas} focus area(s), {importResult.added.skillGroups} skill group(s).
                {importResult.skipped?.length ? ` Skipped: ${importResult.skipped.length}.` : ""}
              </Alert>
            ) : null}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} sx={{ textTransform: "none" }}>{importResult ? "Done" : "Cancel"}</Button>
        {result && !importResult ? (
          <Button variant="contained" size="small" disableElevation onClick={doImport} disabled={importing || selectedCount === 0} sx={{ textTransform: "none", borderRadius: 1.5 }}>
            {importing ? "Adding…" : `Add ${selectedCount} to library`}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
