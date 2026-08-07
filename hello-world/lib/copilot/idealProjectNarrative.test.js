// AC-M1: the ideal-project benchmark is no longer one advisory sentence — it is
// a WORKED EXAMPLE. A named hypothetical project, told in four sections as
// something a team actually did, with realistic figures attached so a candidate
// can see what a strong answer sounds like instead of being told, abstractly,
// that a measurable outcome is wanted.
//
// This is a deliberate, scoped reversal of one half of R-130/R-135. Those cases
// banned FABRICATED FIGURES because the block sits next to a real quote from the
// candidate's résumé and a figure there could be misread as theirs. The ban is
// kept exactly where it was earned:
//
//   metrics     still contains no digit at all — R-135's own assertion, and
//               still the candidate's own checklist of metric CATEGORIES.
//   project     the new field, and the only place a FABRICATED FIGURE appears.
//
// Note what is deliberately NOT asserted: that `shape`/`summary` are digit-free.
// They never were. `Section 508` and `HL7` are taxonomy canonicals, so a posting
// naming either puts a digit in both fields today. Those are names, not figures,
// and writing that assertion down would pin a property the module does not have.
//
// Two structural guarantees carry the safety story, and both are asserted below:
//
//   1. Figures are hand-authored constants, so the module still never reads a
//      number out of the posting — R-135's salary band cannot return this way.
//      `it("is independent of every number in the posting")` pins it.
//   2. Figures never cross archetypes. `outcomes` is owned by the archetype
//      rather than looked up per entry of `metrics`, because `categoryMetrics`
//      tops `metrics` up from LOWER-ranked buckets — so a phrase-keyed table
//      would caption the SOC-2 story with a p95 latency figure and show a
//      newsroom writer "licensed seats active weekly". That is R-137's failure
//      one level down, and owning the pairs per archetype makes it
//      unconstructible.

import { describe, it, expect } from "vitest";

import { idealProject } from "./idealProject.js";

// Deliberately keeps "Our platform serves millions of students." — the sentence
// R-137 was written around. Without it the infrastructure bucket scores ZERO on
// this posting, and every assertion about archetype selection below passes just
// as happily against the pre-R-137 declaration-order bug it is meant to exclude.
const PRODUCT_POSTING = [
  "Senior Product Manager, Education Technology",
  "",
  "We are hiring a product manager to own our K-12 education technology product suite end to end.",
  "You will define product strategy, run Agile ceremonies, and partner closely with UX design and",
  "customer success to shape the product roadmap. Ideal candidates have led cross-functional product",
  "teams, driven product adoption among students and teachers, and used customer feedback to prioritize",
  // "Artificial Intelligence" is kept on ONE line on purpose: taxonomy n-grams
  // are matched per line (segmentLine in keywords.js), so a term split across a
  // newline never matches and silently drops out of `shape`.
  "the product backlog. Our platform serves millions of students.",
  "We are bringing Artificial Intelligence into the classroom.",
  "",
  "Requirements: 5+ years of product management experience, strong Agile background, and a passion for",
  "education technology.",
].join("\n");

// The same posting carrying every shape of number a real posting actually
// states — the salary band in two formats (R-135's reported failure verbatim),
// a different experience floor, a headcount, a campus count, and a percentage,
// which is the one shape a naive "mine the posting for a metric" implementation
// would most plausibly reach for.
const PRODUCT_POSTING_WITH_NUMBERS = PRODUCT_POSTING.replace(
  "Requirements: 5+ years",
  [
    "Salary range: $78,496.00 - $105,974.00 annually. Compensation: $78,496 - $105,974.",
    "This role supports 12 campuses and a team of 8, and is expected to lift adoption by 40% in year one.",
    "Requirements: 9+ years",
  ].join("\n"),
);

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

// Names DevOps and nothing from DELIVERY_METHODS. DevOps is a `methodology`
// canonical and therefore reachable, which is exactly why it is here.
const DEVOPS_POSTING = [
  "Senior Platform Engineer",
  "We are looking for an engineer with deep distributed systems and cloud computing experience.",
  "Requirements:",
  "- 5+ years with Python and distributed systems",
  "- Experience running infrastructure serving 2M requests/day",
  "- Strong background in DevOps and infrastructure as code",
].join("\n");

// Yields exactly one shape term, and that term is a delivery method — so the
// setting slot has nothing to draw on and must fall back. Verified against the
// current module: `shape` is "Scrum" and nothing else.
const METHODOLOGY_ONLY_POSTING = [
  "Customer Support Operations Manager",
  "",
  "Own our support operations end to end. You will run the service desk, cut resolution time, and",
  "improve customer satisfaction across a growing ticket volume. Experience with support tooling and",
  "operations required. Scrum experience a plus.",
].join("\n");

