import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toGray,
  frameLuma,
  frameDiff,
  summarizeVideoStats,
  MIN_LUMA_SAMPLES,
  MIN_MOTION_SAMPLES,
  VideoFrameSampler,
} from "./videoStats";

describe("toGray", () => {
  it("reduces a 2x1 RGBA buffer to Rec.601 luma bytes, reading every 4th byte as the stride", () => {
    // Pixel 0: pure red (255,0,0) -> 255*0.299 = 76.245 -> 76
    // Pixel 1: pure green (0,255,0) -> 255*0.587 = 149.685 -> 149
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const gray = toGray(rgba, 2, 1);
    expect(Array.from(gray)).toEqual([76, 149]);
  });

  it("blends all three channels with the Rec.601 weights on a mixed pixel", () => {
    // (10*0.299 + 20*0.587 + 30*0.114) = 2.99 + 11.74 + 3.42 = 18.15 -> 18
    const rgba = new Uint8ClampedArray([10, 20, 30, 255]);
    const gray = toGray(rgba, 1, 1);
    expect(Array.from(gray)).toEqual([18]);
  });

  it("returns an output whose length equals width*height, not the byte length of the input", () => {
    const rgba = new Uint8ClampedArray(3 * 2 * 4).fill(100);
    const gray = toGray(rgba, 3, 2);
    expect(gray.length).toBe(6);
  });

  it("clamps to the pixels actually available when the buffer is shorter than width*height*4, instead of emitting black-padded pixels", () => {
    // width*height asks for 4 pixels (16 bytes) but only 2 full pixels (8 bytes) exist.
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255, // white
      0, 0, 0, 255, // black
    ]);
    const gray = toGray(rgba, 2, 2);
    // Only the 2 real pixels come back -- no third/fourth black-padded entry.
    expect(gray.length).toBe(2);
    expect(Array.from(gray)).toEqual([255, 0]);
  });

  it("returns an empty array without throwing when the input is missing", () => {
    const gray = toGray(undefined, 4, 4);
    expect(gray.length).toBe(0);
    expect(Array.from(gray)).toEqual([]);
  });
});

describe("frameLuma", () => {
  it("computes the mean and population variance of a hand-computed sample", () => {
    // values: 10, 20, 30 -> mean 20
    // variance = ((10-20)^2 + (20-20)^2 + (30-20)^2) / 3 = (100+0+100)/3 = 66.666...
    const gray = new Uint8Array([10, 20, 30]);
    const { mean, variance } = frameLuma(gray);
    expect(mean).toBe(20);
    expect(variance).toBeCloseTo(66.6667, 3);
    // Guard against the variance/standard-deviation mixup: sqrt(variance) is
    // the standard deviation (~8.165), which must NOT be what's returned.
    expect(variance).not.toBeCloseTo(Math.sqrt(66.6667), 1);
  });

  it("returns variance 0 for a perfectly flat frame regardless of brightness", () => {
    const gray = new Uint8Array([200, 200, 200, 200]);
    const { mean, variance } = frameLuma(gray);
    expect(mean).toBe(200);
    expect(variance).toBe(0);
  });

  it("returns zeros, not NaN, for empty input", () => {
    const result = frameLuma(new Uint8Array(0));
    expect(result).toEqual({ mean: 0, variance: 0 });
    expect(Number.isNaN(result.mean)).toBe(false);
    expect(Number.isNaN(result.variance)).toBe(false);
  });

  it("returns zeros, not NaN, when the input is missing", () => {
    const result = frameLuma(undefined);
    expect(result).toEqual({ mean: 0, variance: 0 });
  });
});

