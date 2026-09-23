// ---------------------------------------------------------------------------
// N51 TDD hand-off -- `admitRoleLabel`, the whole-label interviewer-title
// allow-list, and its MEASURED recall (plan.r4.md section 6 and its T8 row;
// AC-N51.2, AC-N51.3, AC-N51.6).
//
// THE DOMAIN PROBLEM THIS FILE IS ABOUT. A prep pack may say who conducts
// each interview stage. "Who" must be a JOB, never a PERSON: a candidate
// reading "Onsite with Sarah Chen" has been handed a named individual the app
// scraped off the open web and attributed to their interview, which is the
// O-15 failure this product has already shipped once. So the field is gated
// by a positive allow-list over the whole label -- every token must be role
// vocabulary -- rather than by "no name was detected", because a detector
// that misses "Sarah" is a detector that admits "Sarah".
//
// THE COST IS REAL AND THIS FILE IS WHERE IT IS MEASURED. A whole-label rule
// drops real job titles: every one of "React Engineer", "Barista",
// "Clinician" and "Senior Manager Application Development" fails it, and the
// last of those is the owner's own job. plan.r4.md section 6 measured 72.7%
// held-out and 41.7% on the owner's role family. The design's answer is not
// to widen the vocabulary until the number looks better -- that is how the
// N16 wave-G list leaked names -- but to DISCLOSE the drop on screen
// (`rolesDroppedCount`, row F-G of PrepPackPanel.n49Frame.test.js). This file
// holds the floor that stops the loss getting quietly worse.
//
// FAILURE DIRECTION, AND WHY THE TWO NUMBERS ARE NOT SYMMETRIC. A dropped
// title is a quality loss the candidate can see. An admitted name cannot be
// disclosed, undone or noticed. So: held-out keep >= 60% (a ratchet, not a
// target -- see that case for why the number is 60 and not the plan's 70),
// and must-refuse EXACTLY zero.
//
// RED ON HEAD: `lib/interviewPrep/interviewerRoles.js` does not exist. The
// dynamic import below is deliberate -- a static one would fail the whole
// file at collection time, reporting no `Tests` line at all, and a run with
// no test count is inconclusive rather than red. This way every case reports
// its own honest failure, and the moment the module lands the same cases run
// against the real exports with nothing edited.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  HELD_OUT_TITLES,
  MUST_PASS_TITLES,
  AUTHORED_TITLES,
  OWNER_ROLE_FAMILY,
  MUST_REFUSE_LABELS,
  STORED_NAMES,
} from "@/test/helpers/n49RoleCorpus.js";

let ROLES = null;
let ROLES_ERROR = null;
try {
  ROLES = await import("@/lib/interviewPrep/interviewerRoles.js");
} catch (err) {
  ROLES_ERROR = err;
}
let GRAMMAR = null;
let GRAMMAR_ERROR = null;
try {
  GRAMMAR = await import("@/lib/interviewPrep/interviewProcessGrammar.js");
} catch (err) {
  GRAMMAR_ERROR = err;
}

function roles() {
  if (!ROLES) throw new Error(`lib/interviewPrep/interviewerRoles.js is not written yet: ${ROLES_ERROR?.message}`);
  return ROLES;
}
function grammar() {
  if (!GRAMMAR) throw new Error(`lib/interviewPrep/interviewProcessGrammar.js is not written yet: ${GRAMMAR_ERROR?.message}`);
  return GRAMMAR;
}

/** Every rate this file reports is printed with its numerator, its
 *  denominator and EVERY dropped row by name. plan.r4.md section 6.2: "every
 *  dropped title is printed, never summarised" -- a percentage with no list
 *  behind it cannot be acted on, and the whole point of the disclosure is
 *  that somebody can look at what was lost and decide. */
function report(slice, results) {
  const kept = results.filter((r) => r.kept);
  const dropped = results.filter((r) => !r.kept);
  const rate = results.length === 0 ? 0 : kept.length / results.length;
  console.log(
    `[N51 recall] ${slice}: ${kept.length}/${results.length} = ${(rate * 100).toFixed(1)}%` +
      (dropped.length ? `\n  dropped: ${dropped.map((d) => JSON.stringify(d.label)).join(", ")}` : ""),
  );
  return { kept: kept.length, total: results.length, rate, dropped: dropped.map((d) => d.label) };
}

