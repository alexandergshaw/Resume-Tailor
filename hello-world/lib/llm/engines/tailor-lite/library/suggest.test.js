import { describe, it, expect } from "vitest";
import { buildLibrarySuggestions } from "./suggest.js";

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
