import { resolveDocumentFileName } from "../document/docx";

// The document scopes the tailoring preview UI supports, shared so a new
// scope means editing one file instead of the three (DocumentPreviewDialog,
// CombineDocumentsControl, ReviseStrip) that used to each keep their own
// copy of this list/label map.
export const SCOPES = ["resume", "cover", "email"];
export const SCOPE_LABEL = { resume: "Resume", cover: "Cover letter", email: "Hiring email" };

// Scopes backed by a real .docx template + engine-produced document. "email"
// is deliberately excluded: it is short plain text meant to be pasted into an
// email client, never rendered through the docx pipeline. Anything that
// builds or downloads a .docx (the combine-both control, for example) must
// iterate THIS list, not SCOPES, so a plain-text scope never gets pulled
// into a docx build.
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

// N83: the copyable title for the active docx document -- the SAME base the
// download and Drive save resolve. Reads the LIVE fileNameDraft (what the
// user is looking at), falling back to the committed override only when the
// draft is blank -- a pointer click on the title-copy control never blurs
// the field (CopyDocumentControl.js's onMouseDown preventDefault), so
// anchoring to the committed value copied a stale name. Re-resolved through
// resolveDocumentFileName (never copied raw) so a rename with characters the
// download sanitises away still matches what the employer receives.
// Extracted out of DocumentPreviewDialog.js so that file's own line ceiling
// has room, same reasoning as buildDownloadArgs above.
// N105 (AC-3): isHypothetical (default false -- every other caller is
// unchanged) forces the HYPOTHETICAL prefix, so the copied title matches the
// marked download name even when the user's rename dropped it.
export function resolveActiveDocumentTitle(fileNameDraft, committedFileName, jobTitle, company, kind, isHypothetical = false) {
  return resolveDocumentFileName(fileNameDraft.trim() || committedFileName, jobTitle, company, kind, isHypothetical).replace(/\.docx$/i, "");
}
