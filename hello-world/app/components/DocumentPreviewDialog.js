"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import DescriptionIcon from "@mui/icons-material/Description";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { renderModelToHtml } from "@/lib/document/docxPreview";
import { useIsMobile } from "../hooks/useResponsive";

const SCOPES = ["resume", "cover"];
const SCOPE_LABEL = { resume: "Resume", cover: "Cover letter" };
const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18];
// Block/paragraph styles for the header dropdown (execCommand formatBlock tags).
const BLOCK_STYLES = [
  { tag: "P", label: "Normal" },
  { tag: "H1", label: "Heading 1" },
  { tag: "H2", label: "Heading 2" },
  { tag: "H3", label: "Heading 3" },
];

// A page-like surface so the preview reads like the printed document. The
// "paper" stays white with dark ink in both themes (it mirrors a printed page).
const pageSx = {
  bgcolor: "var(--paper-bg)",
  color: "var(--paper-ink)",
  fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif',
  fontSize: "11pt",
  lineHeight: 1.3,
  px: { xs: 2.5, sm: 5 },
  py: { xs: 2.5, sm: 4 },
  mx: "auto",
  maxWidth: 720,
  minHeight: 360,
  border: "1px solid var(--border)",
  borderRadius: 1,
  boxShadow: "0 1px 6px rgba(0,0,0,0.10)",
  "& p": { margin: 0 },
  "& h1": { fontSize: "16pt", fontWeight: 700, margin: "8pt 0 3pt" },
  "& h2": { fontSize: "13pt", fontWeight: 700, margin: "7pt 0 2pt" },
  "& h3": { fontSize: "11.5pt", fontWeight: 700, margin: "5pt 0 2pt" },
  "& ul, & ol": { margin: "3pt 0", paddingLeft: "1.5em" },
  "& li": { margin: "1pt 0" },
};

