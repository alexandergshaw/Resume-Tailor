// N49 fix round (verify.r1.md M5): direct unit coverage for the three
// exports this module's own ledger entry (lib/sourceScan/
// exportReachability.ledger.js) used to claim were "built and tested"
// alongside stripTerminal, when in fact nothing anywhere referenced them --
// measured by grep and by mutant M-GRAMMAR-GUT, which changed the heading
// literal, forced isInterviewProcessHeading to false and parseGrammarLine to
// null, and ran the whole N49 suite plus the export sweep untouched.
// stripTerminal already has its own coverage (its FIXPOINT row in
// interviewerRoles.test.js), so it is not repeated here.

import { describe, it, expect } from "vitest";
import {
  INTERVIEW_PROCESS_HEADING,
  isInterviewProcessHeading,
  parseGrammarLine,
} from "./interviewProcessGrammar.js";

describe("INTERVIEW_PROCESS_HEADING", () => {
  it("is the fixed heading string the digest grammar is built around", () => {
    expect(INTERVIEW_PROCESS_HEADING).toBe("Interview process");
  });
});

describe("isInterviewProcessHeading", () => {
  it("recognises the markdown heading line, tolerant of extra whitespace and case", () => {
    expect(isInterviewProcessHeading("## Interview process")).toBe(true);
    expect(isInterviewProcessHeading("##   Interview process  ")).toBe(true);
    expect(isInterviewProcessHeading("## INTERVIEW PROCESS")).toBe(true);
    expect(isInterviewProcessHeading("##Interview process")).toBe(false);
  });

  it("refuses every other heading level and any non-heading line", () => {
    expect(isInterviewProcessHeading("# Interview process")).toBe(false);
    expect(isInterviewProcessHeading("### Interview process")).toBe(false);
    expect(isInterviewProcessHeading("## About you")).toBe(false);
    expect(isInterviewProcessHeading("Interview process")).toBe(false);
    expect(isInterviewProcessHeading("- Stage: Recruiter screen")).toBe(false);
  });

  it("returns false, never a throw, for non-string input", () => {
    for (const value of [undefined, null, 0, {}, [], () => {}]) {
      expect(isInterviewProcessHeading(value)).toBe(false);
    }
  });
});

describe("parseGrammarLine", () => {
  it("parses each of the three grammar lines, plain and bold", () => {
    expect(parseGrammarLine("- Stage: Recruiter screen")).toEqual({
      kind: "stage",
      item: "Recruiter screen",
      itemOffset: "- Stage: ".length,
    });
    expect(parseGrammarLine("- Conducted by: Hiring Manager")).toEqual({
      kind: "role",
      item: "Hiring Manager",
      itemOffset: "- Conducted by: ".length,
    });
    expect(parseGrammarLine("- Question: Tell me about a project that went wrong.")).toEqual({
      kind: "question",
      item: "Tell me about a project that went wrong.",
      itemOffset: "- Question: ".length,
    });
    // Bold markers and a `*`/`+` bullet are both tolerated -- the vendor's
    // own markdown rendering is not consistent about either.
    expect(parseGrammarLine("* **Stage:** Hiring manager interview")).toEqual({
      kind: "stage",
      item: "Hiring manager interview",
      itemOffset: "* **Stage:** ".length,
    });
  });

  it("fails CLOSED on a drifted line -- never guessed at", () => {
    for (const line of [
      "Stage: Recruiter screen",
      "- Unknown: Recruiter screen",
      "- stage: Recruiter screen",
      "  ",
      "",
      "- Stage Recruiter screen",
    ]) {
      expect(parseGrammarLine(line)).toBeNull();
    }
  });

  it("returns null, never a throw, for non-string input", () => {
    for (const value of [undefined, null, 0, {}, [], () => {}]) {
      expect(parseGrammarLine(value)).toBeNull();
    }
  });

  it("an item can be empty, and itemOffset still names where it would start", () => {
    const parsed = parseGrammarLine("- Question:");
    expect(parsed).toEqual({ kind: "question", item: "", itemOffset: "- Question:".length });
  });
});
