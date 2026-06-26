import { describe, it, expect } from "vitest";
import { embeddedEngine } from "./engine.js";

const POSTING = [
  "Senior Backend Engineer",
  "Cloud Platform Team",
  "We build payments infrastructure.",
  "",
  "Requirements:",
  "Python, AWS, Docker, Kubernetes, PostgreSQL",
  "Strong leadership and communication",
  "",
  "Nice to have:",
  "Go, Terraform",
].join("\n");

describe("embeddedEngine.getProposals", () => {
  it("returns the templatized skills slots plus keywords", async () => {
    const data = await embeddedEngine.getProposals({ jobPosting: POSTING });
    const byKey = Object.fromEntries(data.slots.map((s) => [s.key, s]));
    expect(byKey["SKILLS_HEADING::0"].strategy).toBe("skills_header");
    expect(byKey["SKILLS_LINE::0"].strategy).toBe("skills");
    expect(byKey["SKILLS_LINE::0"].value.length).toBeGreaterThan(0);
    expect(data.keywords.technology.some((t) => t.canonical === "Python")).toBe(true);
  });

  it("rejects an empty posting", async () => {
    await expect(embeddedEngine.getProposals({ jobPosting: "  " })).rejects.toThrow();
  });
});

describe("embeddedEngine.tailorResume", () => {
  it("fills the skills slots, keeps all content, and leaks no placeholders", async () => {
    const res = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    expect(typeof res.docxB64).toBe("string");
    expect(res.docxB64.length).toBeGreaterThan(200);
    expect(res.report.meta).toEqual({ renderer: "local", workflow: "legacy" });
    expect(res.result).toContain("Alex Shaw");
    expect(res.result).not.toContain("{{");
    expect(res.report.unfilled).toEqual([]);
    // All five skill groups are still present (reordered, never dropped).
    expect(res.result).toContain("Healthcare Interoperability & Enterprise Integration");
    expect(res.result).toContain("Collaboration & Enterprise Tools");
  });

  it("is deterministic: identical input yields byte-identical output", async () => {
    const a = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    const b = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    expect(a.docxB64).toBe(b.docxB64);
  });
});

describe("embeddedEngine.tailorCoverLetter", () => {
  it("renders a cover letter seeded with the role, organization, and profile", async () => {
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: POSTING,
      jobTitle: "Staff Engineer",
      companyName: "Initech",
    });
    expect(res.docxB64.length).toBeGreaterThan(200);
    const text = res.result;
    expect(text).toContain("Staff Engineer");
    expect(text).toContain("Initech");
    expect(text).toContain("Alex Shaw"); // FULL_NAME from profile.json
    // Seeded/keyword slots are always filled — no raw placeholder leaks through.
    expect(text).not.toContain("{{");
    expect(res.report.meta.document).toBe("cover_letter");
  });

  it("falls back to neutral wording when role/company are missing", async () => {
    const res = await embeddedEngine.tailorCoverLetter({ jobPosting: POSTING });
    expect(res.result).toContain("the role");
    expect(res.result).toContain("your organization");
    expect(res.result).not.toContain("{{TARGET_ORGANIZATION}}");
  });

  it("is deterministic for identical input", async () => {
    const args = { jobPosting: POSTING, jobTitle: "Staff Engineer", companyName: "Initech" };
    const a = await embeddedEngine.tailorCoverLetter(args);
    const b = await embeddedEngine.tailorCoverLetter(args);
    expect(a.docxB64).toBe(b.docxB64);
  });
});
