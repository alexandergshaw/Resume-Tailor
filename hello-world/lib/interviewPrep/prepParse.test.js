// normalizePack — the O-15 write/read choke point (design-structure.r1.md §9,
// design-operate.r1.md §1). Runs at BOTH write time (before a generated pack
// is stored) and read time (before any pack reaches a candidate's screen), so
// this file's assertions bind production behaviour, not merely a CI check
// (R-IP3-58: "K1-PROHIBITION's placement resolved to runtime, inside
// normalizePack, not test-only — a guard that runs in production is strictly
// stronger than one that only runs in CI").
//
// SCOPE, STATED HONESTLY. No binding document gives a complete TypeScript
// shape for `Pack`. The one fragment fully specified anywhere in the four
// binding design documents is design-operate.r1.md §1's own counter-build:
//
//   sections.stages[N].recommendedAnswer  (string)
//   sections.stages[N].support            ({ kind, claimId } | undefined)
//   claims                                ({ id, text, sourceUrl }[])
//
// `claims` is an ARRAY, resolved by `.find(c => c.id === support.claimId)`,
// not a map keyed by claim id. This is a wave-1 correction, not part of the
// four binding documents: `interview_prep_packs_claims_is_array`
// (supabase/migrations/20260914000000_interview_prep.sql) CHECKs
// `jsonb_typeof(pack -> 'claims') = 'array'` whenever `status` is
// `'ready'`/`'partial'`, so a map-shaped `claims` object fails that CHECK
// with 23514 on every write, for every engine. `normalizePack` — this
// module's write/read choke point — therefore also CONVERTS a legacy or
// model-supplied object map (`{ [claimId]: { text, sourceUrl } }`) into this
// array shape rather than dropping it, so a citation is never silently
// un-grounded by the conversion itself. See prepParse.js's own header and
// the "claims type guarantee" / "conversion fidelity" describe blocks below.
//
// Every fixture below is built ONLY from that shape. design-structure.r1.md
// §9 also names `AnswerLine`/`Question.text` as scanned surfaces, but gives no
// concrete shape for either, so this file does not fabricate one — a real
// `Pack` may carry additional section kinds this file never exercises. That
// gap is named again in this seat's own artifact under "What I could not
// verify", not smoothed over here.
//
// TWO INDEPENDENT INSTRUMENTS, PER design-operate.r1.md §1:
//   K1-SHAPE       — name ⟹ cited (a detected name with no resolvable,
//                    non-empty-sourceUrl claim behind it is dropped).
//   K1-PROHIBITION — cited is NOT enough: a line naming a real person must
//                    not ALSO predict who will interview the candidate,
//                    regardless of citation status.
// Neither substitutes for the other (O-15's own two independent clauses).
//
// THE REDIRECT-SHAPED NEGATIVE FIXTURE (contract C-46 / R-IP3-55 item 1 /
// plan.r1.md PLN-10). `lib/llm/grounding.test.js:73,76` seeds a `grounded`
// array containing BOTH a `vertexaisearch.cloud.google.com` redirect entry
// AND a plain `https://acme.com/x` entry side by side — a shape the legacy
// grounding transport can never actually produce (every `web.uri` on that
// transport IS the redirect; see [[gemini-grounding-redirects]]), so that
// test's "accepts a URL whose host was actually searched" case can never
// exhibit the real defect. C-46 requires IP3's own citation-shape tests not
// to repeat that shape: a redirect-shaped URL must appear only as a NEGATIVE
// fixture, never as a value a test asserts passes.
//
// design-structure.r1.md §9's own prose for the citation gate says only
// "a non-empty sourceUrl" — it does not say a redirect URL specifically must
// be refused. The test below (the "redirect-shaped citation" describe block)
// asserts the STRONGER property C-46 requires anyway. This is a DECISION
// this seat is making to satisfy an explicit, already-adopted ledger line
// (C-46) that the design prose left mechanically underspecified — flagged
// here, and in the seat's own artifact, for the 4b checker to examine rather
// than silently resolved either way.
import { describe, it, expect } from "vitest";
import { normalizePack } from "@/lib/interviewPrep/prepParse.js";
import { PREDICTION_CORPUS } from "./__fixtures__/predictionCorpus.js";

const REDIRECT_URL = "https://vertexaisearch.cloud.google.com/redirect/abc123";
const PUBLISHER_URL = "https://acme.example/leadership";

// The exact mutant design-operate.r1.md §1b specifies, byte-for-byte.
const PREDICTION_SENTENCE =
  "Your panel will most likely include Jane Doe, VP of Engineering, who leads the platform team.";
