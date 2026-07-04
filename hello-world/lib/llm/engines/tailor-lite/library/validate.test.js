import { describe, it, expect } from "vitest";
import {
  validateTaxonomy,
  validateFocusArea,
  validateSkillGroup,
  validateContentFragment,
  validateProfile,
  validatePersona,
} from "./validate.js";

describe("library validators", () => {
  it("accepts a good taxonomy entry and normalizes arrays", () => {
    const v = validateTaxonomy({ canonical: "GraphQL", category: "technology", aliases: ["graph ql", " graph ql ", ""] });
    expect(v.ok).toBe(true);
    expect(v.value).toEqual({ canonical: "GraphQL", category: "technology", aliases: ["graph ql"], match_canonical: true });
  });

  it("rejects a taxonomy entry with a bad category or empty canonical", () => {
    expect(validateTaxonomy({ canonical: "X", category: "nope" }).ok).toBe(false);
    expect(validateTaxonomy({ canonical: "", category: "domain" }).ok).toBe(false);
  });

  it("warns about generic aliases that cause false matches", () => {
    const v = validateTaxonomy({ canonical: "Next.js", category: "technology", aliases: ["next"] });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/common word/i);
  });

  it("focus area: requires a name and warns when it can never activate", () => {
    expect(validateFocusArea({ name: "" }).ok).toBe(false);
    const v = validateFocusArea({ name: "UX", match: [], subjects: ["Design Systems"] });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/never activate/i);
  });

  it("skill group: requires heading + at least one keyword", () => {
    expect(validateSkillGroup({ heading: "A", keywords: [] }).ok).toBe(false);
    expect(validateSkillGroup({ heading: "A", keywords: ["SQL"], conditional: true }).value.conditional).toBe(true);
  });

  it("content fragment: requires frag_id (slug), slots, and text", () => {
    expect(validateContentFragment({ frag_id: "bad id", slots: ["X"], text: "t" }).ok).toBe(false);
    expect(validateContentFragment({ frag_id: "sol-x", slots: [], text: "t" }).ok).toBe(false);
    const v = validateContentFragment({ frag_id: "sol-x", slots: ["SOLUTION_OR_INITIATIVE"], text: "a thing", tags: ["React"] });
    expect(v.ok).toBe(true);
    expect(v.value.fabricated).toBe(false);
  });

  it("profile: keeps string values and the teaching subjects array", () => {
    const v = validateProfile({ values: { RANK: "Senior", BAD: 5 }, default_teaching_subjects: ["Algebra", ""] });
    expect(v.value.values).toEqual({ RANK: "Senior" });
    expect(v.value.default_teaching_subjects).toEqual(["Algebra"]);
  });

  it("persona: requires name, filters values to string→string, whitelists cover_variant", () => {
    const v = validatePersona({
      name: "Finance Educator",
      values: { RANK: "Senior", BAD: 5, EMPTY: "" },
      default_teaching_subjects: ["Economics", "Finance"],
      focus_area: "Teaching & Finance",
      cover_variant: "teaching",
    });
    expect(v.ok).toBe(true);
    expect(v.value.name).toBe("Finance Educator");
    expect(v.value.values).toEqual({ RANK: "Senior" });
    expect(v.value.default_teaching_subjects).toEqual(["Economics", "Finance"]);
    expect(v.value.focus_area).toBe("Teaching & Finance");
    expect(v.value.cover_variant).toBe("teaching");
  });

  it("persona: rejects empty name, caps value lengths, normalizes cover_variant", () => {
    const v = validatePersona({
      name: "",
      values: { KEY: "x".repeat(300) },
      cover_variant: "unknown",
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/name is required/i);
  });

  it("persona: truncates long names and focus areas", () => {
    const v = validatePersona({
      name: "x".repeat(200),
      focus_area: "y".repeat(200),
    });
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBe(2); // Both name and focus_area are too long
  });

  it("persona: accepts only whitelisted cover_variant values", () => {
    expect(validatePersona({ name: "P1", cover_variant: "teaching" }).value.cover_variant).toBe("teaching");
    expect(validatePersona({ name: "P1", cover_variant: "staff" }).value.cover_variant).toBe("staff");
    expect(validatePersona({ name: "P1", cover_variant: "industry" }).value.cover_variant).toBe("industry");
    expect(validatePersona({ name: "P1", cover_variant: "nontechnical" }).value.cover_variant).toBe("nontechnical");
    expect(validatePersona({ name: "P1", cover_variant: "bad" }).value.cover_variant).toBe("");
    expect(validatePersona({ name: "P1", cover_variant: "" }).value.cover_variant).toBe("");
  });
});
