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
});
