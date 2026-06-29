import { describe, it, expect, vi, afterEach } from "vitest";
import { embeddedEngine } from "./engine.js";
import { fetchUrlContent } from "../../../scrape/fetchUrlContent.js";

vi.mock("../../../scrape/fetchUrlContent.js", () => ({ fetchUrlContent: vi.fn() }));

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

describe("embeddedEngine reads the posting from a URL", () => {
  afterEach(() => vi.mocked(fetchUrlContent).mockReset());

  it("tailors a résumé from a jobPostingUrl (no text)", async () => {
    vi.mocked(fetchUrlContent).mockResolvedValue({
      title: "Senior Engineer",
      company: "Initech",
      description: POSTING,
    });
    const res = await embeddedEngine.tailorResume({ jobPostingUrl: "https://jobs.example.com/123" });
    expect(fetchUrlContent).toHaveBeenCalledWith("https://jobs.example.com/123");
    expect(res.result).toContain("Senior Software Engineer");
    expect(res.result).not.toContain("{{");
  });

  it("getProposals works from a URL too", async () => {
    vi.mocked(fetchUrlContent).mockResolvedValue({ title: "", company: "", description: POSTING });
    const data = await embeddedEngine.getProposals({ jobPostingUrl: "https://jobs.example.com/123" });
    expect(data.slots.length).toBeGreaterThan(50);
  });

  it("surfaces a clear error when the URL can't be read", async () => {
    vi.mocked(fetchUrlContent).mockResolvedValue({ error: "Failed to fetch URL (status 403)." });
    await expect(
      embeddedEngine.tailorResume({ jobPostingUrl: "https://blocked.example.com" }),
    ).rejects.toThrow(/Could not read the job posting from that URL/);
  });

  it("does not hit the network when posting text is supplied", async () => {
    await embeddedEngine.tailorResume({ jobPosting: POSTING });
    expect(fetchUrlContent).not.toHaveBeenCalled();
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
    // Soft-skills line reads "experience in", not "leadership in".
    expect(res.result).toContain("experience in");
    expect(res.result).not.toContain("leadership in");
    // Teaching clause uses warmer, plainer phrasing.
    expect(res.result).toContain("classroom teaching experience that fits this role well");
    expect(res.result).not.toContain("alongside the higher-education instruction");
    // The opening "hands-on work with …" tech list leads with real technologies
    // (languages/frameworks), not just collaboration tools.
    expect(res.result).toMatch(/hands-on work with [^.]*\b(React|TypeScript|JavaScript|PostgreSQL|SQL)\b/);
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
    // A full, multi-paragraph letter (not a stub) — written as natural prose
    // rather than keyword lists, so a few hundred words rather than a wall.
    expect(res.result.split(/\s+/).filter(Boolean).length).toBeGreaterThan(180);
  });
});
