import { describe, it, expect } from "vitest";
import { buildHiringEmailText } from "./engine.js";

// Helper: every returned body line must be a non-empty, already-trimmed string —
// the function must never emit "" or whitespace-only lines the caller has to filter.
function expectWellFormedLines(bodyLines) {
  expect(Array.isArray(bodyLines)).toBe(true);
  expect(bodyLines.length).toBeGreaterThan(0);
  for (const line of bodyLines) {
    expect(typeof line).toBe("string");
    expect(line.length).toBeGreaterThan(0);
    expect(line).toBe(line.trim());
  }
}

const FULL_PROFILE = {
  values: {
    FULL_NAME: "Jamie Rivera",
    CURRENT_EMPLOYER: "Initech",
    PRIMARY_FUNCTION: "Software Engineer",
    YEARS_OF_EXPERIENCE: "8",
  },
};

describe("buildHiringEmailText", () => {
  it("returns a string subject and an array of non-empty string bodyLines", () => {
    const { subject, bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React", "TypeScript"],
      profile: FULL_PROFILE,
    });
    expect(typeof subject).toBe("string");
    expect(subject.length).toBeGreaterThan(0);
    expectWellFormedLines(bodyLines);
  });

  it("the subject is exactly one line", () => {
    const { subject } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React"],
      profile: FULL_PROFILE,
    });
    expect(subject).not.toContain("\n");
  });

  it("includes the supplied role and organization in the output", () => {
    const { subject, bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: [],
      profile: FULL_PROFILE,
    });
    const whole = `${subject}\n${bodyLines.join("\n")}`;
    expect(whole).toContain("Senior Engineer");
    expect(whole).toContain("Acme Corp");
  });

  it("includes the supplied capabilities in the body", () => {
    const { bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["Kubernetes", "Docker", "Terraform"],
      profile: FULL_PROFILE,
    });
    const body = bodyLines.join("\n");
    expect(body).toContain("Kubernetes");
    expect(body).toContain("Docker");
    expect(body).toContain("Terraform");
  });

  it("degrades gracefully with no literal undefined/null/NaN when the profile is entirely missing headline values", () => {
    const { subject, bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React"],
      profile: { values: {} },
    });
    const whole = `${subject}\n${bodyLines.join("\n")}`;
    expect(whole).not.toMatch(/undefined/i);
    expect(whole).not.toMatch(/\bnull\b/i);
    expect(whole).not.toMatch(/\bNaN\b/i);
    expectWellFormedLines(bodyLines);
    // Salutation stays the untouched first line; the intro is its own line
    // right after it and still reads as a real sentence, not a bare fragment.
    expect(bodyLines[0]).toBe("Dear Hiring Committee,");
    expect(bodyLines[1]).toMatch(/^I'm writing, and I'm excited to apply for the Senior Engineer role at Acme Corp\.$/);
  });

  it("degrades gracefully with no literal undefined/null/NaN when profile itself is undefined", () => {
    const { subject, bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React"],
      profile: undefined,
    });
    const whole = `${subject}\n${bodyLines.join("\n")}`;
    expect(whole).not.toMatch(/undefined/i);
    expect(whole).not.toMatch(/\bnull\b/i);
    expect(whole).not.toMatch(/\bNaN\b/i);
    expectWellFormedLines(bodyLines);
    // No name to sign off with -> closes with a bare "Best regards,", never "Best regards, undefined".
    expect(bodyLines[bodyLines.length - 1]).toBe("Best regards,");
  });

  it("degrades gracefully when only some profile values are present (no name, no employer)", () => {
    const { bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React"],
      profile: { values: { PRIMARY_FUNCTION: "software engineer", YEARS_OF_EXPERIENCE: "5" } },
    });
    const whole = bodyLines.join("\n");
    expect(whole).not.toMatch(/undefined/i);
    expect(whole).not.toMatch(/\bnull\b/i);
    expect(whole).not.toMatch(/\bNaN\b/i);
    expectWellFormedLines(bodyLines);
    expect(bodyLines[1]).toContain("I'm a software engineer with 5 years of experience");
    // No employer supplied -> no dangling "currently at" clause.
    expect(whole).not.toContain("currently at");
  });

  it("an empty capabilities array still produces a sensible email with no dangling phrase or trailing comma", () => {
    const { bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: [],
      profile: FULL_PROFILE,
    });
    expectWellFormedLines(bodyLines);
    // Check only the prose sentences for a dangling comma: the fixed
    // "Dear Hiring Committee," salutation and "Best regards," sign-off lines
    // are themselves intentionally comma-terminated.
    const proseLines = bodyLines.slice(1, -2);
    const whole = proseLines.join("\n");
    // The capability-list sentence is simply omitted, not left half-built.
    expect(whole).not.toContain("hands-on work with");
    expect(whole).not.toMatch(/,\s*$/m);
    expect(whole).not.toMatch(/,\s*\./);
  });

  it("contains no markdown syntax and no bullet characters", () => {
    const { subject, bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React", "TypeScript", "SQL"],
      profile: FULL_PROFILE,
    });
    const whole = `${subject}\n${bodyLines.join("\n")}`;
    expect(whole).not.toMatch(/[*_#`]/);
    expect(whole).not.toMatch(/^[-•]/m);
    expect(whole).not.toContain("- ");
    expect(whole).not.toContain("• ");
  });

  it("does not end mid-sentence: the final body line ends with punctuation or a simple closing", () => {
    const { bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React"],
      profile: FULL_PROFILE,
    });
    const last = bodyLines[bodyLines.length - 1];
    const secondLast = bodyLines[bodyLines.length - 2];
    // With a name present, the sign-off is two lines and the last line is the
    // bare name; without a name, the last line is the bare "Best regards,".
    expect(last === "Best regards," || secondLast === "Best regards," || /[.!?]$/.test(last)).toBe(true);
  });

  it("the salutation is exactly bodyLines[0], as its own line", () => {
    const { bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React", "TypeScript"],
      profile: FULL_PROFILE,
    });
    expect(bodyLines[0]).toBe("Dear Hiring Committee,");
  });

  it("signs off with the candidate's name when one is present: the sign-off is the last two lines", () => {
    const { bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React"],
      profile: FULL_PROFILE,
    });
    expect(bodyLines[bodyLines.length - 2]).toBe("Best regards,");
    expect(bodyLines[bodyLines.length - 1]).toBe("Jamie Rivera");
  });

  it("signs off with a single 'Best regards,' line when no name is present", () => {
    const { bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React"],
      profile: { values: { PRIMARY_FUNCTION: "software engineer", YEARS_OF_EXPERIENCE: "5" } },
    });
    expect(bodyLines[bodyLines.length - 1]).toBe("Best regards,");
    expect(bodyLines[bodyLines.length - 2]).not.toBe("Best regards,");
  });

  it("no line begins with 'Hello, '", () => {
    const { bodyLines } = buildHiringEmailText({
      role: "Senior Engineer",
      organization: "Acme Corp",
      capabilities: ["React", "TypeScript"],
      profile: FULL_PROFILE,
    });
    for (const line of bodyLines) {
      expect(line.startsWith("Hello, ")).toBe(false);
    }
  });
});
