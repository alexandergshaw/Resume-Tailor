import { describe, expect, it } from "vitest";
import { isCompanyDirected } from "./companyDirected";

// AC-V4.6. Whether a question is ABOUT the employer, which is the one case
// where an answer waits for the verified-facts lookup instead of being drafted
// without it.
//
// This is deliberately NOT a relevance score. This repo has already spent four
// rounds on a hand-tuned word score for "is this page relevant enough to speak
// aloud" — bare overlap answered a question about disagreeing with a manager
// using a BEEKEEPING page, and every subsequent fix moved the hole rather than
// closing it. What finally worked was changing the KIND of rule. So this one
// has exactly two structural conditions, no weights and no thresholds:
//
//   1. the employer is NAMED — and that name is DATA, out of the user's own
//      posting row, so it is different for every user and cannot be tuned;
//   2. a determiner from the closed set {the, this, your} in front of the head
//      noun {company, organisation, organization} — a grammatical paradigm, not
//      a curated phrase list, and one that cannot grow without someone
//      noticing that it is growing.
//
// The asymmetry that makes a narrow rule the right choice: a MISS costs one
// factless answer, and only when the company question is the very first of the
// session, because the lookup starts on question one and every later question
// has the facts regardless. A FALSE POSITIVE costs the deadline. Neither is
// worth widening the rule for.

const ACME = { company: "Purple Wave" };

describe("isCompanyDirected — the employer is named (rule 1)", () => {
  it("recognizes the questions from the recorded session", () => {
    // Both of these are real, from the live log of 2026-08-25. The second is
    // the one the copilot answered with four sentences of job-description
    // vocabulary and an invented claim of research.
    expect(isCompanyDirected("What do you know about Purple Wave?", ACME)).toBe(true);
    expect(
      isCompanyDirected(
        "Talk to me about what appealed to you about Purple Wave and why you applied.",
        ACME,
      ),
    ).toBe(true);
  });

  it("matches the name regardless of case and surrounding punctuation", () => {
    expect(isCompanyDirected("Why purple wave, of all places?", ACME)).toBe(true);
    expect(isCompanyDirected("So — why PURPLE WAVE?", ACME)).toBe(true);
  });

  it("ignores a trailing legal suffix on the stored company name", () => {
    // The posting row carries whatever the job board had. Nobody says "Inc."
    // out loud.
    for (const company of ["Acme Inc.", "Acme, LLC", "Acme Ltd", "Acme Corp."]) {
      expect(isCompanyDirected("What do you know about Acme?", { company })).toBe(true);
    }
  });

  it("requires whole tokens, not a substring", () => {
    // "Co" inside "coffee", "SA" inside "salary". A substring rule would make
    // a two-letter company name match most sentences in the language.
    expect(isCompanyDirected("How do you take your coffee?", { company: "Co" })).toBe(false);
    expect(isCompanyDirected("What are your salary expectations?", { company: "SA" })).toBe(false);
  });

  it("is false when there is no company on file", () => {
    // A posting saved before a company name was filled in. postings.js
    // documents that `company` can be "".
    expect(isCompanyDirected("What do you know about the role?", { company: "" })).toBe(false);
    expect(isCompanyDirected("What do you know about us?", {})).toBe(false);
    expect(isCompanyDirected("What do you know about us?", undefined)).toBe(false);
  });
});

describe("isCompanyDirected — determiner plus head noun (rule 2)", () => {
  it("accepts the three determiners that point at the addressee's employer", () => {
    for (const question of [
      "What interests you about the company?",
      "Why do you want to join this company?",
      "What do you know about your company's market?",
    ]) {
      expect(isCompanyDirected(question, ACME)).toBe(true);
    }
  });

  it("accepts both spellings of the head noun", () => {
    expect(isCompanyDirected("What appeals to you about this organisation?", ACME)).toBe(true);
    expect(isCompanyDirected("What appeals to you about this organization?", ACME)).toBe(true);
  });

  it("works with no company on file, because it names no company", () => {
    // Rule 2 is the fallback for exactly the case rule 1 cannot serve.
    expect(isCompanyDirected("What do you know about the company?", { company: "" })).toBe(true);
  });

  it("requires the head noun to END the phrase, so a compound noun does not count", () => {
    // voiceCues.js solved this exact problem for its own company cue and
    // recorded the reasoning: `\bthe company\b` alone matches inside "the
    // company culture conversation", because nothing stops "company" from
    // being read as the front half of a DIFFERENT compound noun. The head
    // noun must be followed by end-of-utterance, punctuation, or a possessive
    // — never by a bare word that extends it into a longer noun phrase.
    expect(isCompanyDirected("What is the company culture like?", ACME)).toBe(false);
    expect(isCompanyDirected("Tell me about the company retreat.", ACME)).toBe(false);
    expect(isCompanyDirected("Tell me about the company.", ACME)).toBe(true);
    expect(isCompanyDirected("What is your company's market position?", ACME)).toBe(true);
  });
});

describe("isCompanyDirected — everything else is false", () => {
  it("does not fire on the candidate's OWN employer", () => {
    // The single most dangerous false positive: "my company", "a company",
    // "the company I worked for" are the candidate's history, not the
    // employer. voiceCues.js records the same defect from its own first
    // vocabulary, where a bare noun-phrase pattern fired on "My company
    // background is in fintech and payments".
    for (const question of [
      "Tell me about a company you admire.",
      "What was the company culture like at your last job?",
      "Describe a time you disagreed with your manager.",
      "How many people were at the company you worked for?",
    ]) {
      expect(isCompanyDirected(question, ACME)).toBe(false);
    }
  });

  it("does not fire on the role, the team, or the product", () => {
    // These are the phrases a widened rule reaches for next. Each is a real
    // interview question that needs no company research to answer, and each
    // would spend the deadline for nothing.
    for (const question of [
      "What appeals to you about the role?",
      "How would you work with the team here?",
      "What do you think of the product?",
      "Why do you want to work here?",
    ]) {
      expect(isCompanyDirected(question, ACME)).toBe(false);
    }
  });

  it("does not fire on an ordinary behavioural question", () => {
    expect(
      isCompanyDirected("Tell me about a time you handled a production incident.", ACME),
    ).toBe(false);
  });

  it("never throws on junk input", () => {
    // It rides beside an answer the candidate is waiting on; it may not be
    // able to fail the request it rides beside.
    for (const question of [null, undefined, "", 42, {}]) {
      expect(isCompanyDirected(question, ACME)).toBe(false);
    }
  });
});
