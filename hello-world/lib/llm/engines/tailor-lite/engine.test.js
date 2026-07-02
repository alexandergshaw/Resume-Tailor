import { describe, it, expect, vi, afterEach } from "vitest";
import { embeddedEngine, isTeachingPosting } from "./engine.js";
import { fetchUrlContent } from "../../../scrape/fetchUrlContent.js";

vi.mock("../../../scrape/fetchUrlContent.js", () => ({ fetchUrlContent: vi.fn() }));

const POSTING = [
  "Senior Software Engineer.",
  "Requirements:",
  "React, JavaScript, TypeScript, SQL, PostgreSQL, REST APIs, Agile, leadership.",
  "Nice to have: Kubernetes, Docker.",
].join("\n");

describe("isTeachingPosting", () => {
  it("detects genuine teaching roles via a strong signal", () => {
    expect(isTeachingPosting("Adjunct Faculty to teach undergraduate courses.")).toBe(true);
    expect(isTeachingPosting("Lecturer developing graduate-level coursework and course materials.")).toBe(true);
    expect(isTeachingPosting("Assistant Professor, tenure-track, in Computer Science.")).toBe(true);
  });

  it("does NOT treat industry 'experience through coursework' as teaching (MassMutual AI Engineer)", () => {
    // "coursework" alone is a candidate-background phrase in industry postings, not a
    // teaching duty — it must not flip the letter to the adjunct framing.
    const posting =
      "AI Engineer. You have demonstrated machine learning and AI engineering concepts " +
      "through coursework, research, internships, co-ops, capstone projects, and personal projects.";
    expect(isTeachingPosting(posting)).toBe(false);
  });

  it("requires a second signal for weak terms (coursework needs corroboration)", () => {
    expect(isTeachingPosting("Software Engineer. Relevant experience via coursework or projects.")).toBe(false);
    expect(isTeachingPosting("Develop coursework and support students each term.")).toBe(true);
  });

  it("keeps industry roles at academic employers as industry", () => {
    expect(isTeachingPosting("Web developer to help the department with strategic web initiatives.")).toBe(false);
  });
});

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
    // The scraper's clean title/company are used (not re-derived from the body).
    expect(res.jobTitle).toBe("Senior Engineer");
    expect(res.companyName).toBe("Initech");
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
    // The standing leadership fact (leads a team of 5) is always surfaced.
    expect(res.result).toContain("a cross-functional team of 5"); // summary
    expect(res.result).toContain("team of 5"); // and the first-role bullet
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

describe("embeddedEngine edit rules (recurring hand-edits applied automatically)", () => {
  it("rewrites slot-filled text document-wide, reported and warned", async () => {
    const rules = [{ before: "team of 5", after: "team of 8" }];
    const base = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    const res = await embeddedEngine.tailorResume({ jobPosting: POSTING, editRules: rules });
    // The fact appears in the summary AND a bullet — both occurrences rewritten.
    expect(res.result).toContain("team of 8");
    expect(res.result).not.toContain("team of 5");
    expect(res.docxB64).not.toBe(base.docxB64);
    expect(res.report.meta.editRules.applied).toEqual([{ before: "team of 5", after: "team of 8" }]);
    expect(res.warnings.some((w) => /recurring edit/.test(w))).toBe(true);
    expect(res.result).not.toContain("{{");
  });

  it("rewrites static template text too (formatting-style edits)", async () => {
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: POSTING,
      jobTitle: "Staff Engineer",
      companyName: "Initech",
      editRules: [{ before: "Alex Shaw", after: "Alexander G. Shaw" }],
    });
    expect(res.result).toContain("Alexander G. Shaw");
    expect(res.result).not.toContain("Alex Shaw");
  });

  it("supports deletion rules (after is empty)", async () => {
    const res = await embeddedEngine.tailorResume({
      jobPosting: POSTING,
      editRules: [{ before: " cross-functional", after: "" }],
    });
    expect(res.result).toContain("a team of 5");
    expect(res.result).not.toContain("cross-functional team");
  });

  it("is deterministic and inert when rules match nothing", async () => {
    const args = { jobPosting: POSTING, editRules: [{ before: "team of 5", after: "team of 8" }] };
    const a = await embeddedEngine.tailorResume(args);
    const b = await embeddedEngine.tailorResume(args);
    expect(a.docxB64).toBe(b.docxB64);

    const base = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    const inert = await embeddedEngine.tailorResume({
      jobPosting: POSTING,
      editRules: [{ before: "text that appears nowhere at all", after: "x" }],
    });
    expect(inert.docxB64).toBe(base.docxB64);
    expect(inert.report.meta.editRules).toBeUndefined();
    expect(inert.warnings).toEqual([]);
  });
});

