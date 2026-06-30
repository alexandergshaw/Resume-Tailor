import { describe, it, expect, beforeAll } from "vitest";
import { embeddedEngine } from "./engine.js";

// Regression guard for the Counterpart Health "UX Engineer" posting (design system
// / shared UI ownership): the design-system + frontend buzzwords must be recognized
// and surfaced in BOTH documents, and the UX Engineering focus area must drive the
// framing (subjects, emphasis, technical stack) rather than the default software shape.
const UX_POSTING = [
  "UX Engineer",
  "Counterpart Health",
  "We are hiring a UX Engineer to own and evolve our design system and shared UI patterns, enabling faster, more consistent product development across teams.",
  "This role sits within Engineering and operates as a bridge between Design, Product, and Frontend Engineering. The UX Engineer ensures that design intent translates cleanly into production by building and maintaining high-quality, reusable UI primitives, components, and interaction patterns.",
  "Own and evolve the design system as a product, including components, patterns, and usage standards.",
  "Build and maintain reusable UI primitives and interaction patterns that scale across teams.",
  "Proactively manage frontend UX-related technical debt, resolving quality gaps and inconsistencies that slow development.",
  "Conduct coded prototyping for complex workflows using synthetic or mock data, especially for data-dense or AI-enabled experiences.",
  "Improve experience quality and consistency across motion, responsive behavior, and mobile contexts.",
  "Partner closely with Design and Product during discovery to validate feasibility and reduce downstream rework.",
  "You have Advanced frontend engineering expertise (React, TypeScript, Tailwind, Storybook), and experience shipping production UI.",
  "You have Experience working with design systems and component libraries at scale.",
  "You have High design fluency, with attention to interaction detail, usability, accessibility, and visual quality.",
].join("\n");

const BUZZWORDS = [
  "Design Systems", "Component Libraries", "React", "TypeScript", "Tailwind CSS",
  "Storybook", "Accessibility", "Interaction Design", "Frontend Engineering", "Responsive Design",
];

function has(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[ ,(])${escaped}([ ,.)]|$)`, "m").test(text);
}

describe("UX Engineer / design system posting tailoring", () => {
  let resume;
  let cover;

  beforeAll(async () => {
    resume = (await embeddedEngine.tailorResume({ jobPosting: UX_POSTING })).result;
    cover = (
      await embeddedEngine.tailorCoverLetter({
        jobPosting: UX_POSTING,
        jobTitle: "UX Engineer",
        companyName: "Counterpart Health",
      })
    ).result;
  });

  it("surfaces every UX-engineering buzzword in the résumé", () => {
    for (const term of BUZZWORDS) expect(has(resume, term), `résumé missing: ${term}`).toBe(true);
    expect(resume).not.toContain("{{");
  });

  it("surfaces every UX-engineering buzzword in the cover letter", () => {
    for (const term of BUZZWORDS) expect(has(cover, term), `cover letter missing: ${term}`).toBe(true);
    expect(cover).not.toContain("{{");
  });

  it("activates the UX Engineering focus area (subjects + emphasis + stack), not the default software shape", () => {
    const lines = resume.split("\n");
    const skillsRow1 = (lines[lines.findIndex((l) => l.trim() === "Skills") + 2] || "").trim();
    expect(skillsRow1).toContain("Design Systems");
    expect(/Component Libraries|Frontend Engineering|Interaction Design/.test(skillsRow1)).toBe(true);

    const adjunct = lines.find((l) => /Adjunct Professor/.test(l)) || "";
    expect(/Design Systems|Frontend Engineering/.test(adjunct), `adjunct emphasis: ${adjunct}`).toBe(true);

    const firstRole = lines.find((l) => /\| Mutual of Omaha \| July 2023/.test(l)) || "";
    const emphasis = (firstRole.match(/\(([^)]*)\)/) || [, ""])[1];
    expect(/Design Systems|Component Libraries|Frontend Engineering/.test(emphasis), `full-time emphasis: ${emphasis}`).toBe(true);
  });

  it("frames the cover letter for the industry role, not as an adjunct-teaching application", () => {
    // The UX Engineer posting has no teaching signal: the letter must drop the
    // "support students / project-based courses / rubrics / students and courses"
    // framing the bundled template uses for academic postings.
    expect(cover).not.toMatch(/\bstudents?\b/i);
    expect(cover).not.toContain("project-based courses");
    expect(cover).not.toContain("rubrics");
    expect(cover).not.toContain("instructional team");
    expect(cover).not.toContain("higher-education instruction");
    // It addresses the posting's explicit technical-debt responsibility.
    expect(cover).toMatch(/technical debt/i);
  });

  it("cleans ATS title boilerplate so the letter names the real role", async () => {
    // The greenhouse page title is "Job Application for UX Engineer at Clover Health".
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: UX_POSTING,
      jobTitle: "Job Application for UX Engineer",
      companyName: "Clover Health",
    });
    expect(res.jobTitle).toBe("UX Engineer");
    expect(res.result).toContain("the UX Engineer position at Clover Health");
    expect(res.result).not.toContain("Job Application for");
  });
});
