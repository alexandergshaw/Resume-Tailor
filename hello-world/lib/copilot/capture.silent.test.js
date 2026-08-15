import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMicAudio, PcmPipeline } from "./capture";

// AC-S4.1 (defect 5) and AC-S4.2 (defect 6) — see
// lib/copilot/stt/deepgram.silent.test.js's header comment for the shape of
// bug this style of test exists to catch: a live session that reaches
// "Live" and transcribes nothing, with no error shown anywhere. Both
// defects covered here sit on the CAPTURE side of that same bug: an
// AudioContext that never actually started running (so the worklet never
// fires and zero PCM bytes are ever produced), and a mic stream with no
// audio track at all (so there is nothing for the worklet to read even if
// it did run).

function makeTrack(kind) {
  return { kind, stop: vi.fn() };
}

function makeStream({ audioTracks = [] } = {}) {
  return {
    getAudioTracks: () => audioTracks,
    getTracks: () => [...audioTracks],
  };
}

const originalMediaDevices = globalThis.navigator?.mediaDevices;
const originalAudioContext = globalThis.AudioContext;
const originalAudioWorkletNode = globalThis.AudioWorkletNode;

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

// Node itself defines a read-only `navigator` global (no mediaDevices on
// it), so `globalThis.navigator = ...` throws — only the object's own
// properties can be reassigned, not the binding itself. Same helper as
// capture.test.js's own.
function ensureNavigator() {
  if (typeof globalThis.navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
  }
}

function stubGetUserMedia(impl) {
  ensureNavigator();
  globalThis.navigator.mediaDevices = { getUserMedia: vi.fn(impl) };
}

describe("captureMicAudio requires an audio track (AC-S4.2)", () => {
  it("stops every granted track and throws a message naming the microphone when no audio track came through", async () => {
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [] })));

    let caught = null;
    try {
      await captureMicAudio();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/microphone/i);
  });

  it("stops the (audio-track-less) granted tracks before throwing, like every sibling capture function", async () => {
    const deadTrack = makeTrack("audio-adjacent-but-not-audio");
    // getAudioTracks() reports none even though getTracks() has one — a
    // stream whose only track isn't classified as audio by the browser.
    const stream = {
      getAudioTracks: () => [],
      getTracks: () => [deadTrack],
    };
    stubGetUserMedia(() => Promise.resolve(stream));

    await expect(captureMicAudio()).rejects.toThrow(/microphone/i);
    expect(deadTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("still returns the stream unchanged when an audio track is present", async () => {
    const track = makeTrack("audio");
    const stream = makeStream({ audioTracks: [track] });
    stubGetUserMedia(() => Promise.resolve(stream));

    const result = await captureMicAudio();

    expect(result).toBe(stream);
    expect(track.stop).not.toHaveBeenCalled();
  });
});

// Fake AudioWorkletNode: the minimal surface PcmPipeline.start() touches
// (port.onmessage assignment, connect/disconnect) — same shape
// session.test.js and session.inperson.test.js already use for this.
class FakeAudioWorkletNode {
  constructor() {
    this.port = {};
    this.connect = vi.fn();
    this.disconnect = vi.fn();
  }
}

// Builds a fake AudioContext CLASS (not instance) so it can stand in for
// the global `AudioContext` constructor PcmPipeline.start() calls with
// `new`. `initialState` simulates a context created suspended — the state
// AC-S4.1 exists because of, most often reachable on mobile once sticky
// user-activation has run out by the time this constructor is reached.
// `resumeImpl`, when given, replaces the default "resume() flips state to
// running" behaviour, so a test can simulate resume() resolving without
// ever actually starting the context (AC-S4.1's negative case).
function makeFakeAudioContext({ initialState = "suspended", resumeImpl } = {}) {
  return class FakeAudioContext {
    constructor() {
      this.state = initialState;
      this.audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      this.destination = {};
      this.resume = vi.fn(
        resumeImpl ||
          (() => {
            this.state = "running";
            return Promise.resolve();
          }),
      );
      this.closed = false;
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
  };
}

describe("PcmPipeline resumes a suspended AudioContext before running (AC-S4.1)", () => {
  it("calls resume() on a context created suspended, and wires the graph once it reports running", async () => {
    globalThis.AudioContext = makeFakeAudioContext({ initialState: "suspended" });
    globalThis.AudioWorkletNode = FakeAudioWorkletNode;

    const pipeline = new PcmPipeline();
    const ctx = await pipeline.start({}, () => {});

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe("running");
    // Proves start() didn't bail out early — source, worklet, and the muted
    // gain node all got wired, exactly as it does for an already-running
    // context.
    expect(pipeline.nodes).toHaveLength(3);
  });

  it("does not call resume() when the context is already running", async () => {
    globalThis.AudioContext = makeFakeAudioContext({ initialState: "running" });
    globalThis.AudioWorkletNode = FakeAudioWorkletNode;

    const pipeline = new PcmPipeline();
    const ctx = await pipeline.start({}, () => {});

    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("reports a REPORTED failure — a rejected start() — when resume() cannot get the context running (AC-S4.5)", async () => {
    // resume() resolves (as it genuinely can even when it doesn't actually
    // get the context out of "suspended" — e.g. no user gesture available
    // to spend) without ever flipping `state`. Before AC-S4.1 nothing in
    // this file ever looked at `ctx.state` at all, so this exact case is
    // what let a live session reach "Live" and transcribe nothing.
    globalThis.AudioContext = makeFakeAudioContext({
      initialState: "suspended",
      resumeImpl: () => Promise.resolve(),
    });
    globalThis.AudioWorkletNode = FakeAudioWorkletNode;

    const pipeline = new PcmPipeline();

    await expect(pipeline.start({}, () => {})).rejects.toThrow(/suspended/i);
  });

  it("still leaves the failed context closeable via stop(), rather than leaking it", async () => {
    globalThis.AudioContext = makeFakeAudioContext({
      initialState: "suspended",
      resumeImpl: () => Promise.resolve(),
    });
    globalThis.AudioWorkletNode = FakeAudioWorkletNode;

    const pipeline = new PcmPipeline();
    await expect(pipeline.start({}, () => {})).rejects.toThrow();

    await pipeline.stop();

    expect(pipeline.ctx).toBeNull();
  });
});

// D2: PcmPipeline also backs captureTabAudio/captureSystemAudio via
// session.js's _addSource, not just the microphone — the failure message
// above used to hard-code "Microphone capture could not start", which
// misreports a failed tab or screen share as a mic problem. `sourceLabel`
// fixes that; these two cases pin both the default (no regression for
// practiceSession.js's own two-argument call, which is a real mic capture)
// and the override.
describe("PcmPipeline's failure message names the actual capture source (D2)", () => {
  it("defaults to naming the microphone when no label is given", async () => {
    globalThis.AudioContext = makeFakeAudioContext({
      initialState: "suspended",
      resumeImpl: () => Promise.resolve(),
    });
    globalThis.AudioWorkletNode = FakeAudioWorkletNode;

    const pipeline = new PcmPipeline();
    await expect(pipeline.start({}, () => {})).rejects.toThrow(/^Microphone capture could not start/);
  });

  it("names the actual source when a label is given, instead of the microphone default", async () => {
    globalThis.AudioContext = makeFakeAudioContext({
      initialState: "suspended",
      resumeImpl: () => Promise.resolve(),
    });
    globalThis.AudioWorkletNode = FakeAudioWorkletNode;

    const pipeline = new PcmPipeline();
    await expect(pipeline.start({}, () => {}, "Tab audio capture")).rejects.toThrow(
      /^Tab audio capture could not start/,
    );
  });
});