describe("embeddedEngine steering (the revise box, offline)", () => {
  it("emphasize/avoid directives change the document and are reported", async () => {
    const base = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    const steered = await embeddedEngine.tailorResume({
      jobPosting: POSTING,
      steeringInstructions: "Emphasize SQL. Remove React.",
    });
    // The directives actually changed what was generated (engine is
    // deterministic, so any byte difference is attributable to steering).
    expect(steered.docxB64).not.toBe(base.docxB64);
    expect(steered.report.meta.steering.emphasized).toContain("SQL");
    expect(steered.report.meta.steering.avoided).toContain("React");
    expect(steered.warnings).toEqual([]);
    expect(steered.result).not.toContain("{{");
  });

  it("steering is deterministic too", async () => {
    const args = { jobPosting: POSTING, steeringInstructions: "emphasize SQL" };
    const a = await embeddedEngine.tailorResume(args);
    const b = await embeddedEngine.tailorResume(args);
    expect(a.docxB64).toBe(b.docxB64);
  });

  it("'tone it down' nudges the effective aggressiveness down", async () => {
    const res = await embeddedEngine.tailorResume({
      jobPosting: POSTING,
      aggressiveness: 5,
      steeringInstructions: "tone it down",
    });
    expect(res.report.meta.steering.aggressiveness).toBe(4);
  });

  it("warns honestly when a note has no parseable directives", async () => {
    const res = await embeddedEngine.tailorResume({
      jobPosting: POSTING,
      steeringInstructions: "make it generally nicer somehow",
    });
    expect(res.warnings.length).toBe(1);
    expect(res.warnings[0]).toMatch(/emphasi|avoid|directives/i);
    expect(res.report.meta.steering).toBeUndefined();
  });

  it("cover letters honor steering as well", async () => {
    const base = await embeddedEngine.tailorCoverLetter({
      jobPosting: POSTING,
      jobTitle: "Staff Engineer",
      companyName: "Initech",
    });
    const steered = await embeddedEngine.tailorCoverLetter({
      jobPosting: POSTING,
      jobTitle: "Staff Engineer",
      companyName: "Initech",
      steeringInstructions: "emphasize SQL, drop React",
    });
    expect(steered.docxB64).not.toBe(base.docxB64);
    expect(steered.report.meta.steering.emphasized).toContain("SQL");
  });
});

describe("embeddedEngine.tailorCoverLetter", () => {
  it("renders an industry cover letter (no teaching framing) for a non-teaching posting", async () => {
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: POSTING, // "Senior Software Engineer" — no teaching signal
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
    // The adjunct-teaching framing is dropped for an industry role: no students,
    // courses, rubrics, or "students and courses" closing.
    expect(res.result).not.toMatch(/\bstudents?\b/i);
    expect(res.result).not.toContain("project-based courses");
    expect(res.result).not.toContain("rubrics");
    expect(res.result).not.toContain("instructional team");
    expect(res.result).not.toContain("alongside the higher-education instruction");
    // Industry framing leads with a shipping track record.
    expect(res.result).toContain("track record of shipping production-quality software");
    // The standing leadership fact (leads a team of 5) is always surfaced.
    expect(res.result).toContain("I lead an engineering team of five");
    // Formal register: no contractions (possessives like "team's" are fine).
    expect(res.result).not.toMatch(/\b(?:I'm|I've|I'd|it's)\b/i);
    // Prose capability lists use a serial ("Oxford") "and": "A, B, and C".
    expect(res.result).toMatch(/, and /);
    // The opening "hands-on work with …" tech list leads with real technologies
    // (languages/frameworks), not just collaboration tools.
    expect(res.result).toMatch(/hands-on work with [^.]*\b(React|TypeScript|JavaScript|PostgreSQL|SQL)\b/);
    expect(res.report.meta.document).toBe("cover_letter");
  });

  it("keeps the adjunct-teaching framing for a teaching posting", async () => {
    const res = await embeddedEngine.tailorCoverLetter({
      jobPosting: "Adjunct Faculty position to teach undergraduate courses and provide quality instruction to students each term.",
      jobTitle: "Adjunct Faculty",
      companyName: "Community College",
    });
    // The teaching variant retains the concrete adjunct figures.
    expect(res.result).toContain("designing and revamping eight project-based courses");
    expect(res.result).toContain("more than 100 students each term");
    // …and still surfaces the standing leadership fact (leads a team of 5).
    expect(res.result).toContain("I lead an engineering team of five");
    expect(res.result).not.toContain("{{");
    expect(res.result).not.toMatch(/\b(?:I'm|I've|I'd|it's)\b/i);
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
