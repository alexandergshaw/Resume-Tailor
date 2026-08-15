import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Written from AC-M1.4 BEFORE the in-person source existed. Kept separate from
// session.test.js so the pre-feature source/teardown cases (R-034/R-037/R-038)
// stay pinned by assertions this feature never touches.
//
// An earlier version of this file was reviewed adversarially and the entire
// speaker-resolution block was found to be satisfied by
// `onTranscript({ ...frame, speaker: "them" })` - a constant, with the identity
// module never imported. No test ever produced "you", so nothing pinned the
// actual requirement. The block below now drives a real four-turn interview and
// asserts BOTH labels appear on the right voices.
//
// Contracts this file leans on, beyond CopilotSession's own:
//   - createSttStream takes `diarize`, and the stream it returns reports
//     `diarizationActive` - true only when diarization was requested AND the
//     provider can actually do it. ElevenLabs Scribe v2 Realtime cannot diarize
//     at all, so "requested" and "active" are genuinely different facts.
//   - For the in-person source, CopilotSession owns the speaker-identity and
//     utterance-assembly instances and fires `onUtterance` once per assembled
//     utterance (AC-M1.4.9).

const sttCalls = vi.hoisted(() => []);
const sttStreams = vi.hoisted(() => []);
const sttConfig = vi.hoisted(() => ({ diarizationActive: true }));

vi.mock("./stt", () => {
  class FakeSttStream {
    constructor(opts = {}) {
      this.opts = opts;
      this._onStatus = opts.onStatus || (() => {});
      this.diarizationActive = !!opts.diarize && sttConfig.diarizationActive;
    }
    async connect() {
      this._onStatus("open");
    }
    send() {}
    close() {
      this._onStatus("closed");
    }
    // Test-only: push a frame as if it had arrived from the provider.
    deliver(frame) {
      (this.opts.onTranscript || (() => {}))(frame);
    }
  }
  return {
    createSttStream: async (opts) => {
      sttCalls.push(opts);
      const stream = new FakeSttStream(opts);
      sttStreams.push(stream);
      return stream;
    },
  };
});

import { CopilotSession } from "./session";

function makeTrack() {
  return { stop: vi.fn(), addEventListener: vi.fn() };
}

function makeStream(hasAudio) {
  const audioTracks = hasAudio ? [makeTrack()] : [];
  const videoTracks = [makeTrack()];
  return {
    getAudioTracks: () => audioTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
  };
}

class FakeAudioContext {
  constructor() {
    // AC-S4.1: a real AudioContext always has `.state`, and PcmPipeline.start()
    // now checks it before treating capture as running (see capture.js) —
    // "running" here reproduces the ordinary case every test in this file
    // wants, same as an already-active real AudioContext needing no resume().
    this.state = "running";
    this.audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    this.destination = {};
  }
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createGain() {
    return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  close() {
    return Promise.resolve();
  }
}
class FakeAudioWorkletNode {
  constructor() {
    this.port = {};
    this.connect = vi.fn();
    this.disconnect = vi.fn();
  }
}

const originalMediaDevices = globalThis.navigator?.mediaDevices;
const originalAudioContext = globalThis.AudioContext;
const originalAudioWorkletNode = globalThis.AudioWorkletNode;

beforeEach(() => {
  sttCalls.length = 0;
  sttStreams.length = 0;
  sttConfig.diarizationActive = true;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
});

afterEach(() => {
  if (originalMediaDevices === undefined) {
    if (globalThis.navigator) delete globalThis.navigator.mediaDevices;
  } else {
    globalThis.navigator.mediaDevices = originalMediaDevices;
  }
  if (originalAudioContext === undefined) delete globalThis.AudioContext;
  else globalThis.AudioContext = originalAudioContext;
  if (originalAudioWorkletNode === undefined) delete globalThis.AudioWorkletNode;
  else globalThis.AudioWorkletNode = originalAudioWorkletNode;
});

function ensureNavigator() {
  if (typeof globalThis.navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
  }
}

function stubMediaDevices({ onGetDisplayMedia, onGetUserMedia } = {}) {
  ensureNavigator();
  globalThis.navigator.mediaDevices = {
    getDisplayMedia: vi.fn(onGetDisplayMedia || (() => Promise.resolve(makeStream(true)))),
    getUserMedia: vi.fn(onGetUserMedia || (() => Promise.resolve(makeStream(true)))),
  };
}

// A four-turn interview opening that satisfies every clause of the confidence
// gate: two voices, four turns, the interviewer has asked (tag 0), the candidate
// has asked nothing and has said 99 words (tag 1). See AC-M1.3.4.
const INTERVIEW = [
  { speakerTag: 0, text: "Tell me about yourself?" },
  {
    speakerTag: 1,
    text: "I spent the last two years on the billing platform where I owned the ingest pipeline end to end, and the project I am most proud of is the migration off the nightly batch job onto a streaming path that took reconciliation from three days down to under an hour for every downstream consumer we had",
  },
  { speakerTag: 0, text: "What was the hardest part?" },
  {
    speakerTag: 1,
    text: "The hardest part was the dual write window because we could not take any downtime at all, so we ran both paths side by side and compared them for a full month before we cut over and only then deleted the old job",
  },
];

function deliverTurn(stream, { speakerTag, text }) {
  stream.deliver({
    speaker: "mic",
    speakerTag,
    transcript: text,
    isFinal: true,
    speechFinal: true,
  });
}

async function startInPerson(extra = {}) {
  stubMediaDevices();
  const transcripts = [];
  const utterances = [];
  const session = new CopilotSession({
    source: "inperson",
    onTranscript: (t) => transcripts.push(t),
    onUtterance: (u) => utterances.push(u),
    ...extra,
  });
  await session.start();
  return { session, transcripts, utterances, mic: sttStreams[0] };
}

describe("CopilotSession in-person source", () => {
  it("never opens a screen or tab share", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ source: "inperson" });
    await session.start();

    expect(globalThis.navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
  });

