import { describe, it, expect } from "vitest";
import { detectQuestion, normalizeQuestion, cleanQuestion } from "./questions";

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

describe("cleanQuestion", () => {
  it("strips lead-in acknowledgements and hesitations", () => {
    expect(cleanQuestion("Great, so, um, can you walk me through your last project?")).toBe(
      "Can you walk me through your last project?",
    );
  });

  it("collapses transcription stutters", () => {
    expect(cleanQuestion("can can you describe your role?")).toBe("Can you describe your role?");
  });

  it("ends interrogatives with a question mark", () => {
    expect(cleanQuestion("how would you design a rate limiter.")).toBe(
      "How would you design a rate limiter?",
    );
    expect(cleanQuestion("what does your team look like")).toBe("What does your team look like?");
  });

  it("leaves imperative asks' punctuation alone", () => {
    expect(cleanQuestion("Tell me about a time you failed.")).toBe(
      "Tell me about a time you failed.",
    );
  });

  it("never empties a question and handles blank input", () => {
    expect(cleanQuestion("")).toBe("");
    expect(cleanQuestion("Okay, so.")).toBeTruthy(); // degenerate input stays non-empty
  });
});
