import { describe, it, expect } from "vitest";
import { fieldsFromText } from "./screenshotOcr.js";

describe("fieldsFromText", () => {
  it("builds the reader contract from OCR text", () => {
    const out = fieldsFromText("Senior Software Engineer\nAcme Corp\nWe are hiring engineers to build great things.");
    expect(out.postingText).toContain("Senior Software Engineer");
    expect(typeof out.jobTitle).toBe("string");
    expect(typeof out.company).toBe("string");
    // searchQuery is just the (non-empty) title + company joined.
    expect(out.searchQuery).toBe([out.jobTitle, out.company].filter(Boolean).join(" "));
  });

  it("handles empty input", () => {
    const out = fieldsFromText("");
    expect(out.postingText).toBe("");
    expect(out.searchQuery).toBe("");
  });

  it("skips nav chrome and picks the role line as the title", () => {
    const text =
      "Jobs  Home  Sign in\n☆ Save  Share\nStaff Software Engineer, Backend\nGitLab\nApply now  3 days ago\nWe are looking for a Staff Software Engineer.";
    const out = fieldsFromText(text);
    expect(out.jobTitle).toBe("Staff Software Engineer, Backend");
    expect(out.company).toBe("GitLab");
  });

  it("prefers a role line over a company-name line the parser latched onto", () => {
    const text = "GitHub\nMenu\nSenior Product Manager - Remote (US)\nWhat you will do\nLead product strategy across teams.";
    const out = fieldsFromText(text);
    expect(out.jobTitle).toBe("Senior Product Manager - Remote (US)");
    expect(out.company).toBe("GitHub");
  });
});
