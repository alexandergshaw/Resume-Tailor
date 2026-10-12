// N162 Wave B (4b) — RE-STATED from N161 SC-1. The owner reversed N161's REPLACE
// decision on 2026-10-12 (N162.ac.r1.md §BLAST RADIUS, authorises this rework).
// Under N162 the coding solution is ADDITIVE: the builders ALWAYS produce the
// normal answer, and APPEND a coding directive when a trailing, defaulted
// `includeCoding` flag is true. The two early returns that used to swap in a
// coding-only prompt (answerPrompts.js:328 / :511) are removed; the combined
// prompt asks the model for BOTH `points` (and today's cues/pageIds/etc.) AND
// `codingSolution` in one call. Binds to N162.arch.r1.md §4 and AC-N162-8/17/19.
//
// WHERE THE DETECTION GATE LIVES (brief vs arch reconciliation): the arch (§4.1)
// is explicit that the builder does NOT re-derive detectCodingChallenge — it
// simply honours `includeCoding`. The route computes
// `wantsCoding = body.includeCodingSolution === true && detectCodingChallenge(q)`
// and passes that as `includeCoding`, so a non-coding question never reaches the
// builder with the flag set in production. The brief's "includeCoding true +
// non-coding → no directive (detection gates it)" is therefore a ROUTE property
// (route.coding.test.js, the ON+non-coding row), NOT a builder property. At the
// builder layer we pin the opposite and deliberate contract: the builder appends
// whenever told to, so a mutant that re-adds detection to the builder reddens.
//
// RED/GREEN on HEAD (verified 2026-10-12 against the shipped N161 tree):
//   - the frozen non-coding byte-identity cases and the arity(7) case are GREEN
//     today (regression guards: the new flag is a trailing default, the normal
//     path is untouched). They go RED only if a build leaks the coding directive
//     onto a non-coding/OFF call or changes arity — the controls the hand-off
//     watches.
//   - every ADDITIVE case is RED today: HEAD early-returns a coding-ONLY prompt
//     for a detected question (no `"points"` JSON key, no "points: 3-5" line,
//     and it still carries N161's "Disregard any earlier instruction to return
//     talking points" reversal sentence), and ignores the new `includeCoding`
//     argument entirely.
//
// FROZEN_*_NO_PAGES below are VERBATIM copies of answerPrompts.test.js's frozen
// oracles — the copy is validated by the HEAD run (a wrong character fails the
// byte-identity case loudly, not silently).

import { describe, it, expect } from "vitest";
import { buildPointsPrompt, buildAnswerPrompt } from "./answerPrompts.js";
import { interviewType } from "./interviewTypes.js";

const GENERAL = interviewType("general");

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
  "Shape it to the question that was actually asked: if this specific question asks the candidate to recount a past experience — a \"tell me about a time...\", \"describe a situation...\", or similar — shape it as a STAR narrative, briefly setting the situation and task, describing the actions the candidate personally took, and closing with the result; for any other question, lead with the direct answer the question calls for — the approach, the position, or the reason — and then draw on the candidate's real experience to support it, rather than narrating a past project in place of answering.",
  "Every claim must come from the CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER above — select, order, and phrase freely, but never invent an employer, project, metric, or credential that isn't there. If the material is thin, give a shorter, honest answer rather than inventing detail.",
  'Return ONLY JSON of this exact shape: { "points": string[], "cues": string[], "type": "behavioral" | "technical" | "general" }',
  "cues: exactly one per point, same order — a 2-6 word prompt for that point, with the same STAR label where the point has one.",
].join("\n");

// A detected coding question (AC-1 positive; verified detectCodingChallenge→true
// and roleTerms→[] this round, so a general-session coding question emits no
// role-term line to perturb these assertions). GENERAL (non-codeBearing) proves
// the directive does not depend on descriptor.codeBearing.
const CODING_Q = "Write a function to reverse a linked list.";
const NON_CODING_Q = "Tell me about yourself.";

// The exact reversal sentence N161 shipped (answerPrompts.js:250). N162 removes
// it — the normal talking points are no longer "disregarded", they are produced.
const N161_REVERSAL = "Disregard any earlier instruction to return talking points";

// ---------------------------------------------------------------------------
// buildPointsPrompt
// ---------------------------------------------------------------------------
describe("buildPointsPrompt — non-coding byte identity + frozen arity (guards, GREEN on HEAD)", () => {
  it("is byte-for-byte the frozen no-pages prompt for a non-coding question", () => {
    expect(buildPointsPrompt(NON_CODING_Q, "", "", GENERAL, "", "", "")).toBe(FROZEN_POINTS_PROMPT_NO_PAGES);
  });

  it("keeps arity at 7 — `includeCoding` must be a trailing DEFAULTED param, never positional before companyFacts", () => {
    // Function.prototype.length stops at the first defaulted param. companyFacts
    // and codeLanguage are already defaulted (positions 8, 9); includeCoding is
    // the 10th, also defaulted, so .length stays 7. A build that inserts it
    // bare, or before companyFacts, reddens here.
    expect(buildPointsPrompt.length).toBe(7);
  });
});

