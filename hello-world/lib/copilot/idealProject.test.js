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

// Reported failure, direct repro: a real "Senior Product Manager, Education
// Technology" posting mentioning "platform" exactly once nonetheless produced
// infrastructure metrics ("latency reduction %, uptime / reliability %,
// throughput at scale") because METRIC_BUCKETS walked in declaration order
// and the infrastructure bucket — declared first — matched that one
// incidental word before the product bucket, which the rest of the posting's
// vocabulary actually fit, was ever consulted. This posting is unmistakably a
// product role: "product manager" (title + body), "product strategy",
// "product roadmap", "product adoption", "product backlog", "customer
// success", "customer feedback", "UX design" — thirteen product-bucket words
// against exactly one "platform".
const PRODUCT_POSTING = [
  "Senior Product Manager, Education Technology",
  "",
  "We are hiring a product manager to own our K-12 education technology product suite end to end.",
  "You will define product strategy, run Agile ceremonies, and partner closely with UX design and",
  "customer success to shape the product roadmap. Ideal candidates have led cross-functional product",
  "teams, driven product adoption among students and teachers, and used customer feedback to prioritize",
  "the product backlog. Our platform serves millions of students.",
  "",
  "Requirements: 5+ years of product management experience, strong Agile background, and a passion for",
  "education technology.",
].join("\n");

// Converse of PRODUCT_POSTING, proving the fix did not simply invert the bug
// into "product always wins": genuinely infrastructure-heavy vocabulary
// (latency, uptime, distributed systems, scaling — repeated throughout, and
// zero product-bucket words anywhere) must still win the infrastructure
// bucket its content actually earns.
const INFRA_POSTING = [
  "Senior Site Reliability Engineer, Platform Infrastructure",
  "",
  "We are looking for an engineer to own uptime and reliability for our globally distributed systems.",
  "You will reduce latency across our distributed systems, improve throughput at scale, and lead",
  "migration to a more scalable cloud infrastructure. Strong background in distributed systems,",
  "infrastructure as code, and large-scale backend performance tuning required. Experience with",
  "cloud-native scaling required.",
  "",
  "Requirements: 7+ years building and scaling distributed systems, deep expertise in latency",
  "optimization and infrastructure reliability.",
].join("\n");

