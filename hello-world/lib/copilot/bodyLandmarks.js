"use client";

// D2's on-device body-language sampler: owns the MediaPipe Tasks Vision
// FaceLandmarker + PoseLandmarker, an offscreen <video> built from the
// candidate's own camera stream, and a sampling interval -- the DOM/
// MediaPipe half of the split lib/copilot/bodyLanguage.js's comment block
// describes, following VideoFrameSampler's shape as directed by AC-D2-3.
//
// Every failure mode is reported, never swallowed into a silent zero (see
// stop()'s `reason`): the @mediapipe/tasks-vision package failing to load,
// the runtime assets not being staged, a model file 404ing, no WebGL/WASM
// support, the video never producing a frame, and the camera being off or
// the track disabled all produce a distinct, honest `available: false`
// result rather than a summary that merely looks like "nothing was
// detected".

import {
  headOrientation,
  isLookingAtCamera,
  postureFrom,
  gestureActivity,
  expressiveness,
  framing,
  summarizeBodyLanguage,
} from "./bodyLanguage";

// How often inference runs, in ms (~5/sec, per AC-D2-3's "start around 5 per
// second"). The browser is ALSO encoding video and streaming mic audio for
// the whole answer at the same time this runs, so this stays well below the
// ~24-30fps a webcam actually produces: two "lite" MediaPipe models on a
// 256px downscaled frame, 5 times a second, is a light enough load to not
// visibly compete with encoding/streaming on ordinary laptop hardware,
// while still giving several seconds of samples for even a short answer.
const SAMPLE_INTERVAL_MS = 200;

// Both MediaPipe models resize their input internally (the face detector to
// ~192px, the pose detector to ~256px) regardless of what's handed in --
// feeding a larger frame only pays canvas-draw/color-conversion cost for no
// accuracy gain. 256px is comfortably above both internal sizes.
const SAMPLE_WIDTH = 256;

// The video element has decoded and can render at least the current frame
// -- see videoStats.js's identical constant/comment for why this specific
// readyState (not just "metadata known") matters.
const MIN_READY_STATE_TO_SAMPLE = 2; // HTMLMediaElement.HAVE_CURRENT_DATA

// If a fifth or more of the ticks a sampler actually attempted inference on
// threw an error (as opposed to simply not finding a face/pose, which is a
// normal, non-error outcome), that is material enough to disclose even
// though some real measurements DID come through (BUG-8) -- otherwise a
// mid-answer inference failure that still leaves `available: true` looks
// identical to a clean run, with only a smaller (and unexplained) `frames`
// count as any trace. bodyLanguage.js's MIN_COVERAGE_RATIO already nulls
// out any specific aggregate that doesn't have enough real coverage; this
// just puts the reason for that on record.
const MATERIAL_INFERENCE_FAILURE_RATIO = 0.2;

// Local paths only -- AC-D2-1's whole point. The wasm runtime is staged
// here at build/dev time by scripts/copy-mediapipe.mjs (from whatever
// @mediapipe/tasks-vision version is actually installed); the .task model
// files are committed under public/mediapipe/models (see its README for
// exact versions/licence/source). Neither is ever fetched from MediaPipe's
// default storage.googleapis.com CDN.
const WASM_BASE_PATH = "/mediapipe/wasm";
const WASM_PROBE_PATH = `${WASM_BASE_PATH}/vision_wasm_internal.js`;
const FACE_MODEL_PATH = "/mediapipe/models/face_landmarker.task";
const POSE_MODEL_PATH = "/mediapipe/models/pose_landmarker_lite.task";

// BUG-4: verified directly against the installed @mediapipe/tasks-vision
// package (1.0.1) -- its vision_bundle.mjs contains a hard-coded call to
// this exact host for its own internal usage-logging beacon, and the
// `enableLogging` opt-out its own type definitions advertise does not
// exist anywhere in the shipped bundle for this version. See
// public/mediapipe/models/README.md's "MediaPipe telemetry" section for
// how this was found, how it was verified fixed, and what to do if a later
// package version adds the real opt-out (at which point this whole guard
// should be deleted).
const MEDIAPIPE_TELEMETRY_HOST = "odml.pa.googleapis.com";

// Pure string/URL match, exported so it can be unit-tested on its own
// without touching `fetch`, the DOM, or MediaPipe at all. Matches by HOST
// rather than a fixed path -- a future package version could reuse the same
// logging domain for a differently-named endpoint, and matching only an
// exact path risks silently letting a renamed one straight through.
export function isMediaPipeTelemetryUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(String(url), "http://localhost");
    return parsed.hostname === MEDIAPIPE_TELEMETRY_HOST;
  } catch {
    return false;
  }
}

