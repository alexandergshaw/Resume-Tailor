// The prompt builders, tested DIRECTLY for the first time.
//
// Until they were extracted out of app/api/copilot/answer/route.js they could
// only be reached through a mocked `generateContent` call, so every property
// of a prompt was asserted several layers away from the function that wrote
// it — a changed sentence surfaced as a route failure about a string, and
// localising it meant reading the route to work out which of two builders had
// produced it. That is why a prompt regression has been hard to place.
//
// What these cases pin, and why each matters:
//
//  - THE BYTE-IDENTITY GUARANTEE (AC-H4.17/AC-H4.18/AC-3.4). With no résumé,
//    no cover letter and no pages block, each builder must produce exactly
//    what it produced before those sources existed. Asserted two ways: as the
//    absence of every line either builder can add, AND — since that sweep only
//    forbids five known strings, and an unconditional `parts.push("Answer in
//    English.")` passed it — as a frozen full-string `toBe` per builder. See
//    FROZEN_POINTS_PROMPT_NO_PAGES / FROZEN_ANSWER_PROMPT_NO_PAGES below.
//  - ORDER. AC-3.1 requires the project pages to come BEFORE the submitted
//    documents: a model handed a résumé and a project page reaches for the
//    résumé, because it is shorter and already answer-shaped, and that is the
//    generic-answer defect the ordering exists to fix. Order is not visible in
//    any "contains" assertion, so it is checked by index.
//  - THE pageIds GATE. Asking for `pageIds` when no page was shown invites a
//    citation the model has to invent; asking for none when pages WERE shown
//    means resolvePageSources can only ever resolve nulls. Both directions.
//
// The interview-type descriptors are the REAL ones (interviewTypes.js), not
// hand-built doubles — answerShapeInstruction branches on `questionGroups`
// and `value`, and a double would let those branches drift from the values
// the route actually passes.

import { describe, it, expect } from "vitest";
import {
  POINTS_SYSTEM,
  ANSWER_SYSTEM,
  interviewFormatLines,
  buildPointsPrompt,
  answerShapeInstruction,
  buildAnswerPrompt,
} from "./answerPrompts.js";
import { interviewType } from "./interviewTypes.js";

const GENERAL = interviewType("general");
const BEHAVIORAL = interviewType("behavioral");
const TECHNICAL = interviewType("technical");
const SYSTEM_DESIGN = interviewType("system-design");
const PHONE_SCREEN = interviewType("phone-screen");
const CASE_STUDY = interviewType("case-study");

const PAGES_BLOCK = "## Payments migration (page id: p1)\n\n- Cut settlement time from three days to one";

// Every line either builder can add on account of a résumé, a cover letter or
// a pages block. None of them may appear when the corresponding argument is
// absent — that is the byte-identity guarantee, stated as a list.
const CONDITIONAL_MARKERS = [
  "YOUR OWN PROJECT PAGES",
  "SUBMITTED RESUME",
  "SUBMITTED COVER LETTER",
  "pageIds",
  "Prefer a specific detail from a project page",
];

// THE BYTE-IDENTITY GUARANTEE, actually pinned.
//
// The CONDITIONAL_MARKERS sweeps below are `not.toContain` checks, and this
// file's own header claims "an unconditional new line anywhere in this module
// breaks it, which is the whole point". That was false: appending
// `parts.push("Answer in English.")` to either builder passes every sweep in
// this file and every prompt assertion in the repo, because no assertion
// anywhere said what the WHOLE prompt is. A guarantee that only forbids five
// known strings is not a guarantee about a byte-identical prompt.
//
// These two oracles are the form that means what the comment says: the
// complete output of each builder for the minimal no-pages, no-résumé,
// no-cover-letter, no-profile, no-context input, compared with `toBe`. Any
// added, removed, reordered or reworded line fails, whatever it says.
//
// They deliberately include the interview descriptor's own prose
// (interviewTypes.js's "general" label, guidance and emphasis), because that
// text really is part of the prompt the route sends. Editing a descriptor on
// purpose means updating these strings in the same change — which is the
// point, not an inconvenience.
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

describe("the system instructions", () => {
  it("are single joined strings, not arrays", () => {
    // They are passed straight to `config.systemInstruction`; an array would
    // be a different request, silently.
    expect(typeof POINTS_SYSTEM).toBe("string");
    expect(typeof ANSWER_SYSTEM).toBe("string");
  });

  it("keep the two modes distinct in what they ask for", () => {
    // Points mode wants glanceable fragments and never asks for cues (the
    // route derives them). Answer mode wants complete spoken sentences and
    // does ask for cues.
    expect(POINTS_SYSTEM).toContain("glance");
    expect(POINTS_SYSTEM).not.toContain("`cues`");
    expect(ANSWER_SYSTEM).toContain("complete sentences");
    expect(ANSWER_SYSTEM).toContain("`cues`");
  });

  it("both demand STAR labels for behavioural questions", () => {
    for (const system of [POINTS_SYSTEM, ANSWER_SYSTEM]) {
      expect(system).toContain('"Situation:", "Task:", "Action:", "Result:"');
    }
  });
});

