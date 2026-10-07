// N131: the DETERMINISTIC cold-start ideal-project example (the instant READY
// block, shown before the per-question TAILORED example arrives) used to hand
// every non-tech posting a tech-company story with its own domain slotted in —
// the owner's pasted "SRE story in Education". Two offline levers fix it:
//
//   1. The `generic` archetype is field-neutral (idealProjectNarrative.js): a
//      worked project that reads credibly for a teacher, a nurse or an
//      accountant, with outcome categories that fit any field.
//   2. A specialized (tech) archetype wins only on a STRONG match — the top
//      bucket must score at least MIN_SPECIALIZED_HITS (2) pattern matches
//      (idealProject.js rankBuckets). A posting that merely brushes ONE tech
//      word gets the neutral generic example, and its `metrics` agree with it.
//
// Every non-tech fixture below carries exactly ONE incidental tech-bucket word
// (verified against METRIC_BUCKETS' patterns) and a recognizable shape term, so
// on HEAD each one selects a tech archetype through the real bucket-ranking path
// rather than through the no-shape-term early exit. The strong-tech controls
// prove the bias did not turn everything generic.

import { describe, it, expect } from "vitest";

import { idealProject } from "./idealProject.js";

// The ONE incidental tech word is "cloud" (infra bucket, score 1) — the shape of
// the owner's reported "SRE story in Education".
const EDUCATION_POSTING = [
  "Elementary School Teacher",
  "",
  "We are hiring a teacher to deliver engaging Education for grades three through five. You will plan",
  "lessons, track progress in our cloud gradebook, and communicate regularly with families.",
  "Requirements: state teaching credential and strong classroom management.",
].join("\n");

// ONE incidental word: "compliance" (security bucket, score 1).
const NURSING_POSTING = [
  "Registered Nurse, Medical-Surgical Unit",
  "",
  "Provide direct patient care on a busy medical-surgical unit in Healthcare. Administer medications,",
  "monitor vital signs, document care and follow infection-control compliance protocols.",
  "Requirements: active RN license and BLS certification.",
].join("\n");

// ONE incidental word: "data" (data bucket, score 1).
const FINANCE_POSTING = [
  "Staff Accountant, Financial Services",
  "",
  "Own month-end close, account reconciliations and variance analysis for our Financial Services team.",
  "You will reconcile data between ledgers, prepare journal entries and manage accounts payable.",
  "Requirements: CPA preferred and strong Excel skills.",
].join("\n");

// No recognizable shape term at all: the role-agnostic default path.
const NO_SHAPE_POSTING = "asdf qwer zxcv this is not a real job posting at all just noise";

const NON_TECH_POSTINGS = [
  ["education", EDUCATION_POSTING],
  ["nursing", NURSING_POSTING],
  ["finance", FINANCE_POSTING],
];

// Exactly TWO infra-bucket matches ("cloud" twice) in an otherwise identical
// education posting: the edge of the rule. One hit is brushing past a word; two
// is the smallest match the selector treats as strong.
const EDUCATION_TWO_HITS_POSTING = EDUCATION_POSTING.replace(
  "communicate regularly with families.",
  "share work through our cloud classroom tools, and communicate regularly with families.",
);

// Genuinely infrastructure- and data-heavy postings: many distinct hits.
const INFRA_POSTING = [
  "Senior Site Reliability Engineer, Platform Infrastructure",
  "",
  "We are looking for an engineer to own uptime and reliability for our globally distributed systems.",
  "You will reduce latency across our distributed systems, improve throughput at scale, and lead",
  "migration to a more scalable cloud infrastructure. Strong background in distributed systems,",
  "infrastructure as code, and large-scale backend performance tuning required.",
].join("\n");

const DATA_POSTING = [
  "Analytics Engineer, Data Platform",
  "",
  "Own our data pipeline end to end. You will build the ETL pipeline, model the data warehouse, and",
  "run the data quality program. Strong background in data engineering and analytics required, with",
  "experience taking a model from prototype to production.",
].join("\n");

// Identifies the field-neutral archetype by its (unchanged, already neutral)
// title; every tech archetype's title is different.
const GENERIC_TITLE = /^Owning one problem end to end in /;