function measure(labels) {
  const { admitRoleLabel } = roles();
  return labels.map((label) => ({ label, result: admitRoleLabel(label), kept: admitRoleLabel(label) !== null }));
}

describe("the module exists and admits an ordinary interviewer title", () => {
  it("[positive control] admitRoleLabel(\"Hiring Manager\") returns the label unchanged", () => {
    // THE control for every rate below. A build that refuses everything has a
    // perfect must-refuse score and a zero keep rate; a build that admits
    // everything has a perfect keep rate and leaks every name. Neither can
    // pass this file, and this row is the first half of that pincer.
    expect(roles().admitRoleLabel("Hiring Manager")).toBe("Hiring Manager");
  });

  it("takes exactly one argument -- no storedNames, no citation (AC-N51.3 structural)", () => {
    // The exemption paths that admitted a name elsewhere in this product are
    // made IMPOSSIBLE here rather than forbidden: there is no parameter to
    // pass a trusted name or a citation through. An arity assertion is the
    // only instrument that can say that, because a screen that accepted and
    // ignored a second argument would pass every behavioural row below.
    expect(roles().admitRoleLabel.length).toBe(1);
  });

  it("returns null, not a throw, for every non-string and degenerate input", () => {
    const { admitRoleLabel } = roles();
    for (const value of [undefined, null, 0, 1, true, false, {}, [], () => {}, NaN, "", "   ", "\n"]) {
      expect(admitRoleLabel(value)).toBeNull();
    }
  });
});

describe("AC-N51.2 must-pass: every title the AC names is admitted", () => {
  // Not recall data. Each of these is a hard requirement, several of them
  // titles this repo's own name detector flags today (AC findings F4/F5), so
  // they are asserted individually rather than folded into a rate where two
  // could fail and the number still look fine.
  it.each(MUST_PASS_TITLES)("admits %s", (label) => {
    expect(roles().admitRoleLabel(label)).toBe(label);
  });
});

describe("AC-N51.3 must-refuse: a person's name is never admitted, in any position", () => {
  it.each(MUST_REFUSE_LABELS)("refuses %s (%s)", (label) => {
    expect(roles().admitRoleLabel(label)).toBeNull();
  });

  it("refuses all of them identically whether or not the candidate stored those names as interviewers", () => {
    // AC-N51.3 asks for the screen to be run once with an empty storedNames
    // and once with every name stored. With an arity-1 function there is no
    // way to pass them, which is the stronger answer -- so what this row
    // actually proves is that the result cannot depend on them: the same
    // call, made twice, with the stored list present in the test's scope and
    // reachable by nothing. Kept because the AC asks for it explicitly and
    // because a later signature change would have to delete this row rather
    // than silently satisfy it.
    const { admitRoleLabel } = roles();
    expect(STORED_NAMES.length).toBeGreaterThan(0);
    const first = MUST_REFUSE_LABELS.map(([label]) => admitRoleLabel(label));
    const second = MUST_REFUSE_LABELS.map(([label]) => admitRoleLabel(label));
    expect(first).toEqual(second);
    expect(first.every((r) => r === null)).toBe(true);
  });

  it("[leak census] reports zero admitted names across the whole must-refuse set", () => {
    const { admitRoleLabel } = roles();
    const leaks = MUST_REFUSE_LABELS.filter(([label]) => admitRoleLabel(label) !== null).map(([label]) => label);
    console.log(`[N51 must-refuse] ${MUST_REFUSE_LABELS.length - leaks.length}/${MUST_REFUSE_LABELS.length} refused`);
    expect(leaks).toEqual([]);
  });

  it("[control] refusal is not achieved by refusing everything -- the must-pass set is still admitted", () => {
    // The second half of the pincer. Without it, `admitRoleLabel = () => null`
    // passes every row in this describe block.
    const { admitRoleLabel } = roles();
    const admitted = MUST_PASS_TITLES.filter((label) => admitRoleLabel(label) !== null);
    expect(admitted.length).toBe(MUST_PASS_TITLES.length);
  });
});

