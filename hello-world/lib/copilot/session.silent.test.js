import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AC-S4.3 (defect 7) and AC-S4.4 (defect 8) — see
// lib/copilot/stt/deepgram.silent.test.js's header comment for the shape of
// bug this style of test exists to catch: a live session that reports
// "Live" while something about it has already gone wrong, with no error
// shown and no way for the user to tell. Both cases here are on
// CopilotSession's own side of that bug, once past a healthy STT
// connection:
//   - AC-S4.3: a start() that fails partway through must not leak the
//     MediaStream(s) it already captured — the browser's own recording
//     indicator staying lit is exactly what makes a failed session look,
//     from the user's chair, like it's still somehow live.
//   - AC-S4.4: an in-person frame flagged `textAlreadyDelivered` (see
//     stt/index.js's onTranscript contract, and stt/elevenlabs.js's
//     commit_strategy=vad re-delivery) must not double the text of the
//     assembled utterance it belongs to.

const sttCalls = vi.hoisted(() => []);
const sttStreams = vi.hoisted(() => []);
// `connectShouldThrow` fails every connect() (AC-S4.3's single-source
// cases); `throwOnCallIndex` fails only the Nth _addSource call (0-based),
// so a test can let an earlier source succeed and only the later one fail —
// without resorting to spying on this already-mocked module.
const sttConfig = vi.hoisted(() => ({ connectShouldThrow: false, throwOnCallIndex: null }));

