// N134 — the "answer the question that was asked" directive in POINTS_SYSTEM
// and ANSWER_SYSTEM (docs/loop/N134.design.r1.md section 3, AC-N134-1..4 and
// AC-N134-8).
//
// WHY SOURCE-TEXT ASSERTIONS HERE, AND WHAT THEY CANNOT PROVE. Same reason as
// answerPrompts.fabricationGuard.test.js: the thing protected IS the text, a
// system instruction handed straight to `config.systemInstruction`. What this
// file proves is that the wording landed, landed once, landed in the right
// slot, kept its behavioral carve-out and its truth tie, and did not trip a
// guard. It does NOT prove the model now answers directly — that is
// AC-N134-10, an owner probe against a real Gemini key, not decidable here.
//
// WHY THE TRUTH-TIE SENTENCE IS PINNED DIRECTLY. The directive mandates where
// an answer starts, so it must carry a rule about what is true (the lesson of
// the fabrication guard's rejected position-only rule). The guard suite's
// detectors are all NEGATIVE-phrased — they match "never/do not ... open" — so
// a positive-phrased directive passes them trivially, and they cannot see the
// sentence that makes this directive safe. If someone deletes that sentence,
// every existing guard stays green; only the assertions here go red.
//
// THE DETECTORS BELOW ARE A MIRROR, NOT AN IMPORT. They are local to
// answerPrompts.fabricationGuard.test.js and not exported (and must stay that
// way), so this file carries its own copies of the exact regexes in order to
// run the same checks against MUTATED strings. A copy can drift, so the last
// describe reads the guard file's source and fails if any mirrored regex is no
// longer in it verbatim.
//
// MUTATION CONTROLS ARE RUN IN PLACE, in memory, on the real constants: each
// takes the real text, breaks one property, and expects the checker to name
// that property. The unmodified text is the no-op control and must report
// nothing. No source file is edited to prove a test can fail.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POINTS_SYSTEM, ANSWER_SYSTEM } from "./answerPrompts.js";

