import { describe, it, expect } from "vitest";
import {
  REFERENCE_CONFIG,
  EDUCATION_CONFIG,
  EMPLOYMENT_CONFIG,
} from "./profileEntries.js";

describe("REFERENCE_CONFIG.formatBlock", () => {
  it("joins name/title and company/relationship with the expected separators", () => {
    const text = REFERENCE_CONFIG.formatBlock({
      name: "Jane Doe",
      title: "Engineering Manager",
      company: "Acme",
      relationship: "Former manager",
      email: "jane@acme.com",
      phone: "555-1234",
      notes: "Available on request",
    });
    expect(text).toBe(
      [
        "Jane Doe, Engineering Manager",
        "Acme — Former manager",
        "Email: jane@acme.com",
        "Phone: 555-1234",
        "Available on request",
      ].join("\n"),
    );
  });

  it("omits empty lines and returns empty string for a falsy entry", () => {
    expect(REFERENCE_CONFIG.formatBlock({ name: "Solo" })).toBe("Solo");
    expect(REFERENCE_CONFIG.formatBlock(null)).toBe("");
  });
});

describe("EDUCATION_CONFIG.formatBlock", () => {
  it("uses an en-dash date range and a bullet meta separator", () => {
    const text = EDUCATION_CONFIG.formatBlock({
      school: "State University",
      degree: "B.S.",
      field: "Computer Science",
      location: "Springfield",
      startDate: "2015",
      endDate: "2019",
      gpa: "3.8",
      notes: "Dean's list",
    });
    expect(text).toBe(
      [
        "State University",
        "B.S., Computer Science",
        "Springfield • 2015 – 2019",
        "GPA: 3.8",
        "Dean's list",
      ].join("\n"),
    );
  });
});

describe("EMPLOYMENT_CONFIG", () => {
  it("caps the list at 4 and formats title 'at' company", () => {
    expect(EMPLOYMENT_CONFIG.max).toBe(4);
    const text = EMPLOYMENT_CONFIG.formatBlock({
      title: "Senior Engineer",
      company: "Acme",
      location: "Remote",
      startDate: "2020",
      endDate: "Present",
      notes: "Led the platform team",
    });
    expect(text).toBe(
      [
        "Senior Engineer at Acme",
        "Remote • 2020 – Present",
        "Led the platform team",
      ].join("\n"),
    );
  });
});

describe("sanitize", () => {
  it("coerces missing fields to strings and preserves a valid id", () => {
    const clean = REFERENCE_CONFIG.sanitize({ id: "ref-abc", name: 42 });
    expect(clean.id).toBe("ref-abc");
    expect(clean.name).toBe("42");
    expect(clean.email).toBe("");
  });

  it("generates a prefixed id when one is missing", () => {
    const clean = EDUCATION_CONFIG.sanitize({ school: "X" });
    expect(clean.id).toMatch(/^edu-/);
  });
});
