// @vitest-environment jsdom
//
// AC-T1.13..T1.18. The claim under test is WIRING: that a spoken cue on the
// candidate's own channel reaches the pin, that the wrong kinds of frame do
// not, and that pinning never interferes with question detection. Every one
// of those is a composition property of the hook — under the default
// `environment: "node"` the hook body never runs, so a cue path that quietly
// forked into its own second pipeline, or fired on interim frames, would
// leave the rest of the suite green (R-166 is the standing example). Hence
// the per-file jsdom opt-in, and the same CopilotSession-mock harness
// useLiveSession.manual.test.js already established.

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
  points: ["Situation: I led the migration."],
  cues: ["Led migration"],
  buzzwords: [],
  resumeAnchor: null,
  idealProject: null,
  type: "behavioral",
};

let sessionOptions = null;

function Probe({ onState, onCompanyCue, source = "tab" }) {
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
    source,
    micDeviceId: null,
    profile: "Senior engineer at Acme.",
    posting: null,
    autoDraft: true,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
    // T1: the one cue action this hook cannot carry out itself — opening the
    // company-brief panel is CopilotClient's state, not the session's. The
    // callback reports back whether it could actually act, so this hook can
    // log the reason when it could not (AC-T1.18).
    onCompanyCue,
  });
  onState({
    questions,
    start: live.start,
    stop: live.stop,
    clearAll: live.clearAll,
    pinnedId: live.pinnedId,
    pinCurrentQuestion: live.pinCurrentQuestion,
    unpinQuestion: live.unpinQuestion,
    sessionLogSnapshot: live.sessionLogSnapshot,
  });
  return null;
}

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

// One candidate utterance on the mic channel. `speaker: "you"` is what every
// source resolves the candidate's own speech to — tab/system by having a
// separate mic socket, in-person via speakerIdentity's labelFor (see
// session.js's _resolveSpeakerLabel).
function speakAsCandidate(text, overrides = {}) {
  sessionOptions.onTranscript({
    speaker: "you",
    transcript: text,
    isFinal: true,
    speechFinal: true,
    start: 2,
    duration: 3,
    ...overrides,
  });
}

async function startSession(state) {
  await act(async () => {
    await state.start();
  });
}

async function askAndAnswer(state, question) {
  await act(async () => {
    speakAsInterviewer(question);
  });
  await act(async () => {});
}

function logTypes(state) {
  const snap = state.sessionLogSnapshot();
  return (snap?.events || []).map((e) => e.type);
}

function logEntries(state, type) {
  const snap = state.sessionLogSnapshot();
  return (snap?.events || []).filter((e) => e.type === type);
}

// The identity snapshot the mocked session reports. Mutated per-test for the
// in-person cases below; reset in beforeEach.
let snapshot;

beforeEach(() => {
  vi.clearAllMocks();
  sessionOptions = null;
  snapshot = { userTag: null, confidence: "unknown", overridden: false, tags: [] };
  CopilotSession.mockImplementation(function (options) {
    sessionOptions = options;
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.speakerSnapshot = vi.fn(() => snapshot);
    this.assignUser = vi.fn();
  });
  draftAnswer.mockResolvedValue(DRAFT_RESPONSE);
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

describe("useLiveSession — a pin cue holds the current question (AC-T1.13/T1.14)", () => {
  it("pins the current question when the candidate says one of the pin phrases", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    expect(state.questions).toHaveLength(1);
    expect(state.pinnedId).toBeNull();

    await act(async () => {
      speakAsCandidate("That's a great question, so let me start with the context.");
    });
    expect(state.pinnedId).toBe(state.questions[0].id);
  });

  it("keeps holding the FIRST question after a second one is detected", async () => {
    // This is the whole point of the feature: a follow-up detected while the
    // candidate is still answering must not become what the dashboard shows.
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    const pinned = state.pinnedId;

    await askAndAnswer(state, "And how did the team react to that?");
    expect(state.questions.length).toBeGreaterThan(1);
    expect(state.pinnedId).toBe(pinned);
  });

  it("still detects and drafts questions while pinned", async () => {
    // Pinning changes what is DISPLAYED as current, never what the pipeline
    // hears. A pin that silently deafened detection would be far worse than
    // the eviction it exists to prevent.
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Let me think about that.");
    });
    await askAndAnswer(state, "So why do you want to work here?");
    expect(state.questions.map((q) => q.question)).toContain("Why do you want to work here?");
    expect(draftAnswer).toHaveBeenCalledTimes(2);
  });
});

