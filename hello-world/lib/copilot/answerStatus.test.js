import { describe, it, expect } from "vitest";
import { answerStatusMessage } from "./answerStatus.js";

describe("answerStatusMessage — idle", () => {
  it('returns "" for status "idle"', () => {
    expect(answerStatusMessage({ status: "idle", bulletCount: 0 })).toBe("");
  });

  it('returns "" for an unknown status', () => {
    expect(answerStatusMessage({ status: "not-a-real-status", bulletCount: 3 })).toBe("");
  });

  it('returns "" when called with no arguments', () => {
    expect(answerStatusMessage()).toBe("");
  });

  it('returns "" for undefined status (no current question yet)', () => {
    expect(answerStatusMessage({ status: undefined, bulletCount: 0 })).toBe("");
  });
});

describe("answerStatusMessage — loading", () => {
  it('returns "Drafting an answer" regardless of bulletCount', () => {
    expect(answerStatusMessage({ status: "loading", bulletCount: 0 })).toBe("Drafting an answer");
    expect(answerStatusMessage({ status: "loading", bulletCount: 5 })).toBe("Drafting an answer");
  });
});

describe("answerStatusMessage — done", () => {
  it("pluralizes for a count other than one", () => {
    expect(answerStatusMessage({ status: "done", bulletCount: 3 })).toBe("Answer ready, 3 points");
    expect(answerStatusMessage({ status: "done", bulletCount: 0 })).toBe("Answer ready, 0 points");
  });

  it("keeps the singular for exactly one point", () => {
    expect(answerStatusMessage({ status: "done", bulletCount: 1 })).toBe("Answer ready, 1 point");
  });

  it("treats a missing or non-numeric bulletCount as zero rather than throwing or printing NaN", () => {
    expect(answerStatusMessage({ status: "done" })).toBe("Answer ready, 0 points");
    expect(answerStatusMessage({ status: "done", bulletCount: undefined })).toBe("Answer ready, 0 points");
    expect(answerStatusMessage({ status: "done", bulletCount: "3" })).toBe("Answer ready, 0 points");
    expect(answerStatusMessage({ status: "done", bulletCount: NaN })).toBe("Answer ready, 0 points");
  });

  it("treats a negative bulletCount as zero", () => {
    expect(answerStatusMessage({ status: "done", bulletCount: -2 })).toBe("Answer ready, 0 points");
  });
});

describe("answerStatusMessage — error", () => {
  // F11/R-123: an error status returns "" — same as idle — and there is no
  // `error` parameter at all. Every surface that reaches `status: "error"`
  // also renders an MUI `Alert severity="error"` for the same failure, and
  // `Alert` sets `role="alert"` on its own; if this function also returned
  // error text, the status region would announce the failure a SECOND time
  // and could word it differently than the Alert (which is exactly what
  // happened before this fix: SampleAnswer.js's Alert and its status region
  // disagreed about the wording). The Alert owns the announcement, so this
  // region stays silent for an error the same way it does for idle.
  it('returns "" for status "error", leaving the announcement to the sibling Alert', () => {
    expect(answerStatusMessage({ status: "error" })).toBe("");
    expect(answerStatusMessage({ status: "error", bulletCount: 3 })).toBe("");
  });
});
