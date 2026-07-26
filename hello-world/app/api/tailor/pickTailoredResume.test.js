import { describe, it, expect } from "vitest";

import { pickTailoredResume } from "./route.js";

describe("pickTailoredResume", () => {
  it("uses the client's hand-edited lines when non-empty, joined by newlines", () => {
    const result = pickTailoredResume(["a", "b"], null);
    expect(result).toEqual({ result: "a\nb", resultLines: ["a", "b"] });
  });

  it("trims the joined result", () => {
    const result = pickTailoredResume(["  a  ", "b  "], null);
    expect(result.result).toBe("a  \nb");
  });

  it("falls through to resumeResult when clientLines is undefined", () => {
    const resumeResult = { result: "tailored text", resultLines: ["tailored text"] };
    const result = pickTailoredResume(undefined, resumeResult);
    expect(result).toEqual({ result: "tailored text", resultLines: ["tailored text"] });
  });

  it("falls through to resumeResult when clientLines is a string, not an array", () => {
    const resumeResult = { result: "tailored text", resultLines: ["tailored text"] };
    const result = pickTailoredResume("a\nb", resumeResult);
    expect(result).toEqual({ result: "tailored text", resultLines: ["tailored text"] });
  });

  it("falls through to resumeResult when clientLines is an empty array", () => {
    const resumeResult = { result: "tailored text", resultLines: ["tailored text"] };
    const result = pickTailoredResume([], resumeResult);
    expect(result).toEqual({ result: "tailored text", resultLines: ["tailored text"] });
  });

  it("returns an empty shape without throwing when resumeResult is null", () => {
    expect(() => pickTailoredResume(undefined, null)).not.toThrow();
    const result = pickTailoredResume(undefined, null);
    expect(result).toEqual({ result: "", resultLines: [] });
  });

  it("returns an empty shape when resumeResult is undefined", () => {
    const result = pickTailoredResume(undefined, undefined);
    expect(result).toEqual({ result: "", resultLines: [] });
  });

  it("passes a well-formed resumeResult through unchanged", () => {
    const resumeResult = { result: "line one\nline two", resultLines: ["line one", "line two"] };
    const result = pickTailoredResume(undefined, resumeResult);
    expect(result).toEqual({ result: "line one\nline two", resultLines: ["line one", "line two"] });
  });

  it("yields an empty string result when resumeResult.result is not a string", () => {
    const resumeResult = { result: 12345, resultLines: ["line one"] };
    const result = pickTailoredResume(undefined, resumeResult);
    expect(result.result).toBe("");
    expect(result.resultLines).toEqual(["line one"]);
  });

  it("yields an empty resultLines array when resumeResult.resultLines is not an array", () => {
    const resumeResult = { result: "some text", resultLines: "not an array" };
    const result = pickTailoredResume(undefined, resumeResult);
    expect(result.resultLines).toEqual([]);
    expect(result.result).toBe("some text");
  });

  it("prefers clientLines over resumeResult when both are populated", () => {
    const resumeResult = { result: "engine text", resultLines: ["engine text"] };
    const result = pickTailoredResume(["hand", "edited"], resumeResult);
    expect(result).toEqual({ result: "hand\nedited", resultLines: ["hand", "edited"] });
  });
});
