import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mic-device-selection cases (AC-J1.2/AC-J1.3/AC-J1.4), split out of
// practiceSession.test.js once that file crossed this project's 1000-line
// verification gate (BUG-J1). Same PracticeSession under test as that file;
// this is purely a file-size split, not a behavioural boundary — see that
// file's own note pointing back here.
//
// PracticeSession.start() normally opens a real WebSocket via a stream built
// through createSttStream — not available in this node test environment.
// vi.mock is hoisted PER FILE (Vitest re-runs the hoisting/interception
// against each test file's own module graph independently), so this suite
// needs its OWN vi.mock("./stt", ...) declaration even though
// practiceSession.test.js already has one — that duplication is expected,
// not an oversight. dgControl.hold isn't exercised by any case in this file
// (none of them need to hold the socket handshake open — they either fail
// during capture, before the socket is ever touched, or run the handshake to
// completion), but the factory still needs somewhere to route
// FakeDeepgramStream's onStatus calls so a session that DOES reach the
// socket (the "omitting micDeviceId" case) comes up "live" for real, exactly
// as it would against the real DeepgramStream.
const { dgConnectSpy, dgControl } = vi.hoisted(() => ({
  dgConnectSpy: vi.fn(),
  dgControl: { hold: null },
}));

vi.mock("./stt", () => {
  class FakeDeepgramStream {
    constructor(opts = {}) {
      this._onStatus = opts.onStatus || (() => {});
      this._onError = opts.onError || (() => {});
      this._onTranscript = opts.onTranscript || (() => {});
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
      this._onStatus("closed");
    }
  }
  return {
    DeepgramStream: FakeDeepgramStream,
    createSttStream: async (opts) => new FakeDeepgramStream(opts),
  };
});

// Imported after the mock above so practiceSession.js picks up the fake
// createSttStream.
import { PracticeSession } from "./practiceSession";

// Shared with practiceSession.test.js via practiceSessionTestDoubles.js, so
// both suites assert against the SAME notion of what a MediaStream/
// MediaStreamTrack/AudioContext looks like rather than risking two copies
// drifting apart — see that module's own header comment.
import {
  makeTrack,
  makeStream,
  audioContextControl,
  FakeAudioContext,
  FakeAudioWorkletNode,
  stubGetUserMedia,
} from "./practiceSessionTestDoubles.js";

const originalMediaDevices = globalThis.navigator?.mediaDevices;
const originalAudioContext = globalThis.AudioContext;
const originalAudioWorkletNode = globalThis.AudioWorkletNode;

beforeEach(() => {
  dgConnectSpy.mockClear();
  dgControl.hold = null;
  audioContextControl.holdAddModule = null;
  FakeAudioContext.instances = [];
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

// AC-J1.2/AC-J1.3/AC-J1.4: micDeviceId plumbing from PracticeSession's
// constructor option through to the real capture.js getUserMedia calls (only
// navigator.mediaDevices is stubbed here, exactly like the describe blocks
// above — capture.js itself runs for real, so these tests catch a regression
// in either file).
describe("PracticeSession micDeviceId plumbing", () => {
  it("forwards micDeviceId to captureCameraAndMic as deviceId: { exact: id }", async () => {
    const getUserMedia = stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [makeTrack()], videoTracks: [makeTrack()] })),
    );
    const session = new PracticeSession({ withVideo: true, micDeviceId: "mic-42" });

    await session.start();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const call = getUserMedia.mock.calls[0][0];
    expect(call.audio.deviceId).toEqual({ exact: "mic-42" });
  });

  it("forwards micDeviceId to the mic-only captureMicAudio fallback with the SAME id when the combined request fails", async () => {
    const getUserMedia = stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [makeTrack()] })),
    );
    getUserMedia.mockRejectedValueOnce(new Error("combined request denied"));
    const session = new PracticeSession({ withVideo: true, micDeviceId: "mic-42" });

    await session.start();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    const combinedCall = getUserMedia.mock.calls[0][0];
    const fallbackCall = getUserMedia.mock.calls[1][0];
    expect(combinedCall.audio.deviceId).toEqual({ exact: "mic-42" });
    // The fallback is mic-only (no video), but must carry the identical
    // device constraint — a different mic on the fallback would mean the
    // session silently ends up recording on hardware the user didn't pick.
    expect(fallbackCall.video).toBeUndefined();
    expect(fallbackCall.audio.deviceId).toEqual({ exact: "mic-42" });
  });

  it("omitting micDeviceId entirely reproduces previous behaviour: no deviceId key reaches getUserMedia, and the session starts live as before", async () => {
    const getUserMedia = stubGetUserMedia(() =>
      Promise.resolve(makeStream({ audioTracks: [makeTrack()], videoTracks: [makeTrack()] })),
    );
    const onStatus = vi.fn();
    // micDeviceId not passed at all — same as every PracticeSession
    // constructed by the pre-existing tests above this describe block.
    const session = new PracticeSession({ withVideo: true, onStatus });

    await session.start();

    const call = getUserMedia.mock.calls[0][0];
    // Whatever value reached capture.js (undefined, here) must be falsy and
    // must not surface as a deviceId own-key at all — see capture.test.js's
    // own pinning of this same rule.
    expect(Object.prototype.hasOwnProperty.call(call.audio, "deviceId")).toBe(false);
    expect(onStatus).toHaveBeenCalledWith("live");
  });
});

