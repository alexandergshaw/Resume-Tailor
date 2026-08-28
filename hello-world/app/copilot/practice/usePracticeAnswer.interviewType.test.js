// @vitest-environment jsdom
//
// AC-A11b / AC-A12 (plan-chunk-a.md §A.6, contract 4). Allocated here because
// PracticeClient itself cannot be rendered under test (PracticeClient.js:371),
// and usePracticeAnswer has no other test file that mounts a full
// Start->Done->critique cycle to hang these assertions off of besides
// usePracticeAnswer.commitPair.test.js, whose harness this file copies.
//
// Two independent fixes proved here:
//
//   1. clearSessionScores is a NEW, ADDITIVE export. resetAnswerState — the
//      reset that runs on "Next question", "Try again", a posting change,
//      and "Start answering" — must NOT clear the running average, or every
//      one of its call sites would silently wipe the session score the
//      moment this ships. roles/useRoleAnswer.js imports this same hook
//      (AC-A28) and must see no change in resetAnswerState's behaviour.
//   2. The interview type a critique was actually JUDGED under is captured
//      as STATE (never a ref — react-hooks/refs is error-level in this
//      repo, and PracticeClient.js:582 reads it at render time) at the
//      exact moment answerMetrics is set (doneAnswer), and cleared
//      alongside it in resetAnswerState — so it has exactly the review
//      panel's own lifetime and a mid-review interview-type change can
//      never relabel a finished critique with a rubric it wasn't judged
//      under.
//
// Everything with a recorder, a camera, a network call or a database is
// mocked. The hook itself is the real module.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerRecorder", () => ({
  AnswerRecorder: class FakeAnswerRecorder {
    constructor() {
      this.supported = true;
      this.mimeType = "video/webm";
    }

    start() {}

    async stop() {
      return null;
    }
  },
}));

// Only the sampler is replaced — it wants a real <video> and a canvas, which
// jsdom does not have.
vi.mock("@/lib/copilot/videoStats", async (importOriginal) => ({
  ...(await importOriginal()),
  VideoFrameSampler: class FakeVideoFrameSampler {
    start() {}
    stop() {
      return { summary: null, frames: [] };
    }
  },
}));

vi.mock("@/lib/copilot/bodyLandmarks", () => ({
  BodyLanguageSampler: class FakeBodyLanguageSampler {
    start() {}
    stop() {
      return { available: false, reason: "no-samples" };
    }
  },
}));

const critiqueAnswer = vi.fn(async () => ({
  score: 88,
  verdict: "fine",
  strengths: [],
  improvements: [],
  missing: [],
  star: null,
  delivery: [],
  source: "gemini",
}));
vi.mock("@/lib/copilot/critiqueClient", () => ({
  critiqueAnswer: (...args) => critiqueAnswer(...args),
}));

vi.mock("@/lib/supabase/practiceAnswers", () => ({
  savePracticeAnswer: vi.fn(async () => ({ data: null, error: null })),
  updatePracticeAnswerCritique: vi.fn(async () => ({ error: null })),
}));

import { usePracticeAnswer } from "./usePracticeAnswer.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let api;

function Probe() {
  api = usePracticeAnswer();
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  critiqueAnswer.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

const STREAM = { id: "fake-stream", getTracks: () => [] };

// Lets the hook's own promise chain settle under fake timers — doneAnswer
// awaits a DRAIN_MS (1800ms) timer that never fires on its own here.
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Drives one full Start -> commit -> Done -> drain -> critique cycle, ending
// with answerMetrics set and the critique settled, exactly like a real
// practice answer.
async function answerOneQuestion({ question, interviewType }) {
  await act(async () => {
    api.startAnswer(STREAM);
  });
  await act(async () => {
    api.recordTranscriptEvent({ isFinal: true, transcript: "A real answer.", start: 0, duration: 2 });
  });
  await act(async () => {
    api.doneAnswer({ question, interviewType, isSaveEnabled: () => false });
  });
  await advance(2000);
}

describe("usePracticeAnswer — clearSessionScores is additive (AC-A11b)", () => {
  it("is returned by the hook", () => {
    expect(typeof api.clearSessionScores).toBe("function");
  });

  it("clears the running average, unlike resetAnswerState", async () => {
    await answerOneQuestion({ question: "Tell me about yourself.", interviewType: "general" });
    expect(api.sessionAnswered).toBe(1);

    // The positive control: resetAnswerState runs on EVERY "Next question",
    // "Try again" and posting change today, and must leave the running
    // average alone or every one of those would silently wipe the score.
    await act(async () => {
      api.resetAnswerState();
    });
    expect(api.sessionAnswered).toBe(1);

    await act(async () => {
      api.clearSessionScores();
    });
    expect(api.sessionAnswered).toBe(0);
    expect(api.sessionAverageScore).toBe(0);
  });
});

describe("usePracticeAnswer — the judged interview type (AC-A12)", () => {
  it("starts null before any answer has been judged", () => {
    expect(api.judgedInterviewType).toBe(null);
  });

  it("is captured at the moment the critique's answerMetrics are set", async () => {
    await answerOneQuestion({ question: "Describe a conflict.", interviewType: "behavioral" });
    expect(api.answerMetrics).toBeTruthy();
    expect(api.judgedInterviewType).toBe("behavioral");
  });

  it("is cleared by resetAnswerState, alongside answerMetrics — exactly the panel's lifetime", async () => {
    await answerOneQuestion({ question: "Walk through a system design.", interviewType: "system-design" });
    expect(api.judgedInterviewType).toBe("system-design");

    await act(async () => {
      api.resetAnswerState();
    });
    expect(api.answerMetrics).toBe(null);
    expect(api.judgedInterviewType).toBe(null);
  });

  it("is not touched by clearSessionScores — the two fixes are independent", async () => {
    await answerOneQuestion({ question: "A question.", interviewType: "technical" });
    await act(async () => {
      api.clearSessionScores();
    });
    expect(api.judgedInterviewType).toBe("technical");
  });
});

describe("usePracticeAnswer — the judged type is STATE, never a ref (AC-A12)", () => {
  // react-hooks/refs is error-level in this repo, and PracticeClient.js:582
  // reads this at render time — a `.current` read there would not build.
  // Verified at source since a ref's `.current` and a piece of state are
  // indistinguishable through this hook's own return value alone.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SOURCE = readFileSync(join(HERE, "./usePracticeAnswer.js"), "utf8");

  it("declares judgedInterviewType with useState, not useRef", () => {
    // Housed inside answerReview (lib/copilot/practiceAnswerReview.js's
    // pairing with the metrics), but the housing state itself must still be
    // useState — destructured from it, never read off a `.current`.
    expect(SOURCE).toMatch(/const \[answerReview, setAnswerReview\] = useState\(/);
    expect(SOURCE).toMatch(/\{\s*metrics:\s*answerMetrics,\s*judgedInterviewType\s*\}\s*=\s*answerReview/);
    expect(SOURCE).not.toMatch(/judgedInterviewType\s*=\s*useRef\(/);
    expect(SOURCE).not.toMatch(/\bjudgedInterviewTypeRef\b/);
    expect(SOURCE).not.toMatch(/\banswerReviewRef\b/);
  });
});
