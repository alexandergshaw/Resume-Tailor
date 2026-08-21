// Final wave (AC-M2), moved out of PracticeClient.js by the AC-Q7 session-log
// feature purely to keep that file under this repo's line-count gate (AC-Q7.7)
// — this pair of functions is otherwise unrelated to session logging and is
// reused verbatim, byte-for-byte, from where it used to live inline. See each
// function's own comment below (also unchanged) for why the room-question
// privacy clause is composed here rather than inside
// lib/copilot/practiceNotices.js, which predates this feature and is not
// among this feature's allowed files either.

// Final wave (AC-M2): names the room-question detector's own document
// mention — same "only the document(s) actually found" discipline
// submittedDocsLabelFor (lib/copilot/practiceNotices.js) already applies to
// every other clause in this notice. Kept as its own tiny copy here rather
// than exported from that module: practiceNotices.js is not one of this
// feature's allowed files (see the module doc on roomQuestionPrivacyClause
// below for why the whole clause lives here instead of there).
function roomQuestionDocsWord(hasResume, hasCoverLetter) {
  if (hasResume && hasCoverLetter) return "resume and cover letter";
  if (hasResume) return "resume";
  return "cover letter";
}

// Final wave (AC-M2): drafting an answer for a room question is a NEW
// outbound request — buildPrivacyNotice (lib/copilot/practiceNotices.js)
// predates this feature and has no clause for it, and that module is not
// among this feature's allowed files, so the sentence is composed here and
// appended to its output instead of silently leaving the notice this
// component renders incomplete about a transfer it now performs
// automatically (this codebase has shipped that exact class of bug before —
// BUG-H5). Unconditional, not gated on whether anyone has actually spoken
// yet this session: detection runs the moment a session starts, not behind a
// switch the candidate opts into, so it has to be disclosed before it can
// happen, not after. Follows the exact same hedge (docs not yet settled) /
// assert (docs found) / omit (no posting, or none found) discipline as
// practiceNotices.js's own submittedDocsToGeminiClauseFor.
//
// AC-O5: a typed question runs through the exact same draftAnswer call as a
// room question (useRoomQuestions.js's addManualQuestion feeds addQuestion
// exactly like evaluateUtterance does) — but "what they SAY" doesn't cover
// text the candidate types, and this codebase has already shipped a bug of
// exactly this shape (a new feature silently falsifying an existing
// disclosure — BUG-H5 again). The one sentence appended below says only what
// hasn't already been said: typing goes through the same path, MINUS the
// detect step (addManualQuestion never calls confirmQuestion, unlike a room
// question), so it must not claim "detected" the way the sentence above it
// does. It says nothing about documents — whatever the branches above
// already decided about those applies unchanged, since it's the same
// draftAnswer call either way, and repeating that decision here would be
// exactly the restatement this discipline exists to avoid.
export function roomQuestionPrivacyClause({
  isEmbedded,
  hasPosting,
  docsSettled,
  hasSubmittedResume,
  hasSubmittedCoverLetter,
}) {
  if (isEmbedded) {
    return "If someone else in the room asks a question, it is detected and answered on this server too, with no AI provider involved. A question you type yourself skips detection and is drafted here the same way.";
  }
  const base =
    "If someone else in the room asks a question, what they say is sent to Gemini to detect and draft a response, along with your prep context";
  const typedClause =
    " A question you type yourself skips the detect step and is sent to Gemini to draft a response the same way.";
  if (!hasPosting) return `${base}.${typedClause}`;
  if (!docsSettled) {
    return `${base}, and may also send any resume or cover letter you submitted for the selected posting.${typedClause}`;
  }
  if (hasSubmittedResume || hasSubmittedCoverLetter) {
    const label = roomQuestionDocsWord(hasSubmittedResume, hasSubmittedCoverLetter);
    return `${base}, and the ${label} you submitted for the selected posting.${typedClause}`;
  }
  return `${base}.${typedClause}`;
}
