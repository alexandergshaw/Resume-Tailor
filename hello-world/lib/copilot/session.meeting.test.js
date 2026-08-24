// CopilotSession with speaker attribution turned OFF — the mode a work
// meeting needs.
//
// Why this exists at all: `lib/copilot/speakerIdentity.js` decides who "you"
// is with `youScore = wordShare - 2 * questionRate`, justified in its own
// header by "the candidate talks the most and asks the fewest questions; the
// interviewer does the opposite". In a meeting the user is very often the
// quietest person in the room and very often the one asking. That formula
// would not be slightly off, it would be systematically backwards — and that
// file's header records that a naive version of it elected the wrong speaker
// twice on real audio and then went silently deaf, because question detection
// is routed off the identity gate.
//
// So a meeting does not tune the formula. It does not run it. One shared
// microphone gets ONE unattributed voice, and the UI says so.
//
// The interview path must be byte-for-byte unaffected, which is why every
// block below carries the default-behaviour case alongside the new one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sttCalls = vi.hoisted(() => []);
const sttStreams = vi.hoisted(() => []);
const sttConfig = vi.hoisted(() => ({ diarizationActive: true }));

vi.mock("./stt", () => {
  class FakeSttStream {
    constructor(opts = {}) {
      this.opts = opts;
      this._onStatus = opts.onStatus || (() => {});
      // Mirrors the real contract: active only when diarization was BOTH
      // requested and supported. With attribution off it is never requested,
      // so this is false for the reason that matters.
      this.diarizationActive = !!opts.diarize && sttConfig.diarizationActive;
    }
    async connect() {
      this._onStatus("open");
    }
    send() {}
    close() {
      this._onStatus("closed");
    }
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

function makeStream() {
  const audioTracks = [makeTrack()];
  const videoTracks = [makeTrack()];
  return {
    getAudioTracks: () => audioTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
  };
}

class FakeAudioContext {
  constructor() {
    // capture.js checks `.state` before treating capture as running; a double
    // that omits it silently skips a load-bearing production check.
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

function stubMediaDevices() {
  if (typeof globalThis.navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", { value: {}, writable: true, configurable: true });
  }
  globalThis.navigator.mediaDevices = {
    getDisplayMedia: vi.fn(() => Promise.resolve(makeStream())),
    getUserMedia: vi.fn(() => Promise.resolve(makeStream())),
  };
}

async function start(extra = {}) {
  stubMediaDevices();
  const transcripts = [];
  const utterances = [];
  const identities = [];
  const errors = [];
  const session = new CopilotSession({
    source: "inperson",
    onTranscript: (t) => transcripts.push(t),
    onUtterance: (u) => utterances.push(u),
    onSpeakerIdentity: (s) => identities.push(s),
    onError: (e) => errors.push(e),
    ...extra,
  });
  await session.start();
  return { session, transcripts, utterances, identities, errors, mic: sttStreams[0] };
}

// A meeting turn as it actually arrives with diarization off: no speakerTag
// key at all. stt/index.js is explicit that speakerTag must be ABSENT rather
// than undefined when the provider did not split the frame.
function deliverTurn(stream, text) {
  stream.deliver({ speaker: "mic", transcript: text, isFinal: true, speechFinal: true });
}

describe("requesting diarization", () => {
  it("does NOT ask for it when attribution is off", async () => {
    // Asking a provider to separate speakers and then discarding the answer
    // would still cost the request and, on Deepgram, a different model.
    await start({ attributeSpeakers: false });
    expect(sttCalls).toHaveLength(1);
    expect(sttCalls[0].diarize).toBe(false);
  });

  it("still asks for it by default, so the interview path is untouched", async () => {
    // The whole safety of this change rests on the default being unchanged -
    // session.test.js, session.inperson.test.js and session.silent.test.js all
    // construct without the option.
    await start();
    expect(sttCalls[0].diarize).toBe(true);
  });
});

describe("what a turn is labelled", () => {
  it("labels every turn as one unattributed room voice", async () => {
    const { transcripts, utterances, mic } = await start({ attributeSpeakers: false });

    deliverTurn(mic, "Shall we start with the migration status?");
    deliverTurn(mic, "The dual write window closes on Friday.");

    // Not "them", not "you", not a guess: one value meaning "this room".
    expect(transcripts.map((t) => t.speaker)).toEqual(["room", "room"]);
    expect(utterances.map((u) => u.speaker)).toEqual(["room", "room"]);
  });

  it("still assembles turns into whole utterances with their text intact", async () => {
    // Positive control for the block above: a session that had simply stopped
    // emitting utterances would satisfy "no turn is labelled you".
    const { utterances, mic } = await start({ attributeSpeakers: false });

    deliverTurn(mic, "Shall we start with the migration status?");
    deliverTurn(mic, "The dual write window closes on Friday.");

    expect(utterances.map((u) => u.text)).toEqual([
      "Shall we start with the migration status?",
      "The dual write window closes on Friday.",
    ]);
  });

  it("marks every utterance as worth evaluating", async () => {
    // With no identity there is no conservative gate to consult, and a
    // meeting has no "the other person asked this" notion anyway - every turn
    // is potential material.
    const { utterances, mic } = await start({ attributeSpeakers: false });
    deliverTurn(mic, "Do we still need the legacy processor?");
    expect(utterances.every((u) => u.evaluate === true)).toBe(true);
  });

  it("never reports a speaker identity", async () => {
    // onSpeakerIdentity drives the interview UI's "still working out who is
    // who" banner and its correction control. Neither exists here, and firing
    // it would mean an identity was computed after all.
    const { identities, mic } = await start({ attributeSpeakers: false });
    deliverTurn(mic, "Shall we start with the migration status?");
    expect(identities).toEqual([]);
  });

  it("still reports one by default", async () => {
    // Positive control: proves the assertion above is about the option and
    // not about a callback that stopped firing for everyone.
    const { identities, mic } = await start();
    mic.deliver({ speaker: "mic", speakerTag: 0, transcript: "Tell me about yourself?", isFinal: true, speechFinal: true });
    expect(identities.length).toBeGreaterThan(0);
  });
});

describe("the diarization warning", () => {
  it("is not shown when attribution was never wanted", async () => {
    // The interview copilot warns when a provider cannot separate speakers,
    // and the wording names live pace and filler-word readings "for you" -
    // both meaningless in a meeting, and the whole sentence describes a
    // degradation that has not happened. Showing it here would be a bug
    // report about a feature the user did not ask for.
    sttConfig.diarizationActive = false;
    const { errors } = await start({ attributeSpeakers: false });
    expect(errors).toEqual([]);
  });

  it("is still shown by default when the provider cannot separate speakers", async () => {
    // Positive control, and the one that stops this being implemented by
    // deleting the warning outright.
    sttConfig.diarizationActive = false;
    const { errors } = await start();
    expect(errors).toHaveLength(1);
    expect(String(errors[0].message)).toContain("speakers apart");
  });
});

describe("the tab and system paths are untouched", () => {
  it("keeps its two structurally separated streams whatever the option says", async () => {
    // These paths never built a speaker identity in the first place - their
    // separation comes from opening two independent sockets - so the option
    // must be inert here rather than quietly collapsing them to one voice.
    stubMediaDevices();
    const session = new CopilotSession({ source: "tab", attributeSpeakers: false });
    await session.start();

    expect(sttCalls.map((c) => c.speaker).sort()).toEqual(["them", "you"]);
    // Still no diarization requested on this path, exactly as before: two
    // sockets already give speaker separation for free.
    expect(sttCalls.every((c) => !c.diarize)).toBe(true);
  });
});
