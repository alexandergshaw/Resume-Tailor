import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PracticeSession.start() normally opens a real WebSocket via a stream built
// through createSttStream — not available in this node test environment.
// The spies are hoisted (not just captured by the mock factory) so tests can
// assert a Deepgram stream was never even built, not just never connected.
// dgControl.shouldThrowOnClose lets the stop()-teardown tests below force
// close() to throw synchronously, the way a real WebSocket close can,
// without touching practiceSession.js. dgControl.hold lets a single test
// pause connect() before it resolves, so an ordering claim ("X happens
// before dg.connect() resolves") can be proven directly instead of inferred
// from call counts — every other test leaves it null, which keeps connect()
// resolving immediately exactly as before. FakeDeepgramStream.instances
// (reset each test, see beforeEach below) exposes the
// onStatus/onError/onTranscript callbacks PracticeSession registered, so the
// socket-event tests further down can invoke them directly — simulating a
// status change, an error, or a transcript arriving from the socket, without
// faking WebSocket event machinery.
const { dgConstructorSpy, dgConnectSpy, dgCloseSpy, dgControl } = vi.hoisted(() => ({
  dgConstructorSpy: vi.fn(),
  dgConnectSpy: vi.fn(),
  dgCloseSpy: vi.fn(),
  dgControl: { shouldThrowOnClose: false, hold: null },
}));

vi.mock("./stt", () => {
  class FakeDeepgramStream {
    constructor(opts = {}) {
      dgConstructorSpy(opts);
      this._onStatus = opts.onStatus || (() => {});
      this._onError = opts.onError || (() => {});
      this._onTranscript = opts.onTranscript || (() => {});
      FakeDeepgramStream.instances.push(this);
    }
    async connect() {
      dgConnectSpy();
      // Mirrors the real DeepgramStream: "connecting" fires as soon as the
      // socket is opened, "open" only once it actually connects.
      this._onStatus("connecting");
      if (dgControl.hold) await dgControl.hold;
      this._onStatus("open");
    }
    send() {
      // no-op — nothing downstream inspects the PCM bytes in these tests
    }
    close() {
      dgCloseSpy();
      if (dgControl.shouldThrowOnClose) {
        throw new Error("dg close failed");
      }
      this._onStatus("closed");
    }
  }
  FakeDeepgramStream.instances = [];
  return {
    DeepgramStream: FakeDeepgramStream,
    createSttStream: async (opts) => new FakeDeepgramStream(opts),
  };
});

// Imported after the mock above so practiceSession.js picks up the fake
// createSttStream. DeepgramStream is imported directly too, purely so tests
// below can reach FakeDeepgramStream.instances — practiceSession.js itself
// no longer imports it.
import { PracticeSession } from "./practiceSession";
import { DeepgramStream } from "./stt";

// Stand-ins for the bits of the MediaStreamTrack / MediaStream interfaces
// this file's tests touch: an `enabled` flag setMicMuted()/setCameraOff()
// flip, a `stop()` they must never call (but start()/stop() must), and
// addEventListener() for the "ended" listeners start() attaches. Unlike a
// bare vi.fn(), this addEventListener remembers the registered callback so a
// test can fire it directly (fireEnded()) to simulate the camera/mic being
// lost mid-session.
function makeTrack() {
  const track = { enabled: true, stop: vi.fn(), _listeners: {} };
  track.addEventListener = vi.fn((event, cb) => {
    track._listeners[event] = cb;
  });
  track.fireEnded = () => track._listeners.ended?.();
  return track;
}

function makeStream({ audioTracks = [], videoTracks = [] } = {}) {
  return {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
  };
}

