import { describe, it, expect, beforeAll } from "vitest";
import { embeddedEngine } from "./engine.js";

// Regression guard for the tailoring built up around the Smith College
// "Drupal and Integrations Developer" posting: every posting buzzword must surface
// in BOTH the résumé and the cover letter, the role must stay web/dev-framed (not
// hijacked by the Cybersecurity focus area), and the specialized stack must stay
// gated to postings that ask for it.
const DRUPAL_POSTING = [
  "Drupal and Integrations Developer - Smith College",
  "Department: Communications and Marketing. Category: Web Developer.",
  "Essential Functions:",
  "Develop and maintain custom Drupal 10+ modules using modern APIs and best practices.",
  "Maintain security within the applications and manage routine updates and patching.",
  "Design and implement secure API integrations with enterprise platforms (Salesforce, Slate, Workday).",
  "Maintain and modernize legacy PHP codebases.",
  "Partner with Marketing to leverage analytics tracking, GA4 events, and server-side tagging.",
  "Monitor and optimize Core Web Vitals and site speed to support SEO.",
  "Manage hosting environments (Pantheon), including deployment pipelines (CI/CD), configuration management, regression testing, security and version updates.",
  "Document technical implementations and integration patterns.",
  "Minimum Requirements: Bachelor's in Computer Science. 5+ years Drupal backend and integrations development.",
  "Knowledge of: Drupal 10+ architecture, REST APIs, JSON, OAuth, and authentication workflows.",
  "Skills: Proficiency in Drupal, Javascript, PHP, Composer and Git.",
  "Preferred: 8+ years Drupal, Wordpress and API development.",
  "Knowledge of REST APIs, JSON, OAuth, authentication workflows, WordPress, Salesforce Marketing Cloud, Workday, Technolutions Slate CRM.",
  "Proficiency in Drupal and WordPress architecture, JavaScript, React, PHP, Composer and Git; extensive experience with modern APIs and ETL processes.",
].join("\n");

// The canonical display strings every Drupal-posting buzzword should render as.
const BUZZWORDS = [
  "Drupal", "PHP", "JavaScript", "React", "WordPress", "Composer", "Git",
  "REST", "JSON", "OAuth", "Authentication", "ETL",
  "Salesforce", "Slate", "Workday", "Pantheon", "Google Analytics",
  "Server-Side Tagging", "Core Web Vitals", "Configuration Management",
  "Regression Testing", "CI/CD", "SEO",
];

// Whole-token / whole-phrase presence (so "REST" doesn't match "RESTful", etc.).
function has(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[ ,(])${escaped}([ ,.)]|$)`, "m").test(text);
}

describe("Drupal/Integrations posting tailoring", () => {
  let resume;
  let cover;

  beforeAll(async () => {
    resume = (await embeddedEngine.tailorResume({ jobPosting: DRUPAL_POSTING })).result;
    cover = (
      await embeddedEngine.tailorCoverLetter({
        jobPosting: DRUPAL_POSTING,
        jobTitle: "Drupal and Integrations Developer",
        companyName: "Smith College",
      })
    ).result;
  });

  it("surfaces every posting buzzword in the résumé", () => {
    for (const term of BUZZWORDS) expect(has(resume, term), `résumé missing: ${term}`).toBe(true);
    expect(resume).not.toContain("{{"); // nothing left unfilled
  });

  it("surfaces every posting buzzword in the cover letter", () => {
    for (const term of BUZZWORDS) expect(has(cover, term), `cover letter missing: ${term}`).toBe(true);
    expect(cover).not.toContain("{{");
  });

  it("stays web/dev-framed — a few security mentions do not flip it to Cybersecurity", () => {
    // These are the Cybersecurity focus area's job_emphases / domain_capabilities;
    // they must NOT appear for a Drupal developer posting (the area must not trigger).
    for (const cyberOnly of ["Application Security", "Secure Architecture", "Secure Development", "Vulnerability Management"]) {
      expect(resume, `cyber framing leaked: ${cyberOnly}`).not.toContain(cyberOnly);
      expect(cover, `cyber framing leaked: ${cyberOnly}`).not.toContain(cyberOnly);
    }
    // A web/dev domain leads the full-time roles instead.
    const firstRole = resume.split("\n").find((l) => /\| Mutual of Omaha \| July 2023/.test(l)) || "";
    const emphasis = (firstRole.match(/\(([^)]*)\)/) || [, ""])[1];
    expect(/Web Development|Enterprise Integration|ETL|SEO/.test(emphasis), `unexpected emphasis: ${emphasis}`).toBe(true);
  });

  it("keeps the specialized stack out of an unrelated software posting (conditional gating)", async () => {
    const swe = (
      await embeddedEngine.tailorResume({
        jobPosting: "Senior Software Engineer. React, TypeScript, SQL, PostgreSQL. Build scalable web apps. Agile, CI/CD, payments.",
      })
    ).result;
    for (const niche of ["Drupal", "WordPress", "Composer", "Pantheon", "Salesforce", "Workday", "Slate"]) {
      expect(swe, `niche skill leaked onto unrelated résumé: ${niche}`).not.toContain(niche);
    }
  });

  it("addresses the cover letter to the employer, not a consortium org in the boilerplate", async () => {
    const posting = [
      "Drupal and Integrations Developer",
      "Smith College in Northampton, MA",
      "Job Summary: Maintain enterprise Drupal applications and integrations.",
      "About Smith College",
      "Smith College is a member of the Five College Consortium with Amherst, Hampshire and Mt. Holyoke Colleges, and the University of Massachusetts Amherst.",
    ].join("\n");
    // No companyName passed -> the engine extracts the org from the posting.
    const cl = (await embeddedEngine.tailorCoverLetter({ jobPosting: posting })).result;
    expect(cl).toContain("Smith College");
    expect(cl).not.toContain("University of Massachusetts Amherst");
  });

  it("keeps the cover-letter technical-skills line short for a non-technical posting", async () => {
    const mathCover = (
      await embeddedEngine.tailorCoverLetter({
        jobPosting: "Adjunct Faculty to teach College Algebra and Precalculus to a diverse student body. Provide quality instruction.",
        jobTitle: "Adjunct Faculty",
        companyName: "Community College",
      })
    ).result;
    const line = mathCover.split("\n").find((l) => /technical toolkit for this kind of work spans/.test(l));
    expect(line, "toolkit sentence missing").toBeTruthy();
    const list = line.replace(/.*spans /, "").replace(/\.$/, "");
    const count = list.split(/,| and /).filter((s) => s.trim()).length;
    expect(count, `toolkit line too long for a non-technical posting: ${count} items`).toBeLessThanOrEqual(8);
    // The niche Drupal stack must not be dragged into an unrelated cover letter.
    expect(mathCover).not.toContain("Drupal");
    expect(mathCover).not.toContain("Salesforce");
  });
});
