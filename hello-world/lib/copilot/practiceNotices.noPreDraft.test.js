// AC-R1.6. The practice-mode privacy notice must not outlive the transfer
// it describes. "Pre-draft predicted answer" is gone, so the automatic
// send it disclosed — a predicted question plus the prep context, to
// Gemini, before the user revealed anything — no longer happens, and a
// notice that kept claiming it would be a false statement about where the
// user's data goes.
//
// `oracle` below is an INDEPENDENT, frozen copy of the derivation as it
// stood before `preDraftEnabled` (BUG-J3) ever existed. It is written out
// literally here rather than imported, precisely so this stays a real
// characterization test: routing both sides through the same production
// code would make every assertion `f(x) === f(x)` — green forever and
// incapable of failing. See practiceNotices.test.js's own oracle for the
// same discipline; this file is the narrower, permanent statement that
// buildPrivacyNotice has returned to exactly that output for EVERY input.

import { describe, expect, test } from "vitest";
import { buildPrivacyNotice } from "./practiceNotices";

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
  const sampleAnswerClause = !hasPosting
    ? "Revealing a sample answer sends that question and your prep context to Gemini as well."
    : !docsSettled
      ? "Revealing a sample answer sends that question and your prep context to Gemini as well, and may also send any resume or cover letter you submitted for the selected posting."
      : hasSubmittedResume || hasSubmittedCoverLetter
        ? `Revealing a sample answer sends that question, your prep context, and the ${submittedDocsLabel} you submitted for the selected posting to Gemini as well.`
        : "Revealing a sample answer sends that question and your prep context to Gemini as well.";
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

function everyInput() {
  const out = [];
  for (const sttProviderName of STT_PROVIDER_NAMES) {
    for (const combo of allCombinations()) out.push({ ...combo, sttProviderName });
  }
  return out;
}

describe("the privacy notice no longer discloses a pre-draft that no longer happens", () => {
  test("matches the pre-feature notice byte-for-byte, across all 256 flag combinations", () => {
    for (const input of everyInput()) {
      expect(buildPrivacyNotice(input), JSON.stringify(input)).toBe(oracle(input));
    }
  });

  test("a stray preDraftEnabled: true from an un-updated caller changes nothing", () => {
    // The parameter is gone. A caller left behind — or a future one copying
    // an old call site — must not be able to reintroduce the sentence.
    for (const input of everyInput()) {
      expect(buildPrivacyNotice({ ...input, preDraftEnabled: true }), JSON.stringify(input)).toBe(
        oracle(input),
      );
    }
  });

  test("no input produces a notice mentioning a predicted question or pre-drafting", () => {
    for (const input of everyInput()) {
      const notice = buildPrivacyNotice(input);
      expect(notice, JSON.stringify(input)).not.toMatch(/predict/i);
      expect(notice, JSON.stringify(input)).not.toMatch(/pre-draft/i);
    }
  });

  test("buildPrivacyNotice takes exactly the eight inputs the notice is derived from", () => {
    // The three sweeps above are strong REGRESSION guards and weak gates on
    // this particular change: production already equalled the oracle
    // whenever `preDraftEnabled` was falsy, so two of them passed before the
    // removal too. This is the assertion that can only pass afterwards.
    //
    // Closed in BOTH directions on purpose. An earlier version only banned
    // the name `preDraftEnabled`, and a review reintroduced the entire
    // clause under `readyReplyEnabled` — "A ready-made reply for the
    // question we think is coming next is drafted ahead of time and sent to
    // Gemini with your prep context" — with all four notice tests green: the
    // combinatorial sweep never sets an input it does not know about, so the
    // clause was never emitted under test, and a sweep for output that is
    // never produced sees nothing. An exact parameter set fails on any new
    // flag whatever it is called.
    //
    // Matched with a regex rather than `indexOf("{")`/`indexOf("}")`
    // slicing, which a behaviour-preserving refactor broke: adding a
    // `if (!options) { return ""; }` guard made the slice run to the
    // GUARD's closing brace, failing the test with a confusing
    // positive-control miss rather than an honest message.
    const match = buildPrivacyNotice.toString().match(/function\s+buildPrivacyNotice\s*\(\s*\{([^}]*)\}/);
    expect(match, "signature is no longer a single destructured object parameter").not.toBeNull();
    const names = match[1]
      .split(",")
      .map((s) => s.split("=")[0].trim())
      .filter(Boolean);
    expect(names.sort()).toEqual(
      [
        "sttProviderName",
        "isEmbedded",
        "framesWillUpload",
        "hasPosting",
        "docsSettled",
        "hasSubmittedResume",
        "hasSubmittedCoverLetter",
        "saveEnabled",
      ].sort(),
    );
  });

  test("no unrecognized flag, under any name, can add a clause", () => {
    // The byte-identity sweep above is strong but only over inputs the
    // sweep knows how to build. A clause reintroduced behind a NEW flag is
    // simply never switched on there, so it stays invisible — which is
    // exactly how a review got the whole pre-draft disclosure back under
    // `readyReplyEnabled` with every notice test green. The parameter-set
    // assertion above is the real closure; this is the behavioural half of
    // it, turning on every plausible name at once and requiring the output
    // not to move.
    const speculativeFlags = {
      preDraftEnabled: true,
      readyReplyEnabled: true,
      lookaheadEnabled: true,
      predictionsEnabled: true,
      preDraftPredicted: true,
      speculativeDraftEnabled: true,
      upcomingAnswerEnabled: true,
    };
    for (const input of everyInput()) {
      expect(buildPrivacyNotice({ ...input, ...speculativeFlags }), JSON.stringify(input)).toBe(
        oracle(input),
      );
    }
  });

  test("[control] the oracle comparison is capable of failing", () => {
    // Two guards against a vacuous sweep. First: the oracle genuinely
    // discriminates between inputs, so `toBe(oracle(input))` is not
    // comparing one constant against itself.
    const embedded = oracle({ ...allCombinations()[0], isEmbedded: true, sttProviderName: "Deepgram" });
    const gemini = oracle({ ...allCombinations()[0], isEmbedded: false, sttProviderName: "Deepgram" });
    expect(embedded).not.toBe(gemini);

    // Second: appending anything at all to the real output breaks the
    // equality — which is precisely the shape a reintroduced clause would
    // take.
    const input = { ...allCombinations()[0], hasPosting: true, sttProviderName: "Deepgram" };
    expect(`${buildPrivacyNotice(input)} extra clause.`).not.toBe(oracle(input));
  });
});