// Monkeypatches the global `fetch` so any request to
// MEDIAPIPE_TELEMETRY_HOST is answered LOCALLY with a synthetic, empty 204
// response instead of leaving the browser -- the library sees its logging
// call "succeed" and moves on, rather than seeing it rejected (which risks
// a retry loop or a surfaced error neither of which is better than just
// not sending it) or hanging. Every other request passes straight through
// to the real fetch, untouched. Installed once, lazily, the first time a
// model load is attempted, and left in place for the rest of the page's
// life once a load succeeds (there is no "close" lifecycle for the
// module-level landmarkers below to hang removal off -- see
// loadLandmarkers); removed only if the load that just tried to use it
// failed outright, since at that point nothing is relying on it.
let originalFetch = null;
let telemetryGuardInstalled = false;

function installTelemetryGuard() {
  if (telemetryGuardInstalled || typeof fetch !== "function") return;
  originalFetch = fetch;
  telemetryGuardInstalled = true;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input && input.url;
    if (isMediaPipeTelemetryUrl(url)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return originalFetch(input, init);
  };
}

function removeTelemetryGuard() {
  if (!telemetryGuardInstalled) return;
  globalThis.fetch = originalFetch;
  originalFetch = null;
  telemetryGuardInstalled = false;
}

// A track is only really "on" when it's present, enabled, and not muted --
// identical reasoning (and identical check) to videoStats.js's
// isTrackActive; kept as its own copy here rather than imported so this
// sampler never reaches into VideoFrameSampler's internals, per AC-D2-3.
function isTrackActive(track) {
  if (!track) return false;
  return track.enabled !== false && track.muted !== true;
}

// Face landmarks are normalized (0-1) image coordinates -- min/max over all
// of them gives a tight axis-aligned box in the same units framing()
// expects, without needing a separate face-detector bounding box.
function faceBoundingBox(faceLandmarks) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const lm of faceLandmarks) {
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

// BUG-11: a HEAD request against one file from each of the two locations
// the sampler actually needs (the wasm runtime and one .task model) --
// cheap, same-origin, and gives a specific, actionable diagnosis when the
// answer is "the files simply aren't there" (a fresh checkout where only
// `prebuild`/`predev` ever stage them, so a server started before either
// ran would still be missing them) rather than lumping that in with a
// genuine model/runtime failure that "run npm run copy-mediapipe" can't fix.
async function assetsAreStaged() {
  try {
    const [wasmRes, faceRes] = await Promise.all([
      fetch(WASM_PROBE_PATH, { method: "HEAD" }),
      fetch(FACE_MODEL_PATH, { method: "HEAD" }),
    ]);
    return !!(wasmRes && wasmRes.ok && faceRes && faceRes.ok);
  } catch {
    return false;
  }
}

function safeClose(landmarker) {
  try {
    if (landmarker && typeof landmarker.close === "function") landmarker.close();
  } catch {
    // best-effort -- already discarding this runtime either way
  }
}

// Both landmarkers are loaded ONCE and reused for the lifetime of the page,
// not per BodyLanguageSampler instance -- model initialisation is expensive
// (AC-D2-3) and usePracticeAnswer rebuilds its sampler instance whenever a
// capture session restarts (resetForSession), so instance-level caching
// alone would still reload on every Stop/Start. A rejected load is NOT
// cached as a promise -- clearing it lets a later answer retry -- but the
// retry itself is bounded (BUG-9): MAX_LOAD_ATTEMPTS caps how many times a
// persistently-failing load (a genuinely 404ing model file, no WebGL) will
// be retried before every subsequent answer just gets told "unavailable"
// immediately instead of paying for (and, before this fix, leaking) a full
// model-build attempt every single time.
const MAX_LOAD_ATTEMPTS = 2;
let landmarkersPromise = null;
let loadAttempts = 0;
let lastLoadError = null;

async function loadLandmarkers() {
  if (landmarkersPromise) return landmarkersPromise;
  if (loadAttempts >= MAX_LOAD_ATTEMPTS) {
    return Promise.reject(
      lastLoadError || new Error("MediaPipe models failed to load after repeated attempts"),
    );
  }
  loadAttempts += 1;
  landmarkersPromise = (async () => {
    const staged = await assetsAreStaged();
    if (!staged) {
      const err = new Error(
        'MediaPipe runtime assets are not staged under /mediapipe/wasm or /mediapipe/models -- run "npm run copy-mediapipe" (this also runs automatically before `npm run build` and `npm run dev`).',
      );
      err.reason = "runtime-assets-missing";
      throw err;
    }

    installTelemetryGuard();
    const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const wasmFileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);

    // allSettled (not all) so a failure on ONE model doesn't strand the
    // OTHER's fully-constructed WASM/WebGL runtime with nothing to close it
    // (BUG-9) -- Promise.all would reject immediately and lose the
    // reference to whichever one DID resolve.
    const [faceResult, poseResult] = await Promise.allSettled([
      FaceLandmarker.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }),
      PoseLandmarker.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
      }),
    ]);

    if (faceResult.status === "rejected" || poseResult.status === "rejected") {
      if (faceResult.status === "fulfilled") safeClose(faceResult.value);
      if (poseResult.status === "fulfilled") safeClose(poseResult.value);
      const reason = faceResult.status === "rejected" ? faceResult.reason : poseResult.reason;
      throw reason instanceof Error ? reason : new Error(String(reason));
    }

    return { faceLandmarker: faceResult.value, poseLandmarker: poseResult.value };
  })().catch((err) => {
    landmarkersPromise = null;
    lastLoadError = err;
    // Nothing succeeded (or whatever DID was already closed above), so
    // nothing is relying on the guard anymore -- if a later attempt tries
    // again, it reinstalls it itself.
    removeTelemetryGuard();
    throw err;
  });
  return landmarkersPromise;
}

