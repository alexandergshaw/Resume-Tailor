// TDD, written BEFORE lib/copilot/questionVocabulary.js exists.
//
// WHAT THIS MODULE IS FOR. A live interview asked a four-part Workday
// HR-systems question and the app answered "I haven't directly designed
// Workday reports, but I have extensive experience with complex data
// challenges…" followed by four bullets about Mutual of Omaha, React, Kafka
// and MongoDB. Not one of them said "Workday", and the compliance half of the
// question went unanswered. The question was already at character 0 of the
// prompt (answerPrompts.js:141, :273); what was missing was permission to use
// its words to NAME the subject.
//
// THE HAZARD THIS FILE IS THE GATE AGAINST. Two earlier drafts of the design
// tried to buy that permission with instructions that license fabrication —
// "using one of the interviewer's terms is never a claim to have used it"
// (false inside "Action: I designed the Workday reports"), and an acceptance
// criterion of "the first point contains 'Workday' and does not begin with a
// negation" (satisfiable only by lying). So every "it must say the word" case
// below is paired with an "and here it must say NOTHING" case, and the
// honesty checks are tested against the honest framing the feature is
// supposed to produce, not only against the dishonest one it must reject.
//
// THE CONTRACT UNDER TEST (design §4c):
//   roleTerms(question)                                  -> string[]
//   unsupportedRoleTerms(points, material, terms)         -> string[]
//   claimedWithoutBacking(points, { roleTerms, material })-> number[]  (point indices)
//   MAX_QUESTION_CHARS, MAX_ROLE_TERMS                    -> number
//
// §4c's fourth export, `topicalityOnly`, is NOT tested here and deliberately
// so: the design defines it only as "ex-unsourcedPoints, §5c", and no
// `unsourcedPoints` exists anywhere in this tree to inherit semantics from.
// Writing cases against a guessed definition would pin the guess, not the
// contract. It needs a stated contract before it can have a test.
//
// EVERY EXPECTED VALUE BELOW WAS MEASURED, not guessed: each question string
// here was run through the real extractKeywords (lib/llm/engines/tailor-lite/
// keywords.js) against the real default taxonomy before this file was
// written, and the recorded output is quoted in the comment beside it. The
// gate cases deliberately use the REAL extractor rather than a stub — a
// stubbed gate would prove only that the test's own double fires.

import { describe, it, expect } from "vitest";
import {
  roleTerms,
  unsupportedRoleTerms,
  claimedWithoutBacking,
  MAX_QUESTION_CHARS,
  MAX_ROLE_TERMS,
} from "./questionVocabulary.js";

// The motivating question, reconstructed so that the real extractor produces
// the recorded shape: tool_platform [{ canonical: "Workday", score: 9,
// count: 3 }] plus seven advisory RAKE `topic` phrases. Only the taxonomy
// tier is a role term (design AC-1.1 restricts to BUZZWORD_CATEGORIES,
// postingBuzzwords.js:91), so the topic phrases must NOT come back.
const WORKDAY_QUESTION =
  "Can you describe a particularly complex Workday report you designed? " +
  "What was the business challenge it addressed, and which Workday tools did you use to build it? " +
  "How do you ensure data accuracy and compliance with security standards when building custom Workday reports, " +
  "especially when the work involves managing sensitive HR information?";

// The candidate's real material, from the session that produced the defect.
// It contains no Workday anything — that is the whole point: the honest
// answer has to name Workday as the SUBJECT while claiming none of it.
const MATERIAL_WITHOUT_WORKDAY = [
  "Senior Software Engineer, Mutual of Omaha",
  "Built React front ends over a Kafka event pipeline, with MongoDB and Postgres behind it.",
  "Cut the nightly reconciliation window from six hours to forty minutes.",
].join("\n");

const MATERIAL_WITH_WORKDAY = `${MATERIAL_WITHOUT_WORKDAY}\nOwned the Workday integration for HR headcount reporting.`;