describe("frameDiff", () => {
  it("computes the mean absolute per-pixel difference between two frames", () => {
    const prev = new Uint8Array([10, 20, 30, 40]);
    const cur = new Uint8Array([15, 10, 30, 60]);
    // |15-10| + |10-20| + |30-30| + |60-40| = 5 + 10 + 0 + 20 = 35 -> /4 = 8.75
    expect(frameDiff(prev, cur)).toBe(8.75);
  });

  it("is a genuine absolute difference, not a signed one that could cancel out", () => {
    // Signed diffs here would average to 0 ((-10 + 10) / 2); absolute must not.
    const prev = new Uint8Array([50, 50]);
    const cur = new Uint8Array([40, 60]);
    expect(frameDiff(prev, cur)).toBe(10);
  });

  it("returns 0 for two frames of mismatched length", () => {
    const prev = new Uint8Array([10, 20, 30]);
    const cur = new Uint8Array([10, 20]);
    expect(frameDiff(prev, cur)).toBe(0);
  });

  it("returns 0 for two empty frames", () => {
    expect(frameDiff(new Uint8Array(0), new Uint8Array(0))).toBe(0);
  });

  it("returns 0 when either argument is missing", () => {
    const gray = new Uint8Array([1, 2, 3]);
    expect(frameDiff(undefined, gray)).toBe(0);
    expect(frameDiff(gray, undefined)).toBe(0);
    expect(frameDiff(undefined, undefined)).toBe(0);
  });
});

