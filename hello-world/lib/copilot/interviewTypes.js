// Registry of interview formats the practice-mode picker can select, and
// the single source of truth for everything downstream that depends on the
// chosen format: which groups of the deterministic question bank to draw
// from, the ideal spoken-answer length, what the evaluation rubric should
// weight, and the plain-language cues a strong answer in that format hits.
// Question generation, sample-answer drafting, and answer critique all
// import their vocabulary from here instead of re-declaring it, so this
// file is the ONLY place a new interview format (or a wording change to an
// existing one) needs to be made.
//
// Deliberately data plus pure functions only: no React, no DOM, no
// network, no randomness, no wall-clock reads. Every export is a straight
// function of its argument, safe to call from a route handler, a client
// component, or a unit test with no setup.
//
// "general" is the default and is deliberately behaviour-preserving: it
// reproduces what practice mode already did before interview types
// existed. Its questionGroups are today's exact three groups
// (behavioral, technical, role), its lengthTarget is today's exact
// IDEAL_MIN_WORDS/IDEAL_MAX_WORDS from lib/copilot/critiqueLocal.js
// (80-220 words, confirmed against that file directly), and its
// expectations list is empty so it adds no critique output a caller
// hasn't already seen. A caller that never passes an interview type, or
// explicitly passes "general", must get byte-identical output to today —
// keep it that way if this file changes.

export const DEFAULT_INTERVIEW_TYPE = "general";

export const INTERVIEW_TYPES = [
  {
    value: "general",
    label: "General / mixed",
    blurb: "A mix of behavioral, technical, and role-fit questions — no single format assumed.",
    guidance:
      "This is a general interview: a mix of behavioral, technical, and role-fit questions " +
      "with no single format assumed. Vary the question style rather than committing to " +
      "one, and keep each question answerable in a couple of minutes of spoken response.",
    questionGroups: ["behavioral", "technical", "role"],
    emphasis: ["clear communication", "relevant experience", "concrete examples"],
    // Matches critiqueLocal.js's IDEAL_MIN_WORDS/IDEAL_MAX_WORDS exactly.
    // Keep these two in sync if either changes.
    lengthTarget: { minWords: 80, maxWords: 220 },
    // Empty on purpose: general adds no format-specific critique, so the
    // embedded rubric's output is unchanged for callers that never opt in.
    expectations: [],
    codeBearing: false,
  },
  {
    value: "phone-screen",
    label: "Recruiter phone screen",
    blurb: "A short recruiter screen — brief questions about background, motivation, and fit.",
    guidance:
      "This is an early recruiter phone screen: short, conversational questions about " +
      "background, motivation, and basic fit, not deep technical or behavioral questions. " +
      "Keep each question answerable in two or three sentences, the way a recruiter — not " +
      "a hiring manager — would actually ask it.",
    questionGroups: ["role"],
    emphasis: ["concise answers", "clear motivation", "relevant background"],
    lengthTarget: { minWords: 50, maxWords: 130 },
    expectations: [
      {
        cue: "specific-example",
        note:
          "Name a real employer, project, or number even in a short answer, rather than " +
          "speaking only in generalities.",
      },
    ],
    codeBearing: false,
  },
  {
    value: "behavioral",
    label: "Behavioral",
    blurb: "Past-experience questions ('tell me about a time...') answered with a clear story.",
    guidance:
      "This is a behavioral interview: every question should ask about a specific past " +
      "experience — 'tell me about a time...', 'describe a situation...' — rather than a " +
      "hypothetical or an opinion. Expect and reward a STAR structure: situation, task, " +
      "action, and a measurable result.",
    questionGroups: ["behavioral"],
    emphasis: ["STAR structure", "specific situation", "your own actions", "measurable result"],
    lengthTarget: { minWords: 120, maxWords: 260 },
    expectations: [
      {
        cue: "star-result",
        note: "End the story with the actual result, not just the actions you took.",
      },
      {
        cue: "specific-example",
        note:
          "Name the specific people, team, or company involved instead of describing the " +
          "situation in the abstract.",
      },
    ],
    codeBearing: false,
  },
  {
    value: "technical",
    label: "Technical / coding",
    blurb:
      "Coding and problem-solving questions judged on approach and trade-offs. Answers are " +
      "spoken points, not written code.",
    guidance:
      "This is a technical interview: questions should probe coding, debugging, or " +
      "engineering judgment, not personal stories. Expect the candidate to state an " +
      "explicit approach and reason about trade-offs rather than only describing the " +
      "problem.",
    questionGroups: ["technical"],
    emphasis: ["explicit approach", "trade-off reasoning", "technical accuracy"],
    lengthTarget: { minWords: 100, maxWords: 260 },
    expectations: [
      {
        cue: "approach",
        note: "State the specific approach you would take before describing the outcome.",
      },
      {
        cue: "tradeoff",
        note: "Name at least one trade-off or alternative you considered and why you ruled it out.",
      },
    ],
    codeBearing: true,
  },
  {
    value: "system-design",
    label: "System design",
    blurb: "Open-ended architecture questions judged on approach, scale, and trade-offs.",
    guidance:
      "This is a system design interview: questions should ask the candidate to design or " +
      "scale a system or service, not solve a small, self-contained coding problem. Expect " +
      "the candidate to lay out an approach, discuss scale and failure modes, and weigh " +
      "trade-offs between designs rather than presenting a single correct answer.",
    questionGroups: ["system-design", "technical"],
    emphasis: ["explicit approach", "scale and constraints", "trade-off reasoning", "failure modes"],
    lengthTarget: { minWords: 150, maxWords: 320 },
    expectations: [
      {
        cue: "approach",
        note:
          "Walk through your approach step by step — the components involved and how they " +
          "fit together — before settling on a design.",
      },
      {
        cue: "tradeoff",
        note:
          "Weigh at least one real trade-off, such as consistency versus availability or " +
          "cost versus latency, instead of presenting your design as the only option.",
      },
    ],
    codeBearing: true,
  },
  {
    value: "case-study",
    label: "Case study",
    blurb: "A business problem worked through out loud, judged on structure and outcome.",
    guidance:
      "This is a case-study interview: questions pose a business or product problem to " +
      "reason through out loud, not a personal story or a coding exercise. Expect the " +
      "candidate to structure their thinking, state assumptions explicitly, and land on a " +
      "recommendation backed by a number.",
    questionGroups: ["case-study", "role"],
    emphasis: ["structured reasoning", "explicit assumptions", "quantified recommendation"],
    lengthTarget: { minWords: 120, maxWords: 300 },
    expectations: [
      {
        cue: "approach",
        note:
          "Structure your reasoning out loud — state your assumptions and the steps you " +
          "would take — before giving a recommendation.",
      },
      {
        cue: "result-metric",
        note:
          "Back your recommendation with an actual number, such as a percentage or dollar " +
          "figure, not only a qualitative judgment.",
      },
    ],
    codeBearing: false,
  },
  {
    value: "leadership",
    label: "Leadership / management",
    blurb: "Questions about leading people and decisions, answered with a clear outcome.",
    guidance:
      "This is a leadership or management interview: questions should ask about leading, " +
      "managing, or influencing people rather than individual-contributor work alone. " +
      "Expect a STAR structure centered on the candidate's own decisions as a leader and a " +
      "concrete outcome for the team.",
    questionGroups: ["leadership", "behavioral"],
    emphasis: ["leadership decisions", "team impact", "measurable outcome"],
    lengthTarget: { minWords: 120, maxWords: 280 },
    expectations: [
      {
        cue: "star-result",
        note:
          "End with the concrete outcome for your team or the business, not just the " +
          "actions you took as a leader.",
      },
      {
        cue: "specific-example",
        note:
          "Reference specific people, teams, or projects instead of describing your " +
          "leadership in the abstract.",
      },
    ],
    codeBearing: false,
  },
];

