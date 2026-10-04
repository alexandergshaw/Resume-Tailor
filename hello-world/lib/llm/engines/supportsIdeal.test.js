// N105 Step 3b (4b) — engine capability flags (D-3b, part of K5).
// Binds to: N105.plan.r2.md Step 3b + PL-6; N105.design.r2.md §2 + D-3/D-3b;
// AC-2; research F-1 (external never forwards resumeText -> cannot ground an
// application-ready -> supportsIdeal=false in this chunk).
//
// The route's refusal gate (Step 4) reads engine.supportsIdeal AFTER the
// external->gemini fallback resolves; these pin the values the gate keys on.
//
// The three engine objects EXIST on HEAD, so these are test-level reds
// (supportsIdeal is undefined today, which is neither true nor false).

import { describe, it, expect } from "vitest";
import { geminiEngine } from "./geminiEngine.js";
import { externalEngine } from "./externalEngine.js";
import { embeddedEngine } from "./tailor-lite";

describe("engine.supportsIdeal — which engines can run the Ideal level (D-3b)", () => {
  it("gemini supports Ideal", () => {
    expect(geminiEngine.supportsIdeal).toBe(true);
  });

  it("embedded does NOT support Ideal (OD-2: refuses honestly)", () => {
    expect(embeddedEngine.supportsIdeal).toBe(false);
  });

  it("external does NOT support Ideal in this chunk (research F-1: never grounds)", () => {
    expect(externalEngine.supportsIdeal).toBe(false);
  });

  it("gemini exposes a tailorIdeal method; embedded and external do not", () => {
    expect(typeof geminiEngine.tailorIdeal).toBe("function");
    expect(typeof embeddedEngine.tailorIdeal).not.toBe("function");
    expect(typeof externalEngine.tailorIdeal).not.toBe("function");
  });
});