describe("summarizeVideoStats", () => {
  it("returns frames 0, motionSamples 0, and every flag false with no NaN when called with no argument", () => {
    const result = summarizeVideoStats();
    expect(result).toEqual({
      hadVideo: false,
      frames: 0,
      motionSamples: 0,
      meanLuma: 0,
      contrast: 0,
      motion: 0,
      tooDark: false,
      tooBright: false,
      veryStill: false,
      fidgety: false,
      partiallyOff: false,
    });
    for (const value of Object.values(result)) {
      if (typeof value === "number") expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("returns the same all-false zero result when hadVideo is true but the sample arrays are empty", () => {
    const result = summarizeVideoStats({ hadVideo: true, lumaMeans: [], lumaVars: [], diffs: [] });
    expect(result.frames).toBe(0);
    expect(result.motionSamples).toBe(0);
    expect(result.tooDark).toBe(false);
    expect(result.tooBright).toBe(false);
    expect(result.veryStill).toBe(false);
    expect(result.fidgety).toBe(false);
  });

  it("forces every flag false and frames/motionSamples to 0 when hadVideo is false, even with full sample arrays that would otherwise trip every flag", () => {
    const result = summarizeVideoStats({
      hadVideo: false,
      // Dark enough to be tooDark, and with enough samples to clear both
      // MIN_LUMA_SAMPLES and MIN_MOTION_SAMPLES thresholds on their own.
      lumaMeans: [10, 10, 10],
      lumaVars: [400, 400, 400],
      diffs: [50, 50],
      partiallyOff: true,
    });
    expect(result).toEqual({
      hadVideo: false,
      frames: 0,
      motionSamples: 0,
      meanLuma: 0,
      contrast: 0,
      motion: 0,
      tooDark: false,
      tooBright: false,
      veryStill: false,
      fidgety: false,
      partiallyOff: false,
    });
  });

  it("does not claim veryStill from a single motion sample below MIN_MOTION_SAMPLES, even though the lone diff reads as motionless", () => {
    expect(MIN_MOTION_SAMPLES).toBe(2);
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [120],
      lumaVars: [0],
      diffs: [0.1], // well under the veryStill threshold, but only 1 sample
    });
    expect(result.motionSamples).toBe(1);
    expect(result.motion).toBeCloseTo(0.1, 5);
    expect(result.veryStill).toBe(false);
    expect(result.fidgety).toBe(false);
  });

  it("does not claim fidgety from a single motion sample below MIN_MOTION_SAMPLES, even though the lone diff reads as high motion", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [120],
      lumaVars: [0],
      diffs: [50], // well over the fidgety threshold, but only 1 sample
    });
    expect(result.motionSamples).toBe(1);
    expect(result.fidgety).toBe(false);
    expect(result.veryStill).toBe(false);
  });

  it("fires veryStill once motionSamples reaches MIN_MOTION_SAMPLES and the average diff is below the still threshold", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [120, 120, 120],
      lumaVars: [0, 0, 0],
      diffs: [0.5, 0.5], // average 0.5, motionSamples 2 == MIN_MOTION_SAMPLES
    });
    expect(result.motionSamples).toBe(2);
    expect(result.veryStill).toBe(true);
    expect(result.fidgety).toBe(false);
  });

  it("fires fidgety once motionSamples reaches MIN_MOTION_SAMPLES and the average diff is above the fidgety threshold", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [120, 120, 120],
      lumaVars: [0, 0, 0],
      diffs: [20, 20], // average 20, motionSamples 2 == MIN_MOTION_SAMPLES
    });
    expect(result.motionSamples).toBe(2);
    expect(result.fidgety).toBe(true);
    expect(result.veryStill).toBe(false);
  });

  it("does not claim tooDark from a single luma sample below MIN_LUMA_SAMPLES, even though the lone frame reads as dark", () => {
    expect(MIN_LUMA_SAMPLES).toBe(2);
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [10], // well under the tooDark threshold, but only 1 frame
      lumaVars: [0],
      diffs: [],
    });
    expect(result.frames).toBe(1);
    expect(result.meanLuma).toBe(10);
    expect(result.tooDark).toBe(false);
    expect(result.tooBright).toBe(false);
  });

  it("fires tooDark once frames reaches MIN_LUMA_SAMPLES and the mean luma is below the dark threshold", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [30, 30],
      lumaVars: [0, 0],
      diffs: [],
    });
    expect(result.frames).toBe(2);
    expect(result.meanLuma).toBe(30);
    expect(result.tooDark).toBe(true);
    expect(result.tooBright).toBe(false);
  });

  it("does not fire tooDark right at the threshold value (strictly less-than, not less-or-equal)", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [60, 60], // exactly TOO_DARK_MEAN_LUMA
      lumaVars: [0, 0],
      diffs: [],
    });
    expect(result.meanLuma).toBe(60);
    expect(result.tooDark).toBe(false);
  });

  it("fires tooBright once frames reaches MIN_LUMA_SAMPLES and the mean luma is above the bright threshold", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [230, 230],
      lumaVars: [0, 0],
      diffs: [],
    });
    expect(result.frames).toBe(2);
    expect(result.meanLuma).toBe(230);
    expect(result.tooBright).toBe(true);
    expect(result.tooDark).toBe(false);
  });

  it("does not fire tooBright right at the threshold value (strictly greater-than, not greater-or-equal)", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [210, 210], // exactly TOO_BRIGHT_MEAN_LUMA
      lumaVars: [0, 0],
      diffs: [],
    });
    expect(result.meanLuma).toBe(210);
    expect(result.tooBright).toBe(false);
  });

  it("leaves both luma flags false for a normally-lit frame between the two thresholds", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [120, 120],
      lumaVars: [0, 0],
      diffs: [],
    });
    expect(result.tooDark).toBe(false);
    expect(result.tooBright).toBe(false);
  });

  it("passes partiallyOff through faithfully when true", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [120, 120],
      lumaVars: [0, 0],
      diffs: [1, 1],
      partiallyOff: true,
    });
    expect(result.partiallyOff).toBe(true);
  });

  it("passes partiallyOff through faithfully when false, and defaults it to false when omitted", () => {
    const explicit = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [120, 120],
      lumaVars: [0, 0],
      diffs: [1, 1],
      partiallyOff: false,
    });
    expect(explicit.partiallyOff).toBe(false);

    const omitted = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [120, 120],
      lumaVars: [0, 0],
      diffs: [1, 1],
    });
    expect(omitted.partiallyOff).toBe(false);
  });

  it("reports contrast as a standard deviation (sqrt of each frame's variance, then averaged) in the same 0-255 units as meanLuma, not raw variance", () => {
    // sqrt(16) = 4, sqrt(36) = 6 -> average 5. The raw-variance average would
    // be (16 + 36) / 2 = 26, a value this test must rule out.
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [100, 100],
      lumaVars: [16, 36],
      diffs: [],
    });
    expect(result.contrast).toBe(5);
    expect(result.contrast).not.toBe(26);
  });

  it("reports contrast 0 for a perfectly flat-variance answer regardless of brightness", () => {
    const result = summarizeVideoStats({
      hadVideo: true,
      lumaMeans: [200, 200],
      lumaVars: [0, 0],
      diffs: [],
    });
    expect(result.meanLuma).toBe(200);
    expect(result.contrast).toBe(0);
  });
});

