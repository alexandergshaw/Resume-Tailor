import { describe, it, expect } from "vitest";
import { emptySampleAnswer, activeSampleAnswer, needsRedraft } from "./sampleAnswerState.js";

describe("activeSampleAnswer", () => {
  it("discards a stored draft built for a different question", () => {
    const state = {
      question: "Tell me about a time you led a project.",
      visible: true,
      status: "done",
      points: ["Situation: Sure, at my last job..."],
      grounding: { resume: true, coverLetter: false },
      error: "",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    const active = activeSampleAnswer(state, "Why do you want this role?");
    expect(active).toEqual(emptySampleAnswer());
  });

  it("returns the stored state as-is when the question matches exactly", () => {
    const state = {
      question: "Tell me about a time you led a project.",
      visible: true,
      status: "done",
      points: ["Situation: Sure, at my last job..."],
      grounding: { resume: true, coverLetter: false },
      error: "",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    const active = activeSampleAnswer(state, "Tell me about a time you led a project.");
    expect(active).toBe(state);
    expect(active.points).toEqual(["Situation: Sure, at my last job..."]);
  });

  it("returns emptySampleAnswer() when state is null", () => {
    const active = activeSampleAnswer(null, "Why do you want this role?");
    expect(active).toEqual(emptySampleAnswer());
  });

  it("returns emptySampleAnswer() when state is undefined", () => {
    const active = activeSampleAnswer(undefined, "Why do you want this role?");
    expect(active).toEqual(emptySampleAnswer());
  });

  it("matches an empty-string question against a state stored for the empty string", () => {
    const state = {
      question: "",
      visible: true,
      status: "done",
      points: ["Fallback answer"],
      grounding: null,
      error: "",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    const active = activeSampleAnswer(state, "");
    expect(active).toBe(state);
  });

  it("discards a stored draft when the current question is empty but the draft was for a real question", () => {
    const state = {
      question: "Why do you want this role?",
      visible: true,
      status: "done",
      points: ["Because..."],
      grounding: null,
      error: "",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    const active = activeSampleAnswer(state, "");
    expect(active).toEqual(emptySampleAnswer());
  });
});

describe("emptySampleAnswer", () => {
  it("carries points (an empty array) rather than a prose answer string (AC-H9.37)", () => {
    const empty = emptySampleAnswer();
    expect(empty.points).toEqual([]);
    expect(empty).not.toHaveProperty("answer");
  });
});

describe("needsRedraft — force", () => {
  it("redrafts even when status is done and every comparison key matches", () => {
    const active = {
      question: "Q",
      status: "done",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", true)).toBe(true);
  });

  it("redrafts even when a request for this question is already loading", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", true)).toBe(true);
  });
});

describe("needsRedraft — idle and error always redraft", () => {
  it("redrafts from idle even with no force and nothing to compare against", () => {
    const active = emptySampleAnswer();
    expect(active.status).toBe("idle");
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", false)).toBe(true);
  });

  it("redrafts from error even when every comparison key matches what's cached", () => {
    const active = {
      question: "Q",
      status: "error",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", false)).toBe(true);
  });

  it("treats a missing/null active as idle-like and redrafts", () => {
    expect(needsRedraft(null, "profile-A", "behavioral", "app-1", false)).toBe(true);
    expect(needsRedraft(undefined, "profile-A", "behavioral", "app-1", false)).toBe(true);
  });
});

describe("needsRedraft — loading never starts a second request", () => {
  it("does not redraft while loading even when profile, interviewType, and applicationId have all since changed", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-B", "technical", "app-2", false)).toBe(false);
  });

  it("does not redraft while loading even when nothing has changed", () => {
    const active = {
      question: "Q",
      status: "loading",
      profile: "profile-A",
      interviewType: "behavioral",
      applicationId: "app-1",
    };
    expect(needsRedraft(active, "profile-A", "behavioral", "app-1", false)).toBe(false);
  });
});

describe("needsRedraft — done redrafts only when profile, interviewType, or applicationId differs", () => {
  const doneActive = {
    question: "Q",
    status: "done",
    points: ["Cached point"],
    profile: "profile-A",
    interviewType: "behavioral",
    applicationId: "app-1",
  };

  it("serves the cache when profile, interviewType, and applicationId all still match", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-1", false)).toBe(false);
  });

  it("redrafts when only profile differs", () => {
    expect(needsRedraft(doneActive, "profile-B", "behavioral", "app-1", false)).toBe(true);
  });

  it("redrafts when only interviewType differs", () => {
    expect(needsRedraft(doneActive, "profile-A", "technical", "app-1", false)).toBe(true);
  });

  it("redrafts when only applicationId differs", () => {
    expect(needsRedraft(doneActive, "profile-A", "behavioral", "app-2", false)).toBe(true);
  });

  it("redrafts when applicationId changes from null to a real id", () => {
    const activeWithNullApp = { ...doneActive, applicationId: null };
    expect(needsRedraft(activeWithNullApp, "profile-A", "behavioral", "app-1", false)).toBe(true);
  });
});
