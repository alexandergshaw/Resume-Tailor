// AC-L4/AC-L5: the "ideal project" benchmark must describe a project and must
// never quote a figure out of the posting.
//
// Reported: "Metrics to have ready: $78,496, $105,974, $78,496.00, $105,974.00."
// — the posting's salary range, listed four times because the dedupe key was the
// exact string and the posting stated the band in two formats. Those four
// entries also consumed the whole metric budget, so the real metric categories
// were never reached.
//
// The fix is not a better number filter. A job posting states a salary, a
// years-of-experience floor and a headcount; it essentially never states a
// metric from a project the candidate should describe, and no regex can tell
// those apart. Posting-number mining goes away entirely.

import { describe, it, expect } from "vitest";
import { idealProject, MAX_METRICS } from "./idealProject.js";

const POSTING = `Senior Product Manager, Education Technology

Salary range: $78,496.00 - $105,974.00 annually
Compensation: $78,496 - $105,974 depending on experience.

We are looking for a product manager to lead our higher education platform team.
You will work with Agile teams across the SDLC and help us bring Artificial
Intelligence into the classroom. 5+ years of product experience. This role
supports 12 campuses and a team of 8.`;

const CTX = {
  question:
    "Could you tell me a bit about your experience working with technology platforms within a higher education environment?",
  points: ["I spent three years building learning tools used across a university system."],
};

describe("idealProject metrics", () => {
  it("never presents the posting's salary range as a metric to have ready", () => {
    const joined = idealProject(POSTING, CTX).metrics.join(" | ");
    expect(joined).not.toMatch(/\$/);
    expect(joined).not.toMatch(/78[,.]?496/);
    expect(joined).not.toMatch(/105[,.]?974/);
  });

  it("emits metric categories only — never a figure of any kind", () => {
    const metrics = idealProject(POSTING, CTX).metrics;
    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(metric).not.toMatch(/\d/);
    }
    // "5+ years", "12 campuses" and "a team of 8" are the posting's other
    // numbers; none of them is a metric about the candidate's own work either.
    const joined = metrics.join(" | ");
    expect(joined).not.toMatch(/years/i);
    expect(joined).not.toMatch(/campus/i);
  });

  it("never repeats a metric", () => {
    const metrics = idealProject(POSTING, CTX).metrics;
    expect(new Set(metrics.map((m) => m.toLowerCase())).size).toBe(metrics.length);
  });

  it("keeps the metric list short", () => {
    expect(MAX_METRICS).toBe(3);
    expect(idealProject(POSTING, CTX).metrics.length).toBeLessThanOrEqual(3);
  });

  it("describes the project in a sentence instead of restating the term list", () => {
    const result = idealProject(POSTING, CTX);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.trim()).not.toBe("");
    expect(result.summary.trim().endsWith(".")).toBe(true);
    // A sentence, not a comma-joined term list.
    expect(result.summary.trim().split(/\s+/).length).toBeGreaterThanOrEqual(8);
    expect(result.summary).not.toBe(result.shape);
  });

  it("keeps the benchmark in an advisory voice the candidate could never read out as a claim", () => {
    const summary = idealProject(POSTING, CTX).summary;
    expect(summary).not.toMatch(/\bI\b/);
    expect(summary).not.toMatch(/\bmy\b/i);
    expect(summary).not.toMatch(/\bwe\b/i);
  });

  it("still names the kind of work and still degrades to null", () => {
    expect(idealProject(POSTING, CTX).shape.trim()).not.toBe("");
    expect(idealProject("", CTX)).toBeNull();
    expect(idealProject(null, CTX)).toBeNull();
    expect(idealProject("   ", CTX)).toBeNull();
  });
});
