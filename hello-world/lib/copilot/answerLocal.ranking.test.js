// R-257: what `rankedExperienceLines` is allowed to count as relevance.
//
// THE DEFECT THIS FILE PINS, measured before the fix. The ranker scored a
// résumé line by counting how many of its `[a-z0-9]{3,}` tokens appear in the
// question, with NO filtering of ordinary English. Since the count is over the
// line's token OCCURRENCES, an ordinary word repeated three times in one line
// scored three:
//
//   question: "Tell me about a time you led an initiative without having
//              formal authority over the people involved."  (a real bank
//              question — BEHAVIORAL_TOPICS' "leadership" variant)
//   "Led the payments migration and cut p99 latency 40%…"   -> 5  (on "led", "the")
//   "Treasurer of the beekeeping club, ran the 2024 rota…"  -> 7  (on "the", "the", "the")
//
// The beekeeping line did not merely tie with the payments line, it BEAT it,
// on three occurrences of the word "the". A candidate asking about a payments
// rollout was handed their beekeeping club as the concrete example in their
// own generated answer.
//
// THE RULE, and why it is this rule and not one of the near misses:
//
//  - QUESTION-SIDE VOCABULARY FILTER, no threshold. A term may contribute to
//    the score only if it could DISTINGUISH one line from another: not
//    ordinary English/résumé filler (STOPWORDS) and not interview scaffolding
//    (INTERVIEW_SCAFFOLDING). That is the same vocabulary
//    projectStories.js's clearsHonestyGate uses, and the same shape
//    lib/experience/pageRanking.js's rankingQueryTerms already ships:
//    query-side only, because a line's term can only ever score if it is also
//    a question term, so filtering the line side too would be redundant.
//
//  - NOT STOPWORDS ALONE. Measured over 84 discriminable rows of real bank
//    questions x real profile fixtures, a stopword-only filter still put the
//    wrong line first twice, both on the word "time" — which is not a
//    stopword in anybody's list but is pure interview scaffolding. The
//    positive control below ("used Payments in production") is exactly that
//    case: "cutting deployment TIME by 40%" tied the payments bullet and won
//    on source order.
//
//  - NOT A THRESHOLD. clearsHonestyGate requires two distinctive terms (or
//    one that names a page title) before it will let the engine SPEAK a page
//    as the candidate's own. That is a refusal gate; this is an ordering
//    problem, and the two need opposite defaults. Ported here, a >= 2 floor
//    would have returned NOTHING on 45 of those same 84 rows — over half —
//    including every one-distinctive-term question like the payments case
//    above. "Refuses nothing, orders honestly" is pinned by its own case
//    below so a future threshold cannot be added silently.
//
//  - NOT resumeAnchor's bare-number filter, and not de-duplicating a line's
//    repeated matches. Both were measured over the same 84 rows and changed
//    the winning line on ZERO of them, so neither is added: an unevidenced
//    rule in a ranker is a rule nobody can maintain. (resumeAnchor needs its
//    number filter because it publishes a `matched` honesty flag off the
//    score; this function publishes no such claim.)
//
// `limit` IS DELIBERATELY LEFT AT 1 — see the last case in this file.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rankedExperienceLines, relevantExperienceLine } from "./answerLocal.js";

const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

// Real bank questions, verbatim from buildQuestionBank(posting, type) —
// Q_PAYMENTS is TECHNICAL_TEMPLATES[1] applied to a posting whose description
// names payments; Q_CONFLICT is BEHAVIORAL_TOPICS' "conflict" variant. Neither
// is hand-written for this file.
const Q_PAYMENTS =
  "Tell me about a time you used Payments in production. What trade-offs did you have to make?";
const Q_LEADERSHIP =
  "Tell me about a time you led an initiative without having formal authority over the people involved.";
const Q_CONFLICT = "Tell me about a time you disagreed with a coworker or manager. How did you handle it?";
const Q_KAFKA =
  "Tell me about a time you used Apache Kafka in production. What trade-offs did you have to make?";

