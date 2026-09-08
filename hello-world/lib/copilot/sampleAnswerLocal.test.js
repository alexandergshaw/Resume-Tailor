import { describe, it, expect } from "vitest";
import { draftSampleAnswerLocal } from "./sampleAnswerLocal.js";

// Contains "team" and "teams" but never the literal phrase "Microsoft Teams" —
// the skills taxonomy canonicalizes "teams" to that product name, so this
// fixture is the regression case for BUG-1. The résumé bullet is verb-initial
// ("Led a team...") and carries its own metric, so it also doubles as the
// fixture for BUG-2 (metric correctly paired with its own story) and BUG-3
// (first-person quoting).
const RESUME = [
  "Senior Software Engineer, Initech — Remote",
  "Jan 2021 – Present",
  "Led a team of six engineers, cutting deployment time by 40%.",
  "Collaborated closely with teams across the org on shared tooling.",
  "Skills: Python, Django, PostgreSQL, Docker",
].join("\n");

// An application/motivation line ("I am applying for... because...") rather
// than a description of past work — the regression fixture for BUG-4/BUG-5.
const COVER_LETTER = [
  "Dear Hiring Manager,",
  "I am applying for the Senior Software Engineer role because I want to grow my career in cloud infrastructure.",
  "Sincerely, A Candidate",
].join("\n");

// A résumé whose only metric lives on a line unrelated to the only story —
// the regression fixture for BUG-2's other half: a metric must never be
// spoken alongside a story it didn't come from.
const MISMATCHED_METRIC_RESUME = [
  "Senior Software Engineer, Initech — Remote",
  "Jan 2021 – Present",
  "Led a team of six engineers through a major payments system migration.",
  "Company-wide revenue grew 40% year over year during that period.",
  "Skills: Python, Django, PostgreSQL, Docker",
].join("\n");

const BEHAVIORAL_QUESTION = "Tell me about a time you led a team through a tough deadline.";
const GENERAL_QUESTION = "Why do you want to work here?";

describe("draftSampleAnswerLocal contract (AC-H9)", () => {
  it("returns { points, answer, type } with answer derived by joining points and stripping STAR labels", () => {
    const { points, answer, type } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      interviewType: "behavioral",
    });
    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBeGreaterThan(0);
    expect(type).toBe("behavioral");
    const expectedAnswer = points
      .map((p) => p.replace(/^(Situation|Task|Action|Result):\s*/, ""))
      .join(" ");
    expect(answer).toBe(expectedAnswer);
    // Never a fragment: derived answer never contains a raw STAR label.
    expect(answer).not.toMatch(/^(Situation|Task|Action|Result):/);
  });

  it("labels every point with its STAR prefix for the behavioral shape", () => {
    const { points } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      interviewType: "behavioral",
    });
    for (const p of points) {
      expect(p).toMatch(/^(Situation|Task|Action|Result):\s/);
    }
  });

  it("never labels points for the technical or general shape", () => {
    const technical = draftSampleAnswerLocal({
      question: "How would you design a scalable API in Python?",
      resume: RESUME,
      interviewType: "technical",
    });
    const general = draftSampleAnswerLocal({
      question: GENERAL_QUESTION,
      resume: RESUME,
      interviewType: "general",
    });
    for (const p of [...technical.points, ...general.points]) {
      expect(p).not.toMatch(/^(Situation|Task|Action|Result):/);
    }
  });
});

describe("draftSampleAnswerLocal grounding (BUG-1: literal skill mentions)", () => {
  it("never speaks a taxonomy-inferred skill that doesn't literally appear in the material", () => {
    const { answer } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      coverLetter: COVER_LETTER,
      interviewType: "behavioral",
    });
    // "teams" is present in the material, but the taxonomy's canonical name
    // for it ("Microsoft Teams") is not — it must not be spoken.
    expect(answer).not.toContain("Microsoft Teams");
  });

  it("still lists a skill that is literally mentioned in the material", () => {
    const { answer } = draftSampleAnswerLocal({
      question: GENERAL_QUESTION,
      resume: RESUME,
      coverLetter: COVER_LETTER,
      interviewType: "general",
    });
    // Python/Django/PostgreSQL are all literally in the résumé's Skills line
    // and should still be spoken — the fix filters the false positive, not
    // real skills.
    expect(answer).toContain("Django");
    expect(answer).not.toContain("Microsoft Teams");
  });
});

