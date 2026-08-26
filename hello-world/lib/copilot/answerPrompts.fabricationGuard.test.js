// TDD, written BEFORE the system-instruction change exists. Every case in
// this file is RED today, on purpose.
//
// WHY SOURCE-TEXT ASSERTIONS ARE THE RIGHT FORM HERE. Normally a test asserts
// behaviour, not text. These do not, because the thing being protected IS the
// text: `POINTS_SYSTEM` and `ANSWER_SYSTEM` are handed straight to
// `config.systemInstruction`, and the design's own diagnosis is that the
// closing clause of POINTS_SYSTEM ("if it is thin, give strong generic points
// instead") is a near-verbatim description of the answer the live session
// produced. This repo has already recorded the same lesson once, at
// answerPrompts.js:146-150 (AC-V4.4): a general "don't invent" instruction
// did not stop the model writing "my research indicates", and naming the
// exact bad phrasing is "the difference between a rule and a hope".
//
// AND WHY THE COVER IS THIN WITHOUT THEM. Nothing pins either constant's
// CONTENT today: answerPrompts.test.js:116-131 checks only `typeof`,
// `toContain("glance")`, `toContain("complete sentences")` and
// `` toContain("`cues`") ``; route.latency.test.js:149-150 checks only that
// they are non-empty strings. A system-instruction regression is currently
// invisible, and a system instruction is UNCONDITIONAL — no gate, no grant
// branch, and no byte-identity fixture covers it, because the frozen fixtures
// freeze the USER prompt each builder returns, not `config.systemInstruction`.
//
// THE THREE INSTRUCTIONS THIS FILE EXISTS TO KEEP OUT. Three separate drafts
// of this feature proposed prompt text that licenses fabrication. Each was
// rejected against source, and each is cheap to re-propose, because each
// reads as helpful:
//
//   1. "Using one of the interviewer's terms is never a claim to have used
//      it." FALSE where it matters. ANSWER_SYSTEM:54 requires "each point is
//      one complete, natural spoken sentence, first person" and
//      POINTS_SYSTEM:42 requires STAR labels — so inside "Action: I designed
//      the Workday reports", naming the tool IS claiming it. Offered as the
//      counterweight to the invitation risk, it was the invitation's ally.
//
//   2. "Never open the answer with what they have not done." It constrains
//      POSITION and says nothing about TRUTH, so the cheapest compliance is
//      to drop the hedge and assert the experience.
//
//   3. An acceptance criterion of "the first point contains 'Workday' and
//      does not begin with a negation" — satisfiable, given a candidate with
//      no Workday experience, only by lying.
//
// Each guard below is a detector plus a SELF-TEST: the detector is run
// against the exact rejected sentence and must report a violation there. A
// detector that has never been shown to fire is not evidence of anything.

import { describe, it, expect } from "vitest";
import { POINTS_SYSTEM, ANSWER_SYSTEM, buildPointsPrompt, buildAnswerPrompt } from "./answerPrompts.js";
import { interviewType } from "./interviewTypes.js";
import { roleTerms, MAX_QUESTION_CHARS } from "./questionVocabulary.js";

const GENERAL = interviewType("general");

// The exact rejected sentences, quoted from the design's changelog and §4a.
const REJECTED_LICENCE = "Using one of the interviewer's terms is never a claim to have used it.";
const REJECTED_POSITION_RULE = "Never open the answer with what they have not done.";
const REJECTED_MANDATE = "The first point must contain the interviewer's term and must not begin with a negation.";

// Measured against the real extractor before this file was written:
// tool_platform "Workday" (score 9, count 3), so roleTerms() is non-empty and
// the §4b instruction is granted.
const WORKDAY_QUESTION =
  "Can you describe a particularly complex Workday report you designed? " +
  "What was the business challenge it addressed, and which Workday tools did you use to build it? " +
  "How do you ensure data accuracy and compliance with security standards when building custom Workday reports, " +
  "especially when the work involves managing sensitive HR information?";