// The design's own positive control: same person, same fact, zero prediction
// language.
const COMPANY_FACT_SENTENCE =
  "Jane Doe was appointed VP of Engineering in 2024, according to the company's leadership page.";
// A sentence with no detected personal name at all — the vacuity/no-name case.
const NO_NAME_SENTENCE = "Acme Robotics builds warehouse robots for cold storage and runs three depots.";

function pack({ stages = [], claims = [] } = {}) {
  return { sections: { stages }, claims };
}

function stage(recommendedAnswer, support) {
  return { recommendedAnswer, support };
}

/** Every recommendedAnswer string surviving into the normalized pack. */
function survivingAnswers(result) {
  return (result?.sections?.stages || []).map((s) => s?.recommendedAnswer).filter((t) => typeof t === "string");
}

describe("normalizePack — K1-SHAPE: name implies cited", () => {
  it("[mutant] drops a detected name with NO support object at all", () => {
    // Kills: a build that renders every generated line unconditionally,
    // regardless of whether it names a real person.
    const input = pack({ stages: [stage(PREDICTION_SENTENCE.replace("panel will most likely include", "team includes"))] });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers.join("\n")).not.toContain("Jane Doe");
  });

  it("[mutant] drops a detected name whose support.kind is not \"claim\"", () => {
    const input = pack({
      stages: [stage("Jane Doe leads the platform team at this company.", { kind: "none" })],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers.join("\n")).not.toContain("Jane Doe");
  });

  it("[mutant] drops a detected name whose claimId resolves to an EMPTY sourceUrl", () => {
    const input = pack({
      stages: [stage("Jane Doe leads the platform team at this company.", { kind: "claim", claimId: "c-empty" })],
      claims: [{ id: "c-empty", text: "Jane Doe leads the platform team.", sourceUrl: "" }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers.join("\n")).not.toContain("Jane Doe");
  });

  it("[positive control] keeps a detected name whose claim resolves to a non-empty sourceUrl", () => {
    const input = pack({
      stages: [stage(COMPANY_FACT_SENTENCE, { kind: "claim", claimId: "c1" })],
      claims: [{ id: "c1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).toContain(COMPANY_FACT_SENTENCE);
  });

  it("[vacuity + companion] a line with no detected name at all is never touched", () => {
    // Pairs with the mutant tests above: proves the detector is not simply
    // dropping every stage, only ones that actually name someone.
    const input = pack({
      stages: [
        stage(NO_NAME_SENTENCE, undefined),
        stage("Jane Doe leads the platform team at this company.", { kind: "none" }), // canary: must still be dropped
      ],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).toContain(NO_NAME_SENTENCE);
    expect(answers.join("\n")).not.toContain("Jane Doe");
  });
});

describe("normalizePack — K1-PROHIBITION: cited is not enough (design-operate.r1.md §1b)", () => {
  it('[mutant] drops the exact string "Your panel will most likely include Jane Doe, VP of Engineering, who leads the platform team." EVEN WITH a valid citation', () => {
    // This is the test the brief names first. The mutant PASSES K1-SHAPE
    // (support.kind === "claim", non-empty sourceUrl) and must still be
    // refused, because O-15's prohibition on predicting the interview panel
    // is unconditional -- a citation cannot license a prediction.
    const input = pack({
      stages: [stage(PREDICTION_SENTENCE, { kind: "claim", claimId: "c7" })],
      claims: [{ id: "c7", text: "Jane Doe is VP of Engineering and leads the platform team", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).not.toContain(PREDICTION_SENTENCE);
    expect(answers.join("\n")).not.toContain("Your panel will most likely include");
  });

  it("[positive control] the SAME fact, rephrased as a pure company fact with the SAME citation, PASSES", () => {
    // Same person, same citation shape, zero prediction language -- proves
    // the guard is scanning for prediction LANGUAGE, not merely refusing
    // every line that names a cited person.
    const input = pack({
      stages: [stage(COMPANY_FACT_SENTENCE, { kind: "claim", claimId: "c7" })],
      claims: [{ id: "c7", text: "Jane Doe is VP of Engineering and leads the platform team", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).toContain(COMPANY_FACT_SENTENCE);
  });

  it("[vacuity] a pack with no stages at all normalizes without throwing", () => {
    // Companion to the two tests above: proves an empty input is not what
    // makes the mutant test's absence assertion pass.
    expect(() => normalizePack(pack({ stages: [] }))).not.toThrow();
    expect(survivingAnswers(normalizePack(pack({ stages: [] })))).toEqual([]);
  });

  it("[control] a minimal paraphrase preserving \"panel\"/\"will...include\" is ALSO refused", () => {
    // design-operate.r1.md §1b explicitly authorizes "this literal string (or
    // a minimal paraphrase preserving 'panel'/'will…include')" as the RED
    // case -- this proves the guard matches the PREDICATE, not one frozen
    // sentence.
    const paraphrase = "The panel will most likely include Jane Doe from Engineering.";
    const input = pack({
      stages: [stage(paraphrase, { kind: "claim", claimId: "c8" })],
      claims: [{ id: "c8", text: "Jane Doe works in Engineering.", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).not.toContain(paraphrase);
  });
});

describe("normalizePack — K1-PROHIBITION generalizes across a structurally diverse corpus, not two literal n-grams (check-4b.r1.md Q4 / C4B-4)", () => {
  // check-4b.r1.md's Q4 BLOCKER: the two tests above are BOTH satisfied by a
  // build whose ENTIRE prohibition check is
  // `/panel/i.test(text) && /will most likely include/i.test(text)` --
  // nothing else, no broader predicate -- because the mutant and its one
  // authorized paraphrase share exactly those two literal n-grams. The
  // checker then fed that exact build four adversarial, cited, non-redirect
  // prediction sentences never in the suite and reported "SHIPPED (O-15
  // violation)" for all four.
  //
  // lib/interviewPrep/__fixtures__/predictionCorpus.js seeds those same four
  // sentences (PREDICTION_CORPUS[0..3], verbatim) and adds four more, each
  // one exercising a DIFFERENT independent term from design-operate.r1.md
  // §1b's own predicate list in isolation -- STRUCTURAL PREDICATE UNDER
  // TEST, quoted from that document: a line naming a detected person must
  // not match "panel", "interview(er)?s?", "will (most likely |probably
  // )?(include|meet|speak (with|to))", "your interviewer", "likely to
  // (interview|meet|speak)", or "hiring manager will", regardless of
  // citation status. Every row below shares NEITHER "panel" NOR "will most
  // likely include" with at least one sibling row, so a build hardcoded to
  // that one two-substring conjunction fails on sight of most of this
  // block -- verified directly: this seat's own scratch counter-build
  // (identical to the checker's) refuses 0 of these 8 rows.
  //
  // Two further corpus members are held out of this it.each list on
  // purpose -- see predictionCorpus.js's own "HELD OUT" section for why,
  // and 4b.r2.md for this seat's private-scratch proof that a genuine
  // predicate-based reference classifies them correctly while a build tuned
  // only to the 8 rows below does not.
  it.each(PREDICTION_CORPUS)("[$term] refuses a cited prediction: $label", ({ text }) => {
    const input = pack({
      stages: [stage(text, { kind: "claim", claimId: "corpus" })],
      claims: [{ id: "corpus", text: "Jane Doe is VP of Engineering and leads the platform team.", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).not.toContain(text);
  });

  it.each(PREDICTION_CORPUS)("[$term] keeps the SAME fact rephrased with zero prediction language: $label", ({ companyFact }) => {
    // Paired positive control per row: every companyFact fixture names the
    // same person/fact and deliberately contains NONE of design-operate's
    // six predicate terms, so a correct implementation must keep it. A
    // guard that over-refuses (drops every cited sentence naming a person)
    // fails here even though it would pass every refusal row above.
    const input = pack({
      stages: [stage(companyFact, { kind: "claim", claimId: "corpus-fact" })],
      claims: [{ id: "corpus-fact", text: "Jane Doe is VP of Engineering and leads the platform team.", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).toContain(companyFact);
  });
});

describe("normalizePack — the redirect-shaped negative citation fixture (C-46 / R-IP3-55 item 1 / PLN-10)", () => {
  it('[decision under test] a claim whose sourceUrl is a vertexaisearch REDIRECT does not count as "cited" for K1-SHAPE', () => {
    // The mutant this kills: an implementation that treats ANY non-empty
    // sourceUrl as sufficient (design-structure.r1.md §9's literal prose),
    // which would let this redirect-shaped citation pass. This test asserts
    // the STRONGER, ledger-mandated behaviour instead -- see this file's own
    // header for why that is a decision, not a restatement of §9.
    const input = pack({
      stages: [stage("Jane Doe is the VP of Engineering at this company.", { kind: "claim", claimId: "c9" })],
      claims: [{ id: "c9", text: "Jane Doe is VP of Engineering.", sourceUrl: REDIRECT_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers.join("\n")).not.toContain("Jane Doe");
  });

  it("[positive control, same extractor] the identical sentence with a genuine publisher sourceUrl PASSES", () => {
    // Distinguishes "the citation check is broken" from "redirects are
    // specifically refused" -- the same person, same sentence, only the
    // sourceUrl's shape differs.
    const input = pack({
      stages: [stage("Jane Doe is the VP of Engineering at this company.", { kind: "claim", claimId: "c9" })],
      claims: [{ id: "c9", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).toContain("Jane Doe is the VP of Engineering at this company.");
  });
});

describe("normalizePack — array-shaped claims resolve by id (interview_prep_packs_claims_is_array)", () => {
  it("resolves a citation by id and keeps recommendedAnswer when the sourceUrl is real and non-redirect", () => {
    const input = pack({
      stages: [stage(COMPANY_FACT_SENTENCE, { kind: "claim", claimId: "arr-1" })],
      claims: [{ id: "arr-1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers).toContain(COMPANY_FACT_SENTENCE);
  });
});

describe("normalizePack — claims type guarantee (interview_prep_packs_claims_is_array)", () => {
  // The database CHECK this whole wave exists to satisfy tests exactly one
  // thing: jsonb_typeof(pack -> 'claims') = 'array'. Asserted directly here,
  // independent of any citation behaviour, for every input shape a caller
  // (a fresh claim, a legacy stored row, a malformed model reply) could hand
  // normalizePack.
  it.each([
    ["no claims property at all", { sections: { stages: [] } }],
    ["claims: {}", { sections: { stages: [] }, claims: {} }],
    ["claims: null", { sections: { stages: [] }, claims: null }],
    ["claims: a string", { sections: { stages: [] }, claims: "not-an-array-or-object" }],
    [
      "claims already an array",
      { sections: { stages: [] }, claims: [{ id: "c1", text: "t", sourceUrl: PUBLISHER_URL }] },
    ],
  ])("%s -> result.claims is an array", (_label, input) => {
    const result = normalizePack(input);
    expect(Array.isArray(result.claims)).toBe(true);
  });
});

describe("normalizePack — conversion fidelity: a legacy/model-supplied object map is converted, not dropped", () => {
  it("converts an object-map claims input into an array carrying the original key as id, and a citation still resolves against it", () => {
    const input = {
      sections: { stages: [stage(COMPANY_FACT_SENTENCE, { kind: "claim", claimId: "legacy-1" })] },
      claims: { "legacy-1": { text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL } },
    };
    const result = normalizePack(input);
    expect(Array.isArray(result.claims)).toBe(true);
    expect(result.claims).toContainEqual({
      id: "legacy-1",
      text: "Jane Doe is VP of Engineering.",
      sourceUrl: PUBLISHER_URL,
    });
    // The test the brief names as the one that catches "converted, but
    // silently un-grounded": if the conversion dropped the map instead of
    // rewriting it, this citation could never resolve and the sentence
    // would come back with recommendedAnswer: null.
    expect(survivingAnswers(result)).toContain(COMPANY_FACT_SENTENCE);
  });

  it("skips a map entry whose value is not an object, rather than emitting it malformed", () => {
    const input = {
      sections: { stages: [] },
      claims: { bad: "not-an-object", good: { text: "t", sourceUrl: PUBLISHER_URL } },
    };
    const result = normalizePack(input);
    expect(result.claims).toEqual([{ id: "good", text: "t", sourceUrl: PUBLISHER_URL }]);
  });
});

describe("normalizePack — negative controls on claim-id resolution", () => {
  it("a claimId matching nothing in the claims array is uncited", () => {
    const input = pack({
      stages: [stage("Jane Doe leads the platform team at this company.", { kind: "claim", claimId: "does-not-exist" })],
      claims: [{ id: "c1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers.join("\n")).not.toContain("Jane Doe");
  });

  it("an entry with no id is NOT matched by a support with no claimId (undefined === undefined must not collapse)", () => {
    // This repo has already shipped an undefined-collapsing bug once in a
    // different module -- this is the regression test for reintroducing it
    // here, at the .find(c => c.id === support.claimId) resolution site.
    const input = pack({
      stages: [stage("Jane Doe leads the platform team at this company.", { kind: "claim" })],
      claims: [{ text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    });
    const answers = survivingAnswers(normalizePack(input));
    expect(answers.join("\n")).not.toContain("Jane Doe");
  });
});