describe("draftSampleAnswerLocal metric pairing (BUG-2)", () => {
  it("pairs a metric with the story that actually carries it, as its own Result point", () => {
    const { points, answer } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      interviewType: "behavioral",
    });
    expect(points).toContain("Result: I led a team of six engineers, cutting deployment time by 40%.");
    expect(answer).toContain("I led a team of six engineers, cutting deployment time by 40%.");
  });

  it("never speaks a bare standalone metric sentence, and never pairs a metric with an unrelated story", () => {
    const { points, answer } = draftSampleAnswerLocal({
      question: "Tell me about a time you led a team through a system migration.",
      resume: MISMATCHED_METRIC_RESUME,
      interviewType: "behavioral",
    });
    // The only metric in the material (40%, on the revenue line) has nothing
    // to do with the migration story, so it must not appear at all, and no
    // point may be labeled Result (there is nothing metric-bearing to close on).
    expect(answer).not.toContain("40%");
    expect(points.some((p) => p.startsWith("Result:"))).toBe(false);
    // The real, metric-free story is still told, as the Action point.
    expect(points).toContain("Action: I led a team of six engineers through a major payments system migration.");
  });
});

describe("draftSampleAnswerLocal first-person quoting (BUG-3)", () => {
  it("speaks a quoted résumé bullet in first person, never as a subject-less fragment", () => {
    const { answer } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      interviewType: "behavioral",
    });
    expect(answer).toContain("I led a team of six engineers, cutting deployment time by 40%.");
    // The un-prefixed fragment (what the bug would have produced) must not appear.
    expect(answer).not.toContain("result: led a team");
    expect(answer).not.toMatch(/(?<!I )[Ll]ed a team of six engineers/);
  });
});

describe("draftSampleAnswerLocal motivation-line framing (BUG-4/BUG-5)", () => {
  it("behavioral shape: never quotes a cover-letter application line as the concrete example", () => {
    const { points, answer } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      coverLetter: COVER_LETTER,
      interviewType: "behavioral",
    });
    expect(answer).not.toContain("applying");
    expect(answer).not.toContain("Senior Software Engineer role");
    // With no genuine past-work anchor in the material, the honest fallback
    // is used instead of inventing a situation — still STAR-labeled.
    //
    // The fallback's PROSE is shortened by AC-B.10 (a ceiling of 12 words on
    // every ungrounded practice string; these three were 13, 24 and 14). The
    // property is unchanged and is what the three assertions above plus this
    // one still pin: three beats, STAR-labeled, admitting there is no story on
    // file rather than inventing one, and quoting nothing from the cover
    // letter. Each replacement is <= 12 words and passes AC-S.7.
    expect(points).toEqual([
      "Situation: I don't have a specific story on file for this one.",
      "Action: I take ownership of the problem and keep people informed.",
      "Result: I don't finish until I have a result to point to.",
    ]);
  });

  it("general shape: quotes the real résumé experience, not the application line, as the example", () => {
    const { answer } = draftSampleAnswerLocal({
      question: GENERAL_QUESTION,
      resume: RESUME,
      coverLetter: COVER_LETTER,
      interviewType: "general",
    });
    expect(answer).toContain("I led a team of six engineers, cutting deployment time by 40%.");
    expect(answer).not.toContain("applying");
  });

  it("general shape: frames a genuine motivation line as motivation in the closing point", () => {
    const { points, answer } = draftSampleAnswerLocal({
      question: GENERAL_QUESTION,
      coverLetter: COVER_LETTER,
      interviewType: "general",
    });
    // Only the reason clause after "because" is spoken, framed as motivation
    // — never the "I am applying for..." lead-in quoted verbatim.
    //
    // The FRAMING PROSE is shortened from "What draws me to this role is that"
    // (8 words) to "I'm drawn here because" (4) by AC-B.18's carrier 8. That
    // beat is GROUNDED — its reason clause is a >=4-token run of the
    // candidate's own motivation line — so AC-B.10's ungrounded census cannot
    // see it and it needed its own criterion; answerCarriers.test.js asserts
    // the pre-rewrite string is gone. Every property this case exists for is
    // untouched: exactly one point, the reason clause spoken in full, framed
    // as motivation rather than as experience, and the "applying" lead-in
    // never quoted.
    expect(points).toEqual(["I'm drawn here because I want to grow my career in cloud infrastructure."]);
    expect(answer).toBe("I'm drawn here because I want to grow my career in cloud infrastructure.");
    expect(answer).toContain("I want to grow my career in cloud infrastructure");
    expect(answer).not.toContain("applying");
  });
});

