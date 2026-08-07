// AC-L2: "words from the posting to work in" must be about the question on
// screen. Reported: the list is the same six terms for every question.
//
// Reproduced before this test was written — three unrelated questions against
// the posting below all returned the identical array
// ["Education","CRM","Agile","SDLC","Artificial Intelligence","Communication"],
// because the only per-question signal was an exact substring test that almost
// never fires, leaving the posting's global top-6 to win every time.

import { describe, it, expect } from "vitest";
import { postingBuzzwords, MAX_BUZZWORDS } from "./postingBuzzwords.js";

const POSTING = `Senior Product Manager, Education Technology

Salary range: $78,496.00 - $105,974.00 annually

We are looking for a product manager to lead our higher education platform team.
You will work with Agile teams across the SDLC, partner with our CRM and student
information systems, and write SQL against our reporting warehouse. Help us bring
Artificial Intelligence into the classroom. Strong communication skills required.
5+ years of product experience.`;

const EDU = {
  question:
    "Could you tell me a bit about your experience working with technology platforms within a higher education environment?",
  points: [
    "I spent three years as a Product Curriculum Lead building learning tools used across a university system.",
    "I worked hands-on with SQL and REST APIs to integrate our platform with the student information system.",
  ],
};

const CONFLICT = {
  question: "Tell me about a time you had to resolve a conflict on your team.",
  points: ["I mediated a disagreement between two engineers about who owned a shared service."],
};

const SALARY = {
  question: "What are your salary expectations for this role?",
  points: ["I would like to understand the band before naming a number."],
};

describe("postingBuzzwords relevance", () => {
  it("gives two different questions two different lists for the same posting", () => {
    expect(postingBuzzwords(POSTING, EDU)).not.toEqual(postingBuzzwords(POSTING, CONFLICT));
  });

  it("surfaces the posting terms the question and draft are actually about", () => {
    const terms = postingBuzzwords(POSTING, EDU);
    expect(terms).toContain("Education");
    expect(terms).toContain("SQL");
  });

  it("does not pad the list with the posting's top terms that have nothing to do with the question", () => {
    const terms = postingBuzzwords(POSTING, EDU);
    // The reported six. These out-scored everything in the posting and were
    // shown for every question regardless of what was being answered.
    expect(terms).not.toContain("CRM");
    expect(terms).not.toContain("SDLC");
    expect(terms).not.toContain("Artificial Intelligence");
  });

  it("shows nothing rather than a constant list when no posting term relates to the question", () => {
    expect(postingBuzzwords(POSTING, SALARY)).toEqual([]);
  });

  it("matches a plural in the question against the posting's singular term", () => {
    expect(
      postingBuzzwords(POSTING, {
        question: "Which CRMs have you integrated with?",
        points: ["I connected our reporting layer to two of them."],
      }),
    ).toContain("CRM");
  });

  it("caps the list at four even when the question touches everything", () => {
    const terms = postingBuzzwords(POSTING, {
      question:
        "How do you use Agile and the SDLC to bring Artificial Intelligence into an Education product, and how does that touch the CRM, SQL reporting and communication with stakeholders?",
      points: ["I have run all of it."],
    });
    expect(MAX_BUZZWORDS).toBe(4);
    expect(terms.length).toBeLessThanOrEqual(4);
    expect(terms.length).toBeGreaterThan(0);
  });

  it("is deterministic for one (posting, question) pair", () => {
    expect(postingBuzzwords(POSTING, EDU)).toEqual(postingBuzzwords(POSTING, EDU));
  });

  it("still returns nothing for a blank posting", () => {
    expect(postingBuzzwords("", EDU)).toEqual([]);
    expect(postingBuzzwords(null, EDU)).toEqual([]);
  });
});
