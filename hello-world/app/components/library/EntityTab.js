"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { useIsMobile } from "../../hooks/useResponsive";
import { api } from "./libraryApi";
import EditDialog from "./EditDialog";

function blankDraft(schema) {
  const draft = {};
  for (const f of schema) draft[f.key] = f.type === "switch" ? f.default ?? false : f.type === "chips" ? [] : "";
  return draft;
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

// Generic CRUD tab for the four row tables (responsive: cards on mobile, table
// on desktop).
export default function EntityTab({ title, description, rows, schema, endpoint, idField = "id", categories, onChanged }) {
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
