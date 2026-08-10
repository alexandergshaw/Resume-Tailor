import { describe, it, expect } from "vitest";
import { answerStatusMessage, visuallyHidden } from "./answerStatus.js";

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

describe("visuallyHidden", () => {
  // This object is only ever consumed as a MUI `sx` value (six call sites
  // across the copilot). MUI's sx reinterprets bare numbers -- `width: 1`
  // becomes "100%" via the sizing system, `margin: -1` becomes -8px via the
  // spacing system -- so writing it the way plain CSS would read is exactly
  // what breaks it. It shipped that way and computed to a full-size absolutely
  // positioned element, which stayed invisible (clip still works) while
  // silently extending the document's scroll width.
  //
  // These assertions are about the units, not the numbers: a length here must
  // be a string the CSS parser reads the same way MUI hands it over.
  it("expresses every length with an explicit unit so sx cannot reinterpret it", () => {
    for (const key of ["width", "height", "margin"]) {
      expect(
        typeof visuallyHidden[key],
        `visuallyHidden.${key} must be a unit-bearing string, not a bare number`,
      ).toBe("string");
      expect(visuallyHidden[key]).toMatch(/^-?\d*\.?\d+(px|em|rem)$/);
    }
  });

  it("still hides the element by clipping it out of the visual layer", () => {
    // The three properties that actually do the hiding. If any of these is
    // dropped the region becomes visible text rather than a screen-reader-only
    // announcement, which is a far louder bug than the sizing one above -- but
    // it is the reason the sizing bug went unnoticed, so pin them together.
    expect(visuallyHidden.position).toBe("absolute");
    expect(visuallyHidden.overflow).toBe("hidden");
    expect(visuallyHidden.clip).toBe("rect(0 0 0 0)");
  });
});