  it("captures the microphone and nothing else", async () => {
    // Asserted together deliberately: "getUserMedia was called" on its own is
    // already true of the tab path, where the mic is its optional second source.
    stubMediaDevices();
    const session = new CopilotSession({ source: "inperson" });
    await session.start();

    expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(globalThis.navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(0);
  });

  it("opens exactly one transcription stream, and asks it to diarize", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ source: "inperson" });
    await session.start();

    expect(sttCalls).toHaveLength(1);
    expect(sttCalls[0].diarize).toBe(true);
  });

  it("captures the microphone even when withMic is false", async () => {
    // Honouring withMic here would build a session with zero sources, whose
    // aggregate status reads "idle" while nothing is transcribed at all.
    stubMediaDevices();
    const session = new CopilotSession({ source: "inperson", withMic: false });
    await session.start();

    expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("CopilotSession in-person failure semantics", () => {
  it("is fatal when the microphone is unavailable, and says the session cannot start", async () => {
    // In tab/system mode the mic is optional and "continuing with interviewer
    // audio only" is true. Here the mic IS the session, so that sentence would
    // be a plain falsehood.
    stubMediaDevices({
      onGetUserMedia: () => Promise.reject(new Error("Permission denied")),
    });
    const onError = vi.fn();
    const session = new CopilotSession({ source: "inperson", onError });

    await expect(session.start()).rejects.toThrow(/cannot start/i);
  });

  it("does not reuse live mode's 'continuing with interviewer audio only' wording", async () => {
    stubMediaDevices({
      onGetUserMedia: () => Promise.reject(new Error("Permission denied")),
    });
    const onError = vi.fn();
    const session = new CopilotSession({ source: "inperson", onError });

    await expect(session.start()).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringMatching(/interviewer audio only/i),
      }),
    );
  });

  it("warns, rather than silently mislabelling, when the provider cannot diarize", async () => {
    // Everything-under-one-label would look like a working session that simply
    // never hears a question.
    sttConfig.diarizationActive = false;
    stubMediaDevices();
    const onError = vi.fn();
    const session = new CopilotSession({ source: "inperson", onError });
    await session.start();

    expect(onError).toHaveBeenCalled();
    const messages = onError.mock.calls.map((c) => String(c[0]?.message || "")).join(" | ");
    expect(messages).toMatch(/speaker|apart|diariz/i);
  });

  it("does NOT warn when diarization is actually active", async () => {
    // Without this, an implementation that warns on every in-person session
    // passes the test above while crying wolf at every user.
    sttConfig.diarizationActive = true;
    stubMediaDevices();
    const onError = vi.fn();
    const session = new CopilotSession({ source: "inperson", onError });
    await session.start();

    const messages = onError.mock.calls.map((c) => String(c[0]?.message || "")).join(" | ");
    expect(messages).not.toMatch(/speaker|apart|diariz/i);
  });
});

