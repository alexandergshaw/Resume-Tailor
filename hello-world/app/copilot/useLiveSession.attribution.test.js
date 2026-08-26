// @vitest-environment jsdom
//
// AC-V2.4/V2.7. The claim under test is WIRING, and it is the claim no pure
// module can make: that when the speech-to-text provider cannot tell voices
// apart, a spoken hold cue actually reaches the pin — and that a release or a
// company cue in the same session does not, and says so in the log.
//
// This is the exact scenario the user recorded on 2026-08-25. ElevenLabs
// Scribe v2 Realtime has no realtime diarization, so session.js labelled every
// frame "them", useVoiceCues refused every frame, and the downloaded log
// contained zero cue events of any kind — the feature was unreachable, and
// silently so. Under the default `environment: "node"` the hook body never
// runs, so a fix that gets the policy right and the plumbing wrong would leave
// every other suite green; hence the per-file jsdom opt-in and the same
// CopilotSession-mock harness useLiveSession.cues.test.js established.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/session", () => ({ CopilotSession: vi.fn() }));
vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import { useLiveSession } from "./useLiveSession.js";
import { SPEAKER_ATTRIBUTION, CUE_IGNORED_REASONS } from "@/lib/copilot/cuePolicy";
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
let snapshot;

function Probe({ onState, onCompanyCue }) {
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
    profile: "Senior engineer at Acme.",
    posting: null,
    autoDraft: true,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
    onCompanyCue,
  });
  onState({
    questions,
    start: live.start,
    pinnedId: live.pinnedId,
    speakerAttribution: live.speakerAttribution,
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
  return { state };
}

// Exactly how session.js delivers ONE spoken turn on an in-person session
// whose provider cannot diarize — and it is TWO callbacks, not one.
//
// `_handleInPersonFrame` calls `onTranscript` for the frame and then, when the
// utterance assembly drains, `_emitUtterance` calls `onUtterance` for the
// assembled turn. The two carry different work: the cue path runs off the
// TRANSCRIPT frame, and question detection runs off the UTTERANCE
// (`useLiveSession.js` deliberately skips the transcript-side assembly for
// this source so a question is not detected twice — AC-M1.4.9). Driving only
// `onTranscript` creates no question at all, so a pin has nothing to hold and
// the test fails for a reason that has nothing to do with what it is checking.
// `useLiveSession.cues.test.js`'s own in-person helper records having made
// exactly this mistake once already; this file made it again, and the chunk-B
// implementer reported it rather than editing around it.
//
// Both callbacks fire for EVERY turn here, including the candidate's own cue
// phrases, because that is what actually happens: with no diarization there is
// no "that was the candidate, skip detection" — `shouldEvaluateAsQuestion`
// says yes to every voice in the room. The user's own log shows it, with their
// "Um, so I would say..." arriving as a rejected question candidate.
//
// `_resolveSpeakerLabel` has no identity to consult, so every voice — the
// interviewer's and the candidate's alike — arrives labelled "them". That is
// not a contrived fixture; it is what all ten transcript frames of the user's
// log contain.
function speakInTheRoom(text) {
  sessionOptions.onTranscript({
    speaker: "them",
    transcript: text,
    isFinal: true,
    speechFinal: true,
    start: 2,
    duration: 3,
  });
  sessionOptions.onUtterance({ speakerTag: null, text, evaluate: true });
}

async function startSession(state, attribution) {
  await act(async () => {
    await state.start();
  });
  // The provider reports what it could actually do only once the socket is up
  // — the same point session.js's own diarization warning fires from.
  if (attribution) {
    await act(async () => {
      sessionOptions.onAttribution(attribution);
    });
  }
}

async function ask(state, question) {
  await act(async () => {
    speakInTheRoom(question);
  });
  await act(async () => {});
}

function logEntries(state, type) {
  const snap = state.sessionLogSnapshot();
  return (snap?.events || []).filter((e) => e.type === type);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionOptions = null;
  // No diarization means no tags at all, so identity can never settle. This
  // snapshot is not a "still warming up" state that later resolves — it is the
  // permanent state of every session on this provider.
  snapshot = { userTag: null, confidence: "unknown", overridden: false, tags: [] };
  CopilotSession.mockImplementation(function (options) {
    sessionOptions = options;
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.speakerSnapshot = vi.fn(() => snapshot);
    this.speakerAttribution = vi.fn(() => SPEAKER_ATTRIBUTION.UNAVAILABLE);
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

describe("useLiveSession — the hold holds without diarization (AC-V2.7)", () => {
  it("pins the current question on a spoken hold cue, from a frame labelled 'them'", async () => {
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");
    expect(state.questions).toHaveLength(1);
    expect(state.pinnedId).toBeNull();

    await act(async () => {
      speakInTheRoom("That's a great question, so let me start with the context.");
    });

    expect(state.pinnedId).toBe(state.questions[0].id);
    expect(logEntries(state, "question.pinned")).toHaveLength(1);
  });

  it("keeps the held question on screen when a later question is detected", async () => {
    // The whole point of a hold, and the thing that failed the user: at 1:15
    // of their session a new question arrived and took over the panel while
    // they were still answering the first one.
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakInTheRoom("Good question.");
    });
    const held = state.pinnedId;
    expect(held).toBe(state.questions[0].id);

    await ask(state, "And what do you know about Purple Wave?");

    expect(state.questions.length).toBeGreaterThan(1);
    expect(state.pinnedId).toBe(held);
  });

  it("does not let a SECOND pin cue move a hold that is already in force", async () => {
    // AC-V2.3.1. The case my own asymmetry argument never covered, found by an
    // adversarial pass over R-229 and confirmed by driving the real hook.
    //
    // The argument this policy was built on: "a false HOLD is cheap, because it
    // holds the question the candidate is already reading; a false RELEASE is
    // harmful, because it yanks away a hold set deliberately, mid-answer." That
    // is true only when NO hold is in force. `pinCurrentQuestion` always pins
    // `latestQuestionEntry` — AC-T1.16.1's deliberate "re-pin FORWARD" — so a
    // second pin cue MOVES an existing hold onto the newest question. In a
    // session where nobody can tell who spoke, that second cue can be the
    // INTERVIEWER saying "Good question", and the effect on the candidate's
    // screen is exactly the harm the release refusal exists to prevent. The
    // policy blocked it through one door and admitted it through the other.
    //
    // Three R-229 clauses fail together when it happens: the newer-question
    // count goes 1 -> 0, so the count-bearing one-click release loses its
    // number and the held question is reachable only through the feed; the
    // polite live region announces "Question held on screen." at the exact
    // moment the panel content changed under a screen-reader user, which is
    // the opposite of what happened; and the held-with-newer-behind state is
    // destroyed with no state-name change.
    //
    // The rule: while attribution is unavailable, a pin cue may CREATE a hold
    // and may not MOVE one. Re-pinning forward stays correct where it was
    // argued for — a session that can actually tell the candidate's voice from
    // the interviewer's, which the ACTIVE control below pins.
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakInTheRoom("Let me take a step back.");
    });
    const held = state.pinnedId;
    expect(held).toBe(state.questions[0].id);

    // A second question arrives behind the hold...
    await ask(state, "And what do you know about Purple Wave?");
    expect(state.questions.length).toBeGreaterThan(1);
    expect(state.pinnedId).toBe(held);

    // ...and then somebody in the room says a pin phrase again.
    await act(async () => {
      speakInTheRoom("Good question.");
    });

    // The hold does not move.
    expect(state.pinnedId).toBe(held);
    // And the refusal is recorded, so the log can answer "why did nothing
    // happen" — the same standard AC-V2.4 sets for every other refusal path.
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.length).toBeGreaterThan(0);
    expect(ignored.map((e) => e.reason).join(" ")).toMatch(/held/i);
  });

  it("refuses a release cue in the same session, and logs why", async () => {
    // AC-V2.3. "Does that answer your question?" is a phrase the INTERVIEWER
    // says when the candidate has asked THEM something — and in this session
    // there is no way to tell the two voices apart, so a release would let
    // the interviewer yank away a hold the candidate set deliberately.
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakInTheRoom("Good question.");
    });
    const held = state.pinnedId;

    await act(async () => {
      speakInTheRoom("Does that answer your question?");
    });

    expect(state.pinnedId).toBe(held);
    expect(logEntries(state, "question.unpinned")).toHaveLength(0);
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.map((e) => e.reason)).toContain(
      CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE,
    );
  });

  it("refuses a company cue without spending the request", async () => {
    // A company match sends the posting's details outbound and pops a panel.
    // The refusal has to happen BEFORE the callback, not after it — calling
    // onCompanyCue and then logging the refusal spends the request anyway.
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);

    await act(async () => {
      speakInTheRoom("I've been following the company closely.");
    });

    expect(onCompanyCue).not.toHaveBeenCalled();
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.map((e) => e.reason)).toContain(
      CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE,
    );
  });

  it("records a cue decision for every matched phrase, so a log can answer 'why did nothing happen'", async () => {
    // AC-V2.4, and the reason the user could not diagnose this themselves:
    // their downloaded log contains not one cue event. Every matched phrase
    // must leave a trace, whether it acted or not.
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("That's a great question.");
    });
    await act(async () => {
      speakInTheRoom("I hope that answers it.");
    });

    const matched = logEntries(state, "cue.matched");
    expect(matched).toHaveLength(2);
    expect(matched.map((e) => e.action)).toEqual(["pin", "unpin"]);
  });
});

