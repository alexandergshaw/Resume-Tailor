// N49/N51: THE snapshot-carrying prep pack, as one shared fixture -- the
// counterpart to test/helpers/prepMaximalFixture.js, which stays frozen.
//
// WHY A SEPARATE FILE AND NOT TWO MORE EXPORTS ON prepMaximalFixture.js
// (plan.r4.md section 8.8 put them there): `maximalPack()` is N50's frozen
// fixture and plan.r4.md's own diff-control R29 exists because editing that
// file is exactly how the twelve N50 acceptance files drift without anything
// going red. Landing the research variants here means prepMaximalFixture.js
// is never opened at all during N49 -- a hash comparison, not a promise. It
// also keeps the file that N50's self-check (prepMaximalFixture.test.js)
// pins free of a shape that self-check does not yet know about.
// It sits under test/ for a second reason: lib/sourceScan/exportReachability
// scans app/ + lib/ + middleware.js only (that sweep's own header states the
// exclusion), so these exports cannot move an export-census row.
//
// WHAT THIS FIXTURE IS NOT. It is a PANEL fixture. PrepPackPanel is a pure,
// already-fed renderer, so this is the shape the GET route serves after
// `normalizePack` has run -- it has NOT been round-tripped through the real
// `normalizePack`, because at the time these tests were written that function
// cannot yet produce a snapshot pack. Pinning the normalize contract is
// T12/T13's job (prepParse.research.test.js, the idempotency property), and
// the fixture rows below are built to design.r3.md section 5.1's Pack
// contract, key for key, so the two meet. If the shipped normalizer ends up
// producing a different shape, THIS FILE is what changes -- not the
// assertions, which read the fixture's own data rather than restating it.
//
// DOMAIN SHAPE. The same staff-frontend-at-a-payments-company scenario as the
// maximal fixture, so a reader comparing the two is comparing one variable.
// Four stages in the order a real loop runs them; interviewer TITLES and TEAM
// names only, never a person -- which is N51's whole point and is why the
// role rows below are things like "Talent Acquisition Partner" and "the
// Platform team". One stage carries `rolesDroppedCount: 2`, which is the case
// a candidate must be able to tell apart from "no titles were reported".
//
// EVERY LABEL KIND IS PRESENT, ON EVERY ITEM TYPE, INCLUDING THE ABSENT CASE.
// The census in PrepPackPanel.n49Frame.test.js derives its expectations from
// the arrays below rather than restating them, so the one thing this file
// must guarantee structurally is COVERAGE. Deliberate rows, each of which a
// plausible build gets wrong:
//   * stage 3 carries NO `provenance` key and NO `questionProvenance` key at
//     all. plan.r4.md finding 16: the first version of this fixture did not,
//     and mutant MZ-4 ("stageItemLabel returns an empty label for an item
//     with no provenance") SURVIVED. A missing key is the common case in the
//     field, and it must read "not sourced", never blank and never verified.
//   * stage 2's `questionProvenance` is SHORT (two entries, three questions).
//     A reader indexes by position; the missing entry must fail toward
//     POSSIBLE (design.r3.md section 5.1's alignment invariant).
//   * one question cites src [0, 2], two sources on the SAME publisher host.
//     Its label must read ONE source, not two: the count is of publishers,
//     not of rows. A build that counts `src.length` passes every other row.
//   * one role cites src [4], whose URL `safeExternalHref` refuses, while its
//     stored `publishers` claims 1. A stored count can be stale or forged;
//     the panel must still never build an anchor from that URL.
//   * stage 2 has a resolved `support` and an EMPTY `recommendedAnswer`, so
//     `stageSupportPlacement` returns "none" -- the case where N43's marker
//     is not drawn and the claim's text would otherwise vanish entirely
//     (plan.r4.md section 5.3, the M5 correction).
//
// Plain ES, no vitest import, so a probe or a render script can load it too.
// Every builder returns a FRESH object.

import { maximalPanelProps, maximalClaims } from "./prepMaximalFixture.js";
import { safeExternalHref } from "@/lib/url/safeExternalHref";
import { citationHost, servesGroundingRedirect } from "@/lib/tracking/citationHref";

/** The employer the research was attached for. `canonicalEmployer` of the
 *  posting's own company string (design.r3.md section 5.2). */
export const RESEARCH_EMPLOYER = "Northwind Payments";

/** ISO instant the research ran. The state line must show its YEAR -- a bare
 *  "18 September" on a pack researched two years ago is how a candidate walks
 *  into an interview on stale reporting. */
export const RESEARCHED_AT = "2026-09-18T11:20:00.000Z";

