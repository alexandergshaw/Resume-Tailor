import { describe, it, expect, vi, afterEach } from "vitest";
import { embeddedEngine } from "./engine.js";

const jsonResponse = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => obj,
});

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

describe("embeddedEngine composed workflow", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses Parser keywords and surfaces Researcher advisory, but keeps it out of the résumé", async () => {
    vi.stubEnv("RESUME_TAILOR_WORKFLOW", "composed");
    vi.stubEnv("PARSER_API_URL", "https://parser.example");
    vi.stubEnv("RESEARCHER_API_URL", "https://researcher.example");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("parser")) {
          return jsonResponse({
            results: {
              technologies: [{ display: "PostgreSQL" }, { display: "REST APIs" }],
              keywords: [{ display: "healthcare data exchange", score: 0.9 }],
              field: { top: "Healthcare", ranked: [{ display: "Healthcare" }] },
            },
          });
        }
        return jsonResponse({
          company: { profile: { industry: "Insurance" } },
          overviews: [{ text: "An insurer.", source: "wikipedia" }],
          news: [],
        });
      }),
    );

    const res = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    expect(res.report.workflow).toBe("composed");
    expect(res.degraded).toBe(false);
    expect(res.report.advisory.overviews).toHaveLength(1);
    // Advisory research never enters the document.
    expect(res.result).not.toContain("An insurer.");
    expect(res.result).not.toContain("Insurance");
    expect(res.result).not.toContain("{{");
  });

  it("falls back to local extraction (degraded) when the Parser fails", async () => {
    vi.stubEnv("RESUME_TAILOR_WORKFLOW", "composed");
    vi.stubEnv("PARSER_API_URL", "https://parser.example");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));

    const res = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    expect(res.degraded).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.result).toContain("Alex Shaw"); // résumé still generated
    expect(res.result).not.toContain("{{");
  });
});
