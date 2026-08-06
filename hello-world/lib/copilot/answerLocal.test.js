import { describe, it, expect } from "vitest";
import {
  draftAnswerLocal,
  profileSkills,
  profileHeadline,
  profileMetric,
  matchedSkills,
  relevantExperienceLine,
  resolveScaffoldType,
  ACHIEVEMENT_VERBS,
} from "./answerLocal.js";

const PROFILE = [
  "Senior Software Engineer, Acme Corp — Remote",
  "Jan 2020 – Present",
  "Built and scaled a React and Node.js platform serving 2M users, cutting latency by 40%.",
  "Led a team of five engineers.",
  "Skills: React, Node.js, TypeScript, PostgreSQL, AWS, Kubernetes",
].join("\n");

describe("profile mining helpers", () => {
  it("pulls real skills from the profile", () => {
    const skills = profileSkills(PROFILE).map((s) => s.toLowerCase());
    expect(skills.some((s) => s.includes("react"))).toBe(true);
    expect(skills.some((s) => s.includes("node"))).toBe(true);
    expect(profileSkills("")).toEqual([]);
  });

  it("parses the most recent company from the profile", () => {
    const h = profileHeadline(PROFILE);
    expect(`${h.company} ${h.title}`.toLowerCase()).toMatch(/acme|engineer/);
  });

  it("finds a quantified achievement", () => {
    expect(profileMetric(PROFILE)).toBeTruthy();
    expect(profileMetric("no numbers here")).toBe("");
  });

  it("matches question keywords against profile skills", () => {
    expect(matchedSkills("Design a scalable API in Node.js", ["Node.js", "React"])).toEqual(["Node.js"]);
    expect(matchedSkills("Tell me about yourself", ["Node.js"])).toEqual([]);
  });

  it("finds the most relevant accomplishment line for a question", () => {
    const line = relevantExperienceLine(PROFILE, "how do you handle latency at scale?");
    expect(line.toLowerCase()).toContain("latency");
    // Header/skills lines are not returned as an example.
    expect(line.toLowerCase()).not.toMatch(/^skills:/);
    expect(relevantExperienceLine("", "anything")).toBe("");
  });
});

describe("resolveScaffoldType", () => {
  it("keeps a behavioral classification regardless of interview type", () => {
    expect(resolveScaffoldType("behavioral", "technical")).toBe("behavioral");
    expect(resolveScaffoldType("behavioral", "system-design")).toBe("behavioral");
    expect(resolveScaffoldType("behavioral", undefined)).toBe("behavioral");
  });

  it("keeps a technical classification regardless of interview type", () => {
    expect(resolveScaffoldType("technical", "behavioral")).toBe("technical");
    expect(resolveScaffoldType("technical", "leadership")).toBe("technical");
    expect(resolveScaffoldType("technical", undefined)).toBe("technical");
  });

  it("pushes a general classification to technical for technical-flavored interview types", () => {
    expect(resolveScaffoldType("general", "system-design")).toBe("technical");
    expect(resolveScaffoldType("general", "technical")).toBe("technical");
    expect(resolveScaffoldType("general", "case-study")).toBe("technical");
  });

  it("pushes a general classification to behavioral for STAR-flavored interview types", () => {
    expect(resolveScaffoldType("general", "behavioral")).toBe("behavioral");
    expect(resolveScaffoldType("general", "leadership")).toBe("behavioral");
  });

  it("leaves a general classification alone when the interview type doesn't push it", () => {
    expect(resolveScaffoldType("general", "phone-screen")).toBe("general");
    expect(resolveScaffoldType("general", undefined)).toBe("general");
    // Unrecognized values normalize to "general" (interviewTypes.js), which
    // isn't in either push set either.
    expect(resolveScaffoldType("general", "not-a-real-interview-type")).toBe("general");
  });
});

describe("ACHIEVEMENT_VERBS", () => {
  it("matches verb-initial resume bullets", () => {
    expect(ACHIEVEMENT_VERBS.test("Built and scaled a React and Node.js platform serving 2M users.")).toBe(true);
    expect(ACHIEVEMENT_VERBS.test("Led a team of five engineers.")).toBe(true);
    expect(ACHIEVEMENT_VERBS.test("reduced latency by 40%")).toBe(true);
  });

  it("does not match a bullet with no achievement verb", () => {
    expect(ACHIEVEMENT_VERBS.test("Responsible for various day-to-day tasks.")).toBe(false);
  });

  it("does not match a verb that only appears as a substring of another word", () => {
    // "handled" contains the letters "led" but isn't the word "led".
    expect(ACHIEVEMENT_VERBS.test("handled customer escalations")).toBe(false);
  });
});

