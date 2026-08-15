// @vitest-environment jsdom
//
// AC-Q7.8/Q7.9/Q7.10 — an adversarial review flagged that pressing Start
// again while a previous practice session is still live can leak the OLD
// session's transcript into the NEW session's log. usePracticeCaptureSession
// (AC-C3/AC-C4) and usePracticeSessionLog (AC-Q7) are two separate hooks,
// each individually correct in isolation; this file wires them together the
// same way PracticeClient.js actually does (sessionLog's `start` IS capture's
// `start`, sessionLog observes capture's `finals`), because the suspected
// defect is a COMPOSITION bug — the exact class useCopilotDashboard.wiring.
// test.js's own header documents as invisible to per-hook unit tests.
//
// Harness borrowed from useLiveSession.log.test.js: jsdom opt-in, createRoot
// + React 19 `act`, the real network/session class mocked at the module
// boundary, assertions made only through the two hooks' own returned
// surface.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/practiceSession", () => ({ PracticeSession: vi.fn() }));

import { usePracticeCaptureSession } from "./usePracticeCaptureSession.js";
import { usePracticeSessionLog } from "./usePracticeSessionLog.js";
import { PracticeSession } from "@/lib/copilot/practiceSession";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function noop() {}

// Every constructed session's own `options`, in construction order, so a
// test can drive a SPECIFIC instance's onTranscript/onStatus/onError deep
// into a later session's lifetime — modeling "the old session is still
// delivering callbacks while a new one is starting up".
let sessionOptionsList = [];

