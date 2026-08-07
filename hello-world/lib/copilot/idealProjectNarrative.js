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

// {D2} is the subject of "…doing the unglamorous part" in every archetype's
// "What they built" section, so every entry here has to read as a plausible
// actor performing work. "Cloud Computing", "Data Science" and "Analytics"
// are real `technology`/`domain` canonicals and were tried here; all three
// were rejected because none of them "does" anything as the subject of that
// sentence the way a model or an assistant does. Verified against
// lib/llm/engines/tailor-lite/data/skills_taxonomy.json — every entry below
// is a real canonical (category "domain"), so every entry is actually
// reachable from `shape`.
const TECH_TERMS = ["Artificial Intelligence", "Machine Learning", "Deep Learning", "Generative AI"];

// {M} is sentence-initial and every archetype's "How it ran" copy describes
// two-week (or weekly) INCREMENTS run against a backlog — iterative delivery.
// That is true of Agile and Scrum. It is not true of Kanban (continuous flow,
// no fixed increment), Waterfall (the opposite of iterative), DevOps (a
// practice area, not a cadence) or Infrastructure as Code (not a delivery
// cadence at all) — all five are real `methodology` canonicals a posting can
// legitimately name, and all five would turn "How it ran" into a fabricated
// claim about the posting's own vocabulary if substituted in. So the list
// stays at two, and every other methodology canonical takes the archetype's
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
const ARCHETYPES = {
  product: {
    d1Default: "a consumer product",
    d2Default: "automation",
    title: (d1) => `Relaunching the one workflow people actually came for, in ${d1}.`,
    problem:
      "Sign-ups were healthy and use was not — roughly a third of licensed seats were active in any given week — and the support queue kept returning the same complaint: the core workflow took nine steps across four screens. The team wrote the problem down as one sentence, with the usage data and a year of in-product survey scores behind it, before anyone proposed a solution.",
    built: (d2) =>
      `A deliberately thin first slice, in front of a forty-account pilot rather than the whole base: nine steps collapsed to three, with ${d2} doing the unglamorous part — pre-filling what the system already knew and flagging the records a person would have skipped. Two features that tested badly with the pilot were cut before launch instead of shipped and defended.`,
    ranWith: (m) =>
      `${m}: two-week sprints, a backlog the owner ranked and defended personally, a demo every second Friday with real users in the room, and a written decision log so settled trade-offs stayed settled. Shipping moved off the quarterly release train onto the same fortnightly cadence, which is what made the rest of it possible.`,
    ranWithout:
      "One cross-functional team on a two-week cadence — design, engineering, support and the owner in the same room — with a backlog the owner ranked and defended personally and a written decision log so settled trade-offs stayed settled. Shipping moved off the quarterly release train onto the same fortnightly cadence, which is what made the rest of it possible.",
    landed:
      "Measured against numbers that existed before the work started, not ones found afterwards: the same in-product survey ran through the whole thing, so the satisfaction change is a comparison rather than a claim. The owner can also say what did not move — session length was flat and the mobile pilot slipped a quarter — which is what makes the rest of it credible in the room.",
    outcomes: [
      { metric: "adoption rate", figure: "31% → 68% of licensed seats active weekly" },
      { metric: "user satisfaction / NPS", figure: "in-product NPS +12 → +41" },
      { metric: "time-to-ship", figure: "median idea-to-production 11 weeks → 4" },
    ],
  },

  data: {
    d1Default: "analytics",
    d2Default: "the model",
    title: (d1) => `Taking a model from a notebook nobody trusted to a decision the business runs on, in ${d1}.`,
    problem:
      "A ranking model built the year before was still living in a notebook: it scored well offline, nobody could reproduce last month's numbers, and the two teams downstream had quietly gone back to a hand-maintained spreadsheet. The first week went to reproducing the existing baseline exactly, so there was an honest number to beat.",
    built: (d2) =>
      `A retraining pipeline that runs on a schedule instead of on a laptop: features versioned, training data snapshotted per run, the nightly job widened from a sampled slice to every account, and every prediction traceable back to the exact model and inputs that produced it. Nothing was switched over until ${d2} had run behind a flag against the old spreadsheet, on live traffic, for six weeks.`,
    ranWith: (m) =>
      `${m}: two-week increments against a backlog written as questions the business had actually asked, a demo of real predictions on real data at the end of each, and a kill criterion agreed up front — if the lift held under a month of live traffic it shipped, and if it did not the spreadsheet stayed.`,
    ranWithout:
      "Two-week increments against a backlog written as questions the business had actually asked, a demo of real predictions on real data at the end of each, and a kill criterion agreed up front — if the lift held under a month of live traffic it shipped, and if it did not the spreadsheet stayed.",
    landed:
      "The comparison was against the honest baseline rather than against nothing. Two of the five features that looked strongest offline turned out to leak future information and were removed, which cost about a third of the headline lift and was reported that way.",
    outcomes: [
      { metric: "model accuracy improvement", figure: "precision@10 0.42 → 0.61 on live traffic" },
      { metric: "data volume processed", figure: "1.8M records a night, up from a 240k sample" },
      { metric: "pipeline runtime reduction", figure: "nightly run 6h 20m → 48m" },
    ],
  },

  infra: {
    d1Default: "platform engineering",
    d2Default: "the new service tier",
    // {D2} here is the subject of "rolled out region by region behind a
    // flag" — a sentence about a service tier, not about an actor doing
    // work, so it cannot safely hold a posting's capability the way the
    // TECH_TERMS allowlist assumes (see that list's comment, which is a
    // per-SENTENCE justification, not a global one). Always use d2Default.
    capabilityFromPosting: false,
    title: (d1) => `Surviving the peak day without a war room, in ${d1}.`,
    problem:
      "The busiest hour of the month timed out every time it came round, the on-call rotation had burned through two engineers in a quarter, and nobody could say which of the seven services was the actual cause because the traces stopped at the gateway. Tracing came first — a fortnight of instrumentation before a single optimisation — because the team refused to tune what it could not measure.",
    built: (d2) =>
      `The two hot paths moved off synchronous fan-out onto a queue with backpressure, the read path was cached against an explicit invalidation contract rather than a guessed expiry, and ${d2} rolled out region by region behind a flag with an automatic rollback on error rate. Load tests reproduced the peak day at three times its real volume before any of it went live.`,
    ranWith: (m) =>
      `${m}: weekly increments, one migration per increment, and a standing rule that nothing shipped without the dashboard that would prove or disprove it. Every rollout carried a written rollback plan, and two of them were used.`,
    ranWithout:
      "Weekly increments, one migration per increment, and a standing rule that nothing shipped without the dashboard that would prove or disprove it. Every rollout carried a written rollback plan, and two of them were used.",
    landed:
      "The peak day passed without a war room for the first time in three years. The team is equally clear on what it did not fix — the legacy reporting job still runs for six hours overnight — and on how much of the latency win came from caching rather than from anything architectural.",
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
      "Pipeline looked healthy and the close rate did not: about one in nine qualified opportunities converted, and the average deal sat for five weeks between the demo and the security review with nobody owning it. Six months of closed-lost notes were read and coded by hand before anything was changed.",
    built: (d2) =>
      `The two dead stages got an owner, a service-level target and a shared checklist; the security review moved to a standard packet sent before the demo instead of after it; and ${d2} flagged the accounts matching the profile of past wins, so effort stopped being spread evenly across a list.`,
    ranWith: (m) =>
      `${m}: a two-week cycle with a pipeline review at the end of each, one experiment at a time so the effect of every change stayed attributable, and a written record of what was kept and what was reverted.`,
    ranWithout:
      "A two-week cycle with a pipeline review at the end of each, one experiment at a time so the effect of every change stayed attributable, and a written record of what was kept and what was reverted.",
    landed:
      "Attribution was kept honest: the same three quarters carried a pricing change, and the analysis separates the two instead of claiming all of it. The enterprise segment did not move at all, and that is stated up front.",
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
      "First response averaged nineteen hours and the backlog grew every Monday. Three months of tickets were sampled and tagged by hand, and roughly forty per cent of them turned out to be four recurring product defects plus a password-reset flow nobody could find — a product problem being absorbed as a staffing problem.",
    built: (d2) =>
      `The four defects were escalated with the ticket counts attached and fixed at source; the reset flow moved to the page people actually landed on; and ${d2} routed incoming tickets to the right queue and drafted a first reply for the top intents, with a person approving every send.`,
    ranWith: (m) =>
      `${m}: weekly increments run jointly by support and engineering, one intent at a time, and a standing review of the tickets the routing got wrong — the misroutes set the next increment's backlog.`,
    ranWithout:
      "Weekly increments run jointly by support and engineering, one intent at a time, and a standing review of the tickets the routing got wrong — the misroutes set the next increment's backlog.",
    landed:
      "The wins from deflection are reported separately from the wins from faster handling, because they are different achievements. Volume during the two peak weeks of the year did not improve at all.",
    outcomes: [
      { metric: "resolution time", figure: "first response 19h → 3h, full resolution 4.1 days → 1.6" },
      { metric: "customer satisfaction score", figure: "CSAT 3.4 → 4.5 out of 5" },
      { metric: "ticket volume handled", figure: "1,450 tickets a month, down from 2,100, at the same headcount" },
    ],
  },

  security: {
    d1Default: "security and compliance",
    d2Default: "automated policy checks",
    // {D2} here is the subject of "ran in the deployment pipeline" — again
    // an artifact being described, not an actor doing work, so it has the
    // same problem as infra's slot above. Always use d2Default.
    capabilityFromPosting: false,
    title: (d1) => `Getting through a real audit without a three-week fire drill, in ${d1}.`,
    problem:
      "The last audit had taken three weeks of evidence-gathering by hand, and two of its findings were repeats from the year before. An inventory came first: every system holding regulated data, who owned it, and which control was meant to cover it — twenty-three systems, eleven of them with no named owner.",
    built: (d2) =>
      `Access reviews moved from a quarterly spreadsheet to an automated report each owner signs, secrets moved out of configuration files into a managed store with rotation, and ${d2} ran in the deployment pipeline — blocking on the small set of rules that had actually produced findings rather than on every rule available.`,
    ranWith: (m) =>
      `${m}: one control per two-week increment, each with the evidence artifact it would produce written down before the work started, so the audit trail became a by-product of the work instead of a project of its own.`,
    ranWithout:
      "One control per two-week increment, each with the evidence artifact it would produce written down before the work started, so the audit trail became a by-product of the work instead of a project of its own.",
    landed:
      'The measure is the audit result and the near-misses caught before they became incidents, never "no breach happened" — an absence is not evidence of a control. One finding did repeat, and the owner says why.',
    outcomes: [
      { metric: "incidents prevented", figure: "17 credential leaks caught pre-merge in six months" },
      { metric: "audit / compliance pass rate", figure: "passed with 1 finding, down from 6" },
      { metric: "evidence-gathering time", figure: "3 weeks of manual evidence gathering → 2 days" },
    ],
  },

  generic: {
    d1Default: "the core of the business",
    d2Default: "a small amount of automation",
    title: (d1) =>
      `Owning one problem end to end in ${d1}, from a written problem statement to the number that proved it worked.`,
    problem:
      "The work that mattered most was the work nobody could see: a process running on three spreadsheets and one person's memory, costing about six hours a week in each of the teams that ran it and failing silently whenever that person was away. It was written up with a week of timings behind it before any fix was proposed.",
    built: (d2) =>
      `The process was rebuilt as one owned system with a single source of truth, the manual steps that could not be removed were made visible instead of invisible, and ${d2} took the repetitive middle so the judgement calls stayed with a person. A pilot ran with two teams for a month before anyone else was moved onto it.`,
    ranWith: (m) =>
      `${m}: two-week increments with something usable at the end of each, a backlog ordered by the cost of the problem rather than by who asked loudest, and a short written record of every trade-off so the same argument was not had twice.`,
    ranWithout:
      "Two-week increments with something usable at the end of each, a backlog ordered by the cost of the problem rather than by who asked loudest, and a short written record of every trade-off so the same argument was not had twice.",
    landed:
      "Baselined before the work started, measured the same way afterwards, and reported with the part that did not work included — one of the teams that moved onto it went back to the old process, and the reason is part of the story.",
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
      { label: "The problem", body: archetype.problem },
      { label: "What they built", body: archetype.built(d2) },
      { label: "How it ran", body: m ? archetype.ranWith(m) : archetype.ranWithout },
      { label: "How it landed", body: archetype.landed },
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