describe("CopilotSession in-person speaker resolution", () => {
  it("resolves the candidate to you and the interviewer to them once the interview is under way", async () => {
    // The load-bearing test of this whole feature. A constant "them" - which an
    // earlier version of this file could not distinguish from a real
    // implementation - fails here, because both labels must appear on the right
    // voices.
    const { mic, transcripts } = await startInPerson();
    for (const turn of INTERVIEW) deliverTurn(mic, turn);

    // Deliberately NOT a question from the candidate. Whether an implementation
    // computes `evaluate`/the label before or after folding this utterance into
    // the evidence is an ordering detail the AC does not pin, and a question
    // here would make the outcome differ between those two orderings - so the
    // test would fail a correct implementation that merely chose the other one.
    deliverTurn(mic, { speakerTag: 1, text: "That is the project I would point to first." });
    deliverTurn(mic, { speakerTag: 0, text: "Why this team specifically?" });

    const candidate = transcripts.at(-2);
    const interviewer = transcripts.at(-1);
    expect(candidate.speaker).toBe("you");
    expect(interviewer.speaker).toBe("them");
  });

  it("forwards the raw speaker tag alongside the resolved label", async () => {
    const { mic, transcripts } = await startInPerson();
    deliverTurn(mic, { speakerTag: 3, text: "and how did the team react to that?" });

    expect(transcripts[0].speakerTag).toBe(3);
    expect(["you", "them"]).toContain(transcripts[0].speaker);
  });

  it("labels an unresolved speaker them, so a first question is never missed", async () => {
    // The two failure directions are not symmetric: calling the interviewer
    // "you" drops the question the copilot exists to answer.
    const { mic, transcripts } = await startInPerson();
    deliverTurn(mic, { speakerTag: 0, text: "Why are you interested in this role?" });

    expect(transcripts[0].speaker).toBe("them");
  });
});

describe("CopilotSession in-person utterances", () => {
  it("reports one assembled utterance per turn", async () => {
    const { mic, utterances } = await startInPerson();
    for (const turn of INTERVIEW) deliverTurn(mic, turn);

    expect(utterances).toHaveLength(4);
    expect(utterances[0].text).toBe("Tell me about yourself?");
    expect(utterances[0].speakerTag).toBe(0);
  });

  it("marks every speaker worth evaluating during cold start", async () => {
    const { mic, utterances } = await startInPerson();
    deliverTurn(mic, { speakerTag: 0, text: "So what got you into this line of work?" });

    expect(utterances[0].evaluate).toBe(true);
  });

  it("emits a still-buffered utterance when the session stops", async () => {
    // Added after a sabotage check found this uncovered: deleting the
    // drainAll() call on stop turned NOTHING red, because every other turn in
    // this file arrives with speechFinal set and therefore self-drains. A
    // speaker who is mid-sentence when the user presses Stop is the real case,
    // and without this their last words are silently discarded.
    const { session, mic, utterances } = await startInPerson();

    mic.deliver({
      speaker: "mic",
      speakerTag: 0,
      transcript: "So one last thing before we wrap up",
      isFinal: true,
      speechFinal: false,
    });
    expect(utterances).toHaveLength(0);

    await session.stop();

    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("So one last thing before we wrap up");
  });

  it("stops marking the candidate's own speech once identity is settled", async () => {
    const { mic, utterances } = await startInPerson();
    for (const turn of INTERVIEW) deliverTurn(mic, turn);

    // Deliberately NOT a question from the candidate. Whether an implementation
    // computes `evaluate`/the label before or after folding this utterance into
    // the evidence is an ordering detail the AC does not pin, and a question
    // here would make the outcome differ between those two orderings - so the
    // test would fail a correct implementation that merely chose the other one.
    deliverTurn(mic, { speakerTag: 1, text: "That is the project I would point to first." });
    deliverTurn(mic, { speakerTag: 0, text: "Why this team specifically?" });

    expect(utterances.at(-2).evaluate).toBe(false);
    expect(utterances.at(-1).evaluate).toBe(true);
  });
});

