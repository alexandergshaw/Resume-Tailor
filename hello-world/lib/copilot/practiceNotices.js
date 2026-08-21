// Pure derivation of practice mode's privacy notice — the single sentence
// stack rendered above the prep-context panel, stating exactly what leaves
// the browser and where, given the current STT provider, engine, frames
// switch, posting/documents state, and the save-recordings switch.
//
// AC-J3: extracted out of PracticeClient.js purely to keep that component
// under this repo's line-count gate. Every string below is byte-identical to
// what was inlined there before this file existed; nothing about that path
// changes wording, only where it lives — see practiceNotices.test.js's own
// frozen-oracle sweep, which pins this exact guarantee. No React import, no
// DOM access — every function is a straight function of its arguments, the
// same discipline lib/copilot/sampleAnswerState.js and
// useCopilotDashboard.js's own pure helpers already follow, and reachable
// from vitest with no component render.

// BUG-H5/AC-H6.25: names only the document(s) actually found for the
// selected application — never both when only one exists — the same
// discipline SubmittedDocs.js's statusSuffix and
// practice/SampleAnswer.js's sourceCaption already apply elsewhere.
function submittedDocsLabelFor(hasSubmittedResume, hasSubmittedCoverLetter) {
  if (hasSubmittedResume && hasSubmittedCoverLetter) return "resume and cover letter";
  if (hasSubmittedResume) return "resume";
  return "cover letter";
}

// AC-H5/AC-H6.23/BUG-H5: the critique route also fetches and sends the
// submitted resume/cover letter to Gemini, grounding the critique the same
// way revealing a sample answer already does — but ONLY when a posting is
// selected AND that application actually has a document to send. While the
// documents load is still unsettled (or has failed), whether one exists is
// genuinely unknown, so this hedges with "may" rather than asserting either
// way — staying silent here, while documents might be about to be sent,
// would be the worse failure. Once the load settles, this asserts plainly
// and names only the document(s) actually found, and falls silent when
// neither was found (never repeating BUG-H5's old blanket claim).
function submittedDocsToGeminiClauseFor({ hasPosting, docsSettled, hasSubmittedResume, hasSubmittedCoverLetter }) {
  if (!hasPosting) return "";
  if (!docsSettled) {
    return " The critique may also send any resume or cover letter you submitted for the selected posting to Gemini.";
  }
  if (hasSubmittedResume || hasSubmittedCoverLetter) {
    const label = submittedDocsLabelFor(hasSubmittedResume, hasSubmittedCoverLetter);
    return ` The critique also sends the ${label} you submitted for the selected posting to Gemini.`;
  }
  return "";
}

// G1: names the sample-answer draft's own destination — the same "is this
// request grounded by an AI provider" fact the critique clause above
// states, so this never drifts from it (AC-G1-9). Unlike that clause, this
// sentence is never empty — revealing a sample answer always sends the
// question and prep context to Gemini regardless of documents (see
// useSampleAnswer) — so only the document mention within it is
// conditional, following the same hedge/assert/omit split as
// submittedDocsToGeminiClauseFor above.
function sampleAnswerClauseFor({ hasPosting, docsSettled, hasSubmittedResume, hasSubmittedCoverLetter }) {
  if (!hasPosting) {
    return "Revealing a sample answer sends that question and your prep context to Gemini as well.";
  }
  if (!docsSettled) {
    return "Revealing a sample answer sends that question and your prep context to Gemini as well, and may also send any resume or cover letter you submitted for the selected posting.";
  }
  if (hasSubmittedResume || hasSubmittedCoverLetter) {
    const label = submittedDocsLabelFor(hasSubmittedResume, hasSubmittedCoverLetter);
    return `Revealing a sample answer sends that question, your prep context, and the ${label} you submitted for the selected posting to Gemini as well.`;
  }
  return "Revealing a sample answer sends that question and your prep context to Gemini as well.";
}

// Derived from state, not hard-coded, and names every destination that
// actually receives data on the CURRENT engine/switch combination — never a
// static claim. On the Gemini engine, every critique request sends the
// answer transcript, the posting details, and the prep-context profile to
// Google, regardless of the frames switch; that switch only ever controls
// whether still frames are ALSO sent (AC-C4-5).
function engineNoticeFor({
  isEmbedded,
  framesWillUpload,
  submittedDocsToGeminiClause,
  sampleAnswerClause,
}) {
  if (isEmbedded) {
    return "The critique runs on this server with no AI provider — your answer, the posting, and your prep context are never sent to Google. Sample answers are drafted on this server too.";
  }
  if (framesWillUpload) {
    return `Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback, along with up to three still frames from each answer.${submittedDocsToGeminiClause} ${sampleAnswerClause}`;
  }
  return `Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback.${submittedDocsToGeminiClause} ${sampleAnswerClause}`;
}

// D1 made the old blanket "your video stays in your browser and is never
// uploaded" claim false: the save switch controls a SEPARATE destination
// (this user's own private Supabase storage) for the full recorded clip,
// independent of both the engine and the frames opt-in — saving happens (or
// doesn't) the same way on every engine.
export function videoNoticeFor(saveEnabled) {
  return saveEnabled
    ? "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it."
    : "Your video clip stays in your browser and is dropped when the session ends.";
}

// F2: names the STT provider once known, never guesses one before then —
// `sttProviderName` is `undefined`/`null` until CopilotClient's mount-time
// probe resolves it.
export function sttNoticeFor(sttProviderName) {
  return sttProviderName
    ? `Your audio is streamed to ${sttProviderName} for transcription.`
    : "Your audio is streamed for transcription.";
}

// The full sentence stack, in the same order PracticeClient rendered it
// inline before this extraction: the STT destination, then the engine/AI
// provider destination (with the critique and sample-answer clauses folded
// in), then where the recorded video goes. `videoNotice` and `engineNotice`
// are deliberately built from independent inputs and never reference each
// other's wording, so neither switch's sentence can be read as implying
// anything about the other (AC-D1-4).
export function buildPrivacyNotice({
  sttProviderName,
  isEmbedded,
  framesWillUpload,
  hasPosting,
  docsSettled,
  hasSubmittedResume,
  hasSubmittedCoverLetter,
  saveEnabled,
}) {
  const submittedDocsToGeminiClause = submittedDocsToGeminiClauseFor({
    hasPosting,
    docsSettled,
    hasSubmittedResume,
    hasSubmittedCoverLetter,
  });
  const sampleAnswerClause = sampleAnswerClauseFor({
    hasPosting,
    docsSettled,
    hasSubmittedResume,
    hasSubmittedCoverLetter,
  });
  const engineNotice = engineNoticeFor({
    isEmbedded,
    framesWillUpload,
    submittedDocsToGeminiClause,
    sampleAnswerClause,
  });
  const videoNotice = videoNoticeFor(saveEnabled);
  const sttNotice = sttNoticeFor(sttProviderName);
  return `${sttNotice} ${engineNotice} ${videoNotice}`;
}
