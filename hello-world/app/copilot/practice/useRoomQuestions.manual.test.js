// @vitest-environment jsdom
//
// AC-O3: practice mode's detection-equivalent half. useRoomQuestions is the
// hook that turns "someone else in the room asked something" into a card in
// the shared QuestionFeed with a full drafted answer under it; a typed
// question has to land in exactly that place, by exactly that path. The
// interesting property is what manual entry DOESN'T go through — the
// speaker-attribution gate that decides whether an overheard turn was even
// the candidate's to react to — and that is a wiring fact, invisible to any
// pure test of shouldTreatAsRoomQuestion itself.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import { useRoomQuestions } from "./useRoomQuestions.js";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT_RESPONSE = {
  points: ["Name the constraint first.", "Then the tradeoff you took."],
  cues: ["Constraint", "Tradeoff"],
  buzzwords: ["latency"],
  resumeAnchor: { role: "Staff Engineer" },
  idealProject: { title: "Platform consolidation" },
  // Deliberately NOT what classifyQuestionType returns for the question used
  // below ("How would you scale this?" classifies as "technical"). The two
  // have to differ, or the type assertion cannot tell "the drafted answer's
  // classification won" -- which is the contract, since runDraft resolves
  // `q.type || type` -- from "a local guess was pinned first and beat it".
  type: "behavioral",
};

function Probe({ onState, myTag = null, collecting = false }) {
  const room = useRoomQuestions({
    applicationId: "app-1",
    profile: "Senior engineer at Acme.",
    myTag,
    collecting,
  });
  onState(room);
  return null;
}

// Every mount is tracked and torn down in afterEach. Unmounting as the last
// statement of each `it` is skipped whenever an assertion fails, leaving a
// live hook bleeding into the next test.
const mounted = [];

function mountProbe(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Probe, { ...props, onState: (s) => Object.assign(state, s) }));
  });
  return { root, container, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  draftAnswer.mockResolvedValue(DRAFT_RESPONSE);
  confirmQuestion.mockResolvedValue({
    isQuestion: true,
    question: "How would you scale this?",
    type: "technical",
  });
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  vi.clearAllMocks();
});

describe("useRoomQuestions — manually typed questions (AC-O3)", () => {
  it("adds the typed question and drafts it, with the same aids a room question gets", async () => {
    const { state } = mountProbe();
    let accepted;
    await act(async () => {
      accepted = state.addManualQuestion("How would you scale this?");
    });
    expect(accepted).toBe(true);
    const entry = state.questions[0];
    expect(entry.question).toBe("How would you scale this?");
    expect(entry.status).toBe("done");
    expect(entry.points).toEqual(DRAFT_RESPONSE.points);
    expect(entry.cues).toEqual(DRAFT_RESPONSE.cues);
    expect(entry.buzzwords).toEqual(DRAFT_RESPONSE.buzzwords);
    expect(entry.anchor).toEqual(DRAFT_RESPONSE.resumeAnchor);
    expect(entry.idealProject).toEqual(DRAFT_RESPONSE.idealProject);
    // See DRAFT_RESPONSE's own note: the drafted classification must win.
    expect(entry.type).toBe("behavioral");
    expect(draftAnswer).toHaveBeenCalledTimes(1);
    expect(draftAnswer.mock.calls[0][0]).toMatchObject({
      question: "How would you scale this?",
      applicationId: "app-1",
      profile: "Senior engineer at Acme.",
    });
  });

  it("does not ask the model whether it was a question", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("What happens next?");
    });
    expect(confirmQuestion).not.toHaveBeenCalled();
    expect(state.questions).toHaveLength(1);
  });

  it("is not gated by speaker attribution, in a state where an overheard turn IS", async () => {
    // `collecting: true` means the candidate's own answer is being recorded,
    // so shouldTreatAsRoomQuestion (lib/copilot/roomQuestions.js) attributes
    // every turn to them and reacts to none. Typing is an explicit act by the
    // candidate about someone ELSE's question — running it through a filter
    // built to guess at voices would silently swallow it, which is the whole
    // failure mode manual entry exists to route around.
    const { state } = mountProbe({ collecting: true, myTag: null });
    await act(async () => {
      state.onUtterance({ speakerTag: 1, text: "How would you scale this?" });
    });
    expect(state.questions).toHaveLength(0);

    await act(async () => {
      state.addManualQuestion("How would you scale this?");
    });
    expect(state.questions).toHaveLength(1);
  });

  it("refuses a blank entry and adds nothing", async () => {
    const { state } = mountProbe();
    let accepted;
    await act(async () => {
      accepted = state.addManualQuestion("  \n ");
    });
    expect(accepted).toBe(false);
    expect(state.questions).toHaveLength(0);
    expect(draftAnswer).not.toHaveBeenCalled();
  });

  it("normalizes the typed text before it becomes a card", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("  How would\n you   scale this? ");
    });
    expect(state.questions[0].question).toBe("How would you scale this?");
  });

  it("still detects a question someone else asks -- the positive control", async () => {
    // Without this, every other case here is satisfied by a completely deaf
    // detector. Both the gate case and the dedupe case below assert an
    // ABSENCE ("no card", "still one card"), and an absence is exactly what a
    // broken onUtterance produces: an early `return` at the top of it left
    // this whole file green. This is the only jsdom coverage room detection
    // has anywhere.
    const { state } = mountProbe({ myTag: 0, collecting: false });
    await act(async () => {
      state.onUtterance({ speakerTag: 1, text: "so how would you scale this" });
    });
    expect(state.questions.map((q) => q.question)).toEqual(["How would you scale this?"]);
    expect(confirmQuestion).toHaveBeenCalledTimes(1);
  });

  it("honours a deliberate repeat, rather than silently swallowing it", async () => {
    // The dedupe guard is WRITE-ONLY on this path, on purpose: detection
    // reads it (someone repeating themselves is noise), manual entry only
    // writes it. Typing the same question twice is an explicit act, and a
    // deliberate action must never vanish with no feedback.
    //
    // The cost is real and worth stating: unlike live mode, this hook has no
    // answer cache, so the second card is a second full model round trip.
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("How would you scale this?");
    });
    await act(async () => {
      state.addManualQuestion("How would you scale this?");
    });
    expect(state.questions).toHaveLength(2);
    expect(draftAnswer).toHaveBeenCalledTimes(2);
  });

  it("suppresses the same question arriving from the room right after", async () => {
    const { state } = mountProbe({ myTag: 0, collecting: false });
    await act(async () => {
      state.addManualQuestion("How would you scale this?");
    });
    expect(state.questions).toHaveLength(1);

    // speakerTag 1 with myTag 0 is someone else — normally evaluated.
    await act(async () => {
      state.onUtterance({ speakerTag: 1, text: "how would you scale this" });
    });
    expect(state.questions).toHaveLength(1);
    expect(draftAnswer).toHaveBeenCalledTimes(1);
  });

  it("clears typed questions when a new capture session starts", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("How would you scale this?");
    });
    expect(state.questions).toHaveLength(1);
    await act(async () => {
      state.resetForSession();
    });
    expect(state.questions).toHaveLength(0);
  });
});
