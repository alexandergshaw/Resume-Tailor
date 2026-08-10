// @vitest-environment jsdom
//
// Every OTHER file in this suite runs under vitest.config.js's default
// `environment: "node"`, which has no DOM at all -- so no test anywhere else
// in this repo can mount a React component or run a hook's effects. That is
// exactly why this one file, and only this file, opts into jsdom via the
// docblock above (a per-file override; it does not touch the global config).
//
// The gap this closes: `speculativeWorkEnabled` (lib/copilot/predictionPrefs.js)
// has its own truth-table test, and `resolveDashboardState`
// (useCopilotDashboard.js) has its own idle-forcing test -- both exercised as
// PLAIN FUNCTIONS, no React involved. What neither one touches is whether
// useCopilotDashboard.js actually WIRES them together:
//
//     const speculate = speculativeWorkEnabled(active, predictionsEnabled);
//
// and then gates the prediction effect, the pre-draft effect, both
// resolveDashboardState calls, and both retry callbacks on that one value.
// Under `environment: "node"` the hook body never runs, so inverting that one
// line -- e.g. hardcoding `speculativeWorkEnabled(active, true)`, silently
// dropping the predictionsEnabled half -- leaves every other test in the
// suite GREEN. That gap was reported honestly and recorded as regression
// case R-166: two individually-correct, individually-tested halves can still
// be wired together wrong, and nothing here previously caught it.
//
// This file exists to catch exactly that class of bug -- a composition
// defect, not a logic defect -- by rendering the REAL hook with `react-dom`
// and asserting on OBSERVABLE OUTBOUND WORK (whether the two network-call
// modules actually got called), not on internals. Predictions kept firing
// while hidden means the user pays for the model calls (pre-drafting roughly
// doubles what a detected question costs) with nothing on screen to show for
// it -- a silent bill instead of a saved one.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useCopilotDashboard } from "./useCopilotDashboard.js";

vi.mock("@/lib/copilot/questionClient", () => ({
  fetchNextQuestion: vi.fn(),
}));
vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
}));

import { fetchNextQuestion } from "@/lib/copilot/questionClient";
import { draftAnswer } from "@/lib/copilot/answerClient";

// React's act() checks this global before flushing passive effects outside
// of a recognized testing environment; without it every act() call above
// would still work but would additionally console.error a warning on each
// call.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Non-empty on both counts, so predictionSignatureFor (useCopilotDashboard.js)
// yields a non-empty signature and the prediction effect actually has
// something to key off -- an empty signature is itself the idle sentinel and
// would make every row of the truth table below trivially "never called" for
// the wrong reason.
const QUESTIONS = [{ question: "Tell me about yourself" }];
const POSTING = { title: "Backend Engineer", company: "Acme", description: "Build things" };

// Shapes fetchNextQuestion/draftAnswer actually resolve with in production --
// read from questionClient.js's and answerClient.js's own doc comments
// (`{ question, type, source, exhausted }` and
// `{ points, cues, buzzwords, resumeAnchor, idealProject, type, grounding }`)
// rather than guessed, since the hook awaits both and reads fields off the
// result: a mock returning the wrong shape sends the hook into its own catch
// block and would silently mask the very wiring this file exists to check.
const PREDICTION_RESPONSE = {
  question: "What is your greatest strength?",
  type: "behavioral",
  source: "gemini",
  exhausted: false,
};
const DRAFT_RESPONSE = {
  points: ["Point A", "Point B"],
  cues: ["Cue A", "Cue B"],
  buzzwords: [],
  resumeAnchor: null,
  idealProject: null,
  type: "behavioral",
  grounding: null,
};

// A minimal probe -- it renders nothing observable itself; every assertion
// below is against the fetchNextQuestion/draftAnswer mocks, not against this
// component's output or the hook's return value.
function Probe(props) {
  useCopilotDashboard(props);
  return null;
}

function baseProps(overrides) {
  return {
    questions: QUESTIONS,
    posting: POSTING,
    applicationId: null,
    autoDraft: false,
    profile: "test profile",
    onPrefetchedAnswer: undefined,
    active: false,
    predictionsEnabled: true,
    ...overrides,
  };
}

let container;
let root;

beforeEach(() => {
  vi.clearAllMocks();
  fetchNextQuestion.mockResolvedValue(PREDICTION_RESPONSE);
  draftAnswer.mockResolvedValue(DRAFT_RESPONSE);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

// An empty async act() callback still drives React's act-queue flush loop
// forward one tick, which is what lets a promise our OWN code is awaiting
// (fetchNextQuestion's/draftAnswer's mocked resolution, and the setState that
// follows it) actually settle and commit before the next assertion runs.
// Called more than once where the hook chains two network calls end to end
// (prediction resolving before the pre-draft effect even fires) rather than
// reached for a timeout, per this file's own instructions.
async function flush(times = 1) {
  for (let i = 0; i < times; i += 1) {
    // Deliberately sequential -- each flush must complete before the next is
    // scheduled, so this does not run in Promise.all/parallel.
    await act(async () => {});
  }
}

async function renderDashboard(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush(5);
}

describe("useCopilotDashboard wiring -- prediction request (fetchNextQuestion)", () => {
  // The truth table from the task: `active` alone is the PRE-EXISTING
  // session gate, `predictionsEnabled` is the new one, and speculate is
  // wired as their AND. Only the (true, true) row may ever call
  // fetchNextQuestion.
  it.each([
    [true, true, "called"],
    [true, false, "never called"],
    [false, true, "never called"],
    [false, false, "never called"],
  ])("active=%s, predictionsEnabled=%s -> %s", async (active, predictionsEnabled, expected) => {
    await renderDashboard(baseProps({ active, predictionsEnabled }));

    if (expected === "called") {
      expect(fetchNextQuestion).toHaveBeenCalledTimes(1);
    } else {
      expect(fetchNextQuestion).not.toHaveBeenCalled();
    }
  });

  // The (active: false, predictionsEnabled: true) row above is not
  // redundant with (false, false) -- it specifically pins that the
  // PRE-EXISTING `active` gate still applies once `predictionsEnabled` is
  // folded in. Restated here as its own assertion (rather than trusting the
  // table row alone) because this is the exact regression AC-I4.26 describes:
  // before `active` existed as part of a combined gate, merely selecting a
  // posting could fire a prediction and a pre-draft before a session ever
  // started.
  it("selecting a posting alone, with no session running, still never calls fetchNextQuestion", async () => {
    await renderDashboard(baseProps({ active: false, predictionsEnabled: true, questions: [] }));
    expect(fetchNextQuestion).not.toHaveBeenCalled();
  });
});

describe("useCopilotDashboard wiring -- pre-draft request (draftAnswer)", () => {
  it("with autoDraft on and a prediction resolved, draftAnswer is called when predictions are enabled", async () => {
    await renderDashboard(baseProps({ active: true, predictionsEnabled: true, autoDraft: true }));

    expect(fetchNextQuestion).toHaveBeenCalledTimes(1);
    expect(draftAnswer).toHaveBeenCalledTimes(1);
  });

  it("with autoDraft on, draftAnswer is never called when predictions are disabled", async () => {
    await renderDashboard(baseProps({ active: true, predictionsEnabled: false, autoDraft: true }));

    expect(fetchNextQuestion).not.toHaveBeenCalled();
    expect(draftAnswer).not.toHaveBeenCalled();
  });
});
