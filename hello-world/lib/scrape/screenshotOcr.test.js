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
});
