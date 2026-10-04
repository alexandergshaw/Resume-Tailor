// Deriving a Google Doc's name from the preview modal's file-name field and
// the posting, per AC-S9. Reuses the existing sanitiser/derivation from
// lib/document/docx.js rather than re-implementing name cleanup a second
// time -- see docx.js:39-71 for sanitizeFileNamePart / resolveDocumentFileName.

import {
  ensureHypotheticalMarker,
  resolveDocumentFileName,
  sanitizeFileNamePart,
} from "../document/docx.js";

const DOCX_SUFFIX = ".docx";

// driveDocName({ override, jobTitle, company, kind, isHypothetical }) -> string
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
//
// N105 (AC-3): isHypothetical (default false -- every other caller is
// unchanged) forces the HYPOTHETICAL prefix on BOTH branches. The override
// branch never reaches resolveDocumentFileName, so it is marked here directly;
// the no-override branch is marked by the resolver and again on the way out
// (idempotent). A leading token survives the ".docx" strip.
export function driveDocName({ override, jobTitle, company, kind, isHypothetical = false }) {
  const raw = typeof override === "string" ? override : "";
  if (raw.trim()) {
    return ensureHypotheticalMarker(sanitizeFileNamePart(raw).slice(0, 150), isHypothetical);
  }
  const withExtension = resolveDocumentFileName("", jobTitle, company, kind, isHypothetical);
  return ensureHypotheticalMarker(
    withExtension.endsWith(DOCX_SUFFIX)
      ? withExtension.slice(0, -DOCX_SUFFIX.length)
      : withExtension,
    isHypothetical,
  );
}
