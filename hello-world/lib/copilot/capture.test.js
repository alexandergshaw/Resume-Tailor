import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTabAudio, captureSystemAudio } from "./capture";

// Stand-ins for the bits of the MediaStreamTrack / MediaStream interfaces
// capture.js actually touches: getAudioTracks(), getTracks(), and stop().
function makeTrack(kind) {
  return { kind, stop: vi.fn() };
}

function makeStream({ audioTracks = [], videoTracks = [] } = {}) {
  const tracks = [...videoTracks, ...audioTracks];
  return {
    getAudioTracks: () => audioTracks,
    getTracks: () => tracks,
  };
}

// This module is only ever exercised in a browser, where
// navigator.mediaDevices already exists — the node test environment has no
// navigator at all, so each test below installs a fake and this restores
// whatever was there before, keeping tests from leaking into each other.
const originalMediaDevices = globalThis.navigator?.mediaDevices;

afterEach(() => {
  if (originalMediaDevices === undefined) {
    if (globalThis.navigator) delete globalThis.navigator.mediaDevices;
  } else {
    globalThis.navigator.mediaDevices = originalMediaDevices;
  }
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

function stubGetDisplayMedia(impl) {
  ensureNavigator();
  const getDisplayMedia = vi.fn(impl);
  globalThis.navigator.mediaDevices = { getDisplayMedia };
  return getDisplayMedia;
}

describe("captureTabAudio", () => {
  it("requests video plus unprocessed audio from the tab share dialog", async () => {
    const stream = makeStream({ audioTracks: [makeTrack("audio")] });
    const getDisplayMedia = stubGetDisplayMedia(() => Promise.resolve(stream));

    const result = await captureTabAudio();

    expect(result).toBe(stream);
    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  });

  it("stops every granted track and throws a tab-specific message when no audio track came through", async () => {
    const videoTrack = makeTrack("video");
    const cursorTrack = makeTrack("video"); // some captures hand back more than one video track
    stubGetDisplayMedia(() =>
      Promise.resolve(makeStream({ videoTracks: [videoTrack, cursorTrack] })),
    );

    await expect(captureTabAudio()).rejects.toThrow(
      /pick a browser tab.*Share tab audio/i,
    );
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(cursorTrack.stop).toHaveBeenCalledTimes(1);
  });
});

describe("captureSystemAudio", () => {
  it("requests the whole screen with system audio included", async () => {
    const stream = makeStream({ audioTracks: [makeTrack("audio")] });
    const getDisplayMedia = stubGetDisplayMedia(() => Promise.resolve(stream));

    const result = await captureSystemAudio();

    expect(result).toBe(stream);
    expect(getDisplayMedia).toHaveBeenCalledWith({
      video: { displaySurface: "monitor" },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: "include",
      monitorTypeSurfaces: "include",
    });
  });

  it("stops every granted track and throws a system-audio message that names the fix and macOS's limitation", async () => {
    const videoTrack = makeTrack("video");
    const cursorTrack = makeTrack("video");
    stubGetDisplayMedia(() =>
      Promise.resolve(makeStream({ videoTracks: [videoTrack, cursorTrack] })),
    );

    let caught = null;
    try {
      await captureSystemAudio();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/Entire Screen/);
    expect(caught.message).toMatch(/Share system audio/);
    expect(caught.message).toMatch(/macOS/);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(cursorTrack.stop).toHaveBeenCalledTimes(1);
  });
});
