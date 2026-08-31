// Deriving a Google Doc's name from the preview modal's file-name field and
// the posting, per AC-S9. Reuses the existing sanitiser/derivation from
// lib/document/docx.js rather than re-implementing name cleanup a second
// time -- see docx.js:39-71 for sanitizeFileNamePart / resolveDocumentFileName.

import {
  resolveDocumentFileName,
  sanitizeFileNamePart,
} from "../document/docx.js";

const DOCX_SUFFIX = ".docx";

// driveDocName({ override, jobTitle, company, kind }) -> string
//
// - When the modal's file-name field has a value (a non-blank override was
//   typed), the Doc name is that override, sanitized and capped at 150
//   characters -- the same cap resolveDocumentFileName applies to a local
//   download's override.
// - Otherwise it's the same "<Company> - <Position> - <kind>" derivation the
//   local download uses (resolveDocumentFileName("", jobTitle, company, kind)),
//   with the trailing ".docx" stripped -- a Drive Doc has no file extension.
//
// Either branch: never ends in ".docx", never contains \ / : * ? " < > |
// (sanitizeFileNamePart's job), and a blank job title falls back to
// "Target Role" (docx.js's buildDocumentFileName).
export function driveDocName({ override, jobTitle, company, kind }) {
  const raw = typeof override === "string" ? override : "";
  if (raw.trim()) {
    return sanitizeFileNamePart(raw).slice(0, 150);
  }
  const withExtension = resolveDocumentFileName("", jobTitle, company, kind);
  return withExtension.endsWith(DOCX_SUFFIX)
    ? withExtension.slice(0, -DOCX_SUFFIX.length)
    : withExtension;
}