/** Snapshot sources. Index 0 and index 2 are the SAME publisher host, so a
 *  `src` naming both is ONE publisher. Index 4's URL is one
 *  `safeExternalHref` refuses; it is kept in the array because design.r3.md
 *  section 5.2 says URL usability is not structural -- a stored source whose
 *  URL now fails the gate stays and counts zero. */
export function researchSources() {
  return [
    { url: "https://news.example.com/northwind-hiring-loop", title: "Inside Northwind's hiring loop" },
    { url: "https://engineering.example.org/northwind-interviews", title: "What Northwind asks frontend candidates" },
    { url: "https://news.example.com/northwind-panel-notes", title: "Northwind panel notes" },
    { url: "https://careers.example.net/northwind-process", title: "Northwind careers: our process" },
    { url: "javascript:alert(1)" },
  ];
}

/** `provenance` objects, by the name the row table below refers to them by.
 *  `category` is derived from `publishers` at attach time (verified iff
 *  publishers >= VERIFIED_MIN_PUBLISHERS, which is 2) and is stored, so it is
 *  spelled out here exactly as a stored row would carry it. */
const P = {
  /** THREE source rows, TWO publishers: index 0 and index 2 are the same
   *  host. A label that prints `src.length` reads "Reported by 3 sources"
   *  here and is right everywhere else in this fixture -- measured: the
   *  mutant that makes that substitution SURVIVED the first version of this
   *  file, where every reported item happened to have as many rows as
   *  publishers. Do not "tidy" this back to a two-element src. */
  twoPublishers: () => ({ category: "verified", src: [0, 1, 2], publishers: 2 }),
  twoPublishersB: () => ({ category: "verified", src: [1, 3], publishers: 2 }),
  onePublisher: () => ({ category: "possible", src: [3], publishers: 1 }),
  /** Two sources, ONE publisher: news.example.com twice. */
  oneCollapsed: () => ({ category: "possible", src: [0, 2], publishers: 1 }),
  /** Stored count claims a publisher for a URL the href gate refuses. */
  oneUnsafe: () => ({ category: "possible", src: [4], publishers: 1 }),
  zero: () => ({ category: "possible", src: [], publishers: 0 }),
};

/** The four stages, as DATA, so the census reads the same strings the panel
 *  renders. `roles` absent on stage 3 is itself a row: a stage that reported
 *  no interviewer titles at all must not be confused with one whose titles
 *  were refused (that is `rolesDroppedCount`, on stage 1). */
const RESEARCH_STAGES = [
  {
    name: "Recruiter screen",
    provenance: P.twoPublishers,
    questions: [
      "Walk me through your current role.",
      "Why are you looking to move now?",
      "What are your salary expectations?",
    ],
    questionProvenance: [P.onePublisher, P.zero, P.oneCollapsed],
    roles: ["Recruiter", "Talent Acquisition Partner"],
    roleProvenance: [P.onePublisher, P.zero],
    recommendedAnswer: "Keep it to two minutes: the migration, the rollback you owned, and why weekly releases draw you here.",
    support: null,
    rolesDroppedCount: 0,
  },
  {
    name: "Hiring manager interview",
    provenance: P.onePublisher,
    questions: [
      "Tell me about a project that went wrong.",
      "How do you prioritise platform work against product asks?",
      "How do you grow the engineers you mentor?",
    ],
    questionProvenance: [P.twoPublishers, P.onePublisher, P.zero],
    roles: ["Engineering Manager"],
    roleProvenance: [P.twoPublishersB],
    recommendedAnswer: "Name one decision you would make differently now, and say why, because a migration story with no regret in it reads as rehearsed.",
    // A resolved claim AND a suggested answer: stageSupportPlacement -> "answer".
    support: { kind: "claim", claimId: "c1" },
    // Two reported titles the allow-list refused. The candidate must be able
    // to tell this stage from stage 3, which reported none at all.
    rolesDroppedCount: 2,
  },
  {
    name: "Technical deep dive",
    provenance: P.zero,
    questions: [
      "Design a component library that twelve teams can adopt safely.",
      "How would you roll back a bad release in under ten minutes?",
      "How do you test for accessibility regressions?",
    ],
    // SHORT on purpose: three questions, two entries. The third must fail
    // toward "not sourced".
    questionProvenance: [P.twoPublishers, P.onePublisher],
    roles: ["the Platform team", "Staff Engineer"],
    roleProvenance: [P.oneUnsafe, P.twoPublishersB],
    // Empty: with a resolved support this is stageSupportPlacement "none".
    recommendedAnswer: "",
    support: { kind: "claim", claimId: "c2" },
    rolesDroppedCount: 0,
  },
  {
    name: "Team panel",
    // NO provenance key, NO questionProvenance key, NO roles key. This is the
    // shape a stage the research never matched actually has.
    questions: [
      "How do you disagree with a design decision?",
      "What does good code review look like to you?",
      "What would you want to change in your first month?",
    ],
    recommendedAnswer: "Give one concrete disagreement, how it was resolved, and what you would keep from it.",
    support: null,
    rolesDroppedCount: 0,
  },
];