describe("AC-N51.2 recall, measured on slices reported SEPARATELY", () => {
  it("HELD OUT (50 titles already in this repo, none written by this test): keep rate is at or above the 60% floor", () => {
    // The only slice carrying a floor, because it is the only one whose
    // strings the test author did not choose.
    //
    // THE FLOOR IS 60%, NOT THE 70% plan.r4.md SECTION 6.2 PROPOSED, and the
    // reason is a measurement, not a preference. That 70% was derived from
    // the plan's OWN 55-title harvest, which the same allow-list scored 72.7%
    // on. This is an independent 50-title harvest with its own root, filter
    // and selection rule (test/helpers/n49RoleCorpus.js states all three),
    // and the SAME build scores 64.0% on it -- measured, in a reference tree,
    // before this number was chosen. Applying 70% to a different denominator
    // would have handed the implementer a red test no correct build could
    // turn green, and the only way to reach it would be widening the
    // vocabulary, which AC-N51.2 forbids and D-P7 defers.
    //
    // 60% leaves two titles of margin on this slice. That is thin, and it is
    // deliberately thin: this is a ratchet against a regression that drops a
    // whole vocabulary class, not a quality target. The real protection
    // against the loss is that it is DISCLOSED on screen -- row F-G of
    // PrepPackPanel.n49Frame.test.js -- not that the number is high.
    //
    // It is a FLOOR, not a target. Raising the rate by adding name words to
    // the vocabulary is forbidden by AC-N51.2 and would be caught by the
    // must-refuse set above, which is why the two live in one file.
    expect(HELD_OUT_TITLES.length).toBeGreaterThanOrEqual(40);
    const stats = report("held-out", measure(HELD_OUT_TITLES.map(([label]) => label)));
    expect(stats.total).toBe(HELD_OUT_TITLES.length);
    expect(stats.rate).toBeGreaterThanOrEqual(0.6);
  });

  it("AUTHORED (interviewer titles written by this test): reported, with no floor and a stated bias", () => {
    // Reported because it is useful and separated because it is correlated
    // with the author's own expectations. No assertion on the rate: a floor
    // here would be a floor on how well the vocabulary matches the words the
    // person who wrote the vocabulary's tests happened to think of.
    const stats = report("authored", measure(AUTHORED_TITLES));
    expect(stats.total).toBe(AUTHORED_TITLES.length);
    // The one thing that IS asserted: the slice is non-degenerate. A slice
    // that silently emptied would report 0/0 = 0% and assert nothing.
    expect(stats.total).toBeGreaterThanOrEqual(25);
  });

  it("OWNER'S OWN ROLE FAMILY: reported in full, because it is the worst slice and the one that matters", () => {
    // plan.r4.md section 6 measured 5/12 here. No floor: this slice is 12
    // rows, so one title moving is 8 points, and a floor on it would be a
    // tripwire on noise. It is asserted to be NON-ZERO, because a build that
    // admits nothing a real mid-level manager could be called is a build
    // nobody should ship, and it is PRINTED in full so backlog B12 has its
    // evidence every time the suite runs.
    const stats = report("owner role family", measure(OWNER_ROLE_FAMILY));
    expect(stats.total).toBe(OWNER_ROLE_FAMILY.length);
    expect(stats.kept).toBeGreaterThan(0);
  });

  it("[canary] the harness can tell a kept title from a dropped one", () => {
    // A rate computed by a broken `measure` is the flattering failure here:
    // "kept: null !== null" is false for everything, and every slice reports
    // 0%, which reads as a recall problem rather than an instrument problem.
    // One row each way.
    const results = measure(["Hiring Manager", "Sarah Chen"]);
    expect(results.map((r) => r.kept)).toEqual([true, false]);
  });
});