describe("useLiveSession — the wrong frames must not fire a cue (AC-T1.13)", () => {
  it("ignores an INTERIM candidate frame", async () => {
    // An interim's text is re-emitted and rewritten several times a second,
    // so a cue matched on interims fires repeatedly for one spoken phrase.
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("That's a great question", { isFinal: false, speechFinal: false });
    });
    expect(state.pinnedId).toBeNull();
  });

  it("ignores the same phrase spoken by the INTERVIEWER", async () => {
    // These cues are the candidate's own controls. An interviewer saying
    // "next question" must not release a hold the candidate just placed.
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    const pinned = state.pinnedId;

    await act(async () => {
      speakAsInterviewer("Does that answer your question?");
    });
    expect(state.pinnedId).toBe(pinned);
  });

  it("ignores a re-delivered frame the pipeline has already seen", async () => {
    // `textAlreadyDelivered` is the provider-boundary dedupe for a committed
    // frame repeating a final's exact span (see lib/copilot/stt/index.js).
    // Acting on it would fire one spoken cue twice.
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    await act(async () => {
      speakAsCandidate("Does that answer your question?", { textAlreadyDelivered: true });
    });
    // The re-delivered release never lands, so the hold survives.
    expect(state.pinnedId).not.toBeNull();
  });

  it("does not fire on ordinary interview speech", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("I asked a lot of questions in that role and got back a clear answer.");
    });
    expect(state.pinnedId).toBeNull();
  });
});

describe("useLiveSession — in-person cues wait for identity to settle (AC-T1.13)", () => {
  // `speaker` for the in-person source is resolved by speakerIdentity's
  // `labelFor`, which returns "you" for the argmax tag as soon as TWO voices
  // have been observed, with no confidence requirement at all. That is a
  // DISPLAY guess — session.js and speakerIdentity.js both document at length
  // that detection must never route off it. Acting on cues from it means the
  // interviewer saying "Next question." releases the candidate's hold.
  // The in-person source does NOT detect questions through onTranscript's
  // pendingRef path — CopilotSession assembles its own utterances and
  // delivers them via onUtterance, and useLiveSession deliberately skips the
  // transcript-side assembly for this source so a question is not detected
  // twice (AC-M1.4.9). An earlier version of this helper drove
  // onTranscript({speaker:"them"}) like the tab tests do, so no question was
  // ever created and the pin correctly had nothing to hold — the tests below
  // then failed for a reason that had nothing to do with the identity gate
  // they exist to check.
  async function askAsInterviewerInPerson(text) {
    await act(async () => {
      sessionOptions.onUtterance({ speakerTag: 1, text, evaluate: true });
    });
    await act(async () => {});
  }

  async function inPersonSession() {
    const { state } = mountProbe({ source: "inperson" });
    await startSession(state);
    await askAsInterviewerInPerson("Tell me about a time you handled conflict.");
    return state;
  }

  it("ignores a cue while identity is still unsettled", async () => {
    snapshot = { userTag: 0, confidence: "low", overridden: false, tags: [0, 1] };
    const state = await inPersonSession();
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    expect(state.pinnedId).toBeNull();
  });

  it("records why it stayed inert", async () => {
    snapshot = { userTag: 0, confidence: "low", overridden: false, tags: [0, 1] };
    const state = await inPersonSession();
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.some((e) => /identity|unsettled|speaker/i.test(String(e.reason || "")))).toBe(true);
  });

  it("acts once confidence reaches high", async () => {
    snapshot = { userTag: 0, confidence: "high", overridden: false, tags: [0, 1] };
    const state = await inPersonSession();
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    expect(state.pinnedId).not.toBeNull();
  });

  it("acts once the user has corrected the attribution by hand", async () => {
    snapshot = { userTag: 0, confidence: "low", overridden: true, tags: [0, 1] };
    const state = await inPersonSession();
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    expect(state.pinnedId).not.toBeNull();
  });

  it("does not apply that gate to tab sessions", async () => {
    // tab/system get structural speaker separation from two independent
    // sockets, so there is no identity guess to wait on.
    snapshot = { userTag: null, confidence: "unknown", overridden: false, tags: [] };
    const { state } = mountProbe({ source: "tab" });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    expect(state.pinnedId).not.toBeNull();
  });
});

describe("useLiveSession — an ambiguous utterance changes nothing (AC-T1.2.1)", () => {
  it("neither pins nor unpins when one frame carries two intents", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question. So we cut latency by a third. Does that answer your question?");
    });
    expect(state.pinnedId).toBeNull();
  });

  it("leaves an existing hold alone", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      state.pinCurrentQuestion();
    });
    const pinned = state.pinnedId;
    await act(async () => {
      speakAsCandidate("Good question. So we cut latency by a third. Does that answer your question?");
    });
    expect(state.pinnedId).toBe(pinned);
  });

  it("records the ambiguity rather than staying silent about it", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question. So we cut latency by a third. Does that answer your question?");
    });
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.some((e) => /ambiguous/i.test(String(e.reason || "")))).toBe(true);
  });
});

describe("useLiveSession — a repeated pin cue re-pins forward (AC-T1.16.1)", () => {
  it("moves the hold to the newest question", async () => {
    // This is what makes the population that causes the stale-hold problem —
    // candidates who reflexively say "good question" every single time —
    // self-correct on every question instead of stranding on the first.
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    const first = state.pinnedId;

    await askAndAnswer(state, "So why do you want to work here?");
    await act(async () => {
      speakAsCandidate("Ooh, tough question.");
    });
    expect(state.pinnedId).not.toBe(first);
    expect(state.pinnedId).toBe(state.questions[state.questions.length - 1].id);
  });
});