// The three-line profile AC-bulletexpand.md §5.3 measures the defect on.
const AC_PROFILE = [
  "Led the payments migration and cut p99 latency 40% across four regions.",
  "Treasurer of the beekeeping club, ran the 2024 rota and grew the membership by 30%.",
  "Mentored three engineers and reduced onboarding time from six weeks to two.",
].join("\n");

// lib/copilot/resumeAnchor.test.js's RESUME, unchanged.
const RESUME = [
  "Experience",
  "Senior Software Engineer, Initech — Remote",
  "Jan 2021 – Present",
  "- Led a team of six engineers, cutting deployment time by 40%.",
  "- Built a payments migration platform serving 2M requests per day.",
  "Support Analyst, Acme Corp — Austin, TX",
  "Mar 2018 – Dec 2020",
  "- Managed customer escalations and improved response time by 25%.",
  "Skills: Python, Django, PostgreSQL, Docker",
].join("\n");

// lib/copilot/questionVocabulary.test.js's MATERIAL_WITH_WORKDAY, unchanged.
const KAFKA_MATERIAL = [
  "Senior Software Engineer, Mutual of Omaha",
  "Built React front ends over a Kafka event pipeline, with MongoDB and Postgres behind it.",
  "Cut the nightly reconciliation window from six hours to forty minutes.",
  "Owned the Workday integration for HR headcount reporting.",
].join("\n");

describe("rankedExperienceLines: ordinary English is not relevance (R-257)", () => {
  it("does not let a line win on repeated stopwords — the reported beekeeping defect", () => {
    // Before the fix this returned the beekeeping line at score 7, over the
    // payments line at 5, on nothing but three occurrences of "the".
    const top = rankedExperienceLines(AC_PROFILE, Q_LEADERSHIP, 3)[0];
    expect(top).toMatch(/payments migration/i);
    expect(top).not.toMatch(/beekeeping/i);
  });

  it("and the same profile through relevantExperienceLine, which is what the generator splices", () => {
    // relevantExperienceLine is rankedExperienceLines(..., 1)[0]; this is the
    // exact value draftAnswerLocal puts behind the Action beat's "e.g." — so
    // this is the assertion that the club stops being spoken aloud.
    expect(relevantExperienceLine(AC_PROFILE, Q_LEADERSHIP)).toMatch(/payments migration/i);
    expect(relevantExperienceLine(AC_PROFILE, Q_LEADERSHIP)).not.toMatch(/beekeeping/i);
  });

  it("does not let interview scaffolding win either — 'time' is not a stopword anywhere", () => {
    // THE CASE THAT RULES OUT A STOPWORDS-ONLY FIX. On a stopword-only filter
    // the two Initech bullets tie at 3 — one on "payments", the other on the
    // "time" in "cutting deployment time by 40%" — and the deployment bullet
    // wins on source order. Only dropping interview scaffolding separates them.
    const top = rankedExperienceLines(RESUME, Q_PAYMENTS, 3)[0];
    expect(top).toMatch(/payments migration platform/i);
    expect(top).not.toMatch(/deployment time/i);
  });

  it("does not answer a conflict question with an onboarding bullet on the word 'time'", () => {
    // No line in this profile is about disagreeing with a manager, so the
    // honest outcome is source order over the whole tied set. Before the fix
    // the onboarding line was PROMOTED above it on the single shared word
    // "time" — the "a time you…" of the question stem, not a subject.
    const ranked = rankedExperienceLines(AC_PROFILE, Q_CONFLICT, 3);
    expect(ranked[0]).not.toMatch(/onboarding time/i);
    expect(ranked[0]).not.toMatch(/beekeeping/i);
    expect(ranked[0]).toMatch(/payments migration/i);
  });

  it("still refuses nothing: a question with no distinctive overlap returns every usable line", () => {
    // THE GUARD AGAINST THE WRONG FIX. clearsHonestyGate's >= 2 floor, ported
    // here, would return [] for this question. Ranking is ordering, not
    // refusal — a caller asking for candidates must still get the candidates.
    const ranked = rankedExperienceLines(AC_PROFILE, Q_CONFLICT, 5);
    expect(ranked).toHaveLength(3);
  });

  it("still ranks on one distinctive term — no floor of two", () => {
    // "payments" is the ONLY distinctive term this question shares with the
    // winning line. A two-term floor would demote it to source order and hand
    // back the deployment bullet instead.
    const ranked = rankedExperienceLines(RESUME, Q_PAYMENTS, 5);
    expect(ranked[0]).toMatch(/payments migration platform/i);
    expect(ranked.length).toBeGreaterThan(1);
  });

  it("POSITIVE CONTROL: a question the old ranking already answered correctly still ranks the same", () => {
    // Green before the fix and green after. Without this, "the ranking got
    // stricter" and "the ranking got better" are indistinguishable.
    expect(rankedExperienceLines(KAFKA_MATERIAL, Q_KAFKA, 3)[0]).toMatch(/kafka event pipeline/i);
  });

  it("orders differently for different questions over one profile", () => {
    // The measured symptom was that the ranked inventory was byte-identical
    // across unrelated questions. Two real bank questions, one profile, two
    // different winners.
    const onPayments = rankedExperienceLines(RESUME, Q_PAYMENTS, 3);
    const onEscalations = rankedExperienceLines(
      RESUME,
      "Tell me about a time you had to debug a hard problem in production. How did you track it down?",
      3,
    );
    expect(onPayments[0]).toMatch(/payments migration platform/i);
    expect(onPayments).not.toEqual(onEscalations);
  });

  it("is unchanged for an empty profile or an empty question", () => {
    expect(rankedExperienceLines("", Q_PAYMENTS, 3)).toEqual([]);
    // Every question term is filtered out, so nothing scores on overlap and
    // the "has a verb or a metric" signal alone decides — source order.
    expect(rankedExperienceLines(AC_PROFILE, "", 3)).toHaveLength(3);
    expect(rankedExperienceLines(AC_PROFILE, "Tell me about a time.", 3)).toHaveLength(3);
  });
});

