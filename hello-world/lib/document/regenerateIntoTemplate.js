// N151c -- regenerate the open preview's document into a DIFFERENT formatting
// template and append the result to the version history. A formatting-only
// re-render: the entry's CURRENT text is poured into the chosen template's
// styling (the same override docx.js's resolveDocumentBlob applies for the
// default template) and NO model is called. The result is a new, newest
// version; every earlier version is left exactly as it was and stays
// re-selectable.
//
// The orchestration lives here, with its collaborators INJECTED, so
// app/hooks/useDocumentPreview.js (line-capped) only binds its own deps in a
// thin wrapper and this module stays testable without React.

import { buildPreviewBlob, withEditedScope } from "./previewBlob";
import { bytesToBase64 } from "./docxBytes.js";

// The entry's current document built into `templateFile`, as base64; "" when
// there is nothing to build. buildPreviewBlob is the one byte path every
// preview render and download funnels through -- passing `formattingTemplate`
// is what makes the chosen template, not the engine's own doc, the structural
// base (the override takes precedence over every other resolveDocumentBlob
// branch). Not exported: nothing outside this module renders on its own.
async function renderContentIntoTemplate({ scope, entry, templateFile }) {
  try {
    const blob = await buildPreviewBlob(entry, scope, { formattingTemplate: templateFile });
    return blob ? bytesToBase64(new Uint8Array(await blob.arrayBuffer())) : "";
  } catch {
    return "";
  }
}

// What the open job's entry shows once the new document is built: the fresh
// bytes, with this scope's stale path / cached preview html cleared and ONLY
// this scope's edited flag reset (the other document's hand-edit survives).
// Mirrors what resubmitDocumentPreview writes after a revise, minus the engine
// fields -- no engine ran here.
function regenDisplayPatch(scope, entry, docxB64) {
  const status = entry.status || "done";
  if (scope === "cover") {
    return {
      coverLetterDocxB64: docxB64,
      coverLetterDocxPath: "",
      coverLetterPreviewHtml: undefined,
      edited: withEditedScope(entry, "cover", false),
      status,
    };
  }
  return {
    docxB64,
    docxPath: "",
    resumePreviewHtml: undefined,
    edited: withEditedScope(entry, "resume", false),
    status,
  };
}

// The document persistGeneratedDocuments appends. A resume's content is
// `result || lines.join("\n")` -- NOT previewBlob's scopeText, which is ""
// for an entry holding lines but no `result`; persist skips an empty-content
// insert, so that would append nothing and say nothing.
function regenPersistPayload(scope, entry, docxB64) {
  if (scope === "cover") {
    const lines = Array.isArray(entry.coverLetterResultLines) ? entry.coverLetterResultLines : [];
    return { content: lines.join("\n"), contentLines: lines, docxB64 };
  }
  const lines = Array.isArray(entry.resultLines) ? entry.resultLines : [];
  return { content: entry.result || lines.join("\n"), contentLines: lines, docxB64 };
}

/**
 * Builds `entry`'s `scope` document into `templateFile`'s formatting, shows it
 * on the job, and appends it as a new version.
 *
 * Refuses (resolving { error }, writing nothing) without a signed-in user and a
 * resolved position: persist would no-op, so the document would be
 * reformatted on screen but never become a version.
 *
 * @returns {Promise<{ ok: true } | { error: string }>}
 */
export async function regenerateActiveIntoTemplate({
  scope,
  entry,
  templateFile,
  jobId,
  positionId,
  userId,
  supabase,
  updateTailoringJob,
  setPreviewReloadKey,
  persistGeneratedDocuments,
  refreshDocumentVersions,
  versionsRequestId,
  sourceResumePath,
}) {
  if (!userId || !positionId) {
    return { error: "Sign in and open a saved document to switch its template." };
  }
  if (!templateFile) return { error: "Choose a .docx template first." };
  const current = entry || {};
  if (!regenPersistPayload(scope, current, "").content) {
    return { error: "There is no text in this document to put into a template." };
  }
  const docxB64 = await renderContentIntoTemplate({ scope, entry: current, templateFile });
  if (!docxB64) return { error: "Couldn't build the document in that template. Try another .docx." };

  updateTailoringJob(jobId, (latest) => ({ ...latest, ...regenDisplayPatch(scope, latest, docxB64) }));
  setPreviewReloadKey((k) => k + 1);

  const payload = regenPersistPayload(scope, current, docxB64);
  const saved = await persistGeneratedDocuments(supabase, {
    userId,
    positionId,
    [scope === "cover" ? "coverLetter" : "resume"]: payload,
    sourceResumePath,
  });
  if (saved && !saved.resumeId && !saved.coverLetterId) {
    return { error: "Couldn't save the new version. The document above is updated, but it isn't in your history." };
  }
  await refreshDocumentVersions(jobId, [scope], versionsRequestId, positionId);
  return { ok: true };
}