describe("draftSampleAnswerLocal with no real material", () => {
  it("returns the honest no-anchor fallback for a behavioral question instead of inventing a situation", () => {
    const { points, answer, type } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      profile: "",
      resume: "",
      coverLetter: "",
      interviewType: "behavioral",
    });
    expect(type).toBe("behavioral");
    // AC-B.10's rewrite of the three ungrounded fallback strings; the property
    // — an honest three-beat STAR fallback rather than an invented situation —
    // is unchanged. See the identical fallback asserted above.
    expect(points).toEqual([
      "Situation: I don't have a specific story on file for this one.",
      "Action: I take ownership of the problem and keep people informed.",
      "Result: I don't finish until I have a result to point to.",
    ]);
    expect(answer).toBe(
      "I don't have a specific story on file for this one. I take ownership of the problem and keep " +
        "people informed. I don't finish until I have a result to point to.",
    );
  });

  it("returns the honest no-anchor fallback for a general question instead of inventing a situation", () => {
    const { points, answer, type } = draftSampleAnswerLocal({
      question: GENERAL_QUESTION,
      profile: "",
      resume: "",
      coverLetter: "",
      interviewType: "general",
    });
    expect(type).toBe("general");
    // AC-B.10's rewrite of the general shape's no-anchor fallback (26 and 16
    // words, both ungrounded, both over the 12-word ceiling). The second beat
    // additionally opened on "And", which fails AC-S.7's S2 — a bullet whose
    // first token is a coordinator is a fragment of the bullet above it, and
    // these are read aloud out of order. The property is unchanged: two beats,
    // admitting nothing is on file, offering to talk specifics instead.
    expect(points).toEqual([
      "I don't have specific résumé details on file for this one.",
      "I'd rather talk through the specifics with you than generalise.",
    ]);
    expect(answer).toBe(
      "I don't have specific résumé details on file for this one. I'd rather talk through the " +
        "specifics with you than generalise.",
    );
  });
});

describe("draftSampleAnswerLocal determinism", () => {
  it("returns byte-identical output for the same inputs across separate calls", () => {
    const args = {
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      coverLetter: COVER_LETTER,
      interviewType: "behavioral",
    };
    const first = draftSampleAnswerLocal(args);
    const second = draftSampleAnswerLocal({ ...args });
    expect(second.points).toEqual(first.points);
    expect(second.answer).toBe(first.answer);
    expect(second.type).toBe(first.type);
    expect(first.answer.length).toBeGreaterThan(0);
  });
});

describe("draftSampleAnswerLocal technical/system-design shape", () => {
  it("produces a technical answer grounded in real work for a technical question", () => {
    const { answer, type } = draftSampleAnswerLocal({
      question: "How would you design a scalable API in Python?",
      resume: RESUME,
      interviewType: "technical",
    });
    expect(type).toBe("technical");
    expect(answer).toContain("trade-offs");
    expect(answer).toContain("led a team of six engineers, cutting deployment time by 40%");
  });

  it("is unaffected by the grounding/quoting fixes: a system-design interview still pushes a general question to the technical shape", () => {
    const { answer, type } = draftSampleAnswerLocal({
      question: "How would you approach this?",
      resume: RESUME,
      coverLetter: COVER_LETTER,
      interviewType: "system-design",
    });
    expect(type).toBe("technical");
    // Two AC-B.10/AC-B.4 rewrites land in this one assertion block, and the
    // property both times is routing, not prose — this case exists to prove a
    // system-design interviewType still pushes a general question to the
    // TECHNICAL shape, and that the grounding fixes did not change that.
    //
    //  * the opener is one of three ungrounded scaffold strings, cut from 15
    //    words to 8 by AC-B.10's ceiling.
    //  * the "That's close to work I've actually done — " carrier is REMOVED
    //    by AC-B.4, not shortened: eight fixed words in front of a sentence
    //    that already said the same thing, opening on a demonstrative whose
    //    antecedent is the interview question rather than anything in the
    //    line, so it failed AC-S.7 read by itself. The quote it wrapped is
    //    what carried the meaning, and that is asserted directly now — a
    //    stronger check than the carrier was, since the carrier could have
    //    shipped with no quote behind it.
    expect(answer).toContain("I'd ask a clarifying question, then state my assumptions.");
    expect(answer).toContain("I led a team of six engineers, cutting deployment time by 40%.");
    expect(answer).not.toContain("That's close to work I've actually done");
    expect(answer).not.toContain("Microsoft Teams");
    expect(answer).not.toContain("applying");
  });
});

