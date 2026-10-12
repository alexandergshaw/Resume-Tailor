// N161 SC-1 — the GATED coding branch in both prompt builders (AC-2 byte
// identity + gate, AC-3 prompt four-part directive). Lives beside
// answerPrompts.test.js rather than inside it so the existing frozen oracles
// are never edited — AC-2 adds a branch, it does not touch the no-coding path.
//
// RED/GREEN on HEAD:
//   - the byte-identity cases are GREEN today (regression guards): the coding
//     branch does not exist, so a non-coding question produces exactly the
//     frozen prompt. They go RED only if a build leaks the coding directive
//     onto a non-coding question — the "not-byte-identical" mutant the hand-off
//     watches die.
//   - the gate / four-part cases are RED today: no coding directive exists for
//     any question. They go GREEN when the gated branch is built.
//
// FROZEN_*_NO_PAGES below are VERBATIM copies of answerPrompts.test.js:86-112,
// marked as frozen snapshots. The copy is validated by the HEAD run: if a
// character is wrong, the byte-identity case fails on HEAD (loudly), not
// silently. They include the "general" descriptor's own prose on purpose —
// that text really is part of the prompt the route sends.

// Deliberately does NOT import detectCodingChallenge.js: this file asserts the
// BUILDER's output (the gated branch), so it must collect and run on HEAD —
// the byte-identity / arity cases are regression guards that have to be GREEN
// today. detectCodingChallenge's own corpus lives in detectCodingChallenge.test.js.
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

// The representative detected coding question used throughout — a positive
// from AC-1's corpus. GENERAL (non-codeBearing) is deliberate: it proves the
// coding directive fires regardless of descriptor.codeBearing (D5), unlike
// codeLanguageLines.
const CODING_Q = "Write a function to reverse a linked list.";
const NON_CODING_Q = "Tell me about yourself.";

describe("buildPointsPrompt — non-coding byte identity + no new arg (AC-2)", () => {
  it("is byte-for-byte the frozen no-pages prompt for a non-coding question", () => {
    expect(buildPointsPrompt(NON_CODING_Q, "", "", GENERAL, "", "", "")).toBe(FROZEN_POINTS_PROMPT_NO_PAGES);
  });

  it("keeps arity at 7 — the coding branch is re-derived from `question`, not a new positional argument", () => {
    expect(buildPointsPrompt.length).toBe(7);
  });
});

describe("buildPointsPrompt — gated coding directive, four parts (AC-2 gate / AC-3)", () => {
  const codingPrompt = () => buildPointsPrompt(CODING_Q, "", "", GENERAL, "", "", "");

  it("emits a coding JSON shape line naming all four parts + the display language (AC-3)", () => {
    const prompt = codingPrompt();
    // The response contract the route's normaliser parses: a codingSolution
    // object, type enum unchanged (D3 — a SEPARATE field, not a widened type).
    expect(prompt).toContain('"codingSolution"');
    for (const key of ['"approach"', '"code"', '"complexity"', '"edgeCases"']) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain('"type": "behavioral" | "technical" | "general"');
  });

  it("instructs the four-part worked solution: approach, code, complexity, edge cases (AC-3)", () => {
    const prompt = codingPrompt().toLowerCase();
    expect(prompt).toMatch(/complexity/);
    expect(prompt).toMatch(/edge case/);
  });

  it("fires even under a non-codeBearing (general) descriptor — language still directed (AC-5 / D5)", () => {
    const prompt = codingPrompt();
    // codeLanguageLines returns [] for GENERAL; the coding directive must not,
    // so a general-session coding question still gets a language instruction.
    expect(prompt).toMatch(/pseudocode|language/i);
  });

  it("adds none of the coding directive to a non-coding question (the gate) — RED if it leaks", () => {
    const prompt = buildPointsPrompt(NON_CODING_Q, "", "", GENERAL, "", "", "");
    expect(prompt).not.toContain('"codingSolution"');
    expect(prompt).not.toMatch(/edge case/i);
  });
});

describe("buildAnswerPrompt — non-coding byte identity (AC-2)", () => {
  const base = { question: NON_CODING_Q, context: "", profile: "", resume: "", coverLetter: "", pagesBlock: "", descriptor: GENERAL };

  it("is byte-for-byte the frozen no-pages prompt for a non-coding question", () => {
    expect(buildAnswerPrompt(base)).toBe(FROZEN_ANSWER_PROMPT_NO_PAGES);
  });
});

describe("buildAnswerPrompt — gated coding directive, four parts (AC-2 gate / AC-3)", () => {
  const codingPrompt = () =>
    buildAnswerPrompt({ question: CODING_Q, context: "", profile: "", resume: "", coverLetter: "", pagesBlock: "", descriptor: GENERAL });

  it("emits a coding JSON shape line naming all four parts (AC-3)", () => {
    const prompt = codingPrompt();
    expect(prompt).toContain('"codingSolution"');
    for (const key of ['"approach"', '"code"', '"complexity"', '"edgeCases"']) {
      expect(prompt).toContain(key);
    }
  });

  it("instructs complexity and edge cases (AC-3)", () => {
    const prompt = codingPrompt().toLowerCase();
    expect(prompt).toMatch(/complexity/);
    expect(prompt).toMatch(/edge case/);
  });

  it("adds none of the coding directive to a non-coding question (the gate)", () => {
    const prompt = buildAnswerPrompt({ question: NON_CODING_Q, context: "", profile: "", resume: "", coverLetter: "", pagesBlock: "", descriptor: GENERAL });
    expect(prompt).not.toContain('"codingSolution"');
    expect(prompt).not.toMatch(/edge case/i);
  });
});
