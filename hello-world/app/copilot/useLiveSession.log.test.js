// @vitest-environment jsdom
//
// AC-Q6: the WIRING half of "download a log of this session". The pure
// recorder and renderers are already covered by lib/copilot/sessionLog*.js's
// own tests — and a correct recorder that nothing ever calls is exactly the
// failure mode this repo has shipped before: three fully-tested components
// sitting beside a caller that never imported them. Every assertion here is
// therefore about whether the live pipeline actually FEEDS the log, observed
// through the hook's own returned surface, never through a prop or a spy on
// an internal.
//
// Under the default `environment: "node"` the hook body never runs, so this
// file opts into jsdom the same way useLiveSession.manual.test.js does, and
// borrows its probe harness wholesale.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/session", () => ({ CopilotSession: vi.fn() }));
vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  draftAnswerStreaming: vi.fn(),
}));
vi.mock("@/lib/copilot/sessionLogArchive", () => ({
  downloadSessionLogArchive: vi.fn(() => Promise.resolve()),
}));

import { useLiveSession } from "./useLiveSession.js";
import { CopilotSession } from "@/lib/copilot/session";
import { draftAnswerStreaming } from "@/lib/copilot/answerClient";
import { downloadSessionLogArchive } from "@/lib/copilot/sessionLogArchive";
import { confirmQuestion } from "@/lib/copilot/detectClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT_RESPONSE = {
  points: ["Situation: I led the migration.", "Result: latency fell a third."],
  cues: ["Led migration"],
  buzzwords: ["migration"],
  resumeAnchor: null,
  idealProject: null,
  type: "behavioral",
};

let sessionOptions = null;

function Probe({ onState }) {
  const [status, setStatus] = useState("idle");
  const [questions, setQuestions] = useState([]);
  const answerCacheRef = useRef(new Map());
  const draftGenRef = useRef(0);
  const live = useLiveSession({
    answerCacheRef,
    draftGenRef,
    recordSpeechSample: () => {},
    resetForSession: () => {},
    status,
    setStatus,
    questions,
    setQuestions,
    source: "inperson",
    micDeviceId: null,
    profile: "",
    posting: null,
    autoDraft: true,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
  });
  onState({ ...live, status, questions });
  return null;
}

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  act(() => {
    root.render(createElement(Probe, { onState: (s) => Object.assign(state, s) }));
  });
  return { state, root, container };
}

// Models what lib/copilot/session.js actually delivers for the "inperson"
// source, which is TWO callbacks per turn, not one: the frame goes out
// through onTranscript (that is what the transcript and the pace sampler
// read), and the assembled utterance goes out separately through
// onUtterance, which is the ONLY thing that drives question detection for
// this source — useLiveSession's onTranscript handler deliberately skips
// detection when `source === "inperson"`, because running both would
// double-detect every in-person question. A helper that fired only
// onTranscript would model a tab/system session while claiming to be an
// in-person one, and would then "prove" that detection never records
// anything.
function speakAsInterviewer(text) {
  sessionOptions.onTranscript({
    speaker: "them",
    transcript: text,
    isFinal: true,
    speechFinal: true,
    start: 0,
    duration: 2,
    speakerTag: 0,
  });
  sessionOptions.onUtterance({ speakerTag: 0, text, evaluate: true });
}

