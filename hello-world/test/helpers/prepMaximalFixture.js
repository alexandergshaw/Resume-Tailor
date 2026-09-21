// N50 / AC-N50.18(a): THE maximal state of the interview-prep panel, as ONE
// shared fixture. Every N50 test that says "maximal fixture" imports it from
// here, and so does the 8b render instrument (test/render/
// prepMaximal.render.test.js). Never re-state it locally: the whole point of
// AC-N50.18 is that the state nobody ever looked at gets assembled exactly
// once, and then looked at whole.
//
// Plain ES, no vitest import, so a render script or a probe can load it too.
// Every builder returns a FRESH object: a test that mutates what it gets (to
// build a variant) can never leak that mutation into the next test.
//
// It is tied to the real schema by its own self-check,
// test/helpers/prepMaximalFixture.test.js (plan.r2.md F-1): the real
// `normalizePack` must return this pack unchanged, and the real
// `completeSections` must list all four sections. When N49/N51 change the
// claim or provenance shape, that self-check goes RED here first -- which is
// its purpose -- and this file is updated in that chunk, so 8b never judges a
// state the app cannot produce.
//
// Domain shape, deliberately realistic: a staff frontend role at a payments
// company, four interview stages in the order a real loop runs them
// (recruiter screen, hiring manager, technical deep dive, team panel), each
// with three likely questions and a suggested answer the candidate will
// rehearse. One suggested answer is long-form model prose, because that is
// the one a truncation or a clamp would eat.

import { PREP_SECTION_REVISIONS_MAX } from "@/lib/interviewPrep/prepConstants.js";

/** The four sections, in SCHEMA order (prepContract / prepPack order) -- not
 *  the panel's display order, which N50 changes (AC-N50.6). */
export const PREP_SECTIONS = ["aboutYou", "whyRole", "askThem", "stages"];

const cite = (claimId) => ({ kind: "claim", claimId });

/** c1..c3 are ordinary https sources. cU's URL is one `safeExternalHref`
 *  refuses (AC-N43.7(b)): it resolves, but must render inert. cO is ORPHAN:
 *  a sourced claim cited nowhere, which is what makes the pack-level orphan
 *  notice render in its `partial` variant. */
export function maximalClaims() {
  return [
    {
      id: "c1",
      text: "Northwind Payments opened a Dublin engineering hub in March 2026.",
      sourceUrl: "https://news.example.com/northwind-dublin-hub",
    },
    {
      id: "c2",
      text: "Northwind moved its platform team to a weekly release train in 2025.",
      sourceUrl: "https://engineering.example.org/northwind-release-train",
    },
    {
      id: "c3",
      text: "Northwind reported eighteen percent year-over-year revenue growth.",
      sourceUrl: "https://investors.example.net/northwind-q2",
    },
    {
      id: "cU",
      text: "Northwind lists a hybrid schedule for its Dublin engineering roles.",
      sourceUrl: "javascript:alert(1)",
    },
    {
      id: "cO",
      text: "Northwind sponsors a regional accessibility conference every autumn.",
      sourceUrl: "https://events.example.com/northwind-a11y",
    },
  ];
}

