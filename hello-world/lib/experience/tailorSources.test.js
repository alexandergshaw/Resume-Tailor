import { describe, it, expect } from "vitest";
import { fragmentsFromPages } from "./tailorSources.js";

// Turns project pages into candidate resume material.
//
// The rule that matters most here is EXCLUSION. A research report is written by
// a model that searched the web; its claims are about technology, not about
// what the user did. Letting those become resume bullets would put sentences on
// a resume that the user cannot defend in an interview and did not write - the
// single worst failure this feature could have, and an easy one to ship by
// accident, because a research page is an ordinary experience_pages row sitting
// right there under the project.
//
// Generated pages are marked by `generated_kind`, added by the research
// migration. That column is the only thing distinguishing them.

const page = (over = {}) => ({
  id: "p1",
  title: "Payments migration",
  body: "",
  generated_kind: null,
  generated_at: null,
  ...over,
});

const texts = (fragments) => fragments.map((f) => f.text);

describe("fragmentsFromPages", () => {
  it("takes bullet points out of a page body", () => {
    const out = fragmentsFromPages([
      page({ body: "## What changed\n\n- Cut settlement from three days to one\n- Retired the legacy processor" }),
    ]);
    expect(texts(out)).toEqual([
      "Cut settlement from three days to one",
      "Retired the legacy processor",
    ]);
  });

  it("NEVER takes material from a generated research page", () => {
    // The claims in a research report are the model's, about the industry.
    // On a resume they read as the user's, about their own work.
    const out = fragmentsFromPages([
      page({
        id: "r1",
        title: "Research: Payments migration (2026-08-12)",
        generated_kind: "research",
        generated_at: "2026-08-12T00:00:00.000Z",
        body: "- Adopt logical replication for zero-downtime cutover",
      }),
    ]);
    expect(out).toEqual([]);
  });

  it("still takes material from the user's own pages", () => {
    // Positive control for the rule above: excluding everything would satisfy
    // it and destroy the feature.
    const out = fragmentsFromPages([
      page({ id: "p1", body: "- Cut settlement from three days to one" }),
      page({ id: "r1", generated_kind: "research", body: "- Adopt logical replication" }),
    ]);
    expect(texts(out)).toEqual(["Cut settlement from three days to one"]);
  });

  it("treats any generated_kind as generated, not just research", () => {
    // Later generators will use other values. Matching one string exactly
    // means the next one silently leaks onto the resume.
    const out = fragmentsFromPages([
      page({ generated_kind: "summary", body: "- Something a model wrote" }),
    ]);
    expect(out).toEqual([]);
  });

  it("records which page each fragment came from", () => {
    // A bullet a user cannot trace back is a bullet they cannot verify before
    // sending it to an employer.
    const [fragment] = fragmentsFromPages([
      page({ id: "p7", title: "Payments migration", body: "- Cut settlement to one day" }),
    ]);
    expect(fragment).toMatchObject({ sourcePageId: "p7", sourceTitle: "Payments migration" });
  });

  it("does not repeat the same sentence twice", () => {
    const out = fragmentsFromPages([
      page({ id: "p1", body: "- Cut settlement to one day" }),
      page({ id: "p2", body: "- Cut settlement to one day" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("ignores fragments too short to be a resume line", () => {
    const out = fragmentsFromPages([page({ body: "- ok\n- TODO\n- Cut settlement to one day" })]);
    expect(texts(out)).toEqual(["Cut settlement to one day"]);
  });

  it("skips headings, code and quotes rather than mining them", () => {
    // A heading is a label, not an accomplishment; code is not prose; a
    // blockquote is usually someone else's words.
    const out = fragmentsFromPages([
      page({
        body: "# Payments migration\n\n```sql\nselect 1;\n```\n\n> Their CTO said it was impossible\n\n- Cut settlement to one day",
      }),
    ]);
    expect(texts(out)).toEqual(["Cut settlement to one day"]);
  });

  it("returns nothing for empty input and never throws on junk", () => {
    expect(fragmentsFromPages([])).toEqual([]);
    for (const input of [null, undefined, [null], [{}], [{ body: null }]]) {
      expect(() => fragmentsFromPages(input)).not.toThrow();
    }
  });
});