describe("useLiveSession — releasing the hold (AC-T1.17)", () => {
  it("releases on an unpin cue", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    expect(state.pinnedId).not.toBeNull();

    await act(async () => {
      speakAsCandidate("Does that answer your question?");
    });
    expect(state.pinnedId).toBeNull();
  });

  it("releases when the release control is used", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      state.pinCurrentQuestion();
    });
    expect(state.pinnedId).not.toBeNull();
    await act(async () => {
      state.unpinQuestion();
    });
    expect(state.pinnedId).toBeNull();
  });

  it("releases on Clear", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      state.pinCurrentQuestion();
    });
    await act(async () => {
      state.clearAll();
    });
    expect(state.pinnedId).toBeNull();
  });

  it("releases on Stop", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      state.pinCurrentQuestion();
    });
    await act(async () => {
      await state.stop();
    });
    expect(state.pinnedId).toBeNull();
  });

  // Regression pass, defect 3. lib/copilot/session.js ends a
  // CopilotSession two ways that never call this hook's own `stop()` at
  // all: the audio track's native "ended" event (a "Stop sharing" click, or
  // the interviewer closing the shared tab) calls CopilotSession's own
  // stop(), which fires `onStatus("idle")`; a fatal essential-source error
  // escalates straight to `onStatus("error")`. Both reach this hook as
  // nothing more than the `onStatus` callback `start()` hands to `new
  // CopilotSession(...)` calling `setStatus(s)` — see that callback's own
  // body. Before the defect-3 fix, `pin.unpinQuestion()` was called ONLY
  // from this hook's `stop()`, so a hold survived a session that ended
  // either of these two other ways, `held` stayed true forever (the ticking
  // `now` clock that resolvePin's own 120s expiry needs is itself gated on
  // `live`, so it could never even attempt to self-correct), and
  // CopilotDashboard kept claiming detection and drafting were still
  // running behind it.
  //
  // Simulated here by invoking the exact `onStatus` callback captured off
  // the mocked CopilotSession — precisely what session.js calls on both of
  // the paths above — WITHOUT ever calling `state.stop()`.
  it("releases the hold when the session ends without stop() being called (defect 3)", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      state.pinCurrentQuestion();
    });
    expect(state.pinnedId).not.toBeNull();

    await act(async () => {
      sessionOptions.onStatus("idle");
    });
    expect(state.pinnedId).toBeNull();
  });

  it("releases when a new session starts", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      state.pinCurrentQuestion();
    });
    expect(state.pinnedId).not.toBeNull();
    await startSession(state);
    expect(state.pinnedId).toBeNull();
  });
});

describe("useLiveSession — a pin with nothing to hold (AC-T1.14/T1.18)", () => {
  it("does not pin when no question has been detected yet", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    expect(state.pinnedId).toBeNull();
  });

  it("records WHY it could not act, rather than silently doing nothing", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.length).toBeGreaterThan(0);
    expect(String(ignored[0].reason || "")).toMatch(/question/i);
  });
});

describe("useLiveSession — the company cue (AC-T1.18/T2)", () => {
  it("calls the company handler exactly once", async () => {
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(onCompanyCue).toHaveBeenCalledTimes(1);
  });

  it("does not pin or unpin as a side effect", async () => {
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      state.pinCurrentQuestion();
    });
    const pinned = state.pinnedId;
    await act(async () => {
      speakAsCandidate("I have been following the company closely.");
    });
    expect(state.pinnedId).toBe(pinned);
  });

  it("records a reason when the handler reports it could not act", async () => {
    const onCompanyCue = vi.fn(() => false);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.some((e) => e.action === "company")).toBe(true);
  });

  it("survives a missing handler entirely", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(state.pinnedId).toBeNull();
  });
});

describe("useLiveSession — every cue is in the session log (AC-T1.18)", () => {
  it("records the cue that matched", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    expect(logTypes(state)).toContain("cue.matched");
    const [entry] = logEntries(state, "cue.matched");
    expect(entry.action).toBe("pin");
    expect(String(entry.utterance || "")).toContain("Good question");
  });

  it("records the resulting pin and the later release", async () => {
    const { state } = mountProbe();
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("Good question.");
    });
    await act(async () => {
      speakAsCandidate("Does that answer your question?");
    });
    const types = logTypes(state);
    expect(types).toContain("question.pinned");
    expect(types).toContain("question.unpinned");
    // Order matters: a log that shows the release before the hold would not
    // explain the session it exists to explain.
    expect(types.indexOf("question.pinned")).toBeLessThan(types.indexOf("question.unpinned"));
    expect(types.indexOf("question.pinned")).toBeGreaterThan(-1);
  });
});
