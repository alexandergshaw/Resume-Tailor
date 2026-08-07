// AC-M1: the "ideal project" benchmark stops being one advisory sentence and
// becomes a worked example — a named hypothetical project, told in four
// sections as something a team actually did, with figures attached.
//
// This module owns the archetype table (the actual prose) and the slot
// grammar that substitutes three posting-derived values into it. It does NOT
// own fit — idealProject.js already ranks the posting against
// METRIC_BUCKETS to pick `metrics`, and hands this module the SAME winning
// bucket's key so the story a candidate reads always matches the metrics
// sitting next to it (R-137's fix, applied one level down: a product
// posting can never be handed an infrastructure story any more than it can
// be handed infrastructure metrics).
//
// Everything this module writes is either a hand-authored constant or one of
// three slot values idealProject.js already verified are literal, whole-word
// occurrences in the posting (`shape`). This module never sees the posting
// text itself — only `archetypeKey` and `shapeTerms` — so there is no path
// for a posting's own number (a salary band, a headcount) to reach the page
// through here. That is what makes R-135's failure structurally impossible
// rather than merely untested.

// The setting slot ({D1}) is filled from posting terms whose taxonomy
// category is "domain" — "Education", "Distributed Systems", "Journalism".
// The capability slot ({D2}) and the methodology slot ({M}) are each matched
// against a short, deliberately curated list below instead of a whole
// category, because every entry in those lists has to read correctly
// dropped into a specific grammatical position (see the two lists' own
// comments).

// {D2} is the subject of an action verb in every archetype's "Built"
// section — "pre-filling known fields and flagging what a person would
// skip" in the product archetype, an equivalent construction in every other
// one — so every entry here has to read as a plausible actor performing
// work. "Cloud Computing", "Data Science" and "Analytics" are real
// `technology`/`domain` canonicals and were tried here; all three were
// rejected because none of them "does" anything as the subject of that
// sentence the way a model or an assistant does. Verified against
// lib/llm/engines/tailor-lite/data/skills_taxonomy.json — every entry below
// is a real canonical (category "domain"), so every entry is actually
// reachable from `shape`.
const TECH_TERMS = ["Artificial Intelligence", "Machine Learning", "Deep Learning", "Generative AI"];

// {M} is an adjective inside the sentence ("Two-week Agile sprints…"), not a
// sentence-initial prefix — which is also why `ranWithout` can drop the slot
// and its space without leaving the sentence to start on a lowercase
// fallback. Every archetype's "Ran" copy describes two-week (or weekly)
// INCREMENTS run against a backlog — iterative delivery. That is true of
// Agile and Scrum. It is not true of Kanban (continuous flow, no fixed
// increment), Waterfall (the opposite of iterative), DevOps (a practice
// area, not a cadence) or Infrastructure as Code (not a delivery cadence at
// all) — all five are real `methodology` canonicals a posting can
// legitimately name, and all five would turn "Ran" into a fabricated claim
// about the posting's own vocabulary if substituted in. So the list stays at
// two, and every other methodology canonical takes the archetype's
// `ranWithout` copy instead, which describes the same two-week cadence
// without naming it.
const DELIVERY_METHODS = ["Agile", "Scrum"];

// {D1} is filled from any `shape` term whose taxonomy category is "domain"
// (see pickD1's own comment for why a fixed "in" makes that safe for almost
// any noun phrase). These 12 are the exception: each names a standard, a
// regulation, a vendor product or a single artifact — a thing a project
// complies with or runs on, never a field a project happens in — so "…, in
// HIPAA.", "…, in Cerner." and "Owning one problem end to end in Technical
// Roadmap" are not grammatical the way "…, in Education." is. Verified
// against lib/llm/engines/tailor-lite/data/skills_taxonomy.json — all 12 are
// real `domain` canonicals, so all 12 are actually reachable from `shape`.
// Excluding them here also keeps the posting's own digits (HL7, Section 508,
// C-CDA) out of project.title, which never reads the posting's numbers.
const NOT_A_SETTING = [
  "HL7",
  "FHIR",
  "C-CDA",
  "EDI",
  "EHR",
  "HIPAA",
  "Section 508",
  "Epic",
  "Cerner",
  "Component Library",
  "Reference Architecture",
  "Technical Roadmap",
];

// Each archetype declares its own three { metric, figure } pairs rather than
// having `project.outcomes` built by looking a figure up per entry of the
// caller's `metrics`. That indirection was tried and rejected: `metrics`
// (categoryMetrics in idealProject.js) tops the winning bucket up from
// LOWER-ranked buckets, and then from GENERIC_METRICS, whenever the winning
// bucket has fewer than MAX_METRICS phrases of its own (the security bucket
// only has two). A figure table keyed by phrase would therefore sometimes
// have to caption a security/compliance story with a data-bucket figure like
// "nightly run 6h 20m → 48m", or a newsroom (generic) story with
// "31% → 68% of licensed seats active weekly" — R-137's failure, one level
// down. Owning three pairs per archetype, unconnected to any lookup, makes
// that mismatch unconstructible instead of merely untested.