function Probe({ onState }) {
  const [status, setStatus] = useState("idle");
  const capture = usePracticeCaptureSession({
    status,
    setStatus,
    micDeviceId: null,
    invalidateAndClearLoading: noop,
    abandonInProgressAnswer: noop,
    resetAnswerState: noop,
    invalidateInFlight: noop,
    clearForNewSession: noop,
    resetForSession: noop,
    resetDashboardForSession: noop,
    requestQuestion: noop,
    recordTranscriptEvent: noop,
    recordSpeechSample: noop,
    markMicMuted: noop,
    onUtterance: noop,
  });
  const sessionLog = usePracticeSessionLog({
    start: capture.start,
    posting: { id: "p1", title: "Staff Engineer" },
    interviewType: "behavioral",
    currentQuestionText: "",
    questionError: "",
    finals: capture.finals,
    activeSessionId: capture.activeSessionId,
    captureError: capture.error,
    captureWarning: capture.warning,
    answering: false,
    answerMetrics: null,
    critique: null,
    critiqueStatus: "idle",
    critiqueError: "",
  });
  onState({ ...capture, ...sessionLog, status });
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

function eventsOfType(snapshot, type) {
  return (snapshot?.events || []).filter((e) => e.type === type);
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function speak(options, text) {
  options.onTranscript({
    transcript: text,
    isFinal: true,
    start: 0,
    duration: 1,
    textAlreadyDelivered: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionOptionsList = [];
  PracticeSession.mockImplementation(function (options) {
    sessionOptionsList.push(options);
    this.start = vi.fn().mockResolvedValue(undefined);
    // AC-Q7.9's whole point: this models PracticeSession.stop() FAITHFULLY
    // (lib/copilot/practiceSession.js:301-338) — it awaits real async work
    // (there, `this._pipeline.stop()`) BEFORE calling `onStatus("idle")`, so
    // a render can land inside that await window exactly like it can for the
    // real pipeline. A stop() that resolved synchronously would model a
    // different, un-buggy world and could never exercise this path.
    this.stop = vi.fn(async () => {
      await flushMicrotasks();
      options.onStatus("idle");
    });
    this.setCameraOff = vi.fn();
    this.setMicMuted = vi.fn();
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("restarting without stopping first (AC-Q7.8/Q7.9)", () => {
  it("does not carry the previous session's transcript into the new session's log", async () => {
    const { state } = mountProbe();

    // First session: starts, speaks one turn.
    await act(async () => {
      state.onStart();
      await flushMicrotasks();
    });
    await act(async () => {
      speak(sessionOptionsList[0], "tell me about a time you led a migration");
      await flushMicrotasks();
    });
    expect(eventsOfType(state.sessionLogSnapshot(), "transcript")).toHaveLength(1);

    // Second press WITHOUT Stop — the path the source comment in
    // usePracticeCaptureSession.js explicitly supports ("Idempotent: a stray
    // session ... must never be orphaned by pressing Start again"). The old
    // session's own stop() is still in flight (see the mock above) while the
    // new log has already been installed by onStart, synchronously, before
    // start() was even called.
    await act(async () => {
      state.onStart();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    // AC-Q7.8: the new log must contain ONLY the new session's events — not
    // one line of the first session's transcript.
    const snap = state.sessionLogSnapshot();
    expect(eventsOfType(snap, "transcript")).toHaveLength(0);
    expect(eventsOfType(snap, "session.start")).toHaveLength(1);

    // And the new (second) session must still be able to log its own turns.
    await act(async () => {
      speak(sessionOptionsList[1], "describe a conflict you resolved");
      await flushMicrotasks();
    });
    const finalSnap = state.sessionLogSnapshot();
    expect(eventsOfType(finalSnap, "transcript")).toHaveLength(1);
    expect(eventsOfType(finalSnap, "transcript")[0].text).toContain("conflict");
  });

  // AC-Q7.8/Q7.9 — the sharpest reproduction of the reviewed defect: a
  // STRAGGLER final message the OLD session's socket was already about to
  // deliver (queued before `.close()`, delivered after) lands DURING the
  // await window `start()` sits in while tearing the old session down —
  // i.e. AFTER onStart has zeroed loggedFinalsCountRef and installed the
  // new log, but BEFORE start()'s own `setFinals([])` runs. Without
  // AC-Q7.9's per-session identity, this stray frame (and the earlier one
  // already sitting in `finals`) gets attributed to the brand-new log
  // purely because the counter was already at 0 when this render lands.
  it("does not attribute a straggler final from the OLD session's socket to the new log", async () => {
    const { state } = mountProbe();

    await act(async () => {
      state.onStart();
      await flushMicrotasks();
    });
    await act(async () => {
      speak(sessionOptionsList[0], "already spoken before the restart");
      await flushMicrotasks();
    });
    expect(eventsOfType(state.sessionLogSnapshot(), "transcript")).toHaveLength(1);

    // Second press, synchronous: onStart's own resets (fresh log, counter
    // zeroed) happen HERE, before start()'s await ever begins.
    act(() => {
      state.onStart();
    });
    // The OLD session's own onTranscript closure is still live — this is
    // exactly what a message already in flight on the old socket at the
    // moment `.close()` was called would do.
    await act(async () => {
      speak(sessionOptionsList[0], "STRAGGLER — arrived after Start was pressed again");
      await flushMicrotasks();
      await flushMicrotasks();
      await flushMicrotasks();
    });

    const snap = state.sessionLogSnapshot();
    expect(eventsOfType(snap, "transcript")).toHaveLength(0);
  });
});

describe("positive controls — the fix must not just stop logging transcripts (AC-Q7.10)", () => {
  it("Stop-then-Start still opens a clean log for the new session", async () => {
    const { state } = mountProbe();

    await act(async () => {
      state.onStart();
      await flushMicrotasks();
    });
    await act(async () => {
      speak(sessionOptionsList[0], "first session turn");
      await flushMicrotasks();
    });
    expect(eventsOfType(state.sessionLogSnapshot(), "transcript")).toHaveLength(1);

    await act(async () => {
      await state.stop();
    });
    await act(async () => {
      state.onStart();
      await flushMicrotasks();
    });

    expect(eventsOfType(state.sessionLogSnapshot(), "transcript")).toHaveLength(0);

    await act(async () => {
      speak(sessionOptionsList[1], "second session turn");
      await flushMicrotasks();
    });
    const snap = state.sessionLogSnapshot();
    expect(eventsOfType(snap, "transcript")).toHaveLength(1);
    expect(eventsOfType(snap, "transcript")[0].text).toBe("second session turn");
  });

  it("a genuine second session (started only after the first fully stopped) records its own transcript in full", async () => {
    const { state } = mountProbe();

    await act(async () => {
      state.onStart();
      await flushMicrotasks();
    });
    await act(async () => {
      speak(sessionOptionsList[0], "alpha");
      await flushMicrotasks();
      speak(sessionOptionsList[0], "beta");
      await flushMicrotasks();
    });
    expect(eventsOfType(state.sessionLogSnapshot(), "transcript")).toHaveLength(2);

    await act(async () => {
      await state.stop();
    });
    await act(async () => {
      state.onStart();
      await flushMicrotasks();
    });
    await act(async () => {
      speak(sessionOptionsList[1], "gamma");
      await flushMicrotasks();
      speak(sessionOptionsList[1], "delta");
      await flushMicrotasks();
    });

    const snap = state.sessionLogSnapshot();
    const turns = eventsOfType(snap, "transcript").map((e) => e.text);
    expect(turns).toEqual(["gamma", "delta"]);
  });
});