// These tests exercise setMicMuted()/setCameraOff() directly against
// session.stream, without going through start() — start() drives real
// capture/Deepgram wiring that belongs to other tests, and neither method
// touches anything but session.stream.
describe("PracticeSession.setMicMuted", () => {
  it("disables the audio track when muted", () => {
    const audioTrack = makeTrack();
    const session = new PracticeSession();
    session.stream = makeStream({ audioTracks: [audioTrack] });

    session.setMicMuted(true);

    expect(audioTrack.enabled).toBe(false);
  });

  it("re-enables the audio track when unmuted", () => {
    const audioTrack = makeTrack();
    audioTrack.enabled = false;
    const session = new PracticeSession();
    session.stream = makeStream({ audioTracks: [audioTrack] });

    session.setMicMuted(false);

    expect(audioTrack.enabled).toBe(true);
  });

  it("never stops the audio track — muting must not end the capture", () => {
    const audioTrack = makeTrack();
    const session = new PracticeSession();
    session.stream = makeStream({ audioTracks: [audioTrack] });

    session.setMicMuted(true);

    expect(audioTrack.stop).not.toHaveBeenCalled();
  });

  it("is a no-op when the stream has no audio track", () => {
    const session = new PracticeSession();
    session.stream = makeStream({ audioTracks: [] });

    expect(() => session.setMicMuted(true)).not.toThrow();
  });

  it("is a no-op when the session has no stream at all", () => {
    const session = new PracticeSession();

    expect(session.stream).toBe(null);
    expect(() => session.setMicMuted(true)).not.toThrow();
    expect(session.stream).toBe(null);
  });

  it("does not disturb an unrelated video track", () => {
    const audioTrack = makeTrack();
    const videoTrack = makeTrack();
    const session = new PracticeSession();
    session.stream = makeStream({ audioTracks: [audioTrack], videoTracks: [videoTrack] });

    session.setMicMuted(true);

    expect(audioTrack.enabled).toBe(false);
    expect(videoTrack.enabled).toBe(true);
  });
});

describe("PracticeSession.setCameraOff", () => {
  it("disables the video track when turned off", () => {
    const videoTrack = makeTrack();
    const session = new PracticeSession();
    session.stream = makeStream({ videoTracks: [videoTrack] });

    session.setCameraOff(true);

    expect(videoTrack.enabled).toBe(false);
  });

  it("re-enables the video track when turned back on", () => {
    const videoTrack = makeTrack();
    videoTrack.enabled = false;
    const session = new PracticeSession();
    session.stream = makeStream({ videoTracks: [videoTrack] });

    session.setCameraOff(false);

    expect(videoTrack.enabled).toBe(true);
  });

  it("never stops the video track — turning the camera off must not end the capture", () => {
    const videoTrack = makeTrack();
    const session = new PracticeSession();
    session.stream = makeStream({ videoTracks: [videoTrack] });

    session.setCameraOff(true);

    expect(videoTrack.stop).not.toHaveBeenCalled();
  });

  it("is a no-op when the stream has no video track", () => {
    const session = new PracticeSession();
    session.stream = makeStream({ videoTracks: [] });

    expect(() => session.setCameraOff(true)).not.toThrow();
  });

  it("is a no-op when the session has no stream at all", () => {
    const session = new PracticeSession();

    expect(session.stream).toBe(null);
    expect(() => session.setCameraOff(true)).not.toThrow();
    expect(session.stream).toBe(null);
  });

  it("does not disturb an unrelated audio track", () => {
    const audioTrack = makeTrack();
    const videoTrack = makeTrack();
    const session = new PracticeSession();
    session.stream = makeStream({ audioTracks: [audioTrack], videoTracks: [videoTrack] });

    session.setCameraOff(true);

    expect(videoTrack.enabled).toBe(false);
    expect(audioTrack.enabled).toBe(true);
  });
});

