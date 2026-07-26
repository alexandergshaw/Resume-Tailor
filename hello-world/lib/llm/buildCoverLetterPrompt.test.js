import { describe, it, expect } from "vitest";
import { buildCoverLetterPrompt } from "./tailorResume.js";

const templateLines = ["Dear Hiring Manager,", "", "Sincerely, Applicant"];

const baseOptions = {
  jobPosting: "We are hiring a Widget Engineer at Acme.",
  jobPostingUrl: "",
  companyName: "Acme Corp",
  jobTitle: "Widget Engineer",
  resumeText: "ORIGINAL RESUME TEXT MARKER",
  templateLines,
  additionalContext: "",
  contextDocuments: [],
  steeringInstructions: "",
};

function assertStructurePreserved(prompt) {
  expect(prompt).toContain(`Output exactly ${templateLines.length} lines, in the same slot order as the template.`);
  expect(prompt).toContain("within ±10%");
  expect(prompt).toContain("Never exceed +15%.");
  expect(prompt).toContain("Treat blank template lines as blank in the output (used as paragraph breaks). Do not collapse or remove blank lines.");
  expect(prompt).toContain('Output JSON only in this exact shape: {"resultLines":');
}

describe("buildCoverLetterPrompt", () => {
  it("with a usable tailoredResume: grounds on the tailored text plus original background, and drops the copy-phrasing warning", () => {
    const tailoredResume = { result: "TAILORED RESUME TEXT MARKER" };
    const prompt = buildCoverLetterPrompt({ ...baseOptions, tailoredResume });

    expect(prompt).toContain("Tailored résumé (already tailored for this exact posting");
    expect(prompt).toContain("TAILORED RESUME TEXT MARKER");
    expect(prompt).toContain("Original resume (background only, for additional factual grounding):");
    expect(prompt).not.toContain("do not copy phrasing wholesale");

    assertStructurePreserved(prompt);
    expect(prompt).toContain("ORIGINAL RESUME TEXT MARKER");
  });

  it("without tailoredResume omitted: falls back to the original-resume-only block with the copy-phrasing warning", () => {
    const prompt = buildCoverLetterPrompt({ ...baseOptions, tailoredResume: undefined });

    expect(prompt).toContain("Source resume (for factual grounding only — do not copy phrasing wholesale):");
    expect(prompt).toContain("do not copy phrasing wholesale");
    expect(prompt).not.toContain("Tailored résumé (already tailored for this exact posting");

    assertStructurePreserved(prompt);
    expect(prompt).toContain("ORIGINAL RESUME TEXT MARKER");
  });

  it("without tailoredResume null: still falls back to the original-resume-only block", () => {
    const prompt = buildCoverLetterPrompt({ ...baseOptions, tailoredResume: null });

    expect(prompt).toContain("Source resume (for factual grounding only — do not copy phrasing wholesale):");
    expect(prompt).not.toContain("Tailored résumé (already tailored for this exact posting");

    assertStructurePreserved(prompt);
  });

  it("with tailoredResume carrying no usable content (empty result and no resultLines): falls back to the original-resume-only block", () => {
    const prompt = buildCoverLetterPrompt({ ...baseOptions, tailoredResume: { result: "   " } });

    expect(prompt).toContain("Source resume (for factual grounding only — do not copy phrasing wholesale):");
    expect(prompt).not.toContain("Tailored résumé (already tailored for this exact posting");

    assertStructurePreserved(prompt);
  });

  it("includes a steering block with the exact instructions when steeringInstructions is supplied", () => {
    const prompt = buildCoverLetterPrompt({
      ...baseOptions,
      steeringInstructions: "Make the tone warmer and mention my leadership experience.",
    });

    expect(prompt).toContain("USER REVISION REQUEST (highest priority):");
    expect(prompt).toContain("Make the tone warmer and mention my leadership experience.");
  });

  it("omits the steering header entirely when steeringInstructions is empty", () => {
    const prompt = buildCoverLetterPrompt({ ...baseOptions, steeringInstructions: "" });

    expect(prompt).not.toContain("USER REVISION REQUEST");
  });

  it("omits the steering header when steeringInstructions is whitespace-only", () => {
    const prompt = buildCoverLetterPrompt({ ...baseOptions, steeringInstructions: "   " });

    expect(prompt).not.toContain("USER REVISION REQUEST");
  });

  it("interpolates jobTitle and companyName into the target-role/company lines", () => {
    const prompt = buildCoverLetterPrompt({
      ...baseOptions,
      jobTitle: "Principal Widget Architect",
      companyName: "Widgets International",
    });

    expect(prompt).toContain("Target role: Principal Widget Architect");
    expect(prompt).toContain("Target company: Widgets International");
  });

  it("derives the output-line-count and character-budget constraints from templateLines, including a blank entry", () => {
    const lines = ["Dear Team,", "", "First paragraph body.", "Best, Me"];
    const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
    const prompt = buildCoverLetterPrompt({ ...baseOptions, templateLines: lines, tailoredResume: undefined });

    expect(prompt).toContain(`Output exactly ${lines.length} lines, in the same slot order as the template.`);
    expect(prompt).toContain(`Total character count must stay within ±5% of the template total (${totalChars} characters).`);
    // The rendered template block still numbers the blank line rather than skipping it.
    expect(prompt).toContain("2. [chars=0] ");
  });
});
