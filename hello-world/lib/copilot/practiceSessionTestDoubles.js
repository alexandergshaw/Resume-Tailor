import { vi } from "vitest";

// Shared test doubles for PracticeSession's test suites
// (practiceSession.test.js and practiceSession.micDevice.test.js — the
// latter split out of the former once it crossed this project's 1000-line
// verification gate; see BUG-J1). Deliberately NOT a *.test.js/*.spec.js
// file, so vitest's default include pattern never picks it up as a suite of
// its own — it has no describe()/it() blocks to run.
//
// Extracted here (rather than left copy-pasted in both files) so the two
// suites assert against the SAME notion of what a MediaStream,
// MediaStreamTrack, and AudioContext look like. A copied fixture is exactly
// how two suites end up quietly diverging on that — one file's `makeTrack()`
// growing a capability the other's never gets, and nobody noticing because
// each suite only ever runs against its own copy.
//
// What stays OUT of this module: the vi.mock("./stt", ...) declaration and
// its vi.hoisted() spies. vi.mock is hoisted per FILE, not per module graph —
// each test file needs its own literal vi.mock("./stt", ...) call for
// Vitest's hoisting to intercept that file's own import of practiceSession.js
// correctly, so that declaration (and the beforeEach/afterEach resets tied to
// it) is duplicated in both files rather than centralized here. That
// duplication is expected, not an oversight.

// Stand-ins for the bits of the MediaStreamTrack / MediaStream interfaces
// PracticeSession's tests touch: an `enabled` flag setMicMuted()/
// setCameraOff() flip, a `stop()` they must never call (but start()/stop()
// must), and addEventListener() for the "ended" listeners start() attaches.
// Unlike a bare vi.fn(), this addEventListener remembers the registered
// callback so a test can fire it directly (fireEnded()) to simulate the
// camera/mic being lost mid-session.
export function makeTrack() {
  const track = { enabled: true, stop: vi.fn(), _listeners: {} };
  track.addEventListener = vi.fn((event, cb) => {
    track._listeners[event] = cb;
  });
  track.fireEnded = () => track._listeners.ended?.();
  return track;
}

export function makeStream({ audioTracks = [], videoTracks = [] } = {}) {
  return {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
  };
}

// audioContextControl.holdAddModule lets a test pause PcmPipeline.start() at
// its one await point (loading the AudioWorklet module) so a concurrent
// stop() can be proven to land while pipeline.start() is still in flight —
// mirrors each test file's own dgControl.hold, for the pipeline side instead
// of the socket. A single shared object (rather than a per-instance flag) so
// every FakeAudioContext a test creates reads the same in-flight state.
export const audioContextControl = { holdAddModule: null };

// capture.js's PcmPipeline is real code in these suites (only
// navigator.mediaDevices is stubbed), so it drives a real AudioContext/
// AudioWorkletNode — browser globals that don't exist in node. Stand in with
// the minimal surface PcmPipeline.start()/stop() actually touches.
// closeSpy is on the instance (not the class) because a fresh AudioContext is
// constructed on every PcmPipeline.start(), and the stop()-teardown tests
// need to assert against the one instance a given session actually created —
// FakeAudioContext.instances (reset each test by the caller, per test file)
// makes that instance reachable from the test body.
export class FakeAudioContext {
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

export class FakeAudioWorkletNode {
  constructor() {
    this.port = {};
    this.connect = vi.fn();
    this.disconnect = vi.fn();
  }
}

// Node itself defines a read-only `navigator` global (no mediaDevices on it),
// so `globalThis.navigator = ...` throws — only the object's own properties
// can be reassigned, not the binding itself. Fall back to defining it only
// when it's genuinely missing.
export function ensureNavigator() {
  if (typeof globalThis.navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
  }
}

export function stubGetUserMedia(impl) {
  ensureNavigator();
  const getUserMedia = vi.fn(impl);
  globalThis.navigator.mediaDevices = { getUserMedia };
  return getUserMedia;
}
