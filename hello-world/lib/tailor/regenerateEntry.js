// N104 - how a regenerate changes a job's tailoring entry, and how Undo puts it back.
// PURE: each function takes an entry and returns a new one.
//
//   reportFor(entry, result)               -> the report view for this run
//   applyRegenerated(entry, result, view)  -> the entry with the regenerated resume
//   attachReport(entry, view)              -> the entry with only the report added
//   snapshotForUndo(entry)                 -> what Undo needs to restore
//   restoreFromSnapshot(entry, snapshot)   -> the entry as it was before the run
//
//   result = { regenerated, closure, confirm, genuinelyUnqualified }  (runRegenerate)
//
// The regenerated resume is written the way a first Ideal run writes it: the text,
// its lines and the whole `ideal` block (the new pair, review and set-aside lists),
// with no bytes of its own so a download fills the user's template from the lines. The
// report rides inside the `ideal` block, so any later generation (which replaces that
// block) clears it and Undo (which restores the earlier block) brings back the
// earlier state of it. Nothing here is persisted: the entry's slim saved form keeps
// neither the block nor the report.
//
// When the regenerated text equals the text on screen nothing is replaced and only
// the report is attached, so there is nothing to undo.

import { classifyWeaknesses } from "../review/classifyWeaknesses.js";
import { regenerateReportView } from "../review/regenerateReportView.js";

const norm = (text) => String(text ?? "").replace(/\r\n?/g, "\n").trim();

// The edited flag is per scope (or a legacy plain boolean); only the resume's moves.
function withResumeEdited(edited, value) {
  const base = edited && typeof edited === "object" ? edited : { resume: Boolean(edited), cover: Boolean(edited) };
  return { ...base, resume: value };
}

export function reportFor(entry, result) {
  const next = result.regenerated.ideal;
  return regenerateReportView({
    closure: result.closure,
    setAside: { removed: next.counts?.removed, leftOut: next.counts?.leftOut },
    confirmCount: classifyWeaknesses(next.review).confirm.length,
    textUnchanged: norm(result.regenerated.result) === norm(entry?.result),
    hypotheticalRebuilt: norm(next.hypothetical?.result) !== norm(entry?.ideal?.hypothetical?.result),
  });
}

export function applyRegenerated(entry, result, view) {
  const { regenerated } = result;
  return {
    ...entry,
    result: String(regenerated.result ?? "").trim(),
    resultLines: Array.isArray(regenerated.resultLines) ? regenerated.resultLines : [],
    docxB64: typeof regenerated.docxB64 === "string" ? regenerated.docxB64 : "",
    // The saved hand-edit HTML would show over the new text.
    resumePreviewHtml: undefined,
    edited: withResumeEdited(entry?.edited, false),
    ideal: { ...regenerated.ideal, regenerateReport: view },
    status: "done",
  };
}

export function attachReport(entry, view) {
  return { ...entry, ideal: { ...entry.ideal, regenerateReport: view } };
}

export function snapshotForUndo(entry) {
  return {
    result: entry?.result,
    resultLines: entry?.resultLines,
    docxB64: entry?.docxB64,
    resumePreviewHtml: entry?.resumePreviewHtml,
    edited: entry?.edited,
    ideal: entry?.ideal,
  };
}

export function restoreFromSnapshot(entry, snapshot) {
  return { ...entry, ...snapshot };
}
