import { describe, it, expect } from "vitest";
import { resolveTailoredResumeText } from "./tailorResume.js";

describe("resolveTailoredResumeText", () => {
  it("returns empty string for null", () => {
    expect(resolveTailoredResumeText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(resolveTailoredResumeText(undefined)).toBe("");
  });

  it("returns empty string for a non-object argument (string)", () => {
    expect(resolveTailoredResumeText("some resume text")).toBe("");
  });

  it("returns empty string for a non-object argument (number)", () => {
    expect(resolveTailoredResumeText(42)).toBe("");
  });

  it("returns empty string for a non-object argument (boolean)", () => {
    expect(resolveTailoredResumeText(true)).toBe("");
  });

  it("returns result when it is a usable string", () => {
    expect(resolveTailoredResumeText({ result: "text" })).toBe("text");
  });

  it("trims a padded result", () => {
    expect(resolveTailoredResumeText({ result: "  padded  " })).toBe("padded");
  });

  it("falls through to resultLines when result is whitespace-only", () => {
    const tailoredResume = { result: "   ", resultLines: ["a", "b"] };
    expect(resolveTailoredResumeText(tailoredResume)).toBe("a\nb");
  });

  it("joins resultLines entries with a newline", () => {
    expect(resolveTailoredResumeText({ resultLines: ["a", "b"] })).toBe("a\nb");
  });

  it("returns empty string when resultLines is an empty array", () => {
    expect(resolveTailoredResumeText({ resultLines: [] })).toBe("");
  });

  it("returns empty string when resultLines is whitespace-only entries", () => {
    expect(resolveTailoredResumeText({ resultLines: ["", "  "] })).toBe("");
  });

  it("prefers result over resultLines when both are usable", () => {
    const tailoredResume = { result: "R", resultLines: ["L"] };
    expect(resolveTailoredResumeText(tailoredResume)).toBe("R");
  });

  it("falls through to resultLines when result is an empty string", () => {
    const tailoredResume = { result: "", resultLines: ["L"] };
    expect(resolveTailoredResumeText(tailoredResume)).toBe("L");
  });

  it("returns empty string when resultLines is not an array", () => {
    expect(resolveTailoredResumeText({ resultLines: "not-an-array" })).toBe("");
  });
});