describe("interviewFormatLines", () => {
  it("names the format, its guidance and its emphasis, in three lines", () => {
    const lines = interviewFormatLines(BEHAVIORAL);
    expect(lines[0]).toBe("--- INTERVIEW FORMAT ---");
    expect(lines[1]).toContain(BEHAVIORAL.label);
    expect(lines[1]).toContain(BEHAVIORAL.guidance);
    expect(lines[2]).toBe(`Emphasize: ${BEHAVIORAL.emphasis.join(", ")}.`);
  });
});

describe("answerShapeInstruction", () => {
  it("asks for STAR on a behavioural or leadership format", () => {
    expect(answerShapeInstruction(BEHAVIORAL)).toContain("STAR narrative");
  });

  it("asks for approach-then-trade-offs on a technical or system-design format", () => {
    expect(answerShapeInstruction(TECHNICAL)).toContain("approach-then-trade-offs");
    expect(answerShapeInstruction(SYSTEM_DESIGN)).toContain("approach-then-trade-offs");
  });

  it("asks a recruiter screen for brevity rather than a story", () => {
    // Checked by `value`, after the group checks — the ordering is what makes
    // "phone-screen" reachable at all, since its questionGroups are ["role"].
    expect(answerShapeInstruction(PHONE_SCREEN)).toContain("brevity");
  });

  it("falls back to a neutral shape for anything else", () => {
    // "case-study" is the descriptor that reaches it: its groups are
    // ["case-study", "role"], which none of the branches above name, and its
    // value is not "phone-screen". NOT "general" — that reads like the
    // obvious default and is not one: its groups include "behavioral", so it
    // takes the STAR branch. Written against a real descriptor precisely so
    // this stays true of the values the route actually passes.
    expect(answerShapeInstruction(CASE_STUDY)).toContain("lead with the point");
    expect(answerShapeInstruction(GENERAL)).toContain("STAR narrative");
  });
});

describe("buildPointsPrompt", () => {
  it("adds nothing at all with no resume, no cover letter and no pages", () => {
    const prompt = buildPointsPrompt("Tell me about yourself.", "", "", GENERAL, "", "", "");
    for (const marker of CONDITIONAL_MARKERS) expect(prompt).not.toContain(marker);
    // Positive control: it is not empty, so the sweep above is not vacuous.
    expect(prompt).toContain('The interviewer asked: "Tell me about yourself."');
    expect(prompt).toContain("--- INTERVIEW FORMAT ---");
    expect(prompt).toContain('{ "points": string[], "type": "behavioral" | "technical" | "general" }');
  });

  it("is byte-for-byte the frozen no-pages prompt", () => {
    // The assertion the `not.toContain` sweep above cannot make: an
    // unconditional line added anywhere in buildPointsPrompt fails here, and
    // only here.
    expect(buildPointsPrompt("Tell me about yourself.", "", "", GENERAL, "", "", "")).toBe(
      FROZEN_POINTS_PROMPT_NO_PAGES,
    );
  });

  it("never carries the posting description — that is what AC-H7.27 forbids", () => {
    // Structural, not incidental: this function has no parameter for one.
    expect(buildPointsPrompt.length).toBe(7);
  });

  it("puts the project pages BEFORE the submitted documents (AC-3.1)", () => {
    const prompt = buildPointsPrompt("Q?", "", "", GENERAL, "MY RESUME TEXT", "MY COVER LETTER", PAGES_BLOCK);
    expect(prompt.indexOf("YOUR OWN PROJECT PAGES")).toBeLessThan(prompt.indexOf("SUBMITTED RESUME"));
    expect(prompt.indexOf("SUBMITTED RESUME")).toBeLessThan(prompt.indexOf("SUBMITTED COVER LETTER"));
  });

  it("asks for pageIds only when pages were actually shown", () => {
    expect(buildPointsPrompt("Q?", "", "", GENERAL, "", "", PAGES_BLOCK)).toContain(
      '{ "points": string[], "type": "behavioral" | "technical" | "general", "pageIds": (string | null)[] }',
    );
    expect(buildPointsPrompt("Q?", "", "", GENERAL, "", "", "")).not.toContain("pageIds");
  });

  it("declares pageIds after points in the JSON shape line (ARCH §3.7)", () => {
    // pointsFromPartialJson anchors on /"points"\s*:\s*\[/, so an earlier
    // field would delay the first streamed points frame for nothing.
    const shape = buildPointsPrompt("Q?", "", "", GENERAL, "", "", PAGES_BLOCK);
    expect(shape.indexOf('"points"')).toBeLessThan(shape.indexOf('"pageIds"'));
  });

  it("includes the prep profile and the conversation context when it has them", () => {
    const prompt = buildPointsPrompt("Q?", "THE TRANSCRIPT", "THE PROFILE", GENERAL, "", "", "");
    expect(prompt).toContain("--- CANDIDATE BACKGROUND");
    expect(prompt).toContain("THE PROFILE");
    expect(prompt).toContain("Recent conversation (most recent last), for context:");
    expect(prompt).toContain("THE TRANSCRIPT");
  });
});