// --- VideoFrameSampler -----------------------------------------------------

// Not exported by videoStats.js (module-private), so mirrored here the same
// way the source's own comments describe them. MIN_READY_STATE_TO_SAMPLE is
// HTMLMediaElement.HAVE_CURRENT_DATA (2); SAMPLE_INTERVAL_MS is the ~2x/sec
// tick rate the sampler runs its interval at.
const HAVE_CURRENT_DATA = 2;
const TICK_MS = 500;

function buildRgba(level, pixelCount) {
  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const p = i * 4;
    data[p] = level;
    data[p + 1] = level;
    data[p + 2] = level;
    data[p + 3] = 255;
  }
  return data;
}

// A square (aspect 1) frame keeps the sampler's internal canvas-resize logic
// a no-op across every test below (computed height stays 160, matching what
// start() already set), so every fake getImageData call can return this
// fixed-size buffer regardless of what videoWidth/videoHeight are set to.
const SAMPLE_PIXELS = 160 * 160;

function makeFakeVideo({ videoWidth = 160, videoHeight = 160, readyState = HAVE_CURRENT_DATA } = {}) {
  return {
    muted: false,
    playsInline: false,
    srcObject: null,
    videoWidth,
    videoHeight,
    readyState,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  };
}

function makeFakeCanvas() {
  let snapshotCallCount = 0;
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: buildRgba(128, SAMPLE_PIXELS) })),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    // Distinguishable per-call output, so retention/eviction across several
    // captures can be asserted by exact value instead of just a count.
    toDataURL: vi.fn(() => `snapshot-${snapshotCallCount++}`),
  };
  canvas.ctx = ctx;
  return canvas;
}

// start() calls document.createElement("video") once, then "canvas" twice
// (sampling canvas, then snapshot canvas) — canvases[0] is always the
// sampling canvas' context, canvases[1] the snapshot canvas'.
function makeFakeDocument(video) {
  const canvases = [];
  return {
    createElement: vi.fn((tag) => {
      if (tag === "video") return video;
      if (tag === "canvas") {
        const canvas = makeFakeCanvas();
        canvases.push(canvas);
        return canvas;
      }
      throw new Error(`VideoFrameSampler asked for an unexpected element: ${tag}`);
    }),
    canvases,
  };
}

