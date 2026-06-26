import { describe, it, expect } from "vitest";
import { tokenize, extractKeywords } from "./keywords.js";

describe("tokenize", () => {
  it("keeps interior/leading/trailing + # . so C#, .NET, Node.js, C++ survive", () => {
    expect(tokenize("C# .NET Node.js C++")).toEqual(["c#", ".net", "node.js", "c++"]);
  });

  it("strips trailing sentence periods but keeps interior dots", () => {
    expect(tokenize("JavaScript. Node.js.")).toEqual(["javascript", "node.js"]);
  });
});

describe("extractKeywords", () => {
  it("resolves canonical casing (javascript -> JavaScript)", () => {
    const kw = extractKeywords("Strong javascript experience required");
    expect((kw.technology || []).some((t) => t.canonical === "JavaScript")).toBe(true);
  });

  it("keeps C#, .NET and Node.js as distinct technology keywords", () => {
    const kw = extractKeywords("Stack: C#, .NET, Node.js");
    const techs = (kw.technology || []).map((t) => t.canonical);
    expect(techs).toContain("C#");
    expect(techs).toContain(".NET");
    expect(techs).toContain("Node.js");
  });

  it("ranks a requirements-section term above a nice-to-have term", () => {
    const posting = [
      "Senior Engineer",
      "About the role",
      "We ship software.",
      "",
      "Requirements:",
      "Python",
      "",
      "Nice to have:",
      "Rust",
    ].join("\n");
    const kw = extractKeywords(posting);
    const score = (name) =>
      (kw.technology || []).find((t) => t.canonical === name)?.score ?? 0;
    expect(score("Python")).toBeGreaterThan(score("Rust"));
  });

  it("is deterministic for the same input", () => {
    const posting = "Requirements:\nPython, AWS, Docker, Kubernetes, Leadership";
    expect(extractKeywords(posting)).toEqual(extractKeywords(posting));
  });
});
