import { describe, it, expect } from "vitest";
import { buildTailorContextBlock, MAX_TAILOR_CONTEXT_CHARS } from "./tailorContext.js";

// Project pages as context for the GEMINI tailoring prompt.
//
// Deliberately NOT lib/experience/tailorSources.js. That module mines
// sentence-shaped fragments for the deterministic engine's slot substitution,
// and in doing so it discards prose: a page's "## Overview" paragraph never
// survives it, only the list items do. Gemini is at its best with exactly that
// narrative, so this sends title plus body and reuses only the generated-page
// exclusion.
//
// The budget rule is the important one. app/api/tailor/route.js caps five
// different inputs with bare .slice() calls and reports none of them, and the
// route has no token counting at all - blowing the model's limit surfaces as a
// generic 500. So this module owns its budget, states what it dropped inside
// the content, and reports it to the caller so the response can carry a
// warning.

const page = (over = {}) => ({
  id: "p1",
  title: "Payments migration",
  body: "## Overview\n\nRebuilt the settlement pipeline.\n\n- Cut settlement from three days to one",
  generated_kind: null,
  archived_at: null,
  ...over,
});

describe("buildTailorContextBlock", () => {
  it("sends each page's title and its whole body", () => {
    const { block } = buildTailorContextBlock([page()]);
    expect(block).toContain("Payments migration");
    expect(block).toContain("Rebuilt the settlement pipeline.");
    expect(block).toContain("Cut settlement from three days to one");
  });

  it("keeps prose that the deterministic miner would have thrown away", () => {
    // The specific regression this module exists to avoid. fragmentsFromPages
    // returns only list items; reusing it here would silently drop the
    // narrative Gemini is best at using.
    const { block } = buildTailorContextBlock([
      page({ body: "## Overview\n\nRebuilt the settlement pipeline for a payments platform.\n\n- One bullet" }),
    ]);
    expect(block).toContain("Rebuilt the settlement pipeline for a payments platform.");
  });

  it("never includes a generated page", () => {
    // A research report is a model's claims about the industry. On a resume
    // they read as the user's own work.
    const { block } = buildTailorContextBlock([
      page({ id: "r1", title: "Research: Payments (2026-08-12)", generated_kind: "research" }),
    ]);
    expect(block).not.toContain("Research: Payments");
  });

  it("treats any generated_kind as generated, not just research", () => {
    const { block } = buildTailorContextBlock([page({ generated_kind: "summary" })]);
    expect(block).toBe("");
  });

  it("never includes an archived page", () => {
    const { block } = buildTailorContextBlock([page({ archived_at: "2026-08-01T00:00:00.000Z" })]);
    expect(block).toBe("");
  });

  it("still includes ordinary pages", () => {
    // Positive control for the three exclusions above: excluding everything
    // would satisfy all of them.
    const { block } = buildTailorContextBlock([page(), page({ id: "p2", title: "Billing rewrite" })]);
    expect(block).toContain("Payments migration");
    expect(block).toContain("Billing rewrite");
  });

  it("stays within budget, says so in the content, and tells the caller", () => {
    // Three separate things, because the route already has five silent slices
    // and this must not become the sixth. The notice inside the content is what
    // the MODEL sees; the returned flag is what the response warning needs.
    const huge = Array.from({ length: 40 }, (_, i) =>
      page({ id: `p${i}`, title: `Project ${i}`, body: "x".repeat(2000) }),
    );
    const { block, truncated, includedCount } = buildTailorContextBlock(huge);
    expect(block.length).toBeLessThanOrEqual(MAX_TAILOR_CONTEXT_CHARS);
    expect(truncated).toBe(true);
    expect(block.toLowerCase()).toMatch(/truncat|not included|omitted/);
    expect(includedCount).toBeLessThan(huge.length);
  });

  it("reports nothing truncated when everything fits", () => {
    // Positive control: always claiming truncation would pass the test above.
    const { block, truncated, includedCount } = buildTailorContextBlock([page()]);
    expect(truncated).toBe(false);
    expect(block.toLowerCase()).not.toMatch(/truncat/);
    expect(includedCount).toBe(1);
  });

  it("keeps whole pages rather than cutting one mid-sentence", () => {
    // A page cut mid-sentence reads to the model as a claim that stops partway
    // through. Dropping a whole page and saying so is more honest than half a
    // project presented as complete.
    const pages = [
      page({ id: "a", title: "Alpha", body: "x".repeat(Math.floor(MAX_TAILOR_CONTEXT_CHARS * 0.7)) }),
      page({ id: "b", title: "Beta", body: "y".repeat(Math.floor(MAX_TAILOR_CONTEXT_CHARS * 0.7)) }),
    ];
    const { block } = buildTailorContextBlock(pages);
    expect(block).toContain("Alpha");
    expect(block).not.toContain("Beta");
    expect(block).not.toContain("y".repeat(50));
  });

  it("returns an empty block for no eligible pages, so the prompt is unchanged", () => {
    // The route must be able to emit a byte-identical prompt when the user has
    // no project pages. An empty string, not a header with nothing under it.
    expect(buildTailorContextBlock([]).block).toBe("");
    expect(buildTailorContextBlock([page({ body: "", title: "" })]).block).toBe("");
  });

  it("never throws on junk input", () => {
    for (const input of [null, undefined, [null], [{}], [{ body: null, title: null }]]) {
      expect(() => buildTailorContextBlock(input)).not.toThrow();
    }
  });
});