// Every title, section body and `ranWithout` string below is deliberately
// short. The first version of this table answered "it needs to be written
// as though it's an actual project" with four paragraphs per archetype, and
// the verdict on what shipped was "this is way too fucking verbose" — a fair
// read on something a candidate has to take in mid-question, in one glance,
// under interview pressure. The fix kept the content: the project details
// and the figures are the same ones that were in the paragraphs. Only the
// length changed — each section is now one skimmable bullet, not a
// paragraph. lib/copilot/idealProjectNarrative.test.js enforces the new
// shape in both directions: a floor (12 words) so a section cannot decay
// back into the one-line advice this table originally replaced, and a
// ceiling (28 words per section, 120 for the whole title-plus-sections
// example) so it cannot grow back into the paragraphs this rewrite removed.
const ARCHETYPES = {
  product: {
    d1Default: "a consumer product",
    d2Default: "automation",
    title: (d1) => `Relaunching the one workflow people actually came for, in ${d1}.`,
    problem:
      "Healthy sign-ups, weak weekly use — barely a third of licensed seats — and a core workflow nine steps long.",
    built: (d2) =>
      `Nine steps cut to three, piloted on forty accounts, with ${d2} pre-filling known fields and flagging what a person would skip.`,
    ranWith: (m) =>
      `Two-week ${m} sprints, an owner-ranked backlog, fortnightly demos with real users, and quarterly releases moved to the same cadence.`,
    ranWithout:
      "Two-week sprints, an owner-ranked backlog, fortnightly demos with real users, and quarterly releases moved to the same cadence.",
    landed:
      "Baselined before the work and measured the same way after — including the misses: session length flat, mobile pilot slipped a quarter.",
    outcomes: [
      { metric: "adoption rate", figure: "31% → 68% of licensed seats active weekly" },
      { metric: "user satisfaction / NPS", figure: "in-product NPS +12 → +41" },
      { metric: "time-to-ship", figure: "median idea-to-production 11 weeks → 4" },
    ],
  },

  data: {
    d1Default: "analytics",
    d2Default: "the model",
    title: (d1) => `Moving a model from an untrusted notebook into production, in ${d1}.`,
    problem:
      "A model that scored well offline but nobody could reproduce, so both downstream teams had quietly gone back to a spreadsheet.",
    built: (d2) =>
      `A scheduled retraining pipeline with versioned features and traceable predictions; nothing switched over until ${d2} had run six weeks on live traffic.`,
    ranWith: (m) =>
      `Two-week ${m} increments against questions the business actually asked, with a kill criterion agreed before any of it started.`,
    ranWithout:
      "Two-week increments against questions the business actually asked, with a kill criterion agreed before any of it started.",
    landed:
      "Compared against the reproduced baseline, not against nothing — and two leaking features were cut, costing a third of the headline lift.",
    outcomes: [
      { metric: "model accuracy improvement", figure: "precision@10 0.42 → 0.61 on live traffic" },
      { metric: "data volume processed", figure: "1.8M records a night, up from a 240k sample" },
      { metric: "pipeline runtime reduction", figure: "nightly run 6h 20m → 48m" },
    ],
  },

  infra: {
    d1Default: "platform engineering",
    d2Default: "the new service tier",
    // {D2} here is the subject of "rolled out region by region" — a sentence
    // about a service tier, not about an actor doing work, so it cannot
    // safely hold a posting's capability the way the TECH_TERMS allowlist
    // assumes (see that list's comment, which is a per-SENTENCE
    // justification, not a global one). Always use d2Default.
    capabilityFromPosting: false,
    title: (d1) => `Surviving the peak day without a war room, in ${d1}.`,
    problem:
      "The busiest hour of the month timed out, on-call burned two engineers in a quarter, and traces stopped at the gateway.",
    built: (d2) =>
      `Hot paths moved onto a queue with backpressure, reads cached against an explicit invalidation contract, and ${d2} rolled out region by region.`,
    ranWith: (m) =>
      `Weekly ${m} increments, one migration each, and nothing shipped without the dashboard that would prove or disprove it.`,
    ranWithout:
      "Weekly increments, one migration each, and nothing shipped without the dashboard that would prove or disprove it.",
    landed:
      "First peak day in three years without a war room — and clear the win was caching, not architecture.",
    outcomes: [
      { metric: "latency reduction %", figure: "p95 on the hot path 2.4s → 610ms" },
      { metric: "uptime / reliability %", figure: "monthly availability 99.2% → 99.95%" },
      { metric: "throughput at scale", figure: "held 12k requests/sec at peak, up from 4k" },
    ],
  },

  revenue: {
    d1Default: "a sales organisation",
    d2Default: "a scoring model",
    title: (d1) => `Rebuilding the two stages where deals were actually dying, in ${d1}.`,
    problem:
      "Healthy pipeline, a one-in-nine close rate, and five dead weeks between the demo and the security review.",
    built: (d2) =>
      `Both dead stages got an owner and a checklist, the security review moved ahead of the demo, and ${d2} flagged accounts matching past wins.`,
    ranWith: (m) =>
      `A two-week ${m} cycle, one experiment at a time so every change stayed attributable, with every revert written down.`,
    ranWithout:
      "A two-week cycle, one experiment at a time so every change stayed attributable, with every revert written down.",
    landed:
      "Attribution kept honest — a pricing change landed the same quarter and is separated out; enterprise did not move at all.",
    outcomes: [
      { metric: "revenue impact", figure: "$1.4M net-new ARR over three quarters" },
      { metric: "conversion rate", figure: "qualified-to-closed 11% → 19%" },
      { metric: "pipeline generated", figure: "$4.2M in new qualified pipeline" },
    ],
  },

  support: {
    d1Default: "a support organisation",
    d2Default: "a triage assistant",
    title: (d1) => `Emptying the queue by fixing the five things people kept writing in about, in ${d1}.`,
    problem:
      "Nineteen-hour first response, a backlog growing weekly, and forty per cent of tickets tracing to four defects and one lost reset flow.",
    built: (d2) =>
      `The four defects fixed at source, the reset flow moved where people land, and ${d2} routing tickets and drafting replies for a person to approve.`,
    ranWith: (m) =>
      `Weekly ${m} increments run jointly by support and engineering, one intent at a time, with misroutes setting the next backlog.`,
    ranWithout:
      "Weekly increments run jointly by support and engineering, one intent at a time, with misroutes setting the next backlog.",
    landed:
      "Deflection wins reported separately from faster handling — and the two peak weeks did not improve at all.",
    outcomes: [
      { metric: "resolution time", figure: "first response 19h → 3h, full resolution 4.1 days → 1.6" },
      { metric: "customer satisfaction score", figure: "CSAT 3.4 → 4.5 out of 5" },
      { metric: "ticket volume handled", figure: "1,450 tickets a month, down from 2,100, at the same headcount" },
    ],
  },

  security: {
    d1Default: "security and compliance",
    d2Default: "automated policy checks",
    // {D2} here is the subject of "blocked the pipeline" — again an artifact
    // being described, not an actor doing work, so it has the same problem
    // as infra's slot above. Always use d2Default.
    capabilityFromPosting: false,
    title: (d1) => `Getting through a real audit without a three-week fire drill, in ${d1}.`,
    problem:
      "Three weeks of hand-gathered evidence last time, two repeat findings, and eleven of twenty-three regulated systems with no named owner.",
    built: (d2) =>
      `Access reviews became a signed automated report, secrets moved into a rotating store, and ${d2} blocked the pipeline only on rules that had caused findings.`,
    ranWith: (m) =>
      `One control per two-week ${m} increment, each with its evidence artifact defined before the work started.`,
    ranWithout:
      "One control per two-week increment, each with its evidence artifact defined before the work started.",
    landed:
      'Measured on the audit result and near-misses caught, never on "no breach happened" — and one finding did repeat.',
    outcomes: [
      { metric: "incidents prevented", figure: "17 credential leaks caught pre-merge in six months" },
      { metric: "audit / compliance pass rate", figure: "passed with 1 finding, down from 6" },
      { metric: "evidence-gathering time", figure: "3 weeks of manual evidence gathering → 2 days" },
    ],
  },

  generic: {
    d1Default: "the core of the business",
    d2Default: "a small amount of automation",
    title: (d1) => `Owning one problem end to end in ${d1}, from written problem statement to proven number.`,
    problem:
      "A process living on three spreadsheets and one person's memory, costing six hours a week per team and failing silently.",
    built: (d2) =>
      `One owned system with a single source of truth, the remaining manual steps made visible, and ${d2} taking the repetitive middle.`,
    ranWith: (m) =>
      `Two-week ${m} increments with something usable each time, a backlog ordered by cost rather than volume, and trade-offs written down.`,
    ranWithout:
      "Two-week increments with something usable each time, a backlog ordered by cost rather than volume, and trade-offs written down.",
    landed:
      "Baselined before and measured the same way after — including the team that went back to the old process, and why.",
    outcomes: [
      { metric: "cost saved", figure: "$41k a year in recovered time and retired tooling" },
      { metric: "adoption rate", figure: "9 of the 11 teams on it within two quarters" },
      { metric: "time-to-ship", figure: "request-to-delivered 11 weeks → 4" },
    ],
  },
};

