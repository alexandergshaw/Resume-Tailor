import { describe, it, expect } from "vitest";
import { buildHiringEmailPrompt } from "./tailorResume.js";

const baseOptions = {
  jobPosting: "We are hiring a Widget Engineer at Acme.",
  jobPostingUrl: "",
  companyName: "Acme Corp",
  jobTitle: "Widget Engineer",
  resumeText: "ORIGINAL RESUME TEXT MARKER",
  tailoredResume: undefined,
  additionalContext: "",
  steeringInstructions: "",
};

function assertHardConstraintsPreserved(prompt) {
  expect(prompt).toContain(
    "Do not fabricate employers, titles, dates, certifications, or metrics that are not supported by the résumé or provided context."
  );
  expect(prompt).toContain(
    'Output JSON only in this exact shape: {"subject": "", "bodyLines": ["", ""]} — no other keys, no commentary, no markdown.'
  );
  expect(prompt).toContain("subject is a single line (no line breaks) that names the role.");
  expect(prompt).toContain("bodyLines is 3 to 4 short paragraphs");
  expect(prompt).toContain("No bullet points, no markdown, no signature block beyond that closing line.");
}

describe("buildHiringEmailPrompt", () => {
  it("includes the no-fabrication hard constraint", () => {
    const prompt = buildHiringEmailPrompt(baseOptions);

    expect(prompt).toContain(
      "Do not fabricate employers, titles, dates, certifications, or metrics that are not supported by the résumé or provided context."
    );
  });

  it("includes the JSON-only output shape instruction", () => {
    const prompt = buildHiringEmailPrompt(baseOptions);

    expect(prompt).toContain(
      'Output JSON only in this exact shape: {"subject": "", "bodyLines": ["", ""]} — no other keys, no commentary, no markdown.'
    );
  });

  it("includes the subject-is-one-line constraint", () => {
    const prompt = buildHiringEmailPrompt(baseOptions);

    expect(prompt).toContain("subject is a single line (no line breaks) that names the role.");
  });

  it("includes the short-body guidance: three or four short paragraphs, no markdown, no bullets", () => {
    const prompt = buildHiringEmailPrompt(baseOptions);

    expect(prompt).toContain("bodyLines is 3 to 4 short paragraphs");
    expect(prompt).toContain("No bullet points, no markdown, no signature block beyond that closing line.");
  });

  it("with a usable tailoredResume: grounds on the tailored text instead of the original resume", () => {
    const tailoredResume = { result: "TAILORED RESUME TEXT MARKER" };
    const prompt = buildHiringEmailPrompt({ ...baseOptions, tailoredResume });

    expect(prompt).toContain(
      "Tailored résumé (already tailored for this exact posting — draw the email's one or two concrete strengths from it):"
    );
    expect(prompt).toContain("TAILORED RESUME TEXT MARKER");
    expect(prompt).not.toContain("Source resume (for factual grounding only):");

    assertHardConstraintsPreserved(prompt);
  });

  it("without tailoredResume (omitted): falls back to the original resume text and still produces a usable grounding block", () => {
    const prompt = buildHiringEmailPrompt({ ...baseOptions, tailoredResume: undefined });

    expect(prompt).toContain("Source resume (for factual grounding only):");
    expect(prompt).toContain("ORIGINAL RESUME TEXT MARKER");
    expect(prompt).not.toContain("Tailored résumé (already tailored for this exact posting");

    assertHardConstraintsPreserved(prompt);
  });

  it("with tailoredResume carrying no usable content (whitespace-only result): falls back to the original resume text", () => {
    const prompt = buildHiringEmailPrompt({ ...baseOptions, tailoredResume: { result: "   " } });

    expect(prompt).toContain("Source resume (for factual grounding only):");
    expect(prompt).toContain("ORIGINAL RESUME TEXT MARKER");
    expect(prompt).not.toContain("Tailored résumé (already tailored for this exact posting");
  });

  it("with tailoredResume null: falls back to the original resume text rather than an empty grounding block", () => {
    const prompt = buildHiringEmailPrompt({ ...baseOptions, tailoredResume: null });

    expect(prompt).toContain("Source resume (for factual grounding only):");
    expect(prompt).toContain("ORIGINAL RESUME TEXT MARKER");
  });

  it("without resumeText or tailoredResume: still falls back to a non-empty grounding block instead of an empty one", () => {
    const prompt = buildHiringEmailPrompt({ ...baseOptions, resumeText: "", tailoredResume: undefined });

    expect(prompt).toContain("Source resume (for factual grounding only):");
    expect(prompt).toContain("Not provided.");
  });

  it("interpolates the target role and company", () => {
    const prompt = buildHiringEmailPrompt({
      ...baseOptions,
      jobTitle: "Principal Widget Architect",
      companyName: "Widgets International",
    });

    expect(prompt).toContain("Target role: Principal Widget Architect");
    expect(prompt).toContain("Target company: Widgets International");
  });

  it("includes a steering block with the exact instructions when steeringInstructions is supplied", () => {
    const prompt = buildHiringEmailPrompt({
      ...baseOptions,
      steeringInstructions: "Make the tone warmer and mention my leadership experience.",
    });

    expect(prompt).toContain("USER REVISION REQUEST (highest priority):");
    expect(prompt).toContain("Make the tone warmer and mention my leadership experience.");
  });

  it("omits the steering header entirely when steeringInstructions is empty", () => {
    const prompt = buildHiringEmailPrompt({ ...baseOptions, steeringInstructions: "" });

    expect(prompt).not.toContain("USER REVISION REQUEST");
  });

  it("omits the steering header when steeringInstructions is whitespace-only", () => {
    const prompt = buildHiringEmailPrompt({ ...baseOptions, steeringInstructions: "   " });

    expect(prompt).not.toContain("USER REVISION REQUEST");
  });

  it("the role sentence says the email is addressed to the hiring committee", () => {
    const prompt = buildHiringEmailPrompt(baseOptions);

    expect(prompt).toContain(
      "You are a job applicant writing a short, genuine email addressed to a company's hiring committee to accompany your résumé and cover letter."
    );
  });

  it("constraint 3 says the email is addressed to the hiring committee and instructs the salutation as the first bodyLine", () => {
    const prompt = buildHiringEmailPrompt(baseOptions);

    expect(prompt).toContain("bodyLines is 3 to 4 short paragraphs addressed to the hiring committee");
    expect(prompt).toContain(
      'the first bodyLine must be exactly the salutation "Dear Hiring Committee," on its own line'
    );
  });

  it("the closing instruction asks for a sign-off line followed by the candidate's name", () => {
    const prompt = buildHiringEmailPrompt(baseOptions);

    expect(prompt).toContain("a closing sign-off line (for example \"Best regards,\") followed by the candidate's name on its own line");
  });
});
