// AC-L3: a resume BULLET must never be presented as a job title or an employer.
//
// Reported line, verbatim:
//   "Collaborated with business leaders at and development teams to translate
//    product roadmaps into detailed requirements"
// which is roleText() joining a mis-parsed title and company with " at ".
//
// Reproduced before this test was written. parseEmploymentHistory is
// best-effort by design (its own header says so): on a resume whose bullets
// carry no bullet marker and wrap across lines it anchors an entry on the date
// line and treats the preceding wrapped prose as the header, returning
//   title:   "Collaborated with business leaders"
//   company: "and development teams to translate product roadmaps into detailed requirements"
// The parser is not the thing to fix — every resume format it cannot read is a
// new special case. resumeAnchor is what PRESENTS these to the candidate, so
// that is where the plausibility gate belongs.

import { describe, it, expect } from "vitest";
import { resumeAnchor } from "./resumeAnchor.js";

const QUESTION =
  "Could you tell me a bit about your experience working with technology platforms within a higher education environment?";
const POINTS = [
  "I spent three years as a Product Curriculum Lead building learning tools used across a university system.",
];

// Bullets with no marker, wrapping across lines, date line after them.
const WRAPPED = `Alex Shaw
Product Manager

PROFESSIONAL EXPERIENCE

Collaborated with business leaders
and development teams to translate product roadmaps into detailed requirements
Contributed to product roadmaps and executed product features
Jan 2022 - Present
Analyzed business needs and translated them into detailed product requirements
Partnered with instructional designers to ship curriculum tooling used by 3,000 students
`;

// The same material in a shape the parser reads correctly.
const CLEAN = `Alex Shaw
Product Manager

PROFESSIONAL EXPERIENCE

Product Curriculum Lead, Acme Learning
Jan 2022 - Present
• Collaborated with business leaders and development teams to translate product roadmaps into detailed requirements
• Partnered with instructional designers to ship curriculum tooling used by 3,000 students
`;

describe("resumeAnchor plausibility gate", () => {
  it("does not present a resume bullet as a job title or an employer", () => {
    const anchor = resumeAnchor(WRAPPED, { question: QUESTION, points: POINTS });
    expect(anchor.title).toBe("");
    expect(anchor.company).toBe("");
  });

  it("cannot produce the reported line", () => {
    const anchor = resumeAnchor(WRAPPED, { question: QUESTION, points: POINTS });
    const rendered = anchor.title && anchor.company ? `${anchor.title} at ${anchor.company}` : anchor.title || anchor.company;
    expect(rendered).not.toMatch(/Collaborated with business leaders/);
    expect(rendered).not.toMatch(/ at and /);
  });

  it("still returns the project and the role's other bullets when the header could not be read", () => {
    const anchor = resumeAnchor(WRAPPED, { question: QUESTION, points: POINTS });
    expect(anchor.project.trim()).not.toBe("");
    expect(Array.isArray(anchor.description)).toBe(true);
    expect(anchor.description.length).toBeGreaterThan(0);
  });

  it("keeps a real title and a real employer untouched", () => {
    const anchor = resumeAnchor(CLEAN, { question: QUESTION, points: POINTS });
    expect(anchor.title).toBe("Product Curriculum Lead");
    expect(anchor.company).toBe("Acme Learning");
    expect(anchor.project.trim()).not.toBe("");
  });

  it("rejects a field that is prose rather than a name", () => {
    const cases = [
      // verb-initial: a resume bullet, not a title
      `EXPERIENCE\nBuilt and scaled the reporting platform for eleven teams\nJan 2020 - Dec 2021\n• Ran the migration end to end`,
      // lowercase-initial: a wrapped continuation, not a name
      `EXPERIENCE\nand development teams across three regions\nJan 2020 - Dec 2021\n• Ran the migration end to end`,
      // sentence punctuation mid-string
      `EXPERIENCE\nOwned the roadmap. Reported to the VP of Product\nJan 2020 - Dec 2021\n• Ran the migration end to end`,
    ];
    for (const text of cases) {
      const anchor = resumeAnchor(text, { question: QUESTION, points: POINTS });
      expect(anchor.title).toBe("");
      expect(anchor.company).toBe("");
    }
  });

  it("still returns null when there is no material at all", () => {
    expect(resumeAnchor("", { question: QUESTION, points: POINTS })).toBeNull();
    expect(resumeAnchor(null, { question: QUESTION, points: POINTS })).toBeNull();
  });
});
