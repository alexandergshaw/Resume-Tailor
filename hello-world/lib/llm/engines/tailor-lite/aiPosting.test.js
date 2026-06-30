import { describe, it, expect, beforeAll } from "vitest";
import { embeddedEngine } from "./engine.js";

// Regression guard for the University of San Diego "Adjunct Faculty/Developer -
// Artificial Intelligence for Business Solutions" posting: the AI/data buzzwords
// must be recognized and surfaced in BOTH documents, and the Artificial
// Intelligence focus area must drive the framing.
const AI_POSTING = [
  "Adjunct Faculty/Developer - Artificial Intelligence for Business Solutions",
  "University of San Diego - Professional and Continuing Education",
  "Teach an online program in Artificial Intelligence for Business Solutions.",
  "Required: Generative AI techniques (GANs and VAEs a plus); Python programming; algorithms and data structures.",
  "Preferred: Machine Learning, Deep Learning, Data Science, Business Intelligence, Big Data, Software Engineering, Data Analysis, and the Canvas learning management system.",
  "Bachelor's degree in Computer Science, Artificial Intelligence, or Machine Learning, with emphasis on algorithms, data structures, and programming languages like Python.",
].join("\n");

const BUZZWORDS = [
  "Artificial Intelligence", "Machine Learning", "Deep Learning", "Generative AI",
  "Python", "Algorithms", "Data Structures", "Data Science", "Business Intelligence",
  "Software Engineering", "Data Analysis", "Canvas",
];

function has(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[ ,(])${escaped}([ ,.)]|$)`, "m").test(text);
}

describe("AI for Business Solutions posting tailoring", () => {
  let resume;
  let cover;

  beforeAll(async () => {
    resume = (await embeddedEngine.tailorResume({ jobPosting: AI_POSTING })).result;
    cover = (
      await embeddedEngine.tailorCoverLetter({
        jobPosting: AI_POSTING,
        jobTitle: "Adjunct Faculty, Artificial Intelligence",
        companyName: "University of San Diego",
      })
    ).result;
  });

  it("surfaces every posting buzzword in the résumé", () => {
    for (const term of BUZZWORDS) expect(has(resume, term), `résumé missing: ${term}`).toBe(true);
    expect(resume).not.toContain("{{");
  });

  it("surfaces every posting buzzword in the cover letter", () => {
    for (const term of BUZZWORDS) expect(has(cover, term), `cover letter missing: ${term}`).toBe(true);
    expect(cover).not.toContain("{{");
  });

  it("activates the Artificial Intelligence focus area (subjects + emphasis)", () => {
    const lines = resume.split("\n");
    const skillsRow1 = (lines[lines.findIndex((l) => l.trim() === "Skills") + 2] || "").trim();
    expect(skillsRow1).toContain("Artificial Intelligence");
    expect(/Machine Learning|Generative AI|Deep Learning/.test(skillsRow1)).toBe(true);

    const adjunct = lines.find((l) => /Adjunct Professor/.test(l)) || "";
    expect(/Artificial Intelligence|Machine Learning/.test(adjunct), `adjunct emphasis: ${adjunct}`).toBe(true);
  });
});
