// parseHeader took the FIRST part that was not the title as the employer. A
// résumé header very commonly reads "Title, Department, Company", so the first
// remaining part is the DEPARTMENT, and the app went on to coach the candidate
// to say it out loud:
//
//     Situation: I was at Developer Platform and Release Infrastructure.
//
// when the employer is Northwind. Stating a false employer is the worst error
// this product can make, because the interviewer is the one person guaranteed
// to know the right answer. Measured on the `longHeadline` corpus material it
// reached 24 practice cells; it is pre-existing, and only became prominent when
// roleClause started leading the sentence with it.
//
// The discriminator is already in this module: a part that NAMES A JOB is not
// an employer. TITLE_KEYWORDS_RE is the word-anchored form, and the anchoring is
// what makes it usable here -- the unanchored TITLE_KEYWORDS beside it would
// find `head` inside "Overhead" and throw away a real company (see the last
// case). When every remaining part names a job, the header carries no employer
// at all, and the honest answer is to say nothing rather than to name a team.
import { describe, it, expect } from "vitest";
import { parseEmploymentHistory, TITLE_KEYWORDS_RE } from "./parseEmployment.js";

/** The company parsed out of a single header line. */
function companyOf(header) {
  const [entry] = parseEmploymentHistory(header, { maxEntries: 1 });
  return entry ? entry.company : null;
}

function titleOf(header) {
  const [entry] = parseEmploymentHistory(header, { maxEntries: 1 });
  return entry ? entry.title : null;
}

// The exact string from the corpus material that produced the false employer.
const LONG_HEADLINE =
  "Senior Staff Software Engineer, Developer Platform and Release Infrastructure, Northwind International Logistics Holdings Limited | 2018 - Present";

describe("parseHeader does not report a department as the employer", () => {
  it("[instrument] the fixture really does parse into an entry at all", () => {
    // Without this, every assertion below could be reading `null` and passing
    // for the wrong reason.
    const [entry] = parseEmploymentHistory(LONG_HEADLINE, { maxEntries: 1 });
    expect(entry, "the corpus header no longer parses into any entry").toBeTruthy();
    expect(entry.title).toBeTruthy();
  });

  it("names the employer, not the team, on a Title/Department/Company header", () => {
    expect(
      companyOf(LONG_HEADLINE),
      "the candidate is coached to say this out loud; a department here is a false employer",
    ).toBe("Northwind International Logistics Holdings Limited");
  });

  it("does not name the department under any circumstance", () => {
    expect(companyOf(LONG_HEADLINE)).not.toBe("Developer Platform and Release Infrastructure");
    expect(companyOf(LONG_HEADLINE)).not.toMatch(/Developer Platform/);
  });

  it("still keeps the title itself", () => {
    expect(titleOf(LONG_HEADLINE)).toBe("Senior Staff Software Engineer");
  });

  it("GUARD (passes before the fix too): the ordinary two-part header is unchanged", () => {
    // A control. "Title, Company" is by far the commonest shape and must not
    // regress; if this ever goes red the fix has over-reached.
    expect(companyOf("Senior Engineer, Northwind | 2019 - 2022")).toBe("Northwind");
    expect(titleOf("Senior Engineer, Northwind | 2019 - 2022")).toBe("Senior Engineer");
  });

  it("GUARD (passes before the fix too): company-first headers still work", () => {
    expect(companyOf("Northwind — Senior Engineer | 2019 - 2022")).toBe("Northwind");
  });

  it("says NOTHING when the header carries a department but no employer", () => {
    // There is no employer anywhere in this string, so every possible answer
    // except silence is false. An empty company makes roleClause fall back to a
    // clause that claims no employer at all, which is the correct behaviour.
    expect(
      companyOf("Senior Engineer, Developer Platform and Release Infrastructure | 2019 - 2022"),
      "naming a team as the employer is worse than naming no employer",
    ).toBe("");
  });

  it("does not eat a real company whose name merely CONTAINS a job word", () => {
    // "Overhead" contains `head`, and `head` is in the job vocabulary. The
    // word-anchored TITLE_KEYWORDS_RE is what keeps this company; the unanchored
    // TITLE_KEYWORDS would reject it and leave the candidate employer-less.
    expect(TITLE_KEYWORDS_RE.test("Overhead Door Company")).toBe(false);
    expect(companyOf("Senior Engineer, Overhead Door Company | 2019 - 2022")).toBe("Overhead Door Company");
  });
});
