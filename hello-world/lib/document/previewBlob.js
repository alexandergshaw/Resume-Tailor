// Wave 1A — the byte-builder seam extracted out of app/hooks/useDocumentPreview.js.
// This is where every preview render (and, in a later wave, the Drive save
// path) turns a tailoring entry into its scope's final .docx blob, so both
// paths always produce identical bytes for identical inputs.
//
// previewBlobArgs is the PURE half: no DOM, no Blob, no JSZip, no Supabase —
// just the argument object for resolveDocumentBlob, node-testable. buildPreviewBlob
// is the IO half: browser-only, transitively, because resolveDocumentBlob
// reaches DOMParser/Blob/File and the Supabase browser client.
//
// KNOWN HAZARD (do not "fix" by changing this module — fix the OTHER test's
// mock instead): app/hooks/useManualTailor.test.js:22-24 mocks
// ../../lib/document/docx with a factory that provides ONLY
// buildTemplateLinesForUpload. This module imports resolveDocumentBlob from
// that same module, so any test that mocks lib/document/docx AND
// transitively loads this file gets `undefined` at CALL time, not at import
// time — a confusing runtime failure in whatever suite hits it, not a clean
// resolution error. useManualTailor.test.js does not load this module today.
//
// KNOWN, DELIBERATE DIVERGENCE — row 4 of AC-S6a's table (do not "fix" here):
// on a restored chip (docxB64 empty, only docxPath set) whose text has since
// been hand-edited, this module rebuilds onto the STORED engine document
// while the local download path (downloadDocumentPreview) rebuilds onto the
// user's generic UPLOADED template instead. In row 4 THIS module's output is
// the correct half; unifying the two paths would change the local
// download's shipped bytes and is a follow-up, not part of this extraction.

import { resolveDocumentBlob, normalizeResultLines } from "./docx";

// edited/*: the tailoring entry's hand-edit flag, per scope ({ resume, cover }) —
// so hand-editing one document never marks the other "edited", and
// regenerating one document never clears the other's edited flag (which
// would silently ship a stale pre-edit docx on its next download). An object
// is ALWAYS truthy, so every consumer must read through editedForScope —
// never `if (entry.edited)` / `!entry.edited`. Tolerates a missing field
// (treated as not edited) and a legacy plain boolean from before the
// per-scope migration — a legacy `true` reads as edited on BOTH scopes (the
// safe direction: it still forces a rebuild instead of risking a stale
// verbatim serve), a legacy `false`/undefined as neither.
export function editedForScope(entry, scope) {
  const e = entry?.edited;
  if (e && typeof e === "object") return !!e[scope];
  return !!e;
}

// Sets one scope's edited flag without mutating the entry's existing edited
// object, widening a legacy plain boolean to the per-scope shape first so
// the OTHER scope's flag survives the write.
export function withEditedScope(entry, scope, value) {
  const e = entry?.edited;
  const base = e && typeof e === "object" ? e : { resume: !!e, cover: !!e };
  return { ...base, [scope]: value };
}

// The text + line payload currently stored for a scope. Used both as the
// editor's seed and as the "was the supplied text actually changed" baseline
// below — NOT what previewBlobArgs' default (no `text` supplied) resume
// text uses; see the comment on `defaultText` below for why those differ.
export function scopeText(entry, scope) {
  if (scope === "cover") {
    const lines = Array.isArray(entry?.coverLetterResultLines) ? entry.coverLetterResultLines : [];
    return lines.join("\n");
  }
  return entry?.result || "";
}

// PURE. The exact argument object for resolveDocumentBlob, for one scope.
// AC-3/CRITICAL: returns null for "email" — the hiring email is plain text
// pasted into a mail client, never a docx-backed document.
//
// `text` is optional. Omitted -> defaults per scope below and
// `edited = editedForScope(entry, scope)`. Supplied -> `edited =
// editedForScope(entry, scope) || text !== scopeText(entry, scope)` — the
// same boolean the download path computes as `!serveFinished`.
//
// `lines` normally passes the stored scope array straight through
// (`resultLines`/`coverLetterResultLines`) — see previewBlob.test.js:87-97,
// pinned deliberately for the common "no divergent text" case. But when the
// caller supplies a `text` that actually differs from what's stored, that
// text IS the caller's draft — the Drive save path hands this over
// immediately after DocumentPreviewDialog's commitDraft(), before the
// setTailoringMap update inside it has flushed and re-rendered this hook's
// `entry` closure, so `entry.resultLines` is still the PRE-edit array at the
// moment this runs. docx.js's buildDocxFromUploadedTemplate prefers a
// non-empty `lines` over splitting `text` itself, so handing it the stale
// array would silently discard the fresh `text` and rebuild the old
// paragraphs. Re-deriving `lines` from the supplied `text` with
// normalizeResultLines mirrors exactly what commitDraft's own
// saveDocumentPreview will eventually store (`text.split("\n")`, here with
// normalizeResultLines' extra \r\n/trailing-whitespace handling) — so the
// synchronous rebuild and the eventual React state agree instead of racing.
export function previewBlobArgs(entry, scope, { resumeFile, coverLetterFile, text } = {}) {
  if (scope === "email") return null;
  const e = entry || {};
  const suppliedText = text !== undefined;

  if (scope === "cover") {
    const lines = Array.isArray(e.coverLetterResultLines) ? e.coverLetterResultLines : [];
    const stored = scopeText(e, "cover");
    const textChanged = suppliedText && text !== stored;
    return {
      engineDocxB64: typeof e.coverLetterDocxB64 === "string" ? e.coverLetterDocxB64 : "",
      // generated_cover_letters has no docx_path column (F-11) — the cover
      // branch never has a per-generation stored document to hand over.
      docxPath: "",
      edited: editedForScope(e, "cover") || textChanged,
      text: suppliedText ? text : stored,
      lines: textChanged ? normalizeResultLines(text) : lines,
      uploadedTemplate: coverLetterFile ?? null,
    };
  }

  const lines = Array.isArray(e.resultLines) ? e.resultLines : [];
  const stored = scopeText(e, "resume");
  // Today's (pre-extraction) behaviour is `entry.result || lines.join("\n")`,
  // NOT scopeText's `entry.result || ""`. Using scopeText's fallback here
  // would make an entry with an empty `result` but populated `resultLines`
  // default to "", flipping resolveDocumentBlob's `hasText` to false and
  // serving the engine doc verbatim instead of rebuilding the edited text
  // onto it — a real behaviour change. Preserve the original formula.
  const defaultText = e.result || lines.join("\n");
  const textChanged = suppliedText && text !== stored;
  return {
    engineDocxB64: typeof e.docxB64 === "string" ? e.docxB64 : "",
    docxPath: typeof e.docxPath === "string" ? e.docxPath : "",
    edited: editedForScope(e, "resume") || textChanged,
    text: suppliedText ? text : defaultText,
    lines: textChanged ? normalizeResultLines(text) : lines,
    uploadedTemplate: resumeFile ?? null,
  };
}

// IO. THE single entry point that turns a tailoring entry into its scope's
// final .docx blob, so the preview render and (in a later wave) the Drive
// save path always produce identical output for identical inputs.
export async function buildPreviewBlob(entry, scope, opts = {}) {
  const args = previewBlobArgs(entry, scope, opts);
  if (!args) return null;
  return resolveDocumentBlob(args);
}
