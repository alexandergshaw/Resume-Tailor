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
//     because the posting IS in its context. A figure containing any digit run
//     that occurs literally in the posting is rejected. That covers the salary
//     band, the years-of-experience floor, the headcount and the campus count
//     in one rule, without trying to tell them apart.
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

describe("normalizeIdealProject — the posting's own numbers can never come back", () => {
  // R-135's exact failure, now reachable for the first time: the posting is in
  // the model's context, so it can echo the salary band straight back as an
  // outcome. The rule is deliberately blunt — any digit run that occurs
  // literally in the posting disqualifies the figure — because there is no way
  // to tell a salary from a metric by shape, which is precisely the conclusion
  // R-135 reached when posting-number mining was deleted.
  it("rejects an example that quotes a number out of the posting", () => {
    const salary = goodResponse();
    salary.outcomes[0] = { metric: "adoption rate", figure: "$78,496 of budget recovered" };
    expect(normalizeIdealProject(salary, { description: POSTING })).toBeNull();

    const headcount = goodResponse();
    headcount.outcomes[1] = { metric: "team size managed", figure: "a team of 8, up from 3" };
    expect(normalizeIdealProject(headcount, { description: POSTING })).toBeNull();

    const floor = goodResponse();
    floor.sections[0].body = "Nobody on the team had the 5+ years the role called for, and the enrolment flow ran to seven screens each time.";
    expect(normalizeIdealProject(floor, { description: POSTING })).toBeNull();
  });

  it("still allows ordinary numbers the posting does not contain", () => {
    // The guard must not become "no numbers at all" — the numbers are the
    // point. 34, 71, 9, 38 and 3 are absent from POSTING and must survive.
    expect(normalizeIdealProject(goodResponse(), { description: POSTING })).not.toBeNull();
  });

  // A digit run inside a longer number is not the same number: rejecting "9
  // weeks" because the posting said "$105,974" (which contains "9") would
  // reject essentially every example.
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