describe("the distinctive-term vocabulary is shared, not a fourth copy", () => {
  // The same guarantee significantTerms.shared.test.js makes for the
  // tokenizer: the risk is not a loud break, it is a private copy that drifts
  // from clearsHonestyGate's while every test stays green.
  it("answerLocal imports INTERVIEW_SCAFFOLDING rather than redefining it", () => {
    const src = read("lib/copilot/answerLocal.js");
    expect(src).toMatch(
      /import\s*\{[^}]*INTERVIEW_SCAFFOLDING[^}]*\}\s*from\s*["'][^"']*projectStories/,
    );
    expect(src).not.toMatch(/const\s+INTERVIEW_SCAFFOLDING\s*=/);
  });

  it("projectStories still uses the exported set for its own honesty gate", () => {
    const src = read("lib/copilot/projectStories.js");
    expect(src).toMatch(/export const INTERVIEW_SCAFFOLDING\b/);
    expect(src).toMatch(/INTERVIEW_SCAFFOLDING\.has\(term\)/);
  });
});

// R-257-BLOCKER: stopwords.json is two lists concatenated — a classic
// English stoplist, then a job-posting-boilerplate TAIL ("role", "team",
// "teams", "new", "build", …) meant for stripping ATS filler out of a job
// DESCRIPTION. R-257 above filters the QUESTION through that same list, and
// "team"/"teams" are exactly the subject of a delegation/leadership
// question, not filler in it. Verbatim buildQuestionBank questions
// (practiceQuestions.js) over the verbatim answerLocal.test.js PROFILE,
// measured: with the full tail in RANKING_STOPWORDS, both lose the real
// "led a team of five engineers" line to the unrelated platform bullet,
// purely because "team" no longer counts as an overlap term.
const TEAM_PROFILE = [
  "Senior Software Engineer, Acme Corp — Remote",
  "Jan 2020 – Present",
  "Built and scaled a React and Node.js platform serving 2M users, cutting latency by 40%.",
  "Led a team of five engineers.",
  "Skills: React, Node.js, TypeScript, PostgreSQL, AWS, Kubernetes",
].join("\n");

