// N103 Step 2 - which document a review runs on, PURE (no React, no IO, no clock).
//
// Two callers, one resolver. The preview modal knows the (job, scope) it is
// showing; the Ask-AI chat knows only its pinned context. Both reach the document
// the same way: the entry in `tailoringMap` for a job id, read by scope. Nothing
// here decides what counts as a weakness or mints a span: it returns the lines
// and the facts the review needs, and runDocumentReview does the rest.
//
// WHY the chat resolves from structured state and never from the pinned text.
// ChatPanel holds no document, and the pinned context's text field is
// OVERWRITTEN by app/page.js's sync effect with a compound "job context + Tailored
// Resume:" string. Reviewing that would review job-context noise and name the
// result after the resume (AC-2's banned substitute). The pin therefore carries a
// `documentScope` ({ jobId, scope }) and, as a fallback for a pin made without
// one, the `sourceJobId` of the job it describes.
//
// A pin that DOES carry a documentScope is authoritative: if that scope has no
// text the answer is null, never "the resume instead", because the label the user
// sees names the scope they pinned.
//
//   => { kind, scope, title, resultLines, posting, realMaterial } | null
//
//   kind          "applicationReady" | "hypothetical" (authority is judged by it)
//   title         the pin's label, so a verdict is never separate from its subject
//   posting       { requirements: [{ id, text }] } from an Ideal run, else null.
//                 Withheld for a cover letter: keyword coverage is a resume
//                 concern, and flagging absent terms in prose coaches padding.
//   realMaterial  always null here (the uploaded resume is read asynchronously by
//                 the caller that holds the file); null is named in the notice.

import { DRAFT_KIND } from "./flagPresentation.js";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonBlank = (line) => typeof line === "string" && line.trim() !== "";

function linesOf(lines, text) {
  if (Array.isArray(lines) && lines.some(nonBlank)) return lines.map((line) => (typeof line === "string" ? line : ""));
  if (typeof text === "string" && text.trim() !== "") return text.split("\n");
  return [];
}

function documentIn(entry, scope) {
  if (scope === "resume") {
    return { kind: DRAFT_KIND.APPLICATION_READY, lines: linesOf(entry.resultLines, entry.result) };
  }
  if (scope === "cover") {
    return { kind: DRAFT_KIND.APPLICATION_READY, lines: linesOf(entry.coverLetterResultLines, null) };
  }
  if (scope === "hypothetical") {
    const draft = isObject(entry.ideal) ? entry.ideal.hypothetical : null;
    return { kind: DRAFT_KIND.HYPOTHETICAL, lines: linesOf(draft?.resultLines, draft?.result) };
  }
  return null;
}

function postingIn(entry, scope) {
  if (scope === "cover") return null;
  const requirements = isObject(entry.ideal) ? entry.ideal.postingAnalysis?.requirements : null;
  return Array.isArray(requirements) && requirements.length > 0 ? { requirements } : null;
}

/**
 * reviewDocumentFor(tailoringMap, jobId, scope, title)
 *
 * => the review request for one (job, scope), or null when that scope has no text
 * (an unknown job, an unknown scope, or a blank document).
 */
export function reviewDocumentFor(tailoringMap, jobId, scope, title) {
  if (!isObject(tailoringMap) || typeof jobId !== "string") return null;
  const entry = tailoringMap[jobId];
  if (!isObject(entry)) return null;
  const doc = documentIn(entry, scope);
  if (doc === null || !doc.lines.some(nonBlank)) return null;
  return {
    kind: doc.kind,
    scope,
    title: typeof title === "string" ? title : "",
    resultLines: doc.lines,
    posting: postingIn(entry, scope),
    realMaterial: null,
  };
}

/**
 * selectChatReviewDocument(pinnedContext, tailoringMap)
 *
 * => the chat's current document (see the header), or null when nothing is pinned
 * or the pin does not point at a tailored document.
 */
export function selectChatReviewDocument(pinnedContext, tailoringMap) {
  if (!isObject(pinnedContext)) return null;
  const title = typeof pinnedContext.label === "string" ? pinnedContext.label : "";
  const scoped = pinnedContext.documentScope;
  if (isObject(scoped)) return reviewDocumentFor(tailoringMap, scoped.jobId, scoped.scope, title);
  return reviewDocumentFor(tailoringMap, pinnedContext.sourceJobId, "resume", title);
}
