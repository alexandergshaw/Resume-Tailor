"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import { downloadCombinedDocuments } from "@/lib/document/combineDocuments";
import { sanitizeFileNamePart } from "@/lib/document/docx";
import { DOCX_SCOPES } from "@/lib/tailor/documentScopes";

// "Combine both documents" control: output format + busy/error, shown when a
// résumé AND a cover letter both exist (`canCombine`, computed by the
// orchestrator). Engine-agnostic (works off the render models, not the
// engine's finished doc). Renders unconditionally so `combineError` — reset
// by the orchestrator when the dialog reopens — keeps behaving exactly as it
// did inline: visible whenever set, independent of `canCombine`.
export default function CombineDocumentsControl({
  canCombine,
  scopes,
  loadModel,
  commitDraft,
  company,
  jobTitle,
  combineFormat,
  setCombineFormat,
  combining,
  setCombining,
  combineError,
  setCombineError,
  anyBusy,
}) {
  const available = (scope) => !!scopes[scope]?.available;

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
      // AC-5: always resume + cover letter only — a third, plain-text scope
      // (the hiring email) must never silently join the combined docx/pdf.
      const models = await Promise.all(DOCX_SCOPES.filter(available).map((scope) => loadModel(scope)));
      const err = await downloadCombinedDocuments({ models, format: combineFormat, fileBase: combinedFileBase() });
      if (err) setCombineError(err);
    } catch (e) {
      setCombineError(e?.message || "Unable to build the combined document.");
    } finally {
      setCombining(false);
    }
  };

  return (
    <>
      {combineError ? (
        <Box sx={{ width: "100%", fontSize: "0.8rem", color: "var(--danger)", textAlign: "right" }}>{combineError}</Box>
      ) : null}
      {canCombine ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Select
            size="small"
            value={combineFormat}
            onChange={(e) => setCombineFormat(e.target.value)}
            // AC-6: combining reads BOTH documents, so — unlike the per-scope
            // controls above — it deliberately stays disabled while EITHER
            // scope is busy, not just the active one.
            disabled={combining || anyBusy}
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
                // Same deliberate choice as the format Select above (AC-6).
                disabled={combining || anyBusy}
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
    </>
  );
}