// capture.js's PcmPipeline is real code in the tests below (only
// navigator.mediaDevices is stubbed), so it drives a real AudioContext/
// AudioWorkletNode — browser globals that don't exist in node. Stand in with
// the minimal surface PcmPipeline.start()/stop() actually touches.
// closeSpy is on the instance (not the class) because a fresh AudioContext is
// constructed on every PcmPipeline.start(), and the stop()-teardown tests
// below need to assert against the one instance a given session actually
// created — FakeAudioContext.instances (reset each test) makes that instance
// reachable from the test body.
class FakeAudioContext {
  constructor() {
    this.audioWorklet = {
      addModule: vi.fn(async () => {
        if (audioContextControl.holdAddModule) await audioContextControl.holdAddModule;
      }),
    };
    this.destination = {};
    this.closeSpy = vi.fn().mockResolvedValue(undefined);
    FakeAudioContext.instances.push(this);
  }
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createGain() {
    return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  close() {
    return this.closeSpy();
  }
}
FakeAudioContext.instances = [];
// audioContextControl.holdAddModule lets a test pause PcmPipeline.start() at
// its one await point (loading the AudioWorklet module) so a concurrent
// stop() can be proven to land while pipeline.start() is still in flight —
// mirrors dgControl.hold above, for the pipeline side instead of the socket.
const audioContextControl = { holdAddModule: null };
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
  dgConstructorSpy.mockClear();
  dgConnectSpy.mockClear();
  dgCloseSpy.mockClear();
  dgControl.shouldThrowOnClose = false;
  dgControl.hold = null;
  audioContextControl.holdAddModule = null;
  FakeAudioContext.instances = [];
  DeepgramStream.instances = [];
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

function stubGetUserMedia(impl) {
  ensureNavigator();
  const getUserMedia = vi.fn(impl);
  globalThis.navigator.mediaDevices = { getUserMedia };
  return getUserMedia;
}

describe("PracticeSession capture source", () => {
  it("withVideo true captures camera+mic (both video and audio requested)", async () => {
    const getUserMedia = stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [makeTrack()], videoTracks: [makeTrack()] })),
    );
    const onStream = vi.fn();
    const session = new PracticeSession({ withVideo: true, onStream });

    await session.start();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const call = getUserMedia.mock.calls[0][0];
    expect(call.video).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    });
    expect(call.audio).toBeTruthy();
    expect(session.hasVideo).toBe(true);
    expect(onStream).toHaveBeenCalledWith(session.stream, true);
  });

  it("withVideo false captures mic-only and never requests video", async () => {
    const getUserMedia = stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [makeTrack()] })),
    );
    const onStream = vi.fn();
    const session = new PracticeSession({ withVideo: false, onStream });

    await session.start();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const call = getUserMedia.mock.calls[0][0];
    expect(call.video).toBeUndefined();
    expect(call.audio).toBeTruthy();
    expect(session.hasVideo).toBe(false);
    expect(onStream).toHaveBeenCalledWith(session.stream, false);
  });
});

describe("PracticeSession camera fallback", () => {
  it("falls back to mic-only when camera+mic rejects: warns once and still comes up live", async () => {
    const getUserMedia = stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [makeTrack()] })),
    );
    getUserMedia.mockRejectedValueOnce(
      new Error("NotAllowedError: permission dismissed by user"),
    );
    const onError = vi.fn();
    const onStream = vi.fn();
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: true, onError, onStream, onStatus });

    await session.start();

    // Fell back to a second, mic-only request after the combined one failed.
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    const fallbackCall = getUserMedia.mock.calls[1][0];
    expect(fallbackCall.video).toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    const message = onError.mock.calls[0][0].message;
    expect(message).toMatch(/Camera unavailable/);
    expect(message).toMatch(/permission dismissed by user/);

    // The session still comes up: the mic stream was published and the
    // Deepgram socket got connected.
    expect(onStream).toHaveBeenCalledWith(session.stream, false);
    expect(dgConnectSpy).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith("live");
  });

  it("rejects with the original combined-request error when the mic-only fallback also fails, blaming no camera", async () => {
    const combinedError = new Error("combined request denied");
    const fallbackError = new Error("mic fallback also denied");
    const getUserMedia = stubGetUserMedia(() => Promise.reject(fallbackError));
    getUserMedia.mockRejectedValueOnce(combinedError);
    const onError = vi.fn();
    const session = new PracticeSession({ withVideo: true, onError });

    await expect(session.start()).rejects.toBe(combinedError);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
    expect(dgConstructorSpy).not.toHaveBeenCalled();
  });
});

