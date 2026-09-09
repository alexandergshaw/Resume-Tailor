// The parser invented employers out of documents that name none.
//
// Measured before the fix:
//
//   a COVER LETTER  -> { title: "Dear Hiring Manager", company: "Vandelay Industries." }
//   a heading-less  -> { title: "Senior Engineer",     company: "Ada Lovelace" }
//   RESUME
//
// The first is the worst thing this product can produce: Vandelay is the company
// being APPLIED TO, so the candidate is coached to tell an interviewer they used
// to work at the interviewer's own company. The second names the candidate as
// their own employer. Both reach the live AND practice answer paths, because
// `answerLocal.js:601` builds `combineMaterial(profile, resume, coverLetter)` and
// hands the whole blob to `profileHeadline`.
//
// TWO causes, and they compound:
//
//   1. Blank lines were filtered out before the parse loop ran, so a salutation
//      and a name three paragraphs above a dated line looked ADJACENT to it and
//      were absorbed into that line's header.
//   2. Any line carrying a date range opened an entry, including an ordinary
//      prose sentence that happens to mention when something happened.
//
// The fix keeps blank lines as block separators and requires a dated line to
// read like a header rather than a sentence. Per the ruling already established
// in parseHeader, returning NOTHING beats returning a wrong employer.
import { describe, it, expect } from "vitest";
import { parseEmploymentHistory } from "./parseEmployment.js";

const COVER_LETTER = `Dear Hiring Manager,

I am writing to apply for the Senior Engineer role at Vandelay Industries.

At Northwind I led the payments migration from 2019 - 2022, cutting deployment time by 40%.
I am excited about the opportunity to bring that experience to your team.

Sincerely,
Ada Lovelace`;

const RESUME_NO_HEADING = `Ada Lovelace
ada@example.com

Senior Engineer, Northwind | 2019 - 2022
- Led the payments migration`;

// The corpus material that the shipped answer suites measure. It must keep
// parsing exactly as it does today.
const LONG_HEADLINE =
  "Senior Staff Software Engineer, Developer Platform and Release Infrastructure, Northwind International Logistics Holdings Limited | 2018 - Present";

const RESUME_WITH_HEADING = `EXPERIENCE

Senior Engineer, Northwind | 2019 - 2022
- Led the payments migration

Junior Engineer, Acme | 2017 - 2019
- Built the billing service`;

// A header block split across lines with NO blank inside it -- the shape the
// header buffer exists for.
const MULTILINE_HEADER = `EXPERIENCE

Northwind International
Senior Engineer
2019 - 2022
- Led the payments migration`;

describe("the parser does not invent an employer", () => {
  it("[instrument] the fixtures are non-trivial", () => {
    // Guards every 'absence' assertion below: if the corpus fixture stopped
    // parsing at all, "no wrong company" would pass for the wrong reason.
    expect(parseEmploymentHistory(LONG_HEADLINE)).toHaveLength(1);
    expect(parseEmploymentHistory(RESUME_WITH_HEADING).length).toBeGreaterThanOrEqual(2);
  });

  it("never reports the company being APPLIED TO as a past employer", () => {
    const companies = parseEmploymentHistory(COVER_LETTER).map((e) => e.company);
    expect(
      companies,
      "Vandelay is the company being applied to; naming it as a past employer tells the " +
        "interviewer you used to work at their own company",
    ).not.toContain("Vandelay Industries.");
    expect(companies.join(" ")).not.toMatch(/Vandelay/);
  });

  it("does not turn a cover letter's salutation into a job title", () => {
    const titles = parseEmploymentHistory(COVER_LETTER).map((e) => e.title);
    expect(titles.join(" ")).not.toMatch(/Dear Hiring Manager/);
  });

  it("reports NOTHING at all from a cover letter rather than guessing", () => {
    // A cover letter has no employment header. Every possible entry is invented,
    // so the honest output is none.
    expect(parseEmploymentHistory(COVER_LETTER)).toEqual([]);
  });

  it("does not report the CANDIDATE'S OWN NAME as their employer", () => {
    const [entry] = parseEmploymentHistory(RESUME_NO_HEADING);
    expect(entry, "the heading-less resume must still yield its one real entry").toBeTruthy();
    expect(entry.company, "the name at the top of a resume is not an employer").not.toBe("Ada Lovelace");
    expect(entry.company).toBe("Northwind");
    expect(entry.title).toBe("Senior Engineer");
  });

  it("GUARD (passes before the fix too): the corpus header is unchanged", () => {
    const [entry] = parseEmploymentHistory(LONG_HEADLINE);
    expect(entry.title).toBe("Senior Staff Software Engineer");
    expect(entry.company).toBe("Northwind International Logistics Holdings Limited");
    expect(entry.startDate).toBe("2018");
    expect(entry.endDate).toBe("Present");
  });

  it("GUARD (passes before the fix too): an ordinary sectioned resume still parses", () => {
    const entries = parseEmploymentHistory(RESUME_WITH_HEADING);
    expect(entries.map((e) => [e.title, e.company])).toEqual([
      ["Senior Engineer", "Northwind"],
      ["Junior Engineer", "Acme"],
    ]);
    expect(entries[0].notes).toContain("Led the payments migration");
  });

  it("still assembles a header split across adjacent lines", () => {
    // The header buffer's real purpose: company and title on their own lines
    // above the date, with no blank between them.
    const [entry] = parseEmploymentHistory(MULTILINE_HEADER);
    expect(entry).toBeTruthy();
    expect(entry.title).toBe("Senior Engineer");
    expect(entry.company).toBe("Northwind International");
  });

  it("keeps a dated line that names a job even when it ends in a period", () => {
    // A date-first header ending in a legal suffix must NOT be mistaken for prose.
    const [entry] = parseEmploymentHistory("2019 - 2022 | Senior Engineer, Northwind Inc.");
    expect(entry, "a header ending in 'Inc.' is still a header").toBeTruthy();
    expect(entry.title).toBe("Senior Engineer");
  });
});
