// The single source of truth for every literal Google Drive/Docs MIME type,
// the fields mask every create/update request uses, and the OAuth scopes the
// Drive connection requests. Every other Drive module imports these instead
// of spelling the strings itself -- a wrong MIME type silently produces the
// wrong outcome (e.g. leaving a "Doc" that is really a plain .docx file, or
// re-parenting into the wrong kind of item), it never throws. See ARCH.md
// Wave 2A ("MAJ-8"): no file other than this one may contain the literal
// "application/vnd.google-apps." substring.

// The native Google Doc type. The conversion TARGET on create/update -- this
// is what makes the upload become an editable Doc instead of an opaque
// binary file sitting in Drive.
export const DOCS_MIME = "application/vnd.google-apps.document";

// The .docx type. The SOURCE type of the media part on every create/update,
// and the target format requested from files.export on download.
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// The Drive folder type, used to find-or-create the app's "Resume Tailor"
// folder.
export const FOLDER_MIME = "application/vnd.google-apps.folder";

// The `fields` mask sent on every files.create / files.update request so the
// response carries everything the save path needs to report back to the
// client and persist to drive_documents.
export const DRIVE_FIELDS = "id,name,mimeType,webViewLink,version,modifiedTime";

// The OAuth scopes requested for the Drive connection: drive.file (per-file
// access to items this app creates -- never full Drive access) plus
// userinfo.email for the connected-account display only. Order is not
// load-bearing but is kept stable so a diff against the emitted
// authorization URL is easy to read.
export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];