// A posting that matches none of METRIC_BUCKETS at all — no infrastructure,
// data, product, sales, support or security vocabulary anywhere — but still
// yields a `shape` from SHAPE_CATEGORIES (so this exercises the
// GENERIC_METRICS fallback, not the null-description path).
const NO_BUCKET_POSTING = [
  "Senior Staff Writer, Newsroom",
  "",
  "We are hiring a senior writer for our newsroom. Journalism experience preferred. You will conduct",
  "interviews, write investigative stories, and collaborate with editors on breaking news coverage.",
  "Excellent storytelling skills required.",
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

  // BUG follow-up: posting-number mining is gone entirely. `metrics` is
  // metric CATEGORIES only — it must never contain a figure, whether that
  // figure is a project metric or (the reported failure) the posting's own
  // salary band, years-of-experience floor or headcount restated back at
  // the candidate. No digit survives into `metrics` at all, regardless of
  // what the posting states.
  it("never emits a number of any kind — metrics are categories only", () => {
    const result = idealProject(POSTING);
    expect(result).not.toBeNull();
    for (const metric of result.metrics) {
      expect(metric).not.toMatch(/\d/);
    }
    // The posting states "5+ years" and "2M requests/day"; neither may
    // appear, in any form, among the metric categories.
    const joined = result.metrics.join(" | ").toLowerCase();
    expect(joined).not.toMatch(/5\+ years/);
    expect(joined).not.toMatch(/2m requests/);
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
    const combined = `${result.shape} ${result.summary} ${result.metrics.join(" ")}`.toLowerCase();
    expect(combined).not.toMatch(/\bi\b|\bmy\b|\bwe\b|\bour\b/);
  });

  // The new `summary` field: one advisory sentence naming the kind of
  // project, built from the SAME shape terms as `shape` — never a restatement
  // of the comma-joined list (that was the second half of the reported bug:
  // a project section with "no substance" because it was just the buzzword
  // list two rows above, repeated).
  it("builds summary as an advisory sentence from the shape terms, not a restatement of shape", () => {
    const result = idealProject(POSTING);
    expect(result).not.toBeNull();
    expect(typeof result.summary).toBe("string");
    expect(result.summary).not.toBe(result.shape);
    expect(result.summary.trim().endsWith(".")).toBe(true);
    for (const term of result.shape.split(", ")) {
      expect(result.summary).toContain(term);
    }
  });

  it("joins shape terms into summary prose with 'and' before the final term", () => {
    // One posting term.
    const single = idealProject("Backend Engineer. Requirements: strong distributed systems background.");
    expect(single).not.toBeNull();
    expect(single.shape.split(", ")).toHaveLength(1);
    expect(single.summary).toBe(
      `They want a project built around ${single.shape}, owned end to end, with a measurable outcome.`
    );

    // Multiple posting terms (POSTING yields up to MAX_SHAPE_TERMS).
    const multi = idealProject(POSTING);
    expect(multi).not.toBeNull();
    const terms = multi.shape.split(", ");
    if (terms.length > 1) {
      const expectedList =
        terms.length === 2
          ? `${terms[0]} and ${terms[1]}`
          : `${terms.slice(0, -1).join(", ")} and ${terms[terms.length - 1]}`;
      expect(multi.summary).toBe(`They want a project built around ${expectedList}, owned end to end, with a measurable outcome.`);
    }
  });

  // BUG follow-up: METRIC_BUCKETS used to be walked in declaration order and
  // returned as soon as one bucket matched at all. The infrastructure bucket
  // is declared first and its pattern matches the single word "platform", so
  // any posting containing "platform" (or "cloud"/"performance"/"backend")
  // claimed the entire MAX_METRICS budget regardless of how the rest of the
  // posting read — reported live against a "Senior Product Manager,
  // Education Technology" posting, which came back "Metrics to have ready:
  // latency reduction %, uptime / reliability %, throughput at scale" for a
  // product interview. Buckets are now ranked by how many times each
  // pattern actually matches the posting, so a bucket matching one
  // incidental word loses to one the posting's vocabulary actually supports.
  it("ranks metric buckets by fit — a product posting that merely mentions 'platform' once gets product metrics, not infrastructure metrics", () => {
    const result = idealProject(PRODUCT_POSTING);
    expect(result).not.toBeNull();
    expect(result.metrics).toEqual(["adoption rate", "user satisfaction / NPS", "time-to-ship"]);
    expect(result.metrics).not.toContain("latency reduction %");
  });

  // Converse of the case above, proving the fix did not simply invert the
  // bug into "product always wins": a posting that is genuinely
  // infrastructure-heavy still returns the infrastructure metrics.
  it("still returns infrastructure metrics for a genuinely infrastructure-heavy posting", () => {
    const result = idealProject(INFRA_POSTING);
    expect(result).not.toBeNull();
    expect(result.metrics).toEqual(["latency reduction %", "uptime / reliability %", "throughput at scale"]);
  });

  // The fit-ranking only changes WHICH bucket wins when more than one
  // matches; the zero-bucket path (fall through to GENERIC_METRICS) is
  // unchanged.
  it("still falls back to GENERIC_METRICS, unchanged, when no bucket matches at all", () => {
    const result = idealProject(NO_BUCKET_POSTING);
    expect(result).not.toBeNull();
    expect(result.metrics).toEqual(["cost saved", "adoption rate", "time-to-ship"]);
  });

  it("is deterministic for the product posting the fit-ranking fix targets", () => {
    expect(idealProject(PRODUCT_POSTING)).toEqual(idealProject(PRODUCT_POSTING));
  });
});
