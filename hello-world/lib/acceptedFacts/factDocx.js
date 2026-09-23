// Splices an accepted company fact into the engine's own in-session cover
// letter .docx (N35). Reuses docxModel's existing document-wide text-rewrite
// pass (`applyTextEdits`, already shipping behind the tailoring engine's own
// "recurring hand-edit" feature) instead of a new paragraph-splice
// primitive: each accepted fact is exactly a whole-paragraph
// { before, after } rewrite rule, which is precisely what that pass already
// applies.

import { loadDocx, applyTextEdits, serializeDocx } from "../llm/engines/tailor-lite/docxModel.js";

// @param {string} docxB64        the entry's engine cover-letter bytes
// @param {string[]} originalLines the entry's coverLetterResultLines the
//   plan (lib/acceptedFacts/factInsertion.js#planCoverFacts) was built
//   against -- used only to confirm each edit's `before` text still matches
//   the line it was planned from, so a stale plan is refused rather than
//   silently applied to the wrong paragraph.
// @param {{lineIndex:number, before:string, after:string}[]} edits
// @returns {Promise<{docxB64:string, applied:boolean, reason:string}>}
//   On anything but success the ORIGINAL `docxB64` is returned unchanged --
//   a caller that forgets to check `applied` still ends up with the
//   untouched bytes, never a corrupted or partially-applied document.
export async function applyCoverDocxEdits(docxB64, originalLines, edits) {
  if (typeof docxB64 !== "string" || docxB64.length === 0) {
    return { docxB64, applied: false, reason: "no-cover-bytes" };
  }
  const lines = Array.isArray(originalLines) ? originalLines : [];
  const list = Array.isArray(edits) ? edits : [];
  const rules = [];
  for (const edit of list) {
    if (!edit || typeof edit.before !== "string" || typeof edit.after !== "string" || edit.before.length === 0) {
      continue;
    }
    if (lines[edit.lineIndex] !== edit.before) {
      return { docxB64, applied: false, reason: "stale-plan" };
    }
    rules.push({ before: edit.before, after: edit.after });
  }
  if (rules.length === 0) {
    return { docxB64, applied: false, reason: "no-edits" };
  }
  try {
    const doc = await loadDocx(Buffer.from(docxB64, "base64"));
    const applied = applyTextEdits(doc, rules);
    if (applied.length !== rules.length) {
      return { docxB64, applied: false, reason: "not-found" };
    }
    return { docxB64: await serializeDocx(doc), applied: true, reason: "" };
  } catch {
    return { docxB64, applied: false, reason: "docx-error" };
  }
}
