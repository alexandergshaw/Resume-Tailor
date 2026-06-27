import { describe, it, expect } from "vitest";
import { research } from "./researcher.js";

describe("research (in-house)", () => {
  const posting = "Senior Engineer at a healthcare company. Requirements: JavaScript, React, SQL, REST APIs, Agile.";

  it("derives ORGANIZATION_CONTEXT (company + domain) and ROLE_FOCUS from the posting", () => {
    const { facts } = research({ posting, company: "Acme Health" });
    expect(facts.ORGANIZATION_CONTEXT).toContain("Acme Health");
    expect(typeof facts.ROLE_FOCUS).toBe("string");
    expect(facts.ROLE_FOCUS.length).toBeGreaterThan(0);
  });

  it("falls back to a domain-only context when no company is given", () => {
    const { facts } = research({ posting });
    expect(facts.ORGANIZATION_CONTEXT).toMatch(/^your work in /);
  });

  it("returns advisory derived from the posting (report-only)", () => {
    const { advisory } = research({ posting, company: "Acme Health" });
    expect(advisory.source).toMatch(/in-app/);
    expect(advisory.topKeywords.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same input", () => {
    const args = { posting, company: "Acme Health" };
    expect(research(args)).toEqual(research(args));
  });
});