// --- guard 1: the licensing sentence ---------------------------------------
//
// The shape being banned is "naming/using a term is not a claim". Anchored on
// claim-language plus a negation, which is what makes the sentence a licence;
// it does NOT match §4a's approved second register ("...it is never EVIDENCE
// that they have done it"), which restricts rather than licenses.
const LICENCE_PATTERNS = [
  /\bnever a claim to have\b/i,
  /\b(?:is|are)(?: not|n'?t) (?:a )?claims? to have\b/i,
  /\b(?:using|naming|saying|repeating|borrowing|echoing)\b[^.]{0,90}\b(?:carries no claim|implies no claim|makes no claim|is not a claim|isn'?t a claim|never a claim)\b/i,
  /\b(?:does not|doesn'?t|never) (?:mean|imply|assert)\b[^.]{0,70}\b(?:has|have) (?:used|done|operated|built|run)\b/i,
];

function licenceViolations(text) {
  return LICENCE_PATTERNS.filter((pattern) => pattern.test(String(text))).map((p) => p.source);
}

// --- guard 2: a position rule with no truth condition -----------------------
const POSITION_RULE = /\b(?:never|do not|don'?t|avoid)\b[^.]{0,45}\b(?:open|begin|start|lead)(?:ing)?\b/i;
// §4a's replacement: the clause that constrains TRUTH rather than position.
const TRUTH_CONDITION =
  /\bnever (?:state or imply|state|claim|assert|suggest)\b[^.]{0,150}\b(?:does not support|doesn'?t support|is not supported)\b/i;

function positionRuleWithoutTruthCondition(text) {
  const s = String(text);
  return POSITION_RULE.test(s) && !TRUTH_CONDITION.test(s);
}

// --- guard 3: a mandate to name the term regardless of truth -----------------
const MANDATE_PATTERNS = [
  /\b(?:first|opening|lead|leading)\s+(?:point|bullet|sentence|line|answer)\b[^.]{0,90}\bmust\b[^.]{0,90}\b(?:contain|include|name|mention|use)\b/i,
  /\bmust\s+(?:contain|include|name|mention|use)\b[^.]{0,70}\b(?:the interviewer'?s|the question'?s)\b/i,
  /\b(?:does not|must not|never|do not|don'?t)\s+(?:begin|open|start)\b[^.]{0,45}\bwith a negation\b/i,
  /\balways (?:begin|open|start|lead)\s+(?:with|by naming)\b/i,
];

function mandateViolations(text) {
  return MANDATE_PATTERNS.filter((pattern) => pattern.test(String(text))).map((p) => p.source);
}

// Everything the model is instructed by, on both modes, in the granted state
// — the state where the pressure to fabricate is highest. A rejected
// instruction is just as dangerous in a gated user prompt as in a system
// instruction, so all four are swept.
function everyInstructionSurface() {
  return {
    POINTS_SYSTEM,
    ANSWER_SYSTEM,
    "buildPointsPrompt (granted)": buildPointsPrompt(WORKDAY_QUESTION, "", "", GENERAL, "", "", ""),
    "buildAnswerPrompt (granted)": buildAnswerPrompt({
      question: WORKDAY_QUESTION,
      context: "",
      profile: "",
      resume: "",
      coverLetter: "",
      descriptor: GENERAL,
      pagesBlock: "",
    }),
  };
}

describe("guard 1 — no instruction may say that using the interviewer's term is not a claim", () => {
  it("fires on the exact sentence that was rejected", () => {
    // The self-test. Without it, the sweep below is satisfied by four
    // patterns that match nothing at all.
    expect(licenceViolations(REJECTED_LICENCE).length).toBeGreaterThan(0);
    expect(licenceViolations("Naming a tool the interviewer named makes no claim about the candidate.").length)
      .toBeGreaterThan(0);
    expect(licenceViolations("Echoing their vocabulary is not a claim to have used the system.").length)
      .toBeGreaterThan(0);
    // And it does NOT fire on §4a's approved second register, which says the
    // opposite thing — otherwise this guard would block the fix.
    expect(
      licenceViolations(
        "The question's wording may be used to NAME the subject and to frame what the candidate has actually done; " +
          "it is never evidence that they have done it.",
      ),
    ).toEqual([]);
  });

  it("is absent from every instruction surface, in the granted state", () => {
    for (const [name, text] of Object.entries(everyInstructionSurface())) {
      expect({ [name]: licenceViolations(text) }).toEqual({ [name]: [] });
      // THE MUTATION, RUN IN PLACE. An assertion of absence is satisfied by a
      // detector that matches nothing, so each surface is also checked with
      // the rejected sentence appended to the REAL text: the sweep must find
      // it there. Without this, the line above is a sweep whose ability to
      // fire has only ever been shown on a synthetic string.
      expect(licenceViolations(`${text} ${REJECTED_LICENCE}`).length).toBeGreaterThan(0);
    }
  });
});

describe("guard 2 — a rule about where the answer opens must come with a rule about what is true", () => {
  it("fires on the position-only sentence that was rejected", () => {
    expect(positionRuleWithoutTruthCondition(REJECTED_POSITION_RULE)).toBe(true);
    // And clears once the truth condition is attached — so it is testing for
    // the missing half, not merely for the word "open".
    expect(
      positionRuleWithoutTruthCondition(
        `${REJECTED_POSITION_RULE} Never state or imply that the candidate performed work the background does not support.`,
      ),
    ).toBe(false);
  });

  it("holds on both system instructions", () => {
    expect(positionRuleWithoutTruthCondition(POINTS_SYSTEM)).toBe(false);
    expect(positionRuleWithoutTruthCondition(ANSWER_SYSTEM)).toBe(false);
    // The mutation, run in place against the real text: strip the truth
    // condition out of POINTS_SYSTEM and the guard must fire. If it does not,
    // the two assertions above were passing because POINTS_SYSTEM contains no
    // position rule at all — which is a different, weaker fact than the one
    // this describe claims.
    expect(positionRuleWithoutTruthCondition(POINTS_SYSTEM.replace(TRUTH_CONDITION, ""))).toBe(true);
  });

  // ITEM 8 OF THE ADVERSARIAL REVIEW: `positionRuleWithoutTruthCondition
  // (ANSWER_SYSTEM) === false`, above, was VACUOUSLY true — ANSWER_SYSTEM
  // contains no position rule at all (it never tells the model where to open;
  // that constraint lives only in POINTS_SYSTEM), so POSITION_RULE never
  // matches it and the guard returns false regardless of whether a truth
  // condition is present. POINTS_SYSTEM's own case above proves the detector
  // fires by STRIPPING real text that is there; ANSWER_SYSTEM has nothing
  // equivalent to strip, so the same proof has to run by ADDING instead: the
  // rejected position-only sentence, with and without a truth condition
  // riding along, appended to the real ANSWER_SYSTEM text.
  it("would catch a position rule on ANSWER_SYSTEM too, if one were ever added without a truth condition", () => {
    expect(positionRuleWithoutTruthCondition(`${ANSWER_SYSTEM} ${REJECTED_POSITION_RULE}`)).toBe(true);
    expect(
      positionRuleWithoutTruthCondition(
        `${ANSWER_SYSTEM} ${REJECTED_POSITION_RULE} Never state or imply that the candidate performed work the background does not support.`,
      ),
    ).toBe(false);
  });
});

describe("guard 3 — nothing may mandate naming the term regardless of whether it is true", () => {
  it("fires on the acceptance criterion that was rejected", () => {
    expect(mandateViolations(REJECTED_MANDATE).length).toBeGreaterThan(0);
    expect(mandateViolations("The first point must contain the system the question names.").length).toBeGreaterThan(0);
    expect(mandateViolations("Always begin with the interviewer's own term.").length).toBeGreaterThan(0);
    // Not fired by §4a's approved text, which names the banned openings
    // rather than mandating a required one.
    expect(
      mandateViolations(
        'Do not answer such a question with generic points, and do not open with what the candidate has not done — ' +
          'never begin with "I haven\'t directly", "While I haven\'t", "I have not personally", "Although I lack", or any equivalent.',
      ),
    ).toEqual([]);
    // Nor by §4b's gated shape instruction.
    expect(
      mandateViolations(
        "Lead with the role-relevant capability in the interviewer's own terms; substantiate it with the candidate's " +
          "specific evidence in the points that follow.",
      ),
    ).toEqual([]);
  });

  it("is absent from every instruction surface, in the granted state", () => {
    for (const [name, text] of Object.entries(everyInstructionSurface())) {
      expect({ [name]: mandateViolations(text) }).toEqual({ [name]: [] });
      // The same in-place mutation as guard 1: the sweep must fire when the
      // rejected mandate is appended to the real text.
      expect(mandateViolations(`${text} ${REJECTED_MANDATE}`).length).toBeGreaterThan(0);
    }
  });
});

describe("POINTS_SYSTEM — the clause that produced the observed answer (design AC-2.1)", () => {
  it("no longer tells the model to fall back to generic points", () => {
    // The root cause, quoted from answerPrompts.js:41. Given a Workday
    // question and zero Workday material, "give strong generic points
    // instead" is exactly what the model did — four bullets about Mutual of
    // Omaha, React, Kafka and MongoDB, and no Workday term anywhere.
    expect(POINTS_SYSTEM).not.toContain("if it is thin, give strong generic points instead");
    expect(POINTS_SYSTEM).toContain("Do not answer such a question with generic points");
  });

  it("names the exact openings that were produced, not merely a general rule", () => {
    // AC-V4.4's precedent, applied. The live session opened with "I haven't
    // directly designed Workday reports, but…"; a general instruction not to
    // hedge is what already failed.
    for (const phrasing of ["I haven't directly", "While I haven't", "I have not personally", "Although I lack"]) {
      expect(POINTS_SYSTEM).toContain(phrasing);
    }
  });

  it("pairs the named phrasings with a condition on truth", () => {
    // Without this clause the rule is guard 2's rejected instruction wearing
    // a longer list: the cheapest way to avoid every named opening is to drop
    // the hedge and assert the experience.
    expect(POINTS_SYSTEM).toContain(
      "Never state or imply that the candidate performed work the background does not support",
    );
  });

  it("says what to do INSTEAD — frame the closest real experience in the interviewer's words", () => {
    // A ban with no alternative leaves the model to invent one. The positive
    // half of §4a: use their name for the subject, frame what the candidate
    // HAS done, and say in one clause what they would need to pick up.
    expect(POINTS_SYSTEM).toContain("use the interviewer's own name for it");
    expect(POINTS_SYSTEM).toContain("what they would need to pick up");
  });

  it("keeps the guarantees it already had", () => {
    // The edit is to one clause, not to the instruction. If the STAR rule or
    // the glanceability rule went missing in the rewrite, the two modes stop
    // being distinct and answerPrompts.test.js:120-134 is the only other
    // thing that would notice.
    expect(POINTS_SYSTEM).toContain("glance");
    expect(POINTS_SYSTEM).toContain('"Situation:", "Task:", "Action:", "Result:"');
    expect(POINTS_SYSTEM).toContain("Never fabricate experience the background does not support");
  });
});

describe("ANSWER_SYSTEM — the closed authority list that excluded the question (design AC-2.2)", () => {
  it("no longer restricts every claim to a list the question is not on", () => {
    // answerPrompts.js:53 today. The question was already at character 0 of
    // the prompt; this sentence is what said its words were off-limits.
    expect(ANSWER_SYSTEM).not.toContain("The answer must be built only from the material provided below");
  });

  it("splits into two registers — evidence, and vocabulary", () => {
    // Register one: experience claims come only from the material, and
    // explicitly NOT from the question. This is the half that must never be
    // weakened, and it is stated more strictly than the sentence it replaces.
    expect(ANSWER_SYSTEM).toContain("must come only from the material provided below, and never from the question");
    // Register two: the question's words may NAME the subject. Note what it
    // does not say — it does not say that naming is safe, it says the
    // question is not evidence. Guard 1 is what keeps the difference.
    expect(ANSWER_SYSTEM).toContain("may be used to NAME the subject");
    expect(ANSWER_SYSTEM).toContain("it is never evidence that they have done it");
  });

  it("keeps the guarantees it already had", () => {
    expect(ANSWER_SYSTEM).toContain("complete sentences");
    expect(ANSWER_SYSTEM).toContain("`cues`");
    expect(ANSWER_SYSTEM).toContain('"Situation:", "Task:", "Action:", "Result:"');
  });
});

// --- the byte-identity claim, and the gate that is supposed to guarantee it --
//
// REVISION 3 claims both frozen fixtures survive the change "structurally",
// because their question is "Tell me about yourself." and it yields no terms.
// That is a claim about the real extractor, so it is checked against the real
// extractor here rather than asserted.
//
// These two constants are a SECOND, independent copy of
// answerPrompts.test.js:84-110. Deliberately: two independent oracles of one
// immutable fact. A deliberate descriptor or builder change must be recorded
// in both files, and a change made in only one turns the other red — which is
// the intended friction, since "byte-identical to what it produced before
// those sources existed" is exactly the kind of guarantee that erodes when
// one file is the only witness.
const FROZEN_POINTS_PROMPT_NO_PAGES = [
  'The interviewer asked: "Tell me about yourself."',
  "",
  "--- INTERVIEW FORMAT ---",
  "This is a General / mixed interview. This is a general interview: a mix of behavioral, technical, and role-fit questions with no single format assumed. Vary the question style rather than committing to one, and keep each question answerable in a couple of minutes of spoken response.",
  "Emphasize: clear communication, relevant experience, concrete examples.",
  "",
  'Return ONLY JSON of this exact shape: { "points": string[], "type": "behavioral" | "technical" | "general" }',
  "points: 3-5 concise talking points as described above.",
].join("\n");

const FROZEN_ANSWER_PROMPT_NO_PAGES = [
  'The interviewer asked: "Tell me about yourself."',
  "",
  "--- INTERVIEW FORMAT ---",
  "This is a General / mixed interview. This is a general interview: a mix of behavioral, technical, and role-fit questions with no single format assumed. Vary the question style rather than committing to one, and keep each question answerable in a couple of minutes of spoken response.",
  "Emphasize: clear communication, relevant experience, concrete examples.",
  "",
  "No submitted resume or cover letter was available for this application — build the answer from the candidate prep notes and conversation context alone.",
  "",
  "Write the actual spoken answer the candidate should give, as 3-6 points — each one a complete, speakable sentence, not a fragment — together totalling roughly 80-220 words.",
  "Each point is first person, spoken register — no bullet markers beyond the STAR label where it applies, no headings, no stage directions, nothing but words meant to be said out loud.",
  "Shape it as a STAR narrative: briefly set the situation and task, describe the actions the candidate personally took, and close with the result.",
  "Every claim must come from the CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER above — select, order, and phrase freely, but never invent an employer, project, metric, or credential that isn't there. If the material is thin, give a shorter, honest answer rather than inventing detail.",
  'Return ONLY JSON of this exact shape: { "points": string[], "cues": string[], "type": "behavioral" | "technical" | "general" }',
  "cues: exactly one per point, same order — a 2-6 word prompt for that point, with the same STAR label where the point has one.",
].join("\n");

const LEAD_INSTRUCTION = "Lead with the role-relevant capability in the interviewer's own terms";

function frozenPointsCall() {
  return buildPointsPrompt("Tell me about yourself.", "", "", GENERAL, "", "", "");
}

function frozenAnswerCall() {
  return buildAnswerPrompt({
    question: "Tell me about yourself.",
    context: "",
    profile: "",
    resume: "",
    coverLetter: "",
    descriptor: GENERAL,
    pagesBlock: "",
  });
}

describe("the user-prompt half is gated, and the frozen fixtures survive (design AC-1.5, AC-2.3)", () => {
  it("is the extractor, not an assumption, that keeps the fixtures frozen", () => {
    // The mechanism REVISION 3 asserts. If a later change widens the gate —
    // pulling in the advisory RAKE `topic` tier, say, which for other
    // questions returns phrases like "tight deadline" — this goes red before
    // the byte-identity assertions do, and says why.
    expect(roleTerms("Tell me about yourself.")).toEqual([]);
  });

  it("leaves buildPointsPrompt byte-for-byte identical for the frozen input", () => {
    expect(frozenPointsCall()).toBe(FROZEN_POINTS_PROMPT_NO_PAGES);
  });

  it("leaves buildAnswerPrompt byte-for-byte identical for the frozen input", () => {
    expect(frozenAnswerCall()).toBe(FROZEN_ANSWER_PROMPT_NO_PAGES);
  });

  it("grants the shape instruction when the question actually names a system", () => {
    // The positive control the two byte-identity cases need. Without it they
    // are satisfied by a feature that was never built: an unbuilt gate is
    // byte-identical for every input.
    const granted = buildPointsPrompt(WORKDAY_QUESTION, "", "", GENERAL, "", "", "");
    expect(granted).toContain(LEAD_INSTRUCTION);
    expect(frozenPointsCall()).not.toContain(LEAD_INSTRUCTION);
  });

  it("grants it in answer mode too, with the authority sentence split", () => {
    const granted = buildAnswerPrompt({
      question: WORKDAY_QUESTION,
      context: "",
      profile: "",
      resume: "",
      coverLetter: "",
      descriptor: GENERAL,
      pagesBlock: "",
    });
    expect(granted).toContain(LEAD_INSTRUCTION);
    // §4b: buildAnswerPrompt additionally splits answerPrompts.js:315 into
    // §4a's two registers — but only in the granted state, which is why the
    // frozen fixture above still carries :315 unchanged.
    expect(granted).toContain("never from the question");
    expect(frozenAnswerCall()).not.toContain(LEAD_INSTRUCTION);
    expect(frozenAnswerCall()).not.toContain("never from the question");
  });

  it("stays silent on a question whose only extracted term is an advisory topic phrase", () => {
    // "Tell me about a time you handled a tight deadline." extracts
    // `topic: ["tight deadline"]` and nothing in any taxonomy category —
    // measured. A RAKE phrase is not a term of art, and it is also the
    // fixture question of route.test.js:153, so a gate that opened here
    // would move a response shape three test files pin.
    expect(buildPointsPrompt("Tell me about a time you handled a tight deadline.", "", "", GENERAL, "", "", "")).not.toContain(
      LEAD_INSTRUCTION,
    );
    // Paired, in the same case, with the input that must grant.
    expect(buildPointsPrompt(WORKDAY_QUESTION, "", "", GENERAL, "", "", "")).toContain(LEAD_INSTRUCTION);
  });

  it("does not grant on a term the caller buried past the question cap", () => {
    // `question` is machine-transcribed, third-party and — at route.js:358 —
    // the only unbudgeted string on this path. A 20,000-character question
    // whose only term of art sits at the end must not reach into the prompt
    // through the gate.
    const sentence = "We reviewed the quarterly onboarding checklist with the team again and again. ";
    const filler = sentence.repeat(Math.ceil(MAX_QUESTION_CHARS / sentence.length) + 1);
    expect(filler.length).toBeGreaterThan(MAX_QUESTION_CHARS);
    expect(buildPointsPrompt(`${filler} Tell me about the Workday reports you designed.`, "", "", GENERAL, "", "", ""))
      .not.toContain(LEAD_INSTRUCTION);
    // Paired: the same sentence inside the cap does grant, so the assertion
    // above is the cap's doing and not the filler's.
    expect(buildPointsPrompt(`Tell me about the Workday reports you designed. ${filler}`, "", "", GENERAL, "", "", ""))
      .toContain(LEAD_INSTRUCTION);
  });

  it("still takes no posting parameter (AC-6.4)", () => {
    // answerPrompts.test.js:196 pins this too. Repeated here because the
    // MVP's whole claim to a small blast radius is that it adds no parameter
    // and never goes near the posting description (AC-H7.27) — the gate is
    // the question, which the builder already holds.
    expect(buildPointsPrompt.length).toBe(7);
  });
});
