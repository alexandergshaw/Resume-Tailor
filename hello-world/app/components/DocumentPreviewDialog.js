"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DescriptionIcon from "@mui/icons-material/Description";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import TrackChangesIcon from "@mui/icons-material/TrackChanges";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import { renderModelToHtml } from "@/lib/document/docxPreview";
import { changedScopes as changedScopesOf } from "@/lib/tailor/previewScopes";
import { SCOPES, SCOPE_LABEL, DOCX_SCOPES } from "@/lib/tailor/documentScopes";
import { useIsMobile } from "../hooks/useResponsive";
import EditorToolbar from "./preview/EditorToolbar";
import CombineDocumentsControl from "./preview/CombineDocumentsControl";
import ReviseStrip from "./preview/ReviseStrip";
import VersionControl from "./preview/VersionControl";
import HighlightToggle from "./preview/HighlightToggle";
import DriveActions from "./preview/DriveActions";
import DriveResultRegion from "./preview/DriveResultRegion";

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

// AC-A4's fallback focus target: the id DriveActions.js hardcodes on its own
// save button (`saveLabelId` in that file, not exported -- this is a
// deliberate, documented coupling to that literal string rather than a
// prop/import, since the two components already agree on it for the "aria-
// describedby points at the save control" wiring the a11y audit pinned).
const DRIVE_SAVE_CONTROL_ID = "drive-save-control-label";

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
  onAskAi,
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
  // Per-scope ({ resume, cover }) so an operation on one document never
  // disables or overwrites the other document's controls/notice/error.
  busy = {},
  notice = {},
  error = {},
  // Version history (AC-2/AC-3): per-scope arrays of saved generations, and
  // the id of the version currently selected per scope. See VersionControl.js.
  documentVersions = {},
  currentVersionId = {},
  onSelectVersion,
  // Wave 6A: `useDriveDocuments`'s full return value, mounted one level up
  // in DocumentPreviewMount.js (not here, and not in page.js — ARCH.md
  // §4.3/§12). REQUIRED, deliberately with no default (see the invariant at
  // the top of the function body below for why).
  drive,
  // (scope: "resume"|"cover"|"email") => void. Fired whenever `tab` changes
  // (including the dialog's own initial-tab resolution below, which can
  // differ from `initialTab`) so the mount component can feed the LIVE
  // active scope to `useDriveDocuments` — that hook needs it only to gate
  // the hiring-email caption, but `initialTab` alone is stale the moment the
  // user clicks a different tab (see DocumentPreviewMount.js's comment).
  onActiveScopeChange,
}) {
  // WAVE6-VERIFY.md MAJOR-1 (M15): `drive` used to default to a hand-copied
  // `DEFAULT_DRIVE` shape (`status: "unconfigured"`) whenever the prop was
  // missing -- which meant DocumentPreviewMount.js forgetting `drive={drive}`
  // rendered a perfectly normal-looking, silently Drive-less modal, and the
  // ENTIRE shipped test suite stayed green through that mutation (verified).
  // A default that masks a missing wire is exactly the wrong failure mode
  // for the one prop this whole wave exists to add: fail loudly, immediately,
  // before any hook below runs, rather than quietly. The only production
  // caller (DocumentPreviewMount.js) always supplies useDriveDocuments()'s
  // full return value, so this can never fire in a correctly wired app --
  // and it now fires identically for both `drive={undefined}` (a missing
  // prop) and `drive={null}`, closing the inconsistency where the JSX below
  // reads `drive.leadingLine`/`drive.status` unguarded (crashes on `null`)
  // while `handleSaveToDrive` used to read `drive?.saveToDrive?.()` (safe on
  // `null`) -- two different behaviours for the same misconfiguration.
  if (!drive) {
    throw new Error(
      "DocumentPreviewDialog requires a `drive` prop (ARCH.md §4.3) -- mount via DocumentPreviewMount, which always supplies useDriveDocuments()'s return value.",
    );
  }
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
  // AC-4: inline feedback for the email tab's "Copy" control — "Copied" on
  // success, an explanation on the rare rejection (clipboard API can reject
  // when the document isn't focused or permission is denied).
  const [copyFeedback, setCopyFeedback] = useState("");
  const copyFeedbackTimerRef = useRef(null);
  // AC-4: line-level version highlighting, per scope, defaulting OFF so the
  // normal preview stays clean.
  const [highlightOn, setHighlightOn] = useState({ resume: false, cover: false });
  const editorRef = useRef(null);
  const draftHtmlRef = useRef({}); // scope -> edited innerHTML (uncommitted)
  const savedRangeRef = useRef(null); // selection captured before a control steals focus
  const saveTimerRef = useRef(null); // pending auto-save debounce timer
  // scope -> last text content this dialog has accounted for. Used to tell,
  // on a reloadKey bump, which scope(s) actually got new content — a revise
  // or research-weave on one document must not blow away the other's cached
  // render, draft, or edit mode (AC-2).
  const prevScopeSigRef = useRef({ resume: "", cover: "", email: "" });

  const available = (scope) => !!scopes[scope]?.available;
  const scopeSig = (scope) => scopes[scope]?.text ?? "";
  // AC-6: is there a previous saved generation to diff the active one
  // against? Mirrors the hook's own previousVersionFor (useDocumentPreview.js)
  // using the same documentVersions/currentVersionId props this dialog
  // already receives — kept local rather than plumbed through another prop
  // since it's a three-line array lookup, not diff logic.
  const hasPreviousVersion = (scope) => {
    const versions = documentVersions?.[scope] || [];
    const idx = versions.findIndex((v) => v.id === currentVersionId?.[scope]);
    return idx >= 0 && idx + 1 < versions.length;
  };
  // AC-5: a hand-edited scope's saved HTML is shown as-is (see ensureLoaded
  // below) — there is no freshly parsed model to annotate for it.
  const isHandEdited = (scope) => !!scopes[scope]?.html;
  // The toggle's effective state: hand-edited always wins even if it was
  // left on before the document became hand-edited.
  const highlightEnabled = (scope) => !!highlightOn[scope] && !isHandEdited(scope);
  // AC-4: flip the toggle for a scope and drop its cached render so
  // ensureLoaded re-parses with the new setting — docState otherwise only
  // reloads on open or a real content change.
  const setHighlight = (scope, on) => {
    setHighlightOn((prev) => ({ ...prev, [scope]: on }));
    setDocState((s) => {
      if (!(scope in s)) return s;
      const next = { ...s };
      delete next[scope];
      return next;
    });
  };

  // Per-scope busy/notice/error, derived once per render. `busyActive` gates
  // the active tab's own controls (revise, download); `anyBusy` gates
  // controls that touch BOTH documents (focus picker, framing, combined
  // download); `activeNotice`/`activeError` keep a cover-letter error from
  // showing while the user is on the resume tab, and vice versa (AC-3).
  const busyResume = !!busy?.resume;
  const busyCover = !!busy?.cover;
  const busyActive = !!busy?.[tab];
  const anyBusy = busyResume || busyCover;
  const activeNotice = notice?.[tab] || "";
  const activeError = error?.[tab] || "";
  // AC-8: a cover revise grounds the letter in the résumé text that was just
  // tailored. While a résumé revise is in flight that text is seconds from
  // changing, so the cover revise stays disabled (with a tooltip explaining
  // why) until the résumé settles, rather than grounding on text about to go
  // stale.
  const coverBlockedByResumeBusy = tab === "cover" && busyResume;

  // Commit the editor's current content to the parent (the actual save). Clears
  // any pending debounce so a flush-on-close can't double-fire.
  const commitDraft = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (mode !== "edit" || !editorRef.current) return;
    const html = editorRef.current.innerHTML;
    const text = editorRef.current.innerText;
    draftHtmlRef.current[tab] = html;
    onSave?.(tab, { text, html });
    // Our own save just moved this scope's text — record it as the known
    // baseline so a LATER reloadKey bump (from an unrelated revise) doesn't
    // mistake this scope's own committed edit for external new content.
    prevScopeSigRef.current[tab] = text;
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
      setHighlightOn({ resume: false, cover: false });
      prevScopeSigRef.current = { resume: scopeSig("resume"), cover: scopeSig("cover"), email: scopeSig("email") };
    }
  }

  // The parent bumps reloadKey after a revise, a focus change, or a company-
  // research weave — any of which may touch just one scope or both. Rather
  // than trusting a single shared counter to say WHICH scope changed (it
  // doesn't carry that), diff each scope's actual text against what this
  // dialog last saw: only a scope whose content really changed gets its
  // cached render + draft dropped, and only if that's the ACTIVE scope do we
  // kick out of edit mode / reseed the file name. A revise on the other
  // document leaves this one's cache, draft, and mode untouched (AC-2).
  if (reloadKey !== prevReloadKey) {
    setPrevReloadKey(reloadKey);
    const nextScopeSigs = Object.fromEntries(SCOPES.map((scope) => [scope, scopeSig(scope)]));
    const changed = changedScopesOf(prevScopeSigRef.current, nextScopeSigs, SCOPES);
    if (changed.length > 0) {
      setDocState((s) => {
        const next = { ...s };
        changed.forEach((scope) => { delete next[scope]; });
        return next;
      });
      changed.forEach((scope) => { delete draftHtmlRef.current[scope]; });
      if (changed.includes(tab)) {
        setMode("view");
        setSaveStatus("saved");
        // A resubmit can change the derived file name (new job title) — reseed it.
        setFileNameTab(tab);
        setFileNameDraft(scopes[tab]?.fileName || "");
      }
    }
    SCOPES.forEach((scope) => { prevScopeSigRef.current[scope] = scopeSig(scope); });
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
        // AC-3/AC-5: a hand-edited scope always shows its saved HTML as-is
        // (never re-annotated); otherwise ask the loader to annotate the
        // model when this scope's highlight toggle is on (AC-4).
        const html = saved || renderModelToHtml(await loadModel(scope, { highlight: highlightEnabled(scope) }));
        setDocState((s) => ({ ...s, [scope]: { loading: false, html } }));
      } catch (e) {
        setDocState((s) => ({ ...s, [scope]: { loading: false, error: e?.message || "Unable to render preview." } }));
      }
    },
    [scopes, loadModel, highlightOn], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (open && available(tab) && !docState[tab]) ensureLoaded(tab);
  }, [open, tab, docState, ensureLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Report the live active scope upward on every change — the tab-click
  // handler, the open/reopen reseed, and the reloadKey reseed all funnel
  // through `setTab`, so this one effect covers every path that can change
  // it (see `onActiveScopeChange`'s own doc comment above).
  useEffect(() => {
    onActiveScopeChange?.(tab);
  }, [tab, onActiveScopeChange]);

  // Seed the editable surface when entering edit mode (or switching scope while
  // editing). We set innerHTML imperatively so typing never resets the caret.
  useEffect(() => {
    if (mode !== "edit" || !editorRef.current) return;
    editorRef.current.innerHTML = draftHtmlRef.current[tab] ?? docState[tab]?.html ?? "";
    editorRef.current.focus();
  }, [mode, tab, docState]);

  // Never leave a debounce timer running after unmount.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
  }, []);

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

  const copyText = (text) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard may be unavailable */
    }
  };
  // AC-4: the email tab's primary action — copies subject + body (the same
  // text the preview shows) so the user can paste both into their email
  // client. Uses the async clipboard API, which can reject when the document
  // isn't focused or permission is denied, so a failure gets its own visible
  // message instead of silently doing nothing.
  const copyEmail = async () => {
    if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
    try {
      await navigator.clipboard.writeText(scopes.email?.text || "");
      setCopyFeedback("Copied");
    } catch {
      setCopyFeedback("Couldn't copy — select the text below and copy it manually.");
    }
    copyFeedbackTimerRef.current = setTimeout(() => setCopyFeedback(""), 3000);
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

  // Flush pending edits, then close.
  const handleClose = () => { commitDraft(); onClose?.(); };

  // Commit the file-name field to the parent when the user finishes editing it.
  const commitFileName = () => {
    const next = fileNameDraft.trim();
    if (next !== (scopes[tab]?.fileName || "")) onRenameFile?.(tab, next);
  };

  // AC-A4: "on the consent return, focus returns to the element captured at
  // click time, else to the save control." Captured unconditionally on
  // EVERY Save-to-Drive click, even the common case where this save never
  // needs consent at all (already connected) -- harmless, since the ref is
  // simply overwritten by the next click before the restoration effect
  // below ever reads it for a save that actually opens the popup.
  const consentReturnFocusRef = useRef(null);
  // Where focus was the instant `drive.status` first became "consentPending"
  // -- i.e. wherever the browser left it once the OAuth popup took over
  // (typically <body>, since opening a new window blurs the opener
  // document). Comparing against THIS snapshot on the way back out, rather
  // than hardcoding `document.body`, is what lets a keyboard/AT user who
  // deliberately moved focus elsewhere *while the popup was open* keep their
  // own focus instead of being yanked back -- mirroring
  // DriveOverwriteDialog.js's own "restore only if focus is still where you
  // left it" precedent, adapted from a DOM-removal to a popup-window return.
  const focusAtConsentOpenRef = useRef(null);
  const prevDriveStatusRef = useRef(drive.status);

  // `useLayoutEffect`, not `useEffect`, so the restoration happens
  // synchronously as part of the SAME commit that carries the status change
  // out of "consentPending" -- before the browser paints a frame with focus
  // sitting nowhere useful. (DriveOverwriteDialog.js needs `useLayoutEffect`
  // for a stronger reason -- its cleanup must read `document.activeElement`
  // before React detaches the node it focused, which a passive effect's
  // later-firing cleanup would miss entirely; there is no DOM removal here,
  // but the same "run before paint, not after" ordering is what this needs
  // too.)
  useLayoutEffect(() => {
    const prevStatus = prevDriveStatusRef.current;
    const nextStatus = drive.status;
    prevDriveStatusRef.current = nextStatus;
    if (nextStatus === "consentPending" && prevStatus !== "consentPending") {
      focusAtConsentOpenRef.current = document.activeElement;
      return;
    }
    if (prevStatus === "consentPending" && nextStatus !== "consentPending") {
      const untouchedSinceConsentOpened = document.activeElement === focusAtConsentOpenRef.current;
      focusAtConsentOpenRef.current = null;
      if (!untouchedSinceConsentOpened) return; // the user moved focus themselves -- don't yank it back
      const captured = consentReturnFocusRef.current;
      const target =
        captured && typeof captured.focus === "function" && document.contains(captured)
          ? captured
          : document.getElementById(DRIVE_SAVE_CONTROL_ID);
      target?.focus();
    }
  }, [drive.status]);

  // The ONLY way a Drive save is invoked (ARCH.md §4.3). `useDriveDocuments`
  // has no access to this dialog's local draft state, so it cannot itself be
  // `DriveActions.onSave` (that prop is zero-argument) — this dialog must
  // wrap `drive.saveToDrive` with the two commits, and in that exact order:
  // `commitDraft()`/`commitFileName()` are synchronous writes into the
  // PARENT's state via `onSave`/`onRenameFile`, which land through
  // `setTailoringMap` — an ASYNCHRONOUS React state update that has not
  // flushed by the time this function returns. Reading `activePayload()`
  // and `fileNameDraft` directly (both local, already current) rather than
  // anything derived from that parent state is what keeps the bytes handed
  // to `saveToDrive` in sync with what the user just typed, instead of one
  // tick stale. `activeFileName` is trimmed here to match exactly what
  // `commitFileName` just persisted — `useDriveDocuments` uses it RAW.
  const handleSaveToDrive = () => {
    consentReturnFocusRef.current = document.activeElement; // AC-A4: capture at click time
    commitDraft();
    commitFileName();
    drive.saveToDrive?.({
      activeScope: tab,
      activeText: activePayload().text,
      activeFileName: fileNameDraft.trim(),
    });
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

  // Ask AI about the active document: flush any pending auto-save so no edit
  // is lost, then CLOSE this modal before opening the chat panel. ChatPanel
  // renders at z-index 1100, below MUI's default Dialog z-index (1300) with
  // no theme override, so opening it while this dialog is still open would
  // put it behind the dialog, invisible — closing first is the fix.
  const handleAskAi = () => {
    if (!available(tab)) return;
    commitDraft();
    const payload = activePayload();
    onClose?.();
    onAskAi?.(tab, payload);
  };

  const heading = [company, jobTitle].filter(Boolean).join(" · ");
  const state = docState[tab] || {};
  const hasContent = SCOPES.some(available);
  // "Combine both" is offered only when a résumé AND a cover letter both
  // exist — deliberately DOCX_SCOPES, not SCOPES, so the plain-text email
  // scope can never join a combined docx/pdf (AC-5).
  const canCombine = DOCX_SCOPES.every(available) && typeof loadModel === "function";
  // Steering re-tailors from instructions: Gemini rewrites freely, and the
  // embedded engine applies emphasize/avoid/tone directives offline. The
  // external engine has no steering path, so the box stays hidden there.
  // AC-5: there's no steering path for the hiring email either — reviving it
  // means re-running the tailor, not a free-text revise — so the strip is
  // restricted to the docx-backed scopes.
  const steeringEnabled =
    DOCX_SCOPES.includes(tab) &&
    (engine === "gemini" || isEmbedded) &&
    available(tab) &&
    typeof onResubmit === "function";

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
                disabled={anyBusy}
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
                disabled={anyBusy}
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
                disabled={scraping || anyBusy}
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
        {onAskAi ? (
          <Tooltip title={`Ask AI about this ${SCOPE_LABEL[tab].toLowerCase()}`}>
            <span>
              <Button
                size="small"
                startIcon={<SmartToyIcon fontSize="small" />}
                onClick={handleAskAi}
                disabled={!available(tab)}
                sx={{ textTransform: "none", my: 0.5 }}
              >
                Ask AI
              </Button>
            </span>
          </Tooltip>
        ) : null}
        {available(tab) ? (
          <VersionControl
            scope={tab}
            versions={documentVersions?.[tab] || []}
            currentVersionId={currentVersionId?.[tab] ?? null}
            disabled={busyActive}
            onSelect={(scope, versionId) => {
              // AC-5: flush any pending auto-save before switching, exactly
              // like the tab-switch handler above — a version switch must
              // never silently discard typing.
              commitDraft();
              onSelectVersion?.(scope, versionId);
            }}
          />
        ) : null}
        {available(tab) ? (
          <HighlightToggle
            scope={tab}
            on={highlightEnabled(tab)}
            onToggle={(on) => setHighlight(tab, on)}
            hasPrevious={hasPreviousVersion(tab)}
            handEdited={isHandEdited(tab)}
            disabled={busyActive}
          />
        ) : null}
        {/* AC-6: the hiring email isn't editable in place (it's short plain
            text meant to be pasted into an email client, not auto-saved
            through the docx-oriented edit path) — the Preview/Edit toggle is
            restricted to the docx-backed scopes, with a visible reason shown
            in its place below rather than presenting an editor that doesn't
            persist. */}
        {DOCX_SCOPES.includes(tab) && available(tab) ? (
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
        ) : tab === "email" && available(tab) ? (
          <Box component="span" sx={{ fontSize: "0.75rem", color: "var(--text-muted)", my: 0.5 }}>
            Read-only — copy the text below into your email client.
          </Box>
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

      {/* File name only means anything for a docx download — the email tab
          has no download, so this row (and the auto-save status it also
          carries) stays hidden there. */}
      {DOCX_SCOPES.includes(tab) && available(tab) ? (
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

      {mode === "edit" && DOCX_SCOPES.includes(tab) && available(tab) ? (
        <EditorToolbar
          editorRef={editorRef}
          tab={tab}
          draftHtmlRef={draftHtmlRef}
          scheduleAutoSave={scheduleAutoSave}
          restoreSelection={restoreSelection}
        />
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

        {activeError ? (
          <Box data-testid="scope-error" sx={{ mt: 1.5, color: "var(--danger)", fontSize: "0.85rem", textAlign: "center" }}>{activeError}</Box>
        ) : activeNotice ? (
          <Box data-testid="scope-notice" sx={{ mt: 1.5, color: "var(--success)", fontSize: "0.85rem", textAlign: "center" }}>{activeNotice}</Box>
        ) : null}
      </DialogContent>

      {steeringEnabled ? (
        <ReviseStrip
          tab={tab}
          isEmbedded={isEmbedded}
          steerText={steerText}
          setSteerText={setSteerText}
          resubmitting={resubmitting}
          setResubmitting={setResubmitting}
          busyActive={busyActive}
          coverBlockedByResumeBusy={coverBlockedByResumeBusy}
          onResubmit={onResubmit}
        />
      ) : null}

      {/* UX.md rev 2 §3/§13: a SIBLING of DialogActions, in the slot
          ReviseStrip already occupies above -- never inside the action bar.
          Mounted UNCONDITIONALLY (not gated on `steeringEnabled` or any tab
          check) because its two live regions must exist for the dialog's
          whole open lifetime (AC-A5), independent of whether there is
          currently anything visible to show. */}
      <DriveResultRegion
        leadingLine={drive.leadingLine}
        rows={drive.rows}
        showConversionCaption={drive.showConversionCaption}
        stale={drive.stale}
        reconnectCaption={drive.reconnectCaption}
        hiringEmail={drive.hiringEmail}
        prompt={drive.prompt}
        announcement={drive.announcement}
      />

      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: { xs: 1.25, sm: 2 }, py: 1.5 }}>
        <Button onClick={handleClose} sx={{ textTransform: "none" }}>Close</Button>
        <Box sx={{ flex: 1 }} />
        <CombineDocumentsControl
          canCombine={canCombine}
          scopes={scopes}
          loadModel={loadModel}
          commitDraft={commitDraft}
          company={company}
          jobTitle={jobTitle}
          combineFormat={combineFormat}
          setCombineFormat={setCombineFormat}
          combining={combining}
          setCombining={setCombining}
          combineError={combineError}
          setCombineError={setCombineError}
          anyBusy={anyBusy}
        />
        {/* AC-K4: the save/download CONTROLS bind here, in DialogActions,
            beside Close/Combine/Download — this modal's per-scope
            `busy`/`notice`/`error` maps are never touched by anything Drive
            does; `drive` is a wholly separate prop object from a wholly
            separate hook, so a Drive write can never freeze the local
            controls those maps gate. */}
        <DriveActions
          status={drive.status}
          scopeCount={drive.scopeCount}
          connected={drive.connected}
          hasDriveReference={drive.hasDriveReference}
          isStale={drive.isStale}
          downloadStatus={drive.downloadStatus}
          onSave={handleSaveToDrive}
          onRefocusConsent={drive.onRefocusConsent}
          onDownload={drive.onDownload}
        />
        {tab === "email" ? (
          // AC-3/AC-5: the email is plain text, never a docx — its primary
          // action is copying it (AC-4), not "Download .docx", which would
          // otherwise silently run the wrong (résumé) build pipeline for it.
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {copyFeedback ? (
              <Box
                component="span"
                sx={{
                  fontSize: "0.8rem",
                  color: copyFeedback.startsWith("Couldn't") ? "var(--danger)" : "var(--success)",
                }}
              >
                {copyFeedback}
              </Box>
            ) : null}
            <Tooltip title="Copy the subject and body so you can paste them into your email client.">
              <span>
                <Button
                  onClick={copyEmail}
                  disabled={!available(tab)}
                  startIcon={<ContentCopyIcon />}
                  variant="contained"
                  sx={{ textTransform: "none" }}
                >
                  Copy email
                </Button>
              </span>
            </Tooltip>
          </Box>
        ) : (
          <Tooltip title={`Download the ${SCOPE_LABEL[tab].toLowerCase()} as .docx`}>
            <span>
              <Button
                onClick={handleDownload}
                disabled={!available(tab) || busyActive}
                startIcon={<DescriptionIcon />}
                variant="contained"
                sx={{ textTransform: "none" }}
              >
                Download .docx
              </Button>
            </span>
          </Tooltip>
        )}
      </DialogActions>
    </Dialog>
  );
}