function buildStage(row) {
  const stage = {
    name: row.name,
    questions: [...row.questions],
    recommendedAnswer: row.recommendedAnswer,
    support: row.support,
    rolesDroppedCount: row.rolesDroppedCount,
  };
  if (row.provenance) stage.provenance = row.provenance();
  if (row.questionProvenance) stage.questionProvenance = row.questionProvenance.map((p) => p());
  if (row.roles) stage.roles = [...row.roles];
  if (row.roleProvenance) stage.roleProvenance = row.roleProvenance.map((p) => p());
  return stage;
}

/** The snapshot itself, design.r3.md section 5.1's `Snapshot`. `counts` are
 *  the attach-time record (AC-N49.18) and are what `researchStateOf` reads to
 *  choose its state: inSection and inLine are both non-zero and the live
 *  verified count is non-zero, so this pack's state is the corroborated one.
 *  `lines` carries the grammar rows the digest offered, which is what makes
 *  `rolesDropped: 2` meaningful rather than a free-floating integer. */
export function researchSnapshot(overrides = {}) {
  return {
    v: 1,
    origin: "research",
    researchedAt: RESEARCHED_AT,
    employer: RESEARCH_EMPLOYER,
    format: "structured",
    searched: true,
    textBlocks: 3,
    sources: researchSources(),
    lines: [
      { kind: "stage", stage: null, text: "Recruiter screen", src: [0, 1] },
      { kind: "role", stage: 0, text: "Recruiter", src: [3] },
      { kind: "question", stage: 0, text: "Why are you looking to move now?", src: [] },
      { kind: "stage", stage: null, text: "Hiring manager interview", src: [3] },
      { kind: "role", stage: 3, text: "Engineering Manager", src: [1, 3] },
    ],
    counts: {
      placed: 5,
      inSection: 5,
      inLine: 5,
      crossing: 0,
      lines: 5,
      linesWithSources: 4,
      orphanLines: 0,
      overlong: 0,
      budgetDropped: 0,
      rolesWithheld: 0,
      nameBearingLines: 0,
      itemsOffered: 7,
      itemsMatched: 5,
      rolesOffered: 5,
      rolesDropped: 2,
    },
    anomaly: null,
    ...overrides,
  };
}

/** A snapshot-carrying pack. `claims` is `maximalClaims()` unchanged, so the
 *  N43 apparatus this pack still carries is the same apparatus the frozen
 *  fixture carries -- the only variable between the two packs is the
 *  snapshot. */
export function maximalResearchPack(overrides = {}) {
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: [{ text: "I lead frontend platform work across twelve services.", support: { kind: "claim", claimId: "c1" } }] } },
      whyRole: { answer: { lines: [{ text: "Your platform team ships weekly, which is the cadence I have been building toward.", support: null }] } },
      askThem: { questions: [{ text: "How does the platform team decide what goes into a weekly release?", support: { kind: "claim", claimId: "c3" } }] },
      stages: {
        stages: RESEARCH_STAGES.map(buildStage),
        research: researchSnapshot(),
      },
    },
    claims: maximalClaims(),
    ...overrides,
  };
}

/** Panel props for the snapshot pack. Built from `maximalPanelProps` so every
 *  prop the panel reads arrives the way the real call site sends it, and only
 *  `pack` differs. `transients: false` gives the idle state. */
export function maximalResearchPanelProps(opts = {}, overrides = {}) {
  return maximalPanelProps({ transients: false, ...opts }, { pack: maximalResearchPack(), ...overrides });
}

/** Every labelled ITEM the snapshot pack contains, DERIVED from the stage
 *  rows above rather than restated, in the order a reader meets them: each
 *  stage's name, then its roles, then its questions. `provenance` is the
 *  stored object or `undefined` when the stage carries no key at all or the
 *  parallel array is short -- both of which must read "not sourced".
 *
 *  The census in PrepPackPanel.n49Frame.test.js walks THIS list. It is the
 *  one place the expected label of an item is decided, so a build cannot
 *  satisfy the census by labelling a subset: the list is exhaustive by
 *  construction over the same arrays the pack is built from.
 *
 *  NOTE the order claim is about this LIST, not about the DOM: nothing here
 *  asserts where the roles line sits relative to the questions. plan.r4.md
 *  section 9.3 calls that a design choice and hierarchyGuards.test.js:366
 *  does not constrain it, so the census matches on item TEXT, never on
 *  document order. */
