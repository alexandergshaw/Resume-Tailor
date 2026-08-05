// D2's on-device body-language MEASUREMENTS: yaw/pitch/roll from a facial
// transformation matrix, posture and gesture activity from pose landmarks,
// blendshape-based expressiveness magnitudes, and framing. Pure functions
// only -- no DOM, no MediaPipe import, no network -- so this module imports
// cleanly in the Node ("environment: node", no jsdom) test environment this
// repo's vitest config runs under, the same reason videoStats.js is split
// the same way. lib/copilot/bodyLandmarks.js owns the MediaPipe models, the
// offscreen video, and calls into this module with the plain landmark
// arrays/objects those models produce.
//
// This module MEASURES. It never labels an emotion, infers confidence, or
// characterises the person -- only what a camera can actually measure:
// where the head is pointed, how a body is positioned, whether hands moved,
// the magnitude of a couple of named facial-muscle movements, and framing.
// Turning these numbers into feedback copy is a later feature (D3), not
// this one.
//
// The house rule this whole module is held to (the same one videoStats.js
// and answerMetrics.js follow, and C3 established): a signal that was not
// measured is never reported as a finding. Every function below returns
// null -- never NaN, never a false/zero that could be misread as "measured
// and clear" -- when its inputs are missing, malformed, or below a named
// minimum sample count.

const RAD_TO_DEG = 180 / Math.PI;

// Normalized (0-1) image-space coordinate for dead-centre on either axis --
// shared by postureFrom's `lean` and framing's centering math.
const FRAME_CENTER = 0.5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// --- Head orientation -------------------------------------------------

// How close the r12 rotation entry (see headOrientation) can get to +-1
// before the yaw/roll extraction below would hit a divide-by-near-zero
// singularity (gimbal lock, at +-90 degrees of pitch -- looking straight up
// or down). A seated head-and-shoulders interview shot never legitimately
// reaches this; the guard exists so a bad detection can't produce a wild
// yaw/roll swing instead of a merely-degenerate one.
const PITCH_GIMBAL_LOCK_MARGIN = 1e-6;

// Extracts yaw (turning left/right), pitch (nodding up/down), and roll
// (tilting side to side), all in degrees, from a MediaPipe FaceLandmarker
// `facialTransformationMatrixes[0]` entry -- a flat, COLUMN-MAJOR 4x4 array
// (`matrix.data`, per MediaPipe's documented format: element at row r,
// column c lives at `data[c * 4 + r]`). The rotation sub-block is
// decomposed using the 'YXZ' Euler order (yaw about Y, then pitch about X,
// then roll about Z) -- the standard order for head/camera orientation
// (the same one, e.g., three.js's Euler 'YXZ' order uses), chosen because
// yaw and roll stay well-defined across the full range of realistic head
// turns and only degenerate at +-90 degrees of PITCH, which a webcam
// interview shot never reaches.
//
// Missing or malformed input (no matrix, wrong element count, non-finite
// entries) returns nulls for all three -- never NaN, so a bad detection can
// never be misread as "measured dead-center".
export function headOrientation(matrix) {
  const data = matrix && matrix.data;
  if (!data || typeof data.length !== "number" || data.length !== 16) {
    return { yaw: null, pitch: null, roll: null };
  }
  // Rotation sub-matrix entries this decomposition needs, read out of the
  // column-major flat array.
  const r00 = data[0];
  const r10 = data[1];
  const r20 = data[2];
  const r02 = data[8];
  const r11 = data[5];
  const r12 = data[9];
  const r22 = data[10];
  if (![r00, r10, r20, r02, r11, r12, r22].every(Number.isFinite)) {
    return { yaw: null, pitch: null, roll: null };
  }

  const pitchRad = Math.asin(clamp(-r12, -1, 1));
  let yawRad;
  let rollRad;
  if (Math.abs(r12) < 1 - PITCH_GIMBAL_LOCK_MARGIN) {
    yawRad = Math.atan2(r02, r22);
    rollRad = Math.atan2(r10, r11);
  } else {
    // Gimbal lock: yaw and roll can no longer be separated from one
    // another, so roll is reported as 0 rather than guessed.
    yawRad = Math.atan2(-r20, r00);
    rollRad = 0;
  }
  return {
    yaw: yawRad * RAD_TO_DEG,
    pitch: pitchRad * RAD_TO_DEG,
    roll: rollRad * RAD_TO_DEG,
  };
}