// Every event of a given type, in order.
function eventsOfType(snapshot, type) {
  return (snapshot?.events || []).filter((e) => e.type === type);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionOptions = null;
  CopilotSession.mockImplementation(function (options) {
    sessionOptions = options;
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.speakerSnapshot = vi.fn(() => ({
      userTag: null,
      confidence: "unknown",
      overridden: false,
      tags: [],
    }));
    this.assignUser = vi.fn();
  });
  draftAnswerStreaming.mockResolvedValue(DRAFT_RESPONSE);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the session records itself (AC-Q6.1)", () => {
  it("opens a log the moment a session starts, naming what it started as", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    const snap = state.sessionLogSnapshot();
    expect(snap).toBeTruthy();
    expect(snap.mode).toBe("live");
    expect(snap.source).toBe("inperson");
    expect(eventsOfType(snap, "session.start")).toHaveLength(1);
  });

  it("throws nothing when asked for a log before any session ran", () => {
    const { state } = mountProbe();
    expect(() => state.sessionLogSnapshot()).not.toThrow();
  });

  it("starts a fresh log for a second session (AC-Q6.6)", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });
    expect(eventsOfType(state.sessionLogSnapshot(), "transcript").length).toBeGreaterThan(0);

    await act(async () => {
      await state.start();
    });
    // The previous interview's turns must not follow the user into the next
    // session's download.
    expect(eventsOfType(state.sessionLogSnapshot(), "transcript")).toHaveLength(0);
    expect(eventsOfType(state.sessionLogSnapshot(), "session.start")).toHaveLength(1);
  });
});

describe("what the log actually captures (AC-Q6.2/6.3)", () => {
  it("records the interviewer's finalized speech, with its own text", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });
    const [frame] = eventsOfType(state.sessionLogSnapshot(), "transcript");
    expect(frame).toBeTruthy();
    expect(frame.text).toContain("how do you handle ambiguity");
    expect(frame.speaker).toBe("them");
    expect(frame.isFinal).toBe(true);
  });

  it("records a detected question and the answer drafted for it", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });

    const snap = state.sessionLogSnapshot();
    const [added] = eventsOfType(snap, "question.added");
    expect(added).toBeTruthy();
    expect(added.question).toContain("handle ambiguity");

    const [done] = eventsOfType(snap, "answer.done");
    expect(done).toBeTruthy();
    expect(done.id).toBe(added.id);
    expect(done.points).toEqual(DRAFT_RESPONSE.points);
  });

  it("records a failed draft as a failure, not as silence (AC-Q6.3)", async () => {
    draftAnswerStreaming.mockRejectedValueOnce(new Error("Gemini said no"));
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });

    const snap = state.sessionLogSnapshot();
    const [failed] = eventsOfType(snap, "answer.error");
    expect(failed).toBeTruthy();
    expect(String(failed.message || failed.error)).toContain("Gemini said no");
    expect(eventsOfType(snap, "answer.done")).toHaveLength(0);
  });

  it("records a session warning the user was shown (AC-Q6.4)", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      sessionOptions.onError(new Error("Your provider cannot tell speakers apart."));
    });
    const warned = (state.sessionLogSnapshot().events || []).filter((e) =>
      String(e.type).match(/warn|error/i),
    );
    expect(warned.length).toBeGreaterThan(0);
    expect(JSON.stringify(warned)).toContain("cannot tell speakers apart");
  });

  it("records the session that heard NOTHING — the reported failure (AC-Q6.2)", async () => {
    // A log with no transcript is not an empty log: it still has to show
    // that the session started, what it started as, and that nothing
    // followed. That is the whole diagnostic value.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    const snap = state.sessionLogSnapshot();
    expect(eventsOfType(snap, "transcript")).toHaveLength(0);
    expect(eventsOfType(snap, "session.start")).toHaveLength(1);
    expect(snap.source).toBe("inperson");
  });
});

