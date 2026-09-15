// normalizePack — the O-15 write/read choke point (design-structure.r1.md §9,
// design-operate.r1.md §1). Runs at BOTH write time (before a generated pack
// is stored) and read time (before any pack reaches a candidate's screen), so
// this file's assertions bind production behaviour, not merely a CI check
// (R-IP3-58: "K1-PROHIBITION's placement resolved to runtime, inside
// normalizePack, not test-only — a guard that runs in production is strictly
// stronger than one that only runs in CI").
//
// SHAPE. supabase/migrations/20260914000000_interview_prep.sql's
// `interview_prep_packs_ready_is_complete` CHECK (~:194-211) now gives a
// concrete path for every scanned surface:
//
//   sections.aboutYou.answer.lines[]   (AnswerLine: { text, support? })
//   sections.whyRole.answer.lines[]    (AnswerLine: { text, support? })
//   sections.askThem.questions[]       (Question:   { text, support? })
//   sections.stages.stages[]           (Stage:      { name, questions,
//                                        recommendedAnswer, support? })
//   claims[]                           ({ id, text, sourceUrl }[])
//
// The `stages` section is nested one level deeper than the other three —
// `{ stages: Stage[] }` — because "stages" names both the section key and
// its one array field. A prior revision of normalizePack read `sections.
// stages` ITSELF as the array (`Array.isArray(sections.stages)`), which is
// `false` under this shape, so a correctly-shaped pack's entire stage list
// was silently replaced with `[]` — the regression the "AC-N16.1" block
// below guards directly.
//
// `claims` is an ARRAY, resolved by `.find(c => c.id === support.claimId)`,
// not a map keyed by claim id: `interview_prep_packs_claims_is_array` CHECKs
// `jsonb_typeof(pack -> 'claims') = 'array'` whenever `status` is
// `'ready'`/`'partial'`, so a map-shaped `claims` object fails that CHECK
// with 23514 on every write, for every engine. `normalizePack` — this
// module's write/read choke point — therefore also CONVERTS a legacy or
// model-supplied object map (`{ [claimId]: { text, sourceUrl } }`) into this
// array shape rather than dropping it, so a citation is never silently
// un-grounded by the conversion itself. See the "claims type guarantee" /
// "conversion fidelity" describe blocks below.
//
// TWO INDEPENDENT INSTRUMENTS, PER design-operate.r1.md §1, applied
// IDENTICALLY to all three surfaces that can carry a name (`refusesLine` in
// prepParse.js — askThem is the highest-risk of the three, since the
// candidate reads it aloud to a recruiter, but the rule itself does not vary
// by surface):
//   K1-SHAPE       — name ⟹ cited (a detected name with no resolvable,
//                    non-empty-sourceUrl claim behind it is refused).
//   K1-PROHIBITION — cited is NOT enough: a line naming a real person must
//                    not ALSO predict who will interview the candidate,
//                    regardless of citation status.
// Neither substitutes for the other (O-15's own two independent clauses).
// `AnswerLine`/`Question` entries that refuse are DROPPED from their array;
// a `Stage` that refuses keeps its entry with `recommendedAnswer: null` —
// see the "AC-N16.2"/"AC-N16.3" blocks below for why the two appliers
// differ (F-3: nulling an AnswerLine/Question in place would leave
// `jsonb_array_length` unchanged, so a gutted section could still pass the
// CHECK as non-empty).
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
import { normalizePack, countRefusedLines, EMBEDDED_TEMPLATE_ORIGIN } from "@/lib/interviewPrep/prepParse.js";
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

/** Builds a pack carrying only a stages section, in the nested
 *  `{ stages: { stages: [...] } }` shape `interview_prep_packs_ready_is_
 *  complete` requires — NOT the flat `{ stages: [...] }` shape a prior
 *  revision of this file used, which was itself the shape F-1 exists to
 *  stop normalizePack from silently emptying. */
function pack({ stages = [], claims = [] } = {}) {
  return { sections: { stages: { stages } }, claims };
}

function stage(recommendedAnswer, support) {
  return { recommendedAnswer, support };
}

function answerLine(text, support) {
  return { text, support };
}

function question(text, support) {
  return { text, support };
}

