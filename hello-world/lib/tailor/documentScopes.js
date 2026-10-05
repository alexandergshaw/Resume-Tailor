import { resolveDocumentFileName } from "../document/docx";

// The document scopes the tailoring preview UI supports, shared so a new
// scope means editing one file instead of the three (DocumentPreviewDialog,
// CombineDocumentsControl, ReviseStrip) that used to each keep their own
// copy of this list/label map.
// N105 (D-9): "hypothetical" is the Ideal run's second, best-case resume. It
// joins SCOPES (tab vocabulary) and SCOPE_LABEL ONLY -- never DOCX_SCOPES, so
// combine / set-default / Drive save refuse it structurally. LEGACY_SCOPES is
// the tab set every non-Ideal preview renders, unchanged (AC-17): the dialog
// renders a mount-supplied `visibleScopes` that defaults to it, never SCOPES,
// so no phantom "Hypothetical resume (none)" tab appears in a level 1-5 run.
export const LEGACY_SCOPES = ["resume", "cover", "email"];
export const SCOPES = [...LEGACY_SCOPES, "hypothetical"];
export const SCOPE_LABEL = {
  resume: "Resume",
  cover: "Cover letter",
  email: "Hiring email",
  hypothetical: "Hypothetical resume",
};

// The tab set the preview mount hands the dialog (N105 D-10): LEGACY_SCOPES
// for every entry, plus "hypothetical" LAST only when the entry carries an
// Ideal run's hypothetical result AND its application-ready résumé (the pair
// is atomic -- no application-ready, no hypothetical tab). Returns the shared
// LEGACY_SCOPES array itself in the ordinary case, so callers must not mutate.
export function visibleScopesFor(entry) {
  const hypotheticalText = entry?.ideal?.hypothetical?.result;
  const hasHypothetical = typeof hypotheticalText === "string" && hypotheticalText.trim().length > 0;
  const hasApplicationReady = typeof entry?.result === "string" && entry.result.trim().length > 0;
  return hasHypothetical && hasApplicationReady ? [...LEGACY_SCOPES, "hypothetical"] : LEGACY_SCOPES;
}

// Scopes backed by a real .docx template + engine-produced document. "email"
// is deliberately excluded: it is short plain text meant to be pasted into an
// email client, never rendered through the docx pipeline. Anything that
// builds or downloads a .docx (the combine-both control, for example) must
// iterate THIS list, not SCOPES, so a plain-text scope never gets pulled
// into a docx build. "hypothetical" is excluded for a different reason: it
// is a docx, but a markerless adoption of it (combine, set-default, Drive)
// would let a best-case document leave without its HYPOTHETICAL marker.
export const DOCX_SCOPES = ["resume", "cover"];

// The hiring email's displayed/copyable text: the subject clearly labeled,
// a blank line, then the body. Shared by the preview render model
// (useDocumentPreview's loadPreviewModel) and the dialog's copy-to-clipboard
// control so what's shown and what's copied are always the same text.
export function emailPreviewLines(entry) {
  const subject = typeof entry?.emailSubject === "string" ? entry.emailSubject.trim() : "";
  const body = Array.isArray(entry?.emailResultLines) ? entry.emailResultLines : [];
  return subject ? [`Subject: ${subject}`, "", ...body] : body.slice();
}
export function emailPreviewText(entry) {
  return emailPreviewLines(entry).join("\n");
}

// N83: derive downloadDocumentPreview's text/lines/fileNameOverride from its
// `payload` argument (a plain string, or an object carrying `text` and
// optionally the LIVE file-name draft under `fileName`). Extracted out of
// useDocumentPreview.js (that hook's own line ceiling has no room left) so
// the hook keeps one destructuring line instead of deriving all three
// inline. `fileNameOverride` is undefined when the caller didn't send one
// (a string payload, or an object with no fileName) -- buildDownloadArgs
// treats that as "keep today's behavior" and falls back to entry.*FileName.
export function resolveDownloadPayload(payload) {
  const text = typeof payload === "string" ? payload : payload?.text || "";
  return {
    text,
    lines: text.split("\n"),
    fileNameOverride: payload && typeof payload === "object" ? payload.fileName : undefined,
  };
}

