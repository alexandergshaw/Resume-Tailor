// @vitest-environment jsdom
//
// AC-O2: live mode's half of "typing a question is the same as detecting
// one". The claim is about WIRING — that a typed question joins the same
// `questions` list, takes the same drafting path, honours the same
// Auto-draft switch, and feeds the same back-to-back dedupe as a question
// the interviewer actually asked. Every one of those is a composition
// property of the hook; under the default `environment: "node"` the hook
// body never runs, so a manual path that quietly forked into its own
// second pipeline would leave the rest of the suite green (R-166 is the
// standing example). Hence the per-file jsdom opt-in.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/session", () => ({ CopilotSession: vi.fn() }));
vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import { useLiveSession } from "./useLiveSession.js";
import { CopilotSession } from "@/lib/copilot/session";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT_RESPONSE = {
  points: ["Situation: I led the migration.", "Result: latency fell a third."],
  cues: ["Led migration", "Latency down"],
  buzzwords: ["migration"],
  resumeAnchor: { role: "Staff Engineer" },
  idealProject: { title: "Platform consolidation" },
  // Deliberately NOT what classifyQuestionType would return for the
  // behavioral-sounding question used below ("Tell me about a time you
  // handled conflict." classifies as "behavioral"). The two have to differ,
  // or the type assertion cannot tell "the drafted answer's classification
  // won" — which is the contract — from "a local guess was pinned on the
  // entry first and beat it", since runDraft resolves `it.type || type`.
  type: "technical",
};

let sessionOptions = null;

function Probe({ onState, autoDraft = true, cacheRef, genRef }) {
  const [status, setStatus] = useState("idle");
  const [questions, setQuestions] = useState([]);
  // Handed in from the test when it needs to inspect the shared machinery
  // (the answer cache) or perturb it mid-draft (the generation guard) — see
  // the "shares live mode's own drafting machinery" cases below.
  const ownCache = useRef(new Map());
  const ownGen = useRef(0);
  const answerCacheRef = cacheRef || ownCache;
  const draftGenRef = genRef || ownGen;
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
    autoDraft,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
  });
  onState({ questions, start: live.start, addManualQuestion: live.addManualQuestion });
  return null;
}

// Every mount is tracked and torn down in afterEach. Unmounting as the last
// statement of each `it` is skipped whenever an assertion fails, which left a
// live hook (and its session ref) bleeding into the next test.
const mounted = [];

function mountProbe(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  mounted.push({ root, container });
  act(() => {
    root.render(
      createElement(Probe, { ...props, onState: (s) => Object.assign(state, s) }),
    );
  });
  return { root, container, state };
}

// A promise the test settles by hand, so "still in flight" is a real state
// rather than a race.
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
  draftAnswer.mockResolvedValue(DRAFT_RESPONSE);
  confirmQuestion.mockResolvedValue({
    isQuestion: true,
    question: "What is your greatest weakness?",
    type: "general",
  });
});

