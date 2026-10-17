// Nullable/absent mode preserves historical optional-cover behavior.
export function normalizeDocumentMode(value) {
  if (value === null || value === undefined) return null;
  if (value === "resume_only" || value === "resume_cover") return value;
  throw new Error("Choose Resume only or Resume + cover letter.");
}

export function documentModeFields(body, { allowExplicitClear = false } = {}) {
  if (!Object.hasOwn(body, "tailoringDocumentMode") && !Object.hasOwn(body, "tailoring_document_mode")) return {};
  const mode = normalizeDocumentMode(Object.hasOwn(body, "tailoringDocumentMode") ? body.tailoringDocumentMode : body.tailoring_document_mode);
  // New/copy legacy drafts carry null locally, but must not address an absent DB column.
  // Only an explicit PATCH can request clearing a previously persisted selection.
  return mode === null && !allowExplicitClear ? {} : { tailoring_document_mode: mode };
}

export function documentModeWriteError(error, fields) {
  if (Object.hasOwn(fields, "tailoring_document_mode") && ["42703", "PGRST204"].includes(error?.code)) {
    return { error: "Document selection is not ready on this server. Your draft is retained; ask the administrator to apply the document-mode schema setup.", code: "DOCUMENT_MODE_SCHEMA_REQUIRED" };
  }
  return { error: "Unable to save this search. Please try again.", code: "SEARCH_SAVE_FAILED" };
}
