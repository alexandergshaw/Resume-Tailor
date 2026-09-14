import { describe, it, expect } from "vitest";
import { globToRegExp, matchOwns } from "./miniglob.mjs";

describe("globToRegExp", () => {
  it("a literal path matches only itself", () => {
    const re = globToRegExp("lib/llm/featureEngine.js");
    expect(re.test("lib/llm/featureEngine.js")).toBe(true);
    expect(re.test("lib/llm/featureEngine.test.js")).toBe(false);
  });

  it("* matches within one path segment only — kills a mutant that widens it to cross '/'", () => {
    const re = globToRegExp("lib/*.js");
    expect(re.test("lib/a.js")).toBe(true);
    expect(re.test("lib/sub/a.js")).toBe(false);
  });

  it("** matches across any number of segments, including zero", () => {
    const re = globToRegExp("lib/interviewPrep/**");
    expect(re.test("lib/interviewPrep/prepLog.js")).toBe(true);
    expect(re.test("lib/interviewPrep/sub/deep/file.js")).toBe(true);
  });

  it("escapes regex-special characters in a literal segment", () => {
    const re = globToRegExp("app/api/interview-prep/route.js");
    expect(re.test("app/api/interview-prep/route.js")).toBe(true);
    // A dot in the pattern must not act as "any character".
    expect(re.test("app/api/interviewXprep/route.js")).toBe(false);
  });
});

describe("matchOwns", () => {
  const files = ["lib/a.js", "lib/sub/b.js", "app/api/interview-prep/route.js", "app/api/interview-prep/route.test.js"];

  it("returns the sorted union of files matched by any pattern, de-duplicated", () => {
    const matched = matchOwns(["lib/a.js", "lib/a.js", "app/api/interview-prep/**"], files);
    expect(matched).toEqual([
      "app/api/interview-prep/route.js",
      "app/api/interview-prep/route.test.js",
      "lib/a.js",
    ]);
  });

  it("a directory-only ** pattern does not match a sibling directory (no accidental over-match)", () => {
    const matched = matchOwns(["lib/sub/**"], files);
    expect(matched).toEqual(["lib/sub/b.js"]);
  });
});
