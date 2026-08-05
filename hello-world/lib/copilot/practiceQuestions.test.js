import { describe, it, expect } from "vitest";
import { buildQuestionBank, nextPracticeQuestion } from "./practiceQuestions";

// A posting whose description carries real terms from the shared skills
// taxonomy (see lib/llm/engines/tailor-lite/data/skills_taxonomy.json), so
// the technical section below is derived from the description rather than
// falling back to the generic technical set.
const RICH_POSTING = {
  title: "Backend Engineer",
  company: "Acme Corp",
  description:
    "We build a platform in Python and React, backed by GraphQL and PostgreSQL, deployed on Kubernetes.",
};
const TAXONOMY_TERMS = ["Python", "React", "GraphQL", "PostgreSQL", "Kubernetes"];

// Longest streak of `value` anywhere in `items`.
function longestRun(items, value) {
  let longest = 0;
  let current = 0;
  for (const item of items) {
    if (item === value) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

// A fixed posting so buildQuestionBank(POSTING) is the same deterministic
// bank across every test below (per the module's own contract: same posting
// + same asked-list -> same next question). Tests derive their expectations
// from that real bank rather than hard-coding template text, so they don't
// break if the templates themselves are reworded later.
const POSTING = {
  title: "Software Engineer",
  company: "Acme Corp",
  description: "We build APIs in Python and deploy with Docker and Kubernetes.",
};

describe("nextPracticeQuestion", () => {
  it("returns the first bank entry not present in asked", () => {
    const bank = buildQuestionBank(POSTING);
    const asked = [bank[0].question, bank[1].question];

    const result = nextPracticeQuestion({ posting: POSTING, asked });

    expect(result).toEqual(bank[2]);
  });

  it("dedupes via normalizeQuestion: case and whitespace differences around an asked question still count as asked", () => {
    const bank = buildQuestionBank(POSTING);
    // Same text as bank[0].question, but upper-cased and with irregular
    // leading/trailing/internal whitespace. Punctuation characters themselves
    // are left untouched, since normalizeQuestion only lower-cases and
    // collapses whitespace.
    const noisy = `   ${bank[0].question.toUpperCase().replace(/\s+/g, "   ")}   `;

    const result = nextPracticeQuestion({ posting: POSTING, asked: [noisy] });

    expect(result).toEqual(bank[1]);
  });

  it("tolerates non-string, empty, and null entries in asked without letting them falsely match a real question", () => {
    const bank = buildQuestionBank(POSTING);
    const asked = [null, undefined, 42, {}, [], "", "   "];

    const result = nextPracticeQuestion({ posting: POSTING, asked });

    expect(result).toEqual(bank[0]);
  });

  it("returns exactly the exhausted sentinel once every bank question has been asked", () => {
    const bank = buildQuestionBank(POSTING);
    const asked = bank.map((entry) => entry.question);

    const result = nextPracticeQuestion({ posting: POSTING, asked });

    expect(result).toEqual({ question: "", type: "general", exhausted: true });
  });

  it("never throws on null/undefined arguments, including no argument at all, and still returns the generic opening question", () => {
    const generic = buildQuestionBank(undefined);

    expect(nextPracticeQuestion()).toEqual(generic[0]);
    expect(nextPracticeQuestion(undefined)).toEqual(generic[0]);
    expect(nextPracticeQuestion({})).toEqual(generic[0]);
    expect(nextPracticeQuestion({ posting: null, asked: null })).toEqual(generic[0]);
    expect(nextPracticeQuestion({ posting: undefined, asked: undefined })).toEqual(generic[0]);
  });
});

describe("buildQuestionBank never returns an empty session", () => {
  it("for a null posting", () => {
    const bank = buildQuestionBank(null);
    expect(bank.length).toBeGreaterThan(0);
    for (const entry of bank) {
      expect(entry.question.trim().length).toBeGreaterThan(0);
    }
  });

  it("for an undefined posting (no argument at all)", () => {
    const bank = buildQuestionBank();
    expect(bank.length).toBeGreaterThan(0);
    for (const entry of bank) {
      expect(entry.question.trim().length).toBeGreaterThan(0);
    }
  });

  it("for an empty-object posting", () => {
    const bank = buildQuestionBank({});
    expect(bank.length).toBeGreaterThan(0);
    for (const entry of bank) {
      expect(entry.question.trim().length).toBeGreaterThan(0);
    }
  });

  it("for a posting whose fields are all whitespace", () => {
    const bank = buildQuestionBank({ title: "   ", company: "\t\t", description: "  \n  " });
    expect(bank.length).toBeGreaterThan(0);
    for (const entry of bank) {
      expect(entry.question.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("buildQuestionBank determinism", () => {
  it("returns an identical sequence of questions and types across two calls with an equivalent posting", () => {
    // A fresh object literal each call (not the same reference) so this
    // proves the bank is derived from the posting's content, not memoized
    // against object identity.
    const bank1 = buildQuestionBank({ ...RICH_POSTING });
    const bank2 = buildQuestionBank({ ...RICH_POSTING });

    expect(bank2).toEqual(bank1);
    expect(bank2.map((entry) => entry.question)).toEqual(bank1.map((entry) => entry.question));
    expect(bank2.map((entry) => entry.type)).toEqual(bank1.map((entry) => entry.type));
  });

  it("is deterministic for a null posting too", () => {
    expect(buildQuestionBank(null)).toEqual(buildQuestionBank(null));
  });
});

describe("buildQuestionBank opening question", () => {
  it("names both the title and the company when both are present", () => {
    const [opening] = buildQuestionBank({ title: "Backend Engineer", company: "Acme Corp" });

    expect(opening.type).toBe("general");
    expect(opening.question).toContain("Backend Engineer");
    expect(opening.question).toContain("Acme Corp");
  });

  it("degrades to naming only the title when there is no company", () => {
    const [opening] = buildQuestionBank({ title: "Backend Engineer" });

    expect(opening.question).toContain("Backend Engineer");
    expect(opening.question).not.toMatch(/undefined|null/i);
  });

  it("degrades to naming only the company when there is no title", () => {
    const [opening] = buildQuestionBank({ company: "Acme Corp" });

    expect(opening.question).toContain("Acme Corp");
    expect(opening.question).not.toMatch(/undefined|null/i);
  });

  it("falls back to a fully generic opening when neither title nor company is present", () => {
    const [opening] = buildQuestionBank({});

    expect(opening.question).not.toMatch(/undefined|null/i);
    expect(opening.question).toMatch(/yourself|background/i);
  });
});

describe("buildQuestionBank technical questions", () => {
  it("mentions real terms pulled from an extractable description", () => {
    const technical = buildQuestionBank(RICH_POSTING).filter((entry) => entry.type === "technical");

    expect(technical.length).toBeGreaterThan(0);
    for (const entry of technical) {
      expect(TAXONOMY_TERMS.some((term) => entry.question.includes(term))).toBe(true);
    }
  });

  it("falls back to the same generic technical set regardless of posting when there is no usable description", () => {
    const bankA = buildQuestionBank({ title: "Product Manager", company: "Acme" });
    const bankB = buildQuestionBank({ title: "Barista", company: "Cafe", description: "   " });
    const technicalA = bankA.filter((entry) => entry.type === "technical");
    const technicalB = bankB.filter((entry) => entry.type === "technical");

    // Same fixed fallback set, in the same order, for two unrelated postings
    // that each lack a usable description.
    expect(technicalA.length).toBeGreaterThan(0);
    expect(technicalA).toEqual(technicalB);
    for (const entry of technicalA) {
      expect(TAXONOMY_TERMS.some((term) => entry.question.includes(term))).toBe(false);
    }
  });
});

describe("buildQuestionBank type interleaving", () => {
  it("never groups six consecutive behavioral questions together for a rich posting", () => {
    const types = buildQuestionBank(RICH_POSTING).map((entry) => entry.type);

    expect(longestRun(types, "behavioral")).toBeLessThan(6);
  });

  it("never groups six consecutive behavioral questions together for a posting with nothing usable", () => {
    const types = buildQuestionBank({}).map((entry) => entry.type);

    expect(longestRun(types, "behavioral")).toBeLessThan(6);
  });

  it("yields all three question types for a rich posting", () => {
    const types = new Set(buildQuestionBank(RICH_POSTING).map((entry) => entry.type));

    expect(types.has("general")).toBe(true);
    expect(types.has("behavioral")).toBe(true);
    expect(types.has("technical")).toBe(true);
  });
});
