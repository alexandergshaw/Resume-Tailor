// AC-N3: the worked example is written fresh for each question by the model,
// instead of being picked from seven hand-authored archetypes.
//
// Reported: "the example projects are always this shit", with the same product
// story pasted back. That is not a copy problem, it is a structural one — seven
// templates cannot not repeat, and a candidate running twenty practice
// questions against one posting saw the identical project twenty times.
//
// What does NOT change is the safety story, and this file is where that is
// enforced. Everything R-130/R-135/R-138 established still holds, but the
// argument that used to carry it does not: "every figure is a hand-authored
// constant and buildProject never receives the posting text" was STRUCTURAL,
// and a model that reads the posting has neither property. So the guarantee
// moves from the generator to the validator below, and gets stricter:
//
//   - The deterministic archetypes remain, as the fallback. `normalizeIdealProject`
//     returns null for anything it cannot vouch for, and the caller falls back
//     rather than rendering a degraded example. There is no path where a
//     malformed model response reaches the screen.
//   - R-135's actual failure — the posting's salary band presented as a metric
//     — is now the model's most likely mistake rather than an impossible one,
//     because the posting IS in its context. N125 (owner ruling 2026-10) made
//     the rule COMPENSATION-SHAPED rather than "any digit run the posting
//     contains": a posting digit run is rejected only when it is adjacent to a
//     pay marker ($/€/£ immediately before, a /hr-style rate unit after, or a
//     salary/stipend/bonus/pay word in the number's own sentence or within a
//     short window of it). A figure echoing a
//     comp-shaped posting number (the salary band, an hourly rate, a stipend,
//     a signing bonus) is rejected AT ANY MAGNITUDE; an incidental non-comp
//     integer the posting merely happens to state (a headcount "team of 8", an
//     experience floor "5+ years", a "99.95%" uptime figure) is now ALLOWED to
//     recur in the example. That change is why the two headcount/floor cases in
//     the comp-shaped describe below assert `not.toBeNull` — a deliberate owner
//     inversion of the old blunt small-integer rejection, not a regression.
//   - The bounds the last round established (four labelled bullets, 12-28 words
//     each, 120 total) are imported from the archetype module rather than
//     restated, so a generated example and a templated one cannot drift into
//     being different shapes of thing.

import { describe, it, expect } from "vitest";

import {
  MAX_BODY_WORDS,
  MAX_TOTAL_WORDS,
  MIN_BODY_WORDS,
  SECTION_LABELS,
} from "./idealProjectNarrative.js";
import { buildIdealProjectPrompt, normalizeIdealProject } from "./idealProjectPrompt.js";

const POSTING = [
  "Senior Product Manager, Education Technology",
  "Salary range: $78,496.00 - $105,974.00 annually. Compensation: $78,496 - $105,974.",
  "This role supports 12 campuses and a team of 8.",
  "You will run Agile ceremonies and bring Artificial Intelligence into the classroom.",
  "Requirements: 5+ years of product management experience.",
].join("\n");

// A well-formed response, in the shape the prompt asks for.
function goodResponse(overrides = {}) {
  return {
    title: "Rebuilding the enrolment workflow teachers actually use, in Education.",
    sections: [
      { label: "Problem", body: "Two thirds of licensed teachers never returned after their first week, and the enrolment flow ran to seven screens." },
      { label: "Built", body: "A single-screen flow with the roster pre-filled from the student system, and an assistant that flagged incomplete records before submission." },
      { label: "Ran", body: "Two-week sprints with a teacher advisory group in every review, and a written decision log so settled trade-offs stayed settled." },
      { label: "Landed", body: "Baselined against the prior term and measured the same way after, including the part that did not move at all." },
    ],
    outcomes: [
      { metric: "adoption rate", figure: "34% → 71% of teachers active weekly" },
      { metric: "user satisfaction / NPS", figure: "teacher NPS +9 → +38" },
      { metric: "time-to-ship", figure: "median idea-to-production 9 weeks → 3" },
    ],
    ...overrides,
  };
}