afterEach(() => {
  while (mounted.length) {
    const { root, container } = mounted.pop();
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

describe("useLiveSession — manually typed questions (AC-O2)", () => {
  it("puts the typed question straight into the detected-question list", async () => {
    const { state } = mountProbe();
    let accepted;
    await act(async () => {
      accepted = state.addManualQuestion("Tell me about a time you handled conflict.");
    });
    expect(accepted).toBe(true);
    expect(state.questions.map((q) => q.question)).toEqual([
      "Tell me about a time you handled conflict.",
    ]);
  });

  it("does not ask the model whether it was a question", async () => {
    // confirmQuestion exists to decide IS THIS A QUESTION for a fragment of
    // speech. Typing it is that decision, already made by the person who
    // knows. Spending a round trip to have the model second-guess it is both
    // slower and capable of throwing the entry away outright.
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("So what happens next?");
    });
    expect(confirmQuestion).not.toHaveBeenCalled();
    expect(state.questions).toHaveLength(1);
  });

  it("drafts the answer through the same path a detected question uses", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("Tell me about a time you handled conflict.");
    });
    expect(draftAnswer).toHaveBeenCalledTimes(1);
    expect(draftAnswer.mock.calls[0][0]).toMatchObject({
      question: "Tell me about a time you handled conflict.",
      profile: "Senior engineer at Acme.",
    });
    const entry = state.questions[0];
    expect(entry.status).toBe("done");
    // The full aid set, not just the points — a typed question that rendered
    // a barer card than a detected one is exactly the divergence this
    // feature is defined against.
    expect(entry.points).toEqual(DRAFT_RESPONSE.points);
    expect(entry.cues).toEqual(DRAFT_RESPONSE.cues);
    expect(entry.buzzwords).toEqual(DRAFT_RESPONSE.buzzwords);
    expect(entry.anchor).toEqual(DRAFT_RESPONSE.resumeAnchor);
    expect(entry.idealProject).toEqual(DRAFT_RESPONSE.idealProject);
    // See DRAFT_RESPONSE's own note: "technical" is the DRAFTED answer's
    // classification, and it must win. classifyQuestionType would call this
    // same question "behavioral", so this assertion fails the moment manual
    // entry pins a locally-guessed type on the card.
    expect(entry.type).toBe("technical");
  });

  it("honours the Auto-draft switch exactly as detection does", async () => {
    const { state } = mountProbe({ autoDraft: false });
    await act(async () => {
      state.addManualQuestion("Why do you want this role?");
    });
    expect(draftAnswer).not.toHaveBeenCalled();
    expect(state.questions[0].status).toBe("idle");
  });

  it("works with no session running — the fallback has to work when capture does not", async () => {
    // The realistic reason to type a question is that detection missed it or
    // the interviewer is on a channel this tab cannot hear. Gating manual
    // entry on a live session would withhold it in precisely that case.
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("How do you prioritise competing deadlines?");
    });
    expect(state.questions).toHaveLength(1);
    expect(draftAnswer).toHaveBeenCalledTimes(1);
  });

  it("refuses a blank entry and adds nothing", async () => {
    const { state } = mountProbe();
    let accepted;
    await act(async () => {
      accepted = state.addManualQuestion("   ");
    });
    expect(accepted).toBe(false);
    expect(state.questions).toHaveLength(0);
    expect(draftAnswer).not.toHaveBeenCalled();
  });

  it("normalizes the typed text before it becomes a card", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("  Walk me\n  through your resume. ");
    });
    expect(state.questions[0].question).toBe("Walk me through your resume.");
  });

  it("still detects a spoken question — the positive control", async () => {
    // Without this, EVERY other case in this file is satisfied by a
    // completely deaf detection path. The two dedupe cases assert an absence
    // ("still only one card"), and an absence is exactly what a broken
    // detector produces: gutting the speech_final branch in `onTranscript`
    // left this whole file green. This is the only jsdom coverage live
    // detection currently has, since useLiveSession.instant.test.js is red
    // for unrelated reasons and gates nothing.
    confirmQuestion.mockResolvedValueOnce({
      isQuestion: true,
      question: "How do you handle ambiguity?",
      type: "general",
    });
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      speakAsInterviewer("so how do you handle ambiguity");
    });
    expect(state.questions.map((q) => q.question)).toEqual(["How do you handle ambiguity?"]);
    expect(confirmQuestion).toHaveBeenCalledTimes(1);
  });

  it("suppresses the same question arriving from detection right after", async () => {
    // The common case: the candidate types what they heard while the
    // interviewer is still speaking, and the transcript then produces the
    // same question a second later. Without this, two identical cards and
    // two drafts. Manual entry WRITES the same back-to-back dedupe guard
    // detection reads — see the next case for the direction it deliberately
    // does not participate in.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });
    await act(async () => {
      state.addManualQuestion("What is your greatest weakness?");
    });
    expect(state.questions).toHaveLength(1);

    await act(async () => {
      speakAsInterviewer("what is your greatest weakness");
    });
    expect(state.questions).toHaveLength(1);
    expect(draftAnswer).toHaveBeenCalledTimes(1);
  });

  it("honours a deliberate repeat, rather than silently swallowing it", async () => {
    // The guard is WRITE-ONLY on this path, on purpose, and that asymmetry
    // is worth pinning rather than leaving to be re-discovered: detection
    // reads it (a transcript repeating itself is noise), manual entry only
    // writes it. Typing the same question twice is an explicit act by the
    // person who knows, and this codebase's standing preference is that a
    // deliberate action never disappears with no feedback. The second card
    // is served from the answer cache, so it costs no extra model call.
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion("What is your greatest weakness?");
    });
    await act(async () => {
      state.addManualQuestion("What is your greatest weakness?");
    });
    expect(state.questions).toHaveLength(2);
    expect(draftAnswer).toHaveBeenCalledTimes(1);
    expect(state.questions[1].cached).toBe(true);
  });

  it("shares live mode's own answer cache, not a private one", async () => {
    // The strongest thing this file can assert, and the thing a forked
    // pipeline fails: a hand-rolled setQuestions + draftAnswer inside
    // addManualQuestion produces an entry of exactly the same SHAPE, so
    // every output assertion above stays green — while quietly skipping the
    // cache write (so a later identical detected question re-bills) and the
    // generation guard (the next case).
    const cacheRef = { current: new Map() };
    const { state } = mountProbe({ cacheRef });
    await act(async () => {
      state.addManualQuestion("Tell me about a time you handled conflict.");
    });
    // normalizeQuestion only lowercases and collapses whitespace — it does
    // NOT strip punctuation, so the trailing period is part of the key.
    const cached = cacheRef.current.get("tell me about a time you handled conflict.");
    expect(cached, "the draft must land in the shared answer cache").toBeTruthy();
    expect(cached.points).toEqual(DRAFT_RESPONSE.points);
  });

  it("abandons a typed question's draft when the session moves on under it", async () => {
    // AC-N1.3's guard, which only exists inside runDraft. A posting or
    // profile change (or a fresh Start) bumps draftGenRef; a draft still in
    // flight must then land nowhere rather than repainting points built for
    // a context the user has already left. A private drafting path would
    // write "done" with stale points here and stay green everywhere else.
    const pending = deferred();
    draftAnswer.mockReturnValueOnce(pending.promise);
    const genRef = { current: 0 };
    const { state } = mountProbe({ genRef });
    await act(async () => {
      state.addManualQuestion("Tell me about a time you handled conflict.");
    });
    expect(state.questions[0].status).toBe("loading");

    genRef.current += 1; // the user changes posting mid-draft
    await act(async () => {
      pending.resolve(DRAFT_RESPONSE);
      await pending.promise;
    });
    expect(state.questions[0].status).toBe("idle");
    expect(state.questions[0].points).toBeNull();
  });
});
