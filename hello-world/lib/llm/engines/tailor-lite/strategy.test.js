import { describe, it, expect } from "vitest";
import { mapSlots } from "./strategy.js";

const keywords = {
  technology: [
    { canonical: "React", score: 9, count: 1 },
    { canonical: "HTML", score: 8, count: 1 },
  ],
  tool_platform: [{ canonical: "Figma", score: 7, count: 1 }],
  domain: [{ canonical: "Web Development", score: 7, count: 1 }],
  soft_skill: [{ canonical: "Leadership", score: 5, count: 1 }],
};
const data = { profile: { values: { RANK: "Senior" } } };
const slot = (name, occ = 0) => ({ key: `${name}::${occ}`, name, occurrence: occ });

describe("mapSlots (template strategies)", () => {
  const slots = [
    slot("RANK"),
    slot("JOB_RELEVANT_TECHNOLOGIES"),
    slot("TECHNICAL_CAPABILITIES"),
    slot("2_LINES_OF_COMMA_SEPARATED_SKILLS", 1),
    slot("LIST_OF_3_COURSE_TOPICS_RELEVANT_TO_JOB_POSTING"),
    slot("ACTION"),
    slot("MEASURABLE_IMPACT"),
    slot("PROJECT_TYPE"),
    slot("WIDGET_FROBNICATOR"),
  ];
  const byKey = Object.fromEntries(mapSlots(slots, keywords, data).map((s) => [s.key, s]));

  it("PROFILE comes from profile.json", () => {
    expect(byKey["RANK::0"].strategy).toBe("profile");
    expect(byKey["RANK::0"].value).toBe("Senior");
  });

  it("KEYWORD_JOIN surfaces posting keywords by category (no cross-slot overlap)", () => {
    expect(byKey["JOB_RELEVANT_TECHNOLOGIES::0"].value).toContain("React"); // technology
    expect(byKey["TECHNICAL_CAPABILITIES::0"].value).toContain("Figma"); // tool_platform
    expect(byKey["JOB_RELEVANT_TECHNOLOGIES::0"].value).not.toContain("Figma");
  });

  it("SKILLS rows and COURSE_TOPICS fill non-empty", () => {
    expect(byKey["2_LINES_OF_COMMA_SEPARATED_SKILLS::1"].value.length).toBeGreaterThan(0);
    expect(byKey["LIST_OF_3_COURSE_TOPICS_RELEVANT_TO_JOB_POSTING::0"].value.length).toBeGreaterThan(0);
  });

  it("fragment/project pools fill accomplishment + project slots", () => {
    expect(byKey["ACTION::0"].value.length).toBeGreaterThan(0);
    expect(byKey["MEASURABLE_IMPACT::0"].value.length).toBeGreaterThan(0);
    expect(byKey["PROJECT_TYPE::0"].value.length).toBeGreaterThan(0);
  });

  it("unknown name falls to MANUAL (empty)", () => {
    expect(byKey["WIDGET_FROBNICATOR::0"].strategy).toBe("manual");
    expect(byKey["WIDGET_FROBNICATOR::0"].value).toBe("");
  });
});

describe("mapSlots skills-row gap insertion (aggressiveness)", () => {
  // Kubernetes is a domain/tool gap the candidate lacks; it should only appear at
  // high aggressiveness, swapped into the matching skills row.
  const kw = { tool_platform: [{ canonical: "Kubernetes", score: 9, count: 1 }] };
  const universe = new Set(["figma", "git", "github", "docker", "aws"]); // lacks Kubernetes
  const skillRow2 = (aggressiveness) =>
    mapSlots(
      [{ key: "2_LINES_OF_COMMA_SEPARATED_SKILLS::2", name: "2_LINES_OF_COMMA_SEPARATED_SKILLS", occurrence: 2 }],
      kw,
      { profile: { values: {} } },
      { aggressiveness, universe },
    )[0].value;

  it("does not fabricate at aggressiveness 1", () => {
    expect(skillRow2(1)).not.toContain("Kubernetes");
  });

  it("swaps in the gap keyword at high aggressiveness", () => {
    expect(skillRow2(5)).toContain("Kubernetes");
  });
});
