// Practice mode's video delivery signal: lighting and motion, sampled from
// the candidate's own camera feed while they answer. Split in two, per this
// codebase's house rule for anything that mixes math and the DOM:
//
//   - Pure functions (toGray, frameLuma, frameDiff, summarizeVideoStats):
//     no DOM, no browser globals, testable in Node with plain typed arrays.
//   - VideoFrameSampler: the thin class that owns the offscreen <video>,
//     canvas, and sampling interval, and calls the pure functions above.
//
// No DOM/browser globals are touched at module scope, so this module
// imports cleanly in the Node ("environment: node", no jsdom) test
// environment this repo's vitest config runs under — VideoFrameSampler only
// touches `document` inside its own methods, at call time.

// --- Pure functions ---------------------------------------------------

// Rec. 601 luma weights — the standard "perceived brightness" reduction of
// an RGB pixel, the same one JPEG and most video codecs use.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// Reduces an RGBA buffer (as from canvas getImageData) to one luminance byte
// per pixel. Pixel count is the SMALLER of what width*height asks for and
// what the buffer actually holds — a short/mismatched buffer (a stale or
// truncated getImageData result) yields fewer, still-real pixels rather than
// silently padding the rest with black.
export function toGray(rgbaData, width, height) {
  const requested = Math.max(0, (width | 0) * (height | 0));
  const available = rgbaData ? Math.floor(rgbaData.length / 4) : 0;
  const count = Math.min(requested, available);
  const gray = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i += 1, p += 4) {
    gray[i] = (rgbaData[p] * LUMA_R + rgbaData[p + 1] * LUMA_G + rgbaData[p + 2] * LUMA_B) | 0;
  }
  return gray;
}

// Mean and variance of a single frame's luminance — mean stands in for
// brightness, variance for contrast (a frame that's all one flat shade has
// variance near 0 regardless of how bright that shade is).
export function frameLuma(grayData) {
  const n = grayData ? grayData.length : 0;
  if (!n) return { mean: 0, variance: 0 };
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += grayData[i];
  const mean = sum / n;
  let sqDiff = 0;
  for (let i = 0; i < n; i += 1) {
    const d = grayData[i] - mean;
    sqDiff += d * d;
  }
  return { mean, variance: sqDiff / n };
}

// Mean absolute per-pixel luminance change between two consecutive samples —
// the motion signal. 0 whenever the two frames can't be compared at all
// (different lengths, or either missing), rather than throwing or misreading
// unrelated buffers as "no motion".
export function frameDiff(prevGray, curGray) {
  if (!prevGray || !curGray) return 0;
  const n = prevGray.length;
  if (n === 0 || n !== curGray.length) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs(curGray[i] - prevGray[i]);
  return sum / n;
}