// AC-J1.4: micSelectionAwareError's rewrite, exercised through
// PracticeSession.start() rather than by importing the (unexported) function
// directly — its behaviour only matters as observed at the session's public
// boundary. Detection must be by `err.name`, per the comment in
// practiceSession.js above micSelectionAwareError, never by matching message
// text, which is not spec'd across browsers.
describe("PracticeSession OverconstrainedError wording", () => {
  function overconstrainedError() {
    // Deliberately gives this error a message that has NOTHING to do with
    // "unavailable" or "denied" wording, so a test asserting on the
    // rewritten message could only pass if the rewrite really keyed off
    // `.name` and not off message text.
    const err = new Error("Constraint could not be satisfied");
    err.name = "OverconstrainedError";
    return err;
  }

  it("rewrites the error to name the microphone as unavailable when a device id was selected and both the combined request and the fallback reject with OverconstrainedError", async () => {
    const getUserMedia = stubGetUserMedia(() => Promise.reject(overconstrainedError()));
    getUserMedia.mockRejectedValueOnce(overconstrainedError());
    const session = new PracticeSession({ withVideo: true, micDeviceId: "mic-42" });

    let caught = null;
    try {
      await session.start();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/unavailable|unplugged|disconnected/i);
    expect(caught.message).not.toMatch(/denied/i);
    // Must not be the raw browser message — that's the whole point of the
    // rewrite existing.
    expect(caught.message).not.toBe("Constraint could not be satisfied");
  });

  it("rewrites the error the same way in mic-only mode (withVideo: false) when a device id was selected", async () => {
    const getUserMedia = stubGetUserMedia(() => Promise.reject(overconstrainedError()));
    const session = new PracticeSession({ withVideo: false, micDeviceId: "mic-42" });

    let caught = null;
    try {
      await session.start();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/unavailable|unplugged|disconnected/i);
    expect(caught.message).not.toMatch(/denied/i);
  });

  it("does NOT rewrite an OverconstrainedError when no device id was selected — the original error object propagates untouched", async () => {
    // The COMBINED request's error is the one that ends up thrown (see
    // practiceSession.js: cameraFailure is captured from the first
    // rejection, and the fallback's own error is discarded once it also
    // fails) — so `original` must be queued for the FIRST call, and the
    // fallback gets an unrelated instance via the default implementation.
    const original = overconstrainedError();
    const getUserMedia = stubGetUserMedia(() => Promise.reject(overconstrainedError()));
    getUserMedia.mockRejectedValueOnce(original);
    // No micDeviceId at all: with no `deviceId: { exact }` constraint ever
    // sent, an OverconstrainedError must be attributed to some OTHER
    // constraint, not silently reported as a vanished chosen microphone.
    const session = new PracticeSession({ withVideo: true });

    let caught = null;
    try {
      await session.start();
    } catch (err) {
      caught = err;
    }

    // Object identity, not just message equality — proves the error was
    // passed through, not merely reworded back to the same text.
    expect(caught).toBe(original);
  });

  it("does not rewrite an OverconstrainedError in mic-only mode when no device id was selected", async () => {
    const original = overconstrainedError();
    const getUserMedia = stubGetUserMedia(() => Promise.reject(original));
    const session = new PracticeSession({ withVideo: false });

    let caught = null;
    try {
      await session.start();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(original);
  });

  it("a permission-denial error (NotAllowedError) propagates untouched when a device id WAS selected", async () => {
    const denied = new Error("Permission denied by user");
    denied.name = "NotAllowedError";
    const getUserMedia = stubGetUserMedia(() => Promise.reject(denied));
    getUserMedia.mockRejectedValueOnce(denied);
    const session = new PracticeSession({ withVideo: true, micDeviceId: "mic-42" });

    let caught = null;
    try {
      await session.start();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(denied);
  });

  it("a permission-denial error (NotAllowedError) propagates untouched when NO device id was selected", async () => {
    const denied = new Error("Permission denied by user");
    denied.name = "NotAllowedError";
    const getUserMedia = stubGetUserMedia(() => Promise.reject(denied));
    getUserMedia.mockRejectedValueOnce(denied);
    const session = new PracticeSession({ withVideo: true });

    let caught = null;
    try {
      await session.start();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(denied);
  });

  it("does not retry capture a third time with the device constraint dropped — exactly two getUserMedia calls, both still carrying the chosen device id", async () => {
    const getUserMedia = stubGetUserMedia(() => Promise.reject(overconstrainedError()));
    getUserMedia.mockRejectedValueOnce(overconstrainedError());
    const session = new PracticeSession({ withVideo: true, micDeviceId: "mic-42" });

    await expect(session.start()).rejects.toThrow();

    // Combined request + mic-only fallback, and nothing after that. A third
    // call (retrying with the deviceId constraint dropped) would silently
    // start recording on different hardware than the picker names — exactly
    // the failure `deviceId: { exact }` exists to prevent.
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({ exact: "mic-42" });
    expect(getUserMedia.mock.calls[1][0].audio.deviceId).toEqual({ exact: "mic-42" });
  });
});
