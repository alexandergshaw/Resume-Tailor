// N143 fix round F1, M4 -- the matcher's quality table.
//
// selectPoolProject used to score raw significantTerms(question) overlap against
// competency + domain, with no filter and no stemming. With the threshold at 1
// that is wrong in BOTH directions, and the verify's probe table showed each:
//
//   FALSE MATCH ... a question's own scaffolding ("tell me about a time",
//                   "describe", "handle", "project", "problem") overlaps a
//                   generic tag ("project management", "problem solving"), so
//                   any behavioural question cleared the fit and an unrelated
//                   example was shown.
//   FALSE NO_MATCH  morphology: "teach" vs "teaching", "student" vs "students",
//                   "assess" vs "assessment" share no token, so an on-domain
//                   question missed its own entry and the card said no close
//                   example for a pool that had one.
//
// Every row below carries the OLD instrument's reading, re-derived here from
// the shared primitives (significantTerms / overlapScore) and not from the
// mechanism under test, so a row that is not a real reproduction of the defect
// fails its own control instead of passing for free. The numeric
// POOL_FIT_THRESHOLD is not retuned here: it stays owner-tunable and its final
// value is AC-N143-Q's (the Gemini-env probe).

import { describe, it, expect } from "vitest";
import { selectPoolProject, POOL_FIT_THRESHOLD } from "./projectExampleSelect.js";
import { significantTerms, overlapScore, INTERVIEW_SCAFFOLDING } from "./projectStories.js";

const entry = (competency, domain, title = "An invented example project") => ({
  competency,
  domain,
  title,
  bullets: ["Cut the backlog from 9 to 2", "Raised the pass rate 61% to 78%"],
  hypothetical: true,
});

// What the matcher did before this round, re-derived from the primitives.
const oldFit = (question, e) => overlapScore(significantTerms(question), `${e.competency} ${e.domain}`);
const oldBestFit = (question, pool) => Math.max(0, ...pool.map((e) => oldFit(question, e)));

const TEACHING = [
  entry("curriculum design", "K-12 teaching", "Rebuilt the fractions unit"),
  entry("student assessment", "formative assessment", "Replaced the end-of-unit test"),
  entry("classroom management", "middle school", "Reset the first six weeks"),
  entry("family communication", "parent engagement", "Weekly progress notes"),
  entry("differentiated instruction", "special education", "Tiered reading groups"),
];
const SRE = [
  entry("incident response", "SRE", "Rebuilt the paging rotation"),
  entry("capacity planning", "cloud infrastructure", "Forecast the quarter's load"),
  entry("release engineering", "CI CD", "Moved to trunk-based deploys"),
  entry("observability", "monitoring", "One dashboard per service"),
  entry("reliability", "error budgets", "Set the first SLOs"),
];
// The pool of a role whose tags are the generic words themselves -- the shape
// that turns scaffolding into a match.
const GENERIC = [
  entry("project management", "operations"),
  entry("problem solving", "general"),
  entry("situation awareness", "incident command"),
];

