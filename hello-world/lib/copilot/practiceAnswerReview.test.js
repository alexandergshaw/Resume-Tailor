// node (this repo's default environment). Pure — no React, no DOM.
import { describe, it, expect } from "vitest";
import { CLEARED_ANSWER_REVIEW, recordAnswerReview } from "./practiceAnswerReview.js";

describe("practiceAnswerReview", () => {
  it("CLEARED_ANSWER_REVIEW has both fields null, and is frozen", () => {
    expect(CLEARED_ANSWER_REVIEW).toEqual({ metrics: null, judgedInterviewType: null });
    expect(Object.isFrozen(CLEARED_ANSWER_REVIEW)).toBe(true);
  });

  it("recordAnswerReview pairs the metrics with the interview type verbatim", () => {
    const metrics = { wordCount: 42, wpm: 130 };
    expect(recordAnswerReview({ metrics, interviewType: "technical" })).toEqual({
      metrics,
      judgedInterviewType: "technical",
    });
  });

  it("defaults a falsy interview type to 'general' — never null/undefined/empty", () => {
    const metrics = { wordCount: 1 };
    expect(recordAnswerReview({ metrics, interviewType: undefined }).judgedInterviewType).toBe("general");
    expect(recordAnswerReview({ metrics, interviewType: "" }).judgedInterviewType).toBe("general");
    expect(recordAnswerReview({ metrics, interviewType: null }).judgedInterviewType).toBe("general");
  });

  it("never mutates the metrics object it is handed", () => {
    const metrics = { wordCount: 7 };
    const result = recordAnswerReview({ metrics, interviewType: "behavioral" });
    expect(result.metrics).toBe(metrics);
  });
});
