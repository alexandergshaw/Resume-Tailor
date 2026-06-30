import { describe, it, expect, beforeAll } from "vitest";
import { embeddedEngine } from "./engine.js";

// Regression guard for the Principal Financial Group "Sr Software Engineer II
// (Platform Modernization Solution Design)" posting: a senior-engineer / solution-
// architect role. The architecture + modernization buzzwords must be recognized and
// surfaced in BOTH documents, the Solution Architecture focus area must drive the
// framing (not the default software shape, and not the academic Systems Engineering
// area), and — being an industry role — the cover letter must stay industry-framed.
const SA_POSTING = [
  "Sr Software Engineer II (Platform Modernization Solution Design)",
  "We're looking for a Senior Software Engineer to be an engineering lead providing architectural oversight for the modernization of our retirement recordkeeping platform by designing scalable solutions and guiding architectural decisions.",
  "Create and maintain solution architecture artifacts, reference architectures, and technical roadmaps that guide implementation teams.",
  "Assess emerging technologies and provide guidance on technical direction, ensuring alignment with enterprise-wide strategic initiatives.",
  "Partner with key stakeholders to transform business objectives into robust technical solutions, bridging communication between technical and non-technical teams.",
  "Champion an exceptional engineering team by fostering innovation, mentoring talent, and supporting a results-driven culture.",
  "Operating at the intersection of financial services and technology.",
  "8+ years of enterprise-level engineering experience. Informal team leadership experience, mentoring and providing strategic direction to a team.",
  "Skills That Will Help You Stand Out: Experience with cloud platforms (e.g. AWS). Proven track record in solution architecture and system design. Demonstrated ability to modernize while maintaining business continuity.",
  "Through our product-driven Agile/Lean DevOps environment, we've fostered a culture of innovation across our development teams.",
].join("\n");

const BUZZWORDS = [
  "Solution Architecture", "Software Architecture", "Platform Modernization", "System Design",
  "Reference Architecture", "AWS", "Microservices", "Distributed Systems", "Cloud Computing",
];

function has(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[ ,(])${escaped}([ ,.)]|$)`, "m").test(text);
}

describe("Solution Architecture / Platform Modernization posting tailoring", () => {
  let resume;
  let cover;

  beforeAll(async () => {
    resume = (await embeddedEngine.tailorResume({ jobPosting: SA_POSTING })).result;
    cover = (
      await embeddedEngine.tailorCoverLetter({
        jobPosting: SA_POSTING,
        jobTitle: "Sr Software Engineer II (Platform Modernization Solution Design)",
        companyName: "Principal Financial Group",
      })
    ).result;
  });

  it("surfaces every architecture buzzword in the résumé", () => {
    for (const term of BUZZWORDS) expect(has(resume, term), `résumé missing: ${term}`).toBe(true);
    expect(resume).not.toContain("{{");
  });

  it("surfaces every architecture buzzword in the cover letter", () => {
    for (const term of BUZZWORDS) expect(has(cover, term), `cover letter missing: ${term}`).toBe(true);
    expect(cover).not.toContain("{{");
  });

  it("activates the Solution Architecture focus area (subjects + emphasis + stack)", () => {
    const lines = resume.split("\n");
    const skillsRow1 = (lines[lines.findIndex((l) => l.trim() === "Skills") + 2] || "").trim();
    expect(skillsRow1).toContain("Solution Architecture");
    expect(/Software Architecture|System Design|Platform Modernization/.test(skillsRow1)).toBe(true);

    const firstRole = lines.find((l) => /\| Mutual of Omaha \| July 2023/.test(l)) || "";
    const emphasis = (firstRole.match(/\(([^)]*)\)/) || [, ""])[1];
    expect(/Solution Architecture|Platform Modernization|Solution Design/.test(emphasis), `full-time emphasis: ${emphasis}`).toBe(true);

    // The academic Systems Engineering area must NOT hijack an industry architect role.
    expect(resume).not.toContain("Model-Based Systems Engineering");
    expect(resume).not.toContain("Modeling and Simulation");
  });

  it("keeps the cover letter industry-framed and states the team-of-5 leadership fact", () => {
    expect(cover).not.toMatch(/\bstudents?\b/i);
    expect(cover).not.toContain("project-based courses");
    expect(cover).toContain("I lead an engineering team of five");
  });
});
