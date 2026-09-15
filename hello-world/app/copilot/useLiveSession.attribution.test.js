// @vitest-environment jsdom
//
// AC-V2.4/V2.7. The claim under test is WIRING, and it is the claim no pure
// module can make: that when the speech-to-text provider cannot tell voices
// apart, a spoken company cue is refused and says so in the log, rather than
// silently doing nothing.
//
// This is the exact scenario the user recorded on 2026-08-25. ElevenLabs
// Scribe v2 Realtime has no realtime diarization, so session.js labelled every
// frame "them", useVoiceCues refused every frame, and the downloaded log
// contained zero cue events of any kind — the feature was unreachable, and
// silently so. Under the default `environment: "node"` the hook body never
// runs, so a fix that gets the policy right and the plumbing wrong would leave
// every other suite green; hence the per-file jsdom opt-in and the same
// CopilotSession-mock harness useLiveSession.cues.test.js established.
//
// N18 delta review F1, OWNER RULING: full retirement of the hold ("pin") and
// release ("unpin") cues — this file used to prove those two reached (or were
// correctly refused by) the same attribution axis; every test that had no
// content once they were gone is removed rather than left asserting a
// permanent no-op. What remains is the SAME underlying AC-V2 claim, now
// carried entirely by the one cue action left: does the session's REAL
// speaker snapshot and attribution state reach the decision, for company
// exactly as it did for the retired two.

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

describe("useLiveSession — company research without diarization (AC-V2.7)", () => {
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
    // must leave a trace, whether it acted or not — twice over here, since a
    // single action is all this registry has left to match.
    const { state } = mountProbe();
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("I was reading about the company recently.");
    });
    await act(async () => {
      speakInTheRoom("Tell me more about the company.");
    });

    const matched = logEntries(state, "cue.matched");
    expect(matched).toHaveLength(2);
    expect(matched.map((e) => e.action)).toEqual(["company", "company"]);
  });
});

describe("useLiveSession — a diarizing session is untouched (AC-V2.5)", () => {
  it("still refuses the interviewer's own speech when attribution is active", async () => {
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state, SPEAKER_ATTRIBUTION.ACTIVE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("I was reading about the company recently.");
    });

    // Labelled "them" with real diarization behind that label means the
    // INTERVIEWER said it, and the interviewer may not drive the dashboard.
    expect(onCompanyCue).not.toHaveBeenCalled();
  });

  it("still blocks on unsettled identity when attribution is active", async () => {
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state, SPEAKER_ATTRIBUTION.ACTIVE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      sessionOptions.onTranscript({
        speaker: "you",
        transcript: "I was reading about the company recently.",
        isFinal: true,
        speechFinal: true,
        start: 2,
        duration: 3,
      });
    });

    expect(onCompanyCue).not.toHaveBeenCalled();
    const ignored = logEntries(state, "cue.ignored");
    expect(ignored.map((e) => e.reason)).toContain(CUE_IGNORED_REASONS.IDENTITY);
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
  // Company is on the STRICT side of voiceCues.js's own asymmetry (it spends
  // a real outbound request), so resolveCueAction refuses it whenever
  // effective attribution reads UNAVAILABLE — with or without tags,
  // regardless of who apparently spoke. That refusal alone therefore cannot
  // distinguish the arm being open from it being closed (both tests below
  // would see `onCompanyCue` go uncalled either way, the retired hold cue's
  // own exemption gone with it). What DOES distinguish them is
  // qualifiesForCue's separate, EARLIER decision — whether an interviewer's
  // ("them") frame is evaluated for a cue AT ALL: closed, the ordinary
  // `speaker !== "you"` check refuses it before matchVoiceCue ever runs, so
  // no `cue.matched` is logged; open, the frame reaches evaluation and
  // matches, and IS logged, before resolveCueAction's own separate refusal
  // takes over.
  it("refuses the interviewer's frame when tags exist, even though attribution says unavailable", async () => {
    // Two voices observed and identity settled: exactly the state in which
    // "nobody can tell who spoke" is false, whatever the flag reports.
    snapshot = { userTag: 1, confidence: "high", overridden: false, tags: [1, 2] };
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("I was reading about the company recently.");
    });

    // The interviewer's frame never even reaches evaluation once evidence
    // closes the relaxed arm — no cue.matched at all, not merely a refused
    // one, which is what tells this case apart from the one below.
    expect(onCompanyCue).not.toHaveBeenCalled();
    expect(logEntries(state, "cue.matched")).toHaveLength(0);
  });

  it("still evaluates a 'them'-labelled frame on the recorded session's own shape — no tags, every frame labelled them", async () => {
    // The negative control, and the defect this whole change exists to fix:
    // with no tags there is no evidence, so the relaxed arm stays open and
    // the frame reaches evaluation regardless of who apparently said it.
    // `snapshot` is left at the beforeEach default on purpose.
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("I was reading about the company recently.");
    });

    expect(logEntries(state, "cue.matched")).toHaveLength(1);
    // Company itself still refuses once evaluated — the STRICT side of the
    // asymmetry gets no exemption the way the retired hold cue did.
    expect(onCompanyCue).not.toHaveBeenCalled();
    expect(logEntries(state, "cue.ignored").map((e) => e.reason)).toContain(
      CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE,
    );
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

  it("still refuses the company cue when the session really cannot separate voices", async () => {
    // The negative control for the case above, on the recorded session's own
    // shape (`snapshot` left at the beforeEach default: no tags, ever, every
    // frame labelled "them" — see this file's own header). Without it,
    // deleting the refusal outright would pass.
    const onCompanyCue = vi.fn(() => true);
    const { state } = mountProbe({ onCompanyCue });
    await startSession(state, SPEAKER_ATTRIBUTION.UNAVAILABLE);
    await ask(state, "Tell me about a time you handled conflict.");

    await act(async () => {
      speakInTheRoom("I've been following the company closely.");
    });

    expect(onCompanyCue).not.toHaveBeenCalled();
    expect(logEntries(state, "cue.ignored").map((e) => e.reason)).toContain(
      CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE,
    );
  });
});