describe("draftAnswerLocal", () => {
  it("produces a STAR scaffold for behavioral questions, grounded in the profile", () => {
    const { points, type } = draftAnswerLocal({
      question: "Tell me about a time you resolved a conflict on your team.",
      profile: PROFILE,
    });
    expect(type).toBe("behavioral");
    expect(points).toHaveLength(4);
    expect(points[0]).toMatch(/^Situation:/);
    expect(points[1]).toMatch(/^Task:/);
    expect(points[2]).toMatch(/^Action:/);
    expect(points[3]).toMatch(/^Result:/);
    // Situation references the real company parsed from the profile.
    expect(points[0]).toMatch(/Acme/);
  });

  it("produces a technical checklist that references matched skills", () => {
    const { points, type } = draftAnswerLocal({
      question: "How would you design a scalable API in Node.js?",
      profile: PROFILE,
    });
    expect(type).toBe("technical");
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.some((p) => /Node\.js/i.test(p))).toBe(true);
  });

  it("produces general points anchored in the profile", () => {
    const { points, type } = draftAnswerLocal({
      question: "Why do you want to work here?",
      profile: PROFILE,
    });
    expect(type).toBe("general");
    expect(points.length).toBeGreaterThanOrEqual(3);
    // Anchored in a concrete example (the real accomplishment, or the company).
    expect(points[0]).toMatch(/concrete example/i);
    expect(points.join(" ")).toMatch(/Acme|platform|latency/);
  });

  it("still returns usable points with an empty profile", () => {
    const { points } = draftAnswerLocal({
      question: "Describe a time you failed.",
      profile: "",
    });
    expect(points).toHaveLength(4);
    expect(points[0]).toMatch(/^Situation:/);
  });

  it("weaves a real profile accomplishment into the points", () => {
    const { points } = draftAnswerLocal({
      question: "Tell me about a time you improved performance.",
      profile: PROFILE,
    });
    // The Action point should cite the concrete latency/platform accomplishment.
    expect(points.join(" ").toLowerCase()).toMatch(/latency|platform/);
  });

  it("varies phrasing across different questions", () => {
    const openers = [
      "Tell me about a time you led a project.",
      "Tell me about a time you missed a deadline.",
      "Tell me about a time you disagreed with a coworker.",
      "Tell me about a time you mentored someone.",
    ].map((q) => draftAnswerLocal({ question: q, profile: "" }).points[0]);
    expect(new Set(openers).size).toBeGreaterThan(1);
  });

  it("stays general with no interviewType passed at all (live mode's path)", () => {
    // Regression guard: live mode never sends interviewType, so omitting it
    // entirely must behave exactly as it did before resolveScaffoldType
    // existed — a general question stays general, not pushed to any scaffold.
    const { points, type } = draftAnswerLocal({
      question: "Why do you want to work here?",
      profile: PROFILE,
    });
    expect(type).toBe("general");
    expect(points[0]).toMatch(/concrete example/i);
  });

  it("pushes a general question toward a technical scaffold for a technical-flavored interview type", () => {
    const { points, type } = draftAnswerLocal({
      question: "Why do you want to work here?",
      profile: PROFILE,
      interviewType: "system-design",
    });
    expect(type).toBe("technical");
    expect(points[0]).toMatch(/clarify|constraints/i);
    expect(points.some((p) => /trade-off/i.test(p))).toBe(true);
  });

  it("pushes a general question toward a STAR scaffold for a behavioral-flavored interview type", () => {
    const { points, type } = draftAnswerLocal({
      question: "Why do you want to work here?",
      profile: PROFILE,
      interviewType: "leadership",
    });
    expect(type).toBe("behavioral");
    expect(points[0]).toMatch(/^Situation:/);
    expect(points[3]).toMatch(/^Result:/);
  });

  it("leaves a general question alone for an interview type that doesn't push it", () => {
    const { type } = draftAnswerLocal({
      question: "Why do you want to work here?",
      profile: PROFILE,
      interviewType: "phone-screen",
    });
    expect(type).toBe("general");
  });

  it("does not let the interview type override an already-behavioral question", () => {
    const { type } = draftAnswerLocal({
      question: "Tell me about a time you resolved a conflict on your team.",
      profile: PROFILE,
      interviewType: "technical",
    });
    expect(type).toBe("behavioral");
  });

  it("does not let the interview type override an already-technical question", () => {
    const { type } = draftAnswerLocal({
      question: "How would you design a scalable API in Node.js?",
      profile: PROFILE,
      interviewType: "behavioral",
    });
    expect(type).toBe("technical");
  });
});
