import { describe, it, expect } from "vitest";
import {
  MAX_RESUME_CHARS,
  MAX_COVER_LETTER_CHARS,
  SUBMITTED_RESUME_HEADER,
  SUBMITTED_COVER_LETTER_HEADER,
  NO_SUBMITTED_DOCS_NOTE,
  clampDocs,
  groundingFlags,
  submittedDocsPromptParts,
} from "./applicationDocsPrompt.js";

describe("clampDocs", () => {
  it("leaves a résumé under the cap unchanged", () => {
    const resume = "a".repeat(MAX_RESUME_CHARS - 1);
    expect(clampDocs({ resume, coverLetter: "" }).resume).toBe(resume);
  });

  it("leaves a résumé exactly at the cap unchanged", () => {
    const resume = "a".repeat(MAX_RESUME_CHARS);
    const result = clampDocs({ resume, coverLetter: "" });
    expect(result.resume).toBe(resume);
    expect(result.resume).toHaveLength(MAX_RESUME_CHARS);
  });

  it("truncates a résumé over the cap to exactly the cap", () => {
    const resume = "a".repeat(MAX_RESUME_CHARS + 500);
    const result = clampDocs({ resume, coverLetter: "" });
    expect(result.resume).toHaveLength(MAX_RESUME_CHARS);
    expect(result.resume).toBe("a".repeat(MAX_RESUME_CHARS));
  });

  it("leaves a cover letter under the cap unchanged", () => {
    const coverLetter = "b".repeat(MAX_COVER_LETTER_CHARS - 1);
    expect(clampDocs({ resume: "", coverLetter }).coverLetter).toBe(coverLetter);
  });

  it("leaves a cover letter exactly at the cap unchanged", () => {
    const coverLetter = "b".repeat(MAX_COVER_LETTER_CHARS);
    const result = clampDocs({ resume: "", coverLetter });
    expect(result.coverLetter).toBe(coverLetter);
    expect(result.coverLetter).toHaveLength(MAX_COVER_LETTER_CHARS);
  });

  it("truncates a cover letter over the cap to exactly the cap", () => {
    const coverLetter = "b".repeat(MAX_COVER_LETTER_CHARS + 500);
    const result = clampDocs({ resume: "", coverLetter });
    expect(result.coverLetter).toHaveLength(MAX_COVER_LETTER_CHARS);
    expect(result.coverLetter).toBe("b".repeat(MAX_COVER_LETTER_CHARS));
  });

  it("treats undefined fields as empty strings", () => {
    expect(clampDocs({ resume: undefined, coverLetter: undefined })).toEqual({
      resume: "",
      coverLetter: "",
    });
  });

  it("treats null fields as empty strings", () => {
    expect(clampDocs({ resume: null, coverLetter: null })).toEqual({
      resume: "",
      coverLetter: "",
    });
  });

  it("treats a missing field as an empty string", () => {
    expect(clampDocs({ resume: "only resume" })).toEqual({
      resume: "only resume",
      coverLetter: "",
    });
  });

  it("called with no argument at all returns both fields empty", () => {
    expect(clampDocs()).toEqual({ resume: "", coverLetter: "" });
  });

  it("does not throw for a non-string resume (number) and stringifies or empties it per String(x || \"\")", () => {
    // String(5 || "") === "5" -- a truthy number stringifies rather than
    // vanishing, since `5 || ""` evaluates to 5, not "".
    expect(() => clampDocs({ resume: 5, coverLetter: "" })).not.toThrow();
    expect(clampDocs({ resume: 5, coverLetter: "" }).resume).toBe("5");
  });

  it("does not throw for a non-string resume (0) which is falsy and becomes empty", () => {
    // String(0 || "") === "" -- 0 is falsy, so `0 || ""` evaluates to "".
    expect(clampDocs({ resume: 0, coverLetter: "" }).resume).toBe("");
  });

  it("does not throw for a non-string coverLetter (object) and stringifies it", () => {
    const obj = { toString: () => "custom-string" };
    expect(() => clampDocs({ resume: "", coverLetter: obj })).not.toThrow();
    expect(clampDocs({ resume: "", coverLetter: obj }).coverLetter).toBe("custom-string");
  });

  it("never throws when called with no argument, or with an empty object", () => {
    // Matches the AC's "called with no argument at all" case: the default
    // parameter (`= {}`) only kicks in for an explicit `undefined`
    // argument (including none at all), not for `null` -- destructuring
    // `null` throws regardless of a default, which is ordinary JS
    // semantics rather than a gap in this function's own guarding.
    expect(() => clampDocs(undefined)).not.toThrow();
    expect(() => clampDocs({})).not.toThrow();
    expect(clampDocs(undefined)).toEqual({ resume: "", coverLetter: "" });
    expect(clampDocs({})).toEqual({ resume: "", coverLetter: "" });
  });
});

