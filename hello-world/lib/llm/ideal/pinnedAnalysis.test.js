// N104 - isValidPinnedAnalysis: the guard that decides whether a regenerate's pin is
// used or the pipeline falls back to grounding the engine's own analysis. A guard
// that is too loose lets a malformed pin replace the requirement universe; too
// strict silently turns every regenerate into an un-pinned (id-drifting) one, which
// compareReviewGaps then reports as correspondenceUnavailable. Both directions are
// pinned here.

import { describe, it, expect } from "vitest";
import { isValidPinnedAnalysis } from "./pinnedAnalysis.js";

const pin = (requirements, extra = {}) => ({ postingAnalysis: { requirements }, keywordMap: { entries: [] }, ...extra });
const req = { id: "q1", text: "Kubernetes experience", kind: "requirement" };

describe("isValidPinnedAnalysis", () => {
  it("accepts a pin with at least one well-formed requirement", () => {
    expect(isValidPinnedAnalysis(pin([req]))).toBe(true);
    expect(isValidPinnedAnalysis(pin([req, { id: "q2", text: "More" }]))).toBe(true);
  });

  it("does not need a keyword map (the pipeline never scores against it)", () => {
    expect(isValidPinnedAnalysis({ postingAnalysis: { requirements: [req] } })).toBe(true);
  });

  it("rejects no pin, a non-object, and a pin with no posting analysis", () => {
    for (const bad of [undefined, null, "pin", 7, [], {}, { postingAnalysis: null }, { postingAnalysis: {} }]) {
      expect(isValidPinnedAnalysis(bad)).toBe(false);
    }
  });

  it("rejects an empty requirement list, a non-array, and any malformed requirement", () => {
    expect(isValidPinnedAnalysis(pin([]))).toBe(false);
    expect(isValidPinnedAnalysis({ postingAnalysis: { requirements: "q1" } })).toBe(false);
    expect(isValidPinnedAnalysis(pin([req, { id: "q2" }]))).toBe(false);
    expect(isValidPinnedAnalysis(pin([req, { text: "no id" }]))).toBe(false);
    expect(isValidPinnedAnalysis(pin([req, { id: 2, text: "numeric id" }]))).toBe(false);
    expect(isValidPinnedAnalysis(pin([req, null]))).toBe(false);
  });
});
