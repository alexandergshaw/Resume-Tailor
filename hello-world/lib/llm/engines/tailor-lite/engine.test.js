import { describe, it, expect } from "vitest";
import { embeddedEngine } from "./engine.js";
import { loadDocx, scanPlaceholders } from "./docxModel.js";

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
  it("returns slots with strategies and keywords", async () => {
    const data = await embeddedEngine.getProposals({ jobPosting: POSTING });
    expect(Array.isArray(data.slots)).toBe(true);
    expect(data.slots.length).toBeGreaterThan(0);

    const byKey = Object.fromEntries(data.slots.map((s) => [s.key, s]));
    expect(byKey["FULL_NAME::0"].strategy).toBe("profile");
    expect(byKey["SKILLS_LINE::0"].strategy).toBe("skills");
    expect(data.keywords.technology.some((t) => t.canonical === "Python")).toBe(true);
  });

  it("rejects an empty posting", async () => {
    await expect(embeddedEngine.getProposals({ jobPosting: "  " })).rejects.toThrow();
  });
});

describe("embeddedEngine.tailorResume", () => {
  it("returns a base64 .docx plus a report with unfilled keys", async () => {
    const res = await embeddedEngine.tailorResume({ jobPosting: POSTING });
    expect(typeof res.docxB64).toBe("string");
    expect(res.docxB64.length).toBeGreaterThan(200);
    expect(res.resultLines.length).toBeGreaterThan(0);
    expect(Array.isArray(res.report.unfilled)).toBe(true);
    expect(res.report.meta).toEqual({ renderer: "local", workflow: "legacy" });
  });

  it("leaves a placeholder visible when overridden with an empty value", async () => {
    const res = await embeddedEngine.tailorResume({
      jobPosting: POSTING,
      values: { "FULL_NAME::0": "" },
    });
    expect(res.report.unfilled).toContain("FULL_NAME::0");

    const doc = await loadDocx(Buffer.from(res.docxB64, "base64"));
    expect(scanPlaceholders(doc).map((s) => s.key)).toContain("FULL_NAME::0");
  });

  it("applies an override value to the document", async () => {
    const res = await embeddedEngine.tailorResume({
      jobPosting: POSTING,
      values: { "FULL_NAME::0": "Grace Hopper" },
    });
    expect(res.resultLines).toContain("Grace Hopper");
    const slot = res.report.slots.find((s) => s.key === "FULL_NAME::0");
    expect(slot.source).toBe("overridden");
    expect(slot.final_value).toBe("Grace Hopper");
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
    expect(text).toContain("Alex Morgan"); // FULL_NAME from profile.json
    // Seeded slots are always filled — no raw placeholder leaks through.
    expect(text).not.toContain("{{TARGET_ROLE}}");
    expect(text).not.toContain("{{TARGET_ORGANIZATION}}");
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