const ABOUT_YOU_LINES = [
  "I lead frontend platform work, most recently a twelve-service migration to a shared design system.",
  "I owned the rollback plan for that migration and ran the one rollback we needed.",
  "Before that I built checkout flows used by several million shoppers a month.",
  "I mentor two engineers and run our frontend guild's monthly review.",
  "I am looking for a team where release cadence and accessibility are both first-class.",
];
const WHY_ROLE_LINES = [
  "Your platform team ships weekly, which is the cadence I have been building toward.",
  "The Dublin hub is growing, and I want to help set its frontend conventions early.",
  "Payments work rewards the careful rollback discipline I care about.",
  "The role pairs design-system ownership with product delivery, which is my strongest mix.",
];
const ASK_THEM_QUESTIONS = [
  "How does the platform team decide what goes into a weekly release?",
  "What does a successful first ninety days look like for this role?",
  "How are accessibility regressions caught before they ship?",
  "Which product surfaces does the Dublin hub own today?",
  "How do frontend and backend engineers share on-call?",
];
const LONG_SUGGESTED_ANSWER = [
  "Start with the shape of the problem rather than the tooling: twelve services, three of them sharing one database, and a design system nobody owned.",
  "Say what you owned personally, then what the team owned, so the interviewer can tell the two apart without asking.",
  "Name one decision you would make differently now, and say why, because a migration story with no regret in it reads as rehearsed.",
  "Close by connecting the work back to this team's weekly release train, which is the reason the story is relevant at all.",
].join(" ");
const STAGES = [
  {
    name: "Recruiter screen",
    questions: [
      "Walk me through your current role.",
      "Why are you looking to move now?",
      "What are your salary expectations?",
    ],
    recommendedAnswer: "Keep it to two minutes: the migration, the rollback you owned, and why weekly releases draw you here.",
  },
  {
    name: "Hiring manager interview",
    questions: [
      "Tell me about a project that went wrong.",
      "How do you prioritise platform work against product asks?",
      "How do you grow the engineers you mentor?",
    ],
    recommendedAnswer: LONG_SUGGESTED_ANSWER,
  },
  {
    name: "Technical deep dive",
    questions: [
      "Design a component library that twelve teams can adopt safely.",
      "How would you roll back a bad release in under ten minutes?",
      "How do you test for accessibility regressions?",
    ],
    recommendedAnswer: "Anchor on versioned packages, codemods for breaking changes, and a visual regression gate in CI.",
  },
  {
    name: "Team panel",
    questions: [
      "How do you disagree with a design decision?",
      "What does good code review look like to you?",
      "What would you want to change in your first month?",
    ],
    recommendedAnswer: "Give one concrete disagreement, how it was resolved, and what you would keep from it.",
  },
];

/** aboutYou 5 lines, whyRole 4, askThem 5, stages 4 x 3 questions. Every
 *  section has at least one cited line; EXACTLY ONE line (aboutYou line 2)
 *  cites the unsafe claim cU; cO is cited nowhere; every stage is cited
 *  (N43's one-marker-per-stage shape, on the stage name). */
export function maximalPack() {
  const aboutYouSupport = [cite("c1"), cite("cU"), cite("c1"), null, cite("c3")];
  const whyRoleSupport = [cite("c2"), cite("c1"), null, cite("c2")];
  const askThemSupport = [cite("c2"), cite("c3"), null, cite("c1"), null];
  return {
    version: 1,
    sections: {
      aboutYou: { answer: { lines: ABOUT_YOU_LINES.map((text, i) => ({ text, support: aboutYouSupport[i] })) } },
      whyRole: { answer: { lines: WHY_ROLE_LINES.map((text, i) => ({ text, support: whyRoleSupport[i] })) } },
      askThem: { questions: ASK_THEM_QUESTIONS.map((text, i) => ({ text, support: askThemSupport[i] })) },
      stages: {
        stages: STAGES.map((stage, i) => ({
          name: stage.name,
          questions: [...stage.questions],
          recommendedAnswer: stage.recommendedAnswer,
          support: cite(`c${(i % 3) + 1}`),
        })),
      },
    },
    claims: maximalClaims(),
  };
}

/** `PREP_SECTION_REVISIONS_MAX` revisions per section (imported, never
 *  hard-coded -- AC-N50.18(a)), newest live, so MAX - 1 are restorable per
 *  section and 4 x (MAX - 1) in the panel. Exactly ONE revision was itself
 *  created by a restore (aboutYou, from revision 3). The row shape is the GET
 *  route's list projection: metadata only, never a body (AC-UX.2). */
export function maximalRevisions() {
  const sectionRevisions = {};
  const liveRevisions = {};
  PREP_SECTIONS.forEach((section, s) => {
    const rows = [];
    for (let revision = PREP_SECTION_REVISIONS_MAX; revision >= 1; revision -= 1) {
      rows.push({
        revision,
        engine: revision % 3 === 0 ? "embedded" : "gemini",
        restoredFrom: section === "aboutYou" && revision === 7 ? 3 : null,
        createdAt: new Date(Date.UTC(2026, 8, revision, 9, s)).toISOString(),
      });
    }
    sectionRevisions[section] = rows;
    liveRevisions[section] = PREP_SECTION_REVISIONS_MAX;
  });
  return { sectionRevisions, liveRevisions };
}