// Degrees. How far the head may yaw (turn left/right) from dead-centre and
// still read as oriented toward the camera.
export const LOOKING_YAW_TOLERANCE_DEG = 15;
// Degrees. Same idea for pitch (nodding up/down) -- a slightly tighter band
// than yaw, since a camera mounted above or below eye level is a smaller,
// more common offset than a full head turn.
export const LOOKING_PITCH_TOLERANCE_DEG = 12;

// Whether the HEAD is oriented toward the camera, within tolerance. This is
// a proxy built purely from head pose -- eyes can move independently of
// where the head is pointed, and this function has no way to see where the
// eyes themselves are looking. Callers, and any copy built on this value
// later (D3), must say "facing the camera" / "head oriented toward the
// camera" and must NEVER say "eye contact" or "looked at the camera" as if
// gaze itself had been verified -- a head-pose measurement is not a
// verified eye-contact measurement.
//
// Returns null (not measured, not a finding) when yaw or pitch themselves
// are null/non-finite -- never false, which would read as "measured and
// not looking".
export function isLookingAtCamera(yaw, pitch) {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return Math.abs(yaw) <= LOOKING_YAW_TOLERANCE_DEG && Math.abs(pitch) <= LOOKING_PITCH_TOLERANCE_DEG;
}

// --- Posture ------------------------------------------------------------

// BlazePose's 33-point topology (the model this feature's pose landmarker
// uses) numbers these landmarks -- see
// https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#models.
const POSE_NOSE = 0;
const POSE_LEFT_SHOULDER = 11;
const POSE_RIGHT_SHOULDER = 12;
const POSE_LEFT_WRIST = 15;
const POSE_RIGHT_WRIST = 16;

// 0-1 scale, MediaPipe's own per-landmark visibility score. Below this the
// model itself is saying it isn't confident the point is actually in frame
// (occluded, out of shot, or a low-confidence guess) -- treated the same as
// the landmark being absent rather than trusted as a real measurement.
export const MIN_LANDMARK_VISIBILITY = 0.5;

function landmarkOk(lm) {
  return (
    !!lm &&
    Number.isFinite(lm.x) &&
    Number.isFinite(lm.y) &&
    Number.isFinite(lm.visibility) &&
    lm.visibility >= MIN_LANDMARK_VISIBILITY
  );
}

// Normalized (0-1, fraction of frame width) shoulder-to-shoulder distance
// below which the shoulders are too close together on screen for
// distance-normalized math (slouch, gesture movement) to mean anything --
// either the subject is far from the camera or the detection is unreliable.
export const MIN_SHOULDER_WIDTH_NORM = 0.03;

// MediaPipe normalizes landmark x by frame WIDTH and y by frame HEIGHT
// independently, so a raw (dx, dy) pair only measures a true angle/distance
// when the frame is square -- on any other aspect ratio the same physical
// pose reads differently on a 4:3 webcam than a 16:9 one (BUG-5). Converts
// a normalized y-space delta into the SAME width-relative units x is
// already in (`dy * aspect`, where `aspect = frameHeight / frameWidth`, the
// same convention videoStats.js/bodyLandmarks.js already use), so
// atan2/hypot math combining x and y deltas is measuring real proportions
// rather than mixing units. Falls back to 1 (square) for a missing/invalid
// aspect rather than nulling the whole measurement -- the sampler always
// supplies a real one; this is just a safe, "never NaN" floor.
function toWidthRelativeY(dy, aspect) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return dy * safeAspect;
}