describe("FALSE MATCH rows -- scaffolding alone must not clear the fit", () => {
  const rows = [
    ["a project plus a problem", "Tell me about a time you handled a difficult project problem.", GENERIC],
    ["describe a project", "Describe a project you are proud of.", [entry("project management", "operations"), entry("project delivery", "PMO")]],
    ["a recent challenging situation", "Walk me through a recent challenging situation and how you handled it.", GENERIC],
    ["worked on a project", "Tell me about a time you worked on a project with a tight deadline.", [entry("project management", "operations")]],
  ];

  it.each(rows)("%s: the old matcher matched, the new one refuses", (_label, question, pool) => {
    // Control: this row really is the defect. The old overlap is non-zero, i.e.
    // clears the threshold of 1 on scaffolding alone.
    expect(oldBestFit(question, pool)).toBeGreaterThanOrEqual(POOL_FIT_THRESHOLD);
    const res = selectPoolProject(pool, { question });
    expect(res.outcome).toBe("no_match");
    expect(res.entry).toBeNull();
    expect(res.fitScore).toBeLessThan(POOL_FIT_THRESHOLD);
  });

  it("every INTERVIEW_SCAFFOLDING word, alone, fails to clear a tag made of that very word", () => {
    // The structural form of the rows above, over the whole shared list so a
    // word added to it later is covered without anyone editing this file.
    const words = [...INTERVIEW_SCAFFOLDING].filter((w) => w.length >= 4);
    expect(words.length).toBeGreaterThan(10);
    for (const word of words) {
      const pool = [entry(`${word} management`, word)];
      expect(selectPoolProject(pool, { question: word }).outcome, word).toBe("no_match");
    }
  });

  it("[positive control] a genuine subject word alone DOES clear a tag made of it", () => {
    // Without this the loop above could pass because the matcher refuses
    // everything.
    for (const word of ["curriculum", "migration", "triage", "teaching"]) {
      const pool = [entry(`${word} planning`, "general")];
      expect(selectPoolProject(pool, { question: word }).outcome, word).toBe("match");
    }
  });

  it("ordinary English / resume filler alone does not clear a tag made of it either", () => {
    const pool = [entry("years of experience", "role")];
    const question = "What would you do with your years of experience in this role?";
    expect(oldBestFit(question, pool)).toBeGreaterThanOrEqual(POOL_FIT_THRESHOLD);
    expect(selectPoolProject(pool, { question }).outcome).toBe("no_match");
  });

  it("a scaffolding-heavy question still finds its real subject (the filter removes noise, not signal)", () => {
    const question = "Tell me about a project where you redesigned the curriculum.";
    const pool = [entry("project management", "operations"), entry("curriculum design", "K-12 teaching")];
    // The old matcher tied the two on one shared word each and kept array order:
    // the wrong entry, first.
    expect(oldFit(question, pool[0])).toBe(1);
    expect(oldFit(question, pool[1])).toBe(1);
    const res = selectPoolProject(pool, { question });
    expect(res.outcome).toBe("match");
    expect(res.entry).toBe(pool[1]);
  });
});

describe("FALSE NO_MATCH rows -- an on-domain question must find its entry across word forms", () => {
  const rows = [
    ["teach / teaching", "How would you teach fractions to a struggling class?", TEACHING, "K-12 teaching"],
    ["students / student assessment", "How do you assess students' progress?", TEACHING, "formative assessment"],
    ["monitor / monitoring", "How do you monitor your services and set alerts?", SRE, "monitoring"],
    ["planned / planning", "How have you planned capacity for a launch?", SRE, "cloud infrastructure"],
    ["incidents / incident", "Tell me about the worst incidents you have run.", SRE, "SRE"],
  ];

  it.each(rows)("%s", (_label, question, pool, expectedDomain) => {
    // Control: the old matcher missed every one of these rows' stemmed pairs; the
    // two rows that already shared an exact word are asserted below as such.
    const res = selectPoolProject(pool, { question });
    expect(res.outcome).toBe("match");
    expect(res.entry.domain).toBe(expectedDomain);
    expect(res.fitScore).toBeGreaterThanOrEqual(POOL_FIT_THRESHOLD);
  });

  it("the two morphology rows the old matcher got wrong are real reproductions", () => {
    expect(oldBestFit("How would you teach fractions to a struggling class?", TEACHING)).toBe(0);
    expect(oldBestFit("How do you assess students' progress?", TEACHING)).toBe(0);
    expect(oldBestFit("How do you monitor your services and set alerts?", SRE)).toBe(0);
  });

  it("[no regression] a pair that already shared an exact word still matches", () => {
    const res = selectPoolProject(SRE, { question: "Tell me about an incident in production." });
    expect(res.outcome).toBe("match");
    expect(res.entry.competency).toBe("incident response");
  });

  it("scores the stems it shares: 'assess students' reaches student assessment on TWO, formative assessment on one", () => {
    const res = selectPoolProject(TEACHING, { question: "How do you assess students' progress?" });
    expect(res.entry.competency).toBe("student assessment");
    expect(res.fitScore).toBe(2);
  });

  it("keeps 'team' as a subject word (the same exception answerLocal.js makes), so a leadership question finds its tag", () => {
    const pool = [entry("team leadership", "engineering management")];
    const res = selectPoolProject(pool, { question: "Tell me about leading a team through a reorganisation." });
    expect(res.outcome).toBe("match");
    expect(res.fitScore).toBe(2);
  });
});