// ARCH §3.6: the knowledge-base `story` selected once by the route and
// handed down. `matched` gates whether it is used at all (AC-5.2); when it
// is, every page-derived point carries a pageSource and every connective
// beat stays null (AC-6).
describe("draftSampleAnswerLocal knowledge-base grounding (ARCH §3.6)", () => {
  const STORY = {
    pageId: "page-1",
    title: "Payments migration",
    bullets: ["Cut settlement time from three days to one", "Mentored two junior engineers on the rollout"],
    matched: true,
  };

  it("behavioral: a matched story fully replaces the drafted STAR narrative, citing every point", () => {
    const { points, answer, pageSources } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      interviewType: "behavioral",
      story: STORY,
    });
    expect(points).toEqual([
      "Situation: Payments migration.",
      "Action: Cut settlement time from three days to one.",
      "Result: Mentored two junior engineers on the rollout.",
    ]);
    expect(answer).toContain("Payments migration");
    expect(pageSources).toEqual([
      { id: "page-1", title: "Payments migration" },
      { id: "page-1", title: "Payments migration" },
      { id: "page-1", title: "Payments migration" },
    ]);
  });

  it("behavioral: an UNMATCHED story is never spoken, and output is byte-identical to no story at all (AC-5.2)", () => {
    const withUnmatchedStory = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      interviewType: "behavioral",
      story: { ...STORY, matched: false },
    });
    const withNoStory = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      interviewType: "behavioral",
    });
    expect(withUnmatchedStory.points).toEqual(withNoStory.points);
    expect(withUnmatchedStory.answer).toBe(withNoStory.answer);
    expect(withUnmatchedStory.pageSources.filter(Boolean)).toEqual([]);
  });

  it("technical: prefers the matched story's own bullet over the résumé's expRef, and cites only that point", () => {
    const { answer, pageSources } = draftSampleAnswerLocal({
      question: "How would you design a scalable migration?",
      resume: RESUME,
      interviewType: "technical",
      story: STORY,
    });
    expect(answer).toContain("Cut settlement time from three days to one");
    // The Django/résumé-derived clause is displaced, not spoken alongside it.
    expect(answer).not.toContain("led a team of six engineers");
    expect(pageSources.filter(Boolean)).toEqual([{ id: "page-1", title: "Payments migration" }]);
  });

  it("general: prefers the matched story's own bullet over pastWorkExpRef, citing only that point", () => {
    const { answer, pageSources } = draftSampleAnswerLocal({
      question: GENERAL_QUESTION,
      resume: RESUME,
      interviewType: "general",
      story: STORY,
    });
    expect(answer).toContain("Cut settlement time from three days to one");
    expect(pageSources.filter(Boolean).length).toBe(1);
  });

  it("with no story at all, pageSources is an all-null array the same length as points", () => {
    const { points, pageSources } = draftSampleAnswerLocal({
      question: GENERAL_QUESTION,
      resume: RESUME,
      interviewType: "general",
    });
    expect(pageSources).toHaveLength(points.length);
    expect(pageSources.every((p) => p === null)).toBe(true);
  });
});

describe("draftSampleAnswerLocal length shaping", () => {
  it("trims to the crisp two-point cut for a short-format interview (phone screen)", () => {
    const { points, answer } = draftSampleAnswerLocal({
      question: GENERAL_QUESTION,
      resume: RESUME,
      interviewType: "phone-screen",
    });
    expect(points).toHaveLength(2);
    const sentenceCount = (answer.match(/[.!?](?:\s|$)/g) || []).length;
    expect(sentenceCount).toBe(2);
    expect(answer).toBe(
      "I led a team of six engineers, cutting deployment time by 40%. The strengths I'd bring are Django, PostgreSQL, Python.",
    );
  });

  it("trims a behavioral shape to its crisp two-point cut too, keeping the STAR labels", () => {
    const { points, answer } = draftSampleAnswerLocal({
      question: BEHAVIORAL_QUESTION,
      resume: RESUME,
      interviewType: "phone-screen",
    });
    // TWO changes here, and the second is a behaviour change, not a rewrite.
    //
    //  * the prose: AC-B.18's carrier 6 cuts the Situation beat (18 words on
    //    this fixture) and AC-B.10 cuts the Task beat (24 words).
    //  * WHICH BEATS SURVIVE THE CUT. Taking the first two beats and stopping
    //    handed a recruiter phone screen the two beats containing no material
    //    — the scene-setter and the generic ownership line — and dropped the
    //    only sentence quoting anything the candidate actually did. AC-S.6 /
    //    R-333 requires the accomplishment to be quoted on ALL 56 cells of a
    //    material that offers one, phone-screen cells included
    //    (answerSelection.test.js pins that count), so the cut now keeps the
    //    grounded beat in the last slot. Order is preserved.
    //
    // The property this case names — trimmed to a crisp TWO points, STAR
    // labels kept — is unchanged, and both labels are re-asserted below so a
    // regression that dropped them cannot hide behind the new prose.
    expect(points).toEqual([
      "Situation: I was Senior Software Engineer at Initech.",
      "Result: I led a team of six engineers, cutting deployment time by 40%.",
    ]);
    expect(points).toHaveLength(2);
    expect(points.every((p) => /^(Situation|Task|Action|Result): /.test(p))).toBe(true);
    expect(answer).toBe(
      "I was Senior Software Engineer at Initech. I led a team of six engineers, cutting deployment " +
        "time by 40%.",
    );
  });
});