// --- mirrored detectors (see header; drift-checked in the last describe) ----
const LICENCE_PATTERNS = [
  /\bnever a claim to have\b/i,
  /\b(?:is|are)(?: not|n'?t) (?:a )?claims? to have\b/i,
  /\b(?:using|naming|saying|repeating|borrowing|echoing)\b[^.]{0,90}\b(?:carries no claim|implies no claim|makes no claim|is not a claim|isn'?t a claim|never a claim)\b/i,
  /\b(?:does not|doesn'?t|never) (?:mean|imply|assert)\b[^.]{0,70}\b(?:has|have) (?:used|done|operated|built|run)\b/i,
];
const POSITION_RULE = /\b(?:never|do not|don'?t|avoid)\b[^.]{0,45}\b(?:open|begin|start|lead)(?:ing)?\b/i;
const TRUTH_CONDITION =
  /\bnever (?:state or imply|state|claim|assert|suggest)\b[^.]{0,150}\b(?:does not support|doesn'?t support|is not supported)\b/i;
const MANDATE_PATTERNS = [
  /\b(?:first|opening|lead|leading)\s+(?:point|bullet|sentence|line|answer)\b[^.]{0,90}\bmust\b[^.]{0,90}\b(?:contain|include|name|mention|use)\b/i,
  /\bmust\s+(?:contain|include|name|mention|use)\b[^.]{0,70}\b(?:the interviewer'?s|the question'?s)\b/i,
  /\b(?:does not|must not|never|do not|don'?t)\s+(?:begin|open|start)\b[^.]{0,45}\bwith a negation\b/i,
  /\balways (?:begin|open|start|lead)\s+(?:with|by naming)\b/i,
];

// The sentences the guard suite already rejects, quoted from its own file, so
// the mirrored detectors can be shown to fire here too.
const REJECTED_LICENCE = "Using one of the interviewer's terms is never a claim to have used it.";
const REJECTED_POSITION_RULE = "Never open the answer with what they have not done.";
const REJECTED_MANDATE = "The first point must contain the interviewer's term and must not begin with a negation.";

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function truthConditionCount(text) {
  return (text.match(new RegExp(TRUTH_CONDITION.source, "gi")) ?? []).length;
}

function countOf(text, needle) {
  return text.split(needle).length - 1;
}

// --- the ruled text, authored from the design (section 3), not from the code -
const HEAD = "Answer the question that was asked.";
const EXEMPTION =
  'Unless the question asks for a specific past experience — a "tell me about a time..." or other behavioral question, covered next —';
// The existing STAR sentence both constants carry; the directive sits directly
// before it, and its lead-in marks where the directive's span ends.
const STAR_LEAD = 'For behavioral questions ("tell me about a time...")';
const STAR_SENTENCE = `${STAR_LEAD}, prefix each point with its STAR label — "Situation:", "Task:", "Action:", "Result:".`;

const POINTS = {
  text: POINTS_SYSTEM,
  firstSlot: "make the FIRST point the direct answer itself",
  support:
    "Use the remaining points to support that answer with the candidate's real experience from the background, rather than narrating a past project as though the story were the answer.",
  precedence: null,
  truthTie:
    "Leading with the answer changes nothing about what may be claimed: what the candidate has actually done still comes only from the background.",
  // The marker the directive must come AFTER, and the sentence it must sit
  // directly against on that side (its own array element, not merged into one).
  after: "Never fabricate experience the background does not support",
  precededBy: "Never state or imply that the candidate performed work the background does not support. ",
  // Existing text that must survive the insertion untouched.
  neighbours: [
    "ground the points in it — reference their real companies, projects, metrics, and skills rather than inventing generic ones",
    'For a "tell me about a time..." question, prefer a concrete story from YOUR OWN PROJECT PAGES when one is provided',
    "Never fabricate experience the background does not support.",
    STAR_SENTENCE,
    "Keep every point skimmable — a person on camera must absorb it in a glance.",
  ],
  // POINTS_SYSTEM's grounding paragraph already holds exactly one
  // TRUTH_CONDITION match; the guard suite strips the first and expects the
  // detector to fire, so a second one would turn that test red.
  truthConditionMatches: 1,
};

const ANSWER = {
  text: ANSWER_SYSTEM,
  firstSlot: "the first sentence is the direct answer itself",
  support:
    "The sentences after it support that answer with the candidate's real experience from the material provided below, rather than narrating a past project as though the story were the answer.",
  precedence:
    "If the prompt's format or shape instruction calls for a STAR narrative, apply that to a question that asks for a specific past experience; for any other question a brief example is one supporting sentence, never the whole answer.",
  truthTie:
    "Leading with the answer changes nothing about what may be claimed: what the candidate has done still comes only from the material provided below, and never from the question.",
  after: "Return 3-6 points",
  precededBy: "nothing that isn't meant to be spoken aloud. ",
  neighbours: [
    "Every claim about the candidate's own experience — an employer, a project, a metric, a credential, a tool they operated — must come only from the material provided below, and never from the question.",
    "it is never evidence that they have done it.",
    STAR_SENTENCE,
    "Also return `cues`: exactly one per point, in the same order",
  ],
  // ANSWER_SYSTEM must hold NO TRUTH_CONDITION match: the guard suite appends a
  // rejected position rule to the real text and expects the detector to fire.
  truthConditionMatches: 0,
};

// The directive's own span: from its opening sentence to just before the STAR
// element. With no STAR element after it (the element was moved), it runs to
// the end of the text, so a misplaced directive still reports a span.
function directiveSpan(text) {
  const start = text.indexOf(HEAD);
  if (start < 0) return "";
  const end = text.indexOf(STAR_LEAD, start);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

const PROP = {
  ONCE: "the directive is present exactly once",
  EXEMPTION: "the behavioral carve-out clause opens the directive",
  FIRST_SLOT: "the first point/sentence is the direct answer",
  SUPPORT: "the remaining points/sentences support the answer with real experience",
  PRECEDENCE: "a STAR shape instruction applies only to a past-experience question",
  TRUTH_TIE: "the truth-tie sentence closes the directive",
  ORDER: "it sits after the grounding element and before the STAR element",
  OWN_ELEMENT: "it is its own element, directly between its two neighbours",
  NEIGHBOURS: "the existing grounding, story, STAR and cues text is intact",
  TRUTH_COUNT: "the TRUTH_CONDITION match count is unchanged",
  POSITION: "the directive holds no negative position rule",
  MANDATE: "no always-lead/open/begin or must-contain mandate",
  LICENCE: "no licence that naming a term is not a claim",
  IDEAL: "no ideal-project / worked-example content",
};

// Returns the names of the properties that FAIL. [] means the text is a sound
// carrier of the directive; the mutation controls assert a specific name here.
function directAnswerFailures(spec, text) {
  const span = directiveSpan(text);
  const failures = [];
  if (countOf(text, HEAD) !== 1 || countOf(text, spec.firstSlot) !== 1) failures.push(PROP.ONCE);
  if (!span.startsWith(`${HEAD} ${EXEMPTION}`)) failures.push(PROP.EXEMPTION);
  if (!span.includes(spec.firstSlot)) failures.push(PROP.FIRST_SLOT);
  if (!span.includes(spec.support)) failures.push(PROP.SUPPORT);
  if (spec.precedence && !span.includes(spec.precedence)) failures.push(PROP.PRECEDENCE);
  if (!span.trimEnd().endsWith(spec.truthTie)) failures.push(PROP.TRUTH_TIE);
  const at = text.indexOf(HEAD);
  if (!(text.indexOf(spec.after) >= 0 && text.indexOf(spec.after) < at && at < text.indexOf(STAR_LEAD))) {
    failures.push(PROP.ORDER);
  }
  if (!text.includes(`${spec.precededBy}${HEAD}`) || !text.includes(`${spec.truthTie} ${STAR_LEAD}`)) {
    failures.push(PROP.OWN_ELEMENT);
  }
  if (spec.neighbours.some((piece) => !text.includes(piece))) failures.push(PROP.NEIGHBOURS);
  if (truthConditionCount(text) !== spec.truthConditionMatches) failures.push(PROP.TRUTH_COUNT);
  // POINTS_SYSTEM already carries one position rule in its grounding paragraph
  // (paired with its truth condition), so the sweep targets the directive's own
  // span there; ANSWER_SYSTEM has none anywhere and must keep it that way.
  if (POSITION_RULE.test(span) || (spec === ANSWER && POSITION_RULE.test(text))) failures.push(PROP.POSITION);
  if (matchesAny(MANDATE_PATTERNS, text)) failures.push(PROP.MANDATE);
  if (matchesAny(LICENCE_PATTERNS, text)) failures.push(PROP.LICENCE);
  if (/\bideal\b|worked example|example project|idealProject/i.test(text)) failures.push(PROP.IDEAL);
  return failures;
}

const CASES = [
  ["POINTS_SYSTEM", POINTS],
  ["ANSWER_SYSTEM", ANSWER],
];

function propsFor(spec) {
  return Object.values(PROP).filter((name) => name !== PROP.PRECEDENCE || spec.precedence);
}

describe("N134 direct-answer directive — landed in both system prompts (AC-N134-1..4)", () => {
  // The no-op control for every mutation below: the unmodified constants
  // report no failing property at all.
  it.each(CASES)("%s: the unmodified text reports no failing property", (_name, spec) => {
    expect(directAnswerFailures(spec, spec.text)).toEqual([]);
  });

  describe.each(CASES)("%s", (_name, spec) => {
    it.each(propsFor(spec))("holds: %s", (prop) => {
      expect(directAnswerFailures(spec, spec.text)).not.toContain(prop);
    });
  });

  it("states the directive once in each constant, with the exemption and the truth tie read directly", () => {
    // The plain form of the headline claims, so a reader does not have to
    // trust the checker's property names.
    expect(countOf(POINTS_SYSTEM, HEAD)).toBe(1);
    expect(countOf(ANSWER_SYSTEM, HEAD)).toBe(1);
    expect(POINTS_SYSTEM).toContain(EXEMPTION);
    expect(ANSWER_SYSTEM).toContain(EXEMPTION);
    expect(POINTS_SYSTEM).toContain("still comes only from the background.");
    expect(ANSWER_SYSTEM).toContain("still comes only from the material provided below, and never from the question.");
  });

  it("leaves the evidence register of ANSWER_SYSTEM and the grounding sentence of POINTS_SYSTEM where they were", () => {
    expect(ANSWER_SYSTEM).toContain("must come only from the material provided below, and never from the question");
    expect(POINTS_SYSTEM).toContain("Never fabricate experience the background does not support.");
    // And the directive does not displace the elements around it: the
    // evidence register is still the second element of ANSWER_SYSTEM.
    expect(ANSWER_SYSTEM.indexOf("must come only from the material provided below")).toBeLessThan(
      ANSWER_SYSTEM.indexOf(HEAD),
    );
  });
});

describe("N134 — mutation controls (AC-N134-8), each run in place on the real text", () => {
  describe.each(CASES)("%s", (_name, spec) => {
    it("M1: removing the directive is caught", () => {
      const mutant = spec.text.replace(directiveSpan(spec.text), "");
      expect(mutant).not.toBe(spec.text);
      const failures = directAnswerFailures(spec, mutant);
      expect(failures).toContain(PROP.ONCE);
      expect(failures).toContain(PROP.FIRST_SLOT);
      expect(failures).toContain(PROP.EXEMPTION);
      expect(failures).toContain(PROP.TRUTH_TIE);
    });

    it("duplicating the directive is caught (exactly once)", () => {
      const span = directiveSpan(spec.text);
      const mutant = spec.text.replace(span, `${span}${span}`);
      expect(directAnswerFailures(spec, mutant)).toContain(PROP.ONCE);
    });

    it("M4: a mandate to always lead/open/begin with something is caught", () => {
      const mutant = spec.text.replace(HEAD, `${HEAD} Always lead with the direct answer.`);
      expect(mutant).not.toBe(spec.text);
      expect(directAnswerFailures(spec, mutant)).toContain(PROP.MANDATE);
      // And through the shape the guard suite itself rejects.
      expect(directAnswerFailures(spec, `${spec.text} ${REJECTED_MANDATE}`)).toContain(PROP.MANDATE);
    });

    it("M5a: removing the behavioral exemption clause is caught", () => {
      const mutant = spec.text.replace(`${EXEMPTION} `, "");
      expect(mutant).not.toBe(spec.text);
      expect(directAnswerFailures(spec, mutant)).toContain(PROP.EXEMPTION);
    });

    it("M5b: removing the truth-tie sentence is caught", () => {
      const mutant = spec.text.replace(` ${spec.truthTie}`, "");
      expect(mutant).not.toBe(spec.text);
      const failures = directAnswerFailures(spec, mutant);
      expect(failures).toContain(PROP.TRUTH_TIE);
      expect(failures).toContain(PROP.OWN_ELEMENT);
    });

    it("M5c: moving the directive after the STAR element is caught", () => {
      const span = directiveSpan(spec.text);
      const mutant = spec.text.replace(span, "").replace(STAR_SENTENCE, `${STAR_SENTENCE} ${span.trim()}`);
      expect(mutant).not.toBe(spec.text);
      expect(directAnswerFailures(spec, mutant)).toContain(PROP.ORDER);
    });

    it("dropping the first-slot phrase (the directive no longer names the first point/sentence) is caught", () => {
      const mutant = spec.text.replace(spec.firstSlot, "treat the answer as one of the points");
      expect(mutant).not.toBe(spec.text);
      const failures = directAnswerFailures(spec, mutant);
      expect(failures).toContain(PROP.ONCE);
      expect(failures).toContain(PROP.FIRST_SLOT);
    });

    it("an ideal-project / worked-example instruction leaking into the prompt is caught", () => {
      const mutant = `${spec.text} Then describe an ideal example project the candidate could build.`;
      expect(directAnswerFailures(spec, mutant)).toContain(PROP.IDEAL);
    });
  });

  it("M2: a TRUTH_CONDITION-shaped clause added to ANSWER_SYSTEM is caught", () => {
    const mutant = ANSWER_SYSTEM.replace(
      ANSWER.truthTie,
      `${ANSWER.truthTie} Never state or imply that the candidate performed work the material does not support.`,
    );
    expect(mutant).not.toBe(ANSWER_SYSTEM);
    expect(truthConditionCount(mutant)).toBe(1);
    expect(directAnswerFailures(ANSWER, mutant)).toContain(PROP.TRUTH_COUNT);
  });

  it("M2b: a negative position rule added to ANSWER_SYSTEM is caught", () => {
    const mutant = ANSWER_SYSTEM.replace(HEAD, `${HEAD} Do not start with an example.`);
    expect(mutant).not.toBe(ANSWER_SYSTEM);
    expect(directAnswerFailures(ANSWER, mutant)).toContain(PROP.POSITION);
    // The guard suite's own rejected sentence, appended anywhere, is caught too.
    expect(directAnswerFailures(ANSWER, `${ANSWER_SYSTEM} ${REJECTED_POSITION_RULE}`)).toContain(PROP.POSITION);
  });

  it("M3: a SECOND TRUTH_CONDITION in POINTS_SYSTEM is caught", () => {
    const mutant = POINTS_SYSTEM.replace(
      POINTS.truthTie,
      `${POINTS.truthTie} Never state that the candidate used a tool the background does not support.`,
    );
    expect(mutant).not.toBe(POINTS_SYSTEM);
    expect(truthConditionCount(mutant)).toBe(2);
    expect(directAnswerFailures(POINTS, mutant)).toContain(PROP.TRUTH_COUNT);
  });

  it("M3b: a negative position rule inside the POINTS_SYSTEM directive is caught", () => {
    const mutant = POINTS_SYSTEM.replace(HEAD, `${HEAD} Do not start with an example.`);
    expect(mutant).not.toBe(POINTS_SYSTEM);
    expect(directAnswerFailures(POINTS, mutant)).toContain(PROP.POSITION);
  });

  it("a licence that naming a term is not a claim, appended to either constant, is caught", () => {
    for (const [, spec] of CASES) {
      expect(directAnswerFailures(spec, `${spec.text} ${REJECTED_LICENCE}`)).toContain(PROP.LICENCE);
    }
  });
});

describe("N134 — the mirrored detectors fire, and still match the guard suite's", () => {
  it("each mirrored detector fires on the sentence the guard suite rejects", () => {
    // A detector never shown to fire is not evidence of anything.
    expect(matchesAny(LICENCE_PATTERNS, REJECTED_LICENCE)).toBe(true);
    expect(POSITION_RULE.test(REJECTED_POSITION_RULE)).toBe(true);
    expect(TRUTH_CONDITION.test("Never state or imply that the candidate performed work the background does not support.")).toBe(
      true,
    );
    expect(matchesAny(MANDATE_PATTERNS, REJECTED_MANDATE)).toBe(true);
    expect(matchesAny(MANDATE_PATTERNS, "Always begin with the interviewer's own term.")).toBe(true);
  });

  it("the mirror has not drifted: every regex here is still verbatim in answerPrompts.fabricationGuard.test.js", () => {
    const guardSource = readFileSync(
      fileURLToPath(new URL("./answerPrompts.fabricationGuard.test.js", import.meta.url)),
      "utf8",
    );
    const mirrored = [POSITION_RULE, TRUTH_CONDITION, ...LICENCE_PATTERNS, ...MANDATE_PATTERNS];
    for (const pattern of mirrored) {
      // `.source` is the literal's own text for patterns with no "/", which
      // none of these has; flags are asserted too.
      expect({ source: pattern.source, present: guardSource.includes(`/${pattern.source}/${pattern.flags}`) }).toEqual({
        source: pattern.source,
        present: true,
      });
    }
  });
});
