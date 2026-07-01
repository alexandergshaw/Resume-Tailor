import { describe, it, expect } from "vitest";
import { parseSteering, applySteering, steerAggressiveness } from "./steering.js";
import { defaultLibraryData } from "./library/defaults.js";

const TAXONOMY = defaultLibraryData.taxonomy;

describe("parseSteering", () => {
  it("parses emphasize directives into taxonomy canonicals", () => {
    const s = parseSteering("Please emphasize React and Kubernetes", TAXONOMY);
    const names = s.emphasize.map((t) => t.canonical);
    expect(names).toContain("React");
    expect(names).toContain("Kubernetes");
    expect(s.hasDirectives).toBe(true);
  });

  it("parses avoid directives, including negated 'mention'", () => {
    const s = parseSteering("don't mention Java", TAXONOMY);
    expect(s.emphasize).toEqual([]);
    expect(s.avoid.map((t) => t.canonical)).toContain("Java");
  });

  it("handles multiple clauses and lets avoid win a conflict", () => {
    const s = parseSteering("Emphasize React; remove React and Java.", TAXONOMY);
    expect(s.emphasize.map((t) => t.canonical)).not.toContain("React");
    expect(s.avoid.map((t) => t.canonical)).toEqual(expect.arrayContaining(["React", "Java"]));
  });

  it("parses aggressiveness nudges in both directions", () => {
    expect(parseSteering("make it bolder", TAXONOMY).aggressivenessDelta).toBe(1);
    expect(parseSteering("tone it down please", TAXONOMY).aggressivenessDelta).toBe(-1);
  });

  it("reports no directives for unparseable notes", () => {
    const s = parseSteering("please make it generally nicer somehow", TAXONOMY);
    expect(s.hasDirectives).toBe(false);
  });

  it("canonicalizes aliases (k8s → Kubernetes)", () => {
    const s = parseSteering("focus on k8s", TAXONOMY);
    expect(s.emphasize.map((t) => t.canonical)).toContain("Kubernetes");
  });
});

describe("applySteering", () => {
  const keywords = {
    technology: [
      { canonical: "Java", score: 10, count: 3 },
      { canonical: "React", score: 4, count: 1 },
    ],
    domain: [{ canonical: "Web Development", score: 6, count: 2 }],
  };

  it("boosts emphasized canonicals above organic scores", () => {
    const out = applySteering(keywords, {
      emphasize: [{ canonical: "React", category: "technology" }],
      avoid: [],
    });
    expect(out.technology[0].canonical).toBe("React");
    expect(out.technology[0].score).toBeGreaterThan(1000 - 1);
  });

  it("injects an emphasized canonical the posting didn't mention", () => {
    const out = applySteering(keywords, {
      emphasize: [{ canonical: "Kubernetes", category: "technology" }],
      avoid: [],
    });
    expect(out.technology[0].canonical).toBe("Kubernetes");
  });

  it("removes avoided canonicals from every category", () => {
    const out = applySteering(keywords, {
      emphasize: [],
      avoid: [{ canonical: "Java", category: "technology" }],
    });
    expect(out.technology.map((k) => k.canonical)).not.toContain("Java");
  });

  it("is pure — the input map is not mutated", () => {
    applySteering(keywords, {
      emphasize: [{ canonical: "React", category: "technology" }],
      avoid: [{ canonical: "Java", category: "technology" }],
    });
    expect(keywords.technology.map((k) => k.canonical)).toEqual(["Java", "React"]);
    expect(keywords.technology[1].score).toBe(4);
  });
});

describe("steerAggressiveness", () => {
  it("nudges and clamps", () => {
    expect(steerAggressiveness(3, { aggressivenessDelta: 1 })).toBe(4);
    expect(steerAggressiveness(5, { aggressivenessDelta: 1 })).toBe(5);
    expect(steerAggressiveness(1, { aggressivenessDelta: -1 })).toBe(1);
    expect(steerAggressiveness(undefined, { aggressivenessDelta: 1 })).toBe(4); // default base 3
    expect(steerAggressiveness(2, { aggressivenessDelta: 0 })).toBe(2); // untouched
    expect(steerAggressiveness(undefined, null)).toBe(undefined);
  });
});
