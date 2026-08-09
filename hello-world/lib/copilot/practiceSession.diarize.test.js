import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Written from AC-M2 BEFORE practice-mode diarization existed. Separate from
// practiceSession.test.js so that file's pre-feature assertions stay pinned by
// tests this feature never touches.
//
// Practice mode records from ONE microphone, so anyone else in the room lands in
// the same stream as the candidate. Diarization is requested unconditionally
// here (unlike live mode, where it is tied to the in-person source): the mic is
// already the only source, the parameter costs nothing, and a solo practice
// session - the overwhelmingly common case - produces a single speaker tag,
// which the answer partition treats exactly as it treats no tag at all. So
// turning it on cannot change what a solo user measures.

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
    deliver(frame) {
      (this.opts.onTranscript || (() => {}))(frame);
    }
  }
  return {
    createSttStream: async (opts) => {
      sttCalls.push(opts);
      const s = new FakeSttStream(opts);
      sttStreams.push(s);
      return s;
    },
  };
});

import { PracticeSession } from "./practiceSession";

function makeTrack() {
  return { stop: vi.fn(), addEventListener: vi.fn() };
}

function makeStream({ audio = true, video = true } = {}) {
  const audioTracks = audio ? [makeTrack()] : [];
  const videoTracks = video ? [makeTrack()] : [];
  return {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
  };
}

class FakeAudioContext {
  constructor() {
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

function ensureNavigator() {
  if (typeof globalThis.navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
  }
}

beforeEach(() => {
  sttCalls.length = 0;
  sttStreams.length = 0;
  sttConfig.diarizationActive = true;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  ensureNavigator();
  globalThis.navigator.mediaDevices = {
    getUserMedia: vi.fn(() => Promise.resolve(makeStream())),
  };
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

describe("PracticeSession diarization", () => {
  it("asks its single stream to diarize", async () => {
    const session = new PracticeSession({ withVideo: false });
    await session.start();

    expect(sttCalls).toHaveLength(1);
    expect(sttCalls[0].diarize).toBe(true);
  });

  it("still opens exactly one stream", async () => {
    const session = new PracticeSession({ withVideo: false });
    await session.start();

    expect(sttCalls).toHaveLength(1);
  });

  it("forwards a frame's speaker tag to the consumer", async () => {
    // usePracticeAnswer needs the tag on each collected final to decide, at the
    // end of an answer, whose words the delivery metrics are computed over.
    const seen = [];
    const session = new PracticeSession({
      withVideo: false,
      onTranscript: (t) => seen.push(t),
    });
    await session.start();

    sttStreams[0].deliver({
      speaker: "you",
      speakerTag: 2,
      transcript: "I led the billing migration",
      isFinal: true,
      speechFinal: true,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].speakerTag).toBe(2);
  });

  it("keeps reporting the candidate as the speaker, so existing consumers are unchanged", async () => {
    // Practice mode's whole transcript vocabulary is "you". Nothing downstream
    // should have to learn a second one just because a tag is now present.
    const seen = [];
    const session = new PracticeSession({
      withVideo: false,
      onTranscript: (t) => seen.push(t),
    });
    await session.start();

    sttStreams[0].deliver({
      speaker: "you",
      speakerTag: 0,
      transcript: "and we cut reconciliation time",
      isFinal: true,
      speechFinal: true,
    });

    expect(seen[0].speaker).toBe("you");
  });

  it("reports an assembled utterance once a speaker finishes a turn", async () => {
    // Detecting a question asked by someone else in the room has to happen
    // LIVE, as they ask it. The end-of-answer partition cannot serve this: it
    // only resolves when the candidate presses Done, by which point the moment
    // to draft an answer has passed.
    const utterances = [];
    const session = new PracticeSession({
      withVideo: false,
      onUtterance: (u) => utterances.push(u),
    });
    await session.start();

    sttStreams[0].deliver({
      speaker: "you",
      speakerTag: 0,
      transcript: "So what drew you to this role?",
      isFinal: true,
      speechFinal: true,
    });

    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toMatchObject({
      speakerTag: 0,
      text: "So what drew you to this role?",
    });
  });

  it("joins a speaker's segments into one utterance rather than reporting each frame", async () => {
    const utterances = [];
    const session = new PracticeSession({
      withVideo: false,
      onUtterance: (u) => utterances.push(u),
    });
    await session.start();

    const say = (transcript, speechFinal) =>
      sttStreams[0].deliver({
        speaker: "you",
        speakerTag: 0,
        transcript,
        isFinal: true,
        speechFinal,
      });
    say("So what drew you", false);
    say("to this role?", true);

    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("So what drew you to this role?");
  });

  it("closes one speaker's turn when a different speaker starts", async () => {
    // The same deadlock the live path hit: with endpointing at 300ms a frame
    // carrying speech_final routinely also carries the next speaker's opening
    // words, so a turn that is not last in its frame never drains on its own.
    const utterances = [];
    const session = new PracticeSession({
      withVideo: false,
      onUtterance: (u) => utterances.push(u),
    });
    await session.start();

    sttStreams[0].deliver({
      speaker: "you",
      speakerTag: 0,
      transcript: "So what drew you to this role?",
      isFinal: true,
      speechFinal: false,
    });
    sttStreams[0].deliver({
      speaker: "you",
      speakerTag: 1,
      transcript: "Honestly the platform work",
      isFinal: true,
      speechFinal: true,
    });

    expect(utterances.map((u) => u.speakerTag)).toEqual([0, 1]);
  });

  it("fires no utterance callback when the provider cannot diarize", async () => {
    // Without tags there is no one to attribute a turn to, and practice mode's
    // population is overwhelmingly solo - reporting the candidate's own speech
    // as a room utterance would put questions nobody asked on their screen.
    sttConfig.diarizationActive = false;
    const utterances = [];
    const session = new PracticeSession({
      withVideo: false,
      onUtterance: (u) => utterances.push(u),
    });
    await session.start();

    sttStreams[0].deliver({
      speaker: "you",
      transcript: "So what drew you to this role?",
      isFinal: true,
      speechFinal: true,
    });

    expect(utterances).toHaveLength(0);
  });

  it("runs unchanged when the provider cannot diarize", async () => {
    // ElevenLabs Scribe v2 Realtime has no realtime diarization. Practice mode
    // must not fail, and must not start reporting anything it cannot know - a
    // solo session is the common case and is unaffected either way.
    sttConfig.diarizationActive = false;
    const seen = [];
    const session = new PracticeSession({
      withVideo: false,
      onTranscript: (t) => seen.push(t),
    });
    await session.start();

    sttStreams[0].deliver({
      speaker: "you",
      transcript: "I owned the ingest pipeline",
      isFinal: true,
      speechFinal: true,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].speaker).toBe("you");
    expect(seen[0].speakerTag).toBeUndefined();
  });
});