/** The candidate's own name first, then three interviewer names. These are
 *  the stored trusted names (O-15's exemption list) -- the same list F-1
 *  hands to `normalizePack` and `maximalPanelProps` shows in the strip. */
export function maximalTrustedNames() {
  return ["Alex Shaw", "Priya Nair", "J. Okafor", "Dana Whitfield"];
}

const noop = () => {};

/** Props for `PrepPackPanel` in the maximal state. `transients` (default
 *  true) adds the two N53 transients AC-N50.18(a) requires: one section in
 *  progress (whyRole, a regenerate) and one waiting (askThem, a restore of
 *  version 4). `transients: false` gives the maximal IDLE state, where all
 *  four history disclosures render. `overrides` is spread last. */
export function maximalPanelProps(opts = {}, overrides = {}) {
  const { transients = true } = opts;
  const names = maximalTrustedNames();
  const { sectionRevisions, liveRevisions } = maximalRevisions();
  return {
    applicationId: "app-maximal",
    pack: maximalPack(),
    status: "ready",
    completeSections: [...PREP_SECTIONS],
    attemptsExhausted: false,
    candidateName: names[0],
    interviewerNames: names.slice(1),
    error: null,
    onDownloadLog: noop,
    onSaveNames: noop,
    generating: false,
    triggerMessage: "Interview prep isn't available right now. Nothing was generated — try again later.",
    onGenerateNow: noop,
    hasDescription: true,
    onRegenerateSection: noop,
    onRestoreRevision: noop,
    sectionRevisions,
    liveRevisions,
    sectionActivity: transients
      ? {
          whyRole: { state: "in-progress", kind: "generate", revision: null },
          askThem: { state: "queued", kind: "restore", revision: 4 },
        }
      : {},
    sectionOutcomes: {},
    wholePackQueued: false,
    ...overrides,
  };
}

/** The body `GET /api/interview-prep` returns for the maximal state. The
 *  `completeSections` list is hand-written; F-1 checks it against the real
 *  `completeSections(pack)` so this stub can never claim a section the real
 *  function would exclude. */
export function maximalGetResponse(overrides = {}) {
  const names = maximalTrustedNames();
  const { sectionRevisions, liveRevisions } = maximalRevisions();
  return {
    pack: maximalPack(),
    status: "ready",
    attemptsExhausted: false,
    completeSections: [...PREP_SECTIONS],
    events: [],
    candidateName: names[0],
    interviewerNames: names.slice(1),
    error: null,
    sectionRevisions,
    liveRevisions,
    ...overrides,
  };
}

/** Every pack-derived string, DERIVED from `maximalPack()` rather than
 *  re-stated, so a census built on it can never drift from the fixture.
 *    t1: answer lines, askThem questions, stage names, stage questions
 *    t2: suggested answers (N48 -- always visible, demoted type)
 *    claims: the text of every claim some item cites (c1..c3 and cU),
 *            each exactly once; the orphan cO is excluded by construction. */
export function maximalPackStrings() {
  const pack = maximalPack();
  const s = pack.sections;
  const t1 = [
    ...s.aboutYou.answer.lines.map((l) => l.text),
    ...s.whyRole.answer.lines.map((l) => l.text),
    ...s.askThem.questions.map((q) => q.text),
    ...s.stages.stages.map((st) => st.name),
    ...s.stages.stages.flatMap((st) => st.questions),
  ];
  const t2 = s.stages.stages.map((st) => st.recommendedAnswer);
  const cited = new Set(
    [
      ...s.aboutYou.answer.lines.map((l) => l.support),
      ...s.whyRole.answer.lines.map((l) => l.support),
      ...s.askThem.questions.map((q) => q.support),
      ...s.stages.stages.map((st) => st.support),
    ]
      .filter(Boolean)
      .map((support) => support.claimId),
  );
  const claims = pack.claims.filter((c) => cited.has(c.id)).map((c) => c.text);
  return { t1, t2, claims };
}