// Shoulder tilt (degrees off horizontal, 0 = level, +-90 range), lean
// (horizontal offset of the shoulder midpoint from frame centre, as a
// fraction of frame width), and a slouch proxy (vertical distance from the
// shoulder line to the nose, normalized by shoulder width so it reads the
// same regardless of how close the subject is sitting to the camera) -- all
// from one PoseLandmarker `landmarks[0]` array (normalized image-space
// x/y/visibility per point) plus the frame's aspect ratio (`frameHeight /
// frameWidth` -- see toWidthRelativeY above; the sampler always has this,
// so this function can't derive it itself from landmarks alone).
//
// Each signal is gated ONLY on the landmarks it actually needs (BUG-14):
// shoulderTilt/lean need just the two shoulders; slouch additionally needs
// the nose, and can be null on its own (tilt/lean still reported) either
// because the nose specifically is missing/low-visibility, OR because the
// shoulders are too close together on screen to normalize by (see
// MIN_SHOULDER_WIDTH_NORM) -- dividing by a near-zero width would produce a
// wild, meaningless number rather than an honest one. shoulderTilt/lean are
// null only when a SHOULDER landmark itself is absent/low-visibility.
export function postureFrom(poseLandmarks, aspect = 1) {
  const lm = Array.isArray(poseLandmarks) ? poseLandmarks : null;
  const nose = lm ? lm[POSE_NOSE] : null;
  const left = lm ? lm[POSE_LEFT_SHOULDER] : null;
  const right = lm ? lm[POSE_RIGHT_SHOULDER] : null;
  if (!landmarkOk(left) || !landmarkOk(right)) {
    return { shoulderTilt: null, lean: null, slouch: null };
  }

  const dx = right.x - left.x;
  const dyPhys = toWidthRelativeY(right.y - left.y, aspect);
  const shoulderWidth = Math.hypot(dx, dyPhys);
  // atan2(dyPhys, |dx|): 0 means level, regardless of which shoulder
  // landmark happens to have the larger x -- POSE_LEFT_SHOULDER is the
  // subject's own ANATOMICAL left, which sits on the RIGHT side of an
  // unmirrored camera frame (the replay/sampler deliberately does not
  // mirror -- see bodyLandmarks.js), so `dx` is normally NEGATIVE for a
  // person facing the camera; using |dx| here sidesteps that sign entirely
  // instead of landing near a +-180 branch cut (BUG-1). The remaining sign,
  // from dyPhys, means: POSITIVE = the shoulder on the LEFT SIDE OF THE
  // FRAME (in image terms, not the subject's own anatomical side, which is
  // mirrored relative to the frame) sits lower than the one on the right.
  const shoulderTilt = Math.atan2(dyPhys, Math.abs(dx)) * RAD_TO_DEG;
  const lean = (left.x + right.x) / 2 - FRAME_CENTER;
  const slouch =
    landmarkOk(nose) && shoulderWidth >= MIN_SHOULDER_WIDTH_NORM
      ? Math.abs(toWidthRelativeY((left.y + right.y) / 2 - nose.y, aspect)) / shoulderWidth
      : null;

  return { shoulderTilt, lean, slouch };
}