// Vocabulary that belongs to a tech-company story and must never appear in the
// example a teacher, a nurse or an accountant is shown. Word-bounded so it does
// not trip on innocent substrings.
const TECH_VOCABULARY =
  /\b(latency|uptime|pipelines?|sprints?|backlog|backpressure|spreadsheets?|automation|deploy(?:ed|ment|ments)?|on-call|war room|dashboards?|cach(?:e|ed|ing)|queues?|tickets?|seats|sign-ups|ARR|NPS|CSAT|notebook|retrain(?:ing)?|model|releases?|SaaS|API|servers?|databases?|cloud|devops|SRE|p95|throughput|region)\b/i;

const GENERIC_METRICS = ["time saved", "error / defect rate", "volume handled"];

function rendered(result) {
  return [
    result.summary,
    result.project.title,
    ...result.project.sections.map((s) => s.body),
    ...result.project.outcomes.map((o) => `${o.metric} ${o.figure}`),
    ...result.metrics,
  ].join(" ");
}

describe("N131 — non-tech postings get the field-neutral generic example", () => {
  for (const [name, posting] of NON_TECH_POSTINGS) {
    it(`selects the generic archetype, not a tech one, for a ${name} posting`, () => {
      const result = idealProject(posting);
      expect(result).not.toBeNull();
      // Positive control: the posting yields a real shape, so this went through
      // the bucket-ranking path and not the no-shape-term early exit.
      expect(result.shape).not.toBe("");
      expect(result.project.title).toMatch(GENERIC_TITLE);
    });

    it(`keeps the ${name} posting's metrics in agreement with its generic story`, () => {
      const result = idealProject(posting);
      expect(result.metrics).toEqual(GENERIC_METRICS);
      // The worked example's own outcome categories are the same three the
      // checklist next to it names — story and metrics never disagree.
      expect(result.project.outcomes.map((o) => o.metric)).toEqual(result.metrics);
    });

    it(`renders no tech-specific vocabulary for a ${name} posting`, () => {
      expect(rendered(idealProject(posting))).not.toMatch(TECH_VOCABULARY);
    });
  }

  it("renders no tech-specific vocabulary in the role-agnostic default either", () => {
    const result = idealProject(NO_SHAPE_POSTING);
    expect(result.shape).toBe("");
    expect(result.project.title).toMatch(GENERIC_TITLE);
    expect(rendered(result)).not.toMatch(TECH_VOCABULARY);
  });

  it("gives the generic example three outcome categories that fit any field", () => {
    const outcomes = idealProject(NO_SHAPE_POSTING).project.outcomes;
    expect(outcomes.map((o) => o.metric)).toEqual(GENERIC_METRICS);
    for (const { figure } of outcomes) expect(figure).toMatch(/\d/);
  });

  // The denylist has to be able to fire, or "no tech vocabulary" passes against
  // anything: the infra story it is meant to exclude trips it.
  it("the vocabulary denylist does detect a tech story (control)", () => {
    expect(rendered(idealProject(INFRA_POSTING))).toMatch(TECH_VOCABULARY);
  });
});

describe("N131 — a strong tech match still selects its specialized archetype", () => {
  it("still tells the infrastructure story for a genuinely infrastructure posting", () => {
    const result = idealProject(INFRA_POSTING);
    expect(result.project.title).toMatch(/war room/i);
    expect(result.project.title).not.toMatch(GENERIC_TITLE);
    expect(result.metrics).toEqual(["latency reduction %", "uptime / reliability %", "throughput at scale"]);
  });

  it("still tells the data story for a genuinely data posting", () => {
    const result = idealProject(DATA_POSTING);
    expect(result.project.title).toMatch(/untrusted notebook/i);
    expect(result.metrics).toEqual([
      "model accuracy improvement",
      "data volume processed",
      "pipeline runtime reduction",
    ]);
  });

  // The edge of the rule, both sides, on otherwise identical postings: one
  // match is generic (EDUCATION_POSTING above), two is the smallest strong match.
  it("treats exactly two matches as strong and one as incidental", () => {
    const one = idealProject(EDUCATION_POSTING);
    const two = idealProject(EDUCATION_TWO_HITS_POSTING);
    expect(one.project.title).toMatch(GENERIC_TITLE);
    expect(two.project.title).toMatch(/war room/i);
    expect(two.metrics[0]).toBe("latency reduction %");
  });

  it("stays deterministic across the bias", () => {
    for (const posting of [EDUCATION_POSTING, EDUCATION_TWO_HITS_POSTING, INFRA_POSTING]) {
      expect(idealProject(posting)).toEqual(idealProject(posting));
    }
  });
});