describe("PracticeSession stop() racing capture", () => {
  it("stops every granted track and never builds a Deepgram stream when stop() lands before capture resolves", async () => {
    let resolveGetUserMedia;
    const pending = new Promise((resolve) => {
      resolveGetUserMedia = resolve;
    });
    stubGetUserMedia(() => pending);
    const onStream = vi.fn();
    const session = new PracticeSession({ withVideo: false, onStream });

    const startPromise = session.start();
    // stop() arrives while getUserMedia's prompt is still up, before the
    // capture promise has settled either way.
    await session.stop();

    const audioTrack = makeTrack();
    const stream = makeStream({ audioTracks: [audioTrack] });
    resolveGetUserMedia(stream);
    await startPromise;

    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(dgConstructorSpy).not.toHaveBeenCalled();
    expect(dgConnectSpy).not.toHaveBeenCalled();
    expect(onStream).not.toHaveBeenCalled();
  });
});

describe("PracticeSession.stop() full teardown", () => {
  it("closes the Deepgram stream, stops the pipeline, stops both audio and video tracks, clears stream/hasVideo, and reports idle", async () => {
    const audioTrack = makeTrack();
    const videoTrack = makeTrack();
    stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [audioTrack], videoTracks: [videoTrack] })),
    );
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: true, onStatus });

    await session.start();
    const ctx = FakeAudioContext.instances[0];

    await session.stop();

    expect(dgCloseSpy).toHaveBeenCalledTimes(1);
    expect(ctx.closeSpy).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(session.stream).toBeNull();
    expect(session.hasVideo).toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith("idle");
  });

  it("a dg.close() that throws does not prevent the pipeline stop or either track stop, and idle is still reported", async () => {
    const audioTrack = makeTrack();
    const videoTrack = makeTrack();
    stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [audioTrack], videoTracks: [videoTrack] })),
    );
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: true, onStatus });

    await session.start();
    const ctx = FakeAudioContext.instances[0];
    dgControl.shouldThrowOnClose = true;

    // Each teardown step in stop() is independently try/caught, so a
    // synchronous throw from dg.close() must not stop stop() from also
    // tearing down the pipeline and the tracks, and must not reject.
    await expect(session.stop()).resolves.toBeUndefined();

    expect(dgCloseSpy).toHaveBeenCalledTimes(1);
    expect(ctx.closeSpy).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(session.stream).toBeNull();
    expect(session.hasVideo).toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith("idle");
  });

  it("is safe to call before start() has ever run", async () => {
    const onStatus = vi.fn();
    const session = new PracticeSession({ onStatus });

    await expect(session.stop()).resolves.toBeUndefined();

    expect(session.stream).toBeNull();
    expect(session.hasVideo).toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith("idle");
    expect(dgConstructorSpy).not.toHaveBeenCalled();
    expect(dgCloseSpy).not.toHaveBeenCalled();
  });

  it("is safe to call twice: the second call reports idle again without re-closing the socket or re-stopping the pipeline or tracks", async () => {
    const audioTrack = makeTrack();
    const videoTrack = makeTrack();
    stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [audioTrack], videoTracks: [videoTrack] })),
    );
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: true, onStatus });

    await session.start();
    const ctx = FakeAudioContext.instances[0];

    await session.stop();
    await expect(session.stop()).resolves.toBeUndefined();

    expect(dgCloseSpy).toHaveBeenCalledTimes(1);
    expect(ctx.closeSpy).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(session.stream).toBeNull();
    expect(session.hasVideo).toBe(false);
    expect(onStatus.mock.calls.filter((call) => call[0] === "idle")).toHaveLength(2);
  });
});