describe("buildAnswerPrompt", () => {
  const base = { question: "Tell me about yourself.", context: "", profile: "", descriptor: GENERAL };

  it("adds nothing about pages with no pages block", () => {
    const prompt = buildAnswerPrompt({ ...base, resume: "", coverLetter: "", pagesBlock: "" });
    expect(prompt).not.toContain("YOUR OWN PROJECT PAGES");
    expect(prompt).not.toContain("pageIds");
    expect(prompt).not.toContain("Prefer a specific detail from a project page");
    // The authority sentence is the subtle one: with no pages it must name
    // exactly three sources, and the pages-variant must not leak in.
    expect(prompt).toContain("CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER");
    expect(prompt).not.toContain("YOUR OWN PROJECT PAGES, CANDIDATE PREP NOTES");
  });

  it("is byte-for-byte the frozen no-pages prompt", () => {
    // Same guarantee as buildPointsPrompt's, for the builder practice mode
    // uses. The `not.toContain` cases above name five strings; this one names
    // the whole prompt, which is what "byte-identical to what it produced
    // before those sources existed" actually asserts.
    expect(buildAnswerPrompt({ ...base, resume: "", coverLetter: "", pagesBlock: "" })).toBe(
      FROZEN_ANSWER_PROMPT_NO_PAGES,
    );
  });

  it("names the pages FIRST in the authority sentence once they are shown (AC-3.1)", () => {
    const prompt = buildAnswerPrompt({ ...base, resume: "", coverLetter: "", pagesBlock: PAGES_BLOCK });
    expect(prompt).toContain("YOUR OWN PROJECT PAGES, CANDIDATE PREP NOTES, SUBMITTED RESUME, or SUBMITTED COVER LETTER");
  });

  it("puts the pages block before the résumé and cover letter sections", () => {
    const prompt = buildAnswerPrompt({
      ...base,
      resume: "MY RESUME TEXT",
      coverLetter: "MY COVER LETTER",
      pagesBlock: PAGES_BLOCK,
    });
    expect(prompt.indexOf("YOUR OWN PROJECT PAGES")).toBeLessThan(prompt.indexOf("SUBMITTED RESUME"));
    expect(prompt.indexOf("SUBMITTED RESUME")).toBeLessThan(prompt.indexOf("SUBMITTED COVER LETTER"));
  });

  it("swaps the no-documents note for its pages variant, never dropping it", () => {
    const withoutPages = buildAnswerPrompt({ ...base, resume: "", coverLetter: "", pagesBlock: "" });
    expect(withoutPages).toContain("build the answer from the candidate prep notes and conversation context alone.");
    const withPages = buildAnswerPrompt({ ...base, resume: "", coverLetter: "", pagesBlock: PAGES_BLOCK });
    expect(withPages).toContain("YOUR OWN PROJECT PAGES above, and conversation context.");
    // And it is absent entirely once a document WAS found — claiming none was
    // available while quoting one would be the false half of a pair.
    const withResume = buildAnswerPrompt({ ...base, resume: "MY RESUME TEXT", coverLetter: "", pagesBlock: "" });
    expect(withResume).not.toContain("No submitted resume or cover letter was available");
  });

  it("carries the format's own length target and shape instruction", () => {
    const prompt = buildAnswerPrompt({ ...base, descriptor: BEHAVIORAL, resume: "", coverLetter: "", pagesBlock: "" });
    expect(prompt).toContain(`${BEHAVIORAL.lengthTarget.minWords}-${BEHAVIORAL.lengthTarget.maxWords} words`);
    expect(prompt).toContain(answerShapeInstruction(BEHAVIORAL));
  });

  it("always asks for cues, and for pageIds only when pages were shown", () => {
    const withoutPages = buildAnswerPrompt({ ...base, resume: "", coverLetter: "", pagesBlock: "" });
    expect(withoutPages).toContain('{ "points": string[], "cues": string[], "type": "behavioral" | "technical" | "general" }');
    expect(withoutPages).toContain("cues: exactly one per point");
    const withPages = buildAnswerPrompt({ ...base, resume: "", coverLetter: "", pagesBlock: PAGES_BLOCK });
    expect(withPages).toContain(
      '{ "points": string[], "cues": string[], "type": "behavioral" | "technical" | "general", "pageIds": (string | null)[] }',
    );
    expect(withPages).toContain("Never invent an id and never cite a page you were not shown.");
    // ARCH §3.7 again: points first, so the streaming path's first frame is
    // never sat behind another field.
    expect(withPages.indexOf('"points"')).toBeLessThan(withPages.indexOf('"pageIds"'));
  });
});