describe("useLiveSession — a diarizing session is untouched (AC-V2.5)", () => {
  it("still refuses the interviewer's own speech when attribution is active", async () => {
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.ACTIVE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("That's a great question.");
    });

    // Labelled "them" with real diarization behind that label means the
    // INTERVIEWER said it, and the interviewer may not drive the dashboard.
    expect(state.pinnedId).toBeNull();
    expect(logEntries(state, "question.pinned")).toHaveLength(0);
  });

  it("still blocks on unsettled identity when attribution is active", async () => {
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.ACTIVE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      sessionOptions.onTranscript({
        speaker: "you",
        transcript: "That's a great question.",
        isFinal: true,
        speechFinal: true,
        start: 2,
        duration: 3,
      });
    });

    expect(state.pinnedId).toBeNull();
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.map((e) => e.reason)).toContain(CUE_IGNORED_REASONS.IDENTITY);
  });
});

// AC-V2.3.1, the secondary defect C1 also fixes. Once a hold could be MOVED
// by any voice in the room, the dashboard sat permanently in the plain held
// treatment for the rest of an unavailable session: every pin cue reset the
// hold onto the newest question and cleared `supersededAt`, so
// `newerQuestionCount` could never climb above 0 and R-229's third named
// state — held-with-newer-questions-behind-it — was unreachable. That is the
// inverse of the error R-229 cites: the badge said frozen while the panel
// tracked live, and the count-bearing one-click release (OpenShift's "Resume
// stream and show N new lines" shape, which R-229 requires) had no N to
// carry. The existing `Probe` reports neither of those two values, so this
// block adds its own — CopilotClient.wiring.test.js already covers the other
// half, that the release control renders the count it is given.
function HoldStateProbe({ onState }) {
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
    profile: "Senior engineer at Acme.",
    posting: null,
    autoDraft: true,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
    onCompanyCue: () => false,
  });
  onState({
    questions,
    start: live.start,
    pinnedId: live.pinnedId,
    held: live.held,
    newerQuestionCount: live.newerQuestionCount,
    sessionLogSnapshot: live.sessionLogSnapshot,
  });
  return null;
}

function mountHoldStateProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(HoldStateProbe, { onState: (s) => Object.assign(state, s) }));
  });
  return { state };
}

describe("useLiveSession — the held-with-newer-behind state stays reachable (AC-V2.3.1/R-229)", () => {
  it("keeps counting questions that arrive behind the hold, even after another pin phrase is spoken", async () => {
    const { state } = mountHoldStateProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakInTheRoom("Let me take a step back.");
    });
    expect(state.held).toBe(true);
    expect(state.newerQuestionCount).toBe(0);

    await ask(state, "And what do you know about Purple Wave?");
    expect(state.held).toBe(true);
    expect(state.newerQuestionCount).toBe(1);

    // The third of R-229's three states has to SURVIVE another pin phrase.
    // Before AC-V2.3.1 this second cue moved the hold forward onto the new
    // question and cleared `supersededAt`, taking the count straight back to
    // 0 — so from here on the screen showed state 2 (a plain hold) forever
    // while the panel actually tracked whatever arrived last.
    await act(async () => {
      speakInTheRoom("Good question.");
    });
    expect(state.held).toBe(true);
    expect(state.newerQuestionCount).toBe(1);

    // And a THIRD question behind it still increments, rather than the count
    // being pinned at whatever it was when the hold last moved.
    await ask(state, "How do you handle a disagreement with your manager?");
    expect(state.held).toBe(true);
    expect(state.newerQuestionCount).toBe(2);
  });
});

