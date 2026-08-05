import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureTabAudio,
  captureSystemAudio,
  captureMicAudio,
  captureCameraAndMic,
} from "./capture";

// Stand-ins for the bits of the MediaStreamTrack / MediaStream interfaces
// capture.js actually touches: getAudioTracks(), getVideoTracks(), getTracks(),
// stop(), and — for video tracks — getSettings(). displaySurface lets a test
// simulate the surface reported by a real getDisplayMedia() video track
// ("monitor" | "window" | "browser"); omit it to simulate a track that never
// had getSettings in the first place.
function makeTrack(kind, { displaySurface } = {}) {
  const track = { kind, stop: vi.fn() };
  if (kind === "video" && displaySurface !== undefined) {
    track.getSettings = () => ({ displaySurface });
  }
  return track;
}

function makeStream({ audioTracks = [], videoTracks = [] } = {}) {
  const tracks = [...videoTracks, ...audioTracks];
  return {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
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

function stubGetUserMedia(impl) {
  ensureNavigator();
  const getUserMedia = vi.fn(impl);
  globalThis.navigator.mediaDevices = { getUserMedia };
  return getUserMedia;
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

  it("throws the exact tab-audio message text (unchanged by the requireAudioTrack callback refactor)", async () => {
    stubGetDisplayMedia(() => Promise.resolve(makeStream({})));

    let caught = null;
    try {
      await captureTabAudio();
    } catch (err) {
      caught = err;
    }

    // Byte-identical to the message this module threw before
    // requireAudioTrack's second argument became a callback instead of a
    // plain string (see AC-3): captureTabAudio's callback just returns this
    // same literal, so the refactor cannot have altered it.
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe(
      'No tab audio was captured. In the share dialog, pick a browser tab (not a window or your whole screen) and turn on "Share tab audio".',
    );
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

  it("stops every granted track and throws the monitor-wording message when the video track has no getSettings method", async () => {
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

  it("stops every granted track and throws the monitor-wording message when displaySurface is \"monitor\"", async () => {
    const videoTrack = makeTrack("video", { displaySurface: "monitor" });
    const cursorTrack = makeTrack("video", { displaySurface: "monitor" });
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
    expect(caught.message).toBe(
      'No system audio was captured. In the share dialog, pick "Entire Screen" and turn on "Share system audio". Note: Chrome cannot capture system audio on macOS at all — on a Mac, sharing a browser tab is the only option.',
    );
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(cursorTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("reads displaySurface while the video track is still live, before any track is stopped", async () => {
    // If capture.js stopped tracks before reading getSettings() (the bug
    // AC-2 guards against), this track's stop() would already have been
    // called by the time getSettings() runs, and stopCallCountAtReadTime
    // would come back 1 instead of 0.
    const videoTrack = makeTrack("video", { displaySurface: "window" });
    const readSettings = videoTrack.getSettings;
    let stopCallCountAtReadTime = null;
    videoTrack.getSettings = () => {
      stopCallCountAtReadTime = videoTrack.stop.mock.calls.length;
      return readSettings();
    };
    stubGetDisplayMedia(() =>
      Promise.resolve(makeStream({ videoTracks: [videoTrack] })),
    );

    await expect(captureSystemAudio()).rejects.toThrow(/window/i);

    expect(stopCallCountAtReadTime).toBe(0);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("falls back to the monitor-wording message when getSettings throws", async () => {
    const videoTrack = makeTrack("video");
    videoTrack.getSettings = () => {
      throw new Error("getSettings unsupported in this state");
    };
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
    expect(caught.message).toBe(
      'No system audio was captured. In the share dialog, pick "Entire Screen" and turn on "Share system audio". Note: Chrome cannot capture system audio on macOS at all — on a Mac, sharing a browser tab is the only option.',
    );
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(cursorTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("falls back to the monitor-wording message when the stream has no video track at all", async () => {
    stubGetDisplayMedia(() => Promise.resolve(makeStream({})));

    let caught = null;
    try {
      await captureSystemAudio();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe(
      'No system audio was captured. In the share dialog, pick "Entire Screen" and turn on "Share system audio". Note: Chrome cannot capture system audio on macOS at all — on a Mac, sharing a browser tab is the only option.',
    );
  });

  it("falls back to the monitor-wording message when the stream doesn't implement getVideoTracks at all", async () => {
    // A minimal stream double (audio tracks + getTracks() only, no
    // getVideoTracks) is exactly what other tests in this codebase build for
    // paths that never needed to inspect video settings before. This proves
    // that shape still fails safely here instead of throwing a TypeError.
    const audioOnlyStream = {
      getAudioTracks: () => [],
      getTracks: () => [],
    };
    stubGetDisplayMedia(() => Promise.resolve(audioOnlyStream));

    let caught = null;
    try {
      await captureSystemAudio();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe(
      'No system audio was captured. In the share dialog, pick "Entire Screen" and turn on "Share system audio". Note: Chrome cannot capture system audio on macOS at all — on a Mac, sharing a browser tab is the only option.',
    );
  });

  it("stops every granted track and throws a window-specific message that does not mention the system-audio checkbox", async () => {
    const videoTrack = makeTrack("video", { displaySurface: "window" });
    const cursorTrack = makeTrack("video", { displaySurface: "window" });
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
    expect(caught.message).toBe(
      'No system audio was captured. You shared a window, and on Windows a window share carries no system audio at all — there is no checkbox to turn on for it. Pick "Entire Screen" instead.',
    );
    expect(caught.message).not.toMatch(/Share system audio/);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(cursorTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("stops every granted track and throws a browser-tab-specific message that points at the Browser tab option", async () => {
    const videoTrack = makeTrack("video", { displaySurface: "browser" });
    const cursorTrack = makeTrack("video", { displaySurface: "browser" });
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
    expect(caught.message).toBe(
      'No system audio was captured. You shared a browser tab. Use this app\'s "Browser tab" interviewer-audio option instead, or re-pick "Entire Screen" in the share dialog if you meant to share your screen.',
    );
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(cursorTrack.stop).toHaveBeenCalledTimes(1);
  });
});

describe("captureMicAudio", () => {
  it("requests exactly the processed mic constraints from getUserMedia, unchanged by the shared-constant extraction", async () => {
    const stream = makeStream({ audioTracks: [makeTrack("audio")] });
    const getUserMedia = stubGetUserMedia(() => Promise.resolve(stream));

    const result = await captureMicAudio();

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });
});

describe("captureCameraAndMic", () => {
  it("requests 720p-ideal front-facing video plus the processed mic constraints", async () => {
    const stream = makeStream({
      audioTracks: [makeTrack("audio")],
      videoTracks: [makeTrack("video")],
    });
    const getUserMedia = stubGetUserMedia(() => Promise.resolve(stream));

    const result = await captureCameraAndMic();

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it("stops every granted track and throws a microphone-specific message when no audio track came through", async () => {
    const videoTrack = makeTrack("video");
    const otherVideoTrack = makeTrack("video");
    stubGetUserMedia(() =>
      Promise.resolve(makeStream({ videoTracks: [videoTrack, otherVideoTrack] })),
    );

    let caught = null;
    try {
      await captureCameraAndMic();
    } catch (err) {
      caught = err;
    }

    // Exact match, not just a substring check: this must be the microphone
    // wording, not one of captureTabAudio's or captureSystemAudio's messages
    // (which talk about tabs, screens, and share-dialog checkboxes).
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe(
      "No microphone audio was captured. Practice needs your microphone to transcribe your answer.",
    );
    expect(caught.message).not.toMatch(/tab|screen|share dialog/i);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(otherVideoTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("propagates a getUserMedia rejection unchanged, as the same error instance", async () => {
    const permissionError = new Error("Permission denied");
    stubGetUserMedia(() => Promise.reject(permissionError));

    let caught = null;
    try {
      await captureCameraAndMic();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(permissionError);
  });
});