// ARCHETYPES is module-level state living in a long-lived server process —
// every request in the process's lifetime shares this exact table. Freezing
// it here (table, each archetype, its `outcomes` array, and each outcome
// object) means a future change that hands a caller `archetype.outcomes` (or
// any other nested value) by reference fails LOUDLY — a mutation attempt
// throws in strict mode — instead of silently corrupting the table for every
// subsequent caller. "Deterministic" has to mean the same VALUE on every
// call, never the same object; see buildProject below for the other half of
// that guarantee.
function deepFreezeArchetypes(archetypes) {
  for (const archetype of Object.values(archetypes)) {
    for (const outcome of archetype.outcomes) Object.freeze(outcome);
    Object.freeze(archetype.outcomes);
    Object.freeze(archetype);
  }
  return Object.freeze(archetypes);
}
deepFreezeArchetypes(ARCHETYPES);

// {D2}: the first `shape` term that is one of TECH_TERMS. Exact,
// case-insensitive match against the canonical already sitting in `shape` —
// never a substring or category match, so a posting can only ever surface a
// capability it actually named.
function pickD2(shapeTerms) {
  for (const term of shapeTerms) {
    if (TECH_TERMS.some((t) => t.toLowerCase() === term.canonical.toLowerCase())) return term.canonical;
  }
  return null;
}

