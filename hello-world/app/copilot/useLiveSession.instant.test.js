// @vitest-environment jsdom
//
// AC-P4: the live pipeline's latency contract, tested where it actually
// lives. `localDetection` has its own truth table and `answerStream` has its
// own parser tests -- both as plain functions, no React. What neither touches
// is whether useLiveSession.js WIRES them so that a detected question reaches
// the screen with no awaited network call in front of it. That is a
// composition property: every piece can be individually correct and the hook
// can still `await confirmQuestion(...)` before `setQuestions(...)`, which is
// precisely today's behaviour and precisely what makes the card take seconds
// to appear.
//
// Under the default `environment: "node"` the hook body never runs, so that
// line could be restored at any time and every other test in the suite would
// stay green. Hence the jsdom docblock above -- the same per-file opt-in
// useCopilotDashboard.wiring.test.js already uses, for the same reason (R-166).
//
// The instant-path assertions are built so they CANNOT pass by being fast:
// confirmQuestion is mocked to a promise that never settles. If the hook
// awaits it, the question never appears and the assertion fails outright,
// on any machine, at any speed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/session", () => ({ CopilotSession: vi.fn() }));
vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  draftAnswerStreaming: vi.fn(),
}));

import { useLiveSession } from "./useLiveSession.js";
import { CopilotSession } from "@/lib/copilot/session";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswerStreaming } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT_RESPONSE = {
  points: ["Situation: I led the migration.", "Result: latency fell a third."],
  cues: ["Led migration", "Latency down"],
  buzzwords: [],
  resumeAnchor: null,
  idealProject: null,
  type: "behavioral",
};

// Captures the options CopilotSession was constructed with, so the test can
// drive the hook the way the real capture layer does -- through onTranscript
// -- rather than reaching into the hook's internals.
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
    source: "tab",
    micDeviceId: null,
    profile: "Senior engineer at Acme.",
    posting: null,
    autoDraft: true,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
  });
  onState({ questions, start: live.start });
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
  return { root, container, state };
}

// One interviewer utterance, delivered the way lib/copilot/session.js
// delivers a tab/system final: a finalized frame carrying speech_final.
function speakAsInterviewer(text) {
  sessionOptions.onTranscript({
    speaker: "them",
    transcript: text,
    isFinal: true,
    speechFinal: true,
    start: 0,
    duration: 2,
  });
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
  // NEVER settles. Any implementation that awaits this before showing the
  // card fails the instant-path tests below rather than merely being slow.
  confirmQuestion.mockImplementation(() => new Promise(() => {}));
  draftAnswerStreaming.mockResolvedValue(DRAFT_RESPONSE);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a locally-detected question reaches the screen with no network in front of it (AC-P4.1)", () => {
  it("adds the question card without awaiting anything", async () => {
    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    await act(async () => {
      speakAsInterviewer("Tell me about a time you resolved a conflict.");
    });

    expect(state.questions).toHaveLength(1);
    expect(state.questions[0].question).toMatch(/conflict/i);
    act(() => root.unmount());
  });

  it("spends no detect round trip at all on a local hit", async () => {
    // Not merely "off the critical path" -- not called. The heuristic's
    // cleaned question is already what the embedded engine ships to users,
    // so a confirm here would be a second opinion nobody reads, at the cost
    // of a model call per question.
    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("What would you say your biggest weakness is?");
    });

    expect(confirmQuestion).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("starts drafting the answer in the same beat", async () => {
    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("Tell me about a time you disagreed with your manager.");
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(draftAnswerStreaming.mock.calls[0][0].question).toMatch(/disagreed/i);
    act(() => root.unmount());
  });

  it("carries the type the local classifier assigned", async () => {
    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("Tell me about a time you missed a deadline.");
    });

    expect(state.questions[0].type).toBe("behavioral");
    act(() => root.unmount());
  });
});

describe("the LLM confirm still covers what the heuristic misses (AC-P1.3)", () => {
  it("asks the model about a long utterance with no interrogative cue", async () => {
    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("I'd be interested to hear more about the migration you mentioned");
    });

    expect(confirmQuestion).toHaveBeenCalledTimes(1);
    // Nothing on screen yet -- correct, the model has not answered.
    expect(state.questions).toHaveLength(0);
    act(() => root.unmount());
  });

  it("spends nothing on a short acknowledgement", async () => {
    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("Got it thanks");
    });

    expect(confirmQuestion).not.toHaveBeenCalled();
    expect(draftAnswerStreaming).not.toHaveBeenCalled();
    expect(state.questions).toHaveLength(0);
    act(() => root.unmount());
  });
});

describe("bullets land on the card as they stream (AC-P4.2)", () => {
  it("renders partial points before the draft finishes", async () => {
    let emit;
    draftAnswerStreaming.mockImplementation((_args, { onPoints } = {}) => {
      emit = onPoints;
      return new Promise(() => {}); // never resolves -- only the stream lands
    });

    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("Tell me about a time you led a migration.");
    });

    await act(async () => {
      emit(["Situation: I led the checkout migration."]);
    });

    expect(state.questions[0].points).toEqual(["Situation: I led the checkout migration."]);
    act(() => root.unmount());
  });

  it("settles on the complete answer once the draft resolves", async () => {
    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("Tell me about a time you led a migration.");
    });
    await act(async () => {});

    expect(state.questions[0].status).toBe("done");
    expect(state.questions[0].points).toEqual(DRAFT_RESPONSE.points);
    expect(state.questions[0].cues).toEqual(DRAFT_RESPONSE.cues);
    act(() => root.unmount());
  });

  it("caches only the completed draft, never a partial one (AC-P4.4)", async () => {
    // A cache hit that serves half an answer is worse than a miss: it is
    // instant, confident, and wrong. The same question asked twice must get
    // the whole thing the second time.
    let emit;
    let settle;
    draftAnswerStreaming.mockImplementation((_args, { onPoints } = {}) => {
      emit = onPoints;
      return new Promise((resolve) => {
        settle = resolve;
      });
    });

    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("Tell me about a time you led a migration.");
    });
    await act(async () => {
      emit(["Situation: partial only."]);
    });

    // Second, identical question while the first draft is still streaming.
    await act(async () => {
      speakAsInterviewer("So, tell me about a time you led a migration.");
    });
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(2);

    await act(async () => {
      settle(DRAFT_RESPONSE);
    });
    act(() => root.unmount());
  });

  it("shows an error state when the stream fails", async () => {
    draftAnswerStreaming.mockRejectedValue(new Error("upstream exploded"));
    const { root, state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("Tell me about a time you led a migration.");
    });
    await act(async () => {});

    expect(state.questions[0].status).toBe("error");
    expect(state.questions[0].error).toMatch(/upstream exploded/);
    act(() => root.unmount());
  });
});
