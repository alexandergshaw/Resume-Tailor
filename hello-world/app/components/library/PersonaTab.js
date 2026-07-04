"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Collapse from "@mui/material/Collapse";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { api } from "./libraryApi";
import ChipsInput from "./ChipsInput";
import { PERSONA_VALUE_FIELDS } from "./schemas";

// Persona tab: create/edit/delete named identities that reframe the résumé + cover letter.
export default function PersonaTab({ personas = [], focusAreas = [], onChanged }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [editingValues, setEditingValues] = useState({});
  const [editingSubjects, setEditingSubjects] = useState([]);
  const [editingFocusArea, setEditingFocusArea] = useState("");
  const [editingCoverVariant, setEditingCoverVariant] = useState("");
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // The headline role (PRIMARY_FUNCTION) is the one field most personas set, so
  // it's shown by default; the rest of the identity overrides + custom keys hide
  // behind a disclosure to keep the form light.
  const primaryField = PERSONA_VALUE_FIELDS[0];
  const secondaryFields = PERSONA_VALUE_FIELDS.slice(1);
  const customKeys = Object.keys(editingValues)
    .filter((k) => !PERSONA_VALUE_FIELDS.find((f) => f.key === k))
    .sort();
  // Auto-expand when editing a persona that already uses the advanced fields.
  const hasAdvanced = secondaryFields.some((f) => editingValues[f.key]) || customKeys.length > 0;

  const startAdd = () => {
    setEditingId(null);
    setEditingName("");
    setEditingValues({});
    setEditingSubjects([]);
    setEditingFocusArea("");
    setEditingCoverVariant("");
    setNewKey("");
    setError("");
    setShowMore(false);
    setFormOpen(true);
  };

  const startEdit = (persona) => {
    setEditingId(persona.id);
    setEditingName(persona.name || "");
    setEditingValues({ ...(persona.values || {}) });
    setEditingSubjects([...(persona.default_teaching_subjects || [])]);
    setEditingFocusArea(persona.focus_area || "");
    setEditingCoverVariant(persona.cover_variant || "");
    setNewKey("");
    setError("");
    // Open the advanced section straight away if this persona uses it.
    setShowMore(
      PERSONA_VALUE_FIELDS.slice(1).some((f) => persona.values?.[f.key]) ||
        Object.keys(persona.values || {}).some((k) => !PERSONA_VALUE_FIELDS.find((f) => f.key === k)),
    );
    setFormOpen(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
    setEditingValues({});
    setEditingSubjects([]);
    setEditingFocusArea("");
    setEditingCoverVariant("");
    setNewKey("");
    setError("");
    setFormOpen(false);
  };

  const save = async () => {
    if (!editingName.trim()) {
      setError("Name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setSaved(false);
    try {
      // Drop empty-string values from the values object
      const cleanedValues = Object.fromEntries(
        Object.entries(editingValues).filter(([, v]) => v !== "")
      );

      const body = {
        name: editingName,
        values: cleanedValues,
        default_teaching_subjects: editingSubjects,
        focus_area: editingFocusArea,
        cover_variant: editingCoverVariant,
      };

      if (editingId) {
        await api("/api/library/personas", "PATCH", { id: editingId, ...body });
      } else {
        await api("/api/library/personas", "POST", body);
      }

      setSaved(true);
      await onChanged();
      cancelEdit();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (persona) => {
    if (!window.confirm(`Delete persona "${persona.name}"?`)) return;
    try {
      await api(`/api/library/personas?id=${encodeURIComponent(persona.id)}`, "DELETE");
      await onChanged();
    } catch (err) {
      window.alert(err.message);
    }
  };

  // Summary text for a persona (short display of what's set)
  const personaSummary = (persona) => {
    const parts = [];
    if (persona.values && Object.keys(persona.values).length > 0) {
      const valueKeys = Object.keys(persona.values).slice(0, 2).join(", ");
      parts.push(`Values: ${valueKeys}`);
    }
    if (persona.cover_variant) {
      parts.push(`Framing: ${persona.cover_variant}`);
    }
    return parts.length > 0 ? parts.join(" • ") : "(no customizations)";
  };

  const focusAreaOptions = focusAreas.map((fa) => fa.name || "");

  return (
    <Box>
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
      {saved ? <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSaved(false)}>Saved.</Alert> : null}

      {formOpen ? (
        // Add/Edit form
        <Box sx={{ border: "1px solid var(--border)", borderRadius: 1.5, p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
            {editingId ? "Edit Persona" : "Add Persona"}
          </Typography>

          <Stack spacing={2}>
            {/* Name */}
            <TextField
              label="Name"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              size="small"
              fullWidth
              placeholder="e.g., Finance Educator"
            />

            {/* Headline role: the one identity value most personas set. */}
            <TextField
              label={primaryField.label}
              value={editingValues[primaryField.key] || ""}
              onChange={(e) => setEditingValues((v) => ({ ...v, [primaryField.key]: e.target.value }))}
              size="small"
              fullWidth
              placeholder={primaryField.placeholder}
            />

            {/* Everything else: hidden behind a disclosure to keep the form light. */}
            <Box>
              <Button
                onClick={() => setShowMore((s) => !s)}
                startIcon={showMore ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                size="small"
                sx={{ textTransform: "none", pl: 0 }}
              >
                {showMore ? "Fewer identity overrides" : "More identity overrides"}
                {!showMore && hasAdvanced ? " (in use)" : ""}
              </Button>
              <Collapse in={showMore} unmountOnExit>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {secondaryFields.map((field) => (
                    <TextField
                      key={field.key}
                      label={field.label}
                      value={editingValues[field.key] || ""}
                      onChange={(e) => setEditingValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      size="small"
                      fullWidth
                      placeholder={field.placeholder}
                    />
                  ))}

                  {/* Additional custom keys */}
                  {customKeys.map((k) => (
                    <Stack direction="row" spacing={1} key={k} sx={{ alignItems: "center" }}>
                      <TextField
                        label={k}
                        value={editingValues[k]}
                        onChange={(e) => setEditingValues((v) => ({ ...v, [k]: e.target.value }))}
                        sx={{ flex: 1 }}
                        size="small"
                      />
                      <IconButton
                        aria-label="remove"
                        onClick={() => setEditingValues((v) => { const n = { ...v }; delete n[k]; return n; })}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}

                  {/* Add custom key */}
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "stretch", sm: "center" } }}>
                    <TextField
                      label="New key"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "_"))}
                      size="small"
                    />
                    <Button
                      onClick={() => {
                        if (newKey && !(newKey in editingValues)) {
                          setEditingValues((v) => ({ ...v, [newKey]: "" }));
                          setNewKey("");
                        }
                      }}
                    >
                      Add key
                    </Button>
                  </Stack>
                </Stack>
              </Collapse>
            </Box>

            {/* Teaching subjects */}
            <Box>
              <Typography variant="caption" sx={{ display: "block", mb: 1, fontWeight: 500 }}>
                Default teaching subjects (optional)
              </Typography>
              <ChipsInput
                label="Subjects"
                value={editingSubjects}
                onChange={setEditingSubjects}
                helperText="Emphasized when this persona is used on a teaching posting."
              />
            </Box>

            {/* Focus area */}
            <Box>
              <Typography variant="caption" sx={{ display: "block", mb: 1, fontWeight: 500 }}>
                Default focus area (optional)
              </Typography>
              <Select
                size="small"
                fullWidth
                value={editingFocusArea}
                onChange={(e) => setEditingFocusArea(e.target.value)}
              >
                <MenuItem value="">None</MenuItem>
                {focusAreaOptions.map((name) => (
                  <MenuItem key={name} value={name}>
                    {name}
                  </MenuItem>
                ))}
              </Select>
            </Box>

            {/* Cover framing */}
            <Box>
              <Typography variant="caption" sx={{ display: "block", mb: 1, fontWeight: 500 }}>
                Default cover letter framing (optional)
              </Typography>
              <Select
                size="small"
                fullWidth
                value={editingCoverVariant}
                onChange={(e) => setEditingCoverVariant(e.target.value)}
              >
                <MenuItem value="">Auto (inferred from posting)</MenuItem>
                <MenuItem value="teaching">Teaching</MenuItem>
                <MenuItem value="staff">Higher-ed staff</MenuItem>
                <MenuItem value="industry">Industry</MenuItem>
                <MenuItem value="nontechnical">Non-technical</MenuItem>
              </Select>
            </Box>
          </Stack>

          {/* Actions */}
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              variant="contained"
              size="small"
              disableElevation
              onClick={save}
              disabled={saving}
              sx={{ textTransform: "none", borderRadius: 1.5 }}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              onClick={cancelEdit}
              disabled={saving}
              sx={{ textTransform: "none" }}
            >
              Cancel
            </Button>
          </Stack>
        </Box>
      ) : (
        // List of personas
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 2, justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Personas</Typography>
            <Button
              startIcon={<AddIcon sx={{ fontSize: 18 }} />}
              variant="contained"
              size="small"
              disableElevation
              onClick={startAdd}
              sx={{ flexShrink: 0, alignSelf: "center", whiteSpace: "nowrap", textTransform: "none", borderRadius: 1.5 }}
            >
              Add
            </Button>
          </Stack>

          {personas.length === 0 ? (
            <Box sx={{ border: "1px dashed var(--border)", borderRadius: 1.5, py: 5, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">Nothing here yet.</Typography>
            </Box>
          ) : (
            <Stack spacing={1}>
              {personas.map((persona) => (
                <Box key={persona.id} sx={{ border: "1px solid var(--border)", borderRadius: 1.5, p: 1.75 }}>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
                        {persona.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                        {personaSummary(persona)}
                      </Typography>
                    </Box>
                    <Box sx={{ whiteSpace: "nowrap" }}>
                      <IconButton size="small" onClick={() => startEdit(persona)} aria-label="edit">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => remove(persona)} aria-label="delete">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </>
      )}
    </Box>
  );
}