describe("downloading it (AC-Q6.5/6.7)", () => {
  it("hands the CURRENT snapshot to the archive, on one call", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });
    await act(async () => {
      await state.downloadLog();
    });

    expect(downloadSessionLogArchive).toHaveBeenCalledTimes(1);
    const passed = downloadSessionLogArchive.mock.calls[0][0];
    expect(passed.mode).toBe("live");
    expect(eventsOfType(passed, "transcript").length).toBeGreaterThan(0);
  });

  it("still downloads after the session has been stopped (AC-Q6.7)", async () => {
    // Reviewing an interview happens afterwards, and diagnosing a session
    // that did nothing happens afterwards too. A log that vanishes on Stop
    // is useless for both.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });
    await act(async () => {
      await state.stop();
    });
    await act(async () => {
      await state.downloadLog();
    });

    expect(downloadSessionLogArchive).toHaveBeenCalledTimes(1);
    expect(eventsOfType(downloadSessionLogArchive.mock.calls[0][0], "transcript").length)
      .toBeGreaterThan(0);
  });

  it("does not blow up when asked to download before any session ran", async () => {
    const { state } = mountProbe();
    let threw = null;
    await act(async () => {
      await state.downloadLog().catch((err) => {
        threw = err;
      });
    });
    // Whether it downloads an empty log or declines is the implementer's
    // call; throwing at the user is not. Asserting `threw` stays null is the
    // whole assertion — an `expect(true).toBe(true)` here would have passed
    // against a downloadLog that rejected on every call.
    expect(threw).toBe(null);
    expect(downloadSessionLogArchive.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

// D8: `question.rejected` had zero tests before this, and two of the five
// reachable paths that produce a card-less utterance recorded NO event at
// all — a session could suppress every real question and its own log would
// look identical to one that correctly heard nothing. Every reason is
// covered here; the sabotage step (deleting one `logEvent("question.rejected",
// ...)` call at a time and confirming the matching test goes red) was run by
// hand while writing this file, not left for a future reader to trust blind.
describe("question.rejected — every path that produces no card must still be explained (D8)", () => {
  it('records "too short" for an utterance the heuristic missed and that is too short for a remote confirm', async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      // Two words: not locally decided (no "?", no starter opener) and
      // under localDetection.js's own MIN_WORDS_FOR_LLM (4).
      speakAsInterviewer("okay so");
    });
    const [rejected] = eventsOfType(state.sessionLogSnapshot(), "question.rejected");
    expect(rejected).toBeTruthy();
    expect(rejected.reason).toBe("too short");
    expect(eventsOfType(state.sessionLogSnapshot(), "question.added")).toHaveLength(0);
  });

  it('records "confirm unavailable" when the remote confirm rejects', async () => {
    confirmQuestion.mockRejectedValueOnce(new Error("network down"));
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      // Long enough for a remote confirm (>= 4 words), not locally decided
      // (no "?", no STARTERS opener even after cleanQuestion's lead-in strip).
      speakAsInterviewer("the office move went longer than we expected");
    });
    const [rejected] = eventsOfType(state.sessionLogSnapshot(), "question.rejected");
    expect(rejected).toBeTruthy();
    expect(rejected.reason).toBe("confirm unavailable");
  });

  it('records "not a question" when the remote confirm says so', async () => {
    confirmQuestion.mockResolvedValueOnce({ isQuestion: false });
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("the office move went longer than we expected");
    });
    const [rejected] = eventsOfType(state.sessionLogSnapshot(), "question.rejected");
    expect(rejected).toBeTruthy();
    expect(rejected.reason).toBe("not a question");
  });

  it('records "duplicate" for a back-to-back repeat that produces no second card', async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });
    // The first draft has already resolved by now (draftAnswerStreaming
    // resolves immediately and `act` flushes the microtask) — the entry is
    // "done", not "loading", so a second identical utterance is a genuine
    // dedupe, not a fresh re-ask (AC-P4.4 covers that other case).
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });
    const rejected = eventsOfType(state.sessionLogSnapshot(), "question.rejected");
    expect(rejected.some((e) => e.reason === "duplicate")).toBe(true);
    expect(eventsOfType(state.sessionLogSnapshot(), "question.added")).toHaveLength(1);
  });

  it('records "speaker identity suppressed" for an utterance never evaluated at all — the silent-deafness case', async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      // Models session.js delivering an utterance whose speaker is
      // currently presumed to be the candidate — evaluate: false — without
      // ever calling onTranscript for it. Before D8, this path recorded
      // NOTHING: no card, no log entry.
      sessionOptions.onUtterance({
        speakerTag: 1,
        text: "so how do you handle ambiguity",
        evaluate: false,
      });
    });
    const [rejected] = eventsOfType(state.sessionLogSnapshot(), "question.rejected");
    expect(rejected).toBeTruthy();
    expect(rejected.reason).toBe("speaker identity suppressed");
    expect(eventsOfType(state.sessionLogSnapshot(), "question.added")).toHaveLength(0);
  });
});