// Turns a live MediaStream into the summary lib/copilot/bodyLanguage.js's
// summarizeBodyLanguage produces, following VideoFrameSampler's shape:
// deliberately owns its OWN offscreen <video> and canvas rather than
// reaching into CameraPreview's element or VideoFrameSampler's, so sampling
// keeps working regardless of what either is doing.
export class BodyLanguageSampler {
  constructor() {
    this._started = false;
    this._track = null;
    this._video = null;
    this._canvas = null;
    this._ctx = null;
    this._timer = null;
    this._landmarkers = null;
    this._samples = [];
    this._prevPoseLandmarks = null;
    this._tickCounter = 0; // increments once per interval firing, any outcome -- see _sample
    this._samplingInFlight = false; // BUG-10 overrun guard
    this._overrunSkips = 0;
    this._inferenceFailureCount = 0; // BUG-8
    this._gotAnySample = false; // at least one tick actually ran inference
    this._skippedDisabled = false; // at least one tick skipped while the track was off
    this._noFramesProduced = true; // stays true until the video decodes a usable frame
    this._loadError = null;
    this._loadErrorReason = null;
    this._runtimeError = null;
  }

  start(stream) {
    if (this._started) return;
    this._started = true;
    this._track = stream?.getVideoTracks?.()[0] || null;
    this._samples = [];
    this._prevPoseLandmarks = null;
    this._tickCounter = 0;
    this._samplingInFlight = false;
    this._overrunSkips = 0;
    this._inferenceFailureCount = 0;
    this._gotAnySample = false;
    this._skippedDisabled = false;
    this._noFramesProduced = true;
    this._loadError = null;
    this._loadErrorReason = null;
    this._runtimeError = null;
    if (!this._track) return;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this._video = video;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }

    this._canvas = document.createElement("canvas");
    this._canvas.width = SAMPLE_WIDTH;
    this._canvas.height = SAMPLE_WIDTH;
    this._ctx = this._canvas.getContext("2d", { willReadFrequently: false });

    // Kicked off here but never awaited -- AC-D2-4 requires the answer flow
    // to never wait on slow model loading. Ticks before this resolves
    // simply contribute nothing (see _sample's `!this._landmarkers` guard);
    // stop() reports that honestly as "not-ready" rather than a measured
    // zero if the answer ends before it ever resolves.
    loadLandmarkers()
      .then((landmarkers) => {
        if (!this._started) return; // stopped before loading finished
        this._landmarkers = landmarkers;
      })
      .catch((err) => {
        if (!this._started) return;
        this._loadError = (err && err.message) || "MediaPipe models failed to load";
        this._loadErrorReason = (err && err.reason) || "model-load-failed";
      });