/** Every recommendedAnswer string surviving into the normalized pack. */
function survivingAnswers(result) {
  return (result?.sections?.stages?.stages || []).map((s) => s?.recommendedAnswer).filter((t) => typeof t === "string");
}

function survivingAboutYouTexts(result) {
  return (result?.sections?.aboutYou?.answer?.lines || []).map((l) => l?.text).filter((t) => typeof t === "string");
}

function survivingAskThemTexts(result) {
  return (result?.sections?.askThem?.questions || []).map((q) => q?.text).filter((t) => typeof t === "string");
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
    ["no claims property at all", { sections: { stages: { stages: [] } } }],
    ["claims: {}", { sections: { stages: { stages: [] } }, claims: {} }],
    ["claims: null", { sections: { stages: { stages: [] } }, claims: null }],
    ["claims: a string", { sections: { stages: { stages: [] } }, claims: "not-an-array-or-object" }],
    [
      "claims already an array",
      { sections: { stages: { stages: [] } }, claims: [{ id: "c1", text: "t", sourceUrl: PUBLISHER_URL }] },
    ],
  ])("%s -> result.claims is an array", (_label, input) => {
    const result = normalizePack(input);
    expect(Array.isArray(result.claims)).toBe(true);
  });
});

describe("normalizePack — conversion fidelity: a legacy/model-supplied object map is converted, not dropped", () => {
  it("converts an object-map claims input into an array carrying the original key as id, and a citation still resolves against it", () => {
    const input = {
      sections: { stages: { stages: [stage(COMPANY_FACT_SENTENCE, { kind: "claim", claimId: "legacy-1" })] } },
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
      sections: { stages: { stages: [] } },
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

describe("normalizePack — AC-N16.1: the stages section is nested ({sections:{stages:{stages:[...]}}})", () => {
  it("returns a stage intact under the CHECK's own nested shape", () => {
    // Kills: reading `sections.stages` ITSELF as the array
    // (`Array.isArray(sections.stages)`), which is `false` under this shape
    // and, before this fix, silently replaced the whole stage list with
    // `[]` at both write and read time.
    const oneStage = stage("Some plain recommended answer with no name in it.", undefined);
    const input = { sections: { stages: { stages: [oneStage] } }, claims: [] };
    const result = normalizePack(input);
    expect(result.sections.stages.stages).toEqual([oneStage]);
  });
});

describe("normalizePack — AC-N16.2: refusesLine applies identically to askThem and aboutYou, not stages alone", () => {
  // Kills: wiring K1-SHAPE/K1-PROHIBITION into normalizeStage only, leaving
  // the two new AnswerLine/Question surfaces completely unchecked. Every
  // "drop" case below also asserts the surviving array's exact length, not
  // merely that the refused text is absent -- a build that NULLS the entry
  // in place instead of dropping it (F-3's mutant) would otherwise slip
  // past an absence-only assertion, since a nulled `text` also fails a
  // `typeof text === "string"` filter.
  it("drops an uncited askThem question naming a person, keeping the rest of the list", () => {
    const safeText = "What excites the team about this quarter's roadmap?";
    const input = {
      sections: {
        askThem: {
          questions: [question("What does Jane Doe expect from this role?", undefined), question(safeText, undefined)],
        },
      },
      claims: [],
    };
    const result = normalizePack(input);
    expect(result.sections.askThem.questions).toHaveLength(1);
    expect(survivingAskThemTexts(result)).toEqual([safeText]);
  });

  it("keeps an askThem question naming a person when its claimId resolves to a genuine, non-redirect citation", () => {
    const text = "What has Jane Doe, the VP of Engineering, prioritized this year?";
    const input = {
      sections: { askThem: { questions: [question(text, { kind: "claim", claimId: "q1" })] } },
      claims: [{ id: "q1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    expect(survivingAskThemTexts(result)).toContain(text);
  });

  it("drops an askThem question whose citation is a vertexaisearch redirect", () => {
    const text = "What has Jane Doe, the VP of Engineering, prioritized this year?";
    const input = {
      sections: { askThem: { questions: [question(text, { kind: "claim", claimId: "q2" })] } },
      claims: [{ id: "q2", text: "Jane Doe is VP of Engineering.", sourceUrl: REDIRECT_URL }],
    };
    const result = normalizePack(input);
    expect(result.sections.askThem.questions).toHaveLength(0);
  });

  it("drops an uncited aboutYou line naming a person, keeping the rest of the list", () => {
    const safeText = "Led migration of the checkout service to a new payments provider.";
    const input = {
      sections: {
        aboutYou: {
          answer: { lines: [answerLine("I previously worked with Jane Doe on the platform team.", undefined), answerLine(safeText, undefined)] },
        },
      },
      claims: [],
    };
    const result = normalizePack(input);
    expect(result.sections.aboutYou.answer.lines).toHaveLength(1);
    expect(survivingAboutYouTexts(result)).toEqual([safeText]);
  });

  it("keeps an aboutYou line naming a person when its claimId resolves to a genuine, non-redirect citation", () => {
    const text = "I previously worked with Jane Doe, the VP of Engineering, on the platform team.";
    const input = {
      sections: { aboutYou: { answer: { lines: [answerLine(text, { kind: "claim", claimId: "a1" })] } } },
      claims: [{ id: "a1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    expect(survivingAboutYouTexts(result)).toContain(text);
  });

  it("drops an aboutYou line whose citation is a vertexaisearch redirect", () => {
    const text = "I previously worked with Jane Doe, the VP of Engineering, on the platform team.";
    const input = {
      sections: { aboutYou: { answer: { lines: [answerLine(text, { kind: "claim", claimId: "a2" })] } } },
      claims: [{ id: "a2", text: "Jane Doe is VP of Engineering.", sourceUrl: REDIRECT_URL }],
    };
    const result = normalizePack(input);
    expect(result.sections.aboutYou.answer.lines).toHaveLength(0);
  });

  it("also drops an uncited whyRole line naming a person (same applier, wired to a third section)", () => {
    const input = {
      sections: { whyRole: { answer: { lines: [answerLine("Jane Doe built this team from scratch.", undefined)] } } },
      claims: [],
    };
    const result = normalizePack(input);
    expect(result.sections.whyRole.answer.lines).toHaveLength(0);
  });
});

describe("normalizePack — missing/malformed sections coerce to their empty skeleton (single choke point)", () => {
  it("a pack missing all four sections normalizes to well-formed empty skeletons for each", () => {
    const result = normalizePack({ sections: {}, claims: [] });
    expect(result.sections.aboutYou).toEqual({ answer: { lines: [] } });
    expect(result.sections.whyRole).toEqual({ answer: { lines: [] } });
    expect(result.sections.askThem).toEqual({ questions: [] });
    expect(result.sections.stages).toEqual({ stages: [] });
  });

  it("a section present but shaped wrong coerces to its empty skeleton rather than throwing", () => {
    expect(() =>
      normalizePack({ sections: { aboutYou: "not an object", askThem: { questions: "not an array" } }, claims: [] }),
    ).not.toThrow();
    const result = normalizePack({ sections: { aboutYou: "not an object", askThem: { questions: "not an array" } }, claims: [] });
    expect(result.sections.aboutYou).toEqual({ answer: { lines: [] } });
    expect(result.sections.askThem).toEqual({ questions: [] });
  });
});

describe("normalizePack — F-2: refusedLines is no longer on normalizePack's own return value", () => {
  // F-2's finding: `result.refusedLines` used to be recomputed from scratch
  // on every call, so the SAME field read 1 on a fresh pack and 0 on the
  // pack prepStore.js had already normalized once (a second pass sees only
  // survivors). The fix removes the field entirely -- countRefusedLines
  // below is the replacement, called once by the route on the
  // pre-normalization reply, decoupled from this choke point's own
  // read/write repetition.
  it("a normalized pack carries no refusedLines property at all", () => {
    const input = {
      sections: { aboutYou: { answer: { lines: [answerLine("Jane Doe led that project.", undefined)] } } },
      claims: [],
    };
    const result = normalizePack(input);
    expect(result).not.toHaveProperty("refusedLines");
  });
});

describe("countRefusedLines — a separate, decoupled count over the PRE-normalization pack (F-2)", () => {
  it("counts a drop from aboutYou, a drop from askThem, FOUR separately-refused pieces on the SAME stage, and a dropped claim", () => {
    // F: a single stage below carries a refused name, TWO refused questions,
    // and a refused recommendedAnswer -- four separately-dropped pieces of
    // content on the SAME stage. A build that reports a per-stage BOOLEAN
    // (as this repo's own prior revision did) collapses all four onto "1",
    // undercounting the total by 3; this fixture is deliberately shaped so
    // the old and the fixed accounting disagree; the un-enhanced version of
    // this test (a single refusal per stage) could not tell them apart.
    // A dropped claim is included too, since a claim `refusesClaimText`
    // removes is also a refusal countRefusedLines used to silently omit.
    const input = {
      sections: {
        aboutYou: { answer: { lines: [answerLine("Jane Doe led that project.", undefined)] } },
        askThem: { questions: [question("What does Jane Doe think?", undefined)] },
        stages: {
          stages: [
            {
              name: "Panel with Jane Doe",
              questions: ["Jane Doe will be your interviewer.", "Your interviewer Jane Doe leads this team."],
              recommendedAnswer: "Jane Doe led the platform team.",
              support: undefined,
            },
          ],
        },
      },
      claims: [{ id: "c-dropped", text: "Jane Doe will interview you.", sourceUrl: PUBLISHER_URL }],
    };
    const { claims } = normalizePack(input);
    // aboutYou (1) + askThem (1) + stage's name/2 questions/recommendedAnswer (4) + the dropped claim (1) = 7.
    expect(countRefusedLines(input, claims)).toBe(7);
  });

  it("is 0 when nothing in the pack is refused", () => {
    const input = pack({ stages: [] });
    expect(countRefusedLines(input, input.claims)).toBe(0);
  });

  it("never mutates or normalizes the pack it counts against", () => {
    const input = {
      sections: { aboutYou: { answer: { lines: [answerLine("Jane Doe led that project.", undefined)] } } },
      claims: [],
    };
    const before = JSON.stringify(input);
    countRefusedLines(input, []);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("stays a true count across repeated calls -- unlike the removed normalizePack field, it does not silently fall to 0", () => {
    // This is the exact defect the header of this describe block names: a
    // count that reads the pack's OWN prior output goes to 0 on every call
    // after the first. countRefusedLines always reads the SAME raw input,
    // so calling it twice must report the identical number both times.
    const input = {
      sections: { aboutYou: { answer: { lines: [answerLine("Jane Doe led that project.", undefined)] } } },
      claims: [],
    };
    const first = countRefusedLines(input, []);
    const second = countRefusedLines(input, []);
    expect(first).toBe(1);
    expect(second).toBe(1);
  });

  it("never throws on a null, undefined, or non-object pack", () => {
    expect(countRefusedLines(null, [])).toBe(0);
    expect(countRefusedLines(undefined, [])).toBe(0);
    expect(countRefusedLines("not a pack", [])).toBe(0);
  });
});

describe("normalizePack — AC-N8.2: the disclosed NAME_PAIR_RE false-positive residual, confronted not fixed", () => {
  // NAME_PAIR_RE (a consecutive Title-Case pair whose second word is not in
  // the 23-entry org-suffix list) matches "React Native" and "Google Cloud"
  // in ordinary résumé prose, exactly as the org-suffix-list comment at the
  // top of prepParse.js discloses. Section B wires the SAME refusesLine
  // predicate into aboutYou that stages always had, uncited+detected =>
  // refused, with no exception for a false positive -- and this file's own
  // brief is explicit that widening the heuristic to special-case tech
  // stack nouns is NOT the fix ("whack-a-mole without a corpus is how a
  // prior defect happened").
  //
  // Run as a plain assertion, this line is DROPPED (uncited, and
  // "Native"/"Cloud" are not org-suffix words), not kept -- verified while
  // writing this test. `it.fails` is vitest's own primitive for exactly
  // this situation: a known, disclosed, NOT-to-be-patched limitation that
  // must stay visible (an unexpected pass here means the residual gap
  // closed, or reopened differently, and is worth a fresh look) without
  // leaving a permanently red assertion in the suite. This is disclosure,
  // not a claim that the line actually survives in production.
  it.fails("a résumé line naming no real person still gets dropped by the Title-Case-pair false positive", () => {
    const text = "Shipped the payments service on React Native and Google Cloud.";
    const input = { sections: { aboutYou: { answer: { lines: [answerLine(text, undefined)] } } }, claims: [] };
    const result = normalizePack(input);
    expect(survivingAboutYouTexts(result)).toContain(text);
  });

  // F-8: the `it.fails` above stays green for ANY build that fails its one
  // assertion -- including a build that over-refuses EVERYTHING (e.g.
  // `refusesLine` hardwired to `true`), for a reason having nothing to do
  // with the named Title-Case residual. `it.fails` cannot itself distinguish
  // the two: it only asks whether the body throws, not why, and a second
  // assertion inside that SAME body cannot add discriminating power either
  // -- whichever assertion throws first still satisfies `it.fails` on its
  // own, and an `expect` that already threw stops the body before any later
  // assertion runs. A genuine, separate, ordinary test is what actually
  // pins the "and a name-free line is NOT dropped" half: this one goes red
  // on an over-refusing build even though the `it.fails` above stays green
  // either way.
  it("[companion] an ordinary aboutYou line naming no one at all survives (an over-refusing build fails THIS test, not the it.fails above)", () => {
    const controlText = "Shipped the payments service using a modern deployment pipeline.";
    const input = { sections: { aboutYou: { answer: { lines: [answerLine(controlText, undefined)] } } }, claims: [] };
    const result = normalizePack(input);
    expect(survivingAboutYouTexts(result)).toContain(controlText);
  });
});

describe("normalizePack — F-1: the embedded engine's K1-SHAPE exemption is narrow, self-declaring, and unreachable from the model path", () => {
  // F-1's own counter-example, reproduced directly: an interpolated
  // Title-Case job title ("Software Engineer") is detected as a name by the
  // SAME heuristic that spots a real person, and it carries no citation --
  // so without the exemption, an ordinary embedded-engine line is dropped.
  const TITLE_LINE = "Lead with the experience most relevant to the Software Engineer role at Acme Robotics.";

  it("[mutant this kills] WITHOUT templateOrigin set, the same uncited Title-Case line is refused (proves the exemption is opt-in, not a general loosening of K1-SHAPE)", () => {
    const input = { sections: { aboutYou: { answer: { lines: [answerLine(TITLE_LINE, undefined)] } } }, claims: [] };
    const result = normalizePack(input);
    expect(survivingAboutYouTexts(result)).toEqual([]);
  });

  it('[positive control] WITH pack.templateOrigin === EMBEDDED_TEMPLATE_ORIGIN, the identical uncited Title-Case line survives', () => {
    const input = {
      templateOrigin: EMBEDDED_TEMPLATE_ORIGIN,
      sections: { aboutYou: { answer: { lines: [answerLine(TITLE_LINE, undefined)] } } },
      claims: [],
    };
    const result = normalizePack(input);
    expect(survivingAboutYouTexts(result)).toContain(TITLE_LINE);
  });

  it("[control] an unrelated string value on templateOrigin does not accidentally trip the exemption", () => {
    const input = {
      templateOrigin: "gemini",
      sections: { aboutYou: { answer: { lines: [answerLine(TITLE_LINE, undefined)] } } },
      claims: [],
    };
    const result = normalizePack(input);
    expect(survivingAboutYouTexts(result)).toEqual([]);
  });

  it("[mutant this kills] K1-PROHIBITION is NOT exempted -- an interviewer prediction is refused even with templateOrigin set", () => {
    const input = {
      templateOrigin: EMBEDDED_TEMPLATE_ORIGIN,
      sections: {
        stages: { stages: [stage("Jane Doe will be your interviewer for the Software Engineer role.", undefined)] },
      },
      claims: [],
    };
    const result = normalizePack(input);
    expect(survivingAnswers(result)).toEqual([]);
  });

  it("a model-sourced pack with an uncited name is still refused, once the field route.js's generation path strips is actually absent (the shape route.js hands normalizePack)", () => {
    // route.js's own generation path deletes `parsed.pack.templateOrigin`
    // before ever calling normalizePack(parsed.pack) -- see that file's own
    // source-text proof in route.test.js. This is the corresponding
    // prepParse-level proof of what that stripping achieves: fed the exact
    // shape route.js hands this function on the model path (no
    // templateOrigin field at all, because the route already removed it),
    // an uncited name is refused exactly as it always was -- the exemption
    // above is real only when the field is present, and the model path
    // never lets it survive that far.
    const hostileButStripped = {
      sections: { aboutYou: { answer: { lines: [answerLine("Jane Doe led that project.", undefined)] } } },
      claims: [],
    };
    const result = normalizePack(hostileButStripped);
    expect(survivingAboutYouTexts(result)).toEqual([]);
  });
});

describe("normalizePack — F-4: refusesLine reaches a Stage's name and questions[], not recommendedAnswer alone", () => {
  it("[mutant this kills] drops an uncited stage question naming a person, keeping a safe sibling question", () => {
    const input = {
      sections: {
        stages: {
          stages: [
            {
              name: "Onsite",
              questions: ["What does Jane Doe expect from this role?", "What does success look like in 90 days?"],
              recommendedAnswer: null,
              support: undefined,
            },
          ],
        },
      },
      claims: [],
    };
    const result = normalizePack(input);
    expect(result.sections.stages.stages[0].questions).toEqual(["What does success look like in 90 days?"]);
  });

  it("[mutant this kills] nulls a stage's own name when it names an uncited person, keeping the stage entry itself", () => {
    const input = {
      sections: { stages: { stages: [{ name: "Panel with Jane Doe", questions: [], recommendedAnswer: null, support: undefined }] } },
      claims: [],
    };
    const result = normalizePack(input);
    expect(result.sections.stages.stages).toHaveLength(1);
    expect(result.sections.stages.stages[0].name).toBeNull();
  });

  it("[mutant this kills] a stage name containing the K1-PROHIBITION term \"Panel\" is refused even when cited", () => {
    const input = {
      sections: {
        stages: {
          stages: [
            { name: "Panel with Jane Doe", questions: [], recommendedAnswer: null, support: { kind: "claim", claimId: "p1" } },
          ],
        },
      },
      claims: [{ id: "p1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    expect(result.sections.stages.stages[0].name).toBeNull();
  });

  it("[positive control] a stage question naming a person survives when the stage's own citation resolves and no prediction term is present", () => {
    const input = {
      sections: {
        stages: {
          stages: [
            {
              name: "Overview",
              questions: ["What has Jane Doe prioritized this year?"],
              recommendedAnswer: null,
              support: { kind: "claim", claimId: "q1" },
            },
          ],
        },
      },
      claims: [{ id: "q1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    expect(result.sections.stages.stages[0].questions).toEqual(["What has Jane Doe prioritized this year?"]);
  });

  it("[control] a stage with no name/questions fields at all still normalizes (regression: AC-N16.1's own fixture shape)", () => {
    const oneStage = stage("Some plain recommended answer with no name in it.", undefined);
    const input = { sections: { stages: { stages: [oneStage] } }, claims: [] };
    expect(() => normalizePack(input)).not.toThrow();
    expect(normalizePack(input).sections.stages.stages).toEqual([oneStage]);
  });
});

describe("normalizePack — F-4: claims[].text gets K1-PROHIBITION only, never K1-SHAPE (a claim cannot cite itself)", () => {
  it("[mutant this kills] drops a claim whose own text predicts who will interview the candidate", () => {
    const input = {
      sections: {},
      claims: [{ id: "c1", text: "Jane Doe will interview you.", sourceUrl: "" }],
    };
    const result = normalizePack(input);
    expect(result.claims).toEqual([]);
  });

  it("dropping a predictive claim also un-cites every line that resolved its support through it, on the SAME pass", () => {
    // The claim below carries a REAL, non-redirect sourceUrl on purpose --
    // not the empty string a prior revision of this fixture used. With an
    // empty sourceUrl, isCitedClaim already refuses the line on the
    // empty-URL branch alone, regardless of whether the claim was actually
    // dropped first; that made this test pass even against a build that
    // filters refusesClaimText AFTER the sections normalize (a mutant that
    // resolves the stage's support against the UNFILTERED claims array,
    // which still finds "c1" and its genuine sourceUrl, keeping the line).
    // A real sourceUrl closes that gap: the only way survivingAnswers can
    // still come back empty is if the predictive claim is actually removed
    // from `claims` BEFORE the stage's own support is resolved against it.
    const input = {
      sections: {
        stages: { stages: [stage("Jane Doe leads the platform team.", { kind: "claim", claimId: "c1" })] },
      },
      claims: [{ id: "c1", text: "Jane Doe will interview you.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    expect(result.claims).toEqual([]);
    expect(survivingAnswers(result)).toEqual([]);
  });

  it("[positive control] an ordinary cited company fact in claims[].text is kept", () => {
    const input = {
      sections: {},
      claims: [{ id: "c1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    expect(result.claims).toEqual([{ id: "c1", text: "Jane Doe is VP of Engineering.", sourceUrl: PUBLISHER_URL }]);
  });

  it("[vacuity] a claim naming no one at all is never touched, even with prediction-shaped wording", () => {
    const input = {
      sections: {},
      claims: [{ id: "c1", text: "Interviews for this role happen over three rounds.", sourceUrl: "" }],
    };
    const result = normalizePack(input);
    expect(result.claims).toEqual([{ id: "c1", text: "Interviews for this role happen over three rounds.", sourceUrl: "" }]);
  });
});

describe("normalizePack — F-5: a legacy FLAT sections.stages shape (one level shallower) still yields its stages on read", () => {
  it("[mutant this kills] recovers a pack stored as sections.stages: [ ...Stage[] ] directly, the shape the shipped embedded engine actually wrote", () => {
    const oneStage = stage("Some plain recommended answer with no name in it.", undefined);
    // The FLAT, pre-fix shape: sections.stages IS the array, not
    // { stages: [...] }. Without the F-5 back-compat limb, extractStageList
    // coerces this array to {} (asPlainObject) and reads [] back out.
    const legacyInput = { sections: { stages: [oneStage] }, claims: [] };
    const result = normalizePack(legacyInput);
    expect(result.sections.stages.stages).toEqual([oneStage]);
  });

  it("[control] the legacy-shape recovery can actually fail -- proven by asserting the CURRENT (correct) nested shape is untouched by the flat-shape reader alone", () => {
    // A build that reads ONLY the flat shape (`Array.isArray(sectionValue)`)
    // and drops the `Array.isArray(section.stages)` branch would fail this
    // repo's own existing AC-N16.1 nested-shape test -- proving the flat
    // reader is a back-compat ADDITION, not a replacement for the nested
    // read the CHECK constraint actually requires.
    const oneStage = stage("Nested-shape control.", undefined);
    const nestedInput = { sections: { stages: { stages: [oneStage] } }, claims: [] };
    expect(normalizePack(nestedInput).sections.stages.stages).toEqual([oneStage]);
  });
});

describe("normalizePack — F-6: a section wrapper's non-canonical field survives a normalize pass", () => {
  it("[mutant this kills] preserves an unrecognized sibling field on sections.askThem alongside the normalized questions array", () => {
    const input = {
      sections: { askThem: { questions: [question("What does success look like?", undefined)], note: "caller-added" } },
      claims: [],
    };
    const result = normalizePack(input);
    expect(result.sections.askThem.note).toBe("caller-added");
    expect(result.sections.askThem.questions).toHaveLength(1);
  });
});

describe("normalizePack — dropping a claim un-cites every KEPT line that referenced it, not only name-bearing ones", () => {
  // A line naming NOBODY never reaches refusesLine's K1-SHAPE branch at all
  // (containsDetectedName short-circuits it), so it survives regardless of
  // whether its own support.claimId still resolves. Left alone, that line's
  // support object persists exactly as authored -- {kind:"claim",
  // claimId:"c1"} -- even after "c1" is removed from claims by
  // refusesClaimText, so a renderer drawing a "cited" indicator purely from
  // support.claimId's PRESENCE (never re-checking it against the live claims
  // array) would show a source link that resolves to nothing.
  it("[mutant this kills] a surviving, name-free aboutYou line has its dangling support nulled once the claim it pointed at is dropped", () => {
    const input = {
      sections: {
        aboutYou: {
          answer: { lines: [answerLine("Shipped the checkout rewrite ahead of schedule.", { kind: "claim", claimId: "c1" })] },
        },
      },
      claims: [{ id: "c1", text: "Jane Doe will interview you.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    // The line survives (it never named anyone) ...
    expect(result.sections.aboutYou.answer.lines).toHaveLength(1);
    expect(result.sections.aboutYou.answer.lines[0].text).toBe("Shipped the checkout rewrite ahead of schedule.");
    // ... but its support must not still point at a claim that no longer exists.
    expect(result.sections.aboutYou.answer.lines[0].support).toBeNull();
  });

  it("[mutant this kills] the same dangling-support cleanup applies to a Stage's own shared support field", () => {
    const input = {
      sections: {
        stages: { stages: [{ name: "Recruiter screen", questions: [], recommendedAnswer: "Focus on scope and impact.", support: { kind: "claim", claimId: "c1" } }] },
      },
      claims: [{ id: "c1", text: "Jane Doe will interview you.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    expect(result.sections.stages.stages).toHaveLength(1);
    expect(result.sections.stages.stages[0].recommendedAnswer).toBe("Focus on scope and impact.");
    expect(result.sections.stages.stages[0].support).toBeNull();
  });

  it("[positive control] a support that DOES still resolve is left untouched", () => {
    const input = {
      sections: {
        aboutYou: {
          answer: { lines: [answerLine("Shipped the checkout rewrite ahead of schedule.", { kind: "claim", claimId: "c1" })] },
        },
      },
      claims: [{ id: "c1", text: "The company grew headcount by 40% last year.", sourceUrl: PUBLISHER_URL }],
    };
    const result = normalizePack(input);
    expect(result.sections.aboutYou.answer.lines[0].support).toEqual({ kind: "claim", claimId: "c1" });
  });

  it("[control] a line that never carried a support in the first place is not disturbed", () => {
    const input = {
      sections: { aboutYou: { answer: { lines: [answerLine("Shipped the checkout rewrite ahead of schedule.", undefined)] } } },
      claims: [],
    };
    const result = normalizePack(input);
    expect(result.sections.aboutYou.answer.lines[0].support).toBeUndefined();
  });
});

// D's own regression (a section reading "non-empty" from junk entries alone)
// is covered in prepPack.test.js, alongside packStatus -- that predicate is
// the thing the exploit actually fools, so its own test file is where the
// proof belongs; see the "D:" describe block there.

describe("normalizePack — I: the F-1 exemption is keyed on pack's OWN templateOrigin property, never one inherited via the prototype chain", () => {
  const TITLE_LINE_TEXT = "Jane Doe led that project.";

  it("[mutant this kills] Object.prototype pollution alone does not exempt a model-authored pack that carries no own templateOrigin", () => {
    // Simulates the residual risk the fix closes: something ELSE in the
    // running process having polluted Object.prototype -- never something
    // THIS pack itself set. A plain `pack.templateOrigin === ...` comparison
    // reads straight through the prototype chain and would be fooled by
    // this; `Object.hasOwn` cannot be. Defined via defineProperty (configurable,
    // so the `finally` below can remove it) rather than direct assignment.
    Object.defineProperty(Object.prototype, "templateOrigin", {
      value: EMBEDDED_TEMPLATE_ORIGIN,
      configurable: true,
    });
    try {
      const input = { sections: { aboutYou: { answer: { lines: [answerLine(TITLE_LINE_TEXT, undefined)] } } }, claims: [] };
      expect(Object.hasOwn(input, "templateOrigin")).toBe(false);
      const result = normalizePack(input);
      expect(result.sections.aboutYou.answer.lines).toHaveLength(0);
    } finally {
      delete Object.prototype.templateOrigin;
    }
  });

  it("[positive control] the exemption still applies normally when templateOrigin is the pack's own property", () => {
    const input = {
      templateOrigin: EMBEDDED_TEMPLATE_ORIGIN,
      sections: { aboutYou: { answer: { lines: [answerLine(TITLE_LINE_TEXT, undefined)] } } },
      claims: [],
    };
    expect(Object.hasOwn(input, "templateOrigin")).toBe(true);
    const result = normalizePack(input);
    expect(survivingAboutYouTexts(result)).toContain(TITLE_LINE_TEXT);
  });
});
