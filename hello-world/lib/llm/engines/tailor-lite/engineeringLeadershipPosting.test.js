import { describe, it, expect, beforeAll } from "vitest";
import { embeddedEngine } from "./engine.js";

// Regression guard for the Northwestern Mutual "Asst Director Software Engineering"
// posting: an engineering-leadership / management role (technical leadership,
// mentoring/coaching engineers, hiring, talent development, engineering standards,
// production stability, plus architecture/cloud/CI-CD). The leadership buzzwords
// must surface in BOTH documents, the Engineering Leadership focus area must drive
// the framing (not the default software shape, and not the Solution Architecture
// area), and — being an industry role — the cover letter stays industry-framed.
const EL_POSTING = [
  "Asst Director Software Engineering",
  "Northwestern Mutual - Milwaukee, WI Corporate",
  "Provides technical leadership to the team. Establishes, aggregates, and shares team standards and best practices.",
  "Mentors, guides and coaches engineers within their division. Recruits, hires and onboards talent. Manages team size, design and budget.",
  "Ensures production stability, monitoring, and root cause analysis.",
  "6-8 years of professional experience; 2-5+ years leading engineering teams, growing skills, developing leaders, and providing feedback.",
  "Proven track record designing and delivering significant technology solutions. Experience with agile methods.",
  "Core competencies: Accountability, Adaptive Communication, Coaching & Mentoring, Cross Functional Partnering & Planning, Talent Development & Planning, Technical Problem Solving.",
  "Skills: Engineering Practices, Systems Architecture Design, Cloud Technology, Production Monitoring, Containerization, Continuous Integration, Data Solutions, Agile Methodology, Root Cause Analysis.",
].join("\n");

const BUZZWORDS = [
  "Engineering Leadership", "Engineering Management", "Software Architecture",
  "Engineering Best Practices", "Mentoring", "Cloud Computing", "Talent Development",
];

function has(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[ ,(])${escaped}([ ,.)]|$)`, "m").test(text);
}

describe("Engineering Leadership / management posting tailoring", () => {
  let resume;
  let cover;

  beforeAll(async () => {
    resume = (await embeddedEngine.tailorResume({ jobPosting: EL_POSTING })).result;
    cover = (
      await embeddedEngine.tailorCoverLetter({
        jobPosting: EL_POSTING,
        jobTitle: "Asst Director Software Engineering",
        companyName: "Northwestern Mutual",
      })
    ).result;
  });

  it("surfaces every leadership buzzword in both documents", () => {
    for (const term of BUZZWORDS) {
      expect(has(resume, term), `résumé missing: ${term}`).toBe(true);
      expect(has(cover, term), `cover letter missing: ${term}`).toBe(true);
    }
    expect(resume).not.toContain("{{");
    expect(cover).not.toContain("{{");
  });

  it("activates the Engineering Leadership focus area (subjects + emphasis)", () => {
    const lines = resume.split("\n");
    const skillsRow1 = (lines[lines.findIndex((l) => l.trim() === "Skills") + 2] || "").trim();
    expect(/Engineering Leadership|Technical Leadership|Engineering Management/.test(skillsRow1), `row1: ${skillsRow1}`).toBe(true);

    const firstRole = lines.find((l) => /\| Mutual of Omaha \| July 2023/.test(l)) || "";
    const emphasis = (firstRole.match(/\(([^)]*)\)/) || [, ""])[1];
    expect(/Engineering Leadership|Team Leadership|Mentoring/.test(emphasis), `emphasis: ${emphasis}`).toBe(true);

    // Not hijacked by the academic Systems Engineering focus area.
    expect(resume).not.toContain("Model-Based Systems Engineering");
    expect(resume).not.toContain("Modeling and Simulation");
  });

  it("keeps the cover letter industry-framed and states the team-of-5 leadership fact", () => {
    expect(cover).not.toMatch(/\bstudents?\b/i);
    expect(cover).not.toContain("project-based courses");
    expect(cover).toContain("I lead an engineering team of five");
  });
});