// AC-V2.2.1 / C2, at the wiring level. The policy-module half of this is in
// lib/copilot/cuePolicy.test.js; this is the claim no pure module can make —
// that the hook feeds the gate the session's REAL speaker snapshot, so the
// evidence actually reaches the decision. The scenario is a live one: the
// Deepgram token route blips, `diarizationActive` comes back false and this
// axis reads "unavailable", but the stream was still built with
// `diarize: true` and DeepgramStream.connect() fetched its own token — so
// tags arrive, the "Who's talking" bar renders two voices, and the
// interviewer's speech is correctly labelled "them" the whole time.
describe("useLiveSession — the relaxed arm closes once tags prove identity works (AC-V2.2.1)", () => {
  it("refuses the interviewer's frame when tags exist, even though attribution says unavailable", async () => {
    // Two voices observed and identity settled: exactly the state in which
    // "nobody can tell who spoke" is false, whatever the flag reports.
    snapshot = { userTag: 1, confidence: "high", overridden: false, tags: [1, 2] };
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("That's a great question.");
    });

    expect(state.pinnedId).toBeNull();
    expect(logEntries(state, "question.pinned")).toHaveLength(0);
  });

  it("still holds on the recorded session's own shape — no tags, every frame labelled them", async () => {
    // The negative control, and the defect this whole change exists to fix:
    // with no tags there is no evidence, the arm stays open, and the hold
    // works. `snapshot` is left at the beforeEach default on purpose.
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("That's a great question.");
    });

    expect(state.pinnedId).toBe(state.questions[0].id);
  });
});

// AC-V2.8, at the wiring level. cuePolicy.effective.test.js proves the pure
// module answers "can this session tell voices apart" once and consistently.
// This is the claim no pure module can make: that the ACT half of the split —
// useVoiceCues.js -> useCueActions.js -> resolveCueAction — actually carries
// the evidence to the decision, so the candidate's own release and company
// cues stop being refused with a reason that is false.
//
// Same token-blip session as the AC-V2.2.1 block above, from the other side:
// there, tags closing the relaxed arm stopped the INTERVIEWER driving the
// dashboard. Here, the very same tags must stop the CANDIDATE being told
// "cannot tell voices apart this session" by a session that plainly can.
describe("useLiveSession — the candidate's own cues stop being refused falsely (AC-V2.8)", () => {
  // The candidate's own frame, correctly attributed. `speaker: "you"` is what
  // session.js resolves a frame to once identity has settled — which is only
  // possible at all in the session this block is about, because settling
  // requires the tags the flag says do not exist.
  function speakAsCandidate(text) {
    sessionOptions.onTranscript({
      speaker: "you",
      transcript: text,
      isFinal: true,
      speechFinal: true,
      start: 2,
      duration: 3,
    });
  }

  const TAGGED = { userTag: 1, confidence: "high", overridden: false, tags: [1, 2] };

  it("releases a hold on the candidate's own release cue", async () => {
    snapshot = TAGGED;
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakAsCandidate("That's a great question.");
    });
    expect(state.pinnedId).toBe(state.questions[0].id);

    await act(async () => {
      speakAsCandidate("I hope that answers your question.");
    });

    expect(state.pinnedId).toBeNull();
    expect(logEntries(state, "question.unpinned")).toHaveLength(1);
    // And crucially: no refusal citing a cause that was not true.
    expect(logEntries(state, "cue.ignored").map((e) => e.reason)).not.toContain(
      CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE,
    );
  });

  it("lets the candidate's company cue through", async () => {
    snapshot = TAGGED;
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);

    await act(async () => {
      speakAsCandidate("I've been following the company closely.");
    });

    expect(onCompanyCue).toHaveBeenCalled();
    expect(logEntries(state, "cue.ignored").map((e) => e.reason)).not.toContain(
      CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE,
    );
  });

  it("still refuses both when the session really cannot separate voices", async () => {
    // The negative control for the two cases above, on the recorded session's
    // own shape (`snapshot` left at the beforeEach default: no tags, ever).
    // Without it, deleting the refusal outright would pass.
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");
    await act(async () => {
      speakInTheRoom("Good question.");
    });
    const held = state.pinnedId;

    await act(async () => {
      speakInTheRoom("Does that answer your question?");
    });
    await act(async () => {
      speakInTheRoom("I've been following the company closely.");
    });

    expect(state.pinnedId).toBe(held);
    expect(onCompanyCue).not.toHaveBeenCalled();
    expect(logEntries(state, "cue.ignored").map((e) => e.reason)).toContain(
      CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE,
    );
  });
});
