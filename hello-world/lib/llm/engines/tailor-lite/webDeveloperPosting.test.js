import { describe, it, expect, beforeAll } from "vitest";
import { embeddedEngine, isTeachingPosting } from "./engine.js";

// Regression guard for the WPI "Temporary Computer Science Developer" posting
// (a Drupal/PHP/LAMP/Angular web-developer role in a university CS department).
// The web buzzwords must surface in BOTH documents; the role must stay web/dev-
// framed (NOT hijacked by the UX Engineering focus area on a bare "front-end
// development" mention); and — being a developer role, not teaching — the cover
// letter must stay industry-framed despite the "About <University>" boilerplate
// that mentions "world-renowned faculty" and "extraordinary students".
const WPI_POSTING = [
  "JOB TITLE Temporary Computer Science Developer",
  "DEPARTMENT NAME Computer Science",
  "DIVISION NAME Worcester Polytechnic Institute - WPI",
  "JOB DESCRIPTION SUMMARY The Department of Computer Science is seeking to hire a candidate with skills in web development to help with strategic initiatives in the department.",
  "The candidate should have: Background in server-based programming languages, like PHP, and front-end development. Target software includes the LAMP stack, Angular, and REST APIs. Familiarity with Drupal and the ability to design professional quality pages is a preferred qualification.",
  "This is a temporary 20 hour per week position from August to December 2026.",
  "About WPI: WPI is a vibrant, active, and diverse community of extraordinary students, world-renowned faculty, and state of the art research facilities.",
  "Diversity & Inclusion at WPI: WPI is committed to creating an inclusive workplace where every student, faculty and staff member can be themselves.",
].join("\n");

const BUZZWORDS = ["PHP", "Drupal", "Angular", "REST", "LAMP Stack", "Web Development"];

function has(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[ ,(])${escaped}([ ,.)]|$)`, "m").test(text);
}

describe("Web Developer (Drupal/PHP/LAMP) posting tailoring", () => {
  let resume;
  let cover;

  beforeAll(async () => {
    resume = (await embeddedEngine.tailorResume({ jobPosting: WPI_POSTING })).result;
    cover = (
      await embeddedEngine.tailorCoverLetter({
        jobPosting: WPI_POSTING,
        jobTitle: "Temporary Computer Science Developer",
        companyName: "Worcester Polytechnic Institute",
      })
    ).result;
  });

  it("surfaces every web buzzword in both documents", () => {
    for (const term of BUZZWORDS) {
      expect(has(resume, term), `résumé missing: ${term}`).toBe(true);
      expect(has(cover, term), `cover letter missing: ${term}`).toBe(true);
    }
    expect(resume).not.toContain("{{");
    expect(cover).not.toContain("{{");
  });

  it("stays web/dev-framed — a 'front-end development' mention does not flip it to UX Engineering", () => {
    for (const uxOnly of ["Design Systems", "Storybook", "Interaction Design", "Tailwind CSS"]) {
      expect(resume, `UX framing leaked: ${uxOnly}`).not.toContain(uxOnly);
    }
    const lines = resume.split("\n");
    const skillsRow1 = (lines[lines.findIndex((l) => l.trim() === "Skills") + 2] || "").trim();
    expect(/Web Development|Enterprise Integration/.test(skillsRow1), `row1: ${skillsRow1}`).toBe(true);
  });

  it("keeps the cover letter industry-framed despite university 'About Us' boilerplate", () => {
    expect(isTeachingPosting(WPI_POSTING)).toBe(false);
    expect(cover).not.toMatch(/\bstudents?\b/i);
    expect(cover).not.toContain("project-based courses");
    expect(cover).toContain("I lead an engineering team of five");
  });

  it("still detects a genuine teaching posting (faculty position / adjunct)", () => {
    expect(isTeachingPosting("Adjunct faculty position to teach undergraduate courses.")).toBe(true);
    expect(isTeachingPosting("Lecturer to develop graduate-level coursework and curriculum.")).toBe(true);
  });
});
