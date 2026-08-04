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