describe("PracticeSession.start onStream ordering", () => {
  it("publishes the stream via onStream immediately after capture, strictly before dg.connect() resolves", async () => {
    // Hold connect() open so the checkpoint below runs while it is
    // provably still pending, rather than relying on timing.
    let releaseConnect;
    dgControl.hold = new Promise((resolve) => {
      releaseConnect = resolve;
    });
    const stream = makeStream({ audioTracks: [makeTrack()], videoTracks: [makeTrack()] });
    stubGetUserMedia(() => Promise.resolve(stream));
    const onStream = vi.fn();
    const onStatus = vi.fn();
    const session = new PracticeSession({ onStream, onStatus });

    const startPromise = session.start();
    await vi.waitFor(() => expect(dgConnectSpy).toHaveBeenCalledTimes(1));

    // connect() has been invoked (it's what set dgConnectSpy above) but its
    // promise is deliberately still unresolved here — proving onStream
    // already fired before that resolution, not merely at some point before
    // start() as a whole finishes.
    expect(onStream).toHaveBeenCalledTimes(1);
    expect(onStream).toHaveBeenCalledWith(stream, true);
    expect(onStatus).not.toHaveBeenCalledWith("live");

    releaseConnect();
    await startPromise;

    // Only after connect() actually resolved does "live" show up, confirming
    // the earlier snapshot really did precede it.
    expect(onStatus).toHaveBeenCalledWith("live");
  });
});

describe("PracticeSession hasVideo detection", () => {
  it("computes hasVideo from the actual stream tracks, not the withVideo request: false when the granted stream carries no video track", async () => {
    // withVideo is true (video was requested) but the stream getUserMedia
    // hands back only has an audio track — hasVideo must reflect what was
    // actually captured, not merely echo the request that was made.
    const stream = makeStream({ audioTracks: [makeTrack()] });
    stubGetUserMedia(() => Promise.resolve(stream));
    const onStream = vi.fn();
    const session = new PracticeSession({ withVideo: true, onStream });

    await session.start();

    expect(session.hasVideo).toBe(false);
    expect(onStream).toHaveBeenCalledWith(stream, false);
  });
});

describe("PracticeSession track-ended handling", () => {
  it("tears the whole session down when the audio track ends: dg closes, every track stops, and status goes idle", async () => {
    const audioTrack = makeTrack();
    const videoTrack = makeTrack();
    const stream = makeStream({ audioTracks: [audioTrack], videoTracks: [videoTrack] });
    stubGetUserMedia(() => Promise.resolve(stream));
    const onStatus = vi.fn();
    const session = new PracticeSession({ onStatus });

    await session.start();
    onStatus.mockClear();

    audioTrack.fireEnded();
    // The listener calls this.stop(), which is async (it awaits the
    // pipeline's teardown) — wait for the terminal "idle" status rather than
    // asserting immediately after the synchronous event fires.
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith("idle"));

    expect(dgCloseSpy).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(session.stream).toBeNull();
  });

  it("on video track ended: hasVideo flips false and onStream re-publishes, but the session and Deepgram stream stay open", async () => {
    const audioTrack = makeTrack();
    const videoTrack = makeTrack();
    const stream = makeStream({ audioTracks: [audioTrack], videoTracks: [videoTrack] });
    stubGetUserMedia(() => Promise.resolve(stream));
    const onStream = vi.fn();
    const onStatus = vi.fn();
    const session = new PracticeSession({ onStream, onStatus });

    await session.start();
    onStream.mockClear();
    onStatus.mockClear();

    videoTrack.fireEnded();

    expect(session.hasVideo).toBe(false);
    expect(onStream).toHaveBeenCalledTimes(1);
    expect(onStream).toHaveBeenCalledWith(stream, false);

    // Give any (incorrect) async teardown a real bug would trigger a chance
    // to run before asserting that none happened.
    await Promise.resolve();
    await Promise.resolve();

    expect(onStatus).not.toHaveBeenCalledWith("idle");
    expect(dgCloseSpy).not.toHaveBeenCalled();
    expect(audioTrack.stop).not.toHaveBeenCalled();
    expect(videoTrack.stop).not.toHaveBeenCalled();
    expect(session.stream).toBe(stream);
  });
});

