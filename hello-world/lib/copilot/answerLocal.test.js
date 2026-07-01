import { describe, it, expect } from "vitest";
import {
  draftAnswerLocal,
  profileSkills,
  profileHeadline,
  profileMetric,
  matchedSkills,
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
    expect(points.some((p) => /Acme/.test(p))).toBe(true);
  });

  it("still returns usable points with an empty profile", () => {
    const { points } = draftAnswerLocal({
      question: "Describe a time you failed.",
      profile: "",
    });
    expect(points).toHaveLength(4);
    expect(points[0]).toMatch(/^Situation:/);
  });
});
