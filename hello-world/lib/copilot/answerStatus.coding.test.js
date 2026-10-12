import { describe, it, expect } from "vitest";
import { answerStatusMessage } from "./answerStatus.js";

// N162 Wave D (owner reversal of N161, 2026-10-12). Under the ADDITIVE model a
// detected coding answer ALWAYS carries real spoken points, so its readiness
// is the ordinary "Answer ready, N points" — there is no points-less coding
// answer left for which a special "Code solution ready" message was needed to
// dodge a false "0 points". The coding flags therefore no longer override the
// point count.
//
// The anti-"0 points" INTENT is preserved: the message still reports the real
// (non-zero) point count a coding answer now has, rather than a misleading
// zero. What is removed is the N161 short-circuit that replaced the count with
// "Code solution ready" / "unavailable".
//
// RED on HEAD: HEAD returns "Code solution ready" / "Code solution unavailable
// on this engine" whenever a coding flag is set, regardless of bulletCount.
// The assertions that the point-count message wins RED on HEAD.

describe("answerStatusMessage — additive coding answers (N162)", () => {
  it("reports the point count for a done coding answer, not a special coding message", async () => {
    // RED on HEAD ("Code solution ready"). The coding answer now has points,
    // so the normal readiness is correct and true.
    expect(answerStatusMessage({ status: "done", bulletCount: 3, hasCodingSolution: true })).toBe(
      "Answer ready, 3 points",
    );
  });

  it("reports the point count even for an embedded coding answer carrying a fallback", async () => {
    // RED on HEAD ("Code solution unavailable on this engine"). The embedded
    // answer is now additive: it has points too.
    expect(answerStatusMessage({ status: "done", bulletCount: 2, hasCodingFallback: true })).toBe(
      "Answer ready, 2 points",
    );
  });

  it("does not let a coding flag override the real point count (anti-'0 points' preserved)", async () => {
    // RED on HEAD. A coding flag never forces a non-count message, so the
    // count a real coding answer carries is always what is announced.
    const text = answerStatusMessage({
      status: "done",
      bulletCount: 4,
      hasCodingSolution: true,
      hasCodingFallback: true,
    });
    expect(text).toBe("Answer ready, 4 points");
    expect(text).not.toMatch(/0\s*points?/i);
  });

  it("[control] a done answer without any coding flag still counts its points", () => {
    expect(answerStatusMessage({ status: "done", bulletCount: 2 })).toBe("Answer ready, 2 points");
    expect(answerStatusMessage({ status: "done", bulletCount: 1 })).toBe("Answer ready, 1 point");
  });

  it("leaves loading, idle and error exactly as they were, coding or not", () => {
    expect(answerStatusMessage({ status: "loading", hasCodingSolution: true })).toBe("Drafting an answer");
    expect(answerStatusMessage({ status: "idle", hasCodingSolution: true })).toBe("");
    expect(answerStatusMessage({ status: "error", hasCodingFallback: true })).toBe("");
  });
});
