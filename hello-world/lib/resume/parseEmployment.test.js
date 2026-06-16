import { describe, it, expect } from "vitest";
import { parseEmploymentHistory, extractDateRange } from "./parseEmployment.js";

describe("extractDateRange", () => {
  it("parses month-year ranges", () => {
    expect(extractDateRange("Jan 2020 - Mar 2023")).toMatchObject({
      start: "Jan 2020",
      end: "Mar 2023",
    });
  });

  it("normalizes Present/Current", () => {
    expect(extractDateRange("June 2021 – Present").end).toBe("Present");
    expect(extractDateRange("2019 to current").end).toBe("Present");
  });

  it("parses bare years and numeric dates", () => {
    expect(extractDateRange("2018 - 2020")).toMatchObject({ start: "2018", end: "2020" });
    expect(extractDateRange("01/2019 - 08/2021")).toMatchObject({
      start: "01/2019",
      end: "08/2021",
    });
  });

  it("returns null when there is no range", () => {
    expect(extractDateRange("Acme Corporation")).toBeNull();
  });
});

describe("parseEmploymentHistory", () => {
  it("extracts entries and stops at the next section", () => {
    const text = [
      "Experience",
      "Senior Software Engineer, Acme Corp — San Francisco, CA",
      "Jan 2020 - Present",
      "• Built and shipped the onboarding flow",
      "• Led a team of 5 engineers",
      "Junior Developer at Beta Inc",
      "New York, NY | 2018 - 2020",
      "• Maintained the billing service",
      "Education",
      "B.S. Computer Science, State University, 2014 - 2018",
    ].join("\n");

    const entries = parseEmploymentHistory(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      company: "Acme Corp",
      title: "Senior Software Engineer",
      location: "San Francisco, CA",
      startDate: "Jan 2020",
      endDate: "Present",
      notes: "Built and shipped the onboarding flow\nLed a team of 5 engineers",
    });
    expect(entries[1]).toMatchObject({
      company: "Beta Inc",
      title: "Junior Developer",
      location: "New York, NY",
      startDate: "2018",
      endDate: "2020",
      notes: "Maintained the billing service",
    });
  });

  it("accepts an array of lines", () => {
    const entries = parseEmploymentHistory([
      "Work Experience",
      "Product Manager",
      "Globex Corporation, Remote",
      "Feb 2022 - Present",
      "- Owned the roadmap",
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: "Product Manager",
      company: "Globex Corporation",
      location: "Remote",
      startDate: "Feb 2022",
      endDate: "Present",
      notes: "Owned the roadmap",
    });
  });

  it("caps the number of entries", () => {
    const lines = ["Employment History"];
    for (let i = 0; i < 6; i += 1) {
      lines.push(`Engineer ${i} at Company ${i}`);
      lines.push("2010 - 2011");
    }
    expect(parseEmploymentHistory(lines)).toHaveLength(4);
    expect(parseEmploymentHistory(lines, { maxEntries: 2 })).toHaveLength(2);
  });

  it("handles a single-line header with title, company, location and dates", () => {
    const entries = parseEmploymentHistory([
      "Experience",
      "Data Analyst | Initech | Austin, TX | 2019 - 2021",
    ]);
    expect(entries[0]).toMatchObject({
      title: "Data Analyst",
      company: "Initech",
      location: "Austin, TX",
      startDate: "2019",
      endDate: "2021",
    });
  });

  it("returns an empty array when there is no employment content", () => {
    expect(parseEmploymentHistory("")).toEqual([]);
    expect(parseEmploymentHistory("Skills: JavaScript, Python, SQL")).toEqual([]);
    expect(parseEmploymentHistory(null)).toEqual([]);
  });

  it("does not create an entry from a stray date with no header", () => {
    // A date line with no recognizable title/company is skipped.
    const entries = parseEmploymentHistory(["Experience", "2015 - 2017"]);
    expect(entries).toEqual([]);
  });
});