// Normalized wrist movement between two consecutive pose samples, and
// whether either hand was visible at all. `prevPose`/`curPose` are the same
// per-frame landmark arrays postureFrom takes; `aspect` is the same
// frame-aspect-ratio value (see toWidthRelativeY above) postureFrom takes,
// needed for the same reason (BUG-5): movement mixes x and y deltas via
// Math.hypot, so y has to be converted to width-relative units first or the
// same physical gesture measures differently on a different aspect ratio.
//
// Hands out of frame (or below the visibility threshold) is NOT zero
// gesturing -- it is unknown, and is reported as such: `handsVisible:
// false` with `movement: null`, never `movement: 0`. Movement is only
// computed for whichever wrist(s) were visible in BOTH samples, normalized
// by the CURRENT frame's shoulder width (same reasoning as postureFrom's
// slouch proxy) so it reads the same regardless of distance from the
// camera; if the shoulders themselves aren't visible/measurable, movement
// is null even though hands were seen, since there's nothing to normalize
// by.
export function gestureActivity(prevPose, curPose, aspect = 1) {
  const prev = Array.isArray(prevPose) ? prevPose : null;
  const cur = Array.isArray(curPose) ? curPose : null;
  if (!prev || !cur) {
    return { movement: null, handsVisible: null };
  }

  const prevLeft = prev[POSE_LEFT_WRIST];
  const prevRight = prev[POSE_RIGHT_WRIST];
  const curLeft = cur[POSE_LEFT_WRIST];
  const curRight = cur[POSE_RIGHT_WRIST];
  const leftVisible = landmarkOk(prevLeft) && landmarkOk(curLeft);
  const rightVisible = landmarkOk(prevRight) && landmarkOk(curRight);
  const handsVisible = leftVisible || rightVisible;
  if (!handsVisible) {
    return { movement: null, handsVisible: false };
  }

  const curLeftShoulder = cur[POSE_LEFT_SHOULDER];
  const curRightShoulder = cur[POSE_RIGHT_SHOULDER];
  const shoulderWidth =
    landmarkOk(curLeftShoulder) && landmarkOk(curRightShoulder)
      ? Math.hypot(
          curRightShoulder.x - curLeftShoulder.x,
          toWidthRelativeY(curRightShoulder.y - curLeftShoulder.y, aspect),
        )
      : null;
  if (!shoulderWidth || shoulderWidth < MIN_SHOULDER_WIDTH_NORM) {
    return { movement: null, handsVisible: true };
  }

  let sum = 0;
  let count = 0;
  if (leftVisible) {
    sum += Math.hypot(curLeft.x - prevLeft.x, toWidthRelativeY(curLeft.y - prevLeft.y, aspect));
    count += 1;
  }
  if (rightVisible) {
    sum += Math.hypot(curRight.x - prevRight.x, toWidthRelativeY(curRight.y - prevRight.y, aspect));
    count += 1;
  }
  return { movement: sum / count / shoulderWidth, handsVisible: true };
}

// --- Expressiveness -------------------------------------------------------

// Named ARKit-style blendshape categories (MediaPipe's face blendshape
// model uses the same 52-category set) this function reads -- a small,
// DELIBERATELY chosen set. Both are reported as raw model scores (0-1
// magnitudes), never an emotion label: a high "smile" score means the
// mouth-corner-raise blendshapes fired, not that the person felt happy.
const SMILE_CATEGORIES = ["mouthSmileLeft", "mouthSmileRight"];
const BROW_CATEGORIES = ["browInnerUp", "browOuterUpLeft", "browOuterUpRight"];

function categoryScore(categories, name) {
  const hit = categories.find((c) => c && c.categoryName === name);
  return hit && Number.isFinite(hit.score) ? hit.score : null;
}

// `blendshapes` is a plain array of `{ categoryName, score }` entries --
// i.e. a MediaPipe FaceLandmarkerResult's `faceBlendshapes[0].categories`,
// already unwrapped by the caller so this stays a plain-array-in function
// like the rest of this module. Missing categories are excluded from their
// average rather than treated as 0 -- a category the model didn't report
// was not measured, and averaging it in as zero would understate real
// expressiveness whenever that happens to occur.
//
// Returns null for a magnitude with no measured categories to average, and
// `{ smile: null, browMovement: null }` outright for missing/empty input.
export function expressiveness(blendshapes) {
  const categories = Array.isArray(blendshapes) ? blendshapes : null;
  if (!categories || categories.length === 0) {
    return { smile: null, browMovement: null };
  }
  const smileScores = SMILE_CATEGORIES.map((n) => categoryScore(categories, n)).filter(Number.isFinite);
  const browScores = BROW_CATEGORIES.map((n) => categoryScore(categories, n)).filter(Number.isFinite);
  return {
    smile: smileScores.length ? average(smileScores) : null,
    browMovement: browScores.length ? average(browScores) : null,
  };
}

