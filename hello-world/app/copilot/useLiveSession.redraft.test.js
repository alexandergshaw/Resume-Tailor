// @vitest-environment jsdom
//
// AC-A15, allocated by plan-chunk-a.md §A.6: the one load-bearing check
// inside redraftCurrentAnswer() that no other file in this chunk's gate can
// reach — `sessionRef.current`, not `live` and not "a question entry
// exists". A `useRef` cannot freeze into a stale closure the way
// render-scope state can, and that is exactly what stops a BILLED model
// call firing into an unmounted branch after a finished session: `stop()`
// (useLiveSession.js) never clears `questions`, and
// `pinnedQuestionEntry(list, null)` (lib/copilot/currentQuestion.js) falls
// back to the LATEST entry rather than returning nothing. Without the
// sessionRef check, redrafting after Stop — or before a session has ever
// started, with a manually-typed question already on screen — would
// silently re-bill for whatever question happened to be last.
//
// lib/copilot/choiceChangeInvalidation.test.js covers the `canRedraft`
// BOOLEAN that decides whether CopilotClient's subscriber calls this
// function at all; it cannot reach the ref inside this function, which is
// the check that survives a stale closure where the boolean does not.
//
// Harness borrowed verbatim from useLiveSession.manual.test.js (same
// CopilotSession/draftAnswer mocks, same Probe-mount pattern) — under the
// default `environment: "node"` this hook's body never runs, so this file
// opts into jsdom exactly as that one does.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/session", () => ({ CopilotSession: vi.fn() }));
vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import { useLiveSession } from "./useLiveSession.js";
import { CopilotSession } from "@/lib/copilot/session";
import { draftAnswer } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT_RESPONSE = {
  points: ["Situation: I led the migration."],
  cues: [],
  buzzwords: [],
  resumeAnchor: null,
  idealProject: null,
  type: "behavioral",
};

const QUESTION = "Tell me about a time you handled conflict.";

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
    source: "tab",
    micDeviceId: null,
    profile: "",
    posting: null,
    // Off, deliberately: every draftAnswer call in this file must be the one
    // this test explicitly triggers, not a side effect of adding a question.
    autoDraft: false,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
  });
  onState({ ...live, questions });
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
  CopilotSession.mockImplementation(function () {
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
  draftAnswer.mockResolvedValue(DRAFT_RESPONSE);
});

afterEach(() => {
  while (mounted.length) {
    const { root, container } = mounted.pop();
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

describe("redraftCurrentAnswer is gated on sessionRef.current, not on a question entry existing (AC-A15)", () => {
  it("fires no model call when no session has ever run, even with a question already on screen", async () => {
    const { state } = mountProbe();
    // Manual entry (AC-O2) works with no capture pipeline at all — exactly
    // the shape of a stale entry `pinnedQuestionEntry` would still resolve
    // against with no session running.
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    expect(state.questions).toHaveLength(1);
    expect(draftAnswer).not.toHaveBeenCalled();

    await act(async () => {
      state.redraftCurrentAnswer();
    });
    expect(draftAnswer).not.toHaveBeenCalled();
  });

  it("calls runDraft once, forced, once a session is actually live", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    expect(draftAnswer).not.toHaveBeenCalled(); // autoDraft is off — the positive control

    await act(async () => {
      state.redraftCurrentAnswer();
    });
    expect(draftAnswer).toHaveBeenCalledTimes(1);
    expect(draftAnswer.mock.calls[0][0]).toMatchObject({ question: QUESTION });
  });

  it("stops firing once the session is stopped, even though the question stays on screen", async () => {
    // stop() never clears `questions` — this is the exact scenario the
    // sessionRef check exists to prevent from re-billing.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    await act(async () => {
      await state.stop();
    });
    expect(state.questions).toHaveLength(1);

    await act(async () => {
      state.redraftCurrentAnswer();
    });
    expect(draftAnswer).not.toHaveBeenCalled();
  });
});