vi.mock("./stt", () => {
  class FakeSttStream {
    constructor(opts = {}) {
      this.opts = opts;
      this._onStatus = opts.onStatus || (() => {});
      this.diarizationActive = !!opts.diarize;
      this._callIndex = sttCalls.length - 1;
    }
    async connect() {
      if (sttConfig.connectShouldThrow || sttConfig.throwOnCallIndex === this._callIndex) {
        throw new Error("token route unavailable (503)");
      }
      this._onStatus("open");
    }
    send() {}
    // D2: a vi.fn() class field (not a plain method) so a test can assert
    // specifically that THIS call closed the socket — the resource
    // session.silent.test.js's earlier AC-S4.3 cases never had to look at,
    // since those only ever failed before connect() ever opened anything.
    close = vi.fn(() => {
      this._onStatus("closed");
    });
    // Test-only: push a frame as if it had arrived from the provider.
    deliver(frame) {
      (this.opts.onTranscript || (() => {}))(frame);
    }
    // Test-only (D1): simulate stt/deepgram.js's own unexpected-close
    // handler calling onError on a socket drop it didn't ask for — see that
    // file's "close" listener. Not a real close(): the point of these D1
    // cases is what CopilotSession's aggregateStatus() does with the error
    // it's handed, not the deepgram.js code that produces it (that's
    // deepgram.silent.test.js's job).
    reportUnexpectedClose(message = "Deepgram connection closed unexpectedly (code 1006).") {
      (this.opts.onError || (() => {}))(new Error(message));
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

// capture.js's PcmPipeline is real code in these tests, so it needs a fake
// AudioContext/AudioWorkletNode — same doubles session.test.js and
// session.inperson.test.js already use.
class FakeAudioContext {
  constructor() {
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
  sttConfig.connectShouldThrow = false;
  // D3: reset alongside connectShouldThrow above — left unreset, a case
  // that sets this (like the ":187" case below) leaks it into every test
  // that runs after it in file order. Inert today only because no later
  // case's _addSource calls happen to reach call index 1; a third source or
  // a reordered case would fail for a reason invisible at the failing test
  // itself.
  sttConfig.throwOnCallIndex = null;
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

describe("CopilotSession.stop releases every captured track (AC-S4.3)", () => {
  it("stops the tracks of a stream whose source never finished wiring, after start() rejects", async () => {
    sttConfig.connectShouldThrow = true;
    let capturedStream;
    stubMediaDevices({
      onGetDisplayMedia: () => {
        capturedStream = makeStream(true);
        return Promise.resolve(capturedStream);
      },
    });
    const session = new CopilotSession({ withMic: false, source: "tab" });

    // The STT provider's connect() throwing (a token route 503, per the
    // real report) means _addSource never reaches `this._sources.push(...)`
    // — start() itself rejects with that failure.
    await expect(session.start()).rejects.toThrow(/503/);
    expect(session._sources).toHaveLength(0);

    await session.stop();

    for (const track of capturedStream.getTracks()) {
      expect(track.stop).toHaveBeenCalled();
    }
  });

  it("stops tracks from BOTH the them and you streams when the second source's connect() fails", async () => {
    // The them source (_addSource call index 0) connects fine and reaches
    // `_sources`; the you/mic source (call index 1) then fails. Both
    // streams were captured — both must be released.
    let themStream;
    let micStream;
    stubMediaDevices({
      onGetDisplayMedia: () => {
        themStream = makeStream(true);
        return Promise.resolve(themStream);
      },
      onGetUserMedia: () => {
        micStream = makeStream(true);
        return Promise.resolve(micStream);
      },
    });
    const onError = vi.fn();
    const session = new CopilotSession({ withMic: true, source: "tab", onError });
    sttConfig.throwOnCallIndex = 1;

    await session.start();

    // The you source's failure is soft (session.js's own try/catch around
    // it) — it reports via onError and keeps the them source running,
    // rather than failing the whole session.
    expect(session._sources.map((s) => s.key)).toEqual(["them"]);
    expect(onError).toHaveBeenCalled();

    await session.stop();

    for (const track of themStream.getTracks()) {
      expect(track.stop).toHaveBeenCalled();
    }
    for (const track of micStream.getTracks()) {
      expect(track.stop).toHaveBeenCalled();
    }
  });

  it("stops the mic stream for an in-person session whose connect() fails", async () => {
    sttConfig.connectShouldThrow = true;
    let capturedStream;
    stubMediaDevices({
      onGetUserMedia: () => {
        capturedStream = makeStream(true);
        return Promise.resolve(capturedStream);
      },
    });
    const session = new CopilotSession({ source: "inperson" });

    await expect(session.start()).rejects.toThrow(/503/);
    expect(session._sources).toHaveLength(0);

    await session.stop();

    for (const track of capturedStream.getTracks()) {
      expect(track.stop).toHaveBeenCalled();
    }
  });
});

describe("CopilotSession in-person textAlreadyDelivered dedup (AC-S4.4)", () => {
  async function startInPerson(extra = {}) {
    stubMediaDevices();
    const utterances = [];
    const session = new CopilotSession({
      source: "inperson",
      onUtterance: (u) => utterances.push(u),
      ...extra,
    });
    await session.start();
    return { session, utterances, mic: sttStreams[sttStreams.length - 1] };
  }

  it("does not double the text of a re-delivered committed frame, but still honours its speechFinal", async () => {
    const { mic, utterances } = await startInPerson();

    // First delivery: a normal final frame, not yet end-of-turn.
    mic.deliver({
      speaker: "mic",
      speakerTag: 0,
      transcript: "let's talk about your last role",
      isFinal: true,
      speechFinal: false,
      start: 1,
      duration: 2,
    });
    expect(utterances).toHaveLength(0);

    // Second delivery: the exact same span, re-sent purely to carry
    // speechFinal — the shape ElevenLabs' commit_strategy=vad produces (see
    // stt/elevenlabs.js's _emitTranscript / textAlreadyDelivered comment).
    mic.deliver({
      speaker: "mic",
      speakerTag: 0,
      transcript: "let's talk about your last role",
      isFinal: true,
      speechFinal: true,
      start: 1,
      duration: 2,
      textAlreadyDelivered: true,
    });

    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("let's talk about your last role");
  });

  it("still assembles normally when textAlreadyDelivered is never set (no regression)", async () => {
    const { mic, utterances } = await startInPerson();

    mic.deliver({
      speaker: "mic",
      speakerTag: 0,
      transcript: "tell me about a project you're proud of",
      isFinal: true,
      speechFinal: true,
    });

    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("tell me about a project you're proud of");
  });
});

// D1 / R-038: an unexpected close on the OPTIONAL mic socket (stt/deepgram.js's
// own close listener already reports this through onError — see
// deepgram.silent.test.js) must DEGRADE a two-source session, not KILL it.
// Both directions are required or the fix is unfalsifiable: a version that
// simply never let ANY error escalate would pass the positive case below
// while breaking the negative ones, which is exactly what R-038 already
// pins for the "them"/mic-only-is-optional contract.
describe("CopilotSession degrades on a non-essential source's error, but not an essential one's (D1)", () => {
  it("stays live and only warns when the OPTIONAL you/mic socket closes unexpectedly on a two-source session", async () => {
    stubMediaDevices();
    const onError = vi.fn();
    const session = new CopilotSession({ withMic: true, source: "tab", onError });
    await session.start();
    expect(session.aggregateStatus()).toBe("live");

    const you = sttStreams[sttStreams.length - 1];
    you.reportUnexpectedClose();

    // The whole point of D1: the healthy, essential "them" source must not
    // be taken down by the optional mic socket dying.
    expect(session.aggregateStatus()).toBe("live");
    // The user is still TOLD — routed through the same onError warning
    // channel every other soft mic failure already uses, not swallowed.
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls.at(-1)[0].message).toMatch(/unexpectedly/i);
  });

  it("does NOT silently downgrade when the ESSENTIAL them socket closes unexpectedly on the same two-source session", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ withMic: true, source: "tab" });
    await session.start();
    expect(session.aggregateStatus()).toBe("live");

    const them = sttStreams[0];
    them.reportUnexpectedClose();

    // Negative control for the case above — an essential source's error
    // still has to escalate, or a fix that just stopped escalating
    // anything at all would pass the positive case for the wrong reason.
    expect(session.aggregateStatus()).toBe("error");
  });

  it("does NOT silently downgrade when an in-person session's only (and therefore essential) mic socket closes unexpectedly", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ source: "inperson" });
    await session.start();
    expect(session.aggregateStatus()).toBe("live");

    const mic = sttStreams[sttStreams.length - 1];
    mic.reportUnexpectedClose();

    // "inperson" has exactly one source, and it IS that source — the mic
    // being essential-and-only there is exactly why its own failure must
    // escalate rather than degrade.
    expect(session.aggregateStatus()).toBe("error");
  });
});

