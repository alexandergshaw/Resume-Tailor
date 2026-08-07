import { describe, it, expect } from "vitest";

import { MAX_METRICS, idealProject } from "./idealProject.js";

const POSTING = [
  "Senior Platform Engineer",
  "We are looking for an engineer with deep distributed systems and cloud computing experience.",
  "Requirements:",
  "- 5+ years with Python and distributed systems",
  "- Experience running infrastructure serving 2M requests/day",
  "- Strong background in DevOps and infrastructure as code",
].join("\n");

describe("idealProject", () => {
  it("names a shape built only from terms the posting actually contains", () => {
    const result = idealProject(POSTING);
    expect(result).not.toBeNull();
    for (const term of result.shape.split(", ")) {
      expect(POSTING.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  // BUG-K2 follow-up: `shape` is assembled from MULTIPLE sources (up to
  // MAX_SHAPE_TERMS independently-ranked taxonomy terms), the same shape of
  // composition that let resumeAnchor.description splice two different
  // résumé bullets into one fabricated phrase. It is safe here for a
  // structural reason worth pinning explicitly rather than trusting by
  // inspection: `shape` is a labelled, comma-separated LIST of terms (never
  // phrased as a sentence a reader could mistake for one continuous claim),
  // and every individual term is independently required to be a literal,
  // whole-word substring of the posting (the `literallyMentioned` filter) —
  // so each entry is trivially a contiguous fragment of the posting, and no
  // two terms are ever concatenated into a single fabricated span.
  it("each shape term is independently a contiguous fragment of the posting — never a phrase spliced across terms", () => {
    const result = idealProject(POSTING);
    expect(result).not.toBeNull();
    const terms = result.shape.split(", ");
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) {
      expect(POSTING.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  // Required case: never emits a term absent from the posting. "ml" is a
  // registered alias for the domain canonical "Machine Learning" — a posting
  // that only ever writes the abbreviation must never surface the spelled-out
  // canonical as the project's shape, since that phrase never literally
  // occurred (the same "team" -> "Microsoft Teams" taxonomy-inference hazard
  // postingBuzzwords guards against, applied to a category this module
  // actually draws from).
  it("never emits a term absent from the posting", () => {
    const posting = [
      "Backend Engineer",
      "Requirements: strong ML background and distributed systems experience.",
    ].join("\n");
    const result = idealProject(posting);
    expect(result).not.toBeNull();
    for (const term of result.shape.split(", ")) {
      expect(term).not.toBe("Machine Learning");
      expect(posting.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  // Required case: never emits a number absent from the posting. Every
  // digit-carrying metric must be a literal substring of the posting text —
  // never a fabricated figure, only real numbers the posting states or a
  // non-numeric CATEGORY name (e.g. "cost saved").
  it("never emits a number absent from the posting", () => {
    const result = idealProject(POSTING);
    expect(result).not.toBeNull();
    for (const metric of result.metrics) {
      const digits = metric.match(/\d/g);
      if (!digits) continue; // a category phrase like "cost saved" carries no digit at all
      expect(POSTING.toLowerCase()).toContain(metric.toLowerCase());
    }
  });

  it("includes the posting's own stated numbers among the metrics", () => {
    const result = idealProject(POSTING);
    expect(result).not.toBeNull();
    expect(result.metrics.some((m) => /5\+ years/i.test(m))).toBe(true);
    expect(result.metrics.some((m) => /2M requests\/day/i.test(m))).toBe(true);
  });

  it("caps metrics so the block stays glanceable", () => {
    const result = idealProject(POSTING);
    expect(result.metrics.length).toBeLessThanOrEqual(MAX_METRICS);
    expect(result.metrics.length).toBeGreaterThanOrEqual(2);
  });

  it("never phrases a category metric as a specific fabricated figure", () => {
    // A posting with no stated numbers at all must still offer metric
    // CATEGORIES (a kind of number to have ready), never a number that isn't
    // there.
    const posting = [
      "Customer Success Lead",
      "You will own quarterly business reviews and drive customer retention for our SaaS platform.",
      "Requirements: stakeholder management, executive communication.",
    ].join("\n");
    const result = idealProject(posting);
    if (result) {
      for (const metric of result.metrics) {
        expect(metric).not.toMatch(/\d/);
      }
    }
  });

  it("returns null for a missing, blank or non-string description", () => {
    expect(idealProject("")).toBeNull();
    expect(idealProject("   ")).toBeNull();
    expect(idealProject(undefined)).toBeNull();
    expect(idealProject(null)).toBeNull();
  });

  it("returns null when the posting yields no recognizable project shape", () => {
    const posting = "asdf qwer zxcv this is not a real job posting at all just noise";
    expect(idealProject(posting)).toBeNull();
  });

  it("is deterministic for the same posting and question", () => {
    const args = { question: "How do you approach infrastructure work?", points: ["I ran infrastructure."] };
    expect(idealProject(POSTING, args)).toEqual(idealProject(POSTING, args));
  });

  it("ranks a term the answer already touches ahead of a higher-scoring one it does not", () => {
    const withoutContext = idealProject(POSTING);
    const withContext = idealProject(POSTING, {
      question: "How do you approach DevOps work?",
      points: ["I led our DevOps transformation."],
    });
    expect(withoutContext).not.toBeNull();
    expect(withContext).not.toBeNull();
    expect(withContext.shape.split(", ")[0].toLowerCase()).toBe("devops");
  });

  it("reads as a third-person benchmark, never a first-person claim", () => {
    const result = idealProject(POSTING);
    expect(result).not.toBeNull();
    const combined = `${result.shape} ${result.metrics.join(" ")}`.toLowerCase();
    expect(combined).not.toMatch(/\bi\b|\bmy\b|\bwe\b|\bour\b/);
  });
});
