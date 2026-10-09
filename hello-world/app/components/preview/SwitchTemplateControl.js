"use client";

import { useId, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { isDocxResume } from "@/lib/document/docx";
import { listLibraryTemplates, fetchLibraryTemplateFile } from "@/lib/document/templateLibraryClient";
import { visuallyHidden } from "@/lib/copilot/answerStatus";
import { TOUCH_TARGET_SX, BREAK_LONG_WORDS_SX } from "@/app/theme/mobileSx";

const CAPTION_SX = { fontSize: "0.78rem", color: "var(--text-secondary)" };

// N151c: re-pour the open document into a DIFFERENT template and keep the
// result as a NEW version -- the original and every other version stay
// re-selectable. The template comes from the user's saved library or from a
// .docx uploaded on the spot; an uploaded file is used for this one render and
// never added to the library. Formatting only: the document's text is not
// re-tailored. Mounted (via TemplateControlsRow) only for DOCX_SCOPES with an
// available document, so it is structurally absent on the email tab.
//
// Disabled WITH a reason, not hidden, when the new version could not be kept:
// signed out, or no saved version of this document yet (the position the
// version would attach to is resolved alongside the version history). The hook
// refuses the same cases, so a missed gate here still writes nothing.
//
// The label is "Switch template…" on purpose: the revise strip's "Regenerate
// to address weaknesses" is a different action (it calls the model).
export default function SwitchTemplateControl({
  scope,
  busy = false,
  currentUser,
  hasVersions = false,
  commitDraft,
  onRegenerate,
}) {
  const [anchor, setAnchor] = useState(null);
  const [library, setLibrary] = useState({ status: "idle", templates: [], error: "" });
  const [pickerError, setPickerError] = useState("");
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState({ error: false, text: "" });
  const fileRef = useRef(null);
  const reasonId = useId();
  const noun = scope === "cover" ? "cover letter" : "résumé";

  let reason = "";
  if (!currentUser?.id) reason = `Sign in to switch this ${noun}'s template.`;
  else if (!hasVersions) reason = `Available once this ${noun} has a saved version.`;
  else if (busy || running) reason = "Wait for the current change to finish.";

  async function openPicker(event) {
    const target = event.currentTarget;
    // Flush a pending edit now: the picker is modal, so the text can't change
    // again before a template is chosen, and the saved edit has settled by then.
    commitDraft?.();
    setAnchor(target);
    setPickerError("");
    setOutcome({ error: false, text: "" });
    setLibrary({ status: "loading", templates: [], error: "" });
    const result = await listLibraryTemplates(scope);
    setLibrary(
      result.ok
        ? { status: "ready", templates: result.templates, error: "" }
        : { status: "error", templates: [], error: result.error },
    );
  }

  async function regenerateWith(file) {
    setRunning(true);
    try {
      const result = await onRegenerate?.(scope, file);
      setOutcome(
        result?.error
          ? { error: true, text: result.error }
          : { error: false, text: `Added a new version of this ${noun} in that template.` },
      );
    } catch {
      setOutcome({ error: true, text: "Couldn't switch the template. Try again." });
    } finally {
      setRunning(false);
    }
  }

  async function pickLibraryTemplate(id) {
    setAnchor(null);
    setRunning(true);
    const file = await fetchLibraryTemplateFile(scope, id);
    if (!file) {
      setRunning(false);
      setOutcome({ error: true, text: "Couldn't load that template. Try again." });
      return;
    }
    await regenerateWith(file);
  }

  function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // The doc builder only applies a .docx template; anything else would be
    // skipped there and the "new version" would keep the old formatting.
    if (!isDocxResume(file)) {
      setPickerError("That file isn't a .docx. Choose a Word document.");
      return;
    }
    setAnchor(null);
    void regenerateWith(file);
  }

  const templates = library.templates;

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <Tooltip title={reason || `Format this ${noun} in another template (adds a new version)`}>
        <span>
          <Button
            data-testid="switch-template-control"
            size="small"
            variant="outlined"
            startIcon={
              running
                ? <CircularProgress size={14} aria-label="Switching template" />
                : <SwapHorizIcon fontSize="small" />
            }
            onClick={openPicker}
            disabled={Boolean(reason)}
            aria-describedby={reason ? reasonId : undefined}
            aria-expanded={Boolean(anchor)}
            sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}
          >
            Switch template…
          </Button>
          {reason ? <Box component="span" id={reasonId} sx={visuallyHidden}>{reason}</Box> : null}
        </span>
      </Tooltip>
      <Box aria-live="polite" sx={{ ...CAPTION_SX, ...(outcome.error ? { color: "var(--danger)" } : {}) }}>
        {outcome.text}
      </Box>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1.5, width: "min(340px, calc(100vw - 32px))", display: "grid", gap: 1 }}>
          <Box sx={{ fontWeight: 600, fontSize: "0.85rem" }}>Format this {noun} with…</Box>
          {library.status === "loading" ? <Box sx={CAPTION_SX}>Loading your templates…</Box> : null}
          {library.status === "error" ? (
            <Box role="alert" sx={{ ...CAPTION_SX, color: "var(--danger)" }}>{library.error}</Box>
          ) : null}
          {library.status === "ready" && templates.length === 0 ? (
            <Box sx={CAPTION_SX}>No saved templates yet. Upload a .docx below.</Box>
          ) : null}
          {templates.length > 0 ? (
            <MenuList dense aria-label="Your saved templates" sx={{ p: 0 }}>
              {templates.map((template) => (
                <MenuItem
                  key={template.id}
                  onClick={() => pickLibraryTemplate(template.id)}
                  sx={{ ...TOUCH_TARGET_SX, ...BREAK_LONG_WORDS_SX, whiteSpace: "normal" }}
                >
                  {template.name}
                </MenuItem>
              ))}
            </MenuList>
          ) : null}
          <Button
            size="small"
            variant="outlined"
            onClick={() => fileRef.current?.click()}
            sx={{ textTransform: "none", ...TOUCH_TARGET_SX }}
          >
            Upload a .docx…
          </Button>
          <input ref={fileRef} type="file" hidden accept=".docx" onChange={handleUpload} />
          <Box sx={CAPTION_SX}>An uploaded file is used for this one version only. It isn&apos;t added to your library.</Box>
          {pickerError ? <Box role="alert" sx={{ ...CAPTION_SX, color: "var(--danger)" }}>{pickerError}</Box> : null}
        </Box>
      </Popover>
    </Box>
  );
}
