import { describe, expect, test } from "vitest";
import { buildPrivacyNotice } from "./practiceNotices";

// AC-J3: this extraction must be BYTE-IDENTICAL to the inline derivation
// that used to live in PracticeClient.js. `oracle` below is an independent,
// frozen copy of that original inline code — the permanent statement of
// what buildPrivacyNotice returns. Every case below is a genuine
// characterization test against this oracle: it fails if buildPrivacyNotice's
// output ever diverges from what the original inline logic would have
// produced for the same inputs.
function oracle({
  sttProviderName,
  isEmbedded,
  framesWillUpload,
  hasPosting,
  docsSettled,
  hasSubmittedResume,
  hasSubmittedCoverLetter,
  saveEnabled,
}) {
  const submittedDocsLabel =
    hasSubmittedResume && hasSubmittedCoverLetter
      ? "resume and cover letter"
      : hasSubmittedResume
        ? "resume"
        : "cover letter";
  const submittedDocsToGeminiClause = !hasPosting
    ? ""
    : !docsSettled
      ? " The critique may also send any resume or cover letter you submitted for the selected posting to Gemini."
      : hasSubmittedResume || hasSubmittedCoverLetter
        ? ` The critique also sends the ${submittedDocsLabel} you submitted for the selected posting to Gemini.`
        : "";
  // The knowledge-base sentence the answer route's payload made necessary:
  // every non-embedded draft also carries the user's project pages and the
  // file names and saved notes of their attachments. Unconditional, so it is
  // appended to every branch here exactly as production appends it.
  //
  // The wording below was DELIBERATELY updated in the same change as the
  // source, not accidentally drifted. It used to open "It also sends…", which
  // reads correctly after this file's four branches (each begins "Revealing a
  // sample answer sends…") and nowhere else: the same constant is appended by
  // lib/copilot/groundingNotice.js and practiceRoomQuestionPrivacy.js after
  // sentences about company research and about typing a question, where the
  // pronoun attributed the transfer to the wrong action — on the company-
  // research branch, falsely. One shared sentence cannot depend on what
  // precedes it, so it names its own subject.
  const knowledgeBaseClause =
    " Drafting an answer also sends your project pages, and the file names and any saved notes of the attachments on them — never the attached files themselves.";
  const sampleAnswerClause = (!hasPosting
    ? "Revealing a sample answer sends that question and your prep context to Gemini as well."
    : !docsSettled
      ? "Revealing a sample answer sends that question and your prep context to Gemini as well, and may also send any resume or cover letter you submitted for the selected posting."
      : hasSubmittedResume || hasSubmittedCoverLetter
        ? `Revealing a sample answer sends that question, your prep context, and the ${submittedDocsLabel} you submitted for the selected posting to Gemini as well.`
        : "Revealing a sample answer sends that question and your prep context to Gemini as well.") + knowledgeBaseClause;
  const engineNotice = isEmbedded
    ? "The critique runs on this server with no AI provider — your answer, the posting, and your prep context are never sent to Google. Sample answers are drafted on this server too."
    : framesWillUpload
      ? `Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback, along with up to three still frames from each answer.${submittedDocsToGeminiClause} ${sampleAnswerClause}`
      : `Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback.${submittedDocsToGeminiClause} ${sampleAnswerClause}`;
  const videoNotice = saveEnabled
    ? "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it."
    : "Your video clip stays in your browser and is dropped when the session ends.";
  const sttNotice = sttProviderName
    ? `Your audio is streamed to ${sttProviderName} for transcription.`
    : "Your audio is streamed for transcription.";
  return `${sttNotice} ${engineNotice} ${videoNotice}`;
}

const BOOL_FLAGS = [
  "isEmbedded",
  "framesWillUpload",
  "hasPosting",
  "docsSettled",
  "hasSubmittedResume",
  "hasSubmittedCoverLetter",
  "saveEnabled",
];
const STT_PROVIDER_NAMES = [null, "Deepgram"];

// Every combination of the seven booleans (2^7 = 128) times both
// sttProviderName values (256 cases total) — the full input space
// buildPrivacyNotice's callers can actually produce. A combination that
// wouldn't occur in practice (e.g. isEmbedded with framesWillUpload) is
// still exercised: buildPrivacyNotice doesn't (and shouldn't) enforce that
// invariant itself, so the extraction must reproduce the original's output
// for it regardless of whether a caller would ever construct it.
function allCombinations() {
  const combos = [];
  const n = BOOL_FLAGS.length;
  for (let mask = 0; mask < 1 << n; mask += 1) {
    const combo = {};
    BOOL_FLAGS.forEach((flag, i) => {
      combo[flag] = (mask & (1 << i)) !== 0;
    });
    combos.push(combo);
  }
  return combos;
}

