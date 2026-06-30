import { describe, it, expect } from "vitest";
import { extractKeywords, canonicalize } from "./keywords.js";
import { candidateUniverse, candidateSkillsByCategory } from "./universe.js";

// Proves the P1 dependency-injection refactor: keyword extraction, canonicalization,
// and the candidate universe all read from an INJECTED library when one is passed,
// and the bundled default is unaffected (no cross-dataset cache leakage).

const customTaxonomy = {
  entries: [
    { canonical: "Foobarication", category: "technology", aliases: ["foobar", "foobarication"] },
    { canonical: "Widgetcraft", category: "domain", aliases: ["widgetcraft"] },
  ],
};

const customSkillGroups = {
  groups: [{ heading: "Custom", categories: ["technology"], keywords: ["Foobarication"] }],
};

describe("tailor-lite library injection (P1)", () => {
  it("extractKeywords recognizes a custom taxonomy's terms; the default does not", () => {
    const text = "We need strong Foobarication and Widgetcraft experience.";
    const custom = extractKeywords(text, customTaxonomy);
    expect((custom.technology || []).some((k) => k.canonical === "Foobarication")).toBe(true);
    expect((custom.domain || []).some((k) => k.canonical === "Widgetcraft")).toBe(true);

    const base = extractKeywords(text); // bundled default — knows nothing of these
    expect((base.technology || []).some((k) => k.canonical === "Foobarication")).toBe(false);
  });

  it("canonicalize resolves against the injected taxonomy only", () => {
    expect(canonicalize("foobar", customTaxonomy)).toBe("Foobarication");
    expect(canonicalize("foobar")).toBeNull(); // default doesn't know it
  });

  it("candidateUniverse / skillsByCategory reflect injected skill groups + taxonomy", () => {
    const universe = candidateUniverse(customSkillGroups, customTaxonomy);
    expect(universe.has("foobarication")).toBe(true);
    const byCat = candidateSkillsByCategory(customSkillGroups, customTaxonomy);
    expect(byCat.technology).toContain("Foobarication");
  });

  it("does not leak between datasets (default stays clean after a custom call)", () => {
    extractKeywords("Foobarication", customTaxonomy); // warms the custom cache entry
    const base = extractKeywords("Foobarication"); // default again
    expect((base.technology || []).some((k) => k.canonical === "Foobarication")).toBe(false);
  });
});