describe("normalizeIdealProject — the shape it will vouch for", () => {
  it("accepts a well-formed example and returns it in the archetype's own shape", () => {
    const result = normalizeIdealProject(goodResponse(), { description: POSTING });
    expect(result).not.toBeNull();
    expect(result.sections.map((s) => s.label)).toEqual(SECTION_LABELS);
    expect(result.outcomes).toHaveLength(3);
    expect(typeof result.title).toBe("string");
  });

  it("rejects rather than repairs anything structurally wrong", () => {
    // Every one of these must return null so the caller falls back to a
    // deterministic archetype. A half-repaired example is worse than a
    // templated one: it is still on screen, still labelled as a benchmark, and
    // nothing downstream knows it was patched.
    const bad = [
      undefined,
      null,
      {},
      "a string",
      goodResponse({ title: "" }),
      goodResponse({ sections: [] }),
      goodResponse({ sections: goodResponse().sections.slice(0, 3) }),
      goodResponse({ outcomes: [] }),
      goodResponse({ outcomes: goodResponse().outcomes.slice(0, 2) }),
      goodResponse({ sections: "not an array" }),
      goodResponse({ outcomes: "not an array" }),
    ];
    for (const input of bad) {
      expect(normalizeIdealProject(input, { description: POSTING })).toBeNull();
    }
  });

  it("insists on the four labels, in order, whatever the model called them", () => {
    const renamed = goodResponse();
    renamed.sections[1].label = "What they built";
    expect(normalizeIdealProject(renamed, { description: POSTING })).toBeNull();

    const reordered = goodResponse();
    [reordered.sections[0], reordered.sections[1]] = [reordered.sections[1], reordered.sections[0]];
    expect(normalizeIdealProject(reordered, { description: POSTING })).toBeNull();
  });
});