// Build downloadDocxFiles' per-scope args: the common empty-value baseline
// plus that scope's own text/lines/fileName/rebuild-template pointers, and
// (when unedited-and-unchanged) the finished doc's bytes/path served
// verbatim. Extracted out of useDocumentPreview.js's downloadDocumentPreview
// (N69 S3) so that file's own line ceiling has room for the spacing hop --
// the shape itself is unchanged, just no longer duplicated inline.
// `spacing` (N69): the whole-document override, or null/undefined when the
// user hasn't set one -- downloadDocxFiles's own no-op control depends on
// this never inventing a value the caller didn't pass.
// `fileNameOverride` (N83): the LIVE file-name draft the preview dialog's
// download hop conveys, taking precedence over the committed
// entry.*FileName one render late -- undefined/null (the caller didn't pass
// one) keeps exactly today's behavior. Passed through RAW: downloadDocxFiles
// itself re-resolves resumeFileName/coverLetterFileName via
// resolveDocumentFileName (docx.js:749-750), so resolving it again here
// would double-resolve an already-sanitised name.
export function buildDownloadArgs({ scope, entry, text, lines, serveFinished, title, company, spacing, formattingTemplate, fileNameOverride }) {
  const args = {
    jobTitle: title,
    company,
    result: "",
    resultLines: [],
    coverLetterResultLines: [],
    docxB64: "",
    coverLetterDocxB64: "",
    spacing: spacing || null,
  };
  // N105 (D-9b / F-3): the hypothetical reads ONLY its own bytes slot. Left to
  // the else-branch below it would read entry.docxB64 -- the APPLICATION-READY
  // résumé's bytes -- and serve the wrong document under the HYPOTHETICAL
  // name. It rides the same résumé-shaped download args (one blob path,
  // resolveDocumentBlobBytes, never buildMinimalistDocx) with `isHypothetical`
  // so downloadDocxFiles layers the file-name marker. It maps to NO template
  // kind (D-9), so the default-template override is deliberately not applied,
  // and its file name never borrows the application-ready's rename.
  if (scope === "hypothetical") {
    const hypB64 = typeof entry.hypotheticalDocxB64 === "string" ? entry.hypotheticalDocxB64 : "";
    const hypPath = typeof entry.hypotheticalDocxPath === "string" ? entry.hypotheticalDocxPath : "";
    args.isHypothetical = true;
    args.result = text;
    args.resultLines = lines;
    args.resumeFileName = fileNameOverride != null ? fileNameOverride : (entry.hypotheticalFileName || "");
    args.templateDocxB64 = hypB64;
    args.templateDocxPath = hypPath;
    if (serveFinished && hypB64) args.docxB64 = hypB64;
    if (serveFinished && !hypB64 && hypPath) args.docxPath = hypPath;
    return args;
  }
  // N97: the caller resolves ONE scope's default template and hands it in
  // under this generic name; downloadDocxFiles wants it under the key that
  // matches which document it belongs to (résumé vs. cover -- plan C1).
  if (formattingTemplate) {
    if (scope === "cover") args.coverFormattingTemplate = formattingTemplate;
    else args.formattingTemplate = formattingTemplate;
  }
  if (scope === "cover") {
    args.coverLetterResultLines = lines;
    args.coverLetterFileName = fileNameOverride != null ? fileNameOverride : (entry.coverLetterFileName || "");
    args.coverLetterTemplateDocxB64 = typeof entry.coverLetterDocxB64 === "string" ? entry.coverLetterDocxB64 : "";
    if (serveFinished && typeof entry.coverLetterDocxB64 === "string") args.coverLetterDocxB64 = entry.coverLetterDocxB64;
  } else {
    args.result = text;
    args.resultLines = lines;
    args.resumeFileName = fileNameOverride != null ? fileNameOverride : (entry.resumeFileName || "");
    args.templateDocxB64 = typeof entry.docxB64 === "string" ? entry.docxB64 : "";
    // MAJOR-1 fix: unconditional, NOT gated on serveFinished. docxB64 is
    // also the rebuild TEMPLATE an edited download falls onto, and a
    // version switch (D-1) clears it while pointing docxPath at THIS
    // version's own stored docx — so an edited download after a switch
    // needs that pointer too, not just the verbatim-serve path below.
    // docx.js resolves docxPath || templateDocxPath as the rebuild source.
    args.templateDocxPath = typeof entry.docxPath === "string" ? entry.docxPath : "";
    if (serveFinished && typeof entry.docxB64 === "string") args.docxB64 = entry.docxB64;
    // Restored chips have no in-session docx blob but do carry the saved
    // storage path — serve that faithful copy when the text is unedited.
    if (serveFinished && !entry.docxB64 && typeof entry.docxPath === "string" && entry.docxPath) {
      args.docxPath = entry.docxPath;
    }
  }
  return args;
}

// N108: the ONE rule for which file-name value the preview acts on -- the LIVE
// field (trimmed), falling back to the committed override only when the field
// is blank or whitespace-only. Both egresses read it: the title copy
// (resolveActiveDocumentTitle below) and the download (the dialog's
// handleDownload, which conveys this as the payload's fileName). Before it
// existed the copy did `draft.trim() || committed` while the download conveyed
// the bare trimmed draft, so a blanked field over a committed custom name was
// copied as the committed name but downloaded under the DERIVED default -- two
// different file names for one click. The result is still RAW (unsanitised):
// resolveDocumentFileName re-resolves it on the way out of both egresses.
export function resolveLiveFileName(fileNameDraft, committedFileName) {
  return fileNameDraft.trim() || committedFileName || "";
}

// N83: the copyable title for the active docx document -- the SAME base the
// download and Drive save resolve. Reads the LIVE fileNameDraft (what the
// user is looking at), falling back to the committed override only when the
// draft is blank (resolveLiveFileName) -- a pointer click on the title-copy
// control never blurs the field (CopyDocumentControl.js's onMouseDown
// preventDefault), so anchoring to the committed value copied a stale name.
// Re-resolved through resolveDocumentFileName (never copied raw) so a rename
// with characters the download sanitises away still matches what the employer
// receives.
// Extracted out of DocumentPreviewDialog.js so that file's own line ceiling
// has room, same reasoning as buildDownloadArgs above.
// N105 (AC-3): isHypothetical (default false -- every other caller is
// unchanged) forces the HYPOTHETICAL prefix, so the copied title matches the
// marked download name even when the user's rename dropped it.
export function resolveActiveDocumentTitle(fileNameDraft, committedFileName, jobTitle, company, kind, isHypothetical = false) {
  return resolveDocumentFileName(resolveLiveFileName(fileNameDraft, committedFileName), jobTitle, company, kind, isHypothetical).replace(/\.docx$/i, "");
}