describe("the stemmer does not over-reach (words that merely look alike stay apart)", () => {
  const apart = [
    ["data", "database"],
    ["plan", "plant"],
    ["mark", "market"],
  ];
  it.each(apart)("%s does not match %s", (questionWord, tagWord) => {
    const pool = [entry(`${tagWord} work`, "general")];
    expect(selectPoolProject(pool, { question: `${questionWord}` }).outcome).toBe("no_match");
  });

  it("[positive control] and the genuinely related forms do meet", () => {
    const together = [
      ["teach", "teaching"],
      ["student", "students"],
      ["assess", "assessment"],
      ["migrate", "migration"],
      ["nurse", "nursing"],
      ["manager", "management"],
      ["designer", "design"],
      ["plan", "planning"],
    ];
    for (const [a, b] of together) {
      const pool = [entry(`${b} skills`, "general")];
      expect(selectPoolProject(pool, { question: a }).outcome, `${a} / ${b}`).toBe("match");
    }
  });
});

describe("the title breaks a tie but never makes a fit", () => {
  it("between equal tag fits, the entry whose title shares more with the question wins, whatever the order", () => {
    const question = "Tell me about a database incident you resolved.";
    const first = entry("incident response", "SRE", "Quarterly planning review");
    const second = entry("incident response", "operations", "Database failover drill");
    expect(selectPoolProject([first, second], { question }).entry).toBe(second);
    expect(selectPoolProject([second, first], { question }).entry).toBe(second);
  });

  it("[control] with no title evidence either way, array order still decides", () => {
    const question = "Tell me about an incident you resolved.";
    const first = entry("incident response", "SRE", "Alpha");
    const second = entry("incident response", "operations", "Beta");
    expect(selectPoolProject([first, second], { question }).entry).toBe(first);
    expect(selectPoolProject([second, first], { question }).entry).toBe(second);
  });

  it("a title that shares the question's words cannot lift a tag with no overlap over the threshold", () => {
    const stuffed = entry("curriculum design", "K-12 teaching", "Database incident response drill");
    const res = selectPoolProject([stuffed], { question: "Tell me about a database incident you resolved." });
    expect(res.outcome).toBe("no_match");
  });

  it("a tag fit outranks a better title fit", () => {
    const question = "Tell me about a database incident you resolved.";
    const tagFit = entry("incident response", "SRE", "Quarterly planning review");
    const titleFit = entry("curriculum design", "K-12 teaching", "Database incident drill");
    expect(selectPoolProject([titleFit, tagFit], { question }).entry).toBe(tagFit);
  });
});

describe("off-domain still refuses (the v1 failure stays closed)", () => {
  it("a teaching question against an SRE pool is no_match, with the near-miss score kept", () => {
    const res = selectPoolProject(SRE, { question: "Describe how you redesigned a curriculum unit for struggling students." });
    expect(res.outcome).toBe("no_match");
    expect(res.entry).toBeNull();
    expect(res.fitScore).toBe(0);
  });

  it("an SRE question against a teaching pool is no_match", () => {
    const res = selectPoolProject(TEACHING, { question: "Tell me about an incident you handled in production under pressure." });
    expect(res.outcome).toBe("no_match");
  });

  it("an empty question, or one made only of filler, matches nothing", () => {
    for (const question of ["", "   ", undefined, null, "Tell me about a time."]) {
      expect(selectPoolProject(SRE, { question }).outcome, String(question)).toBe("no_match");
    }
  });
});
