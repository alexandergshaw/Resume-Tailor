import { describe, it, expect } from "vitest";
import { localDetection } from "./localDetection.js";
import { cleanQuestion } from "./questions.js";

// AC-R1: the detector against SPOKEN interviewer speech, not written prose.
//
// Live transcription rarely supplies a question mark, and an interviewer
// almost never opens cold — they open with an acknowledgement ("Okay, so…"),
// a hesitation ("Um, so…"), or a connective ("And then…"). Today the
// detector handles a lead-in in front of an IMPERATIVE ask ("Okay, so tell
// me about…") and misses the same lead-in in front of an INTERROGATIVE one
// ("Okay, so why do you…"), which is the larger half of real interview
// speech. Every case below is a sentence an interviewer actually says.
//
// The negative controls in this file are load-bearing: a detector that
// simply said "yes" to everything would pass every positive case here, so
// the statements must stay undecided for these assertions to mean anything.

function expectDecided(utterance) {
  const r = localDetection(utterance);
  expect(r.decided, `expected a question: ${utterance}`).toBe(true);
  expect(r.question.length).toBeGreaterThan(0);
  return r;
}

function expectUndecided(utterance) {
  const r = localDetection(utterance);
  expect(r.decided, `expected NOT a question: ${utterance}`).toBe(false);
  expect(r.question).toBe("");
  return r;
}

describe("a lead-in in front of an interrogative (AC-R1.1)", () => {
  const CASES = [
    "So why do you want to work here",
    "Okay so what's your greatest weakness",
    "Cool, so how would you scale this service",
    "Alright, so how do you prioritize competing deadlines",
    "So do you have any questions for us",
    "Right, so what does a good week look like for you",
    "Great, so when would you be able to start",
  ];

  for (const utterance of CASES) {
    it(`decides locally: "${utterance}"`, () => {
      expectDecided(utterance);
    });
  }

  it("hands back the question without the lead-in, punctuated", () => {
    const r = expectDecided("Okay so what's your greatest weakness");
    expect(r.question).toBe("What's your greatest weakness?");
  });

  it("still decides the same utterance when it DOES carry a question mark", () => {
    // The control for the above: a written-style utterance was never broken,
    // and must not regress while the spoken one is being fixed.
    const r = expectDecided("So why do you want to work here?");
    expect(r.question).toBe("Why do you want to work here?");
  });
});

describe("a hesitation in front of a lead-in (AC-R1.2)", () => {
  const CASES = [
    "Um, so tell me about yourself",
    "Uh, so walk me through your resume",
    "And, uh, how would you design a rate limiter",
    "Um, okay, so describe a project you're proud of",
  ];

  for (const utterance of CASES) {
    it(`decides locally: "${utterance}"`, () => {
      expectDecided(utterance);
    });
  }

  it("leaves no doubled punctuation or dangling separator behind (AC-R1.5)", () => {
    const r = expectDecided("And, uh, how would you design a rate limiter");
    expect(r.question).toBe("How would you design a rate limiter?");
    expect(r.question).not.toMatch(/,\s*,/);
    expect(r.question).not.toMatch(/^[,.\-–—:;\s]/);
  });

  it("cleans the same way when called directly (AC-R1.5)", () => {
    expect(cleanQuestion("And, uh, how would you design a rate limiter")).toBe(
      "How would you design a rate limiter?",
    );
    expect(cleanQuestion("Um, so tell me about yourself")).toBe("Tell me about yourself");
  });
});

describe("the lead-ins interviewers actually use (AC-R1.3)", () => {
  const CASES = [
    "Now, how do you handle conflict on a team",
    "And how do you keep a project on track",
    "And then what would you do differently next time",
    "Last question, where do you see yourself in five years",
    "Quick question, what's your notice period",
    "Just curious, what drew you to this role",
    "Let's see, how much of that work was yours",
    "One more thing, can you tell me about your testing approach",
  ];

  for (const utterance of CASES) {
    it(`decides locally: "${utterance}"`, () => {
      expectDecided(utterance);
    });
  }
});

describe("statements are still not questions (AC-R1.4)", () => {
  const CASES = [
    "So we're a team of about forty engineers",
    "Um, so I was going to say the role is mostly backend work",
    "Right, so that makes a lot of sense to me",
    "And then we'll get you scheduled with the hiring manager",
    "Now, the salary band for this role is posted on the listing",
    "Okay, great, thanks for walking me through that",
    "Just curious about that, but anyway we should move on",
  ];

  for (const utterance of CASES) {
    it(`stays undecided: "${utterance}"`, () => {
      expectUndecided(utterance);
    });
  }

  it("stays undecided on an acknowledgement, however long", () => {
    expectUndecided("Great, that makes a lot of sense to me, thanks for explaining it");
  });
});

describe("what a decided question looks like (AC-R1.1)", () => {
  it("always reads as a standalone, capitalized question", () => {
    const CASES = [
      "So why do you want to work here",
      "Um, so tell me about yourself",
      "Now, how do you handle conflict on a team",
      "Okay, so, um, tell me about a time you missed a deadline",
    ];
    for (const utterance of CASES) {
      const { question } = expectDecided(utterance);
      expect(question[0]).toBe(question[0].toUpperCase());
      expect(question).not.toMatch(/^(?:so|um|uh|okay|and|now|right|great|alright)\b/i);
    }
  });

  it("reports a reason for every decision it makes", () => {
    for (const utterance of ["So why do you want to work here", "Um, so tell me about yourself"]) {
      expect(expectDecided(utterance).reason).toMatch(/\S/);
    }
  });
});