// start() wires DeepgramStream's own onStatus/onError/onTranscript callbacks
// to translate its vocabulary for the UI, react to an unsolicited close, and
// go silent after stop(). DeepgramStream.instances[0] (see the mock above)
// exposes the exact closures PracticeSession registered, so these tests
// invoke them directly to simulate socket events landing at each point in the
// session's lifecycle.
describe("PracticeSession DeepgramStream status/error handling", () => {
  it('maps "connecting" to onStatus("connecting") and "open" to onStatus("live")', async () => {
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [makeTrack()] })));
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: false, onStatus });

    await session.start();

    expect(onStatus.mock.calls.map((call) => call[0])).toEqual(["connecting", "live"]);
  });

  it("tears the whole session down on an unsolicited socket close: tracks stop and status goes idle, not a cosmetic relabel", async () => {
    const audioTrack = makeTrack();
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [audioTrack] })));
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: false, onStatus });

    await session.start();
    const ctx = FakeAudioContext.instances[0];
    const dg = DeepgramStream.instances[0];
    onStatus.mockClear();

    // The socket reporting "closed" on its own (network drop, idle timeout,
    // sleep/resume) is not the same as our own stop() having closed it —
    // PracticeSession must react by tearing the whole session down for real.
    dg._onStatus("closed");
    // stop() triggered from here is async (it awaits the pipeline teardown);
    // wait for the terminal status instead of asserting immediately.
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith("idle"));

    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(ctx.closeSpy).toHaveBeenCalledTimes(1);
    expect(session.stream).toBeNull();
    expect(onStatus.mock.calls.map((call) => call[0])).toEqual(["idle"]);
  });

  it("swallows a late status callback that arrives after stop(): no further onStatus call and no second teardown", async () => {
    const audioTrack = makeTrack();
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [audioTrack] })));
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: false, onStatus });

    await session.start();
    const dg = DeepgramStream.instances[0];
    await session.stop();
    onStatus.mockClear();
    dgCloseSpy.mockClear();

    // A status the real socket queued before we closed it can still arrive
    // after stop() has already resolved — it must be a no-op.
    dg._onStatus("open");

    expect(onStatus).not.toHaveBeenCalled();
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(dgCloseSpy).not.toHaveBeenCalled();
  });

  it("swallows a late error callback that arrives after stop(): no onError and no onStatus('error')", async () => {
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [makeTrack()] })));
    const onError = vi.fn();
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: false, onError, onStatus });

    await session.start();
    const dg = DeepgramStream.instances[0];
    await session.stop();
    onStatus.mockClear();

    dg._onError(new Error("late socket error"));

    expect(onError).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("swallows a late transcript callback that arrives after stop()", async () => {
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [makeTrack()] })));
    const onTranscript = vi.fn();
    const session = new PracticeSession({ withVideo: false, onTranscript });

    await session.start();
    const dg = DeepgramStream.instances[0];
    await session.stop();

    dg._onTranscript({ speaker: "you", transcript: "late words", isFinal: true, speechFinal: true });

    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("forwards a socket error to onError and reports onStatus('error') without tearing the session down", async () => {
    const audioTrack = makeTrack();
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [audioTrack] })));
    const onError = vi.fn();
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: false, onError, onStatus });

    await session.start();
    const dg = DeepgramStream.instances[0];
    onStatus.mockClear();
    const socketError = new Error("Could not connect to Deepgram.");

    dg._onError(socketError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe(socketError);
    expect(onStatus.mock.calls.map((call) => call[0])).toEqual(["error"]);
    // An error alone is not a teardown — capture keeps running.
    expect(audioTrack.stop).not.toHaveBeenCalled();
    expect(session.stream).not.toBeNull();
  });
});

