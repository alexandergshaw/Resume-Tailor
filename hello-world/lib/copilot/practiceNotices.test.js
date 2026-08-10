import { describe, expect, test } from "vitest";
import { buildPrivacyNotice } from "./practiceNotices";
import { preDraftDisclosureApplies } from "./predictionPrefs";

// AC-J3: this extraction must be BYTE-IDENTICAL to the inline derivation
// that used to live in PracticeClient.js. `oracle` below is an independent
// copy of that ORIGINAL inline code, frozen exactly as it was before
// `preDraftEnabled` (BUG-J3) existed — it deliberately takes no
// `preDraftEnabled` parameter and never will, because it represents "what
// the old code produced", which by definition never disclosed a switch it
// didn't have. Every case below that passes `preDraftEnabled: false` is a
// genuine characterization test against this oracle: it fails if
// buildPrivacyNotice's output for that (compatibility) path ever diverges
// from what the ORIGINAL inline logic would have produced for the same
// inputs.
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
  // BUG-J3: `preDraftEnabled` is an EIGHTH flag, swept the same way as the
  // seven booleans above (256 base combos x 2 preDraftEnabled values = 512
  // cases), but asserted differently depending on its value rather than
  // folded into `oracle` — see that function's own doc for why it must
  // never learn about this input.
  for (const sttProviderName of STT_PROVIDER_NAMES) {
    for (const combo of allCombinations()) {
      const oracleValue = oracle({ ...combo, sttProviderName });
      const flagsLabel = BOOL_FLAGS.map((f) => `${f}=${combo[f]}`).join(" ");

      // The compatibility guarantee this whole sweep exists to protect:
      // with the switch off, output must stay byte-identical to the frozen
      // oracle for every one of the 256 base combinations. This must never
      // weaken, regardless of what preDraftEnabled: true does below.
      test(`stt=${String(sttProviderName)} ${flagsLabel} preDraft=false`, () => {
        expect(buildPrivacyNotice({ ...combo, sttProviderName, preDraftEnabled: false })).toBe(oracleValue);
      });

      test(`stt=${String(sttProviderName)} ${flagsLabel} preDraft=true`, () => {
        const actual = buildPrivacyNotice({ ...combo, sttProviderName, preDraftEnabled: true });
        if (combo.isEmbedded) {
          // BUG-J2: the embedded engine's own sentence already covers
          // pre-drafting correctly ("Sample answers are drafted on this
          // server too") — turning the switch on must add NOTHING here,
          // so this must match the (pre-draft-unaware) oracle exactly, the
          // same value the preDraft=false case above also matches.
          expect(actual).toBe(oracleValue);
        } else {
          // BUG-J3: a non-embedded engine must actually disclose the
          // pre-draft's automatic Gemini send — output must differ from
          // the oracle (which has no knowledge of this transfer at all)
          // and must contain the disclosure.
          expect(actual).not.toBe(oracleValue);
          expect(actual).toContain('"Pre-draft predicted answer" is on');
        }
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

  // BUG-J2 regression pin: turning pre-draft ON while embedded must not
  // change a single character of the string above — the embedded engine's
  // own sentence already covers it, and no second "separate from
  // pre-drafting" clause is ever added anywhere in this string.
  test("embedded engine, no posting, pre-draft on — unchanged from pre-draft off", () => {
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
        preDraftEnabled: true,
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
        "Revealing a sample answer sends that question, your prep context, and the resume and cover letter you submitted for the selected posting to Gemini as well. " +
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
        "Revealing a sample answer sends that question and your prep context to Gemini as well, and may also send any resume or cover letter you submitted for the selected posting. " +
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
        "Revealing a sample answer sends that question, your prep context, and the resume you submitted for the selected posting to Gemini as well. " +
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
        "Revealing a sample answer sends that question and your prep context to Gemini as well. " +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });

  // BUG-J3 pinned cases: the new disclosure clause, through its own
  // hedge/assert/omit progression as the documents state settles — mirrors
  // the pinned cases above for submittedDocsToGeminiClause/sampleAnswerClause,
  // but for the pre-draft's own automatic send.
  test("pre-draft on, gemini engine, no posting", () => {
    expect(
      buildPrivacyNotice({
        sttProviderName: "Deepgram",
        isEmbedded: false,
        framesWillUpload: false,
        hasPosting: false,
        docsSettled: false,
        hasSubmittedResume: false,
        hasSubmittedCoverLetter: false,
        saveEnabled: true,
        preDraftEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. " +
        "Revealing a sample answer sends that question and your prep context to Gemini as well. " +
        'While "Pre-draft predicted answer" is on, a predicted question and your prep context are sent to Gemini automatically, before you reveal anything. ' +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });

  test("pre-draft on, gemini engine, posting selected but documents still loading — hedges with may", () => {
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
        preDraftEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. " +
        "The critique may also send any resume or cover letter you submitted for the selected posting to Gemini. " +
        "Revealing a sample answer sends that question and your prep context to Gemini as well, and may also send any resume or cover letter you submitted for the selected posting. " +
        'While "Pre-draft predicted answer" is on, a predicted question and your prep context are sent to Gemini automatically, before you reveal anything, and any resume or cover letter you submitted for the selected posting may be sent too. ' +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });

  test("pre-draft on, gemini engine, posting settled with only a resume on file — names the resume", () => {
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
        preDraftEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. " +
        "The critique also sends the resume you submitted for the selected posting to Gemini. " +
        "Revealing a sample answer sends that question, your prep context, and the resume you submitted for the selected posting to Gemini as well. " +
        'While "Pre-draft predicted answer" is on, a predicted question and your prep context are sent to Gemini automatically, before you reveal anything, along with the resume you submitted for the selected posting. ' +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });

  test("pre-draft on, gemini engine, posting settled with neither document found — no document mention", () => {
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
        preDraftEnabled: true,
      }),
    ).toBe(
      "Your audio is streamed to Deepgram for transcription. " +
        "Your answer transcript, the posting details, and your prep context are sent to Google Gemini for feedback. " +
        "Revealing a sample answer sends that question and your prep context to Gemini as well. " +
        'While "Pre-draft predicted answer" is on, a predicted question and your prep context are sent to Gemini automatically, before you reveal anything. ' +
        "Your answer video is uploaded to your own Supabase storage, private to your account, and listed in your practice history until you delete it.",
    );
  });
});

// Predictions can now be hidden (lib/copilot/predictionPrefs.js). Once they
// are, the pre-draft switch can no longer fire the automatic send
// preDraftClauseFor discloses — the caller is expected to route
// `preDraftEnabled` through `preDraftDisclosureApplies(preDraftSwitchOn,
// showPredictions)` (see PracticeClient.js) rather than passing the raw
// switch value straight through, so this notice never keeps claiming a
// transfer that hiding predictions has already prevented.
describe("buildPrivacyNotice with preDraftEnabled gated by preDraftDisclosureApplies", () => {
  const baseArgs = {
    sttProviderName: "Deepgram",
    isEmbedded: false,
    framesWillUpload: false,
    hasPosting: false,
    docsSettled: false,
    hasSubmittedResume: false,
    hasSubmittedCoverLetter: false,
    saveEnabled: true,
  };

  test("predictions hidden: the pre-draft switch being on is not enough — the sentence is absent entirely", () => {
    const notice = buildPrivacyNotice({
      ...baseArgs,
      preDraftEnabled: preDraftDisclosureApplies(/* preDraftSwitchOn */ true, /* showPredictions */ false),
    });
    expect(notice).not.toContain('"Pre-draft predicted answer" is on');
    expect(notice).not.toContain("automatically, before you reveal anything");
  });

  test("predictions visible: the pre-draft switch being on IS enough — the sentence is present", () => {
    const notice = buildPrivacyNotice({
      ...baseArgs,
      preDraftEnabled: preDraftDisclosureApplies(/* preDraftSwitchOn */ true, /* showPredictions */ true),
    });
    expect(notice).toContain('"Pre-draft predicted answer" is on');
    expect(notice).toContain("automatically, before you reveal anything");
  });

  // The load-bearing proof: hiding predictions must genuinely restore the
  // narrower, pre-feature notice — not just reword the pre-draft clause into
  // something that merely sounds less alarming. Byte-identical to the
  // `preDraftEnabled: false` path (the same path the frozen-oracle sweep
  // above pins against the pre-extraction original) is the only way to know
  // no residue of the clause survives.
  test("predictions hidden produces a notice byte-identical to preDraftEnabled: false, across every other flag combination", () => {
    const STT_NAMES = [null, "Deepgram"];
    const FLAG_COMBOS = [
      { isEmbedded: false, framesWillUpload: false, hasPosting: false, docsSettled: false, hasSubmittedResume: false, hasSubmittedCoverLetter: false, saveEnabled: true },
      { isEmbedded: false, framesWillUpload: true, hasPosting: true, docsSettled: false, hasSubmittedResume: false, hasSubmittedCoverLetter: false, saveEnabled: false },
      { isEmbedded: false, framesWillUpload: false, hasPosting: true, docsSettled: true, hasSubmittedResume: true, hasSubmittedCoverLetter: false, saveEnabled: true },
      { isEmbedded: false, framesWillUpload: false, hasPosting: true, docsSettled: true, hasSubmittedResume: true, hasSubmittedCoverLetter: true, saveEnabled: false },
      { isEmbedded: true, framesWillUpload: false, hasPosting: true, docsSettled: true, hasSubmittedResume: false, hasSubmittedCoverLetter: false, saveEnabled: true },
    ];
    for (const sttProviderName of STT_NAMES) {
      for (const flags of FLAG_COMBOS) {
        const withGatedHelper = buildPrivacyNotice({
          ...flags,
          sttProviderName,
          preDraftEnabled: preDraftDisclosureApplies(true, false),
        });
        const withExplicitFalse = buildPrivacyNotice({
          ...flags,
          sttProviderName,
          preDraftEnabled: false,
        });
        expect(withGatedHelper).toBe(withExplicitFalse);
      }
    }
  });
});
