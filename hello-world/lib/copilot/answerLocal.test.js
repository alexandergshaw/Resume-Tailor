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
  combineMaterial,
  literallyMentioned,
  isPastWorkLine,
  usableExperienceLine,
  pastWorkExperienceLine,
  deriveAnswerFromPoints,
  MOTIVATION_LINE_RE,
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

// AC-H4.18: with no resume/coverLetter, draftAnswerLocal's output must be
// byte-identical to what it produced before submitted-document grounding
// existed. Proven exhaustively (many representative cases, diffed against
// the pre-AC-H4 implementation) in a scratch script during development; this
// is the permanent regression guard for the same guarantee.
describe("draftAnswerLocal byte-identity with no submitted documents (AC-H4.18)", () => {
  it("is identical whether resume/coverLetter are omitted or passed as empty strings", () => {
    const withoutDocs = draftAnswerLocal({
      question: "Tell me about a time you resolved a conflict on your team.",
      profile: PROFILE,
    });
    const withEmptyDocs = draftAnswerLocal({
      question: "Tell me about a time you resolved a conflict on your team.",
      profile: PROFILE,
      resume: "",
      coverLetter: "",
    });
    expect(withEmptyDocs).toEqual(withoutDocs);
  });

  it("whitespace-only resume/coverLetter are treated the same as absent", () => {
    const withoutDocs = draftAnswerLocal({ question: "Why do you want to work here?", profile: PROFILE });
    const withBlankDocs = draftAnswerLocal({
      question: "Why do you want to work here?",
      profile: PROFILE,
      resume: "   \n  ",
      coverLetter: "\n",
    });
    expect(withBlankDocs).toEqual(withoutDocs);
  });
});

// AC-H4.15/AC-H4.19: once a résumé and/or cover letter are present,
// draftAnswerLocal grounds points in them, with the same mining-hazard
// defenses sampleAnswerLocal.js's grounding uses.
describe("draftAnswerLocal grounding in submitted documents (AC-H4.15/AC-H4.19)", () => {
  const RESUME = [
    "Senior Software Engineer, Initech — Remote",
    "Jan 2021 – Present",
    "Led a team of six engineers, cutting deployment time by 40%.",
    "Collaborated closely with teams across the org on shared tooling.",
    "Skills: Python, Django, PostgreSQL, Docker",
  ].join("\n");

  const COVER_LETTER = [
    "Dear Hiring Manager,",
    "I am applying for the Senior Software Engineer role because I want to grow my career in cloud infrastructure.",
    "Sincerely, A Candidate",
  ].join("\n");

  const MISMATCHED_METRIC_RESUME = [
    "Senior Software Engineer, Initech — Remote",
    "Jan 2021 – Present",
    "Led a team of six engineers through a major payments system migration.",
    "Company-wide revenue grew 40% year over year during that period.",
    "Skills: Python, Django, PostgreSQL, Docker",
  ].join("\n");

  it("weaves the submitted résumé's own accomplishment into the points", () => {
    const { points } = draftAnswerLocal({
      question: "Tell me about a time you led a team through a tough deadline.",
      resume: RESUME,
      interviewType: "behavioral",
    });
    expect(points.join(" ")).toContain("led a team of six engineers, cutting deployment time by 40%");
    expect(points[0]).toMatch(/^Situation:/);
  });

  it("never speaks a taxonomy-inferred skill that doesn't literally appear in the submitted documents (mining hazard 1)", () => {
    const { points } = draftAnswerLocal({
      question: "Why do you want to work here?",
      resume: RESUME,
      coverLetter: COVER_LETTER,
      interviewType: "general",
    });
    expect(points.join(" ")).not.toContain("Microsoft Teams");
  });

  it("never pairs a metric with a story mined from a different line (mining hazard 2)", () => {
    const { points } = draftAnswerLocal({
      question: "Tell me about a time you led a team through a system migration.",
      resume: MISMATCHED_METRIC_RESUME,
      interviewType: "behavioral",
    });
    // The only metric in the material (40%, on the revenue line) is
    // unrelated to the migration story and must not appear anywhere.
    expect(points.join(" ")).not.toContain("40%");
    // The metric-free story is still told as the Action point.
    expect(points.join(" ")).toContain("led a team of six engineers through a major payments system migration");
  });

  it("never quotes a cover-letter motivation line as the concrete example (mining hazard 4)", () => {
    const { points } = draftAnswerLocal({
      question: "Tell me about a time you led a team through a tough deadline.",
      coverLetter: COVER_LETTER,
      interviewType: "behavioral",
    });
    expect(points.join(" ")).not.toContain("applying");
    expect(points.join(" ")).not.toContain("Senior Software Engineer role");
  });

  it("is deterministic for the same grounded inputs", () => {
    const args = {
      question: "Tell me about a time you led a team through a tough deadline.",
      resume: RESUME,
      coverLetter: COVER_LETTER,
      interviewType: "behavioral",
    };
    expect(draftAnswerLocal(args)).toEqual(draftAnswerLocal({ ...args }));
  });
});