describe("buildPointsPrompt — OFF / non-coding emits NO coding directive (byte-identity-when-off guards)", () => {
  it("includeCoding omitted (default false) + non-coding question → no coding directive (GREEN on HEAD)", () => {
    const prompt = buildPointsPrompt(NON_CODING_Q, "", "", GENERAL, "", "", "");
    expect(prompt).not.toContain('"codingSolution"');
    expect(prompt).not.toMatch(/edge case/i);
  });

  it("includeCoding omitted (default false) + a DETECTED coding question → the NORMAL prompt, not the coding prompt (RED on HEAD)", () => {
    // AC-N162-6/16 at the prompt layer: OFF means normal answer even for a coding
    // question. HEAD early-returns the coding-only prompt (codingSolution, no
    // points JSON key) because it detects from `question` and ignores the flag.
    const prompt = buildPointsPrompt(CODING_Q, "", "", GENERAL, "", "", "");
    expect(prompt).toContain('"points": string[]'); // RED on HEAD: coding prompt has no points key
    expect(prompt).not.toContain('"codingSolution"'); // RED on HEAD: coding prompt IS codingSolution
    expect(prompt).not.toContain(N161_REVERSAL);
  });
});

describe("buildPointsPrompt — ADDITIVE coding directive (N162 AC-8/19, reverses REPLACE; RED on HEAD)", () => {
  const additive = () => buildPointsPrompt(CODING_Q, "", "", GENERAL, "", "", "", undefined, undefined, true);

  it("emits BOTH the normal points shape AND the codingSolution shape in one prompt", () => {
    const prompt = additive();
    // The normal answer is ALWAYS produced (FD-2) — the points JSON field and
    // the points instruction line survive, RED on HEAD (coding prompt omits both).
    expect(prompt).toContain('"points": string[]');
    expect(prompt).toContain("points: 3-5 concise talking points as described above.");
    // ADDITIONALLY the coding solution is asked for, in the same single call.
    expect(prompt).toContain('"codingSolution"');
    for (const key of ['"approach"', '"code"', '"complexity"', '"edgeCases"']) {
      expect(prompt).toContain(key);
    }
  });

  it("drops N161's REPLACE reversal — the model is no longer told to disregard the talking points (RED on HEAD)", () => {
    expect(additive()).not.toContain(N161_REVERSAL);
  });

  it("still directs the code language under a non-codeBearing (general) descriptor (D5 carried forward)", () => {
    expect(additive()).toMatch(/pseudocode|language/i);
  });

  // AC-19 (no experience-claim license) is an ABSENCE requirement whose exact
  // new-directive wording is owner/Gemini-env (N162.ac §SPLIT); the concrete,
  // satisfiable structural floor is the reversal-absence case above plus the
  // frozen system constants (answerPrompts.fabricationGuard.test.js). It is not
  // asserted as a present phrase here, because the arch removes the whole :250
  // line, so requiring a specific disclaimer string could be unsatisfiable.

  it("builder honours `includeCoding` WITHOUT re-deriving detection — appends even for a non-coding question (RED on HEAD; the route is the detection gate)", () => {
    // Arch §4.1: the gate lives in the route, not the builder. A mutant that
    // re-adds detectCodingChallenge to the builder would make this GREEN-on-the-
    // wrong-reason, so it is pinned explicitly. HEAD ignores the 10th arg, so a
    // non-coding question yields the normal prompt with no codingSolution → RED.
    const prompt = buildPointsPrompt(NON_CODING_Q, "", "", GENERAL, "", "", "", undefined, undefined, true);
    expect(prompt).toContain('"codingSolution"');
  });
});

// ---------------------------------------------------------------------------
// buildAnswerPrompt
// ---------------------------------------------------------------------------
const answerBase = (overrides = {}) => ({
  question: NON_CODING_Q,
  context: "",
  profile: "",
  resume: "",
  coverLetter: "",
  pagesBlock: "",
  descriptor: GENERAL,
  ...overrides,
});

describe("buildAnswerPrompt — non-coding byte identity + OFF guards", () => {
  it("is byte-for-byte the frozen no-pages prompt for a non-coding question", () => {
    expect(buildAnswerPrompt(answerBase())).toBe(FROZEN_ANSWER_PROMPT_NO_PAGES);
  });

  it("includeCoding omitted (default false) + non-coding question → no coding directive (GREEN on HEAD)", () => {
    const prompt = buildAnswerPrompt(answerBase());
    expect(prompt).not.toContain('"codingSolution"');
    expect(prompt).not.toMatch(/edge case/i);
  });

  it("includeCoding omitted (default false) + a DETECTED coding question → the NORMAL answer prompt (RED on HEAD)", () => {
    const prompt = buildAnswerPrompt(answerBase({ question: CODING_Q }));
    expect(prompt).toContain('"points": string[]'); // RED on HEAD: coding prompt has no points key
    expect(prompt).toContain("Write the actual spoken answer the candidate should give"); // RED on HEAD
    expect(prompt).not.toContain('"codingSolution"'); // RED on HEAD
    expect(prompt).not.toContain(N161_REVERSAL);
  });
});

describe("buildAnswerPrompt — ADDITIVE coding directive (N162 AC-8/19; RED on HEAD)", () => {
  const additive = () => buildAnswerPrompt(answerBase({ question: CODING_Q, includeCoding: true }));

  it("emits BOTH the normal answer shape AND the codingSolution shape in one prompt", () => {
    const prompt = additive();
    expect(prompt).toContain('"points": string[]');
    expect(prompt).toContain("Write the actual spoken answer the candidate should give");
    expect(prompt).toContain('"codingSolution"');
    for (const key of ['"approach"', '"code"', '"complexity"', '"edgeCases"']) {
      expect(prompt).toContain(key);
    }
  });

  it("drops N161's REPLACE reversal sentence (RED on HEAD)", () => {
    expect(additive()).not.toContain(N161_REVERSAL);
  });

  it("builder honours `includeCoding` without re-deriving detection — appends for a non-coding question too (RED on HEAD)", () => {
    const prompt = buildAnswerPrompt(answerBase({ question: NON_CODING_Q, includeCoding: true }));
    expect(prompt).toContain('"codingSolution"');
  });
});