// The four bullets the live session actually produced. Every one of them
// names something that IS in the candidate's material — which is why a
// "does this point cite a source" check passes it, and why the honesty
// checks below have to be per-claim rather than per-point-sourcing.
const THE_ACTUAL_FAILING_ANSWER = [
  "I haven't directly designed Workday reports, but I have extensive experience with complex data challenges.",
  "Situation: At Mutual of Omaha the nightly reconciliation ran for six hours.",
  "Action: I built a React front end over a Kafka pipeline.",
  "Result: MongoDB and Postgres queries settled in forty minutes.",
];

// The shape the feature is supposed to produce: Workday is NAMED, as the
// subject, and every first-person past-tense verb attaches to something the
// candidate actually did. If a future implementation flags this, the feature
// has made the honest answer unreachable and the model's cheapest escape is
// to stop naming Workday at all — back to the original defect.
// Built so that a FAITHFUL implementation of AC-3.3's lexical screen can pass
// it honestly: no point carries both an unbacked role term AND a first-person
// construction. Point 0 names Workday and contains no first-person verb and no
// STAR label; the STAR points name only work the material supports; the
// "what they would need to pick up" clause names no role term. A control the
// feature could only satisfy by cheating would induce the cheat.
const THE_HONEST_FRAMING = [
  "Workday reporting is the closest thing here to the reconciliation reporting side of that role.",
  "Situation: At Mutual of Omaha the nightly reconciliation ran for six hours.",
  "Action: I built a React front end over a Kafka event pipeline.",
  "Result: The nightly window dropped to forty minutes, and the report writer is the piece to pick up.",
];

// The fabrication the feature must never be allowed to license: a first-person
// past-tense claim to a tool that appears nowhere in the material.
const THE_FABRICATION = [
  "Situation: The HR team needed a headcount report.",
  "Action: I designed the Workday reports using Report Writer.",
  "Result: Adoption rose by 30%.",
];

// A neutral filler sentence, measured to yield no taxonomy canonical at all,
// used to push a real term past the input cap.
const NEUTRAL_FILLER = "We reviewed the quarterly onboarding checklist with the team again and again. ";

function fillerLongerThanTheCap() {
  return NEUTRAL_FILLER.repeat(Math.ceil(MAX_QUESTION_CHARS / NEUTRAL_FILLER.length) + 1);
}