function average(values) {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// 0-255 luma scale. A typically-lit webcam frame's mean luma sits well above
// 90; below this the frame reads as underexposed (backlit, dim room) to a
// human reviewer.
const TOO_DARK_MEAN_LUMA = 60;

// 0-255 luma scale. Above this the frame is close to blown-out white —
// overexposed by a bright window or light behind the camera.
const TOO_BRIGHT_MEAN_LUMA = 210;

// Mean absolute per-pixel luma change between ~2x/sec samples, 0-255 scale.
// Below this the frame is essentially frozen — camera covered, subject
// stepped out of frame, or sitting dead-still.
const VERY_STILL_MOTION = 1.5;

// Same scale as above. Above this the frame is changing a lot between
// samples — a fidgety subject, or a very unstable camera.
const FIDGETY_MOTION = 14;

// Minimum number of luma samples before tooDark/tooBright are allowed to
// fire at all. A single frame is one flicker or one blown highlight away
// from being a false read — this is not "confidence", just "more than one
// data point exists to assert anything from."
export const MIN_LUMA_SAMPLES = 2;

// Minimum number of frame-to-frame comparisons (one fewer than the sample
// count — the first sample has nothing to diff against) before veryStill/
// fidgety are allowed to fire. `average([])` is 0, which is indistinguishable
// from "measured zero motion" unless this is checked separately — an answer
// too short to produce even one comparison must not be reported as "very
// little movement" when no movement was ever actually measured.
export const MIN_MOTION_SAMPLES = 2;

// Reduces a whole answer's worth of per-frame samples to the flags C4 (and
// AnswerReview) actually consume. Empty input (no video track, a track that
// was disabled/muted the whole time, or one that never produced a sample
// before the answer ended) returns frames: 0 and every flag false — never
// NaN — so callers never have to special-case "no data" themselves.
export function summarizeVideoStats({
  hadVideo = false,
  lumaMeans = [],
  lumaVars = [],
  diffs = [],
  partiallyOff = false,
} = {}) {
  const frames = (lumaMeans || []).length;
  const motionSamples = (diffs || []).length;
  if (!hadVideo || frames === 0) {
    return {
      hadVideo: !!hadVideo,
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
    };
  }

  const meanLuma = average(lumaMeans);
  // Contrast reported as a standard deviation (sqrt of variance) — same
  // 0-255 units as meanLuma, easier to read than raw variance.
  const contrast = average((lumaVars || []).map((v) => Math.sqrt(Math.max(0, v))));
  const motion = average(diffs);
  const hasEnoughLuma = frames >= MIN_LUMA_SAMPLES;
  const hasEnoughMotion = motionSamples >= MIN_MOTION_SAMPLES;

  return {
    hadVideo: true,
    frames,
    motionSamples,
    meanLuma,
    contrast,
    motion,
    tooDark: hasEnoughLuma && meanLuma < TOO_DARK_MEAN_LUMA,
    tooBright: hasEnoughLuma && meanLuma > TOO_BRIGHT_MEAN_LUMA,
    veryStill: hasEnoughMotion && motion < VERY_STILL_MOTION,
    fidgety: hasEnoughMotion && motion > FIDGETY_MOTION,
    // Some ticks landed while the Camera switch (or an OS privacy shutter)
    // had the track disabled/muted, but at least one valid sample also came
    // through — the caller should say the camera was off for PART of the
    // answer rather than staying silent about it.
    partiallyOff: !!partiallyOff,
  };
}

// --- Sampler -------------------------------------------------------------

const SAMPLE_INTERVAL_MS = 500; // ~2x/sec — enough signal, cheap to run continuously
const SAMPLE_WIDTH = 160; // small on purpose: only luminance/motion math reads this canvas
const SNAPSHOT_WIDTH = 320; // larger canvas for the retained JPEG frames, for C4's visual review
const SNAPSHOT_QUALITY = 0.6;
const MAX_SNAPSHOTS = 3;
// A JPEG encode (toDataURL) is far more expensive than the luma sampling
// math, and at most MAX_SNAPSHOTS are ever kept — encoding every 500ms tick
// spent ~99% of that work on frames immediately discarded. One encode every
// 4th tick (~2s) still spans a multi-second answer (first, some middles, and
// whatever is most recent when it ends) without paying for every tick.
const SNAPSHOT_EVERY_N_SAMPLES = 4;

// The video element has decoded and can render at least the current frame.
// A tick landing between "metadata is known" (videoWidth/videoHeight already
// non-zero) and "a frame has actually been decoded" would otherwise read a
// fully transparent canvas back as a real, perfectly black sample.
const MIN_READY_STATE_TO_SAMPLE = 2; // HTMLMediaElement.HAVE_CURRENT_DATA

// A track is only really "on" when it's both present, enabled (the Camera
// switch didn't turn it off), and not muted (no OS-level privacy shutter,
// no browser-level "paused" state). Reading this straight off the track
// object — rather than trusting UI-level state like PracticeClient's
// `cameraOff` — means it stays correct even if this sampler is ever reused
// somewhere that state isn't wired through.
function isTrackActive(track) {
  if (!track) return false;
  return track.enabled !== false && track.muted !== true;
}

// Turns a live MediaStream into the pure stats above, plus a handful of
// retained JPEG frames for feature C4's visual analysis (C3 itself never
// sends them anywhere). Owns its own offscreen <video> and two canvases —
// deliberately never CameraPreview's element, so sampling keeps working
// regardless of what the preview happens to be rendering (mirrored, hidden
// behind "Camera off", or torn down entirely).
export class VideoFrameSampler {
  constructor() {
    this._started = false;
    this._track = null;
    this._video = null;
    this._canvas = null;
    this._ctx = null;
    this._snapCanvas = null;
    this._snapCtx = null;
    this._timer = null;
    this._prevGray = null;
    this._lumaMeans = [];
    this._lumaVars = [];
    this._diffs = [];
    this._snapshots = [];
    this._validSampleCount = 0;
    this._gotSample = false; // at least one sample while the track was active
    this._skippedDisabled = false; // at least one tick skipped while inactive
  }

  start(stream) {
    if (this._started) return;
    this._started = true;
    this._track = stream?.getVideoTracks?.()[0] || null;
    this._prevGray = null;
    this._lumaMeans = [];
    this._lumaVars = [];
    this._diffs = [];
    this._snapshots = [];
    this._validSampleCount = 0;
    this._gotSample = false;
    this._skippedDisabled = false;
    if (!this._track) return;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this._video = video;
    // play() can reject (autoplay policy, a track that ends immediately) —
    // sampling just quietly stays empty for this answer when it does, the
    // same as if the stream had no video track at all.
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }

    this._canvas = document.createElement("canvas");
    this._canvas.width = SAMPLE_WIDTH;
    this._canvas.height = SAMPLE_WIDTH;
    this._ctx = this._canvas.getContext("2d", { willReadFrequently: true });

    this._snapCanvas = document.createElement("canvas");
    this._snapCanvas.width = SNAPSHOT_WIDTH;
    this._snapCanvas.height = SNAPSHOT_WIDTH;
    this._snapCtx = this._snapCanvas.getContext("2d");

    this._timer = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS);
  }

  _sample() {
    // The Camera switch (or an OS privacy shutter) can flip mid-answer.
    // Skip this tick entirely rather than sampling a black/frozen frame —
    // otherwise a camera the user turned off gets measured as a real dark,
    // motionless shot, and averages in real (non-black) samples get dragged
    // down by frames that were never actually of the user.
    if (!isTrackActive(this._track)) {
      this._skippedDisabled = true;
      // Don't diff the next real frame against whatever was on screen
      // before the gap — that comparison would be meaningless.
      this._prevGray = null;
      return;
    }

    const video = this._video;
    const ctx = this._ctx;
    if (
      !video ||
      !ctx ||
      !video.videoWidth ||
      !video.videoHeight ||
      video.readyState < MIN_READY_STATE_TO_SAMPLE
    ) {
      return;
    }

    const aspect = video.videoHeight / video.videoWidth;
    const h = Math.max(1, Math.round(SAMPLE_WIDTH * aspect));
    if (this._canvas.height !== h) this._canvas.height = h;
    ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, h);

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, SAMPLE_WIDTH, h);
    } catch {
      return;
    }
    const gray = toGray(imageData.data, SAMPLE_WIDTH, h);
    const { mean, variance } = frameLuma(gray);
    this._lumaMeans.push(mean);
    this._lumaVars.push(variance);
    if (this._prevGray) this._diffs.push(frameDiff(this._prevGray, gray));
    this._prevGray = gray;
    this._gotSample = true;

    this._validSampleCount += 1;
    if ((this._validSampleCount - 1) % SNAPSHOT_EVERY_N_SAMPLES === 0) {
      this._captureSnapshot(video, aspect);
    }
  }

  _captureSnapshot(video, aspect) {
    const snapCtx = this._snapCtx;
    if (!snapCtx) return;
    const h = Math.max(1, Math.round(SNAPSHOT_WIDTH * aspect));
    if (this._snapCanvas.height !== h) this._snapCanvas.height = h;
    snapCtx.drawImage(video, 0, 0, SNAPSHOT_WIDTH, h);

    let dataUrl;
    try {
      dataUrl = this._snapCanvas.toDataURL("image/jpeg", SNAPSHOT_QUALITY);
    } catch {
      return;
    }

    // Keep the first frame captured plus the two most recent, so the
    // retained set spans the whole answer instead of clustering at the end:
    // once full, slot 0 (the very first frame) stays put and slots 1/2
    // slide forward.
    if (this._snapshots.length < MAX_SNAPSHOTS) {
      this._snapshots.push(dataUrl);
    } else {
      this._snapshots[1] = this._snapshots[2];
      this._snapshots[2] = dataUrl;
    }
  }

  // Tears down the interval, the offscreen video, and both canvases, and
  // returns { summary, frames } for whatever was sampled since start() (or
  // an empty summary and no frames if start() was never called, or produced
  // no samples). Safe to call without a matching start(), and safe to call
  // twice — the second call finds nothing left to tear down.
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    const video = this._video;
    this._video = null;
    if (video) {
      try {
        video.pause();
      } catch {
        // ignore — best effort teardown
      }
      video.srcObject = null;
    }
    this._canvas = null;
    this._ctx = null;
    this._snapCanvas = null;
    this._snapCtx = null;

    const summary = summarizeVideoStats({
      hadVideo: this._gotSample,
      lumaMeans: this._lumaMeans,
      lumaVars: this._lumaVars,
      diffs: this._diffs,
      partiallyOff: this._gotSample && this._skippedDisabled,
    });
    const frames = this._snapshots;

    this._started = false;
    this._track = null;
    this._prevGray = null;
    this._lumaMeans = [];
    this._lumaVars = [];
    this._diffs = [];
    this._snapshots = [];
    this._validSampleCount = 0;
    this._gotSample = false;
    this._skippedDisabled = false;

    return { summary, frames };
  }
}
