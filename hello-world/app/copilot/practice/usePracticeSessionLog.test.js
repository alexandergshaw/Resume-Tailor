// @vitest-environment jsdom
//
// AC-Q7: the WIRING half of practice mode's "download a log of this
// session" — the recorder (lib/copilot/sessionLog.js) and the archive
// builder (lib/copilot/sessionLogArchive.js) are already covered by their
// own tests and are reused here unmodified. Mirrors
// app/copilot/useLiveSession.log.test.js's own discipline: a probe mounted
// with react-dom/client's createRoot and React 19's `act`, the network/
// archive module mocked, and assertions made only through the hook's own
// returned surface (sessionLogSnapshot()/downloadLog()/hasLog/onStart) —
// never on an internal, never on a prop having merely been passed.
//
// usePracticeSessionLog OBSERVES reactive values instead of owning the
// capture/question/answer pipelines itself (those three hooks are not among
// this feature's files — see usePracticeSessionLog.js's own header), so
// this harness drives it the same way PracticeClient's real re-renders
// would: by re-rendering the probe with updated props as
// usePracticeCaptureSession/usePracticeQuestions/usePracticeAnswer's own
// state would actually change.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/sessionLogArchive", () => ({
  downloadSessionLogArchive: vi.fn(() => Promise.resolve()),
}));

import { usePracticeSessionLog } from "./usePracticeSessionLog.js";
import { downloadSessionLogArchive } from "@/lib/copilot/sessionLogArchive";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_PROPS = {
  start: () => {},
  posting: null,
  interviewType: "general",
  currentQuestionText: "",
  questionError: "",
  finals: [],
  captureError: "",
  captureWarning: "",
  answering: false,
  answerMetrics: null,
  critique: null,
  critiqueStatus: "idle",
  critiqueError: "",
};

function Probe({ hookProps, onState }) {
  const state = usePracticeSessionLog(hookProps);
  onState(state);
  return null;
}

// Drives the hook by re-rendering with an evolving props object, the same
// way PracticeClient's own composed state actually changes over time —
// `update` merges onto whatever is currently mounted rather than resetting
// to BASE_PROPS each time, so a sequence of updates reads like a real
// session unfolding.
function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const captured = {};
  let current = { ...BASE_PROPS };

  function renderNow() {
    act(() => {
      root.render(createElement(Probe, { hookProps: current, onState: (s) => Object.assign(captured, s) }));
    });
  }
  renderNow();

  return {
    captured,
    update(patch) {
      current = { ...current, ...patch };
      renderNow();
      return captured;
    },
  };
}

function eventsOfType(snapshot, type) {
  return (snapshot?.events || []).filter((e) => e.type === type);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("opening the log (AC-Q7.1)", () => {
  it("opens a fresh log with mode: practice the moment Start is pressed, and calls the real start", () => {
    const start = vi.fn();
    const { captured, update } = mountProbe();
    update({ start });

    expect(captured.hasLog).toBe(false);
    act(() => captured.onStart());

    expect(captured.hasLog).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    const snap = captured.sessionLogSnapshot();
    expect(snap).toBeTruthy();
    expect(snap.mode).toBe("practice");
    expect(eventsOfType(snap, "session.start")).toHaveLength(1);
  });

  it("throws nothing when asked for a log before any session ran", () => {
    const { captured } = mountProbe();
    expect(() => captured.sessionLogSnapshot()).not.toThrow();
    expect(captured.sessionLogSnapshot()).toBeNull();
  });

  it("does not let a second session's log inherit the first one's events", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ finals: [{ id: 1, speaker: "you", text: "first session speech", at: 1 }] });
    expect(eventsOfType(captured.sessionLogSnapshot(), "transcript")).toHaveLength(1);

    act(() => captured.onStart()); // a fresh "Start practice" press
    const snap2 = captured.sessionLogSnapshot();
    expect(eventsOfType(snap2, "transcript")).toHaveLength(0);
    expect(eventsOfType(snap2, "session.start")).toHaveLength(1);
  });

  it("counts a fresh session's transcript frames from zero, not from where the last session left off", () => {
    // The fragile way to get this wrong: track "how many finals have been
    // logged so far" without resetting that counter on a new session, which
    // silently swallows the new session's first N frames once N ==
    // whatever the previous session already logged.
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({
      finals: [
        { id: 1, speaker: "you", text: "a", at: 1 },
        { id: 2, speaker: "you", text: "b", at: 2 },
        { id: 3, speaker: "you", text: "c", at: 3 },
      ],
    });
    expect(eventsOfType(captured.sessionLogSnapshot(), "transcript")).toHaveLength(3);

    act(() => captured.onStart());
    update({ finals: [] }); // usePracticeCaptureSession resets `finals` on start()
    update({ finals: [{ id: 1, speaker: "you", text: "only this one", at: 1 }] });
    const frames = eventsOfType(captured.sessionLogSnapshot(), "transcript");
    expect(frames).toHaveLength(1);
    expect(frames[0].text).toBe("only this one");
  });
});