// ARCH §3.6: draftAnswerLocal's own `story` parameter — live mode's points
// prefer a matched project page's own bullet over the résumé/profile expRef
// for the one concrete "e.g." clause each shape has, byte-identical to today
// whenever `story` is null or unmatched.
describe("draftAnswerLocal knowledge-base grounding (ARCH §3.6)", () => {
  const RESUME = [
    "Senior Software Engineer, Initech — Remote",
    "Jan 2021 – Present",
    "Led a team of six engineers, cutting deployment time by 40%.",
    "Skills: Python, Django, PostgreSQL, Docker",
  ].join("\n");

  const STORY = {
    pageId: "page-1",
    title: "Payments migration",
    bullets: ["Cut settlement time from three days to one"],
    matched: true,
  };

  it("behavioral: prefers the matched story's bullet over expRef for the Action clause, and cites only that point", () => {
    const { points, pageSources } = draftAnswerLocal({
      question: "Tell me about a time you led a migration.",
      resume: RESUME,
      interviewType: "behavioral",
      story: STORY,
    });
    const action = points.find((p) => p.startsWith("Action:"));
    expect(action).toContain("Cut settlement time from three days to one");
    expect(action).not.toContain("led a team of six engineers");
    expect(pageSources[points.indexOf(action)]).toEqual({ id: "page-1", title: "Payments migration" });
    expect(pageSources.filter(Boolean)).toHaveLength(1);
  });

  it("technical: prefers the matched story's bullet over expRef for the grounding clause", () => {
    const { points, pageSources } = draftAnswerLocal({
      question: "How would you design a scalable migration?",
      resume: RESUME,
      interviewType: "technical",
      story: STORY,
    });
    const grounding = points.find((p) => p.startsWith("Ground it"));
    expect(grounding).toContain("Cut settlement time from three days to one");
    expect(pageSources[points.indexOf(grounding)]).toEqual({ id: "page-1", title: "Payments migration" });
  });

  it("general: prefers the matched story's bullet over expRef for the anchor clause", () => {
    const { points, pageSources } = draftAnswerLocal({
      question: "Why do you want to work here?",
      resume: RESUME,
      interviewType: "general",
      story: STORY,
    });
    expect(points[0]).toContain("Cut settlement time from three days to one");
    expect(pageSources[0]).toEqual({ id: "page-1", title: "Payments migration" });
  });

  it("an UNMATCHED story is never spoken — byte-identical to no story at all (AC-5.2)", () => {
    const withUnmatchedStory = draftAnswerLocal({
      question: "Tell me about a time you led a migration.",
      resume: RESUME,
      interviewType: "behavioral",
      story: { ...STORY, matched: false },
    });
    const withNoStory = draftAnswerLocal({
      question: "Tell me about a time you led a migration.",
      resume: RESUME,
      interviewType: "behavioral",
    });
    expect(withUnmatchedStory.points).toEqual(withNoStory.points);
    expect(withUnmatchedStory.pageSources.filter(Boolean)).toEqual([]);
  });

  it("with no story at all, pageSources is an all-null array the same length as points", () => {
    const { points, pageSources } = draftAnswerLocal({
      question: "Why do you want to work here?",
      profile: RESUME,
    });
    expect(pageSources).toHaveLength(points.length);
    expect(pageSources.every((p) => p === null)).toBe(true);
  });
});