describe("normalizeIdealProject — a COMPENSATION-SHAPED posting number can never come back (N125 comp-shaped rule, L6/L7)", () => {
  // N125 ruling: the old rule rejected ANY digit run the posting contained;
  // the new rule rejects only COMP-SHAPED ones (a run adjacent to a pay
  // marker). The four reject cases below each echo a comp-shaped posting
  // number and must still return null; the two accept cases echo an incidental
  // NON-comp integer and now return the example.
  //
  // RED/GREEN at hand-off (disclosed in the TDD notes): the two reject
  // describes are GREEN on HEAD too — the old blunt rule already rejected them
  // — and exist to KILL the "revert to ≥1000 magnitude" mutant (which would
  // let the sub-1000 $42/$950/$5 echoes through) and the "drop the guard"
  // mutant (which would let the salary band through). The two ACCEPT cases are
  // the ones that are RED on HEAD: the blunt rule rejects "8"/"3"/"5"/"99"/"95"
  // because they occur in the posting, so `not.toBeNull` fails until the
  // comp-shaped rule lands. Those are the ruled inversions of the old
  // idealProjectGenerated.test.js:123-129 assertions.

  // (a) R-135, pinned as its own case: the salary band, read straight back as
  // a budget figure. `$78,496` is comp-shaped in POSTING ("$" immediately
  // before, "Salary"/"Compensation"/"annually" in the window), so it is
  // rejected under BOTH the old and the new rule.
  it("rejects the R-135 salary-band echo (comp-shaped, $ before)", () => {
    const salary = goodResponse();
    salary.outcomes[0] = { metric: "adoption rate", figure: "$78,496 of budget recovered" };
    expect(normalizeIdealProject(salary, { description: POSTING })).toBeNull();
  });

  // (b)/(c)/(d) comp-shaped echoes BELOW the old ≥1000 magnitude line — $42/hr,
  // a $950 stipend, a $5k signing bonus. A magnitude-based rule would admit all
  // three (42, 950, 5 are each < 1000); the comp-shaped rule rejects them on
  // the pay marker. Each posting states exactly the comp-shaped number the
  // example then echoes, so the example falls back to the deterministic
  // archetype — the comp figure never reaches the screen.
  it("rejects a comp-shaped echo at any magnitude — $42/hr (rate unit after)", () => {
    const hourly = goodResponse();
    hourly.outcomes[0] = { metric: "adoption rate", figure: "cut average handle time to 42 seconds per case" };
    expect(normalizeIdealProject(hourly, { description: "Contract role. Pay is $42/hr for the duration." })).toBeNull();
  });

  it("rejects a comp-shaped echo at any magnitude — $950 stipend (comp word after)", () => {
    const stipend = goodResponse();
    stipend.outcomes[0] = { metric: "adoption rate", figure: "reduced manual steps from 950 to 20 per release" };
    expect(normalizeIdealProject(stipend, { description: "Includes a $950 stipend per month." })).toBeNull();
  });

  it("rejects a comp-shaped echo at any magnitude — $5k signing bonus (comp word after)", () => {
    const bonus = goodResponse();
    bonus.outcomes[0] = { metric: "adoption rate", figure: "grew the pilot from 5 to 40 teams in a quarter" };
    expect(normalizeIdealProject(bonus, { description: "We offer a $5k signing bonus on day one." })).toBeNull();
  });

  // N125 fresh-verify F1 (R-135, the hard floor): a CURRENCY-LESS salary whose
  // pay word sits further from the number than COMP_WINDOW characters. The
  // window-only rule passed every one of these, so an example echoing the
  // number put the posting's real pay on screen. The pay-word test is
  // SENTENCE-scoped now: a number is comp-shaped when the sentence (or line)
  // that encloses it carries a pay word, however many words apart. Each posting
  // below has no $/€/£ and no rate unit, so the sentence scope is the ONLY
  // thing that can reject it.
  describe.each([
    ["the pay word 'salary' is far before the number", "The annual salary for this position, after a probation period, is 95000 flat.", "95000"],
    ["the pay word 'Compensation' opens a long sentence", "Compensation for this role is extremely competitive, landing around 128000 depending.", "128000"],
    ["the pay word is the inflected 'pays'", "pays whatever the market dictates, roughly 140000 per the committee.", "140000"],
  ])("a currency-less salary where %s", (_label, sentence, figure) => {
    const description = `Senior Engineer, Platform\n${sentence}\nYou will join a small team.`;
    const echo = () => {
      const response = goodResponse();
      response.outcomes[0] = { metric: "adoption rate", figure: `cut the open backlog from ${figure} tickets to 2100 over two quarters` };
      return response;
    };

    it("rejects an example that echoes the number", () => {
      expect(normalizeIdealProject(echo(), { description })).toBeNull();
    });

    // Positive control: the SAME example against the SAME number is admitted
    // when the number's own sentence carries no pay word, so the rejection above
    // is the pay-word scope and nothing else about the example.
    it("admits the same example when the number sits in a sentence with no pay word", () => {
      const neutral = `Senior Engineer, Platform\nThe queue holds ${figure} tickets at peak. Compensation is competitive.\nYou will join a small team.`;
      expect(normalizeIdealProject(echo(), { description: neutral })).not.toBeNull();
    });
  });

  it("scopes the pay word to the SENTENCE: a pay-free sentence on the same line as a pay sentence still admits its number", () => {
    const response = goodResponse();
    response.outcomes[1] = { metric: "team size managed", figure: "a team of 8, up from 3" };
    expect(
      normalizeIdealProject(response, { description: "Our salary bands are published internally and reviewed yearly. A team of 8 ships weekly." }),
    ).not.toBeNull();
  });

  // The window stays as an INDEPENDENT catch, so a pay word that sits just
  // across a sentence or line break from its number is still read as pay.
  it("still rejects a number whose pay word is within the window but across a line break", () => {
    const response = goodResponse();
    response.outcomes[0] = { metric: "adoption rate", figure: "cut the open backlog from 95000 tickets to 2100 over two quarters" };
    expect(normalizeIdealProject(response, { description: "Salary:\n95000 and equity" })).toBeNull();
  });

  // Abbreviation periods do not end a sentence, or a title like "Sr." would
  // split the pay word away from its number.
  it("does not let an abbreviation period ('Sr.', 'e.g.') split a pay word from its number", () => {
    const response = goodResponse();
    response.outcomes[0] = { metric: "adoption rate", figure: "cut the open backlog from 95000 tickets to 2100 over two quarters" };
    for (const sentence of [
      "The salary for Sr. Engineers on this platform team is set well above 95000 for the first year.",
      "Our pay for senior hires, e.g. Principal Engineers on the platform team, starts at 95000 before review.",
    ]) {
      expect(normalizeIdealProject(response, { description: sentence })).toBeNull();
    }
  });

  // RULED INVERSION (N125 §4, owner-sanctioned): the old
  // idealProjectGenerated.test.js:123-129 asserted these two `toBeNull`. "8"
  // and "3" ("a team of 8, up from 3") sit beside "team of"/"up from" with no
  // pay marker, and "5" ("5+ years") beside "years", so none is comp-shaped in
  // POSTING — re-verified here against the SAME POSTING fixture R-135 uses, the
  // hinge of the inversion. On HEAD the blunt rule rejects them (RED); under
  // the comp-shaped rule they are admitted.
  it("ACCEPTS an incidental non-comp integer echo — a headcount and an experience floor the posting states", () => {
    const headcount = goodResponse();
    headcount.outcomes[1] = { metric: "team size managed", figure: "a team of 8, up from 3" };
    expect(normalizeIdealProject(headcount, { description: POSTING })).not.toBeNull();

    const floor = goodResponse();
    floor.sections[0].body =
      "Nobody on the team had the 5+ years the role called for, and the enrolment flow ran to seven screens each time.";
    expect(normalizeIdealProject(floor, { description: POSTING })).not.toBeNull();
  });

  // RULED INVERSION: a non-comp posting figure the example legitimately reuses.
  // "99.95%" is a reliability target, not pay — `%` is not a marker — so an
  // example quoting the same uptime figure is admitted. On HEAD the blunt rule
  // rejects it because "99"/"95" occur in the posting (RED).
  it("ACCEPTS an echo of a non-comp posting figure — a 99.95% uptime target", () => {
    const uptime = goodResponse();
    uptime.outcomes[1] = { metric: "uptime / reliability %", figure: "monthly availability 99.2% → 99.95% of the month" };
    expect(normalizeIdealProject(uptime, { description: "Our platform holds 99.95% uptime." })).not.toBeNull();
  });

  it("still allows ordinary numbers the posting does not contain", () => {
    // The guard must not become "no numbers at all" — the numbers are the
    // point. 34, 71, 9, 38 and 3 are absent from POSTING and must survive.
    expect(normalizeIdealProject(goodResponse(), { description: POSTING })).not.toBeNull();
  });

  // A digit run inside a longer number is not the same number: rejecting "9
  // weeks" because the posting said "$105,974" (which contains "9") would
  // reject essentially every example. The comp-shaped rule preserves this —
  // `$105,974` is comp ($ before, "pay"), yet "5+ years" is not, and neither
  // reaches the example here.
  it("matches whole numbers, not digits inside other numbers", () => {
    const result = normalizeIdealProject(goodResponse(), { description: "We pay $105,974 and want 5+ years." });
    expect(result).not.toBeNull();
  });
});

