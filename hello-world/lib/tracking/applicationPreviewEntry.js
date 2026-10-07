// The tailoringMap entry for an application's STORED generated documents.
//
// Single source for the entry shape: app/page.js's rehydration effect (chips
// for tracked jobs) and its openApplicationPreview handler (the tracking row's
// View/Edit control) both build through here, so a row rehydrated by the
// effect and the same row opened on demand can never disagree. A field added
// to the entry belongs in this file, not re-inlined at a call site.
//
// Pure: no React, no I/O.

function storedResume(app) {
  const gen = app?.generated_resumes;
  const resumeText = typeof gen?.content === "string" ? gen.content : "";
  const resumeLines =
    Array.isArray(gen?.content_lines) && gen.content_lines.length > 0
      ? gen.content_lines
      : resumeText
        ? resumeText.split("\n")
        : [];
  return { gen, resumeText, resumeLines };
}

function storedCoverLines(app) {
  const cover = app?.generated_cover_letters;
  const coverLines =
    Array.isArray(cover?.content_lines) && cover.content_lines.length > 0
      ? cover.content_lines
      : typeof cover?.content === "string" && cover.content
        ? cover.content.split("\n")
        : [];
  return { cover, coverLines };
}

/**
 * Build the tailoringMap entry for an application's stored resume + cover
 * letter. Returns null when the app has neither stored resume text nor cover
 * lines.
 *
 * `existing` (the current map entry, if any) is spread UNDER the rebuilt
 * fields, so every rebuilt field overwrites it; only `generatedJobTitle`
 * prefers it, then the position title, then `fallbackTitle`. Precedence
 * between in-session and stored content is the CALLER's decision (the
 * rehydration effect and the open handler each skip an entry that already has
 * a result or is mid-generation), not this builder's.
 */
export function rehydratedEntryFromApp(app, { existing = null, fallbackTitle = "" } = {}) {
  const { gen, resumeText, resumeLines } = storedResume(app);
  const { cover, coverLines } = storedCoverLines(app);
  if (!resumeText && coverLines.length === 0) return null;
  return {
    ...(existing || {}),
    status: "done",
    downloaded: true,
    generatedJobTitle:
      existing?.generatedJobTitle || app.positions?.title || fallbackTitle || "",
    result: resumeText,
    resultLines: resumeLines,
    coverLetterResultLines: coverLines,
    // Preserve the faithful docx for the chip download's storage fallback.
    docxPath: typeof gen?.docx_path === "string" ? gen.docx_path : "",
    // N59: the cover letter's OWN stored docx path (never the resume's) --
    // lets a rehydrated preview/accept resolve the faithful engine document
    // instead of only its text.
    coverLetterDocxPath: typeof cover?.docx_path === "string" ? cover.docx_path : "",
    error: "",
  };
}

/**
 * True iff rehydratedEntryFromApp(app) would return an entry (stored resume
 * text OR cover lines). The show/hide predicate for the View/Edit control, so
 * the control is shown exactly when an entry can be built.
 */
export function hasPreviewableDocs(app) {
  return storedResume(app).resumeText.length > 0 || storedCoverLines(app).coverLines.length > 0;
}

// Does the tailoring entry have content for a given scope? Moved here verbatim
// from useDocumentPreview (still re-exposed by that hook), so the open path's
// precedence rule below and the hook's other callers share one definition.
export function previewScopeAvailable(entry, scope) {
  if (!entry) return false;
  if (scope === "cover") {
    return Array.isArray(entry.coverLetterResultLines) && entry.coverLetterResultLines.length > 0;
  }
  // AC-2: absent for the external engine (and any failed run) — both
  // fields are simply empty in that case, per the generation pipeline.
  if (scope === "email") {
    return Array.isArray(entry.emailResultLines) && entry.emailResultLines.length > 0;
  }
  return typeof entry.result === "string" && entry.result.trim().length > 0;
}

/**
 * N133: the tailoringMap entry openResumePreview reads, given the live map
 * `slot` for the job and the entry the caller just built (`optsEntry`).
 *
 * A slot with a resume OR cover document wins (the live map beats a stale
 * `optsEntry`). A truthy slot with neither -- a prior failed run's
 * `{ status: "error", error }` -- counts as ABSENT, because `||` alone only
 * falls through on a falsy slot; `optsEntry` then wins, else the slot itself,
 * else `{}`. One object then drives the tab, the research warm-up and the header.
 */
export function resolvePreviewEntry(slot, optsEntry) {
  const slotHasContent = previewScopeAvailable(slot, "resume") || previewScopeAvailable(slot, "cover");
  return (slotHasContent ? slot : optsEntry || slot) || {};
}
