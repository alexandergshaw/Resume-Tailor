import { describe, it, expect } from "vitest";
import { buildLibrarySuggestions, aliasCandidates } from "./suggest.js";

// A user library that lacks Kubernetes/Docker (present in the bundled taxonomy)
// so the diff has something to suggest.
const sparseLib = async () => ({
  taxonomy: {
    entries: [
      { canonical: "React", category: "technology" },
      { canonical: "SQL", category: "technology" },
    ],
  },
});

const POSTING = [
  "Platform Engineer at Initech — Omaha, NE.",
  "Requirements:",
  "Kubernetes, Docker, React, SQL, and experience with chaos engineering drills.",
].join("\n");

describe("buildLibrarySuggestions", () => {
  it("suggests recognized canonicals the user's taxonomy lacks, not ones they have", async () => {
    const out = await buildLibrarySuggestions(
      { posting: POSTING, userId: "u1" },
      { loadLibraryImpl: sparseLib },
    );
    const names = out.buzzwords.map((b) => b.canonical);
    expect(names).toEqual(expect.arrayContaining(["Kubernetes", "Docker"]));
    expect(names).not.toContain("React");
    expect(names).not.toContain("SQL");
    // Recognized suggestions carry their taxonomy category.
    const k8s = out.buzzwords.find((b) => b.canonical === "Kubernetes");
    expect(k8s.category).toBeTruthy();
  });

  it("includes unrecognized RAKE phrases as uncategorized candidates", async () => {
    const out = await buildLibrarySuggestions(
      { posting: POSTING, userId: "u1" },
      { loadLibraryImpl: sparseLib },
    );
    const uncategorized = out.buzzwords.filter((b) => b.category === "");
    expect(uncategorized.length).toBeGreaterThan(0);
    expect(uncategorized.map((b) => b.canonical.toLowerCase()).join(" ")).toContain("chaos");
  });

  it("keeps a supplied title/company and scaffolds the skill group from it", async () => {
    const out = await buildLibrarySuggestions(
      { posting: POSTING, title: "Platform Engineer", company: "Initech", userId: "u1" },
      { loadLibraryImpl: sparseLib },
    );
    expect(out.title).toBe("Platform Engineer");
    expect(out.company).toBe("Initech");
    expect(out.suggestedSkillGroup.heading).toBe("Platform Engineer stack");
    expect(Array.isArray(out.categories)).toBe(true);
  });

  it("recognized suggestions carry the bundled alias web into the import", async () => {
    const out = await buildLibrarySuggestions(
      { posting: POSTING, userId: "u1" },
      { loadLibraryImpl: sparseLib },
    );
    const k8s = out.buzzwords.find((b) => b.canonical === "Kubernetes");
    // The bundled taxonomy's aliases ride along — importing without them would
    // lose "k8s"/"eks"-style matching for every future posting.
    expect(k8s.aliases).toEqual(expect.arrayContaining(["k8s"]));
  });

  it("scraped RAKE phrases get deterministic alias candidates", async () => {
    const out = await buildLibrarySuggestions(
      { posting: POSTING, userId: "u1" },
      { loadLibraryImpl: sparseLib },
    );
    const rake = out.buzzwords.find((b) => b.category === "");
    expect(Array.isArray(rake.aliases)).toBe(true);
  });

  it("suggests nothing the user already has (empty diff)", async () => {
    const fullLib = async () => ({
      taxonomy: {
        entries: ["React", "SQL", "Kubernetes", "Docker"].map((c) => ({ canonical: c })),
      },
    });
    const out = await buildLibrarySuggestions(
      { posting: "We need React, SQL, Kubernetes, Docker.", userId: "u1" },
      { loadLibraryImpl: fullLib },
    );
    expect(out.buzzwords.filter((b) => b.category !== "")).toEqual([]);
  });
});

describe("aliasCandidates", () => {
  it("builds an acronym for clean multi-word phrases", () => {
    expect(aliasCandidates("Care Plan Documentation")).toContain("cpd");
    expect(aliasCandidates("Chaos Engineering Drills")).toContain("ced");
  });

  it("skips connective words and rejects generic/short acronyms", () => {
    // "of" is skipped → 3 letters from the content words.
    expect(aliasCandidates("Bureau of Land Management")).toContain("blm");
    // Two content words → 2-letter acronym → too collision-prone, rejected.
    expect(aliasCandidates("Machine Learning")).not.toContain("ml");
    expect(aliasCandidates("Single")).toEqual([]);
  });

  it("adds hyphen/slash → space and & ↔ and variants", () => {
    expect(aliasCandidates("Care-Plan Documentation")).toContain("care plan documentation");
    expect(aliasCandidates("CI/CD Pipelines")).toContain("ci cd pipelines");
    expect(aliasCandidates("Health & Safety Compliance")).toContain("health and safety compliance");
    expect(aliasCandidates("Health and Safety Compliance")).toContain("health & safety compliance");
  });

  it("never suggests the canonical itself", () => {
    for (const c of ["React", "Care Plan Documentation", "CI/CD"]) {
      expect(aliasCandidates(c)).not.toContain(c.toLowerCase());
    }
  });
});
