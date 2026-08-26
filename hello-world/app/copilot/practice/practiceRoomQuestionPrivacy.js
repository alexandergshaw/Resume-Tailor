// Final wave (AC-M2), moved out of PracticeClient.js by the AC-Q7 session-log
// feature purely to keep that file under this repo's line-count gate (AC-Q7.7)
// — this pair of functions is otherwise unrelated to session logging and is
// reused verbatim, byte-for-byte, from where it used to live inline. See each
// function's own comment below for why the room-question privacy clause was
// composed here rather than inside lib/copilot/practiceNotices.js — a
// constraint on which files that past feature was allowed to touch, not a
// standing rule. This file imports from that module now.

// Final wave (AC-M2): names the room-question detector's own document
// mention — same "only the document(s) actually found" discipline
// submittedDocsLabelFor (lib/copilot/practiceNotices.js) already applies to
// every other clause in this notice. Kept as its own tiny copy here rather
// than exported from that module for a historical reason only: at the time,
// practiceNotices.js was outside the allowed file set for the feature that
// wrote this. That was never an argument that the two must stay separate,
// and this file now imports from that module directly (below), so read the
// header above as a record of how the split happened rather than as a rule.
// The knowledge-base sentence is IMPORTED, not copied: a room question drafts
// through the identical draftAnswer call as a revealed sample answer, so the
// two notices are describing one payload — three, in fact, since live mode's
// lib/copilot/groundingNotice.js now imports the same constant too. See that
// constant's own comment in lib/copilot/practiceNotices.js for why it is
// unconditional on the Gemini path and absent on the embedded one.
import { COMPANY_FACTS_CLAUSE, KNOWLEDGE_BASE_CLAUSE } from "@/lib/copilot/practiceNotices";

function roomQuestionDocsWord(hasResume, hasCoverLetter) {
  if (hasResume && hasCoverLetter) return "resume and cover letter";
  if (hasResume) return "resume";
  return "cover letter";
}

// Final wave (AC-M2): drafting an answer for a room question is a NEW
// outbound request — buildPrivacyNotice (lib/copilot/practiceNotices.js)
// predates this feature and has no clause for it, and that module was not
// among that feature's allowed files at the time, so the sentence is composed
// here and appended to its output instead of silently leaving the notice this
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
// P1.6: `hasCompany` is this clause's newest input, and it is the same fact
// live mode already threads into `postingGroundingNotice` — whether the
// SELECTED posting has a company on file. Practice mode reaches the identical
// company-facts search: `useRoomQuestions.js` calls `draftAnswer` with an
// `applicationId` and no `mode`, and the route runs `buildCompanyFacts`
// whenever `mode !== "answer" && !wantsEmbedded(engine) && companyKnown`. So a
// detected room question and a typed one both send the company name and job
// title to Google Gemini with web search on, and both make this server fetch
// the pages that search returns. Neither `buildPrivacyNotice` nor this
// function said a word about that.
export function roomQuestionPrivacyClause({
  isEmbedded,
  hasPosting,
  docsSettled,
  hasSubmittedResume,
  hasSubmittedCoverLetter,
  hasCompany,
}) {
  if (isEmbedded) {
    return "If someone else in the room asks a question, it is detected and answered on this server too, with no AI provider involved. A question you type yourself skips detection and is drafted here the same way.";
  }
  const base =
    "If someone else in the room asks a question, what they say is sent to Gemini to detect and draft a response, along with your prep context";
  const typedClause =
    " A question you type yourself skips the detect step and is sent to Gemini to draft a response the same way.";
  // Every Gemini branch ends with the same knowledge-base sentence — the
  // payload does not depend on which documents were found. That sentence names
  // its own subject ("Drafting an answer also sends…"), which is what makes it
  // safe here: it lands after `typedClause`, whose subject is a question the
  // candidate typed, and it used to open "It also sends…" — reading, wrongly,
  // as though typing a question were the thing that sends the project pages.
  // They go on every drafted answer, typed or spoken.
  //
  // COMPANY_FACTS_CLAUSE joins it in the SAME shared tail, for the same
  // reason and with one extra one. Both sentences describe transfers that do
  // not depend on which documents were found, so composing them once and
  // appending that one tail to all four branches is what makes it impossible
  // for a document branch to decide whether either is stated — the R-259
  // positional failure expressed as branch placement (P1.5). It is the
  // IMPORTED constant, byte-for-byte the sentence live mode appends, because
  // a hand-copied second sentence is exactly how half a pair gets fixed.
  const tail = `${typedClause}${hasCompany ? ` ${COMPANY_FACTS_CLAUSE}` : ""}${KNOWLEDGE_BASE_CLAUSE}`;
  if (!hasPosting) return `${base}.${tail}`;
  if (!docsSettled) {
    return `${base}, and may also send any resume or cover letter you submitted for the selected posting.${tail}`;
  }
  if (hasSubmittedResume || hasSubmittedCoverLetter) {
    const label = roomQuestionDocsWord(hasSubmittedResume, hasSubmittedCoverLetter);
    return `${base}, and the ${label} you submitted for the selected posting.${tail}`;
  }
  return `${base}.${tail}`;
}
