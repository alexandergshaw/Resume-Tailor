// Pure prompt-building helpers for grounding an LLM prompt in the résumé and
// cover letter actually submitted for a tracked application. No React, no
// Supabase, no network — just string shaping, so it's reachable from vitest
// without mocking anything and reusable from any request handler that wants
// to ground a prompt in submitted documents (today: practice mode's "answer"
// mode in app/api/copilot/answer/route.js; going forward: live mode's
// "points" mode and the practice-mode critique route).
//
// The char caps and the prompt wording below are copied VERBATIM from
// app/api/copilot/answer/route.js's existing MAX_RESUME_CHARS /
// MAX_COVER_LETTER_CHARS constants and its buildAnswerPrompt — so a caller
// that adopts this module in place of hand-rolling the same lines produces
// byte-identical output to what that route already sends today.

export const MAX_RESUME_CHARS = 12000;
export const MAX_COVER_LETTER_CHARS = 6000;

// The exact header lines buildAnswerPrompt uses today, exported individually
// (in addition to submittedDocsPromptParts below, which uses them) so a
// caller that needs to reassemble a prompt with these sections interleaved
// among other content — e.g. to reproduce an existing prompt's exact line
// order — can do so without copying the literal strings a second time.
export const SUBMITTED_RESUME_HEADER = "--- SUBMITTED RESUME (for this application) ---";
export const SUBMITTED_COVER_LETTER_HEADER = "--- SUBMITTED COVER LETTER (for this application) ---";

// Same wording buildAnswerPrompt appends today when neither document was
// found. The "build the answer from..." tail is specific to answer-mode's
// framing; a caller grounding a different kind of prompt (e.g. live mode's
// talking points) in these documents decides for itself whether reusing this
// exact sentence still reads correctly there, or whether it should simply
// omit any "no documents" note at all to keep its own output byte-identical
// to what it produced before documents were added as a grounding source.
export const NO_SUBMITTED_DOCS_NOTE =
  "No submitted resume or cover letter was available for this application — build the answer from the candidate prep notes and conversation context alone.";

// Truncates each document to the cap the Gemini prompt already enforces
// today (MAX_RESUME_CHARS / MAX_COVER_LETTER_CHARS), the same slicing
// app/api/copilot/answer/route.js's POST handler does inline before handing
// `resume`/`coverLetter` to buildAnswerPrompt. Never throws: a missing or
// non-string field degrades to "" rather than erroring, the same way every
// other boundary in this feature degrades instead of failing loudly.
export function clampDocs({ resume, coverLetter } = {}) {
  return {
    resume: String(resume || "").slice(0, MAX_RESUME_CHARS),
    coverLetter: String(coverLetter || "").slice(0, MAX_COVER_LETTER_CHARS),
  };
}

// Whether each document was actually found, for a response's `grounding`
// field and for a UI caption that must state only what was ACTUALLY used
// (see practice/SampleAnswer.js's sourceCaption) — never a generic claim.
// Deliberately takes the docs as fetched, before clampDocs: a document that
// is merely long is still "found" for this purpose, and slicing a non-empty
// string down to MAX_*_CHARS can never turn it falsy anyway, so the two
// checks always agree — this just makes the intent explicit at call sites
// that already have the unclamped `docs` object on hand (mirrors
// app/api/copilot/answer/route.js's own `{ resume: !!docs.resume, coverLetter: !!docs.coverLetter }`).
export function groundingFlags({ resume, coverLetter } = {}) {
  return { resume: !!resume, coverLetter: !!coverLetter };
}

// The prompt lines for whatever was actually found, in the same order and
// with the same wording buildAnswerPrompt uses today: the submitted résumé
// section (if present), then the submitted cover letter section (if
// present), then — only when NEITHER was found — the "no submitted resume or
// cover letter" note (NO_SUBMITTED_DOCS_NOTE above), matching today's
// answer-mode behavior exactly. `resume`/`coverLetter` are expected to
// already be clamped (via clampDocs), the way buildAnswerPrompt's caller
// clamps them before building the prompt.
//
// A caller for whom the "no documents" note doesn't apply — e.g. live mode
// grounding its talking points, where no such note exists today and adding
// one would break the byte-identical requirement for the "no documents
// found" case — checks groundingFlags itself and simply doesn't call this
// function (or ignores its output) when neither flag is set, rather than
// this function trying to guess when the note belongs.
export function submittedDocsPromptParts({ resume, coverLetter } = {}) {
  const parts = [];
  if (resume) {
    parts.push("", SUBMITTED_RESUME_HEADER, resume);
  }
  if (coverLetter) {
    parts.push("", SUBMITTED_COVER_LETTER_HEADER, coverLetter);
  }
  if (!resume && !coverLetter) {
    parts.push("", NO_SUBMITTED_DOCS_NOTE);
  }
  return parts;
}
