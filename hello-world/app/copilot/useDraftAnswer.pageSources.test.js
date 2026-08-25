// @vitest-environment jsdom
//
// ARCH §3.5/§4e/§4f/§6.8: two claims about `pageSources` that only a real
// render of useDraftAnswer.js's runDraft can prove — a source-text read
// cannot, the same reasoning every other useLiveSession/useDraftAnswer wiring
// test in this suite gives for its own claim.
//
//   1. A fresh streaming draft's terminal `done` frame carries `pageSources`
//      through to the question entry runDraft writes, and from there
//      through to what lib/copilot/answerPoints.js's answerLines() (the one
//      function AnswerLines.js actually renders) resolves per line — this is
//      "the done frame's pageSources reach the rendered lines" traced across
//      the real client boundary, not asserted against a hand-built line.
//   2. A CACHE HIT for the same question still carries `pageSources` — this
//      is the sabotage target named in ARCH §4f/§6.8: rendering the field
//      without caching it ships an answer that shows its citations when
//      freshly drafted and silently loses them the second time the same
//      question is asked. Proven here by asserting the streaming client is
//      called exactly ONCE across two runDraft calls for the same question,
//      so the second assertion cannot be satisfied by a second real fetch.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  draftAnswerStreaming: vi.fn(),
}));

import { useDraftAnswer } from "./useDraftAnswer.js";
import { draftAnswerStreaming } from "@/lib/copilot/answerClient";
import { answerLines } from "@/lib/copilot/answerPoints.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAGE = { id: "p1", title: "Payments migration" };

const DONE_FRAME = {
  points: ["We moved settlement onto Kafka."],
  cues: ["The migration"],
  buzzwords: [],
  resumeAnchor: null,
  idealProject: null,
  pageSources: [PAGE],
  type: "behavioral",
};

function seedQuestion(id, question) {
  return {
    id,
    question,
    at: Date.now(),
    status: "idle",
    points: null,
    cues: [],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    pageSources: [],
    type: null,
    error: "",
  };
}

function Probe({ onState }) {
  const [questions, setQuestions] = useState([]);
  const answerCacheRef = useRef(new Map());
  const draftGenRef = useRef(0);
  const runDraft = useDraftAnswer({
    profile: "Senior engineer, payments.",
    posting: null,
    answerCacheRef,
    draftGenRef,
    buildContext: () => "",
    setQuestions,
    logEvent: () => {},
  });
  onState({ questions, setQuestions, runDraft });
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

beforeEach(() => {
  vi.clearAllMocks();
  draftAnswerStreaming.mockResolvedValue(DONE_FRAME);
});

describe("useDraftAnswer — pageSources on a fresh draft reach the rendered lines", () => {
  it("carries the done frame's pageSources onto the question entry and into answerLines' output", async () => {
    const { root, state } = mountProbe();
    act(() => {
      state.setQuestions([seedQuestion(1, "Tell me about a time you sharded a ledger.")]);
    });
    await act(async () => {
      await state.runDraft(1, "Tell me about a time you sharded a ledger.");
    });

    expect(state.questions[0].status).toBe("done");
    expect(state.questions[0].pageSources).toEqual([PAGE]);

    // This is the actual function AnswerLines.js calls to build what it
    // renders — proving the field survives into ITS output, not merely
    // sitting unused on the state object.
    const lines = answerLines(state.questions[0].cues, state.questions[0].points, state.questions[0].pageSources);
    expect(lines[0].pageSource).toEqual(PAGE);

    act(() => root.unmount());
  });
});

describe("useDraftAnswer — a cache HIT still carries pageSources (ARCH §4f/§6.8)", () => {
  it("does not lose citations on the second ask for the same question", async () => {
    const { root, state } = mountProbe();
    const question = "Tell me about a time you sharded a ledger.";

    act(() => {
      state.setQuestions([seedQuestion(1, question)]);
    });
    await act(async () => {
      await state.runDraft(1, question);
    });
    expect(state.questions[0].pageSources).toEqual([PAGE]);
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);

    // A second, later card for the SAME normalized question — e.g. the
    // interviewer circling back — must be served from answerCacheRef, not a
    // fresh network call: asserting call count stays at 1 is what makes this
    // a genuine cache-hit test rather than one that happens to pass because
    // the mock returns the same thing every time.
    act(() => {
      state.setQuestions((prev) => [...prev, seedQuestion(2, question)]);
    });
    await act(async () => {
      await state.runDraft(2, question);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    const second = state.questions.find((q) => q.id === 2);
    expect(second.status).toBe("done");
    expect(second.cached).toBe(true);
    // The sabotage target: a cache write that dropped pageSources would
    // still pass every OTHER assertion in this test (points/cues/status all
    // reuse fine) while this one alone goes red.
    expect(second.pageSources).toEqual([PAGE]);

    act(() => root.unmount());
  });
});