describe("CopilotSession in-person speaker correction", () => {
  // The identity instance lives inside CopilotSession (AC-M1.4.9), so the UI
  // needs a public way to read who it thinks the user is and to overrule it.
  // Without this surface the correction control required by AC-M1.5.6 cannot
  // exist at all.

  it("exposes the current identity state", async () => {
    const { session, mic } = await startInPerson();
    for (const turn of INTERVIEW) deliverTurn(mic, turn);

    const snap = session.speakerSnapshot();
    expect(snap.userTag).toBe(1);
    expect(snap.confidence).toBe("high");
    expect(snap.overridden).toBe(false);
  });

  it("reports identity as unsettled before enough has been heard", async () => {
    const { session, mic } = await startInPerson();
    deliverTurn(mic, { speakerTag: 0, text: "Thanks for coming in today." });

    expect(session.speakerSnapshot().confidence).not.toBe("high");
  });

  it("lets the user overrule the guess, and says so", async () => {
    const { session, mic } = await startInPerson();
    for (const turn of INTERVIEW) deliverTurn(mic, turn);

    session.assignUser(0);

    const snap = session.speakerSnapshot();
    expect(snap.userTag).toBe(0);
    expect(snap.overridden).toBe(true);
  });

  it("relabels subsequent speech according to the correction", async () => {
    const { session, mic, transcripts } = await startInPerson();
    for (const turn of INTERVIEW) deliverTurn(mic, turn);

    session.assignUser(0);
    deliverTurn(mic, { speakerTag: 0, text: "And where do you see yourself going next?" });
    deliverTurn(mic, { speakerTag: 1, text: "Somewhere I can own a service end to end." });

    expect(transcripts.at(-2).speaker).toBe("you");
    expect(transcripts.at(-1).speaker).toBe("them");
  });

  it("stops evaluating the corrected user's speech for questions", async () => {
    const { session, mic, utterances } = await startInPerson();
    for (const turn of INTERVIEW) deliverTurn(mic, turn);

    session.assignUser(0);
    deliverTurn(mic, { speakerTag: 0, text: "And where do you see yourself going next?" });

    expect(utterances.at(-1).evaluate).toBe(false);
  });

  it("notifies the UI when identity changes, so a correction can re-render", async () => {
    // Without a notification the transcript keeps rendering the old labels
    // until something else happens to re-render it.
    stubMediaDevices();
    const snapshots = [];
    const session = new CopilotSession({
      source: "inperson",
      onSpeakerIdentity: (s) => snapshots.push(s),
    });
    await session.start();

    session.assignUser(0);

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.at(-1).userTag).toBe(0);
    expect(snapshots.at(-1).overridden).toBe(true);
  });
});

describe("CopilotSession existing sources are unchanged", () => {
  it("does not request diarization on the tab path", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ source: "tab" });
    await session.start();

    for (const call of sttCalls) expect(call.diarize).toBeFalsy();
  });

  it("does not request diarization on the system-audio path", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ source: "system" });
    await session.start();

    for (const call of sttCalls) expect(call.diarize).toBeFalsy();
  });

  it("still opens two streams on the tab path", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ source: "tab" });
    await session.start();

    expect(sttCalls).toHaveLength(2);
  });

  it("passes a tab-path frame through untouched, with no speakerTag key added", async () => {
    // Without this, an implementation that routes EVERY source through the
    // identity module - rewriting `speaker` and attaching `speakerTag` on the
    // tab path too - passes every other test in this file.
    stubMediaDevices();
    const transcripts = [];
    const session = new CopilotSession({
      source: "tab",
      onTranscript: (t) => transcripts.push(t),
    });
    await session.start();

    sttStreams[0].deliver({
      speaker: "them",
      transcript: "so tell me about yourself",
      isFinal: true,
      speechFinal: true,
      start: 1.5,
      duration: 2,
    });

    expect(transcripts[0]).toEqual({
      speaker: "them",
      transcript: "so tell me about yourself",
      isFinal: true,
      speechFinal: true,
      start: 1.5,
      duration: 2,
    });
    expect("speakerTag" in transcripts[0]).toBe(false);
  });

  it("fires no utterance callback on the tab path", async () => {
    stubMediaDevices();
    const utterances = [];
    const session = new CopilotSession({
      source: "tab",
      onUtterance: (u) => utterances.push(u),
    });
    await session.start();

    sttStreams[0].deliver({
      speaker: "them",
      transcript: "so tell me about yourself",
      isFinal: true,
      speechFinal: true,
    });

    expect(utterances).toHaveLength(0);
  });

  it("an unrecognized source still falls back to the tab path, not to mic-only", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ source: "bluetooth-headset" });
    await session.start();

    expect(globalThis.navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
  });
});
