"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
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
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import TrackChangesIcon from "@mui/icons-material/TrackChanges";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import { renderModelToHtml } from "@/lib/document/docxPreview";
import { downloadCombinedDocuments } from "@/lib/document/combineDocuments";
import { sanitizeFileNamePart } from "@/lib/document/docx";
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
// Cover-letter framing options for the in-preview control. "" = auto-detect; the
// rest pin the framing — the technical/non-technical axis the user controls, plus
// teaching and university-staff. Mirrors the focus picker's VARIANT_OPTIONS.
const FRAMING_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "industry", label: "Technical" },
  { value: "nontechnical", label: "Non-technical" },
  { value: "teaching", label: "Teaching" },
  { value: "staff", label: "University staff" },
];
const FRAMING_LABEL = Object.fromEntries(FRAMING_OPTIONS.map((o) => [o.value, o.label]));

// A page-like surface so the preview reads like the printed document. The
// "paper" stays white with dark ink in both themes (it mirrors a printed page).
const pageSx = {
  bgcolor: "var(--paper-bg)",
  color: "var(--paper-ink)",
  fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif',
  fontSize: "11pt",
  lineHeight: 1.3,
  px: { xs: 2, sm: 5 },
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

// Format-toolbar buttons: bigger tap targets on phones, and never shrink so the
// bar stays a single swipeable row on narrow screens.
const fmtBtnSx = { minWidth: { xs: 40, sm: 36 }, minHeight: { xs: 40, sm: 32 }, flexShrink: 0 };
const fmtGapSx = { width: 8, flexShrink: 0 };

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
  onRenameFile,
  onResubmit,
  onDownload,
  onClose,
  onResearchCompany,
  onScrapePosting,
  focus = null,
  coverVariant = null,
  persona = null,
  keywordEditsCount = 0,
  onOpenFocusPicker,
  focusControls = null,
  onSetFraming,
  researchLoading = false,
  researchCount = 0,
  companyReferences = [],
  busy = false,
  notice = "",
  error = "",
}) {
  const isMobile = useIsMobile();
  // The revise box re-runs the selected engine (the `engine` prop), so its copy
  // reflects which one: Gemini rewrites freely; Embedded applies
  // emphasize/avoid/tone directives deterministically.
  const isEmbedded = engine === "embedded";
  const [tab, setTab] = useState(initialTab);
  const [mode, setMode] = useState("view"); // "view" | "edit"
  // Per-scope render state: { loading, html, error }.
  const [docState, setDocState] = useState({});
  // Steering box: free-text instructions to re-run the selected engine with.
  const [steerText, setSteerText] = useState("");
  const [resubmitting, setResubmitting] = useState(false);
  // Manual posting scrape ("Scan posting" button): busy flag + inline feedback.
  // The result opens the library-update dialog; nothing is saved without the
  // user's approval there.
  const [scraping, setScraping] = useState(false);
  const [scrapeNote, setScrapeNote] = useState(null); // { ok, message } | null
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevReloadKey, setPrevReloadKey] = useState(reloadKey);
  // Auto-save: edits commit on a short debounce; this drives the inline status.
  const [saveStatus, setSaveStatus] = useState("saved"); // "saved" | "saving"
  // Editable download file name (base, no extension) for the active scope.
  const [fileNameDraft, setFileNameDraft] = useState("");
  const [fileNameTab, setFileNameTab] = useState(initialTab);
  // "Combine both documents" control: output format + busy/error, shown when a
  // résumé AND a cover letter both exist. Engine-agnostic (works off the render
  // models, not the engine's finished doc).
  const [combineFormat, setCombineFormat] = useState("docx"); // "docx" | "pdf"
  const [combining, setCombining] = useState(false);
  const [combineError, setCombineError] = useState("");
  const editorRef = useRef(null);
  const draftHtmlRef = useRef({}); // scope -> edited innerHTML (uncommitted)
  const savedRangeRef = useRef(null); // selection captured before a control steals focus
  const saveTimerRef = useRef(null); // pending auto-save debounce timer

  const available = (scope) => !!scopes[scope]?.available;

  // Commit the editor's current content to the parent (the actual save). Clears
  // any pending debounce so a flush-on-close can't double-fire.
  const commitDraft = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (mode !== "edit" || !editorRef.current) return;
    const html = editorRef.current.innerHTML;
    draftHtmlRef.current[tab] = html;
    onSave?.(tab, { text: editorRef.current.innerText, html });
    setSaveStatus("saved");
  };

  // Called on every edit: show "Saving…" and debounce the actual commit.
  const scheduleAutoSave = () => {
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      commitDraft();
    }, 600);
  };

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
      setSaveStatus("saved");
      setFileNameTab(startTab);
      setFileNameDraft(scopes[startTab]?.fileName || "");
      setCombineError("");
    }
  }

  // Drop cached renders when the parent bumps reloadKey (e.g. after research is
  // woven into the cover letter) so the preview reflects the updated document.
  if (reloadKey !== prevReloadKey) {
    setPrevReloadKey(reloadKey);
    setDocState({});
    draftHtmlRef.current = {};
    setMode("view");
    setSaveStatus("saved");
    // A resubmit can change the derived file name (new job title) — reseed it.
    setFileNameTab(tab);
    setFileNameDraft(scopes[tab]?.fileName || "");
  }

  // Reseed the file-name field when the active scope changes.
  if (tab !== fileNameTab) {
    setFileNameTab(tab);
    setFileNameDraft(scopes[tab]?.fileName || "");
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

  // Never leave a debounce timer running after unmount.
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

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
    scheduleAutoSave();
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
    scheduleAutoSave();
  };

  // Turn the caret's block into a heading or normal paragraph. Restores the
  // selection first because the dropdown steals focus.
  const applyBlockFormat = (tag) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand("formatBlock", false, tag);
    if (editorRef.current) draftHtmlRef.current[tab] = editorRef.current.innerHTML;
    scheduleAutoSave();
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
      scheduleAutoSave();
    } else {
      copyText(text);
    }
  };

  // The plain text + html of the active document, for download.
  const activePayload = () => {
    if (mode === "edit" && editorRef.current) {
      return { text: editorRef.current.innerText, html: editorRef.current.innerHTML };
    }
    return { text: scopes[tab]?.text || "", html: scopes[tab]?.html || docState[tab]?.html || "" };
  };

  // Commit any pending edit, then download the active document.
  const handleDownload = () => { commitDraft(); onDownload?.(tab, activePayload()); };

  // Combine the résumé + cover letter into one .docx or .pdf. Loads BOTH render
  // models (engine-agnostic — they come from the finished doc or the edited text
  // via the parent's loadModel), then builds a single page-broken document. The
  // .pdf path prints the same HTML the preview shows (browser "Save as PDF").
  const combinedFileBase = () => {
    const base = [sanitizeFileNamePart(company || ""), sanitizeFileNamePart(jobTitle || "")]
      .filter(Boolean)
      .join(" - ");
    return (base ? `${base} - ` : "") + "Application";
  };
  const handleCombine = async () => {
    if (combining || typeof loadModel !== "function") return;
    commitDraft();
    setCombining(true);
    setCombineError("");
    try {
      const models = await Promise.all(SCOPES.filter(available).map((scope) => loadModel(scope)));
      const err = await downloadCombinedDocuments({ models, format: combineFormat, fileBase: combinedFileBase() });
      if (err) setCombineError(err);
    } catch (e) {
      setCombineError(e?.message || "Unable to build the combined document.");
    } finally {
      setCombining(false);
    }
  };

  // Flush pending edits, then close.
  const handleClose = () => { commitDraft(); onClose?.(); };

  // Commit the file-name field to the parent when the user finishes editing it.
  const commitFileName = () => {
    const next = fileNameDraft.trim();
    if (next !== (scopes[tab]?.fileName || "")) onRenameFile?.(tab, next);
  };

  // Kick off the posting buzzword scrape. The parent scans the posting and, when
  // there's vocabulary the library lacks, opens the review dialog on top of this
  // one; here we only track busy state and surface the outcome inline.
  const submitScrape = async () => {
    if (scraping || typeof onScrapePosting !== "function") return;
    setScraping(true);
    setScrapeNote(null);
    try {
      const res = await onScrapePosting();
      if (res && res.message) setScrapeNote({ ok: !!res.ok, message: res.message });
    } catch (err) {
      setScrapeNote({ ok: false, message: err?.message || "Couldn't scan the posting." });
    } finally {
      setScraping(false);
    }
  };

  // Resubmit the active document to the selected engine with the typed steering
  // instructions. The parent re-runs the tailor and refreshes the preview; on
  // success we clear the box (see steeringEnabled below for which engines).
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
  // "Combine both" is offered only when a résumé AND a cover letter both exist.
  const canCombine = SCOPES.every(available) && typeof loadModel === "function";
  // Steering re-tailors from instructions: Gemini rewrites freely, and the
  // embedded engine applies emphasize/avoid/tone directives offline. The
  // external engine has no steering path, so the box stays hidden there.
  const steeringEnabled =
    (engine === "gemini" || isEmbedded) && available(tab) && typeof onResubmit === "function";

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      <DialogTitle
        sx={{
          pb: 0.5,
          pr: isMobile ? 6 : 3,
          position: "relative",
          fontSize: { xs: "1.05rem", sm: "1.25rem" },
        }}
      >
        Tailored documents{heading ? ` — ${heading}` : ""}
        {isMobile ? (
          <IconButton
            aria-label="Close"
            onClick={handleClose}
            sx={{ position: "absolute", right: 8, top: 8, color: "var(--text-secondary)" }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        ) : null}
      </DialogTitle>

      <Box sx={{ px: { xs: 1, sm: 2 }, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
        <Tabs value={tab} onChange={(_e, v) => { commitDraft(); setTab(v); setMode("view"); }} sx={{ minHeight: 40, width: { xs: "100%", sm: "auto" } }}>
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
        <Box sx={{ flex: 1, display: { xs: "none", sm: "block" } }} />
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: { xs: 0.5, sm: 1 },
            flexWrap: "wrap",
            width: { xs: "100%", sm: "auto" },
          }}
        >
        {isEmbedded && onOpenFocusPicker ? (
          <Tooltip title="Wrong focus or letter framing? Pick the focus area, toggle the teaching/staff/industry letter, and adjust buzzwords — both documents regenerate.">
            <span>
              <Button
                size="small"
                startIcon={<TrackChangesIcon fontSize="small" />}
                onClick={onOpenFocusPicker}
                disabled={busy}
                sx={{ textTransform: "none", my: 0.5, maxWidth: 300 }}
              >
                <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Focus: {focus?.name || "auto"}
                  {focus?.source === "override" ? " (pinned)" : ""}
                  {persona?.name ? ` · persona: ${persona.name}` : ""}
                  {coverVariant?.name
                    ? ` · letter: ${coverVariant.name}${coverVariant.source === "override" ? " (pinned)" : ""}`
                    : ""}
                  {keywordEditsCount > 0 ? ` · ${keywordEditsCount} buzzword edit${keywordEditsCount === 1 ? "" : "s"}` : ""}
                </Box>
              </Button>
            </span>
          </Tooltip>
        ) : null}
        {isEmbedded && onSetFraming ? (
          <Tooltip title="Frame the documents technically (product / engineering) or non-technically (leadership / change) — or auto-detect. Regenerates the cover letter with the matching framing.">
            <span>
              <Select
                size="small"
                value={coverVariant?.source === "override" ? coverVariant?.name || "" : ""}
                onChange={(e) => onSetFraming(e.target.value)}
                disabled={busy}
                displayEmpty
                renderValue={(v) => `Framing: ${FRAMING_LABEL[v] ?? "Auto"}`}
                MenuProps={{ disableAutoFocusItem: true }}
                sx={{ height: 32, fontSize: "0.8rem", my: 0.5, maxWidth: 220 }}
              >
                {FRAMING_OPTIONS.map((o) => (
                  <MenuItem key={o.value || "auto"} value={o.value} sx={{ fontSize: "0.85rem" }}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </span>
          </Tooltip>
        ) : null}
        {onScrapePosting ? (
          <Tooltip title="Scrape this posting for buzzwords your tailoring library doesn't know yet. You review the results — nothing is saved without your approval.">
            <span>
              <Button
                size="small"
                startIcon={scraping ? <CircularProgress size={14} /> : <ManageSearchIcon fontSize="small" />}
                onClick={submitScrape}
                disabled={scraping || busy}
                sx={{ textTransform: "none", my: 0.5 }}
              >
                {scraping ? "Scanning…" : "Scan posting"}
              </Button>
            </span>
          </Tooltip>
        ) : null}
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
            onChange={(_e, v) => { if (!v) return; if (v === "view") commitDraft(); setMode(v); }}
            sx={{ my: 0.5 }}
          >
            <ToggleButton value="view" sx={{ textTransform: "none", px: 1.5 }}>Preview</ToggleButton>
            <ToggleButton value="edit" sx={{ textTransform: "none", px: 1.5 }}>Edit</ToggleButton>
          </ToggleButtonGroup>
        ) : null}
        </Box>
      </Box>

      {focusControls}

      {scrapeNote ? (
        <Box
          sx={{
            px: { xs: 1.25, sm: 2 },
            py: 0.5,
            fontSize: "0.8rem",
            color: scrapeNote.ok ? "var(--text-secondary)" : "var(--danger)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {scrapeNote.message}
        </Box>
      ) : null}

      {available(tab) ? (
        <Box sx={{ px: { xs: 1.25, sm: 2 }, py: 0.75, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
          <Box component="span" sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
            File name
          </Box>
          <TextField
            size="small"
            value={fileNameDraft}
            onChange={(e) => setFileNameDraft(e.target.value)}
            onBlur={commitFileName}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
            placeholder={SCOPE_LABEL[tab]}
            InputProps={{
              endAdornment: <InputAdornment position="end" sx={{ color: "var(--text-muted)" }}>.docx</InputAdornment>,
            }}
            sx={{ flex: 1, minWidth: 200, maxWidth: 460, bgcolor: "var(--bg-surface)", borderRadius: 1 }}
          />
          {mode === "edit" ? (
            <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {saveStatus === "saving" ? (
                <>
                  <CircularProgress size={13} sx={{ color: "var(--text-muted)" }} />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircleIcon sx={{ fontSize: 15, color: "var(--success)" }} />
                  Saved
                </>
              )}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {mode === "edit" && available(tab) ? (
        <Box
          sx={{
            px: { xs: 1, sm: 2 },
            py: 0.75,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            flexWrap: { xs: "nowrap", sm: "wrap" },
            overflowX: { xs: "auto", sm: "visible" },
            WebkitOverflowScrolling: "touch",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Tooltip title="Bold"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }} sx={fmtBtnSx}><FormatBoldIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Italic"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }} sx={fmtBtnSx}><FormatItalicIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Underline"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }} sx={fmtBtnSx}><FormatUnderlinedIcon fontSize="small" /></Button></Tooltip>
          <Box sx={fmtGapSx} />
          <Tooltip title="Align left"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyLeft"); }} sx={fmtBtnSx}><FormatAlignLeftIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Align center"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyCenter"); }} sx={fmtBtnSx}><FormatAlignCenterIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Align right"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("justifyRight"); }} sx={fmtBtnSx}><FormatAlignRightIcon fontSize="small" /></Button></Tooltip>
          <Box sx={fmtGapSx} />
          <Tooltip title="Bulleted list"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }} sx={fmtBtnSx}><FormatListBulletedIcon fontSize="small" /></Button></Tooltip>
          <Tooltip title="Numbered list"><Button size="small" onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }} sx={fmtBtnSx}><FormatListNumberedIcon fontSize="small" /></Button></Tooltip>
          <Box sx={fmtGapSx} />
          <Select
            size="small"
            displayEmpty
            value=""
            onChange={(e) => applyBlockFormat(e.target.value)}
            renderValue={() => "Style"}
            sx={{ height: { xs: 40, sm: 32 }, fontSize: "0.8rem", minWidth: 92, flexShrink: 0 }}
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
            sx={{ height: { xs: 40, sm: 32 }, fontSize: "0.8rem", minWidth: 76, flexShrink: 0 }}
            MenuProps={{ disableAutoFocusItem: true }}
          >
            {FONT_SIZES.map((pt) => (
              <MenuItem key={pt} value={pt}>{pt} pt</MenuItem>
            ))}
          </Select>
        </Box>
      ) : null}

      {tab === "cover" && companyReferences.length > 0 ? (
        <Box sx={{ px: { xs: 1.25, sm: 2 }, py: 1, borderBottom: "1px solid var(--border)", bgcolor: "var(--accent-soft)" }}>
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

      <DialogContent dividers sx={{ bgcolor: "var(--surface-2)", px: { xs: 1.25, sm: 3 } }}>
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
            onInput={(e) => { draftHtmlRef.current[tab] = e.currentTarget.innerHTML; saveSelection(); scheduleAutoSave(); }}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onBlur={() => { saveSelection(); commitDraft(); }}
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
        <Box sx={{ px: { xs: 1.25, sm: 2 }, pt: 1.25, pb: 0.5, borderTop: "1px solid var(--border)", bgcolor: "var(--accent-soft)" }}>
          <Box sx={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", mb: 0.75 }}>
            {isEmbedded
              ? `Revise this ${SCOPE_LABEL[tab].toLowerCase()} offline (no AI)`
              : `Ask Gemini to revise this ${SCOPE_LABEL[tab].toLowerCase()}`}
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
              placeholder={
                isEmbedded
                  ? "e.g. Emphasize React and Kubernetes, remove Java, tone it down"
                  : "e.g. Emphasize leadership, shorten the summary, and call out my Python experience"
              }
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
            {isEmbedded
              ? "Regenerates on-device, applying emphasize / remove / tone-it-down directives. Enter to submit, Shift+Enter for a new line."
              : "Regenerates this document with Gemini using your instructions. Enter to submit, Shift+Enter for a new line."}
          </Box>
        </Box>
      ) : null}

      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: { xs: 1.25, sm: 2 }, py: 1.5 }}>
        <Button onClick={handleClose} sx={{ textTransform: "none" }}>Close</Button>
        <Box sx={{ flex: 1 }} />
        {combineError ? (
          <Box sx={{ width: "100%", fontSize: "0.8rem", color: "var(--danger)", textAlign: "right" }}>{combineError}</Box>
        ) : null}
        {canCombine ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Select
              size="small"
              value={combineFormat}
              onChange={(e) => setCombineFormat(e.target.value)}
              disabled={combining || busy}
              sx={{ height: 36, fontSize: "0.8rem" }}
              MenuProps={{ disableAutoFocusItem: true }}
            >
              <MenuItem value="docx" sx={{ fontSize: "0.85rem" }}>.docx</MenuItem>
              <MenuItem value="pdf" sx={{ fontSize: "0.85rem" }}>.pdf</MenuItem>
            </Select>
            <Tooltip
              title={
                combineFormat === "pdf"
                  ? "Combine your résumé and cover letter into one PDF — opens your browser's print dialog, where you choose “Save as PDF”."
                  : "Combine your résumé and cover letter into a single .docx (résumé first, cover letter on a new page)."
              }
            >
              <span>
                <Button
                  onClick={handleCombine}
                  disabled={combining || busy}
                  startIcon={combining ? <CircularProgress size={14} /> : <LibraryBooksIcon />}
                  variant="outlined"
                  sx={{ textTransform: "none" }}
                >
                  {combining ? "Combining…" : "Download combined"}
                </Button>
              </span>
            </Tooltip>
          </Box>
        ) : null}
        <Tooltip title={`Download the ${SCOPE_LABEL[tab].toLowerCase()} as .docx`}>
          <span>
            <Button
              onClick={handleDownload}
              disabled={!available(tab) || busy}
              startIcon={<DescriptionIcon />}
              variant="contained"
              sx={{ textTransform: "none" }}
            >
              Download .docx
            </Button>
          </span>
        </Tooltip>
      </DialogActions>
    </Dialog>
  );
}
