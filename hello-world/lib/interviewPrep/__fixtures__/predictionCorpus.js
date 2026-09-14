// A held-out adversarial corpus for K1-PROHIBITION (design-operate.r1.md
// §1b), built to close check-4b.r1.md's Q4 BLOCKER against
// lib/interviewPrep/prepParse.test.js (round 1):
//
//   "The root cause is structural: a test whose only inputs are its own
//   fixtures can always be satisfied by matching those fixtures."
//
// Round 1's ONLY K1-PROHIBITION fixtures were one literal mutant sentence
// and one "minimal paraphrase preserving 'panel'/'will...include'" -- so a
// build whose ENTIRE check was `/panel/i.test(text) &&
// /will most likely include/i.test(text)` (nothing else, no broader
// predicate) passed all 11 rows in the file, and the checker then fed that
// build four adversarial, cited, non-redirect prediction sentences never in
// the suite and every one SHIPPED (an O-15 violation).
//
// STRUCTURAL PREDICATE UNDER TEST, quoted verbatim from
// design-operate.r1.md §1b: the sentence/line containing a detected
// personal name must not match an interview-role/prediction predicate --
// "panel", "interview(er)?s?", "will (most likely |probably
// )?(include|meet|speak (with|to))", "your interviewer", "likely to
// (interview|meet|speak)", "hiring manager will" -- regardless of citation
// status. This is a CLAIM SHAPE ("this named person will be in your
// interview"), not two specific literal n-grams. PREDICTION_CORPUS below
// exercises SIX of those independent terms, mostly in isolation from one
// another and from "panel"+"will most likely include" together, so a build
// hardcoded to the ORIGINAL two-n-gram conjunction fails on sight of most
// of this file -- not because more fixtures were added, but because most
// of them share NEITHER of the two literal substrings the round-1 mutant
// and its one paraphrase shared.
//
// SEEDED with the checker's four passing sentences (check-4b.r1.md's Q4),
// verbatim: PREDICTION_CORPUS[0..3].
//
// HELD OUT. Two further members -- HELD_OUT_PREDICTIONS -- are
// DELIBERATELY NOT referenced by lib/interviewPrep/prepParse.test.js's own
// assertions. They exist so a later, independent pass (the step-6 verify
// seat, the step-9 sabotage pass, or a fresh 4b/9c check) can probe the
// SHIPPED normalizePack against sentences that never appeared in the
// visible test file's own it.each list -- a genuine held-out
// generalization check, which a fixture inside the visible suite cannot
// give by construction (passing the visible suite is necessary for any
// implementation this repo will ship, so the visible suite alone cannot
// distinguish "implements the predicate" from "was tuned to the visible
// suite"). This seat's own validation of that claim -- a private-scratch
// reference implementing design-operate.r1.md §1b's predicate literally,
// confirmed to classify all 10 members (8 visible + 2 held-out) correctly,
// against a counter-build tuned only to the 8 visible members that FAILS
// both held-out members -- is reported in 4b.r2.md, not re-executed here.
//
// Every `companyFact` pairs the SAME person/fact with ZERO terms from the
// predicate list above -- design-operate.r1.md §1b's own predicate refuses
// ANY sentence containing e.g. bare "interview" or "panel" regardless of
// context (a disclosed, accepted false-positive residual, not a defect
// this corpus's positive controls should trip), so every companyFact
// fixture below is written to avoid all six terms entirely, matching the
// existing COMPANY_FACT_SENTENCE idiom already in prepParse.test.js.

export const PREDICTION_CORPUS = [
  {
    term: "interview(er)?s?",
    label: "checker sentence 1 -- 'interviewing'",
    text: "You will likely be interviewing with Jane Doe, the VP of Engineering.",
    companyFact: "Jane Doe became VP of Engineering after ten years leading the platform team, per the company's about page.",
  },
  {
    term: "panel + interview(er)?s?",
    label: "checker sentence 2 -- 'interview panel'",
    text: "Expect to meet Jane Doe on your interview panel; she is the VP of Engineering.",
    companyFact: "Jane Doe holds an engineering degree and joined the company as VP of Engineering in 2022, according to her public bio.",
  },
  {
    term: "interview(er)?s?",
    label: "checker sentence 3 -- 'your interview'",
    text: "Jane Doe, the VP of Engineering, will probably lead your interview.",
    companyFact: "As VP of Engineering, Jane Doe manages a team of forty engineers across three time zones, per the leadership page.",
  },
  {
    term: "interview(er)?s?",
    label: "checker sentence 4 -- 'interviewers'",
    text: "Your interviewers will likely include Jane Doe, VP of Engineering.",
    companyFact: "Jane Doe co-founded the platform team and now serves as VP of Engineering, according to the company blog.",
  },
  {
    term: "will (most likely |probably )?(include|meet|speak (with|to))",
    label: "isolates 'will probably meet' -- no panel, no interview word",
    text: "The hiring team says you will probably meet Jane Doe, the VP of Engineering, during the on-site.",
    companyFact: "Jane Doe was named VP of Engineering last spring after running the platform team, according to the newsroom page.",
  },
  {
    term: "likely to (interview|meet|speak)",
    label: "isolates 'likely to meet' -- no panel, no will",
    text: "You are likely to meet Jane Doe, the VP of Engineering, at some point in the process.",
    companyFact: "Jane Doe previously ran the platform team before being promoted to VP of Engineering, per her public bio.",
  },
  {
    term: "hiring manager will",
    label: "isolates 'hiring manager will' -- no panel, no interview word",
    text: "The hiring manager will be Jane Doe, the VP of Engineering, for this role.",
    companyFact: "Jane Doe is credited with building the platform team from three people to forty, according to a company case study.",
  },
  {
    term: "panel (alone, no 'will...include')",
    label: "isolates 'panel' -- no will-phrase at all",
    text: "Jane Doe, the VP of Engineering, is expected to be on the panel for your final round.",
    companyFact: "Jane Doe earned a promotion to VP of Engineering after leading a major platform migration, per the company's timeline page.",
  },
];

// NOT imported by lib/interviewPrep/prepParse.test.js's own it.each list --
// see "HELD OUT" above.
export const HELD_OUT_PREDICTIONS = [
  {
    term: "interview(er)?s? -- 'will be interviewing'",
    label: "held out 1 -- no panel, 'will' present but not the (include|meet|speak) form",
    text: "Jane Doe, the VP of Engineering, will be interviewing candidates on your loop, according to the team page.",
    companyFact: "Jane Doe holds the VP of Engineering title and has led the platform team since 2021, per the company's staff directory.",
  },
  {
    term: "will (most likely |probably )?(include) -- no 'panel'",
    label: "held out 2 -- 'will most likely include' WITHOUT the word panel",
    text: "Your final-round schedule will most likely include time with Jane Doe, the VP of Engineering.",
    companyFact: "Jane Doe was profiled in the company's engineering blog as the VP who scaled the platform team threefold.",
  },
];