describe("rankedExperienceLines: 'team' is a subject, not job-posting filler (R-257 blocker)", () => {
  it("answers a delegation question with the team line, not the platform line", () => {
    // practiceQuestions.js:296, LEADERSHIP_TOPICS "delegate" variant 2 — a
    // real bank question, not hand-written for this file.
    const q =
      "Describe a situation where you delegated a high-stakes task to someone on your team.";
    expect(relevantExperienceLine(TEAM_PROFILE, q)).toMatch(/led a team of five engineers/i);
  });

  it("answers an influence question with the team line, not the platform line", () => {
    // practiceQuestions.js:101, BEHAVIORAL_TOPICS "leadership" variant 2.
    const q =
      "Describe a situation where you had to influence a team or project you weren't officially in charge of.";
    expect(relevantExperienceLine(TEAM_PROFILE, q)).toMatch(/led a team of five engineers/i);
  });

  it("still demotes a cover-letter 'role' line — the measured improvement stays", () => {
    // TAIL_WORD_HISTOGRAM's "role" cases (8/8 improvements, verify report
    // B1): a motivation line must not out-rank real accomplishment just
    // because the question also says "role". "team"/"teams" are the only
    // words removed from the tail — "role" stays a stopword.
    const profile = [
      "- I am applying for this cloud infrastructure role because I want to grow my career.",
      "- Led a team of five engineers and cut deployment time by 40% across two regions.",
    ].join("\n");
    const q = "What excites you about this role and this team?";
    expect(relevantExperienceLine(profile, q)).toMatch(/cut deployment time/i);
    expect(relevantExperienceLine(profile, q)).not.toMatch(/applying for this/i);
  });

  it("still demotes a location line on 'new' — the measured improvement stays", () => {
    // TAIL_WORD_HISTOGRAM's "new" cases (2/2 improvements): a bare
    // date/location line must not out-rank real accomplishment just because
    // both it and the question say "new". "new" stays a stopword — only
    // "team"/"teams" were removed from the tail.
    const profile = [
      "New York, NY | 2018 - 2020",
      "Led the launch of a new product line, growing revenue by 20%.",
    ].join("\n");
    const q = "Tell me about a new product launch you led.";
    expect(relevantExperienceLine(profile, q)).toMatch(/launch of a new product line/i);
    expect(relevantExperienceLine(profile, q)).not.toMatch(/New York/i);
  });
});

describe("the `limit` default stays at 1 (R-257 ruling)", () => {
  // Investigated and deliberately NOT changed. Both call sites in the tree
  // pass an explicit limit — relevantExperienceLine passes 1, resumeAnchor
  // passes MAX_DESCRIPTION_CANDIDATES — so the default is dead for every
  // shipped caller and changing it would alter no observable behaviour and
  // could fail no test. The one consumer for which the default matters
  // (copilot bullet expansion, AC-bulletexpand.md BE13.2) is required by its
  // own AC to pin its pool size at its own call site; §5.3 of that document
  // states that pinning `limit` "buys the first, not the second" of what it
  // needs from this task, and what it needs from THIS task is the ordering
  // fixed above. Widening the default here would instead change what every
  // future caller silently gets, which is the same class of defect.
  it("returns exactly one line when no limit is given", () => {
    expect(rankedExperienceLines(RESUME, Q_PAYMENTS)).toHaveLength(1);
  });

  it("and relevantExperienceLine can never disagree with rankedExperienceLines' first entry", () => {
    for (const q of [Q_PAYMENTS, Q_CONFLICT, Q_KAFKA]) {
      for (const p of [AC_PROFILE, RESUME, KAFKA_MATERIAL]) {
        expect(relevantExperienceLine(p, q)).toBe(rankedExperienceLines(p, q, 3)[0] || "");
      }
    }
  });
});
