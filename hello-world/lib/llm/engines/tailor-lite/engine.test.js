import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("respects aggressiveness: low stays truthful, high inserts gap keywords", async () => {
    const posting = "Platform Engineer. Requirements: Kubernetes, Docker, Terraform, AWS, React, SQL.";
    const low = await embeddedEngine.tailorResume({ jobPosting: posting, aggressiveness: 1 });
    const high = await embeddedEngine.tailorResume({ jobPosting: posting, aggressiveness: 5 });

    // The candidate does not list Kubernetes anywhere.
    expect(low.result).not.toContain("Kubernetes");
    expect(high.result).toContain("Kubernetes");
    // Even aggressive output stays well-formed (no leaked placeholders).
    expect(high.result).not.toContain("{{");
  });

  it("reorders a job's bullets toward the posting, keeping every bullet and number", async () => {
    const MOO = "Senior Engineer (Applications & Enterprise Integrations) | Mutual of Omaha | July 2023";
    const leadBullet = (lines) => lines[lines.indexOf(MOO) + 1];

    const frontend = await embeddedEngine.tailorResume({
      jobPosting: "Frontend Engineer: React, JavaScript, TypeScript, HTML5, CSS3, PostgreSQL.",
    });
    const leadership = await embeddedEngine.tailorResume({
      jobPosting: "Engineering Manager: team leadership, stakeholder management, mentoring, code reviews, agile collaboration.",
    });

    // Same job, different leading accomplishment per posting.
    expect(leadBullet(frontend.resultLines)).not.toBe(leadBullet(leadership.resultLines));
    // Strict: numbers preserved, nothing dropped, no leaked placeholders.
    expect(frontend.result).toContain("10,000+");
    expect(frontend.result).toContain("75,000+");
    expect(frontend.result).not.toContain("{{");
    expect(frontend.report.unfilled).toEqual([]);
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

describe("embeddedEngine composed workflow (in-house)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("surfaces in-house advisory but the résumé .docx is byte-identical to legacy", async () => {
    const legacy = await embeddedEngine.tailorResume({ jobPosting: POSTING });

    vi.stubEnv("RESUME_TAILOR_WORKFLOW", "composed");
    const composed = await embeddedEngine.tailorResume({ jobPosting: POSTING });

    expect(composed.report.workflow).toBe("composed");
    expect(composed.report.advisory).toBeTruthy();
    expect(composed.report.advisory.matched.length).toBeGreaterThan(0);
    // Quarantine: advisory is report-only, so the document is unchanged.
    expect(composed.docxB64).toBe(legacy.docxB64);
    expect(composed.result).not.toContain("{{");
  });

  it("fills cover-letter facts (ORGANIZATION_CONTEXT / ROLE_FOCUS) from the posting + company", async () => {
    vi.stubEnv("RESUME_TAILOR_WORKFLOW", "composed");
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: POSTING,
      jobTitle: "Staff Engineer",
      companyName: "Initech",
    });
    expect(res.report.workflow).toBe("composed");
    expect(res.result).toContain("your work at Initech");
    expect(res.result).not.toContain("{{");
  });
});
