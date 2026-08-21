// @vitest-environment jsdom
//
// AC-R1.3/AC-R1.4. Replaces useCopilotDashboard.wiring.test.js, which
// existed to prove the prediction/pre-draft gate was wired correctly
// (R-166). The predicted next question and its pre-drafted answer are gone
// now, so the property worth pinning is the stronger one: this hook issues
// NO speculative model calls at all, under any inputs, in either mode — and
// still does the job it kept.
//
// jsdom is a PER-FILE override (vitest.config.js stays `environment:
// "node"`; nothing else in the suite is affected). It is needed because the
// property is about effects actually running: under `node` the hook body
// never executes, so a re-added prediction effect would leave this file
// green while firing two model calls per detected question in production.
//
// THE TRAP THIS FILE IS BUILT AROUND: an assertion of absence is satisfied
// by a dead hook. "fetchNextQuestion was never called" passes just as
// happily against a `useCopilotDashboard` that returns `null` and does
// nothing. Every describe block below therefore ends in a POSITIVE CONTROL
// — the pace/filler readings, which are what this hook still exists for —
// so a hook that had been gutted rather than trimmed fails here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useCopilotDashboard } from "./useCopilotDashboard.js";

// Both modules still exist and are still used elsewhere — practice mode's
// drill questions come from fetchNextQuestion, and both modes still draft
// answers to REAL questions through draftAnswer. Mocking them here proves
// only that THIS hook never reaches for either one.
vi.mock("@/lib/copilot/questionClient", () => ({
  fetchNextQuestion: vi.fn(),
}));
vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
}));

import { fetchNextQuestion } from "@/lib/copilot/questionClient";
import { draftAnswer } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Deliberately the inputs that USED to make the old hook speculate: a real
// detected question, a fully-populated posting, a running session, and
// Auto-draft on. Feeding it anything emptier would make every "never
// called" assertion below pass for the wrong reason.
const QUESTIONS = [{ question: "Tell me about yourself" }];
const POSTING = { title: "Backend Engineer", company: "Acme", description: "Build things" };

// Ten words over a four-second span — above livePace.js's
// MIN_WORDS_FOR_MEASUREMENT (8) and inside its 30s window, so the positive
// controls below get a real measurement rather than the not-enough-yet
// fallback.
const SPEECH = [
  { text: "one two three four five", start: 0, duration: 2 },
  { text: "six seven eight nine ten", start: 2, duration: 2 },
];

let container;
let root;
let latest;

function Probe(props) {
  latest = useCopilotDashboard(props);
  return null;
}

function baseProps(overrides) {
  return {
    questions: QUESTIONS,
    posting: POSTING,
    applicationId: "app-1",
    autoDraft: true,
    profile: "test profile",
    active: true,
    interviewType: "behavioral",
    draftMode: "answer",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  latest = null;
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

// Drives React's act queue forward far enough that any effect-scheduled
// promise chain (which is exactly how the removed prediction -> pre-draft
// chain used to run) would have settled and committed by the time the
// assertions execute. Sequential on purpose.
async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function render(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
  await flush();
}

describe("useCopilotDashboard issues no speculative model calls", () => {
  it.each([
    ["live mode, session running, Auto-draft on", { interviewType: undefined, draftMode: undefined }],
    ["practice mode, session running, pre-draft on", {}],
    ["session not running", { active: false }],
    ["Auto-draft off", { autoDraft: false }],
    ["posting selected, no question detected yet", { questions: [] }],
    ["question detected, no posting selected", { posting: null }],
  ])("%s -> neither route is called", async (_label, overrides) => {
    await render(baseProps(overrides));
    expect(fetchNextQuestion).not.toHaveBeenCalled();
    expect(draftAnswer).not.toHaveBeenCalled();
  });

  it("stays silent across a re-render that changes the question and the posting", async () => {
    // The old prediction effect keyed off exactly this: a change to the
    // asked-question text or to the selected posting. Changing both is the
    // strongest re-trigger the removed feature had.
    await render(baseProps({}));
    await render(
      baseProps({
        questions: [{ question: "Tell me about yourself" }, { question: "Why this company?" }],
        posting: { title: "Staff Engineer", company: "Globex", description: "Other things" },
      }),
    );
    expect(fetchNextQuestion).not.toHaveBeenCalled();
    expect(draftAnswer).not.toHaveBeenCalled();
  });

  it("[strong] opens no network connection by ANY route, not just the two clients", async () => {
    // Mocking two module identities only proves those two modules were not
    // called. An adversarial review reimplemented the whole prediction ->
    // pre-draft chain with a raw `fetch` to the same two endpoints, keeping
    // the result in a `useRef` so even the returned key set was unchanged,
    // and every assertion above stayed green while the network log read
    // ["/api/copilot/question", "/api/copilot/answer"]. The property that
    // actually matters is the NETWORK BOUNDARY, so assert there.
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await render(baseProps({}));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(fetchNextQuestion).not.toHaveBeenCalled();
      expect(draftAnswer).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("[control] the module mocks are actually wired to what the hook imports", async () => {
    // Nothing else here proves the `@` alias resolves these mocks to the
    // same module instances the hook itself imports. If that ever stopped
    // being true, every "never called" assertion in this file would pass
    // vacuously, forever.
    const { fetchNextQuestion: direct } = await import("@/lib/copilot/questionClient");
    expect(vi.isMockFunction(direct)).toBe(true);
    direct({});
    expect(fetchNextQuestion).toHaveBeenCalledTimes(1);
  });

  it("[positive control] the hook is alive: it still measures pace and fillers", async () => {
    // Without this, every assertion above is satisfied by a hook that does
    // nothing whatsoever. The EXACT value matters, not merely a positive
    // number: a hook returning a hardcoded `{ measured: true,
    // wordsPerMinute: 999 }` and never consulting livePace.js at all passed
    // a `toBeGreaterThan(0)` version of this. SPEECH is ten words over a
    // four-second span, so the only correct answer is 150.
    await render(baseProps({}));
    await act(async () => {
      SPEECH.forEach((s) => latest.recordSpeechSample(s));
    });
    await flush(2);

    expect(latest.pace.measured).toBe(true);
    expect(latest.pace.wordsPerMinute).toBe(150);
    expect(latest.pace.paceLabel).toBe("conversational");
    expect(latest.fillers.measured).toBe(true);
    expect(latest.fillers.fillerCount).toBe(0);
  });
});

describe("useCopilotDashboard's surviving contract", () => {
  it("exposes only pace, fillers, recordSpeechSample and resetForSession", async () => {
    await render(baseProps({}));
    expect(Object.keys(latest).sort()).toEqual(
      ["fillers", "pace", "recordSpeechSample", "resetForSession"].sort(),
    );
  });

  it("resetForSession clears the speech window it accumulated", async () => {
    await render(baseProps({}));
    await act(async () => {
      SPEECH.forEach((s) => latest.recordSpeechSample(s));
    });
    await flush(2);
    // Positive control first — asserting only that the reading is unmeasured
    // AFTER a reset would pass against a recorder that never recorded.
    expect(latest.pace.measured).toBe(true);

    await act(async () => {
      latest.resetForSession();
    });
    await flush(2);

    expect(latest.pace.measured).toBe(false);
    expect(latest.pace.wordsPerMinute).toBeNull();
  });
});
