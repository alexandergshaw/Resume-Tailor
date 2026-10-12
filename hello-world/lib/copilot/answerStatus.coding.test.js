import { describe, it, expect } from "vitest";
import { answerStatusMessage } from "./answerStatus.js";

// N161: a done CODING answer has no spoken points, so bulletCount is 0. The
// aria-live sentence must not read "0 points" for a worked code solution, and
// every non-coding call must stay byte for byte what it was.

describe("answerStatusMessage — coding answers (N161)", () => {
  it("announces a ready code solution, not a point count", () => {
    const text = answerStatusMessage({ status: "done", bulletCount: 0, hasCodingSolution: true });
    expect(text).toBe("Code solution ready");
    expect(text).not.toMatch(/point/i);
  });

  it("announces that the embedded engine's marker is not a solution", () => {
    const text = answerStatusMessage({ status: "done", bulletCount: 0, hasCodingFallback: true });
    expect(text).toMatch(/unavailable/i);
    expect(text).not.toMatch(/point/i);
  });

  it("lets a coding solution win over a stray fallback flag", () => {
    expect(
      answerStatusMessage({ status: "done", bulletCount: 0, hasCodingSolution: true, hasCodingFallback: true }),
    ).toBe("Code solution ready");
  });

  it("leaves loading, idle and error exactly as they were, coding or not", () => {
    expect(answerStatusMessage({ status: "loading", hasCodingSolution: true })).toBe("Drafting an answer");
    expect(answerStatusMessage({ status: "idle", hasCodingSolution: true })).toBe("");
    expect(answerStatusMessage({ status: "error", hasCodingFallback: true })).toBe("");
  });

  it("[control] a done answer without either flag still counts its points", () => {
    expect(answerStatusMessage({ status: "done", bulletCount: 2 })).toBe("Answer ready, 2 points");
    expect(answerStatusMessage({ status: "done", bulletCount: 1, hasCodingSolution: false })).toBe(
      "Answer ready, 1 point",
    );
  });
});
