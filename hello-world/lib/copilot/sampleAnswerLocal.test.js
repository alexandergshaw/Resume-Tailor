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
    expect(points).toEqual([
      "Situation: I don't have a specific story pulled from my materials for this one.",
      "Action: In general, when I run into a situation like that, I take ownership of the problem and keep the people it affects informed.",
      "Result: I don't consider it finished until there's a result I can point to.",
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
    expect(points).toEqual(["What draws me to this role is that I want to grow my career in cloud infrastructure."]);
    expect(answer).toBe("What draws me to this role is that I want to grow my career in cloud infrastructure.");
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
    expect(points).toEqual([
      "Situation: I don't have a specific story pulled from my materials for this one.",
      "Action: In general, when I run into a situation like that, I take ownership of the problem and keep the people it affects informed.",
      "Result: I don't consider it finished until there's a result I can point to.",
    ]);
    expect(answer).toBe(
      "I don't have a specific story pulled from my materials for this one. In general, when I run " +
        "into a situation like that, I take ownership of the problem and keep the people it affects " +
        "informed. I don't consider it finished until there's a result I can point to.",
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
    expect(points).toEqual([
      "I don't have specific résumé details on file for this one, but broadly, I look for roles where I can apply what I know and keep growing.",
      "And I'd want to talk through the specifics with you rather than speak in generalities.",
    ]);
    expect(answer).toBe(
      "I don't have specific résumé details on file for this one, but broadly, I look for roles where I " +
        "can apply what I know and keep growing. And I'd want to talk through the specifics with you " +
        "rather than speak in generalities.",
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
    expect(answer).toContain(
      "I'd ask a clarifying question or two, state my assumptions, and then lay out my approach.",
    );
    expect(answer).toContain("That's close to work I've actually done");
    expect(answer).not.toContain("Microsoft Teams");
    expect(answer).not.toContain("applying");
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
    expect(points).toEqual([
      "Situation: As Senior Software Engineer at Initech, I ran into a situation that put this to the test.",
      "Task: I made it my job to own the outcome, not just contribute to it, so I got clear on what success looked like before I started.",
    ]);
    expect(answer).toBe(
      "As Senior Software Engineer at Initech, I ran into a situation that put this to the test. I made " +
        "it my job to own the outcome, not just contribute to it, so I got clear on what success looked " +
        "like before I started.",
    );
  });
});
