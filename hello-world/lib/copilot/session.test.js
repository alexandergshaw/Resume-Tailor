import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DeepgramStream normally fetches a token from our own API route and opens a
// real WebSocket to Deepgram — neither is available in this node test
// environment. Stand in with a class that reports "open" as soon as it's
// asked to connect and otherwise does nothing, so CopilotSession's real
// wiring (capture -> pipeline -> dg) can run end to end without a network.
vi.mock("./deepgram", () => {
  class FakeDeepgramStream {
    constructor({ onStatus } = {}) {
      this._onStatus = onStatus || (() => {});
    }
    async connect() {
      this._onStatus("open");
    }
    send() {
      // no-op — nothing downstream inspects the PCM bytes in these tests
    }
    close() {
      this._onStatus("closed");
    }
  }
  return { DeepgramStream: FakeDeepgramStream };
});

// Imported after the mock above so session.js picks up the fake DeepgramStream.
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

// capture.js's PcmPipeline is real code in these tests (only navigator.
// mediaDevices is stubbed), so it drives a real AudioContext/AudioWorkletNode
// — browser globals that don't exist in node. Stand in with the minimal
// surface PcmPipeline.start()/stop() actually touches.
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

beforeEach(() => {
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

// Node itself defines a read-only `navigator` global (no mediaDevices on it),
// so `globalThis.navigator = ...` throws — only the object's own properties
// can be reassigned, not the binding itself. Fall back to defining it only
// when it's genuinely missing.
function ensureNavigator() {
  if (typeof globalThis.navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
  }
}

// By default both getDisplayMedia and getUserMedia hand back a stream with a
// working audio track; individual tests override one side to exercise a
// failure path.
function stubMediaDevices({ onGetDisplayMedia, onGetUserMedia } = {}) {
  ensureNavigator();
  globalThis.navigator.mediaDevices = {
    getDisplayMedia: vi.fn(onGetDisplayMedia || (() => Promise.resolve(makeStream(true)))),
    getUserMedia: vi.fn(onGetUserMedia || (() => Promise.resolve(makeStream(true)))),
  };
}

describe("CopilotSession source selection", () => {
  it("defaults to the tab path (plain video, no systemAudio) when source is omitted", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ withMic: false });
    await session.start();

    const call = globalThis.navigator.mediaDevices.getDisplayMedia.mock.calls[0][0];
    expect(call.video).toBe(true);
    expect(call.systemAudio).toBeUndefined();
  });

  it('source: "tab" takes the tab path explicitly', async () => {
    stubMediaDevices();
    const session = new CopilotSession({ withMic: false, source: "tab" });
    await session.start();

    const call = globalThis.navigator.mediaDevices.getDisplayMedia.mock.calls[0][0];
    expect(call.video).toBe(true);
    expect(call.systemAudio).toBeUndefined();
  });

  it("an unrecognized source value falls back to the tab path instead of throwing", async () => {
    stubMediaDevices();
    const session = new CopilotSession({ withMic: false, source: "bluetooth-headset" });
    await session.start();

    const call = globalThis.navigator.mediaDevices.getDisplayMedia.mock.calls[0][0];
    expect(call.video).toBe(true);
    expect(call.systemAudio).toBeUndefined();
  });

  it('source: "system" takes the whole-screen system-audio path', async () => {
    stubMediaDevices();
    const session = new CopilotSession({ withMic: false, source: "system" });
    await session.start();

    const call = globalThis.navigator.mediaDevices.getDisplayMedia.mock.calls[0][0];
    expect(call.systemAudio).toBe("include");
    expect(call.video).toEqual({ displaySurface: "monitor" });
  });
});

describe("CopilotSession failure semantics", () => {
  it("is fatal when the them source fails to grant audio", async () => {
    stubMediaDevices({ onGetDisplayMedia: () => Promise.resolve(makeStream(false)) });
    const session = new CopilotSession({ withMic: false, source: "system" });

    await expect(session.start()).rejects.toThrow(/Share system audio/);
  });

  it("soft-fails when the mic is denied: warns via onError but keeps the them source running", async () => {
    stubMediaDevices({
      onGetUserMedia: () => Promise.reject(new Error("Permission denied")),
    });
    const onError = vi.fn();
    const session = new CopilotSession({ withMic: true, onError });

    await session.start();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/Microphone unavailable/);
    expect(onError.mock.calls[0][0].message).toMatch(/Permission denied/);
    expect(session._sources.map((s) => s.key)).toEqual(["them"]);
    expect(session.aggregateStatus()).toBe("live");
  });
});