describe("roleTerms — the gate (design AC-1.1 to AC-1.4)", () => {
  it("returns the interviewer's own name for the system the question is about", () => {
    // AC-1.3/AC-1.4: measured — extractKeywords over the real taxonomy gives
    // tool_platform "Workday" (score 9, count 3). No posting is attached and
    // none is needed; the question alone carries the vocabulary.
    expect(roleTerms(WORKDAY_QUESTION)).toEqual(["Workday"]);
  });

  it("returns nothing at all for a content-free question", () => {
    // AC-1.2, and the reason revision 2's gate was thrown out: it fired on
    // every one of these. Measured: extractKeywords returns {} for the first
    // three, and `topic: ["tight deadline"]` for the fourth — an advisory
    // RAKE phrase, not a taxonomy term, so it is not a role term either.
    //
    // These four are not decoration. Three of them are the fixture questions
    // of the exact-key-set assertions at route.test.js:172-180, :453-461 and
    // route.knowledgeBase.test.js:561-569, so this case is also what says
    // those three assertions survive the change unedited.
    expect(roleTerms("Tell me about a time you failed.")).toEqual([]);
    expect(roleTerms("Tell me about yourself.")).toEqual([]);
    expect(roleTerms("How did you shard the ledger?")).toEqual([]);
    expect(roleTerms("Tell me about a time you handled a tight deadline.")).toEqual([]);
    // Positive control, so the four assertions above cannot be satisfied by a
    // function that returns [] for everything.
    expect(roleTerms(WORKDAY_QUESTION)).toEqual(["Workday"]);
  });

  it("never returns a canonical the question did not literally say", () => {
    // The recorded "team" -> "Microsoft Teams" mining hazard (answerLocal.js:
    // 213-221), applied to the question. Measured: this question extracts
    // ["Salesforce", "Tableau", "Business Intelligence"] — the third is a
    // taxonomy INFERENCE from "reporting", and telling a candidate to say
    // "Business Intelligence" back to an interviewer who never said it puts a
    // word in their mouth mid-interview. AC-1.1's literallyMentioned filter
    // is what drops it.
    expect(roleTerms("How do you use Salesforce and Tableau in your reporting work?")).toEqual([
      "Salesforce",
      "Tableau",
    ]);
  });

  it("drops a term whose canonical name differs from the interviewer's word", () => {
    // The same filter, in the direction that COSTS coverage: measured, this
    // question extracts technology "Apache Kafka", which the question never
    // said, so nothing survives. Pinned deliberately — the cheap "fix" is to
    // drop the literallyMentioned guard, which is exactly the guard the case
    // above exists for. Widening this must be done by aliasing in the
    // taxonomy, never by loosening the filter.
    expect(roleTerms("Tell me about a time you used Kafka.")).toEqual([]);
  });

  it("is pure and never throws on junk", () => {
    // AC-1.1. `question` is third-party input (route.js:358) and in live mode
    // it is machine-transcribed speech, so every one of these is reachable.
    for (const junk of [undefined, null, "", "   ", 12345, {}, [], NaN]) {
      expect(roleTerms(junk)).toEqual([]);
    }
    // Deterministic: the same question twice is the same array, and the
    // result is a fresh array each time (a shared, mutable cached array
    // handed to a caller is how one request's terms leak into the next).
    const first = roleTerms(WORKDAY_QUESTION);
    const second = roleTerms(WORKDAY_QUESTION);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe("roleTerms — untrusted, uncapped, machine-transcribed input (design §8.7, AC-4.1/AC-4.2)", () => {
  it("caps the question before deriving anything from it", () => {
    // AC-4.2. `question` is the only unbudgeted string on this path
    // (route.js:358 has no .slice(), unlike context/profile/resume/
    // coverLetter/posting) and the interviewer's speech is transcribed
    // straight into it. Measured against the real extractor: with the
    // Workday sentence pushed past the cap, nothing is derived from it.
    const head = fillerLongerThanTheCap();
    const termPastTheCap = `${head} Tell me about the Workday reports you designed.`;
    expect(termPastTheCap.length).toBeGreaterThan(MAX_QUESTION_CHARS);
    expect(roleTerms(termPastTheCap)).toEqual([]);
    // and the cap is the ONLY reason — the identical sentence inside the cap
    // still fires. Without this pair, the assertion above is satisfied by a
    // roleTerms that never returns anything.
    expect(roleTerms(`Tell me about the Workday reports you designed. ${head}`)).toEqual(["Workday"]);
    // Stated as the property rather than as a coincidence of this input: the
    // tail is not read at all.
    expect(roleTerms(termPastTheCap)).toEqual(roleTerms(termPastTheCap.slice(0, MAX_QUESTION_CHARS)));
  });

  it("keeps the cap below every other budget on this path", () => {
    // §8.7's actual argument: a 4,000-character question would otherwise sit
    // at position 0 of the prompt ahead of a 12,000-char knowledge base and a
    // 12,000-char résumé and dominate both. A spoken question is a sentence.
    // 4000 is the smallest existing budget on this route (MAX_CONTEXT_CHARS,
    // route.js:113), so the question's cap has to be under it.
    expect(Number.isInteger(MAX_QUESTION_CHARS)).toBe(true);
    expect(MAX_QUESTION_CHARS).toBeLessThan(4000);
    expect(MAX_QUESTION_CHARS).toBeGreaterThan(0);
  });

  it("caps how many terms it will hand forward", () => {
    // AC-4.2. Measured: this question yields exactly these eleven canonicals
    // after the literallyMentioned filter ("Postgres" -> canonical
    // "PostgreSQL" is dropped by it, which is the case above again).
    const ELEVEN = [
      "Java",
      "Python",
      "Docker",
      "Figma",
      "Jenkins",
      "Jira",
      "Kubernetes",
      "Salesforce",
      "Tableau",
      "Terraform",
      "Workday",
    ];
    const terms = roleTerms(
      "Tell me how you would use Python, Java, Docker, Kubernetes, Terraform, Jenkins, " +
        "Salesforce, Tableau, Figma, Jira, Workday, and Postgres together on one team.",
    );
    expect(MAX_ROLE_TERMS).toBe(10);
    expect(terms.length).toBe(MAX_ROLE_TERMS);
    // Closed: whichever ten survive, they are ten DISTINCT members of the
    // measured eleven and nothing else. The design does not fix which ten, so
    // this does not invent an ordering the implementation never promised.
    expect(terms.filter((t) => !ELEVEN.includes(t))).toEqual([]);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("does not pretend a mis-transcription is impossible", () => {
    // §8.7 claims "the taxonomy gate makes transcription noise unlikely to
    // produce a canonical". Measured, that is FALSE in the direction that
    // matters: a transcript that renders the spoken words "work day" as
    // "Workday" produces the canonical, and the gate opens on a question that
    // is not about Workday at all. Pinned so nobody re-reads §8.7 as a
    // guarantee.
    expect(roleTerms("How do you structure your Workday when three product managers all want something first?")).toEqual(
      ["Workday"],
    );
    // The other direction, for contrast: transcribed correctly, nothing fires.
    expect(roleTerms("Tell me about a typical work day for you.")).toEqual([]);
    // And the safety net is what makes the false term harmless: it still
    // cannot license a claim. A term the question supplied is not evidence.
    expect(
      unsupportedRoleTerms(["Action: I designed the Workday reports."], MATERIAL_WITHOUT_WORKDAY, ["Workday"]),
    ).toEqual(["Workday"]);
  });
});

describe("roleTerms — the gate's category boundary (item 5)", () => {
  // AC-1.1's gate used to run over EVERY BUZZWORD_CATEGORIES entry, including
  // `domain` (an industry) and `soft_skill` (a personal trait) — but
  // POINTS_SYSTEM's own instruction (answerPrompts.js) scopes itself to "a
  // system, tool, process, or standard", which neither category names. Both
  // directions are pinned here: the categories that stay in scope still
  // grant, and the two that do not are silent, even though extractKeywords
  // recognizes a canonical in each case (measured against the real taxonomy).
  it("still grants on a methodology term — in scope, per the instruction", () => {
    expect(roleTerms("How do you approach agile planning?")).toEqual(["Agile"]);
  });

  it("does not grant on a domain/industry term", () => {
    // Measured: extractKeywords recognizes "Healthcare" here as a `domain`
    // canonical — the taxonomy sees it, the gate must not.
    expect(roleTerms("Why do you want to work in healthcare?")).toEqual([]);
  });

  it("does not grant on a soft-skill term", () => {
    // Measured: extractKeywords recognizes "Mentoring" here as a
    // `soft_skill` canonical. An industry or a personal trait is not "a
    // system, tool, process, or standard the background does not cover" —
    // POINTS_SYSTEM's own words — so granting the shape instruction on either
    // is wider than the rule it exists to serve.
    expect(roleTerms("Describe your experience mentoring junior engineers.")).toEqual([]);
  });
});

describe("unsupportedRoleTerms (design AC-3.1, AC-3.2)", () => {
  it("returns the role terms the draft used that the material does not support", () => {
    // AC-3.2 stated exactly: question-derived terms get NO exemption. Both
    // come back, because the material contains neither.
    expect(
      unsupportedRoleTerms(THE_FABRICATION, MATERIAL_WITHOUT_WORKDAY, ["Workday", "Report Writer"]),
    ).toEqual(["Workday", "Report Writer"]);
  });

  it("folds a plural mismatch between the term and the material (item 6)", () => {
    // Measured: extractKeywords recognizes "CRM" (tool_platform, alias "crm
    // systems") in the question below, so roleTerms(...) is exactly ["CRM"].
    // The draft names it exactly; the candidate's own material pluralizes it
    // the way people actually write — "CRMs" — which literallyMentioned's
    // word-bounded exact match does not recognize as the same word. This is
    // the identical hazard postingBuzzwords.js's own header names for the
    // posting side ("the posting says CRM" vs "the question says CRMs"),
    // fixed here the same way: fold both sides and compare.
    expect(roleTerms("Describe your experience with CRM systems.")).toEqual(["CRM"]);
    const points = ["Action: I worked directly with our CRM to track every lead."];
    const material = "Managed CRMs across three regional offices, cleaning up duplicate records.";
    expect(unsupportedRoleTerms(points, material, ["CRM"])).toEqual([]);
    // Paired negative: with no plural (or singular) form of the term
    // anywhere in the material, it is still reported — the fold closes a
    // specific morphological gap, it does not stop checking altogether.
    expect(unsupportedRoleTerms(points, "Managed onboarding paperwork.", ["CRM"])).toEqual(["CRM"]);
  });

  it("returns nothing once the material actually backs the term", () => {
    // The paired negative. Same points, same terms, one line added to the
    // material — so the empty result is the material's doing, not a dead
    // function's.
    expect(unsupportedRoleTerms(THE_FABRICATION, MATERIAL_WITH_WORKDAY, ["Workday"])).toEqual([]);
  });

  it("only reports terms the draft actually used", () => {
    // A term the question raised and the answer never touched is not an
    // unbacked claim — it is a term the candidate correctly declined to use.
    expect(unsupportedRoleTerms(THE_FABRICATION, MATERIAL_WITHOUT_WORKDAY, ["Workday", "Tableau"])).toEqual([
      "Workday",
    ]);
  });

  it("is empty with no terms, no points, or junk", () => {
    expect(unsupportedRoleTerms(THE_FABRICATION, MATERIAL_WITHOUT_WORKDAY, [])).toEqual([]);
    expect(unsupportedRoleTerms([], MATERIAL_WITHOUT_WORKDAY, ["Workday"])).toEqual([]);
    expect(unsupportedRoleTerms(null, null, null)).toEqual([]);
    // Positive control against a dead function.
    expect(unsupportedRoleTerms(THE_FABRICATION, MATERIAL_WITHOUT_WORKDAY, ["Workday"])).toEqual(["Workday"]);
  });
});

describe("claimedWithoutBacking (design AC-3.3, AC-3.4)", () => {
  it("names the point that claims the tool, by index", () => {
    // AC-3.4: per point, not an answer-level boolean. Only index 1 carries
    // "I designed … Workday"; the situation and result points do not.
    expect(
      claimedWithoutBacking(THE_FABRICATION, { roleTerms: ["Workday"], material: MATERIAL_WITHOUT_WORKDAY }),
    ).toEqual([1]);
  });

  it("leaves the honest framing alone", () => {
    // THE CONTROL THAT MATTERS MOST. This draft names Workday twice — once as
    // the subject, once as the thing still to learn — and every first-person
    // past-tense verb in it attaches to work the material supports. If this
    // ever comes back non-empty, the feature has made the honest answer
    // unreachable, and the model's cheapest way out is to stop saying
    // "Workday", which is the original defect restored.
    expect(
      claimedWithoutBacking(THE_HONEST_FRAMING, { roleTerms: ["Workday"], material: MATERIAL_WITHOUT_WORKDAY }),
    ).toEqual([]);
  });

  it("leaves a claim the material backs alone", () => {
    expect(
      claimedWithoutBacking(THE_FABRICATION, { roleTerms: ["Workday"], material: MATERIAL_WITH_WORKDAY }),
    ).toEqual([]);
  });

  it("does not fire on the answer that actually shipped", () => {
    // Not a pass mark — a scoping statement. Every bullet of the observed
    // failure names Mutual of Omaha / React / Kafka / MongoDB, all present in
    // the material, so this check is silent on it. The defect there was the
    // hedge and the missing subject, which §4a's prompt text addresses and
    // this lexical check cannot see. Recorded so nobody reads a green
    // claimedWithoutBacking as "that answer would have been caught".
    expect(
      claimedWithoutBacking(THE_ACTUAL_FAILING_ANSWER, {
        roleTerms: ["Workday"],
        material: MATERIAL_WITHOUT_WORKDAY,
      }),
    ).toEqual([]);
  });

  it("is empty on junk and never throws", () => {
    expect(claimedWithoutBacking(null, null)).toEqual([]);
    expect(claimedWithoutBacking([], { roleTerms: ["Workday"], material: "" })).toEqual([]);
    expect(claimedWithoutBacking(THE_FABRICATION, { roleTerms: [], material: "" })).toEqual([]);
    // Positive control.
    expect(
      claimedWithoutBacking(THE_FABRICATION, { roleTerms: ["Workday"], material: MATERIAL_WITHOUT_WORKDAY }),
    ).toEqual([1]);
  });
});

describe("claimedWithoutBacking does not flag an honest hedge (item 4)", () => {
  // MEASURED FALSE POSITIVES against the pre-fix condition (b): "the point
  // carries a STAR label AND contains a bare first-person 'I' anywhere in
  // it" fired on all three of these, even though each one is a candidate
  // explicitly saying they have NOT done the thing — the opposite of the
  // fabrication shape this check exists to catch. The module's own header
  // (questionVocabulary.js) says this collapse must never happen; these three
  // are the fixtures that prove it does not, each isolated in its own single-
  // point array so the STAR label and the "I" are the only things that could
  // make it fire.
  it("leaves a negated construction alone", () => {
    expect(
      claimedWithoutBacking(
        ["Situation: I have not built a Workday report, but the reconciliation reporting is the closest thing."],
        { roleTerms: ["Workday"], material: MATERIAL_WITHOUT_WORKDAY },
      ),
    ).toEqual([]);
  });

  it("leaves a hypothetical future need alone", () => {
    expect(
      claimedWithoutBacking(["Result: I would need a few weeks on Workday to be productive."], {
        roleTerms: ["Workday"],
        material: MATERIAL_WITHOUT_WORKDAY,
      }),
    ).toEqual([]);
  });

  it("leaves an explicit disclaimer of the experience alone", () => {
    expect(
      claimedWithoutBacking(["Action: I am comfortable saying Workday is new to me."], {
        roleTerms: ["Workday"],
        material: MATERIAL_WITHOUT_WORKDAY,
      }),
    ).toEqual([]);
  });

  it("still flags the fabrication these hedges are not — positive control", () => {
    // Without this, the three empty-array assertions above are satisfied by
    // a check that flags nothing at all.
    expect(
      claimedWithoutBacking(THE_FABRICATION, { roleTerms: ["Workday"], material: MATERIAL_WITHOUT_WORKDAY }),
    ).toEqual([1]);
  });
});

describe("the two checks are not the same check (design §5c)", () => {
  it("separates 'the draft used an unbacked term' from 'the draft claimed it'", () => {
    // The honest framing DOES use an unbacked term — it names Workday, which
    // is the entire point of the feature — so unsupportedRoleTerms reports it
    // and claimedWithoutBacking does not. Collapsing the two (either by
    // making the flag per-claim or by making the per-claim check term-
    // presence) destroys one of them; this is the case that says so.
    expect(unsupportedRoleTerms(THE_HONEST_FRAMING, MATERIAL_WITHOUT_WORKDAY, ["Workday"])).toEqual(["Workday"]);
    expect(
      claimedWithoutBacking(THE_HONEST_FRAMING, { roleTerms: ["Workday"], material: MATERIAL_WITHOUT_WORKDAY }),
    ).toEqual([]);
    // And on the fabrication both fire — so the split above is a real
    // distinction between two live checks, not one dead one.
    expect(unsupportedRoleTerms(THE_FABRICATION, MATERIAL_WITHOUT_WORKDAY, ["Workday"])).toEqual(["Workday"]);
    expect(
      claimedWithoutBacking(THE_FABRICATION, { roleTerms: ["Workday"], material: MATERIAL_WITHOUT_WORKDAY }),
    ).toEqual([1]);
  });
});
