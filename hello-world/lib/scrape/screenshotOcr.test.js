import { describe, it, expect } from "vitest";
import { fieldsFromText, extractLocation } from "./screenshotOcr.js";

describe("fieldsFromText", () => {
  it("builds the reader contract from OCR text", () => {
    const out = fieldsFromText("Senior Software Engineer\nAcme Corp\nWe are hiring engineers to build great things.");
    expect(out.postingText).toContain("Senior Software Engineer");
    expect(typeof out.jobTitle).toBe("string");
    expect(typeof out.company).toBe("string");
    // searchQuery is the (non-empty) title + company + location joined.
    expect(out.searchQuery).toBe(
      [out.jobTitle, out.company, out.location].filter(Boolean).join(" "),
    );
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

  it("reads the company from a 'Company · Location · time' line under the title", () => {
    const text = "Senior Data Engineer\nNimbus Robotics · San Francisco, CA · 2 days ago\nApply\nAbout the role";
    const out = fieldsFromText(text);
    expect(out.jobTitle).toBe("Senior Data Engineer");
    expect(out.company).toBe("Nimbus Robotics");
  });

  it("prefers a role line over a company-name line the parser latched onto", () => {
    const text = "GitHub\nMenu\nSenior Product Manager - Remote (US)\nWhat you will do\nLead product strategy across teams.";
    const out = fieldsFromText(text);
    expect(out.jobTitle).toBe("Senior Product Manager - Remote (US)");
    expect(out.company).toBe("GitHub");
    expect(out.location).toBe("Remote");
  });

  it("extracts a City, ST location and includes it in the search query", () => {
    const text = "Building Inspector\nDouglas County · Omaha, NE · 3 days ago\nApply now\nInspect residential construction.";
    const out = fieldsFromText(text);
    expect(out.location).toBe("Omaha, NE");
    expect(out.searchQuery).toContain("Omaha, NE");
  });
});

describe("extractLocation", () => {
  it("finds City, ST near the title and validates the state code", () => {
    expect(extractLocation(["Engineer", "Acme · Salt Lake City, UT · today"], "Engineer")).toBe(
      "Salt Lake City, UT",
    );
    // "XX" is not a USPS state code — not a location.
    expect(extractLocation(["Widgets Ltd, XX"], "")).toBe("");
  });

  it("falls back to Remote when only a work-mode marker exists", () => {
    expect(extractLocation(["Engineer", "Fully remote position"], "Engineer")).toBe("Remote");
    expect(extractLocation(["Engineer", "No location anywhere"], "Engineer")).toBe("");
  });
});
