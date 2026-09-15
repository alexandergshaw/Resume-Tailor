// @vitest-environment jsdom
//
// AC-T1.13/T1.18. The claim under test is WIRING: that a spoken cue on the
// candidate's own channel reaches its handler, that the wrong kinds of frame
// do not, and that a cue never interferes with question detection. Every one
// of those is a composition property of the hook — under the default
// `environment: "node"` the hook body never runs, so a cue path that quietly
// forked into its own second pipeline, or fired on interim frames, would
// leave the rest of the suite green (R-166 is the standing example). Hence
// the per-file jsdom opt-in, and the same CopilotSession-mock harness
// useLiveSession.manual.test.js already established.
//
// N18 delta review F1, OWNER RULING: full retirement of the hold ("pin") and
// release ("unpin") cues (see voiceCues.js's own module doc). Every describe
// block below that had no content once they were gone — the hold itself, its
// re-pin-forward and release paths, the "nothing to hold"/"nothing held"
// refusals, the two-distinct-actions ambiguity case, and the now-permanently
// idle polite-region announcement — is removed rather than left asserting a
// permanent no-op. What remains proves the SAME wiring claims through the one
// cue action left: company.

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

describe("useLiveSession — a spoken cue reaches its handler (AC-T1.13)", () => {
  it("calls the company handler when the candidate says a company phrase", async () => {
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    expect(state.questions).toHaveLength(1);
    expect(onCompanyCue).not.toHaveBeenCalled();

    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(onCompanyCue).toHaveBeenCalledTimes(1);
  });

  it("still detects and drafts questions alongside a spoken cue", async () => {
    // A cue changes nothing about what the pipeline hears. A cue that
    // silently deafened detection would be a far worse defect than anything
    // it could fix.
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
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
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("I was reading about the company recently", { isFinal: false, speechFinal: false });
    });
    expect(onCompanyCue).not.toHaveBeenCalled();
  });

  it("ignores the same phrase spoken by the INTERVIEWER", async () => {
    // These cues are the candidate's own controls. An interviewer saying it
    // must not spend the request on the candidate's behalf.
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakAsInterviewer("I was reading about the company recently.");
    });
    expect(onCompanyCue).not.toHaveBeenCalled();
  });

  it("ignores a re-delivered frame the pipeline has already seen", async () => {
    // `textAlreadyDelivered` is the provider-boundary dedupe for a committed
    // frame repeating a final's exact span (see lib/copilot/stt/index.js).
    // Acting on it would fire one spoken cue twice.
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(onCompanyCue).toHaveBeenCalledTimes(1);

    await act(async () => {
      speakAsCandidate("I was reading about the company recently.", { textAlreadyDelivered: true });
    });
    // The re-delivered frame never lands, so the handler is not called again.
    expect(onCompanyCue).toHaveBeenCalledTimes(1);
  });

  it("does not fire on ordinary interview speech", async () => {
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("I asked a lot of questions in that role and got back a clear answer.");
    });
    expect(onCompanyCue).not.toHaveBeenCalled();
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

  async function inPersonSession(onCompanyCue) {
    const { state } = mountProbe({ source: "inperson", onCompanyCue });
    await startSession(state);
    await askAsInterviewerInPerson("Tell me about a time you handled conflict.");
    return state;
  }

  it("ignores a cue while identity is still unsettled", async () => {
    snapshot = { userTag: 0, confidence: "low", overridden: false, tags: [0, 1] };
    const onCompanyCue = vi.fn(() => true);
    await inPersonSession(onCompanyCue);
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(onCompanyCue).not.toHaveBeenCalled();
  });

  it("records why it stayed inert", async () => {
    snapshot = { userTag: 0, confidence: "low", overridden: false, tags: [0, 1] };
    const state = await inPersonSession();
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.some((e) => /identity|unsettled|speaker/i.test(String(e.reason || "")))).toBe(true);
  });

  it("acts once confidence reaches high", async () => {
    snapshot = { userTag: 0, confidence: "high", overridden: false, tags: [0, 1] };
    const onCompanyCue = vi.fn(() => true);
    await inPersonSession(onCompanyCue);
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(onCompanyCue).toHaveBeenCalledTimes(1);
  });

  it("acts once the user has corrected the attribution by hand", async () => {
    snapshot = { userTag: 0, confidence: "low", overridden: true, tags: [0, 1] };
    const onCompanyCue = vi.fn(() => true);
    await inPersonSession(onCompanyCue);
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(onCompanyCue).toHaveBeenCalledTimes(1);
  });

  it("does not apply that gate to tab sessions", async () => {
    // tab/system get structural speaker separation from two independent
    // sockets, so there is no identity guess to wait on.
    snapshot = { userTag: null, confidence: "unknown", overridden: false, tags: [] };
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ source: "tab", onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(onCompanyCue).toHaveBeenCalledTimes(1);
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
    // No handler passed at all — the mount must not throw, and the refusal
    // still reads "company unavailable", not a generic ignored reason.
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.some((e) => e.action === "company")).toBe(true);
  });
});

describe("useLiveSession — every cue is in the session log (AC-T1.18)", () => {
  it("records the cue that matched", async () => {
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state);
    await askAndAnswer(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakAsCandidate("I was reading about the company recently.");
    });
    expect(logTypes(state)).toContain("cue.matched");
    const [entry] = logEntries(state, "cue.matched");
    expect(entry.action).toBe("company");
    expect(String(entry.utterance || "")).toContain("I was reading about the company recently");
  });
});

// N18 delta review F1, OWNER RULING: full retirement of the hold ("pin") and
// release ("unpin") cues retired the polite-region announcement this file
// used to test here (AC-T1.18.1/C5) along with them — `useCueActions.js`
// never calls `announceCue` any more (the company action never did either),
// so `cueAnnouncement` is now a permanently idle `{ text: "", nonce: 0 }`.
// The MutationObserver harness this block built (LiveRegionProbe,
// mountLiveRegionProbe) and every test in it are removed rather than left
// asserting a permanent no-op.