// start() assigns _dg/_pipeline to the instance BEFORE awaiting their
// connect()/start() calls specifically so a concurrent stop() finds a real
// object to tear down instead of nothing (see the comments in
// practiceSession.js above those assignments). These tests drive that race
// for real, using dgControl.hold / audioContextControl.holdAddModule to pin
// each handshake open until stop() has already landed and settled.
describe("PracticeSession stop() racing the socket/pipeline handshake", () => {
  it("stop() while dg.connect() is in flight: dg is closed, every track stops, status settles on idle, and the connect() that resolves afterward never repaints it live", async () => {
    let releaseConnect;
    dgControl.hold = new Promise((resolve) => {
      releaseConnect = resolve;
    });
    const audioTrack = makeTrack();
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [audioTrack] })));
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: false, onStatus });

    const startPromise = session.start();
    await vi.waitFor(() => expect(dgConnectSpy).toHaveBeenCalledTimes(1));

    // stop() lands here: connect() has been called but is provably still
    // pending (dgControl.hold is not yet released), so the pipeline has not
    // even been created — there is nothing on the pipeline side to tear down.
    await session.stop();

    expect(dgCloseSpy).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith("idle");

    // Now let the deferred connect() actually resolve to "open" — start()'s
    // own onStatus handler must swallow it (this._stopped is already true)
    // instead of repainting the now-idle UI as live.
    releaseConnect();
    await startPromise;

    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(dgCloseSpy).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith("idle");
    expect(onStatus).not.toHaveBeenCalledWith("live");
  });

  it("stop() while pipeline.start() is in flight: dg is closed, the pipeline is stopped, every track stops, and status settles on idle", async () => {
    let releaseAddModule;
    audioContextControl.holdAddModule = new Promise((resolve) => {
      releaseAddModule = resolve;
    });
    const audioTrack = makeTrack();
    stubGetUserMedia(() => Promise.resolve(makeStream({ audioTracks: [audioTrack] })));
    const onStatus = vi.fn();
    const session = new PracticeSession({ withVideo: false, onStatus });

    const startPromise = session.start();
    // dg.connect() resolves immediately by default (dgControl.hold is null in
    // this test), so by the time an AudioContext exists, the socket is
    // already open and pipeline.start() is the thing still in flight.
    await vi.waitFor(() => expect(FakeAudioContext.instances).toHaveLength(1));
    const ctx = FakeAudioContext.instances[0];

    // stop() lands here, mid pipeline.start(): the worklet module load is
    // provably still pending (audioContextControl.holdAddModule unreleased).
    await session.stop();

    expect(dgCloseSpy).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith("idle");

    // "live" was legitimately reported earlier in this test: unlike the
    // sibling test above (where dgControl.hold keeps the socket from ever
    // opening), this test lets dg.connect() resolve immediately, so the
    // socket was genuinely open before the pipeline even existed — the user
    // really did see a live session before pressing Stop. What matters from
    // here on is only what arrives AFTER teardown, so clear the spy and
    // watch for a late repaint instead of asserting "live" was never seen.
    onStatus.mockClear();

    // Let pipeline.start() finish its own await after teardown already ran.
    releaseAddModule();
    await startPromise;

    // Proves PcmPipeline closes a context whose worklet load was interrupted
    // by a concurrent stop(), instead of leaking an AudioContext that
    // nothing can ever close.
    expect(ctx.closeSpy).toHaveBeenCalledTimes(1);
    expect(dgCloseSpy).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenLastCalledWith("idle");
    expect(onStatus).not.toHaveBeenCalledWith("live");
  });
});
