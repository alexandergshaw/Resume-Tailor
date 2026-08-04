import { describe, it, expect } from "vitest";
import { topMatchingCapabilities } from "./engine.js";

// A minimal, self-contained taxonomy + candidate skill data so results are
// fully predictable and independent of the bundled library's real skills.
// All five entries share the "technology" category so the interesting
// question is purely score ordering / set membership, not category mixing.
const TAXONOMY = {
  entries: [
    { canonical: "Python", category: "technology", aliases: [] },
    { canonical: "React", category: "technology", aliases: [] },
    { canonical: "SQL", category: "technology", aliases: [] },
    { canonical: "JavaScript", category: "technology", aliases: ["js"] },
    { canonical: "Java", category: "technology", aliases: [] },
  ],
};

// The candidate owns Python, React, SQL, and JavaScript — deliberately NOT
// Java, so a posting that asks for Java can never be claimed.
const CANDIDATE_SKILL_GROUPS = {
  groups: [{ heading: "Core Skills", keywords: ["Python", "React", "SQL", "JavaScript"] }],
};

const DATA = { taxonomy: TAXONOMY, skillGroups: CANDIDATE_SKILL_GROUPS };

// The first three non-empty lines carry no keyword (extractKeywords weights
// the title area x3), so every mention below scores by frequency alone:
// Python x4, React x3, SQL x2, JavaScript x1, Java x1 (Java is NOT owned).
const POSTING = [
  "About the role",
  "We are hiring for our platform team",
  "This position focuses on day to day delivery",
  "Python is used throughout our data pipelines",
  "Python is also used for automation tooling",
  "Python powers our backend services end to end",
  "Python remains central to everything the team builds",
  "React powers our customer facing dashboards",
  "React components are reused across many products",
  "React is the default choice for new frontend work",
  "SQL backs our reporting layer",
  "SQL is used for ad hoc analysis too",
  "JavaScript glues everything together in the browser",
  "Java is used only in a legacy billing system this role does not touch",
].join("\n");

describe("topMatchingCapabilities: no fabrication (AC-5)", () => {
  it("never returns a posting keyword the candidate does not own, even with room to spare", () => {
    const result = topMatchingCapabilities(POSTING, DATA, 10);
    // Java is a posting keyword the candidate does not own — it must never
    // appear, even with a generous limit that leaves plenty of room for it.
    expect(result).not.toContain("Java");
    // Bounded by the actual intersection (4 owned+matched skills), not by the
    // generous limit of 10.
    expect(result).toEqual(["Python", "React", "SQL", "JavaScript"]);
    expect(result.length).toBe(4);
  });

  it("only returns capabilities present in both the posting and the candidate's own data", () => {
    const result = topMatchingCapabilities(POSTING, DATA, 3);
    for (const capability of result) {
      expect(CANDIDATE_SKILL_GROUPS.groups[0].keywords).toContain(capability);
    }
  });
});

describe("topMatchingCapabilities: limit", () => {
  it("honors a limit smaller than the number of matches", () => {
    expect(topMatchingCapabilities(POSTING, DATA, 2)).toEqual(["Python", "React"]);
  });

  it("honors a limit of 1", () => {
    expect(topMatchingCapabilities(POSTING, DATA, 1)).toEqual(["Python"]);
  });

  it("defaults to 3 when the limit argument is omitted, truncating a 4th match", () => {
    // Without truncation, JavaScript (the 4th owned+matched skill) would also
    // appear — proving the default is really 3, not "unlimited".
    const result = topMatchingCapabilities(POSTING, DATA);
    expect(result).toEqual(["Python", "React", "SQL"]);
    expect(result.length).toBe(3);
  });
});

describe("topMatchingCapabilities: ordering", () => {
  it("orders results by score, strongest first, across different keyword categories", () => {
    // Terraform (tool_platform) is mentioned once and would be inserted into
    // the keyword map before Elixir (technology), which is mentioned three
    // times — so a naive "first category encountered" order would put
    // Terraform first. The result must still lead with the higher score.
    const taxonomy = {
      entries: [
        { canonical: "Terraform", category: "tool_platform", aliases: [] },
        { canonical: "Elixir", category: "technology", aliases: [] },
      ],
    };
    const data = {
      taxonomy,
      skillGroups: { groups: [{ heading: "Core", keywords: ["Terraform", "Elixir"] }] },
    };
    const posting = [
      "Intro line one",
      "Intro line two",
      "Intro line three",
      "Terraform is used for our infra",
      "Elixir is core to our platform",
      "Elixir handles most of our services",
      "Elixir is used company wide",
    ].join("\n");
    expect(topMatchingCapabilities(posting, data)).toEqual(["Elixir", "Terraform"]);
  });
});

describe("topMatchingCapabilities: empty or unmatched posting", () => {
  it("returns an empty array for an empty posting", () => {
    expect(topMatchingCapabilities("", DATA)).toEqual([]);
  });

  it("returns an empty array when the posting shares no vocabulary with the taxonomy", () => {
    const posting = "Unrelated posting text with no overlapping vocabulary at all.";
    expect(topMatchingCapabilities(posting, DATA)).toEqual([]);
  });
});

describe("topMatchingCapabilities: candidate with no skill data", () => {
  it("returns an empty array rather than throwing when the candidate's skill groups are empty", () => {
    const data = { taxonomy: TAXONOMY, skillGroups: { groups: [] } };
    expect(() => topMatchingCapabilities(POSTING, data)).not.toThrow();
    expect(topMatchingCapabilities(POSTING, data)).toEqual([]);
  });
});

describe("topMatchingCapabilities: missing or malformed data does not throw", () => {
  it("handles a completely empty data object with an empty posting", () => {
    expect(() => topMatchingCapabilities("", {})).not.toThrow();
    expect(topMatchingCapabilities("", {})).toEqual([]);
  });

  it("handles skillGroups missing its groups array", () => {
    const data = { taxonomy: TAXONOMY, skillGroups: {} };
    expect(() => topMatchingCapabilities(POSTING, data)).not.toThrow();
    expect(topMatchingCapabilities(POSTING, data)).toEqual([]);
  });

  it("handles a skill group whose keywords are null instead of an array", () => {
    const data = {
      taxonomy: TAXONOMY,
      skillGroups: { groups: [{ heading: "Malformed Group", keywords: null }] },
    };
    expect(() => topMatchingCapabilities(POSTING, data)).not.toThrow();
    expect(topMatchingCapabilities(POSTING, data)).toEqual([]);
  });
});
