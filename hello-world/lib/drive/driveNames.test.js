import { describe, it, expect } from "vitest";
import { driveDocName } from "./driveNames.js";

describe("driveDocName", () => {
  it("uses the sanitized, truncated override when the file-name field has a value", () => {
    expect(
      driveDocName({ override: "My Custom Name", jobTitle: "SWE", company: "Acme", kind: "Resume" }),
    ).toBe("My Custom Name");
  });

  it("strips forbidden characters from the override -- positive control: they were present", () => {
    const withForbidden = 'a\\b/c:d*e?f"g<h>i|j';
    // Positive control: prove the forbidden characters really were in the
    // raw input, so a dead/no-op sanitizer can't pass this test by never
    // seeing them.
    expect(/[\\/:*?"<>|]/.test(withForbidden)).toBe(true);
    const result = driveDocName({ override: withForbidden, jobTitle: "T", company: "C", kind: "Resume" });
    expect(result).toBe("abcdefghij");
    expect(/[\\/:*?"<>|]/.test(result)).toBe(false);
  });

  it("truncates an override longer than 150 characters", () => {
    const long = "x".repeat(200);
    const result = driveDocName({ override: long, jobTitle: "T", company: "C", kind: "Resume" });
    expect(result).toHaveLength(150);
    expect(result).toBe("x".repeat(150));
  });

  it("falls back to the derived name when the override is blank", () => {
    expect(driveDocName({ override: "", jobTitle: "Senior Engineer", company: "Acme", kind: "Resume" })).toBe(
      "Acme - Senior Engineer - Resume",
    );
  });

  it("falls back to the derived name when the override is only whitespace", () => {
    expect(driveDocName({ override: "   ", jobTitle: "Senior Engineer", company: "Acme", kind: "Resume" })).toBe(
      "Acme - Senior Engineer - Resume",
    );
  });

  it("falls back to the derived name when the override is omitted", () => {
    expect(driveDocName({ jobTitle: "Senior Engineer", company: "Acme", kind: "Resume" })).toBe(
      "Acme - Senior Engineer - Resume",
    );
  });

  it("uses the 'Target Role' fallback for a blank job title", () => {
    expect(driveDocName({ override: "", jobTitle: "", company: "Acme", kind: "Resume" })).toBe(
      "Acme - Target Role - Resume",
    );
  });

  it("drops the company segment when company is unknown, never leaving a stray leading dash", () => {
    const result = driveDocName({ override: "", jobTitle: "Senior Engineer", company: "", kind: "Resume" });
    expect(result).toBe("Senior Engineer - Resume");
    expect(result.startsWith(" - ")).toBe(false);
  });

  it("never ends in .docx via the fallback branch", () => {
    const result = driveDocName({ override: "", jobTitle: "Senior Engineer", company: "Acme", kind: "Resume" });
    expect(result.endsWith(".docx")).toBe(false);
  });

  it("distinguishes the cover-letter kind from the resume kind", () => {
    const resumeName = driveDocName({ override: "", jobTitle: "Senior Engineer", company: "Acme", kind: "Resume" });
    const coverName = driveDocName({ override: "", jobTitle: "Senior Engineer", company: "Acme", kind: "CL" });
    expect(resumeName).toBe("Acme - Senior Engineer - Resume");
    expect(coverName).toBe("Acme - Senior Engineer - CL");
    expect(resumeName).not.toBe(coverName);
  });
});