describe("combineMaterial", () => {
  it("joins non-empty sources with a blank line and drops empty ones", () => {
    expect(combineMaterial("profile text", "", "cover letter text")).toBe("profile text\n\ncover letter text");
    expect(combineMaterial("", "", "")).toBe("");
    expect(combineMaterial("  ", undefined, null)).toBe("");
  });
});

describe("literallyMentioned", () => {
  it("matches a whole-word, case-insensitive occurrence", () => {
    expect(literallyMentioned("Python", "Skills: Python, Django")).toBe(true);
    expect(literallyMentioned("python", "Skills: Python, Django")).toBe(true);
  });

  it("does not match a canonical name that never literally occurs (the Microsoft Teams hazard)", () => {
    expect(literallyMentioned("Microsoft Teams", "Collaborated closely with teams across the org.")).toBe(false);
  });

  it("returns false for an empty term", () => {
    expect(literallyMentioned("", "anything")).toBe(false);
  });
});

describe("isPastWorkLine / MOTIVATION_LINE_RE", () => {
  it("treats a verb-initial or numeric line as past work", () => {
    expect(isPastWorkLine("Led a team of six engineers, cutting deployment time by 40%.")).toBe(true);
  });

  it("rejects a motivation/application line even if it has an achievement-shaped word", () => {
    expect(isPastWorkLine("I am applying for this role because I led similar teams before.")).toBe(false);
    expect(MOTIVATION_LINE_RE.test("I am applying for this role")).toBe(true);
  });

  it("rejects an empty or plain descriptive line with no signal", () => {
    expect(isPastWorkLine("")).toBe(false);
    expect(isPastWorkLine("Responsible for various day-to-day tasks.")).toBe(false);
  });
});

describe("usableExperienceLine", () => {
  it("passes through a line that isn't truncated", () => {
    expect(usableExperienceLine("A short clean line.")).toBe("A short clean line.");
  });

  it("drops a line truncated mid-word with an ellipsis", () => {
    expect(usableExperienceLine("A very long line that got cut off mid…")).toBe("");
  });

  it("passes through empty input as empty", () => {
    expect(usableExperienceLine("")).toBe("");
  });
});

describe("pastWorkExperienceLine", () => {
  const material = [
    "I am applying for the Senior Software Engineer role because I love this company.",
    "Led a team of six engineers, cutting deployment time by 40%.",
  ].join("\n");

  it("disqualifies a motivation line and picks the real past-work line instead", () => {
    const line = pastWorkExperienceLine(material, "Tell me about a time you led a team.");
    expect(line).toBe("led a team of six engineers, cutting deployment time by 40%");
  });

  it("returns empty when the only relevant line is a motivation line", () => {
    const motivationOnly = "I am applying for the Senior Software Engineer role because I love this company.";
    expect(pastWorkExperienceLine(motivationOnly, "Why do you want to work here?")).toBe("");
  });
});

describe("deriveAnswerFromPoints (AC-H9.33)", () => {
  it("strips a leading STAR label from each point and joins with a single space", () => {
    const points = [
      "Situation: I ran into a tricky bug.",
      "Task: I needed to fix it before launch.",
      "Action: I traced it to a race condition.",
      "Result: I shipped a fix and the crash rate dropped.",
    ];
    expect(deriveAnswerFromPoints(points)).toBe(
      "I ran into a tricky bug. I needed to fix it before launch. I traced it to a race condition. I shipped a fix and the crash rate dropped.",
    );
  });

  it("leaves unlabeled points untouched", () => {
    expect(deriveAnswerFromPoints(["First sentence.", "Second sentence."])).toBe("First sentence. Second sentence.");
  });

  it("handles empty input without throwing", () => {
    expect(deriveAnswerFromPoints([])).toBe("");
    expect(deriveAnswerFromPoints(undefined)).toBe("");
  });
});