    this._timer = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS);
  }

  _sample() {
    // Every interval firing spends one tick number, REGARDLESS of outcome
    // (overrun, camera off, not ready, inference error, or a full success)
    // -- this is what lets bodyLanguage.js's headOrientationDeltas tell a
    // genuinely consecutive pair of measurements from two that straddle a
    // gap (BUG-6), purely by comparing tick numbers, without needing to
    // know WHY anything in between was skipped.
    this._tickCounter += 1;
    const tick = this._tickCounter;

    // BUG-10: the previous tick's inference (two synchronous MediaPipe
    // calls) hasn't returned yet -- rather than letting work pile up and
    // start competing even harder with the concurrent video encode/audio
    // stream, skip this firing entirely. Counted so BUG-2's coverage math
    // sees it as a genuinely un-sampled tick rather than silently missing.
    if (this._samplingInFlight) {
      this._overrunSkips += 1;
      return;
    }

    // The Camera switch (or an OS privacy shutter) can flip mid-answer --
    // identical handling to VideoFrameSampler's _sample: skip the tick
    // entirely and drop the pose continuity reference, rather than running
    // inference on a black/frozen frame.
    if (!isTrackActive(this._track)) {
      this._skippedDisabled = true;
      this._prevPoseLandmarks = null;
      return;
    }

    const video = this._video;
    const ctx = this._ctx;
    if (!video || !ctx || !video.videoWidth || !video.videoHeight || video.readyState < MIN_READY_STATE_TO_SAMPLE) {
      return;
    }
    this._noFramesProduced = false;

    // Models not loaded (or never will be) yet -- nothing to run inference
    // with this tick. Reported honestly at stop() via `reason`, never as a
    // measured zero.
    if (!this._landmarkers) return;

    this._samplingInFlight = true;
    try {
      this._runInference(video, ctx, tick);
    } finally {
      this._samplingInFlight = false;
    }
  }

  _runInference(video, ctx, tick) {
    const aspect = video.videoHeight / video.videoWidth;
    const h = Math.max(1, Math.round(SAMPLE_WIDTH * aspect));
    if (this._canvas.height !== h) this._canvas.height = h;
    ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, h);

    // performance.now() is monotonically increasing for the whole page
    // lifetime, which is exactly what MediaPipe's VIDEO running mode
    // requires (strictly increasing timestamps per landmarker instance) --
    // and, unlike a per-answer counter, it stays correct across the model
    // reuse this sampler deliberately does between answers and sessions.
    const timestampMs = Math.round(performance.now());
    let faceResult;
    let poseResult;
    try {
      faceResult = this._landmarkers.faceLandmarker.detectForVideo(this._canvas, timestampMs);
      poseResult = this._landmarkers.poseLandmarker.detectForVideo(this._canvas, timestampMs);
    } catch (err) {
      // BUG-8: recorded even though earlier/later ticks may still succeed
      // -- _buildSummary checks whether failures are a MATERIAL fraction of
      // everything attempted, not just whether ALL of them failed.
      this._runtimeError = (err && err.message) || "MediaPipe inference failed";
      this._inferenceFailureCount += 1;
      return;
    }

    this._gotAnySample = true;
    const sample = this._toSample(faceResult, poseResult, aspect, tick);
    this._samples.push(sample);
    this._prevPoseLandmarks = (poseResult && poseResult.landmarks && poseResult.landmarks[0]) || null;
  }

  _toSample(faceResult, poseResult, aspect, tick) {
    const faceLandmarks = (faceResult && faceResult.faceLandmarks && faceResult.faceLandmarks[0]) || null;
    const matrix =
      (faceResult && faceResult.facialTransformationMatrixes && faceResult.facialTransformationMatrixes[0]) || null;
    const blendshapeCategories =
      (faceResult && faceResult.faceBlendshapes && faceResult.faceBlendshapes[0] && faceResult.faceBlendshapes[0].categories) ||
      null;
    const poseLandmarks = (poseResult && poseResult.landmarks && poseResult.landmarks[0]) || null;

    const faceDetected = !!faceLandmarks;
    const poseDetected = !!poseLandmarks;

    const orientation = faceDetected ? headOrientation(matrix) : { yaw: null, pitch: null, roll: null };
    const lookingAtCamera = faceDetected ? isLookingAtCamera(orientation.yaw, orientation.pitch) : null;
    const expr = faceDetected ? expressiveness(blendshapeCategories) : { smile: null, browMovement: null };
    const box = faceDetected ? faceBoundingBox(faceLandmarks) : null;
    const framingResult = faceDetected
      ? framing(box)
      : { centered: null, fill: null, tooClose: null, tooFar: null };

    // aspect (frameHeight / frameWidth) is threaded through to both --
    // needed to keep x/y-mixing math (shoulder tilt, slouch, gesture
    // movement) correct on non-square frames (BUG-5); see
    // bodyLanguage.js's toWidthRelativeY.
    const posture = poseDetected
      ? postureFrom(poseLandmarks, aspect)
      : { shoulderTilt: null, lean: null, slouch: null };
    const gesture = gestureActivity(this._prevPoseLandmarks, poseLandmarks, aspect);

    return {
      tick,
      faceDetected,
      poseDetected,
      yaw: orientation.yaw,
      pitch: orientation.pitch,
      roll: orientation.roll,
      lookingAtCamera,
      shoulderTilt: posture.shoulderTilt,
      lean: posture.lean,
      slouch: posture.slouch,
      gestureMovement: gesture.movement,
      handsVisible: gesture.handsVisible,
      smile: expr.smile,
      browMovement: expr.browMovement,
      faceCentered: framingResult.centered,
      faceFill: framingResult.fill,
      faceTooClose: framingResult.tooClose,
      faceTooFar: framingResult.tooFar,
    };
  }

  // Tears down the interval and the offscreen video/canvas, and returns a
  // summary for whatever was sampled since start(). Safe to call without a
  // matching start(), and safe to call twice -- the second call finds
  // nothing left to tear down and returns the same empty/unavailable shape.
  // Never leaves work queued that resolves after teardown: the pending
  // loadLandmarkers() `.then`/`.catch` above both check `this._started`
  // before writing anything, so a load that finishes after stop() writes
  // nothing to this (by-then-reset) instance.
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
        // ignore -- best effort teardown
      }
      video.srcObject = null;
    }
    this._canvas = null;
    this._ctx = null;

    const summary = this._buildSummary();

    this._started = false;
    this._track = null;
    this._samples = [];
    this._prevPoseLandmarks = null;
    this._tickCounter = 0;
    this._samplingInFlight = false;
    this._overrunSkips = 0;
    this._inferenceFailureCount = 0;
    this._gotAnySample = false;
    this._skippedDisabled = false;
    this._noFramesProduced = true;
    this._loadError = null;
    this._loadErrorReason = null;
    this._runtimeError = null;

    return summary;
  }

  // Builds the final `{ available, reason, ... }` summary, checking failure
  // modes in order from "most specific/actionable" to "generic" so the
  // reported reason is always the most useful one available -- e.g. a
  // camera that was off for the whole answer reports "camera-off", not the
  // more generic "no-frames" that would otherwise also technically be true.
  // `overrunSkips` (BUG-10) rides along on every branch: skipped ticks never
  // entered `_samples`, so they can't have corrupted any coverage ratio
  // above, but the raw count is still worth keeping visible rather than
  // just silently reducing how many ticks this answer ended up with.
  _buildSummary() {
    const summary = { ...summarizeBodyLanguage(this._samples), overrunSkips: this._overrunSkips };
    if (!this._track) {
      return { ...summary, available: false, reason: "no-camera", detail: null };
    }
    if (!this._gotAnySample && this._skippedDisabled) {
      return { ...summary, available: false, reason: "camera-off", detail: null };
    }
    if (this._loadError) {
      return { ...summary, available: false, reason: this._loadErrorReason || "model-load-failed", detail: this._loadError };
    }
    if (this._noFramesProduced) {
      return { ...summary, available: false, reason: "no-frames", detail: null };
    }
    if (!this._gotAnySample && !this._landmarkers) {
      return { ...summary, available: false, reason: "not-ready", detail: null };
    }
    if (!this._gotAnySample && this._runtimeError) {
      return { ...summary, available: false, reason: "inference-failed", detail: this._runtimeError };
    }
    if (!this._gotAnySample) {
      return { ...summary, available: false, reason: "no-samples", detail: null };
    }

    const attempted = this._samples.length + this._inferenceFailureCount;
    const inferenceFailureRatio = attempted > 0 ? this._inferenceFailureCount / attempted : 0;
    if (inferenceFailureRatio >= MATERIAL_INFERENCE_FAILURE_RATIO) {
      return {
        ...summary,
        reason: "inference-partially-failed",
        detail: `${this._inferenceFailureCount} of ${attempted} inference attempts failed${
          this._runtimeError ? `: ${this._runtimeError}` : ""
        }`,
        partiallyOff: this._skippedDisabled,
      };
    }

    return { ...summary, reason: null, detail: null, partiallyOff: this._skippedDisabled };
  }
}
