import { describe, it, expect } from "vitest";
import { classifyQuestionType } from "./questionType.js";

describe("classifyQuestionType", () => {
  it("labels story prompts as behavioral", () => {
    expect(classifyQuestionType("Tell me about a time you handled a conflict.")).toBe("behavioral");
    expect(classifyQuestionType("Describe a situation where you missed a deadline.")).toBe("behavioral");
    expect(classifyQuestionType("Give me an example of leadership.")).toBe("behavioral");
  });

  it("labels engineering prompts as technical", () => {
    expect(classifyQuestionType("How would you design a system to handle millions of users?")).toBe("technical");
    expect(classifyQuestionType("What's the time complexity of a hash lookup?")).toBe("technical");
    expect(classifyQuestionType("How do you debug a memory leak in production?")).toBe("technical");
  });

  it("prefers behavioral when both cues appear (story framing wins)", () => {
    expect(classifyQuestionType("Tell me about a time you designed a scalable API.")).toBe("behavioral");
  });

  it("falls back to general for everything else", () => {
    expect(classifyQuestionType("Why do you want to work here?")).toBe("general");
    expect(classifyQuestionType("What are your salary expectations?")).toBe("general");
    expect(classifyQuestionType("")).toBe("general");
  });
});
