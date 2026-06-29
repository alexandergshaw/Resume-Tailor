import { describe, it, expect } from "vitest";
import { extractPostingMeta } from "./postingMeta.js";

describe("extractPostingMeta", () => {
  it("parses the app's normalized job-card shape (title / 'Company in Location')", () => {
    const posting = [
      "Subject Matter Expert Course Design - LE3 Program",
      "National Louis University in Online/Remote",
      "  ",
      "Type: Adjunct/Part-Time",
      "Posted: 1 day ago",
      "Category: Entrepreneurship",
      "",
      "Overview",
      "National Louis University's LE3 Program is currently seeking Adjunct Faculty...",
    ].join("\n");
    const { jobTitle, companyName } = extractPostingMeta(posting);
    expect(jobTitle).toBe("Subject Matter Expert Course Design - LE3 Program");
    expect(companyName).toBe("National Louis University");
  });

  it("handles '<Title> at <Company>' on the first line", () => {
    const { jobTitle, companyName } = extractPostingMeta("Senior Backend Engineer at Stripe\nRemote");
    expect(jobTitle).toBe("Senior Backend Engineer");
    expect(companyName).toBe("Stripe");
  });

  it("honors explicit Company: / Title: labels", () => {
    const posting = "Position: Staff Data Engineer\nCompany: Acme, Inc.\nLocation: NYC";
    const { jobTitle, companyName } = extractPostingMeta(posting);
    expect(jobTitle).toBe("Staff Data Engineer");
    expect(companyName).toBe("Acme, Inc.");
  });

  it("returns empty for a header-less prose description (no wrong guess)", () => {
    const posting =
      "We are looking for a talented engineer to join our growing team and build great products for our customers.";
    const { jobTitle, companyName } = extractPostingMeta(posting);
    expect(jobTitle).toBe("");
    expect(companyName).toBe("");
  });

  it("is empty-safe", () => {
    expect(extractPostingMeta("")).toEqual({ jobTitle: "", companyName: "" });
    expect(extractPostingMeta(null)).toEqual({ jobTitle: "", companyName: "" });
  });

  it("handles a scraped page: strips the site suffix, skips nav junk, finds the org", () => {
    // Mirrors careers.umich.edu scraped to text: <title> first, then nav chrome,
    // a 'Working Title' label block, and the employer named in the body.
    const posting = [
      "Fall 2026 Course Assistant for UMSI | U-M Careers",
      "Skip to main content",
      "twitter",
      "rss",
      "Login",
      "Help and FAQ",
      "Main navigation",
      "Home",
      "Search Jobs",
      "Job Summary",
      "The University of Michigan School of Information (UMSI) is a progressive school.",
      "Working Title",
      "Fall 2026 Course Assistant for UMSI",
      "Job Title",
      "INSTRUCTIONAL AIDE (TEMP)",
      "Department",
      "School of Information",
    ].join("\n");
    const { jobTitle, companyName } = extractPostingMeta(posting);
    expect(jobTitle).toBe("Fall 2026 Course Assistant for UMSI"); // 'Working Title' value, no '| U-M Careers'
    expect(companyName).toBe("University of Michigan"); // not "Skip to main content"
  });

  it("picks the employer named at the top, not a consortium org in the boilerplate", () => {
    // Smith College posting: the employer is named in the header, but the "About"
    // section mentions "the University of Massachusetts Amherst". The employer must
    // win — not the University-of pattern matched lower in the page.
    const posting = [
      "Drupal and Integrations Developer",
      "Smith College in Northampton, MA",
      "Type: Full-Time",
      "Department: Communications and Marketing",
      "Job Summary",
      "Maintain, manage and improve mission critical enterprise applications.",
      "About Smith College",
      "Smith College is a member of the Five College Consortium with Amherst, Hampshire and Mt. Holyoke Colleges, and the University of Massachusetts Amherst.",
    ].join("\n");
    const { jobTitle, companyName } = extractPostingMeta(posting);
    expect(jobTitle).toBe("Drupal and Integrations Developer");
    expect(companyName).toBe("Smith College");
  });

  it("prefers a University employer at the top over a College in the boilerplate", () => {
    // The symmetric case: a "University of …" employer in the header must still win
    // over a "… College" named lower (so the document-order fix isn't just biased
    // toward colleges).
    const posting = [
      "Research Software Engineer",
      "University of Massachusetts Amherst in Amherst, MA",
      "About",
      "We are part of the Five College Consortium with Smith College and Amherst College.",
    ].join("\n");
    expect(extractPostingMeta(posting).companyName).toBe("University of Massachusetts Amherst");
  });

  it("keeps the header employer when partner orgs appear later in the body", () => {
    const posting = [
      "Backend Engineer",
      "Globex Corporation",
      "We partner closely with Initech Inc. and Acme LLC across the industry.",
    ].join("\n");
    expect(extractPostingMeta(posting).companyName).toBe("Globex Corporation");
  });

  it("detects corporate org suffixes (Inc/LLC/Technologies) and ignores leading 'The'", () => {
    expect(extractPostingMeta("Backend Engineer\nGlobex Technologies is hiring engineers.").companyName).toBe(
      "Globex Technologies",
    );
    expect(extractPostingMeta("Analyst\nThe Acme Corporation values data.").companyName).toBe("Acme Corporation");
  });
});
