"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/EditOutlined";

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

// --- A freeSolo tag input for string-array fields ---------------------------
function ChipsInput({ label, value, onChange, helperText }) {
  return (
    <Autocomplete
      multiple
      freeSolo
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
      <TextField select fullWidth label={field.label || field.key} value={value || ""} onChange={(e) => onChange(e.target.value)}>
        {(categories || []).map((c) => (
          <MenuItem key={c} value={c}>{c}</MenuItem>
        ))}
      </TextField>
    );
  }
  return (
    <TextField
      fullWidth
      multiline={field.type === "textarea"}
      minRows={field.type === "textarea" ? 2 : undefined}
      label={field.label || field.key}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      helperText={field.help}
    />
  );
}

function EditDialog({ open, title, schema, draft, setDraft, onClose, onSave, saving, error, warnings, categories }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {warnings?.length ? <Alert severity="warning">{warnings.join(" ")}</Alert> : null}
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
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={onSave} disabled={saving}>
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

// --- Generic CRUD tab for the four row tables -------------------------------
function EntityTab({ title, description, rows, schema, endpoint, idField = "id", categories, onChanged }) {
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
    setWarnings([]);
    setOpen(true);
  };
  const openEdit = (row) => {
    const d = {};
    for (const f of schema) d[f.key] = row[f.key] ?? (f.type === "chips" ? [] : f.type === "switch" ? false : "");
    setDraft(d);
    setEditingId(row[idField]);
    setError("");
    setWarnings([]);
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

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="h6">{title}</Typography>
          {description ? <Typography variant="body2" color="text.secondary">{description}</Typography> : null}
        </Box>
        <Button startIcon={<AddIcon />} variant="contained" onClick={openAdd}>Add</Button>
      </Stack>
      {warnings?.length ? <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setWarnings([])}>{warnings.join(" ")}</Alert> : null}
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& td, & th": { borderBottom: "1px solid var(--border)", p: 1, textAlign: "left", fontSize: 14, verticalAlign: "top" } }}>
        <thead>
          <tr>
            {schema.map((f) => <th key={f.key}>{f.label || f.key}</th>)}
            <th style={{ width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={schema.length + 1}><Typography variant="body2" color="text.secondary">None yet.</Typography></td></tr>
          ) : rows.map((row) => (
            <tr key={row[idField]}>
              {schema.map((f) => <td key={f.key}>{cellText(f, row[f.key])}</td>)}
              <td>
                <IconButton size="small" onClick={() => openEdit(row)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={() => remove(row)} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </Box>
      <EditDialog
        open={open}
        title={editingId ? `Edit ${title}` : `Add ${title}`}
        schema={schema}
        draft={draft}
        setDraft={setDraft}
        onClose={() => setOpen(false)}
        onSave={save}
        saving={saving}
        error={error}
        warnings={warnings}
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

  // The buffer is initialized from props on mount; the parent passes a `key` tied
  // to the profile's updated_at, so a save+reload remounts this tab with fresh data.

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
      <Typography variant="h6" sx={{ mb: 1 }}>Profile values</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Static placeholder values the posting can&apos;t supply (name, rank, scale figures, skills-row headings).
      </Typography>
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
      {saved ? <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSaved(false)}>Saved.</Alert> : null}
      <Stack spacing={1}>
        {Object.keys(values).sort().map((k) => (
          <Stack direction="row" spacing={1} key={k} alignItems="center">
            <TextField label={k} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} sx={{ flex: 1 }} size="small" />
            <IconButton aria-label="remove" onClick={() => setValues((v) => { const n = { ...v }; delete n[k]; return n; })}><DeleteIcon fontSize="small" /></IconButton>
          </Stack>
        ))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
        <TextField label="New key" value={newKey} onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_"))} size="small" />
        <Button onClick={() => { if (newKey && !(newKey in values)) { setValues((v) => ({ ...v, [newKey]: "" })); setNewKey(""); } }}>Add key</Button>
      </Stack>
      <Box sx={{ mt: 3, maxWidth: 640 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Default teaching subjects</Typography>
        <ChipsInput label="Subjects" value={subjects} onChange={setSubjects} helperText="Drive the adjunct emphasis when no focus area matches a teaching posting." />
      </Box>
      <Button variant="contained" sx={{ mt: 3 }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
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
      const data = await api("/api/library/preview", "POST", { posting });
      setResult(data);
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
      <Typography variant="h6" sx={{ mb: 1 }}>Preview</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Paste a posting and render the résumé + cover letter against your current library — verify an edit without AI.
      </Typography>
      <TextField fullWidth multiline minRows={6} label="Job posting" value={posting} onChange={(e) => setPosting(e.target.value)} />
      <Button variant="contained" sx={{ mt: 2 }} onClick={run} disabled={running || !posting.trim()}>
        {running ? "Rendering…" : "Render preview"}
      </Button>
      {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      {result ? (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2">Detected: {result.jobTitle || "—"}{result.companyName ? ` @ ${result.companyName}` : ""}</Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ my: 1, gap: 0.5 }}>
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

const TAXONOMY_SCHEMA = (categories) => [
  { key: "canonical", type: "text", label: "Canonical", help: "Display text inserted/surfaced." },
  { key: "category", type: "select", label: "Category", options: categories },
  { key: "aliases", type: "chips", label: "Aliases", help: "Synonyms matched in the posting (lowercased)." },
  { key: "match_canonical", type: "switch", label: "Match canonical", default: true },
];
const FOCUS_SCHEMA = [
  { key: "name", type: "text", label: "Name" },
  { key: "match", type: "chips", label: "Match terms", help: "Discriminative phrases that activate this area." },
  { key: "subjects", type: "chips", label: "Subjects" },
  { key: "job_emphases", type: "chips", label: "Job emphases" },
  { key: "technical_capabilities", type: "chips", label: "Technical capabilities" },
  { key: "domain_capabilities", type: "chips", label: "Domain capabilities" },
];
const SKILLGROUP_SCHEMA = [
  { key: "heading", type: "text", label: "Heading" },
  { key: "categories", type: "chips", label: "Categories" },
  { key: "keywords", type: "chips", label: "Keywords" },
  { key: "conditional", type: "switch", label: "Conditional (only when posting asks)" },
];
const CONTENT_SCHEMA = [
  { key: "frag_id", type: "text", label: "Fragment id" },
  { key: "slots", type: "chips", label: "Slots" },
  { key: "text", type: "textarea", label: "Text" },
  { key: "tags", type: "chips", label: "Tags" },
  { key: "fabricated", type: "switch", label: "Fabricated (high-aggressiveness only)" },
];

const TAB_LABELS = ["Buzzwords", "Focus Areas", "Skill Groups", "Content Library", "Profile", "Preview"];

export default function LibraryEditor() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
    <Box sx={{ maxWidth: 1100, mx: "auto", p: { xs: 2, md: 3 } }}>
      <Typography variant="h4" sx={{ mb: 0.5 }}>Tailoring Library</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Manage the buzzwords, focus areas, skills, and fragments the deterministic engine uses. Changes apply to your next tailoring run.
      </Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2, borderBottom: "1px solid var(--border)" }}>
        {TAB_LABELS.map((l) => <Tab key={l} label={l} />)}
      </Tabs>
      {tab === 0 && (
        <EntityTab title="Buzzword" description="The taxonomy: canonical terms, their categories, and the aliases matched in postings." rows={data.taxonomy} schema={TAXONOMY_SCHEMA(categories)} endpoint="/api/library/taxonomy" categories={categories} onChanged={reload} />
      )}
      {tab === 1 && (
        <EntityTab title="Focus Area" description="Per-role retargeting: when a posting's match terms clear the threshold, this area drives the framing." rows={data.focusAreas} schema={FOCUS_SCHEMA} endpoint="/api/library/focus-areas" onChanged={reload} />
      )}
      {tab === 2 && (
        <EntityTab title="Skill Group" description="Your skills, grouped. Conditional groups only surface when the posting asks for them." rows={data.skillGroups} schema={SKILLGROUP_SCHEMA} endpoint="/api/library/skill-groups" onChanged={reload} />
      )}
      {tab === 3 && (
        <EntityTab title="Fragment" description="Tagged accomplishment/bullet fragments the engine slots into the résumé." rows={data.contentLibrary} schema={CONTENT_SCHEMA} endpoint="/api/library/content-library" onChanged={reload} />
      )}
      {tab === 4 && <ProfileTab key={data.profile?.updated_at || "profile"} profile={data.profile} onChanged={reload} />}
      {tab === 5 && <PreviewTab />}
    </Box>
  );
}