// --- Framing --------------------------------------------------------------

// Fraction of frame width/height, on either axis, the face's centre may sit
// from dead-centre and still read as "centred" -- wide enough not to flag
// normal head movement while talking, tight enough to catch someone sitting
// well off to one side.
export const FRAME_CENTER_COMFORTABLE_RADIUS = 0.18;
// Fraction of frame AREA the face's bounding box may cover. Below this the
// subject reads as too far from the camera to be a usable head-and-
// shoulders shot.
export const FACE_FILL_MIN = 0.04;
// Above this fraction of frame area, the face is close to filling the
// frame -- reads as sitting too close to the camera.
export const FACE_FILL_MAX = 0.5;

// How centred the face is and how much of the frame it fills, from a
// `faceBox` of `{ minX, minY, maxX, maxY }` (normalized 0-1 image-space
// coordinates -- the caller derives this from face landmarks; this function
// only does the box math). Malformed/missing/degenerate input (no box, or a
// box with zero or negative width/height) returns nulls for every field --
// never a default "centred"/"fine" reading.
export function framing(faceBox) {
  const box =
    faceBox &&
    Number.isFinite(faceBox.minX) &&
    Number.isFinite(faceBox.minY) &&
    Number.isFinite(faceBox.maxX) &&
    Number.isFinite(faceBox.maxY) &&
    faceBox.maxX > faceBox.minX &&
    faceBox.maxY > faceBox.minY
      ? faceBox
      : null;
  if (!box) {
    return { centered: null, offsetX: null, offsetY: null, fill: null, tooClose: null, tooFar: null };
  }

  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const offsetX = box.minX + width / 2 - FRAME_CENTER;
  const offsetY = box.minY + height / 2 - FRAME_CENTER;
  const centered =
    Math.abs(offsetX) <= FRAME_CENTER_COMFORTABLE_RADIUS && Math.abs(offsetY) <= FRAME_CENTER_COMFORTABLE_RADIUS;
  const fill = width * height;

  return {
    centered,
    offsetX,
    offsetY,
    fill,
    tooClose: fill > FACE_FILL_MAX,
    tooFar: fill < FACE_FILL_MIN,
  };
}

// --- Summary ---------------------------------------------------------------

// Minimum face-detected samples before any face-derived aggregate (eye
// contact, head steadiness, expressiveness, framing) is allowed to report a
// value instead of null -- mirrors videoStats.MIN_LUMA_SAMPLES's reasoning:
// one or two frames are one bad detection away from a false read, not
// enough to assert anything from.
export const MIN_FACE_SAMPLES = 3;
// Minimum pose-detected samples before posture aggregates (shoulder tilt,
// lean, slouch) report a value instead of null.
export const MIN_POSE_SAMPLES = 3;
// Minimum gesture comparisons (consecutive-sample pairs with a measurable
// result) before gesture rate / hands-visible ratio report a value instead
// of null -- one comparison is a single movement, not a rate.
export const MIN_GESTURE_SAMPLES = 3;

// Minimum fraction of ALL sampled ticks in the answer (`frames` below) that
// must have produced a given signal before that signal's aggregate is
// trusted -- independent of, and in ADDITION to, the absolute MIN_*_SAMPLES
// floors above (BUG-2). A face detected in 4 of 300 sampled ticks clears
// MIN_FACE_SAMPLES (3) easily, and "looking at the camera in 3 of those 4"
// is an honest ratio ON ITS OWN -- but rendering it as "facing the camera
// 75% of the time" is not, because the other 296 ticks measured nothing at
// all. Below this ratio, the aggregate is null (its sample count is still
// reported) rather than a percentage that quietly means "of the few times
// we happened to measure" instead of "of the answer".
export const MIN_COVERAGE_RATIO = 0.5;

