import { describe, it, expect } from "vitest";
import { mapSlots } from "./strategy.js";

const keywords = {
  technology: [
    { canonical: "JavaScript", score: 9, count: 3 },
    { canonical: "Python", score: 7, count: 2 },
    { canonical: "Go", score: 5, count: 1 },
  ],
  tool_platform: [
    { canonical: "AWS", score: 8, count: 2 },
    { canonical: "Docker", score: 6, count: 1 },
  ],
  methodology: [{ canonical: "Agile", score: 6, count: 2 }],
  soft_skill: [{ canonical: "Leadership", score: 4, count: 1 }],
  domain: [{ canonical: "Fintech", score: 5, count: 1 }],
};

const data = {
  profile: { values: { FULL_NAME: "Ada" } },
  library: {
    entries: [
      { id: "a", slots: ["ACTION_RESULT"], text: "Built AWS pipelines", tags: ["AWS"] },
      { id: "b", slots: ["ACTION_RESULT"], text: "Led a Python team", tags: ["Python"] },
      { id: "c", slots: ["MEASURABLE_IMPACT"], text: "50% faster", tags: ["performance"] },
    ],
  },
  skillGroups: {
    groups: [
      { heading: "Cloud", categories: ["tool_platform"], keywords: ["AWS", "Docker"] },
      { heading: "Languages", categories: ["technology"], keywords: ["JavaScript", "Python", "Go", "Rust"] },
    ],
  },
};

const slots = [
  { key: "FULL_NAME::0", name: "FULL_NAME", occurrence: 0 },
  { key: "JOB_RELEVANT_TECHNOLOGIES::0", name: "JOB_RELEVANT_TECHNOLOGIES", occurrence: 0 },
  { key: "TECHNICAL_CAPABILITIES::0", name: "TECHNICAL_CAPABILITIES", occurrence: 0 },
  { key: "SKILLS_HEADING::0", name: "SKILLS_HEADING", occurrence: 0 },
  { key: "SKILLS_LINE::0", name: "SKILLS_LINE", occurrence: 0 },
  { key: "SKILLS_HEADING::1", name: "SKILLS_HEADING", occurrence: 1 },
  { key: "SKILLS_LINE::1", name: "SKILLS_LINE", occurrence: 1 },
  { key: "ACTION_RESULT::0", name: "ACTION_RESULT", occurrence: 0 },
  { key: "ACTION_RESULT::1", name: "ACTION_RESULT", occurrence: 1 },
  { key: "WIDGET_FROBNICATOR::0", name: "WIDGET_FROBNICATOR", occurrence: 0 },
];

// A universe covering all the test's keywords, so nothing counts as a gap
// (keeps the reorder assertions independent of the bundled candidate data).
const FULL_UNIVERSE = new Set([
  "javascript", "python", "go", "rust", "aws", "docker", "agile", "leadership", "fintech",
]);

describe("mapSlots", () => {
  const mapped = mapSlots(slots, keywords, data, { universe: FULL_UNIVERSE });
  const byKey = Object.fromEntries(mapped.map((s) => [s.key, s]));

  it("assigns the right strategy per placeholder name", () => {
    expect(byKey["FULL_NAME::0"].strategy).toBe("profile");
    expect(byKey["FULL_NAME::0"].value).toBe("Ada");
    expect(byKey["JOB_RELEVANT_TECHNOLOGIES::0"].strategy).toBe("keywords");
    expect(byKey["SKILLS_HEADING::0"].strategy).toBe("skills_header");
    expect(byKey["SKILLS_LINE::0"].strategy).toBe("skills");
    expect(byKey["ACTION_RESULT::0"].strategy).toBe("library");
    expect(byKey["WIDGET_FROBNICATOR::0"].strategy).toBe("manual");
    expect(byKey["WIDGET_FROBNICATOR::0"].value).toBe("");
  });

  it("does not duplicate keywords across two capability lines drawing the same pool", () => {
    const v1 = byKey["JOB_RELEVANT_TECHNOLOGIES::0"].value.split(", ").filter(Boolean);
    const v2 = byKey["TECHNICAL_CAPABILITIES::0"].value.split(", ").filter(Boolean);
    expect(v1.filter((x) => v2.includes(x))).toEqual([]);
  });

  it("uses each library entry at most once", () => {
    expect(byKey["ACTION_RESULT::0"].value).not.toBe(byKey["ACTION_RESULT::1"].value);
    expect(byKey["ACTION_RESULT::0"].value).toBeTruthy();
    expect(byKey["ACTION_RESULT::1"].value).toBeTruthy();
  });

  it("ranks skill groups by posting hit and orders matched skills first", () => {
    // Languages (42) outranks Cloud (28); Rust is unmatched so it trails.
    expect(byKey["SKILLS_HEADING::0"].value).toBe("Languages");
    expect(byKey["SKILLS_LINE::0"].value).toBe("JavaScript, Python, Go, Rust");
    expect(byKey["SKILLS_HEADING::1"].value).toBe("Cloud");
    expect(byKey["SKILLS_LINE::1"].value).toBe("AWS, Docker");
  });
});

describe("mapSlots aggressiveness (gap insertion)", () => {
  const kw = {
    technology: [{ canonical: "JavaScript", score: 9, count: 1 }],
    tool_platform: [
      { canonical: "Kubernetes", score: 8, count: 1 },
      { canonical: "Terraform", score: 7, count: 1 },
    ],
  };
  const d = {
    profile: { values: {} },
    library: { entries: [] },
    skillGroups: {
      groups: [
        { heading: "Languages", categories: ["technology"], keywords: ["JavaScript"] },
        { heading: "Cloud", categories: ["tool_platform"], keywords: ["AWS"] },
      ],
    },
  };
  const universe = new Set(["javascript", "aws"]); // candidate lacks Kubernetes/Terraform
  const cloudRow = (aggressiveness) =>
    mapSlots(
      [{ key: "SKILLS_LINE::1", name: "SKILLS_LINE", occurrence: 1 }],
      kw,
      d,
      { aggressiveness, universe },
    )[0].value;

  it("inserts nothing at aggressiveness 1 (truthful)", () => {
    expect(cloudRow(1)).toBe("AWS");
  });

  it("inserts gap keywords the candidate lacks at high aggressiveness (fabrication)", () => {
    const row = cloudRow(5);
    expect(row).toContain("Kubernetes");
    expect(row).toContain("Terraform");
  });
});