describe("buildPrivacyNotice", () => {
  for (const sttProviderName of STT_PROVIDER_NAMES) {
    for (const combo of allCombinations()) {
      const oracleValue = oracle({ ...combo, sttProviderName });
      const flagsLabel = BOOL_FLAGS.map((f) => `${f}=${combo[f]}`).join(" ");

      test(`stt=${String(sttProviderName)} ${flagsLabel}`, () => {
        expect(buildPrivacyNotice({ ...combo, sttProviderName })).toBe(oracleValue);
      });
    }
  }

  // A handful of the cases above pinned individually and legibly, so a
  // reviewer doesn't have to decode the combinatorial sweep to see what the
  // notice actually reads like in the states that matter most.
  test("embedded engine, no posting", () => {
    expect(
      buildPrivacyNotice({
        sttProviderName: "Deepgram",
        isEmbedded: true,
        framesWillUpload: false,
        hasPosting: false,
        docsSettled: false,
        hasSubmittedResume: false,
        hasSubmittedCoverLetter: false,
        saveEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "The critique runs on this server with no AI provider — your answer, the posting, and your prep context are never sent to Google. Sample answers are drafted on this server too. " +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });

  test("gemini engine, frames on, posting with both documents settled, saving off, no stt provider known yet", () => {
    expect(
      buildPrivacyNotice({
        sttProviderName: null,
        isEmbedded: false,
        framesWillUpload: true,
        hasPosting: true,
        docsSettled: true,
        hasSubmittedResume: true,
        hasSubmittedCoverLetter: true,
        saveEnabled: false,
      }),
    ).toBe(
      "Your audio is streamed for transcription. " +
        "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback, along with up to three still frames from each answer. " +
        "The critique also sends the resume and cover letter you submitted for the selected posting to Gemini. " +
        "Revealing a sample answer sends that question, your prep context, and the resume and cover letter you submitted for the selected posting to Gemini as well. Drafting an answer also sends your project pages, and the file names and any saved notes of the attachments on them — never the attached files themselves. " +
        "Your video clip stays in your browser and is dropped when the session ends.",
    );
  });

  test("gemini engine, posting selected but documents still loading", () => {
    expect(
      buildPrivacyNotice({
        sttProviderName: "Deepgram",
        isEmbedded: false,
        framesWillUpload: false,
        hasPosting: true,
        docsSettled: false,
        hasSubmittedResume: false,
        hasSubmittedCoverLetter: false,
        saveEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. " +
        "The critique may also send any resume or cover letter you submitted for the selected posting to Gemini. " +
        "Revealing a sample answer sends that question and your prep context to Gemini as well, and may also send any resume or cover letter you submitted for the selected posting. Drafting an answer also sends your project pages, and the file names and any saved notes of the attachments on them — never the attached files themselves. " +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });

  test("gemini engine, posting settled with only a resume on file", () => {
    expect(
      buildPrivacyNotice({
        sttProviderName: "Deepgram",
        isEmbedded: false,
        framesWillUpload: false,
        hasPosting: true,
        docsSettled: true,
        hasSubmittedResume: true,
        hasSubmittedCoverLetter: false,
        saveEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. " +
        "The critique also sends the resume you submitted for the selected posting to Gemini. " +
        "Revealing a sample answer sends that question, your prep context, and the resume you submitted for the selected posting to Gemini as well. Drafting an answer also sends your project pages, and the file names and any saved notes of the attachments on them — never the attached files themselves. " +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });

  test("gemini engine, posting settled with neither document found", () => {
    expect(
      buildPrivacyNotice({
        sttProviderName: "Deepgram",
        isEmbedded: false,
        framesWillUpload: false,
        hasPosting: true,
        docsSettled: true,
        hasSubmittedResume: false,
        hasSubmittedCoverLetter: false,
        saveEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. " +
        "Revealing a sample answer sends that question and your prep context to Gemini as well. Drafting an answer also sends your project pages, and the file names and any saved notes of the attachments on them — never the attached files themselves. " +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });
});