describe("normalizeIdealProject — the invariants the last two rounds established", () => {
  it("holds the generated example to the same length bounds as a templated one", () => {
    const long = goodResponse();
    long.sections[0].body = Array.from({ length: MAX_BODY_WORDS + 5 }, (_, i) => `word${i}`).join(" ") + ".";
    expect(normalizeIdealProject(long, { description: POSTING })).toBeNull();

    const short = goodResponse();
    short.sections[0].body = Array.from({ length: MIN_BODY_WORDS - 1 }, (_, i) => `word${i}`).join(" ") + ".";
    expect(normalizeIdealProject(short, { description: POSTING })).toBeNull();

    // The total is a separate bound, not a consequence of the per-body one:
    // four maximum-length bodies come to 112 words, under the 120 budget, and
    // only breach it once the title is counted too. So this case is built so
    // that EVERY body is individually legal — asserted, not assumed — which
    // leaves the total as the only thing that can reject it.
    const fat = goodResponse();
    for (const section of fat.sections) {
      section.body = Array.from({ length: MAX_BODY_WORDS }, (_, i) => `word${i}`).join(" ") + ".";
    }
    for (const section of fat.sections) {
      expect(section.body.trim().split(/\s+/).length).toBeLessThanOrEqual(MAX_BODY_WORDS);
      expect(section.body.trim().split(/\s+/).length).toBeGreaterThanOrEqual(MIN_BODY_WORDS);
    }
    expect([fat.title, ...fat.sections.map((s) => s.body)].join(" ").split(/\s+/).length).toBeGreaterThan(MAX_TOTAL_WORDS);
    expect(normalizeIdealProject(fat, { description: POSTING })).toBeNull();
  });

  it("rejects anything the candidate could read out as their own claim", () => {
    for (const firstPerson of ["I owned the rollout end to end and it landed on the date we committed to.", "Our team cut the flow from seven screens to one, and my own backlog drove it."]) {
      const claim = goodResponse();
      claim.sections[3].body = firstPerson;
      expect(normalizeIdealProject(claim, { description: POSTING })).toBeNull();
    }
  });

  it("insists every outcome names a category without a figure and a figure with one", () => {
    const digitInMetric = goodResponse();
    digitInMetric.outcomes[0].metric = "adoption rate in year 1";
    expect(normalizeIdealProject(digitInMetric, { description: POSTING })).toBeNull();

    const noDigitInFigure = goodResponse();
    noDigitInFigure.outcomes[0].figure = "a big improvement over the prior term";
    expect(normalizeIdealProject(noDigitInFigure, { description: POSTING })).toBeNull();
  });

  it("rejects leftover template tokens and stringified junk", () => {
    for (const junk of ["Rebuilding the {D1} workflow, in Education.", "Rebuilding undefined, in Education.", "Rebuilding [object Object], in Education."]) {
      expect(normalizeIdealProject(goodResponse({ title: junk }), { description: POSTING })).toBeNull();
    }
  });

  it("is pure — it never mutates the response it was handed", () => {
    const input = goodResponse();
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeIdealProject(input, { description: POSTING });
    expect(input).toEqual(snapshot);
  });
});

