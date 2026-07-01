import { describe, it, expect } from "vitest";
import { detectQuestion, normalizeQuestion } from "./questions";

describe("detectQuestion", () => {
  it("flags utterances ending in a question mark", () => {
    expect(detectQuestion("So why do you want this role?")).toMatchObject({
      isQuestion: true,
      reason: "punctuation",
    });
  });

  it("flags interrogative openers without a question mark", () => {
    expect(detectQuestion("How would you design a rate limiter")).toMatchObject({
      isQuestion: true,
      reason: "starter",
    });
  });

  it("flags indirect interview asks", () => {
    expect(
      detectQuestion("Tell me about a time you led a project"),
    ).toMatchObject({ isQuestion: true, reason: "starter" });
    expect(
      detectQuestion("Walk me through your last role"),
    ).toMatchObject({ isQuestion: true });
  });

  it("ignores plain statements", () => {
    expect(detectQuestion("Thanks for joining today.").isQuestion).toBe(false);
    expect(detectQuestion("I work on the platform team.").isQuestion).toBe(false);
  });

  it("ignores very short non-question fragments", () => {
    expect(detectQuestion("do it").isQuestion).toBe(false);
    expect(detectQuestion("").isQuestion).toBe(false);
  });

  it("normalizes whitespace and case for dedupe", () => {
    expect(normalizeQuestion("  Why   THIS  role? ")).toBe("why this role?");
  });
});