describe("what gets recorded (AC-Q7.2)", () => {
  it("records each question served, but not the same text served twice in a row", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ currentQuestionText: "Tell me about a conflict." });
    update({ currentQuestionText: "Tell me about a conflict." }); // unrelated re-render, same text
    update({ currentQuestionText: "Describe a time you led." });

    const served = eventsOfType(captured.sessionLogSnapshot(), "question.served");
    expect(served.map((e) => e.question)).toEqual([
      "Tell me about a conflict.",
      "Describe a time you led.",
    ]);
  });

  it("records each finalized transcript frame, in order, with its own text", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ finals: [{ id: 1, speaker: "you", text: "first line", at: 1 }] });
    update({
      finals: [
        { id: 1, speaker: "you", text: "first line", at: 1 },
        { id: 2, speaker: "you", text: "second line", at: 2 },
      ],
    });

    const frames = eventsOfType(captured.sessionLogSnapshot(), "transcript");
    expect(frames.map((f) => f.text)).toEqual(["first line", "second line"]);
    expect(frames.every((f) => f.isFinal === true)).toBe(true);
  });

  it("records when an answer recording starts and stops", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ answering: true });
    update({ answering: false });

    const snap = captured.sessionLogSnapshot();
    expect(eventsOfType(snap, "answer.recording.start")).toHaveLength(1);
    expect(eventsOfType(snap, "answer.recording.stop")).toHaveLength(1);
  });

  it("records the delivery metrics derived for an answer", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    const metrics = { wpm: 118, fillerRate: 0.03 };
    update({ answerMetrics: metrics });

    const events = eventsOfType(captured.sessionLogSnapshot(), "answer.metrics");
    expect(events).toHaveLength(1);
    expect(events[0].metrics.wpm).toBe(118);
  });

  it("records the critique returned for an answer", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ critique: { score: 82, strengths: ["Clear structure"] }, critiqueStatus: "done" });

    const events = eventsOfType(captured.sessionLogSnapshot(), "answer.critique");
    expect(events).toHaveLength(1);
    expect(events[0].critique.score).toBe(82);
  });

  it("records a critique failure as a failure, not as silence", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ critiqueStatus: "error", critiqueError: "Could not analyze this answer." });

    const events = eventsOfType(captured.sessionLogSnapshot(), "answer.critique.error");
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Could not analyze this answer.");
  });

  it("records a question-fetch error the user was shown", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ questionError: "Could not get the next question." });

    const events = eventsOfType(captured.sessionLogSnapshot(), "question.error");
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Could not get the next question.");
  });

  it("records a session error and warning the user was shown", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ captureError: "Could not start practice." });
    update({ captureWarning: "Your camera stopped sending frames." });

    const snap = captured.sessionLogSnapshot();
    expect(eventsOfType(snap, "session.error")).toHaveLength(1);
    expect(eventsOfType(snap, "session.warning")).toHaveLength(1);
  });
});

describe("posting and interview type as context (AC-Q7.3)", () => {
  it("records the selected posting and interview type once, by id and name only", () => {
    const posting = {
      id: "app-1",
      title: "Backend Engineer",
      company: "Acme",
      description: "the full posting body, several paragraphs long",
    };
    const { captured, update } = mountProbe();
    update({ posting, interviewType: "behavioral" });
    act(() => captured.onStart());

    const snap = captured.sessionLogSnapshot();
    const started = eventsOfType(snap, "session.start");
    expect(started).toHaveLength(1);
    expect(started[0].posting).toEqual({ id: "app-1", name: "Backend Engineer" });
    expect(started[0].interviewType).toBe("behavioral");
    // Never the posting's own description text anywhere in the log.
    expect(JSON.stringify(snap)).not.toContain("the full posting body");
  });

  it("records nothing about a résumé or cover letter — this hook is never handed either", () => {
    // There is no prop through which document text could even reach this
    // hook (see usePracticeSessionLog.js's own signature) — this test pins
    // that as a contract, not just an accident of what happens to be wired
    // today.
    const posting = { id: "app-2", title: "Data Analyst" };
    const { captured, update } = mountProbe();
    update({ posting, interviewType: "general" });
    act(() => captured.onStart());
    const started = eventsOfType(captured.sessionLogSnapshot(), "session.start")[0];
    expect(Object.keys(started.posting).sort()).toEqual(["id", "name"]);
  });
});

describe("downloading it (AC-Q7.4)", () => {
  it("hands the CURRENT snapshot to the archive, on one call", async () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ finals: [{ id: 1, speaker: "you", text: "hello there", at: 1 }] });

    await act(async () => {
      await captured.downloadLog();
    });

    expect(downloadSessionLogArchive).toHaveBeenCalledTimes(1);
    const passed = downloadSessionLogArchive.mock.calls[0][0];
    expect(passed.mode).toBe("practice");
    expect(eventsOfType(passed, "transcript")).toHaveLength(1);
  });

  it("still downloads after the session has been stopped", async () => {
    // "Stop" tears down usePracticeCaptureSession's own state; nothing in
    // this hook is wired to session status, so the log it already opened
    // simply keeps existing.
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ finals: [{ id: 1, speaker: "you", text: "hello there", at: 1 }] });
    update({ answering: false }); // no-op transition, standing in for "session stopped"

    await act(async () => {
      await captured.downloadLog();
    });

    expect(downloadSessionLogArchive).toHaveBeenCalledTimes(1);
    expect(eventsOfType(downloadSessionLogArchive.mock.calls[0][0], "transcript")).toHaveLength(1);
  });

  it("does not blow up when asked to download before any session ran", async () => {
    const { captured } = mountProbe();
    await act(async () => {
      await captured.downloadLog();
    });
    // Declining silently (rather than throwing) is the implementer's call,
    // mirroring useLiveSession.log.test.js's own equivalent case — but it
    // must not have handed `downloadSessionLogArchive` a null/undefined
    // snapshot either.
    expect(downloadSessionLogArchive).not.toHaveBeenCalled();
  });
});
