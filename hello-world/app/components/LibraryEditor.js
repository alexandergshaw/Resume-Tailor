"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

async function api(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.errors) ? data.errors.join(" ") : data.error;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data;
}

function useIsMobile() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("sm"));
}

// --- A freeSolo tag input for string-array fields ---------------------------
function ChipsInput({ label, value, onChange, helperText }) {
  return (
    <Autocomplete
      multiple
      freeSolo
      size="small"
      options={[]}
      value={value || []}
      onChange={(_, next) => onChange(next.map((s) => String(s).trim()).filter(Boolean))}
      renderTags={(vals, getTagProps) =>
        vals.map((option, index) => (
          // eslint-disable-next-line react/jsx-key
          <Chip size="small" variant="outlined" label={option} {...getTagProps({ index })} />
        ))
      }
      renderInput={(params) => (
        <TextField {...params} label={label} helperText={helperText} placeholder="Type, press Enter" />
      )}
    />
  );
}

// --- Schema-driven editor dialog --------------------------------------------
function blankDraft(schema) {
  const draft = {};
  for (const f of schema) draft[f.key] = f.type === "switch" ? f.default ?? false : f.type === "chips" ? [] : "";
  return draft;
}

function FieldInput({ field, value, onChange, categories }) {
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

function EditDialog({ open, title, schema, draft, setDraft, onClose, onSave, saving, error, categories }) {
  const isMobile = useIsMobile();
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={isMobile}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
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

function cellText(field, value) {
  if (field.type === "chips") {
    const arr = value || [];
    return arr.slice(0, 4).join(", ") + (arr.length > 4 ? ` +${arr.length - 4}` : "");
  }
  if (field.type === "switch") return value ? "yes" : "no";
  if (field.type === "textarea") return String(value || "").slice(0, 80);
  return String(value ?? "");
}

// --- Generic CRUD tab for the four row tables (responsive) -------------------
function EntityTab({ title, description, rows, schema, endpoint, idField = "id", categories, onChanged }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => blankDraft(schema));
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);

  const openAdd = () => {
    setDraft(blankDraft(schema));
    setEditingId(null);
    setError("");
    setOpen(true);
  };
  const openEdit = (row) => {
    const d = {};
    for (const f of schema) d[f.key] = row[f.key] ?? (f.type === "chips" ? [] : f.type === "switch" ? false : "");
    setDraft(d);
    setEditingId(row[idField]);
    setError("");
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = editingId ? { ...draft, id: editingId } : draft;
      const res = await api(endpoint, editingId ? "PATCH" : "POST", payload);
      setWarnings(res.warnings || []);
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row[schema[0].key]}"?`)) return;
    try {
      await api(`${endpoint}?id=${encodeURIComponent(row[idField])}`, "DELETE");
      await onChanged();
    } catch (err) {
      window.alert(err.message);
    }
  };

  const actions = (row) => (
    <Box sx={{ whiteSpace: "nowrap" }}>
      <IconButton size="small" onClick={() => openEdit(row)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
      <IconButton size="small" onClick={() => remove(row)} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton>
    </Box>
  );

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: description ? 0.75 : 2, justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, minWidth: 0 }}>{title}s</Typography>
        <Button
          startIcon={<AddIcon sx={{ fontSize: 18 }} />}
          variant="contained"
          size="small"
          disableElevation
          onClick={openAdd}
          sx={{ flexShrink: 0, alignSelf: "center", whiteSpace: "nowrap", textTransform: "none", borderRadius: 1.5 }}
        >
          Add
        </Button>
      </Stack>
      {description ? <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>{description}</Typography> : null}
      {warnings?.length ? <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setWarnings([])}>{warnings.join(" ")}</Alert> : null}

      {rows.length === 0 ? (
        <Box sx={{ border: "1px dashed var(--border)", borderRadius: 1.5, py: 5, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">Nothing here yet.</Typography>
        </Box>
      ) : isMobile ? (
        // Mobile: stacked cards
        <Stack spacing={1}>
          {rows.map((row) => (
            <Box key={row[idField]} sx={{ border: "1px solid var(--border)", borderRadius: 1.5, p: 1.75 }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>{cellText(schema[0], row[schema[0].key])}</Typography>
                {actions(row)}
              </Stack>
              {schema.slice(1).map((f) => {
                const text = cellText(f, row[f.key]);
                if (!text) return null;
                return (
                  <Box key={f.key} sx={{ display: "flex", justifyContent: "space-between", gap: 2, mt: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 10.5, flexShrink: 0, pt: 0.15 }}>{f.label || f.key}</Typography>
                    <Typography variant="body2" sx={{ textAlign: "right", wordBreak: "break-word" }}>{text}</Typography>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Stack>
      ) : (
        // Desktop: clean table with tooltip'd column headers
        <Box sx={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 1.5 }}>
          <Box
            component="table"
            sx={{
              width: "100%",
              borderCollapse: "collapse",
              "& thead th": { textTransform: "uppercase", fontSize: 10.5, letterSpacing: "0.06em", color: "text.secondary", fontWeight: 700, textAlign: "left", py: 1.25, px: 1.75, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" },
              "& tbody td": { fontSize: 13.5, py: 1.25, px: 1.75, borderBottom: "1px solid var(--border)", verticalAlign: "top" },
              "& tbody tr:last-of-type td": { borderBottom: "none" },
              "& tbody tr:hover td": { backgroundColor: "var(--bg-soft)" },
            }}
          >
            <thead>
              <tr>
                {schema.map((f) => (
                  <th key={f.key}>
                    <Tooltip title={f.help || ""} arrow disableHoverListener={!f.help} enterTouchDelay={0}>
                      <span style={{ cursor: f.help ? "help" : "default" }}>{f.label || f.key}</span>
                    </Tooltip>
                  </th>
                ))}
                <th style={{ width: 84 }} aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[idField]}>
                  {schema.map((f) => <td key={f.key}>{cellText(f, row[f.key])}</td>)}
                  <td>{actions(row)}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      )}

      <EditDialog
        open={open}
        title={editingId ? `Edit ${title.toLowerCase()}` : `Add ${title.toLowerCase()}`}
        schema={schema}
        draft={draft}
        setDraft={setDraft}
        onClose={() => setOpen(false)}
        onSave={save}
        saving={saving}
        error={error}
        categories={categories}
      />
    </Box>
  );
}

// --- Profile tab (key/value placeholder map + teaching subjects) ------------
function ProfileTab({ profile, onChanged }) {
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

// --- Preview tab (render résumé + cover against the current library) ---------
function PreviewTab() {
  const [posting, setPosting] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      setResult(await api("/api/library/preview", "POST", { posting }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const topKeywords = useMemo(() => {
    const kw = result?.keywords || {};
    const all = [];
    for (const cat of Object.keys(kw)) for (const k of kw[cat] || []) all.push(k.canonical);
    return all.slice(0, 24);
  }, [result]);

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>Preview</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Paste a posting and render the résumé + cover letter against your current library — verify an edit without AI.
      </Typography>
      <TextField fullWidth multiline minRows={6} label="Job posting" value={posting} onChange={(e) => setPosting(e.target.value)} />
      <Button variant="contained" size="small" disableElevation sx={{ mt: 2, textTransform: "none", borderRadius: 1.5 }} onClick={run} disabled={running || !posting.trim()}>
        {running ? "Rendering…" : "Render preview"}
      </Button>
      {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      {result ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2">Detected: {result.jobTitle || "—"}{result.companyName ? ` @ ${result.companyName}` : ""}</Typography>
          <Stack direction="row" spacing={0.5} sx={{ my: 1, flexWrap: "wrap" }}>
            {topKeywords.map((k) => <Chip key={k} size="small" label={k} />)}
          </Stack>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Résumé</Typography>
              <Box component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, p: 1.5, border: "1px solid var(--border)", borderRadius: 1, maxHeight: 480, overflow: "auto" }}>{result.resume}</Box>
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Cover letter</Typography>
              <Box component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 12, p: 1.5, border: "1px solid var(--border)", borderRadius: 1, maxHeight: 480, overflow: "auto" }}>{result.cover}</Box>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

// --- Import from a posting (URL or paste) -----------------------------------
function ImportDialog({ open, onClose, onChanged }) {
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

const TAXONOMY_SCHEMA = (categories) => [
  { key: "canonical", type: "text", label: "Canonical", help: "The display text inserted/surfaced in the résumé & cover letter." },
  { key: "category", type: "select", label: "Category", options: categories, help: "How the term is grouped (technology, domain, soft_skill, …)." },
  { key: "aliases", type: "chips", label: "Aliases", help: "Synonyms matched in the posting (lowercased). Avoid ultra-generic single words." },
  { key: "match_canonical", type: "switch", label: "Match canonical", default: true, help: "Whether the canonical text itself is matched, or only the aliases." },
];
const FOCUS_SCHEMA = [
  { key: "name", type: "text", label: "Name", help: "A label for the area (e.g. 'Solution Architecture')." },
  { key: "match", type: "chips", label: "Match terms", help: "Discriminative role/discipline phrases that activate this area when a posting names them." },
  { key: "subjects", type: "chips", label: "Subjects", help: "Lead the skills row + summary when the area is active." },
  { key: "job_emphases", type: "chips", label: "Job emphases", help: "The per-role parenthetical emphases on the résumé." },
  { key: "technical_capabilities", type: "chips", label: "Technical capabilities", help: "Tech shown in the opening 'hands-on work with …' line." },
  { key: "domain_capabilities", type: "chips", label: "Domain capabilities", help: "Domain expertise shown in the cover letter + summary." },
];
const SKILLGROUP_SCHEMA = [
  { key: "heading", type: "text", label: "Heading", help: "The group's name (used for ranking, not shown verbatim)." },
  { key: "categories", type: "chips", label: "Categories", help: "Fallback category membership used for ranking." },
  { key: "keywords", type: "chips", label: "Keywords", help: "Your exact skill strings — kept verbatim, nothing invented." },
  { key: "conditional", type: "switch", label: "Conditional", help: "If on, these only surface when the posting asks for them." },
];
const CONTENT_SCHEMA = [
  { key: "frag_id", type: "text", label: "Fragment id", help: "A unique slug id for this fragment." },
  { key: "slots", type: "chips", label: "Slots", help: "The placeholder slot names this fragment can fill." },
  { key: "text", type: "textarea", label: "Text", help: "Inserted verbatim — keep it grammatical for the sentence." },
  { key: "tags", type: "chips", label: "Tags", help: "Taxonomy terms; the best-tagged fragment wins per posting." },
  { key: "fabricated", type: "switch", label: "Fabricated", help: "Invented metrics/spin — only used at high aggressiveness." },
];

const TABS = [
  { label: "Buzzwords", help: "The taxonomy — canonical terms and the aliases matched in postings. This is what the engine recognizes and surfaces." },
  { label: "Focus Areas", help: "Per-role retargeting. When a posting's match terms clear the threshold, the area reframes the résumé + cover letter." },
  { label: "Skill Groups", help: "Your skills, grouped. Conditional groups only surface when a posting asks for them." },
  { label: "Content Library", help: "Tagged accomplishment/bullet fragments the engine slots into the résumé." },
  { label: "Profile", help: "Static placeholder values (name, rank, scale figures, skills-row headings) the posting can't supply." },
  { label: "Preview", help: "Render the résumé + cover letter from a pasted posting against your current library — verify edits without AI." },
];

export default function LibraryEditor() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
      if (res.status === 401) {
        setError("Please sign in to manage your tailoring library.");
        setData(null);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load library.");
      setData(json);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the library once on mount (the canonical fetch-on-mount pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  if (loading) return <Box sx={{ p: 4, textAlign: "center" }}><CircularProgress /></Box>;
  if (error && !data) return <Box sx={{ p: 4 }}><Alert severity="info">{error}</Alert></Box>;

  const categories = data?.categories || [];

  return (
    <Box sx={{ width: "100%", maxWidth: 1080, minWidth: 0, mx: "auto", p: { xs: 2, md: 4 } }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3, justifyContent: "space-between", alignItems: { xs: "stretch", sm: "center" } }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600, letterSpacing: "-0.01em" }}>Tailoring Library</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            The terms, focus areas, and skills the engine uses. Changes apply on your next tailoring run.
          </Typography>
        </Box>
        <Button variant="outlined" size="small" onClick={() => setImportOpen(true)} sx={{ flexShrink: 0, alignSelf: { xs: "flex-start", sm: "center" }, whiteSpace: "nowrap", textTransform: "none", borderRadius: 1.5 }}>
          Import from posting
        </Button>
      </Stack>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          mb: 3,
          minHeight: 40,
          borderBottom: "1px solid var(--border)",
          "& .MuiTab-root": { minHeight: 40, textTransform: "none", fontSize: 14, fontWeight: 500, px: 2, minWidth: 0 },
          "& .MuiTabs-indicator": { height: 2 },
        }}
      >
        {TABS.map((t) => (
          <Tab
            key={t.label}
            label={<Tooltip title={t.help} arrow enterTouchDelay={0} placement="bottom"><span>{t.label}</span></Tooltip>}
          />
        ))}
      </Tabs>

      {tab === 0 && <EntityTab title="Buzzword" description="The taxonomy: canonical terms, their categories, and the aliases matched in postings." rows={data.taxonomy} schema={TAXONOMY_SCHEMA(categories)} endpoint="/api/library/taxonomy" categories={categories} onChanged={reload} />}
      {tab === 1 && <EntityTab title="Focus Area" description="When a posting's match terms clear the threshold, this area drives the framing." rows={data.focusAreas} schema={FOCUS_SCHEMA} endpoint="/api/library/focus-areas" onChanged={reload} />}
      {tab === 2 && <EntityTab title="Skill Group" description="Your skills, grouped. Conditional groups only surface when the posting asks for them." rows={data.skillGroups} schema={SKILLGROUP_SCHEMA} endpoint="/api/library/skill-groups" onChanged={reload} />}
      {tab === 3 && <EntityTab title="Fragment" description="Tagged accomplishment/bullet fragments the engine slots into the résumé." rows={data.contentLibrary} schema={CONTENT_SCHEMA} endpoint="/api/library/content-library" onChanged={reload} />}
      {tab === 4 && <ProfileTab key={data.profile?.updated_at || "profile"} profile={data.profile} onChanged={reload} />}
      {tab === 5 && <PreviewTab />}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onChanged={reload} />
    </Box>
  );
}