describe("the shape rules the vocabulary rests on", () => {
  it("admits a label of role vocabulary and refuses one with a single foreign token", () => {
    // The whole-label property, stated as a contrast pair rather than as two
    // separate rows: "Director of Engineering" and "Director of Engineering
    // Ruiz" differ in exactly one token, and that token is what decides. A
    // rule that admitted on ANY vocabulary token -- the N16 wave-G shape --
    // passes the first and the second alike.
    const { admitRoleLabel } = roles();
    expect(admitRoleLabel("Director of Engineering")).toBe("Director of Engineering");
    expect(admitRoleLabel("Director of Engineering Ruiz")).toBeNull();
  });

  it("refuses a label carrying punctuation a job title does not use", () => {
    const { admitRoleLabel } = roles();
    for (const label of ["Recruiter: Emily", "Manager (Ops)", "Priya's team", "Recruiter?", "Recruiter!"]) {
      expect(admitRoleLabel(label)).toBeNull();
    }
  });

  it("refuses a label of level tokens alone, and a one-token name-shaped word", () => {
    // design.r3.md section 7.1 rules 6 and 8. "Dean" and "Art" are both
    // given names AND job nouns; alone they are far more likely to be the
    // former, so the whole-label rule refuses the one-token form while
    // "Associate Dean" and "Art Director" stay admitted (must-pass, above).
    const { admitRoleLabel } = roles();
    expect(admitRoleLabel("II")).toBeNull();
    expect(admitRoleLabel("L5")).toBeNull();
    expect(admitRoleLabel("Dean")).toBeNull();
    expect(admitRoleLabel("Art")).toBeNull();
    expect(admitRoleLabel("Associate Dean")).toBe("Associate Dean");
    expect(admitRoleLabel("Art Director")).toBe("Art Director");
  });

  it("caps the label's length and its token count", () => {
    const { admitRoleLabel } = roles();
    expect(admitRoleLabel("Senior Staff Principal Lead Director Manager Engineer Recruiter Partner")).toBeNull();
    expect(admitRoleLabel(`Recruiter ${"Manager ".repeat(20)}`.trim())).toBeNull();
  });

  it("is a FIXPOINT: re-admitting an admitted label returns it unchanged, with and without terminal punctuation", () => {
    // R2-M3. The label is stored and then re-screened on every read
    // (AC-N51.4), so a rule that normalises on the way in and then refuses
    // its own output silently empties the roles list on the second pass --
    // a defect that would show up as "the titles disappeared after a reload"
    // and nowhere in a single-pass test.
    const { admitRoleLabel } = roles();
    const { stripTerminal } = grammar();
    const admitted = [...MUST_PASS_TITLES, ...AUTHORED_TITLES, ...HELD_OUT_TITLES.map(([l]) => l)]
      .map((label) => admitRoleLabel(label))
      .filter((label) => label !== null);
    expect(admitted.length).toBeGreaterThan(20);
    const broken = admitted.filter((a) => admitRoleLabel(a) !== a || admitRoleLabel(stripTerminal(a)) !== a);
    expect(broken).toEqual([]);
  });

  it("strips a trailing run of dots and whitespace, which is how the grammar hands a title over", () => {
    // The digest grammar writes "  - Conducted by: Hiring Manager." -- the
    // sentence-final period belongs to the prose, not to the job.
    const { admitRoleLabel } = roles();
    expect(admitRoleLabel("Hiring Manager.")).toBe("Hiring Manager");
    expect(admitRoleLabel("Hiring Manager. ")).toBe("Hiring Manager");
    expect(admitRoleLabel("Hiring Manager..")).toBe("Hiring Manager");
  });
});

describe("isVocabularyPhrase / isVocabularyWord: the two predicates other modules screen with", () => {
  it("each takes exactly one argument and never throws", () => {
    const { isVocabularyPhrase, isVocabularyWord } = roles();
    expect(isVocabularyPhrase.length).toBe(1);
    expect(isVocabularyWord.length).toBe(1);
    for (const value of [undefined, null, 0, {}, [], ""]) {
      expect(isVocabularyPhrase(value)).toBe(false);
      expect(isVocabularyWord(value)).toBe(false);
    }
  });

  it("recognises role and stage vocabulary and rejects a surname", () => {
    // These two are what `employerExemption.js` and `prepParse.js` subtract
    // from the name detector's spans, so a phrase the detector flags as a
    // name but that is entirely vocabulary ("Recruiter Screen") is not
    // treated as a person. Getting this wrong in the permissive direction
    // subtracts real names; the contrast pair is the instrument.
    const { isVocabularyPhrase, isVocabularyWord } = roles();
    expect(isVocabularyPhrase("Recruiter Screen")).toBe(true);
    expect(isVocabularyPhrase("Hiring Manager")).toBe(true);
    expect(isVocabularyPhrase("Sarah Chen")).toBe(false);
    expect(isVocabularyPhrase("Hiring Chen")).toBe(false);
    expect(isVocabularyWord("recruiter")).toBe(true);
    expect(isVocabularyWord("Recruiter")).toBe(true);
    expect(isVocabularyWord("chen")).toBe(false);
    // Rule: a two-token phrase whose second token is dean/head is not a
    // vocabulary phrase, because "Art Head" and "Dean Head" are the shapes
    // that let a name through the subtraction.
    expect(isVocabularyPhrase("Art Head")).toBe(false);
    expect(isVocabularyWord("dean")).toBe(false);
    expect(isVocabularyWord("head")).toBe(false);
  });
});