// Matches no METRIC_BUCKET at all, so it exercises the generic archetype the
// same way it already exercises GENERIC_METRICS — and it names no methodology,
// so it also covers the runWithout branch of "Ran".
const NO_BUCKET_POSTING = [
  "Senior Staff Writer, Newsroom",
  "",
  "We are hiring a senior writer for our newsroom. Journalism experience preferred. You will conduct",
  "interviews, write investigative stories, and collaborate with editors on breaking news coverage.",
  "Excellent storytelling skills required.",
].join("\n");

// The three archetypes no fixture used to reach. Their absence is exactly how
// the `data` archetype shipped a section whose second sentence began with a
// lowercase word: R-137's own lesson is that every failure in this module looked
// correct against the fixtures it was written with, and the fix is a realistic
// posting per archetype, not a better reading of the copy.
const DATA_POSTING = [
  "Analytics Engineer, Data Platform",
  "",
  "Own our data pipeline end to end. You will build the ETL pipeline, model the data warehouse, and",
  "run the data quality program. Strong background in data engineering and analytics required, with",
  "experience taking a model from prototype to production.",
].join("\n");

const REVENUE_POSTING = [
  "Director of Revenue Operations",
  "",
  "Own the sales pipeline and revenue growth for our SaaS business. You will run pipeline reviews,",
  "improve conversion across the sales funnel, and partner with marketing on quota and growth targets.",
  "Requirements: revenue operations experience and a track record of pipeline growth.",
].join("\n");

const SECURITY_POSTING = [
  "Cybersecurity Compliance Engineer",
  "",
  "You will own our Cybersecurity and compliance posture, run risk assessments, and prepare for SOC 2.",
  "Requirements: Cybersecurity experience, compliance frameworks, and risk management.",
].join("\n");

// Every domain term this posting names is a STANDARD, a REGULATION or a VENDOR
// PRODUCT — a thing a project complies with or runs on, never a field a project
// happens in. "…, in HIPAA." and "…, in Cerner." are the sentences this fixture
// exists to make impossible.
const NOT_A_SETTING_POSTING = [
  "Integration Engineer, Clinical Systems",
  "",
  "You will build HL7 and FHIR interfaces, map C-CDA documents, and maintain our EDI feeds.",
  "Experience with Cerner and Epic required, along with HIPAA compliance and Section 508 accessibility",
  "of the reporting surface. HL7 and FHIR experience is essential.",
].join("\n");

// An infrastructure posting that also names a capability from the {D2}
// allowlist. The infrastructure story's {D2} slot is the subject of "rolled out
// region by region behind a flag", which is a sentence about a service tier and
// not about a capability — the same construction the allowlist was introduced to
// prevent, arriving from the other direction.
const INFRA_WITH_TECH_POSTING = [
  "Staff Site Reliability Engineer",
  "",
  "Own uptime and reliability for our distributed systems. You will cut latency, raise throughput at",
  "scale, and lead the migration to a scalable cloud infrastructure. Our platform applies Machine",
  "Learning to capacity planning, so Machine Learning experience is a plus.",
].join("\n");

const ALL_POSTINGS = [
  PRODUCT_POSTING,
  PRODUCT_POSTING_WITH_NUMBERS,
  INFRA_POSTING,
  INFRA_WITH_TECH_POSTING,
  DEVOPS_POSTING,
  DATA_POSTING,
  REVENUE_POSTING,
  SECURITY_POSTING,
  METHODOLOGY_ONLY_POSTING,
  NOT_A_SETTING_POSTING,
  NO_BUCKET_POSTING,
];

const CTX = {
  question: "Tell me about a project you owned end to end.",
  points: ["I led a team through a launch."],
};

// One word each. The labels lead bulleted lines now, not paragraphs, and
// "What they built" reads as padding in front of a bullet the way "Built"
// does not.
const SECTION_LABELS = ["Problem", "Built", "Ran", "Landed"];

function bodies(result) {
  return result.project.sections.map((s) => s.body);
}

function section(result, label) {
  return result.project.sections.find((s) => s.label === label).body;
}