export function researchItems() {
  const pack = maximalResearchPack();
  const stages = pack.sections.stages.stages;
  const items = [];
  stages.forEach((stage, si) => {
    items.push({ kind: "stage", stageIndex: si, index: 0, text: stage.name, provenance: stage.provenance });
    const roles = Array.isArray(stage.roles) ? stage.roles : [];
    roles.forEach((text, i) => {
      const list = Array.isArray(stage.roleProvenance) ? stage.roleProvenance : [];
      items.push({ kind: "role", stageIndex: si, index: i, text, provenance: list[i] });
    });
    stage.questions.forEach((text, i) => {
      const list = Array.isArray(stage.questionProvenance) ? stage.questionProvenance : [];
      items.push({ kind: "question", stageIndex: si, index: i, text, provenance: list[i] });
    });
  });
  return items;
}

// verify.r1.md B2: a SECOND, INDEPENDENT copy of the publisher-key merge
// (never imported from lib/interviewPrep/stageResearchView.js -- the module
// under test -- for the same self-consistency reason expectedKind's own
// header below gives for not asking stageItemLabel what it expects). Folds
// the AC-N49.7 table's regional/country mirrors into one key; an unlisted
// TLD stays its own market, which is what keeps this fixture's own
// example.com/.org/.net hosts three publishers apart rather than one.
const FIXTURE_COMMERCIAL_TLD_MARKET = new Set(["com", "co.uk", "ca", "com.au", "co.nz", "co.in", "com.br"]);

function fixturePublisherKey(host) {
  const labels = host.split(".");
  if (labels.length < 2) return host;
  const compound = labels.length >= 3 && ["co", "com"].includes(labels[labels.length - 2]);
  const tld = compound ? labels.slice(-2).join(".") : labels[labels.length - 1];
  const tldLabels = compound ? 2 : 1;
  const sld = labels[labels.length - tldLabels - 1] || labels[0];
  return `${sld}.${FIXTURE_COMMERCIAL_TLD_MARKET.has(tld) ? "com" : tld}`;
}

/** The count of DISTINCT, reachable, non-grounding-redirect publishers an
 *  item's `src` rows actually name, read against THIS fixture's own
 *  `researchSources()` -- independent of the panel/label logic under test. */
function fixtureVerifiedCount(provenance) {
  if (!provenance || typeof provenance !== "object" || !Array.isArray(provenance.src)) return 0;
  const sources = researchSources();
  const keys = new Set();
  for (const index of provenance.src) {
    const source = Number.isInteger(index) ? sources[index] : null;
    if (!source || typeof source.url !== "string") continue;
    const href = safeExternalHref(source.url);
    if (href === null) continue;
    const host = citationHost(href);
    if (host === null || servesGroundingRedirect(host, href)) continue;
    keys.add(fixturePublisherKey(host));
  }
  return keys.size;
}

/** The label KIND an item must carry, from its stored provenance -- design.r3.md
 *  section 8.1's table, restated here as the test's INDEPENDENT expectation.
 *  A stored count BELOW the "reported" threshold (0 or 1) is trusted as-is:
 *  that is not where AC-N49.6's over-claim risk sits, and stageItemLabel's
 *  own contract (see its header) leaves that boundary alone too. A stored
 *  count AT OR ABOVE the threshold is checked against the sources actually
 *  behind it (AC-N49.5.3, AC-N49.6, AC-N49.7) -- distinct, reachable,
 *  non-redirect publishers -- and the SMALLER of the two decides, so a
 *  stale or forged "reported" claim can only ever undersell.
 *
 *  It is deliberately NOT imported from the module under test. A census that
 *  asked `stageItemLabel` what it expected would be measuring the panel
 *  against the function the panel calls -- self-consistency, which survives
 *  any error that moves both together (the canary trap in loop-traps-tests).
 *  The cost of the duplication is that a legitimate rule change has to be
 *  made twice; that is the intended cost. */
export function expectedKind(provenance) {
  if (!provenance || typeof provenance !== "object") return "unsourced";
  const stored = provenance.publishers;
  if (!Number.isInteger(stored) || stored < 1) return "unsourced";
  if (stored < 2) return "single";
  const n = Math.min(stored, fixtureVerifiedCount(provenance));
  if (n >= 2) return "reported";
  return n === 1 ? "single" : "unsourced";
}