describe("VideoFrameSampler", () => {
  let originalDocument;

  beforeEach(() => {
    // This module only ever runs in a browser; the node test environment
    // has no `document` at all, so each test installs a fake and this
    // restores whatever was there before, matching capture.test.js's
    // handling of the missing-navigator-global case.
    originalDocument = globalThis.document;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  });

  it("records hadVideo false and samples nothing for a stream with no video track", () => {
    const sampler = new VideoFrameSampler();
    sampler.start({ getVideoTracks: () => [] });
    vi.advanceTimersByTime(TICK_MS * 3); // no interval was ever armed; must be a no-op

    const { summary, frames } = sampler.stop();

    expect(summary.hadVideo).toBe(false);
    expect(summary.frames).toBe(0);
    expect(summary.meanLuma).toBe(0);
    expect(frames).toEqual([]);
  });

  it("reports hadVideo false, not a dark/still reading, when the track is disabled for the whole answer", () => {
    const track = { enabled: false, muted: false };
    const video = makeFakeVideo();
    globalThis.document = makeFakeDocument(video);
    const sampler = new VideoFrameSampler();

    sampler.start({ getVideoTracks: () => [track] });
    // If the disabled-track guard ever regressed, every one of these ticks
    // would instead sample this uniform, pitch-black, motionless frame.
    globalThis.document.canvases[0].ctx.getImageData.mockImplementation(() => ({
      data: buildRgba(2, SAMPLE_PIXELS),
    }));
    for (let i = 0; i < 4; i += 1) vi.advanceTimersByTime(TICK_MS);

    const { summary, frames } = sampler.stop();

    expect(summary.hadVideo).toBe(false);
    expect(summary.frames).toBe(0);
    expect(summary.tooDark).toBe(false);
    expect(summary.veryStill).toBe(false);
    expect(summary.partiallyOff).toBe(false);
    expect(frames).toEqual([]);
  });

  it("sets partiallyOff for a track disabled mid-answer while the valid samples still read honest lighting", () => {
    const track = { enabled: true, muted: false };
    const video = makeFakeVideo();
    globalThis.document = makeFakeDocument(video);
    const sampler = new VideoFrameSampler();
    sampler.start({ getVideoTracks: () => [track] });
    const ctx = globalThis.document.canvases[0].ctx;

    const validLevel = 150;
    const referenceMean = frameLuma(toGray(buildRgba(validLevel, SAMPLE_PIXELS), 160, 160)).mean;

    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(validLevel, SAMPLE_PIXELS) }));
    vi.advanceTimersByTime(TICK_MS); // valid sample #1

    track.enabled = false;
    // Would read as pitch black if this tick were wrongly sampled instead
    // of skipped.
    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(0, SAMPLE_PIXELS) }));
    vi.advanceTimersByTime(TICK_MS); // skipped

    track.enabled = true;
    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(validLevel, SAMPLE_PIXELS) }));
    vi.advanceTimersByTime(TICK_MS); // valid sample #2
    vi.advanceTimersByTime(TICK_MS); // valid sample #3

    const { summary } = sampler.stop();

    expect(summary.hadVideo).toBe(true);
    expect(summary.frames).toBe(3);
    expect(summary.partiallyOff).toBe(true);
    expect(summary.meanLuma).toBeCloseTo(referenceMean, 5);
    expect(summary.tooDark).toBe(false);
    expect(summary.tooBright).toBe(false);
  });

  it("takes no sample while the video reports zero dimensions, then resumes once real dimensions appear", () => {
    const track = { enabled: true, muted: false };
    const video = makeFakeVideo({ videoWidth: 0, videoHeight: 0 });
    globalThis.document = makeFakeDocument(video);
    const sampler = new VideoFrameSampler();
    sampler.start({ getVideoTracks: () => [track] });
    const ctx = globalThis.document.canvases[0].ctx;
    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(9, SAMPLE_PIXELS) }));

    vi.advanceTimersByTime(TICK_MS); // zero dimensions: no sample

    video.videoWidth = 160;
    video.videoHeight = 160;
    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(150, SAMPLE_PIXELS) }));
    vi.advanceTimersByTime(TICK_MS); // real dimensions now: sampled

    const { summary } = sampler.stop();

    expect(summary.hadVideo).toBe(true);
    expect(summary.frames).toBe(1);
  });

  it("takes no sample while readyState is below HAVE_CURRENT_DATA, then resumes once it clears the threshold", () => {
    const track = { enabled: true, muted: false };
    const video = makeFakeVideo({ readyState: HAVE_CURRENT_DATA - 1 });
    globalThis.document = makeFakeDocument(video);
    const sampler = new VideoFrameSampler();
    sampler.start({ getVideoTracks: () => [track] });
    const ctx = globalThis.document.canvases[0].ctx;
    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(9, SAMPLE_PIXELS) }));

    vi.advanceTimersByTime(TICK_MS); // readyState too low: no sample

    video.readyState = HAVE_CURRENT_DATA;
    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(150, SAMPLE_PIXELS) }));
    vi.advanceTimersByTime(TICK_MS); // readyState sufficient now: sampled

    const { summary } = sampler.stop();

    expect(summary.hadVideo).toBe(true);
    expect(summary.frames).toBe(1);
  });

  it("captures JPEG snapshots on a lower cadence than luma sampling, keeping at most 3 that span the answer", () => {
    const track = { enabled: true, muted: false };
    const video = makeFakeVideo();
    globalThis.document = makeFakeDocument(video);
    const sampler = new VideoFrameSampler();
    sampler.start({ getVideoTracks: () => [track] });
    const ctx = globalThis.document.canvases[0].ctx;
    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(120, SAMPLE_PIXELS) }));

    for (let i = 0; i < 13; i += 1) vi.advanceTimersByTime(TICK_MS);

    const { summary, frames } = sampler.stop();

    expect(summary.frames).toBe(13); // luma is sampled on every one of the 13 ticks
    expect(frames).toHaveLength(3); // snapshots capped at 3
    // Snapshots are only encoded every 4th valid sample (ticks 1, 5, 9, 13).
    // Once a 4th capture lands, the middle one is evicted so the retained
    // set is the very first frame plus the two most recent — not the three
    // most recent, and not just the first three.
    expect(frames).toEqual(["snapshot-0", "snapshot-2", "snapshot-3"]);
  });

  it("clears the interval and releases the offscreen video on stop()", () => {
    const track = { enabled: true, muted: false };
    const video = makeFakeVideo();
    globalThis.document = makeFakeDocument(video);
    const sampler = new VideoFrameSampler();
    sampler.start({ getVideoTracks: () => [track] });
    const ctx = globalThis.document.canvases[0].ctx;
    ctx.getImageData.mockImplementation(() => ({ data: buildRgba(120, SAMPLE_PIXELS) }));

    vi.advanceTimersByTime(TICK_MS);
    const callsBeforeStop = ctx.getImageData.mock.calls.length;

    sampler.stop();

    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();

    // Advancing well past several more sample periods must not produce any
    // further getImageData calls — the interval was really cleared, not
    // just left pointing at a since-torn-down video/canvas.
    vi.advanceTimersByTime(TICK_MS * 5);
    expect(ctx.getImageData.mock.calls.length).toBe(callsBeforeStop);
  });

  it("is safe to call without a matching start()", () => {
    const sampler = new VideoFrameSampler();
    const { summary, frames } = sampler.stop();

    expect(summary.hadVideo).toBe(false);
    expect(summary.frames).toBe(0);
    expect(frames).toEqual([]);
  });

  it("is safe to call twice in a row", () => {
    const track = { enabled: true, muted: false };
    const video = makeFakeVideo();
    globalThis.document = makeFakeDocument(video);
    const sampler = new VideoFrameSampler();
    sampler.start({ getVideoTracks: () => [track] });
    globalThis.document.canvases[0].ctx.getImageData.mockImplementation(() => ({
      data: buildRgba(120, SAMPLE_PIXELS),
    }));
    vi.advanceTimersByTime(TICK_MS);

    const first = sampler.stop();
    const second = sampler.stop();

    expect(first.summary.frames).toBe(1);
    expect(second.summary.hadVideo).toBe(false);
    expect(second.summary.frames).toBe(0);
    expect(second.frames).toEqual([]);
  });

  it("is safe to call immediately after start(), before any tick fires", () => {
    const track = { enabled: true, muted: false };
    const video = makeFakeVideo();
    globalThis.document = makeFakeDocument(video);
    const sampler = new VideoFrameSampler();

    sampler.start({ getVideoTracks: () => [track] });
    const { summary, frames } = sampler.stop();

    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(summary.hadVideo).toBe(false);
    expect(summary.frames).toBe(0);
    expect(frames).toEqual([]);
  });
});
