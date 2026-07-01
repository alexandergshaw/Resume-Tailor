import { describe, it, expect } from "vitest";
import { critiqueBullet, critiqueResume, renderCritique } from "./critique.js";

const RESUME = [
  "EXPERIENCE",
  "Senior Software Engineer, Acme Corp — Remote",
  "Jan 2020 – Present",
  "- Cut p95 latency 40% by rearchitecting the API cache for 2M users.",
  "- Responsible for maintaining the reporting dashboards and assorted internal tooling for various teams",
  "- Worked on deployments.",
].join("\n");

describe("critiqueBullet", () => {
  it("passes a strong, quantified bullet", () => {
    expect(critiqueBullet("Cut p95 latency 40% by rearchitecting the cache for 2M users.")).toEqual([]);
  });

  it("flags weak openers with the exact opener named", () => {
    const issues = critiqueBullet("Responsible for maintaining the reporting dashboards every week");
    expect(issues.map((i) => i.code)).toContain("weak-opener");
    expect(issues.find((i) => i.code === "weak-opener").advice).toContain('"responsible for"');
  });

  it("flags missing metrics", () => {
    expect(critiqueBullet("Led the migration of the platform to the cloud").map((i) => i.code)).toContain(
      "no-metric",
    );
  });

  it("flags run-on and too-short bullets", () => {
    expect(critiqueBullet(`Led ${"a very long project ".repeat(15)}`).map((i) => i.code)).toContain("too-long");
    expect(critiqueBullet("Led deploys.").map((i) => i.code)).toContain("too-short");
  });
});

describe("critiqueResume", () => {
  it("counts bullets and surfaces only flagged ones, worst first", () => {
    const c = critiqueResume(RESUME);
    expect(c.total).toBe(3);
    expect(c.withMetrics).toBe(1);
    expect(c.flagged).toBe(2);
    // Worst first: the weak-opener + no-metric bullet outranks the short one.
    expect(c.bullets[0].text).toMatch(/^Responsible for/);
  });

  it("returns an empty critique for text with no parseable bullets", () => {
    const c = critiqueResume("Just a paragraph about my career hopes and dreams.");
    expect(c.total).toBe(0);
    expect(renderCritique(c)).toBe("");
  });
});

describe("renderCritique", () => {
  it("renders plain-prose feedback quoting the weak bullets", () => {
    const out = renderCritique(critiqueResume(RESUME));
    expect(out).toMatch(/1 of your 3 experience bullets/);
    expect(out).toContain('"Responsible for');
    expect(out).toMatch(/strong verb/);
    expect(out).not.toMatch(/\*\*/); // no markdown emphasis in chat
  });
});