// Preview + edit the tailored résumé and cover letter for a posting. Renders the
// SAME .docx the download produces so formatting matches; supports flipping
// between documents and basic in-place format editing.
export default function DocumentPreviewDialog({
  open,
  jobTitle = "",
  company = "",
  initialTab = "resume",
  scopes = {},
  engine = "",
  loadModel,
  reloadKey = 0,
  onSave,
  onResubmit,
  onDownload,
  onClose,
  onResearchCompany,
  researchLoading = false,
  researchCount = 0,
  companyReferences = [],
  busy = false,
  notice = "",
  error = "",
}) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(initialTab);
  const [mode, setMode] = useState("view"); // "view" | "edit"
  // Per-scope render state: { loading, html, error }.
  const [docState, setDocState] = useState({});
  // Steering box: free-text instructions to re-run the Gemini tailor with.
  const [steerText, setSteerText] = useState("");
  const [resubmitting, setResubmitting] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevReloadKey, setPrevReloadKey] = useState(reloadKey);
  const editorRef = useRef(null);
  const draftHtmlRef = useRef({}); // scope -> edited innerHTML (uncommitted)
  const savedRangeRef = useRef(null); // selection captured before a control steals focus

  const available = (scope) => !!scopes[scope]?.available;

  // (Re)seed when the dialog transitions to open.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const startTab = available(initialTab) ? initialTab : SCOPES.find(available) || "resume";
      setTab(startTab);
      setMode("view");
      setDocState({});
      draftHtmlRef.current = {};
      setSteerText("");
    }
  }

  // Drop cached renders when the parent bumps reloadKey (e.g. after research is
  // woven into the cover letter) so the preview reflects the updated document.
  if (reloadKey !== prevReloadKey) {
    setPrevReloadKey(reloadKey);
    setDocState({});
    draftHtmlRef.current = {};
    setMode("view");
  }

  // Load (parse) the active document's model into HTML on demand.
  const ensureLoaded = useCallback(
    async (scope) => {
      if (!available(scope)) return;
      setDocState((s) => (s[scope] ? s : { ...s, [scope]: { loading: true } }));
      try {
        const saved = scopes[scope]?.html;
        const html = saved || renderModelToHtml(await loadModel(scope));
        setDocState((s) => ({ ...s, [scope]: { loading: false, html } }));
      } catch (e) {
        setDocState((s) => ({ ...s, [scope]: { loading: false, error: e?.message || "Unable to render preview." } }));
      }
    },
    [scopes, loadModel], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (open && available(tab) && !docState[tab]) ensureLoaded(tab);
  }, [open, tab, docState, ensureLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed the editable surface when entering edit mode (or switching scope while
  // editing). We set innerHTML imperatively so typing never resets the caret.
  useEffect(() => {
    if (mode !== "edit" || !editorRef.current) return;
    editorRef.current.innerHTML = draftHtmlRef.current[tab] ?? docState[tab]?.html ?? "";
    editorRef.current.focus();
  }, [mode, tab, docState]);

  // Remember the editor's current selection so a control that steals focus (e.g.
  // the font-size dropdown) can restore it before applying a format.
  const saveSelection = () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    return sel;
  };

  const exec = (command, value) => {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    if (editorRef.current) draftHtmlRef.current[tab] = editorRef.current.innerHTML;
  };

  const applyFontSize = (pt) => {
    editorRef.current?.focus();
    const sel = restoreSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const span = document.createElement("span");
      span.style.fontSize = `${pt}pt`;
      try {
        sel.getRangeAt(0).surroundContents(span);
      } catch {
        // Selection crosses element boundaries — fall back to wrapping the HTML.
        document.execCommand("insertHTML", false, `<span style="font-size:${pt}pt">${sel.toString()}</span>`);
      }
    }
    if (editorRef.current) draftHtmlRef.current[tab] = editorRef.current.innerHTML;
  };

  // Turn the caret's block into a heading or normal paragraph. Restores the
  // selection first because the dropdown steals focus.
  const applyBlockFormat = (tag) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand("formatBlock", false, tag);
    if (editorRef.current) draftHtmlRef.current[tab] = editorRef.current.innerHTML;
  };

  const copyText = (text) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard may be unavailable */
    }
  };
  // Insert a sentence at the caret (edit mode) as its own paragraph; otherwise
  // copy it so the user can paste wherever they like.
  const insertReference = (text) => {
    if (mode === "edit" && editorRef.current) {
      editorRef.current.focus();
      restoreSelection();
      document.execCommand("insertHTML", false, `<p>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</p>`);
      draftHtmlRef.current[tab] = editorRef.current.innerHTML;
    } else {
      copyText(text);
    }
  };

  // The plain text + html of the active document, for save/download.
  const activePayload = () => {
    if (mode === "edit" && editorRef.current) {
      return { text: editorRef.current.innerText, html: editorRef.current.innerHTML };
    }
    return { text: scopes[tab]?.text || "", html: scopes[tab]?.html || docState[tab]?.html || "" };
  };

  const handleSave = () => {
    const payload = activePayload();
    if (payload.html) setDocState((s) => ({ ...s, [tab]: { loading: false, html: payload.html } }));
    onSave?.(tab, payload);
  };
  const handleDownload = () => onDownload?.(tab, activePayload());

  // Resubmit the active document to Gemini with the typed steering instructions.
  // The parent re-runs the tailor and refreshes the preview; on success we clear
  // the box. Only available for the Gemini engine (see steeringEnabled below).
  const submitSteer = async () => {
    const text = steerText.trim();
    if (!text || resubmitting || busy) return;
    setResubmitting(true);
    try {
      const ok = await onResubmit?.(tab, text);
      if (ok !== false) setSteerText("");
    } finally {
      setResubmitting(false);
    }
  };

  const heading = [company, jobTitle].filter(Boolean).join(" · ");
  const state = docState[tab] || {};
  const hasContent = SCOPES.some(available);
  // Steering is a Gemini-only feature: only Gemini re-tailors from instructions.
  const steeringEnabled = engine === "gemini" && available(tab) && typeof onResubmit === "function";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 0.5 }}>
        Tailored documents{heading ? ` — ${heading}` : ""}
      </DialogTitle>

      <Box sx={{ px: 2, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
        <Tabs value={tab} onChange={(_e, v) => { setTab(v); setMode("view"); }} sx={{ minHeight: 40 }}>
          {SCOPES.map((scope) => (
            <Tab
              key={scope}
              value={scope}
              label={available(scope) ? SCOPE_LABEL[scope] : `${SCOPE_LABEL[scope]} (none)`}
              disabled={!available(scope)}
              sx={{ textTransform: "none", minHeight: 40 }}
            />
          ))}
        </Tabs>
        <Box sx={{ flex: 1 }} />
        {tab === "cover" && onResearchCompany ? (
          <Button
            size="small"
            startIcon={researchLoading ? <CircularProgress size={14} /> : <TravelExploreIcon fontSize="small" />}
            onClick={onResearchCompany}
            sx={{ textTransform: "none", my: 0.5 }}
          >
            {researchLoading
              ? "Researching…"
              : researchCount > 0
                ? `Research company (${researchCount})`
                : "Research company"}
          </Button>
        ) : null}
        {available(tab) ? (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={mode}
            onChange={(_e, v) => v && setMode(v)}
            sx={{ my: 0.5 }}
          >
            <ToggleButton value="view" sx={{ textTransform: "none", px: 1.5 }}>Preview</ToggleButton>
            <ToggleButton value="edit" sx={{ textTransform: "none", px: 1.5 }}>Edit</ToggleButton>
          </ToggleButtonGroup>
        ) : null}
      </Box>

      {mode === "edit" && available(tab) ? (
        <Box sx={{ px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
          <Tooltip title="Bold"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }} sx={{ minWidth: 36 }}><FormatBoldIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Italic"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }} sx={{ minWidth: 36 }}><FormatItalicIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Underline"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }} sx={{ minWidth: 36 }}><FormatUnderlinedIcon fontSize="small" /></Button></Tooltip>
          <Box sx={{ width: 8 }} />
          <Tooltip title="Align left"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyLeft"); }} sx={{ minWidth: 36 }}><FormatAlignLeftIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Align center"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyCenter"); }} sx={{ minWidth: 36 }}><FormatAlignCenterIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Align right"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyRight"); }} sx={{ minWidth: 36 }}><FormatAlignRightIcon fontSize="small" /></Button></Tooltip>
          <Box sx={{ width: 8 }} />
          <Tooltip title="Bulleted list"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }} sx={{ minWidth: 36 }}><FormatListBulletedIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Numbered list"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }} sx={{ minWidth: 36 }}><FormatListNumberedIcon fontSize="small" /></Button></Tooltip>
          <Box sx={{ width: 8 }} />
          <Select
            size="small"
            displayEmpty
            value=""
            onChange={(e) => applyBlockFormat(e.target.value)}
            renderValue={() => "Style"}
            sx={{ height: 32, fontSize: "0.8rem", minWidth: 92 }}
            MenuProps={{ disableAutoFocusItem: true }}
          >
            {BLOCK_STYLES.map((b) => (
              <MenuItem key={b.tag} value={b.tag}>{b.label}</MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            displayEmpty
            value=""
            onChange={(e) => applyFontSize(e.target.value)}
            renderValue={() => "Size"}
            sx={{ height: 32, fontSize: "0.8rem" }}
            MenuProps={{ disableAutoFocusItem: true }}
          >
            {FONT_SIZES.map((pt) => (
              <MenuItem key={pt} value={pt}>{pt} pt</MenuItem>
            ))}
          </Select>
        </Box>
      ) : null}

      {tab === "cover" && companyReferences.length > 0 ? (
        <Box sx={{ px: 2, py: 1, borderBottom: "1px solid var(--border)", bgcolor: "var(--accent-soft)" }}>
          <Box sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", mb: 0.5 }}>
            Company references {mode === "edit" ? "(Insert at cursor)" : "(switch to Edit to insert, or copy)"}
          </Box>
          {companyReferences.map((ref, i) => (
            <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mb: 0.5 }}>
              <Box sx={{ flex: 1, fontSize: "0.8rem" }}>{ref.suggestion}</Box>
              <Tooltip title={mode === "edit" ? "Insert into letter" : "Copy"}>
                <Button size="small" onClick={() => insertReference(ref.suggestion)} sx={{ textTransform: "none", minWidth: 0, px: 1 }}>
                  {mode === "edit" ? "Insert" : <ContentCopyIcon sx={{ fontSize: 15 }} />}
                </Button>
              </Tooltip>
            </Box>
          ))}
        </Box>
      ) : null}

      <DialogContent dividers sx={{ bgcolor: "var(--surface-2)" }}>
        {!hasContent ? (
          <Box sx={{ p: 4, textAlign: "center", color: "var(--text-muted)" }}>
            Nothing generated yet for this posting.
          </Box>
        ) : !available(tab) ? (
          <Box sx={{ p: 4, textAlign: "center", color: "var(--text-muted)" }}>
            No {SCOPE_LABEL[tab].toLowerCase()} has been generated for this posting yet.
          </Box>
        ) : state.loading ? (
          <Box sx={{ p: 6, textAlign: "center" }}><CircularProgress size={28} /></Box>
        ) : state.error ? (
          <Box sx={{ p: 4, textAlign: "center", color: "var(--danger)" }}>{state.error}</Box>
        ) : mode === "edit" ? (
          <Box
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => { draftHtmlRef.current[tab] = e.currentTarget.innerHTML; saveSelection(); }}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onBlur={saveSelection}
            sx={{ ...pageSx, outline: "none", "&:focus": { boxShadow: "0 0 0 2px var(--accent)" } }}
          />
        ) : (
          <Box sx={pageSx} dangerouslySetInnerHTML={{ __html: state.html || "" }} />
        )}

        {error ? (
          <Box sx={{ mt: 1.5, color: "var(--danger)", fontSize: "0.85rem", textAlign: "center" }}>{error}</Box>
        ) : notice ? (
          <Box sx={{ mt: 1.5, color: "var(--success)", fontSize: "0.85rem", textAlign: "center" }}>{notice}</Box>
        ) : null}
      </DialogContent>

      {steeringEnabled ? (
        <Box sx={{ px: 2, pt: 1.25, pb: 0.5, borderTop: "1px solid var(--border)", bgcolor: "var(--accent-soft)" }}>
          <Box sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", mb: 0.75 }}>
            Ask Gemini to revise this {SCOPE_LABEL[tab].toLowerCase()}
          </Box>
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
            <TextField
              multiline
              minRows={1}
              maxRows={4}
              fullWidth
              size="small"
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits; Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitSteer();
                }
              }}
              placeholder="e.g. Emphasize leadership, shorten the summary, and call out my Python experience"
              disabled={resubmitting || busy}
              sx={{ bgcolor: "var(--bg-surface)", borderRadius: 1 }}
            />
            <Button
              onClick={submitSteer}
              disabled={!steerText.trim() || resubmitting || busy}
              variant="contained"
              startIcon={resubmitting ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon fontSize="small" />}
              sx={{ textTransform: "none", whiteSpace: "nowrap", mt: 0.25 }}
            >
              {resubmitting ? "Revising…" : "Revise"}
            </Button>
          </Box>
          <Box sx={{ fontSize: "0.7rem", color: "var(--text-muted)", mt: 0.5 }}>
            Regenerates this document with Gemini using your instructions. Enter to submit, Shift+Enter for a new line.
          </Box>
        </Box>
      ) : null}

      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Close</Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={`Download the ${SCOPE_LABEL[tab].toLowerCase()} as .docx`}>
          <span>
            <Button
              onClick={handleDownload}
              disabled={!available(tab) || busy}
              startIcon={<DescriptionIcon />}
              variant="outlined"
              sx={{ textTransform: "none" }}
            >
              Download .docx
            </Button>
          </span>
        </Tooltip>
        <Button
          onClick={handleSave}
          disabled={!available(tab) || busy || mode !== "edit"}
          variant="contained"
          sx={{ textTransform: "none" }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