describe("buildIdealProjectPrompt", () => {
  it("gives the model the posting and asks for the exact shape the validator accepts", () => {
    const prompt = buildIdealProjectPrompt({ description: POSTING, question: "Tell me about a project you owned." });
    expect(prompt).toContain("Senior Product Manager, Education Technology");
    for (const label of SECTION_LABELS) expect(prompt).toContain(label);
    expect(prompt).toMatch(/json/i);
  });

  // The one instruction that cannot be left implicit. The posting is in the
  // context precisely so the example fits the job — and that same context is
  // full of salary, headcount and experience-floor numbers the model would
  // otherwise happily reuse as metrics. The validator rejects them, but a
  // rejected response means the candidate silently gets a templated example
  // instead of a fresh one, so the prompt has to ask for it correctly first.
  it("tells the model not to reuse the posting's own numbers", () => {
    const prompt = buildIdealProjectPrompt({ description: POSTING, question: "" });
    expect(prompt.toLowerCase()).toMatch(/salary|compensation|never (re)?use .*number|not .*from the posting/);
  });

  it("never asks for the candidate's own material", () => {
    // This is a benchmark of what a strong answer looks like, not a draft of
    // the candidate's answer. The résumé and prep notes are deliberately not
    // inputs here — AC-H7.27's sibling rule, from the other direction.
    const prompt = buildIdealProjectPrompt({ description: POSTING, question: "Tell me about a project you owned." });
    expect(prompt.toLowerCase()).not.toContain("resume");
    expect(prompt.toLowerCase()).not.toContain("cover letter");
  });

  it("degrades to empty rather than throwing on a missing posting", () => {
    expect(buildIdealProjectPrompt({ description: "", question: "" })).toBe("");
    expect(buildIdealProjectPrompt({})).toBe("");
    expect(buildIdealProjectPrompt()).toBe("");
  });
});
