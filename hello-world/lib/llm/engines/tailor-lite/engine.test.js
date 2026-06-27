import { describe, it, expect, vi, afterEach } from "vitest";
import { embeddedEngine } from "./engine.js";

const POSTING = [
  "Senior Software Engineer.",
  "Requirements:",
  "React, JavaScript, TypeScript, SQL, PostgreSQL, REST APIs, Agile, leadership.",
  "Nice to have: Kubernetes, Docker.",
].join("\n");

describe("embeddedEngine.getProposals", () => {
  it("returns the template's slots plus keywords", async () => {
    const data = await embeddedEngine.getProposals({ jobPosting: POSTING });
    expect(data.slots.length).toBeGreaterThan(50);
    const byKey = Object.fromEntries(data.slots.map((s) => [s.key, s]));
    expect(byKey["RANK::0"].strategy).toBe("profile");
    expect(byKey["JOB_RELEVANT_TECHNOLOGIES::0"].strategy).toBe("keywords");
    expect(data.keywords.technology.some((t) => t.canonical === "React")).toBe(true);
  });

  it("rejects an empty posting", async () => {
    await expect(embeddedEngine.getProposals({ jobPosting: "  " })).rejects.toThrow();
  });
});

describe("embeddedEngine.tailorResume", () => {
  it("fills the whole template with no leaked placeholders", async () => {
    const res = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    expect(res.docxB64.length).toBeGreaterThan(200);
    expect(res.result).not.toContain("{{");
    expect(res.result).not.toContain("{Area");
    expect(res.result).toContain("Alex Shaw"); // static name in the template
    expect(res.result).toContain("Senior Software Engineer"); // RANK + PRIMARY_FUNCTION
    expect(res.report.unfilled).toEqual([]);
  });

  it("is deterministic: identical input yields byte-identical output", async () => {
    const a = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    const b = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    expect(a.docxB64).toBe(b.docxB64);
  });

  it("respects aggressiveness: gap keywords appear only at high settings", async () => {
    const posting = "Platform Engineer. Requirements: Kubernetes, Docker, Terraform, React, SQL.";
    const low = await embeddedEngine.tailorResume({ jobPosting: posting, aggressiveness: 1 });
    const high = await embeddedEngine.tailorResume({ jobPosting: posting, aggressiveness: 5 });
    expect(low.result).not.toContain("Kubernetes"); // candidate lacks it
    expect(high.result).toContain("Kubernetes");
    expect(high.result).not.toContain("{{");
  });
});

describe("embeddedEngine.tailorCoverLetter", () => {
  it("renders a cover letter seeded with the role, organization, and profile", async () => {
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: POSTING,
      jobTitle: "Staff Engineer",
      companyName: "Initech",
    });
    expect(res.result).toContain("Staff Engineer");
    expect(res.result).toContain("Initech");
    expect(res.result).toContain("Alex Shaw");
    expect(res.result).not.toContain("{{");
    expect(res.report.meta.document).toBe("cover_letter");
  });
});

describe("embeddedEngine composed workflow (in-house)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("surfaces advisory (matched/gaps) but the résumé .docx is byte-identical to legacy", async () => {
    const legacy = await embeddedEngine.tailorResume({ jobPosting: POSTING });

    vi.stubEnv("RESUME_TAILOR_WORKFLOW", "composed");
    const composed = await embeddedEngine.tailorResume({ jobPosting: POSTING });

    expect(composed.report.workflow).toBe("composed");
    expect(composed.report.advisory.matched.length).toBeGreaterThan(0);
    expect(composed.docxB64).toBe(legacy.docxB64); // advisory is report-only
  });

  it("renders a full, personalized cover letter (composed workflow)", async () => {
    vi.stubEnv("RESUME_TAILOR_WORKFLOW", "composed");
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: POSTING,
      jobTitle: "Staff Engineer",
      companyName: "Initech",
    });
    expect(res.result).toContain("Staff Engineer"); // TARGET_ROLE
    expect(res.result).toContain("Initech"); // TARGET_ORGANIZATION
    expect(res.result).not.toContain("{{");
    // The bundled template is a full-page letter, not a stub.
    expect(res.result.split(/\s+/).filter(Boolean).length).toBeGreaterThan(250);
  });
});
