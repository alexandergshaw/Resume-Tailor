// Line-level highlighting between two document versions. Pure and
// dependency-light (only alignLines.js's LCS aligner) — no React, no side
// effects. Given the previous version's lines and the current version's
// lines, classify which CURRENT lines are new or edited, then paint that
// classification onto a render model (see docxPreview.js's
// parseDocxToModel/linesToModel for the model shape and renderModelToHtml
// for how the `mark` flag this sets gets styled).
//
// Scope for this pass is LINE-LEVEL only: a whole paragraph is flagged
// added/modified or left alone. Word-level / sub-run diffing is a separate
// piece of work (it needs run splitting).

import { alignLinesToSlots } from "./alignLines";

function normalize(line) {
  return String(line ?? "").trim();
}

// Classify each CURRENT line against the previous version's lines:
//   "added"    - no counterpart in the previous version
//   "modified" - paired with a previous line whose (trimmed) text differs
// Unchanged lines — including ones that differ only in whitespace, matching
// alignLinesToSlots' own .trim() normalization — are left out of the map
// entirely.
//
// Implementation note: alignLinesToSlots(previousLines, currentLines) pairs
// slots (previous lines) with lines (current lines) via LCS and returns
// ordered ops, but a "fill"/"insert" op's `text` is copied straight from
// `currentLines`, and blank current lines never produce a "fill"-with-text
// or "insert" (a blank paired line becomes a bare "remove", and a blank
// extra line is dropped silently) — so the ops carrying non-blank text
// appear in exactly the same left-to-right order as the non-blank entries
// of currentLines. Zipping the two positionally recovers which current
// index each op came from without alignLinesToSlots needing to know
// anything about indices itself.
//
// Returns Map<currentLineIndex, "added"|"modified">.
//
// A "first version" — no previous lines with any real content — returns an
// empty map rather than marking every current line: that "everything is
// new" view is useless, so nothing is flagged instead. An empty
// currentLines likewise returns an empty map (nothing to classify).
export function classifyLineChanges(previousLines, currentLines) {
  const previous = Array.isArray(previousLines) ? previousLines : [];
  const current = Array.isArray(currentLines) ? currentLines : [];
  const changes = new Map();
  if (current.length === 0) return changes;
  if (!previous.some((line) => normalize(line).length > 0)) return changes;

  const ops = alignLinesToSlots(previous, current);

  const nonBlankIndices = [];
  current.forEach((line, i) => {
    if (normalize(line).length > 0) nonBlankIndices.push(i);
  });

  const contentOps = ops.filter(
    (op) => (op.type === "fill" || op.type === "insert") && normalize(op.text).length > 0,
  );

  contentOps.forEach((op, k) => {
    const index = nonBlankIndices[k];
    if (index == null) return; // defensive - counts always match by construction
    if (op.type === "insert") {
      changes.set(index, "added");
      return;
    }
    const prevText = previous[op.slot];
    if (normalize(op.text) !== normalize(prevText)) changes.set(index, "modified");
  });

  return changes;
}

// Build a NEW render model with `mark: true` set on every run of a paragraph
// whose index is present in `changes` (as returned by classifyLineChanges).
// Never mutates `model` or its paragraphs/runs: paragraphs that are not
// flagged are passed through by reference (cheap when few paragraphs
// changed); flagged paragraphs get a new paragraph object with new run
// objects.
export function markChangedParagraphs(model, changes) {
  const paragraphs = Array.isArray(model?.paragraphs) ? model.paragraphs : [];
  if (!changes || changes.size === 0) return { ...model, paragraphs };
  return {
    ...model,
    paragraphs: paragraphs.map((p, i) => {
      if (!changes.has(i) || !Array.isArray(p.runs) || p.runs.length === 0) return p;
      return { ...p, runs: p.runs.map((r) => ({ ...r, mark: true })) };
    }),
  };
}

// Convenience wrapper for callers that just want an annotated model in one
// call (classify, then mark) — e.g. useDocumentPreview.js's
// loadPreviewModel, which derives currentLines from the model it just
// parsed. Never mutates `model`.
export function markVersionChanges(model, previousLines, currentLines) {
  const changes = classifyLineChanges(previousLines, currentLines);
  return markChangedParagraphs(model, changes);
}