// D2: `_addSource`'s order is createSttStream -> await dg.connect() (socket
// now OPEN) -> new PcmPipeline() -> await pipeline.start(...) -> push into
// `_sources`. A throw from pipeline.start() — reached here via the real
// AC-S4.1 AudioContext-resume check in capture.js, not a mock of it, so this
// exercises the exact failure shape reported — used to leave neither the
// socket nor the AudioContext anywhere stop() could find them.
describe("CopilotSession releases the STT socket and the AudioContext when a later step throws (D2)", () => {
  it("closes the STT stream and tears down the AudioContext when pipeline.start() throws after the socket is already open", async () => {
    const contexts = [];
    class StuckAudioContext {
      constructor() {
        this.state = "suspended";
        this.audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
        this.destination = {};
        this.closed = false;
        // Resolves without ever reaching "running" — resume() genuinely can
        // do this (no user gesture left to spend), which is what makes
        // AC-S4.1's check throw from inside pipeline.start(), well AFTER
        // dg.connect() above it has already opened the STT socket.
        this.resume = vi.fn(() => Promise.resolve());
        contexts.push(this);
      }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createGain() {
        return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
      }
      close() {
        this.closed = true;
        return Promise.resolve();
      }
    }
    globalThis.AudioContext = StuckAudioContext;

    let capturedStream;
    stubMediaDevices({
      onGetDisplayMedia: () => {
        capturedStream = makeStream(true);
        return Promise.resolve(capturedStream);
      },
    });
    const session = new CopilotSession({ withMic: false, source: "tab" });

    let caught;
    try {
      await session.start();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/stuck/i);
    // D2's capture.js half: the message names the actual capture ("Tab
    // audio capture"), not the microphone default — a tab share failing
    // here must not be misreported as a mic problem.
    expect(caught.message).toMatch(/^Tab audio capture could not start/);
    expect(caught.message).not.toMatch(/Microphone/);

    // start() rejected before _addSource ever reached `_sources.push(...)`.
    expect(session._sources).toHaveLength(0);

    // The two resources D2 identifies as newly leaking on this exact path —
    // asserted directly, not inferred from aggregateStatus or `_sources`,
    // since those are exactly what the current (pre-fix) test cannot see.
    expect(sttStreams[sttStreams.length - 1].close).toHaveBeenCalled();
    expect(contexts[0].closed).toBe(true);

    // The MediaStream itself is the pre-existing AC-S4.3 path (recorded in
    // `_openStreams` before _addSource is ever attempted) — still covered
    // by a stop() here so this test proves the FULL cleanup, not just the
    // two resources this defect newly added.
    await session.stop();
    for (const track of capturedStream.getTracks()) {
      expect(track.stop).toHaveBeenCalled();
    }
  });
});