// value -> descriptor, built once from INTERVIEW_TYPES above so lookups
// stay O(1) and every consumer sees the exact same objects rather than a
// copy re-created per call.
const BY_VALUE = new Map(INTERVIEW_TYPES.map((descriptor) => [descriptor.value, descriptor]));

// Maps any untrusted input to a known interview-type value, defaulting to
// DEFAULT_INTERVIEW_TYPE for anything not in the vocabulary above —
// missing, empty, the wrong type, or simply unrecognized. Never throws:
// callers pass this whatever arrived over the wire (route request bodies,
// a localStorage read, cached sample-answer state) without pre-validating
// it first.
export function normalizeInterviewType(value) {
  return typeof value === "string" && BY_VALUE.has(value) ? value : DEFAULT_INTERVIEW_TYPE;
}

// The full descriptor for a (possibly untrusted) interview type value,
// normalized first so this always returns an object, never undefined.
export function interviewType(value) {
  return BY_VALUE.get(normalizeInterviewType(value));
}

// Convenience for the common case of a consumer that only needs the
// display label — e.g. "Judged as a {label} interview." in AnswerFeedback.
export function interviewTypeLabel(value) {
  return interviewType(value).label;
}

// Whether this (possibly untrusted) interview type is one whose questions
// are code-bearing — i.e. the answer is expected to involve actual code,
// not just a spoken approach. Reads the registry's own `codeBearing` flag
// via interviewType() (normalized, so this never throws and defaults to
// general's false) rather than re-deriving the answer from some other
// field: `questionGroups` is the wrong source, because "technical" is one
// of general's three groups (see DEFAULT_INTERVIEW_TYPE's descriptor
// above), so deriving from it would call the default code-bearing too.
// Currently true only for "technical" and "system-design". This is the
// production render gate for the code-language control: app/copilot/
// CodeLanguageField.js calls it twice — once for the current interview type
// (whether the control renders at all) and once for the type a pending
// change would switch to (whether that change would close the gate).
export function isCodeBearingInterviewType(value) {
  return interviewType(value).codeBearing === true;
}
