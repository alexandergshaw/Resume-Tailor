import { describe, it, expect } from "vitest";
import { mapParserResults } from "./parser.js";

describe("mapParserResults", () => {
  const raw = {
    results: {
      technologies: [{ display: "PostgreSQL" }, { display: "Node.js" }],
      keywords: [
        { display: "REST", score: 0.9 },
        { display: "data transformation", score: 0.4 },
      ],
      field: { top: "Healthcare", ranked: [{ display: "Healthcare" }] },
      sector: { top: "Insurance", ranked: [] },
    },
  };
  const { keywords, emphases } = mapParserResults(raw);

  it("maps Parser results into the local {canonical,category,score} model", () => {
    const tech = (keywords.technology || []).map((k) => k.canonical);
    expect(tech).toContain("PostgreSQL");
    expect(tech).toContain("Node.js");
    expect(tech).toContain("REST"); // taxonomy types REST as technology
  });

  it("types unknown terms as domain and curated technologies rank high", () => {
    expect((keywords.domain || []).map((k) => k.canonical)).toContain("data transformation");
    expect((keywords.domain || []).map((k) => k.canonical)).toContain("Healthcare");
    expect(keywords.technology[0].score).toBeGreaterThan(50);
  });

  it("carries field/sector top emphases for the Researcher", () => {
    expect(emphases).toContain("Healthcare");
    expect(emphases).toContain("Insurance");
  });

  it("is deterministic for the same input", () => {
    expect(mapParserResults(raw)).toEqual(mapParserResults(raw));
  });
});