// Reduces one numeric field across `samples`, counting only entries where
// the field is a finite number -- a null field means "not measured this
// tick", not "measured as zero", so it is skipped rather than averaged in.
// Returns `{ value, samples }`; value is null below `min`.
function reduceNumeric(samples, key, min) {
  const values = [];
  for (const s of samples) {
    const v = s[key];
    if (Number.isFinite(v)) values.push(v);
  }
  return { value: values.length >= min ? average(values) : null, samples: values.length };
}

// Same idea for a boolean field, reduced to the TRUE ratio (0-1).
function reduceRatio(samples, key, min) {
  const values = [];
  for (const s of samples) {
    const v = s[key];
    if (v === true || v === false) values.push(v);
  }
  return {
    value: values.length >= min ? values.filter(Boolean).length / values.length : null,
    samples: values.length,
  };
}

// Average magnitude of frame-to-frame head-orientation change (|dyaw| +
// |dpitch|, in degrees) between GENUINELY CONSECUTIVE face-detected samples.
// Array adjacency alone is NOT time adjacency: two face-detected samples can
// sit next to each other in the (already-filtered-to-faces-only) array while
// being separated by seconds of camera-off or face-lost time in between, and
// diffing across that gap would manufacture head movement that never
// happened (BUG-6). Each sample carries a `tick` -- an integer that
// increments once per sampler interval firing, regardless of outcome (see
// bodyLandmarks.js's _sample) -- and two samples only count as consecutive
// when `cur.tick - prev.tick === 1`, mirroring how the pose/gesture path
// already resets its previous-landmarks reference across any kind of break.
// Despite living in the `headSteadiness` field, this is a plain measured
// motion magnitude in degrees, NOT a 0-1 "steadiness score" -- lower means a
// stiller head.
function headOrientationDeltas(faceSamples) {
  const deltas = [];
  for (let i = 1; i < faceSamples.length; i += 1) {
    const prev = faceSamples[i - 1];
    const cur = faceSamples[i];
    if (
      Number.isFinite(prev.tick) &&
      Number.isFinite(cur.tick) &&
      cur.tick - prev.tick === 1 &&
      Number.isFinite(prev.yaw) &&
      Number.isFinite(prev.pitch) &&
      Number.isFinite(cur.yaw) &&
      Number.isFinite(cur.pitch)
    ) {
      deltas.push(Math.abs(cur.yaw - prev.yaw) + Math.abs(cur.pitch - prev.pitch));
    }
  }
  return deltas;
}

// A fresh object every call (BUG-13) -- an earlier version returned one
// shared module-level constant here, which meant its NESTED objects
// (`expressiveness`, `framing`) were the exact same reference across every
// answer with no data; a downstream mutation of one would have silently
// corrupted every other "empty" result sharing it, past or future.
function emptySummary() {
  return {
    available: false,
    frames: 0,
    faceFrames: 0,
    poseFrames: 0,
    eyeContactRatio: null,
    eyeContactSamples: 0,
    headSteadiness: null,
    headSteadinessSamples: 0,
    shoulderTilt: null,
    lean: null,
    postureSamples: 0,
    slouch: null,
    slouchSamples: 0,
    gestureRate: null,
    gestureSamples: 0,
    handsVisibleRatio: null,
    handsVisibleSamples: 0,
    expressiveness: { smile: null, smileSamples: 0, browMovement: null, browMovementSamples: 0 },
    framing: { centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null, samples: 0 },
  };
}

// Re-nulls a `{ value, samples }` pair (from reduceNumeric/reduceRatio, or
// the hand-built equivalent for headSteadiness) when fewer than
// MIN_COVERAGE_RATIO of ALL sampled ticks produced it -- see
// MIN_COVERAGE_RATIO's comment. The `samples` count is always kept as-is,
// so callers can still see exactly how much (or little) this was measured
// from even when `value` reads null.
function gateByCoverage(reduced, frames) {
  const coverage = frames > 0 ? reduced.samples / frames : 0;
  return coverage >= MIN_COVERAGE_RATIO ? reduced : { value: null, samples: reduced.samples };
}