// {D1}: the first `shape` term whose taxonomy category is "domain",
// excluding whichever term was already chosen as {D2} — every TECH_TERMS
// entry is itself a `domain` canonical (verified against the taxonomy file),
// so without this exclusion a posting naming only "Artificial Intelligence"
// could hand both slots the same word. Every {D1} occurrence in the copy
// above is written as "…in ${d1}"; that fixed "in" is what lets a bare noun
// phrase ("Education"), a multi-word one ("Distributed Systems") and the
// archetype's own prose default ("a support organisation") all substitute in
// and stay grammatical — the slot is never the grammatical subject of its
// sentence, only ever the object of "in", so nothing about its own shape can
// break the sentence around it.
function pickD1(shapeTerms, d2) {
  for (const term of shapeTerms) {
    if (
      term.category === "domain" &&
      term.canonical.toLowerCase() !== String(d2 || "").toLowerCase() &&
      !NOT_A_SETTING.some((t) => t.toLowerCase() === term.canonical.toLowerCase())
    ) {
      return term.canonical;
    }
  }
  return null;
}

// {M}: the first `shape` term that is one of DELIVERY_METHODS. If none
// matches, `ranWithout` is used instead of substituting a fallback word —
// unlike {D1}/{D2}, a posting that named no iterative methodology gets no
// methodology name at all, per the DELIVERY_METHODS comment above.
function pickM(shapeTerms) {
  for (const term of shapeTerms) {
    if (DELIVERY_METHODS.some((m) => m.toLowerCase() === term.canonical.toLowerCase())) return term.canonical;
  }
  return null;
}

// Builds `project` for the archetype the caller's fit ranking selected.
// `shapeTerms` is idealProject.js's own ranked, deduped `shape` list, each
// entry `{ canonical, category }` — already verified literal in the posting
// by the caller, so every slot value substituted below is guaranteed to be
// one of the posting's own words (or, failing that, this archetype's own
// hand-authored default). Nothing here reads the posting text itself.
export function buildProject(archetypeKey, shapeTerms) {
  const archetype = ARCHETYPES[archetypeKey] || ARCHETYPES.generic;
  // capabilityFromPosting: false (infra, security) means this archetype's
  // {D2} sentence is about an artifact, not an actor performing work — see
  // each archetype's own comment — so it never takes the posting's
  // capability, only ever its own d2Default, regardless of what `shape`
  // contains.
  const d2 = archetype.capabilityFromPosting === false ? archetype.d2Default : pickD2(shapeTerms) || archetype.d2Default;
  const d1 = pickD1(shapeTerms, d2) || archetype.d1Default;
  const m = pickM(shapeTerms);

  return {
    title: archetype.title(d1),
    sections: [
      { label: "Problem", body: archetype.problem },
      { label: "Built", body: archetype.built(d2) },
      { label: "Ran", body: m ? archetype.ranWith(m) : archetype.ranWithout },
      { label: "Landed", body: archetype.landed },
    ],
    // Verbatim, per-archetype — see the ARCHETYPES header comment for why
    // this is never a lookup keyed by `metrics`. Built as a NEW array of NEW
    // objects on every call, never `archetype.outcomes` itself: that array
    // and its objects are shared, frozen module-level state (see
    // deepFreezeArchetypes above), so a caller mutating what it was given
    // must never be able to reach the table other callers read from.
    outcomes: archetype.outcomes.map((o) => ({ metric: o.metric, figure: o.figure })),
  };
}