describe("groundingFlags", () => {
  it("returns both true when both documents are present", () => {
    expect(groundingFlags({ resume: "resume text", coverLetter: "cover letter text" })).toEqual({
      resume: true,
      coverLetter: true,
    });
  });

  it("returns resume true, coverLetter false when only the résumé is present", () => {
    expect(groundingFlags({ resume: "resume text", coverLetter: "" })).toEqual({
      resume: true,
      coverLetter: false,
    });
  });

  it("returns resume false, coverLetter true when only the cover letter is present", () => {
    expect(groundingFlags({ resume: "", coverLetter: "cover letter text" })).toEqual({
      resume: false,
      coverLetter: true,
    });
  });

  it("returns both false when neither document is present", () => {
    expect(groundingFlags({ resume: "", coverLetter: "" })).toEqual({
      resume: false,
      coverLetter: false,
    });
  });

  it("returns both false when called with missing/undefined input", () => {
    expect(groundingFlags()).toEqual({ resume: false, coverLetter: false });
    expect(groundingFlags({})).toEqual({ resume: false, coverLetter: false });
  });

  it("returns both false when fields are explicitly undefined", () => {
    expect(groundingFlags({ resume: undefined, coverLetter: undefined })).toEqual({
      resume: false,
      coverLetter: false,
    });
  });

  // PINNED, deliberately not "fixed": the check is the bare `!!resume` /
  // `!!coverLetter` truthiness test, and a whitespace-only string is
  // truthy in JavaScript. So a document that is "submitted" but contains
  // only whitespace (no usable content) is reported as grounded here.
  //
  // Consequence downstream: app/copilot/practice/SampleAnswer.js's
  // sourceCaption reads this flag and will claim the sample answer was
  // drafted "from the resume you submitted" even though there is no
  // usable resume content behind that claim. This test records that
  // behavior as-is; whether it's worth changing is a separate decision.
  it("PINS: a whitespace-only résumé is reported as grounded (truthiness bug, not fixed here)", () => {
    expect(groundingFlags({ resume: "   ", coverLetter: "" })).toEqual({
      resume: true,
      coverLetter: false,
    });
  });

  it("PINS: a whitespace-only cover letter is reported as grounded (same truthiness bug)", () => {
    expect(groundingFlags({ resume: "", coverLetter: "\n\t " })).toEqual({
      resume: false,
      coverLetter: true,
    });
  });
});

describe("submittedDocsPromptParts", () => {
  it("returns both sections, in order, when both documents are present", () => {
    const parts = submittedDocsPromptParts({ resume: "RESUME BODY", coverLetter: "COVER BODY" });
    expect(parts).toEqual([
      "",
      SUBMITTED_RESUME_HEADER,
      "RESUME BODY",
      "",
      SUBMITTED_COVER_LETTER_HEADER,
      "COVER BODY",
    ]);
  });

  it("returns only the résumé section when only the résumé is present", () => {
    const parts = submittedDocsPromptParts({ resume: "RESUME BODY", coverLetter: "" });
    expect(parts).toEqual(["", SUBMITTED_RESUME_HEADER, "RESUME BODY"]);
  });

  it("returns only the cover letter section when only the cover letter is present", () => {
    const parts = submittedDocsPromptParts({ resume: "", coverLetter: "COVER BODY" });
    expect(parts).toEqual(["", SUBMITTED_COVER_LETTER_HEADER, "COVER BODY"]);
  });

  it("returns only the no-submitted-docs note when neither document is present", () => {
    const parts = submittedDocsPromptParts({ resume: "", coverLetter: "" });
    expect(parts).toEqual(["", NO_SUBMITTED_DOCS_NOTE]);
  });

  it("emits NO_SUBMITTED_DOCS_NOTE only in the neither-present case", () => {
    // This is the load-bearing assertion for this file: two call sites
    // (points-mode in app/api/copilot/answer/route.js and the critique
    // prompt in app/api/copilot/critique/route.js) rely on this helper
    // never emitting the note when at least one document was found, and
    // both guard the "neither" case themselves by simply not calling this
    // helper at all rather than trusting it to omit the note.
    const both = submittedDocsPromptParts({ resume: "R", coverLetter: "C" });
    const resumeOnly = submittedDocsPromptParts({ resume: "R", coverLetter: "" });
    const coverOnly = submittedDocsPromptParts({ resume: "", coverLetter: "C" });
    const neither = submittedDocsPromptParts({ resume: "", coverLetter: "" });

    expect(both).not.toContain(NO_SUBMITTED_DOCS_NOTE);
    expect(resumeOnly).not.toContain(NO_SUBMITTED_DOCS_NOTE);
    expect(coverOnly).not.toContain(NO_SUBMITTED_DOCS_NOTE);
    expect(neither).toContain(NO_SUBMITTED_DOCS_NOTE);
  });

  it("uses the exact header constants, not hand-copied strings", () => {
    expect(SUBMITTED_RESUME_HEADER).toBe("--- SUBMITTED RESUME (for this application) ---");
    expect(SUBMITTED_COVER_LETTER_HEADER).toBe("--- SUBMITTED COVER LETTER (for this application) ---");
  });
});
