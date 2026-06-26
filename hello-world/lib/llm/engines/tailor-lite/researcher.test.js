import { describe, it, expect } from "vitest";
import { mapResearch } from "./researcher.js";

describe("mapResearch", () => {
  it("turns structured facts into cover-letter phrases and keeps overview/news advisory", () => {
    const { advisory, facts } = mapResearch({
      company: { profile: { industry: "Insurance" } },
      role: { responsibilities: { essential_skills: ["digital strategy", "UX direction"] } },
      overviews: [{ text: "An insurer.", source: "wikipedia" }],
      news: [{ title: "Good news", source: "gdelt" }],
    });
    expect(facts.ORGANIZATION_CONTEXT).toBe("your work in Insurance");
    expect(facts.ROLE_FOCUS).toBe("digital strategy, UX direction");
    expect(advisory.overviews).toHaveLength(1);
    expect(advisory.news).toHaveLength(1);
  });

  it("emits no facts when fields are missing (slots fall back / stay visible)", () => {
    const { advisory, facts } = mapResearch({});
    expect(facts).toEqual({});
    expect(advisory.overviews).toEqual([]);
    expect(advisory.news).toEqual([]);
  });
});
