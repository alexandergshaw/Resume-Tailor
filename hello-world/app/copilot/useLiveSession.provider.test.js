// @vitest-environment jsdom
//
// AC-W1.3. The wiring claim, and the one no pure module can make: that the
// provider a live session actually connected to reaches the log the user
// downloads.
//
// A real session log recorded on 2026-08-25 rendered "- Provider: unknown"
// directly above the warning "Your configured speech-to-text provider can't
// tell speakers apart on a single microphone". The log named the consequence
// and withheld the cause. Under the default `environment: "node"` the hook
// body never runs, so a fix that gets `createSttStream` and `setProvider`
// right and the plumbing between them wrong would leave both of their suites
// green; hence the per-file jsdom opt-in and the CopilotSession-mock harness
// useLiveSession.cues.test.js established.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/session", () => ({ CopilotSession: vi.fn() }));
vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import { useLiveSession } from "./useLiveSession.js";
import { renderSessionLogMarkdown } from "@/lib/copilot/sessionLog";
import { CopilotSession } from "@/lib/copilot/session";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    autoDraft: false,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
  });
  onState({ start: live.start, stop: live.stop, sessionLogSnapshot: live.sessionLogSnapshot });
  return null;
}

const mounted = [];

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Probe, { onState: (s) => Object.assign(state, s) }));
  });
  return { state };
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
  draftAnswer.mockResolvedValue({ points: [] });
  confirmQuestion.mockResolvedValue({ isQuestion: false });
});

afterEach(() => {
  while (mounted.length) {
    const { root, container } = mounted.pop();
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

describe("useLiveSession records which provider the session ran on (AC-W1.3)", () => {
  it("puts the reported provider into the downloadable log", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    // The session learns this a network round trip after start(), which is
    // exactly why the log has to be told rather than constructed with it.
    await act(async () => {
      sessionOptions.onSttProvider("elevenlabs");
    });

    expect(state.sessionLogSnapshot().provider).toBe("elevenlabs");
    expect(renderSessionLogMarkdown(state.sessionLogSnapshot())).toContain(
      "- Provider: elevenlabs",
    );
  });

  it("still says unknown when the session never reported one", async () => {
    // The honest-absence case, and the boundary that makes the case above
    // mean something: nothing invents a provider name, and a session whose
    // socket never resolved still renders a readable log.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    expect(renderSessionLogMarkdown(state.sessionLogSnapshot())).toContain("- Provider: unknown");
  });

  it("keeps the session.start entry that startLog() exists to guarantee", async () => {
    // startLog() runs at the very top of start(), before any other reset, so
    // that a session which fails moments later still explains what it was.
    // Learning the provider later must not have been bought by moving that.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      sessionOptions.onSttProvider("deepgram");
    });

    const snap = state.sessionLogSnapshot();
    expect(snap.events[0].type).toBe("session.start");
    expect(snap.provider).toBe("deepgram");
  });

  it("reports the provider of the CURRENT session, never the previous one", async () => {
    // startLog() builds a fresh log per session. A provider left over from a
    // previous run would mislabel the very next download — the failure mode
    // is a log that looks authoritative and is wrong, which is worse than the
    // "unknown" it replaces.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      sessionOptions.onSttProvider("elevenlabs");
    });
    await act(async () => {
      await state.stop();
    });
    await act(async () => {
      await state.start();
    });

    expect(state.sessionLogSnapshot().provider).toBeUndefined();
  });
});