// Reduces a whole answer's worth of per-tick samples (each already the
// plain-object output of the functions above, plus a `tick` -- see
// lib/copilot/bodyLandmarks.js for the exact per-tick shape) to the
// honestly-gated aggregates AnswerReview consumes. Empty input returns
// `available: false` with every aggregate null and every count 0 -- never
// NaN. `available: true` means the sampler actually ran inference for at
// least one tick; individual aggregates can still be null on top of that
// when a face/pose was never actually found often enough, EITHER in
// absolute count (MIN_*_SAMPLES) or as a share of the whole answer
// (MIN_COVERAGE_RATIO) -- that is a distinct, honest state from the sampler
// never having run at all (see BodyLanguageSampler.stop()'s `reason`).
export function summarizeBodyLanguage(samples) {
  const list = Array.isArray(samples) ? samples.filter(Boolean) : [];
  const frames = list.length;
  if (frames === 0) return emptySummary();

  const faceSamples = list.filter((s) => s.faceDetected);
  const poseSamples = list.filter((s) => s.poseDetected);

  const eyeContact = gateByCoverage(reduceRatio(faceSamples, "lookingAtCamera", MIN_FACE_SAMPLES), frames);
  const headDeltas = headOrientationDeltas(faceSamples);
  const headSteadiness = gateByCoverage(
    { value: headDeltas.length >= MIN_FACE_SAMPLES ? average(headDeltas) : null, samples: headDeltas.length },
    frames,
  );

  const shoulderTilt = gateByCoverage(reduceNumeric(poseSamples, "shoulderTilt", MIN_POSE_SAMPLES), frames);
  const lean = gateByCoverage(reduceNumeric(poseSamples, "lean", MIN_POSE_SAMPLES), frames);
  const slouch = gateByCoverage(reduceNumeric(poseSamples, "slouch", MIN_POSE_SAMPLES), frames);

  const gesture = gateByCoverage(reduceNumeric(list, "gestureMovement", MIN_GESTURE_SAMPLES), frames);
  const handsVisible = gateByCoverage(reduceRatio(list, "handsVisible", MIN_GESTURE_SAMPLES), frames);

  const smile = gateByCoverage(reduceNumeric(faceSamples, "smile", MIN_FACE_SAMPLES), frames);
  const brow = gateByCoverage(reduceNumeric(faceSamples, "browMovement", MIN_FACE_SAMPLES), frames);

  const fill = gateByCoverage(reduceNumeric(faceSamples, "faceFill", MIN_FACE_SAMPLES), frames);
  const centered = gateByCoverage(reduceRatio(faceSamples, "faceCentered", MIN_FACE_SAMPLES), frames);
  const tooClose = gateByCoverage(reduceRatio(faceSamples, "faceTooClose", MIN_FACE_SAMPLES), frames);
  const tooFar = gateByCoverage(reduceRatio(faceSamples, "faceTooFar", MIN_FACE_SAMPLES), frames);

  return {
    available: true,
    frames,
    faceFrames: faceSamples.length,
    poseFrames: poseSamples.length,
    eyeContactRatio: eyeContact.value,
    eyeContactSamples: eyeContact.samples,
    headSteadiness: headSteadiness.value,
    headSteadinessSamples: headSteadiness.samples,
    shoulderTilt: shoulderTilt.value,
    lean: lean.value,
    postureSamples: shoulderTilt.samples,
    slouch: slouch.value,
    slouchSamples: slouch.samples,
    gestureRate: gesture.value,
    gestureSamples: gesture.samples,
    handsVisibleRatio: handsVisible.value,
    handsVisibleSamples: handsVisible.samples,
    expressiveness: {
      smile: smile.value,
      smileSamples: smile.samples,
      browMovement: brow.value,
      browMovementSamples: brow.samples,
    },
    framing: {
      centeredRatio: centered.value,
      fill: fill.value,
      tooCloseRatio: tooClose.value,
      tooFarRatio: tooFar.value,
      samples: fill.samples,
    },
  };
}
