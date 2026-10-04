// N105 Step 1 (4b) — level<->request vocabulary, PURE.
// Binds to: N105.plan.r2.md Step 1; N105.design.r2.md D-1/D-2; N105.ac.r2.md
// AC-1/AC-2; N105.ux.r2.md L1 (C-ids), UX-1, UX-39, UXR-12; copy deck C6/C8/C9.
//
// These exercise `lib/tailor/tailorLevel.js`, which does not exist on HEAD, so
// every import is undefined and every assertion here is RED by an absent module
// (not by an authoring error). The implementer turns them green by landing the
// module per the plan.
//
// Power note (K9): the single most dangerous regression this step guards is the
// slider's sixth stop leaking into the `aggressiveness` integer — either sent as
// `aggressiveness=6` (which the route clamps to 5, silently absorbing N105 into
// "Strong") or `tailorMode` being folded into the aggressiveness field. Every
// row below that says "no aggressiveness=6 / tailorMode separate" is that guard.

import { describe, it, expect } from "vitest";
import {
  levelToRequestFields,
  idealRefusalMessage,
} from "./tailorLevel.js";

const IDEAL_STOP = 6;

describe("levelToRequestFields — the slider value -> request field mapping (UX-1, D-1)", () => {
  it("maps the Ideal stop (6) on a resume-scoped run to { tailorMode: 'ideal' } and sends NO aggressiveness", () => {
    const fields = levelToRequestFields(IDEAL_STOP, 3, { scope: "resume" });
    expect(fields).toEqual({ tailorMode: "ideal" });
    // Belt-and-braces against a shape that carries BOTH: the route must never
    // see a numeric level alongside tailorMode (it would clamp and double-run).
    expect(fields).not.toHaveProperty("aggressiveness");
  });

  it("maps a 'both'-scope Ideal run to tailorMode (both includes the resume) — D6", () => {
    const fields = levelToRequestFields(IDEAL_STOP, 4, { scope: "both" });
    expect(fields).toEqual({ tailorMode: "ideal" });
  });

  it("treats a missing scope as the resume path (the main tailor form has no explicit scope)", () => {
    const fields = levelToRequestFields(IDEAL_STOP, 2, {});
    expect(fields).toEqual({ tailorMode: "ideal" });
  });

  it("maps each standard stop 1..5 to that aggressiveness and no tailorMode", () => {
    for (let n = 1; n <= 5; n += 1) {
      const fields = levelToRequestFields(n, 3, { scope: "resume" });
      expect(fields).toEqual({ aggressiveness: n });
      expect(fields).not.toHaveProperty("tailorMode");
    }
  });

  // UXR-12 / UX-39 / D6: a cover-scope run ALWAYS takes the standard path with
  // the user's saved 1..5 value and never sends tailorMode, even when the slider
  // is parked on the Ideal stop. This is the guard against a global Ideal
  // selection overwriting the cover letter with a resume pair.
  it("maps the Ideal stop on a COVER-scope run to the saved 1..5 aggressiveness and NO tailorMode", () => {
    const fields = levelToRequestFields(IDEAL_STOP, 4, { scope: "cover" });
    expect(fields).toEqual({ aggressiveness: 4 });
    expect(fields).not.toHaveProperty("tailorMode");
  });

  it("a cover-scope standard run is unaffected (uses its own level, not the saved one, when both exist)", () => {
    // The caller passes the live slider value; on a cover scope it is the saved
    // 1..5 (the slider shows `ideal ? 6 : aggressiveness`, and D6 sends the
    // saved value), so a value of 6 must still resolve to the saved 1..5.
    const fields = levelToRequestFields(IDEAL_STOP, 1, { scope: "cover" });
    expect(fields).toEqual({ aggressiveness: 1 });
  });

  // K9 CONTROL — this test must FAIL against any build that emits aggressiveness=6.
  // It is the discriminator: a correct build never produces a 6 in the
  // aggressiveness field on any scope/value combination.
  it("NEVER emits aggressiveness=6 on any (value, scope) combination (K9)", () => {
    for (const scope of ["resume", "cover", "both", "email", undefined]) {
      for (let v = 1; v <= 6; v += 1) {
        const fields = levelToRequestFields(v, 5, { scope });
        if ("aggressiveness" in fields) {
          expect(fields.aggressiveness).toBeGreaterThanOrEqual(1);
          expect(fields.aggressiveness).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  // CONTROL (over-fire guard): selecting Ideal must not mutate the caller's saved
  // standard level — tailorMode and aggressiveness are separate state (L1).
  it("does not derive tailorMode from a standard level (over-fire guard)", () => {
    // A standard stop never yields tailorMode even if savedAggressiveness is odd.
    expect(levelToRequestFields(5, 5, { scope: "resume" })).not.toHaveProperty("tailorMode");
  });
});

describe("idealRefusalMessage — one source for the C6/C8/C9 refusal copy (AC-2, UX-7, 3.4)", () => {
  it("engine-unsupported: names Gemini and the user's current engine label, leads with the requirement", () => {
    const msg = idealRefusalMessage("engine-unsupported", {
      engineLabel: "Embedded (no AI)",
      fileName: "resume.docx",
    });
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toMatch(/gemini/i);
    expect(msg).toContain("Embedded (no AI)");
    // Tone rule (UX-7 3.3): a requirement, never "Error/Failed/Sorry/Unable".
    expect(msg).not.toMatch(/^\s*(error|failed|sorry|unable)\b/i);
  });

  it("empty-resume: names the file and explains why Ideal needs the resume text", () => {
    const msg = idealRefusalMessage("empty-resume", {
      engineLabel: "Gemini (AI)",
      fileName: "scanned-resume.docx",
    });
    expect(typeof msg).toBe("string");
    expect(msg).toContain("scanned-resume.docx");
    expect(msg).toMatch(/text/i);
    expect(msg).not.toMatch(/^\s*(error|failed|sorry|unable)\b/i);
  });

  // CONTROL: the two codes produce DIFFERENT messages — a build that returns one
  // generic sentence for both (losing the file name / the engine name) fails here.
  it("engine-unsupported and empty-resume are distinct messages", () => {
    const a = idealRefusalMessage("engine-unsupported", { engineLabel: "Embedded (no AI)", fileName: "r.docx" });
    const b = idealRefusalMessage("empty-resume", { engineLabel: "Embedded (no AI)", fileName: "r.docx" });
    expect(a).not.toBe(b);
  });
});