describe("idealProject worked example", () => {
  it("returns a complete project whenever it returns anything at all", () => {
    for (const posting of ALL_POSTINGS) {
      const result = idealProject(posting, CTX);
      expect(result).not.toBeNull();
      expect(result.project.title.trim()).not.toBe("");
      expect(result.project.sections.map((s) => s.label)).toEqual(SECTION_LABELS);
      expect(result.project.outcomes).toHaveLength(3);
    }
  });

  // Both bounds, and the pair is the requirement. The first version of this
  // block answered "it needs to be written as though it's an actual project"
  // with four paragraphs and got "this is way too fucking verbose" back — a
  // fair verdict on something read mid-interview, in one glance, under
  // pressure. The content did not change; the length did. So the floor stops
  // the sections decaying back into the one-line advice this replaced, and the
  // ceiling stops them growing back into paragraphs. A body that needs more
  // than 28 words is carrying detail that belongs in the candidate's own
  // answer, not in a benchmark of one.
  it("keeps every section a bullet, not a paragraph", () => {
    for (const posting of ALL_POSTINGS) {
      const result = idealProject(posting, CTX);
      for (const body of bodies(result)) {
        const words = body.trim().split(/\s+/).length;
        expect(words, `too long to skim: ${body}`).toBeLessThanOrEqual(28);
        expect(words, `too thin to be a project: ${body}`).toBeGreaterThanOrEqual(12);
        expect(body.trim().endsWith(".")).toBe(true);
      }
      // The whole example, title included, has to fit in a glance. The version
      // this replaced ran to roughly 220 words across the same four sections.
      const total = [result.project.title, ...bodies(result)].join(" ").trim().split(/\s+/).length;
      expect(total, "the whole example no longer fits in a glance").toBeLessThanOrEqual(120);
    }
  });

  // A label leading a bulleted line earns its place only if it is shorter than
  // what it labels. "What they built" in front of a fifteen-word bullet is
  // padding; "Built" is a label.
  it("labels each bullet in one word", () => {
    for (const posting of ALL_POSTINGS) {
      for (const { label } of idealProject(posting, CTX).project.sections) {
        expect(label.trim().split(/\s+/)).toHaveLength(1);
      }
    }
  });

  // The user's second instruction: "insert realistic metric numbers in there as
  // well". Each outcome names a metric CATEGORY (no digit — it is a kind of
  // number) and pairs it with an example FIGURE (a digit, necessarily).
  it("pairs a named metric category with an example figure", () => {
    for (const posting of ALL_POSTINGS) {
      const outcomes = idealProject(posting, CTX).project.outcomes;
      const names = outcomes.map((o) => o.metric);
      expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
      for (const { metric, figure } of outcomes) {
        expect(metric.trim()).not.toBe("");
        expect(metric).not.toMatch(/\d/);
        expect(figure).toMatch(/\d/);
      }
    }
  });

  // Both halves, because only asserting the ban would pass against a `project`
  // with no figures in it at all — which is the whole feature missing.
  it("puts fabricated figures in `project` and keeps them out of `metrics`", () => {
    for (const posting of ALL_POSTINGS) {
      const result = idealProject(posting, CTX);
      for (const metric of result.metrics) expect(metric).not.toMatch(/\d/);
      expect(JSON.stringify(result.project)).toMatch(/\d/);
    }
  });

  // The structural half of the safety story, and the one that makes R-135
  // unrepeatable: the posting's numbers are not an input. The two postings differ
  // by a salary band stated twice in two formats, a different years-of-experience
  // floor, a headcount, a campus count and a percentage — the last deliberately,
  // because "mine the posting for something shaped like a metric" would reach
  // for `40%` first, and every other fixture here is percentage-free.
  it("is independent of every number in the posting", () => {
    const plain = idealProject(PRODUCT_POSTING, CTX);
    const numbered = idealProject(PRODUCT_POSTING_WITH_NUMBERS, CTX);
    expect(numbered.project).toEqual(plain.project);
    const rendered = JSON.stringify(numbered.project);
    for (const posted of [/78[,.]?496/, /105[,.]?974/, /9\+ years/, /12 campus/, /\b40%/, /team of 8/]) {
      expect(rendered).not.toMatch(posted);
    }
  });

  // The archetype follows the SAME fit ranking that already picks the metrics
  // (R-137), so a product posting cannot be handed product metrics and an
  // infrastructure story. Asserted on tokens that occur in exactly one
  // archetype's copy, in both directions — a one-directional assertion passes
  // against an implementation that returns the same story for everything.
  it("tells a product story for a product posting and an infrastructure story for an infrastructure one", () => {
    const product = bodies(idealProject(PRODUCT_POSTING, CTX)).join(" ").toLowerCase();
    expect(product).toContain("sign-ups");
    expect(product).not.toContain("backpressure");

    const infra = bodies(idealProject(INFRA_POSTING, CTX)).join(" ").toLowerCase();
    expect(infra).toContain("backpressure");
    expect(infra).not.toContain("sign-ups");

    // The posting that made R-137 necessary: "platform" appears once, and the
    // infrastructure bucket is declared first. Declaration order picks infra;
    // fit picks product. The metrics and the story must agree.
    expect(idealProject(PRODUCT_POSTING, CTX).metrics).toEqual([
      "adoption rate",
      "user satisfaction / NPS",
      "time-to-ship",
    ]);
  });

  // The example is about THIS posting, not a stock story: the posting's own
  // subject matter is the setting, its own capability does the work, and its own
  // methodology names how it ran. All three come from `shape`, so all three are
  // already guaranteed to be literal, whole-word occurrences in the posting.
  it("builds the example out of the posting's own setting, capability and methodology", () => {
    const result = idealProject(PRODUCT_POSTING, CTX);
    expect(result.shape.split(", ")).toEqual(
      expect.arrayContaining(["Education", "Agile", "Artificial Intelligence"]),
    );
    // Every {D1} slot in the copy is preceded by the word "in" — the invariant
    // that keeps substitution grammatical for any noun phrase.
    expect(result.project.title).toContain("in Education");
    expect(section(result, "Built")).toContain("Artificial Intelligence");
    expect(section(result, "Ran")).toContain("Agile");
  });

  // A posting that names no methodology must not have one invented for it, and
  // — the harder case — a posting naming a methodology whose copy would be FALSE
  // must not be labelled with it either. "Two-week sprints" is not what DevOps,
  // Kanban or Waterfall mean, so those postings get the unlabelled variant. The
  // example still ran in two-week increments; it just is not given a name the
  // posting's vocabulary would make a lie.
  it("names a methodology only when the shipped copy is true of it", () => {
    for (const posting of [NO_BUCKET_POSTING, DEVOPS_POSTING, INFRA_POSTING]) {
      const howItRan = section(idealProject(posting, CTX), "Ran");
      for (const name of ["Agile", "Scrum", "Kanban", "DevOps", "Waterfall", "Lean", "Infrastructure as Code"]) {
        expect(howItRan, `named ${name} for a posting whose copy would not be true of it`).not.toContain(name);
      }
      // Still a real bullet, not a stub: dropping the methodology name must not
      // be implemented by dropping the sentence.
      expect(howItRan.trim().split(/\s+/).length).toBeGreaterThanOrEqual(12);
    }
    // DevOps IS in this posting's `shape` — it is excluded from the sentence on
    // purpose, not because the posting never mentioned it.
    expect(idealProject(DEVOPS_POSTING, CTX).shape).toContain("DevOps");
  });

  // The degenerate case the slot rules have to survive: every term the posting
  // contributed is consumed by the methodology slot, leaving the setting slot
  // nothing to draw on. It must fall back rather than render a blank, a
  // duplicate of the methodology, or an ungrammatical phrase.
  it("falls back to a readable setting when the posting offers no subject matter", () => {
    const result = idealProject(METHODOLOGY_ONLY_POSTING, CTX);
    expect(result.shape).toBe("Scrum");
    expect(result.project.title).toContain("in a support organisation");
    expect(result.project.title).not.toContain("Scrum");
    expect(result.project.title).not.toContain("{");
    expect(section(result, "Ran")).toContain("Scrum");
  });

  // A substituted slot lands inside a hand-written sentence, and the copy has to
  // stay correct English around it whatever the slot is filled with. The
  // specific failure: the data archetype put its {D2} slot at a SENTENCE
  // BOUNDARY, and its own fallback value is lowercase, so an analytics posting
  // that named no capability rendered "…the exact model and inputs that produced
  // it. the model shipped behind a flag…". Checked as a general rule rather than
  // for that one string, because the same mistake in any other archetype would
  // look exactly as wrong and read exactly as sloppy.
  it("never starts a sentence with a lowercase word", () => {
    for (const posting of ALL_POSTINGS) {
      const result = idealProject(posting, CTX);
      for (const text of [result.project.title, ...bodies(result)]) {
        expect(text, `sentence starts lowercase: ${text}`).not.toMatch(/\.\s+[a-z]/);
        expect(text[0]).toBe(text[0].toUpperCase());
      }
    }
  });

  // {D1} is the object of "in", and the copy's claim is that a fixed "in" keeps
  // the sentence grammatical for any noun phrase. That is only true of terms
  // that name a FIELD. A standard, a regulation or a vendor product is a thing a
  // project complies with or runs on, and "…, in HIPAA." / "…, in Cerner." /
  // "Owning one problem end to end in Technical Roadmap" are not sentences. Such
  // a term must be passed over for the archetype's own default, exactly as if
  // the posting had named no domain at all.
  it("never uses a standard, a regulation or a vendor product as the setting", () => {
    const result = idealProject(NOT_A_SETTING_POSTING, CTX);
    expect(result).not.toBeNull();
    const prose = `${result.project.title} ${bodies(result).join(" ")}`;
    for (const term of ["HIPAA", "HL7", "FHIR", "C-CDA", "EDI", "EHR", "Cerner", "Epic", "Section 508"]) {
      expect(prose, `used "${term}" as a setting`).not.toContain(`in ${term}`);
    }
    // Falls back rather than rendering nothing or an empty slot.
    expect(result.project.title.trim()).not.toBe("");
    expect(result.project.title).not.toMatch(/[{}]/);
  });

  // The {D2} allowlist was justified by one sentence ("…doing the unglamorous
  // part", in the product story) but the slot is used in seven, and the
  // infrastructure story's is "rolled out region by region behind a flag" —
  // a sentence about a service tier. "Machine Learning rolled out region by
  // region behind a flag" is the same defect the allowlist exists to prevent,
  // reached from the other side. An archetype whose slot cannot host a
  // capability must keep its own default even when the posting names one.
  it("only lets the posting's capability fill a slot that can actually hold one", () => {
    const infra = idealProject(INFRA_WITH_TECH_POSTING, CTX);
    expect(infra.shape).toContain("Machine Learning");
    expect(section(infra, "Built")).not.toContain("Machine Learning");

    // The converse, so this cannot be satisfied by never substituting at all:
    // the product story's slot IS built to hold one, and still does.
    expect(section(idealProject(PRODUCT_POSTING, CTX), "Built")).toContain("Artificial Intelligence");
  });

  // No slot may ever reach the screen unsubstituted.
  it("leaves no substitution token anywhere in the rendered copy", () => {
    for (const posting of ALL_POSTINGS) {
      const result = idealProject(posting, CTX);
      const prose = [result.project.title, ...bodies(result), ...result.project.outcomes.map((o) => o.figure)].join(" ");
      expect(prose).not.toMatch(/[{}]/);
      expect(prose).not.toMatch(/undefined|\[object/);
    }
  });

  // Same reason the rest of this block is third person (R-130, R-135): it
  // describes work the candidate did NOT do, rendered beside a real quote from
  // their own résumé. Extended here to the new fields, which are the ones a
  // candidate under pressure would be most tempted to read aloud.
  it("stays in a voice the candidate could never read out as their own claim", () => {
    for (const posting of ALL_POSTINGS) {
      const result = idealProject(posting, CTX);
      const prose = [
        result.project.title,
        ...bodies(result),
        ...result.project.outcomes.map((o) => `${o.metric} ${o.figure}`),
      ].join(" ");
      expect(prose).not.toMatch(/\bI\b/);
      expect(prose).not.toMatch(/\bmy\b/i);
      expect(prose).not.toMatch(/\bwe\b/i);
      expect(prose).not.toMatch(/\bour\b/i);
    }
  });

  // The archetype table is a module-level constant in a long-lived server
  // process, so handing a caller the SAME array and the SAME objects on every
  // call makes one careless `.sort()`, `.reverse()` or field assignment in any
  // consumer corrupt every subsequent answer for every user until the process
  // restarts — and nothing downstream would report it, because the payload
  // would still be well-formed. Deterministic output has to mean "the same
  // VALUE", never "the same object".
  it("cannot be corrupted by a caller that mutates what it was given", () => {
    const first = idealProject(PRODUCT_POSTING, CTX);
    const pristine = JSON.parse(JSON.stringify(first.project));

    first.project.outcomes.reverse();
    first.project.outcomes[0].figure = "MUTATED";
    first.project.outcomes.push({ metric: "injected", figure: "999" });
    first.project.sections[0].body = "MUTATED";
    first.project.sections.length = 1;

    expect(idealProject(PRODUCT_POSTING, CTX).project).toEqual(pristine);
  });

  it("is deterministic, project and all", () => {
    for (const posting of ALL_POSTINGS) {
      expect(idealProject(posting, CTX)).toEqual(idealProject(posting, CTX));
    }
  });

  it("still degrades to null rather than to an empty example", () => {
    expect(idealProject("", CTX)).toBeNull();
    expect(idealProject("   ", CTX)).toBeNull();
    expect(idealProject(null, CTX)).toBeNull();
    expect(idealProject(undefined, CTX)).toBeNull();
    expect(idealProject("asdf qwer zxcv nothing here at all", CTX)).toBeNull();
  });
});
