import { describe, it, expect } from "vitest";
import {
  headOrientation,
  isLookingAtCamera,
  LOOKING_YAW_TOLERANCE_DEG,
  LOOKING_PITCH_TOLERANCE_DEG,
  postureFrom,
  MIN_LANDMARK_VISIBILITY,
  gestureActivity,
  MIN_SHOULDER_WIDTH_NORM,
  expressiveness,
  framing,
  FRAME_CENTER_COMFORTABLE_RADIUS,
  FACE_FILL_MIN,
  FACE_FILL_MAX,
  MIN_POSE_SAMPLES,
  MIN_COVERAGE_RATIO,
  summarizeBodyLanguage,
} from "./bodyLanguage";

const DEG_TO_RAD = Math.PI / 180;

// Builds the flat, COLUMN-MAJOR 4x4 array headOrientation expects
// (data[c*4+r] holds row r, column c) from a raw 3x3 rotation matrix given
// as [[row0], [row1], [row2]] -- keeps the test data entry below in the same
// row-by-row shape the hand-derived matrices are easiest to check by eye,
// while still exercising the real column-major layout the source reads.
function toColumnMajorData(rows) {
  const data = new Array(16).fill(0);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      data[c * 4 + r] = rows[r][c];
    }
  }
  data[15] = 1;
  return data;
}

describe("headOrientation", () => {
  it("reads a pure yaw (turn) rotation as yaw only, pitch and roll at zero", () => {
    // Standard rotation-about-Y matrix for yaw = 30 degrees.
    const cosY = Math.cos(30 * DEG_TO_RAD);
    const sinY = Math.sin(30 * DEG_TO_RAD);
    const matrix = {
      data: toColumnMajorData([
        [cosY, 0, sinY],
        [0, 1, 0],
        [-sinY, 0, cosY],
      ]),
    };
    const { yaw, pitch, roll } = headOrientation(matrix);
    expect(yaw).toBeCloseTo(30, 6);
    expect(pitch).toBeCloseTo(0, 6);
    expect(roll).toBeCloseTo(0, 6);
  });

  it("reads a pure pitch (nod) rotation as pitch only, yaw and roll at zero", () => {
    // Standard rotation-about-X matrix for pitch = 15 degrees.
    const cosP = Math.cos(15 * DEG_TO_RAD);
    const sinP = Math.sin(15 * DEG_TO_RAD);
    const matrix = {
      data: toColumnMajorData([
        [1, 0, 0],
        [0, cosP, -sinP],
        [0, sinP, cosP],
      ]),
    };
    const { yaw, pitch, roll } = headOrientation(matrix);
    expect(yaw).toBeCloseTo(0, 6);
    expect(pitch).toBeCloseTo(15, 6);
    expect(roll).toBeCloseTo(0, 6);
  });

  it("reads a pure roll (tilt) rotation as roll only, yaw and pitch at zero", () => {
    // Standard rotation-about-Z matrix for roll = 20 degrees.
    const cosR = Math.cos(20 * DEG_TO_RAD);
    const sinR = Math.sin(20 * DEG_TO_RAD);
    const matrix = {
      data: toColumnMajorData([
        [cosR, -sinR, 0],
        [sinR, cosR, 0],
        [0, 0, 1],
      ]),
    };
    const { yaw, pitch, roll } = headOrientation(matrix);
    expect(yaw).toBeCloseTo(0, 6);
    expect(pitch).toBeCloseTo(0, 6);
    expect(roll).toBeCloseTo(20, 6);
  });

  it("keeps yaw and pitch distinct on a combined rotation, ruling out a transposed (row/col swapped) read", () => {
    // yaw=30, pitch=60, roll=0, composed as Ry(yaw) * Rx(pitch) (YXZ order
    // with roll folded out). Hand-derived rows below, cross-checked to be
    // orthonormal (each row's squared length sums to 1) before use. Because
    // yaw (30) and pitch (60) are different values, a bug that reads the
    // matrix transposed -- which swaps which entries feed yaw vs pitch --
    // would report (60, 30) or some other wrong pair here instead of
    // silently passing the way it would if yaw and pitch happened to match.
    const matrix = {
      data: toColumnMajorData([
        [0.8660254, 0.4330127, 0.25],
        [0, 0.5, -0.8660254],
        [-0.5, 0.75, 0.4330127],
      ]),
    };
    const { yaw, pitch, roll } = headOrientation(matrix);
    expect(yaw).toBeCloseTo(30, 4);
    expect(pitch).toBeCloseTo(60, 4);
    expect(roll).toBeCloseTo(0, 4);
  });

  it("falls back to the gimbal-lock branch at pitch = 90 degrees, still recovering the combined yaw and forcing roll to exactly 0", () => {
    // yaw=40, roll=25, pitch=90 -- at this exact pitch, yaw and roll can no
    // longer be told apart from the matrix alone (only their difference,
    // yaw - roll = 15, survives), so the source reports that difference as
    // yaw and roll as 0 rather than guessing. Rows hand-derived from the
    // YXZ composition at sin(pitch)=1, cos(pitch)=0.
    const matrix = {
      data: toColumnMajorData([
        [0.9659258263, 0.2588190451, 0],
        [0, 0, -1],
        [-0.2588190451, 0.9659258263, 0],
      ]),
    };
    const { yaw, pitch, roll } = headOrientation(matrix);
    expect(pitch).toBeCloseTo(90, 4);
    expect(yaw).toBeCloseTo(15, 4);
    expect(roll).toBe(0);
  });

  it("returns nulls, never NaN, when the matrix is missing entirely", () => {
    expect(headOrientation(null)).toEqual({ yaw: null, pitch: null, roll: null });
    expect(headOrientation(undefined)).toEqual({ yaw: null, pitch: null, roll: null });
  });

  it("returns nulls, never NaN, when the matrix object has no data field", () => {
    expect(headOrientation({})).toEqual({ yaw: null, pitch: null, roll: null });
  });

  it("returns nulls, never NaN, for a data array of the wrong length", () => {
    expect(headOrientation({ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })).toEqual({
      yaw: null,
      pitch: null,
      roll: null,
    });
    expect(headOrientation({ data: [] })).toEqual({ yaw: null, pitch: null, roll: null });
  });

  it("returns nulls, never NaN, when a required entry is non-numeric despite the array having 16 elements", () => {
    // Identity matrix's data, but with one of the seven rotation entries the
    // function actually reads (index 9 -> r12) replaced by a non-number.
    const data = [1, 0, 0, 0, 0, 1, 0, 0, 0, "not-a-number", 1, 0, 0, 0, 0, 1];
    const result = headOrientation({ data });
    expect(result).toEqual({ yaw: null, pitch: null, roll: null });
    expect(Number.isNaN(result.yaw)).toBe(false);
  });

  it("returns nulls, never NaN, when a required entry is NaN despite the array having 16 elements", () => {
    // Index 2 -> r20, one of the seven rotation entries the function reads.
    const data = [1, 0, NaN, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const result = headOrientation({ data });
    expect(result).toEqual({ yaw: null, pitch: null, roll: null });
  });

  it("returns nulls, never NaN, for a string data value that happens to have length 16", () => {
    // `.length === 16` alone would let this slip past the array-length
    // guard; each character then fails the Number.isFinite check.
    const result = headOrientation({ data: "0123456789abcdef" });
    expect(result).toEqual({ yaw: null, pitch: null, roll: null });
  });
});

describe("isLookingAtCamera", () => {
  it("returns true dead-centre (yaw 0, pitch 0)", () => {
    expect(isLookingAtCamera(0, 0)).toBe(true);
  });

  it("returns true exactly at the yaw tolerance boundary, on both sides", () => {
    expect(isLookingAtCamera(LOOKING_YAW_TOLERANCE_DEG, 0)).toBe(true);
    expect(isLookingAtCamera(-LOOKING_YAW_TOLERANCE_DEG, 0)).toBe(true);
  });

  it("returns false just past the yaw tolerance boundary, on both sides", () => {
    expect(isLookingAtCamera(LOOKING_YAW_TOLERANCE_DEG + 0.1, 0)).toBe(false);
    expect(isLookingAtCamera(-(LOOKING_YAW_TOLERANCE_DEG + 0.1), 0)).toBe(false);
  });

  it("returns true exactly at the pitch tolerance boundary, on both sides", () => {
    expect(isLookingAtCamera(0, LOOKING_PITCH_TOLERANCE_DEG)).toBe(true);
    expect(isLookingAtCamera(0, -LOOKING_PITCH_TOLERANCE_DEG)).toBe(true);
  });

  it("returns false just past the pitch tolerance boundary, on both sides", () => {
    expect(isLookingAtCamera(0, LOOKING_PITCH_TOLERANCE_DEG + 0.1)).toBe(false);
    expect(isLookingAtCamera(0, -(LOOKING_PITCH_TOLERANCE_DEG + 0.1))).toBe(false);
  });

  it("applies the wider yaw tolerance to yaw, not the tighter pitch tolerance", () => {
    // 13 degrees clears the yaw tolerance (15) but would fail if the
    // tighter pitch tolerance (12) were wrongly applied to yaw instead.
    expect(isLookingAtCamera(13, 0)).toBe(true);
  });

  it("applies the tighter pitch tolerance to pitch, not the wider yaw tolerance", () => {
    // 13 degrees exceeds the pitch tolerance (12) but would wrongly pass if
    // the wider yaw tolerance (15) were applied to pitch instead.
    expect(isLookingAtCamera(0, 13)).toBe(false);
  });

  it("returns null, not false, when yaw is null", () => {
    expect(isLookingAtCamera(null, 0)).toBeNull();
  });

  it("returns null, not false, when pitch is null", () => {
    expect(isLookingAtCamera(0, null)).toBeNull();
  });

  it("returns null, not false, when both yaw and pitch are null", () => {
    expect(isLookingAtCamera(null, null)).toBeNull();
  });

  it("returns null, not false, when yaw or pitch is NaN or undefined", () => {
    expect(isLookingAtCamera(NaN, 0)).toBeNull();
    expect(isLookingAtCamera(0, NaN)).toBeNull();
    expect(isLookingAtCamera(undefined, undefined)).toBeNull();
  });
});

// --- postureFrom -----------------------------------------------------------

// bodyLanguage.js doesn't export its BlazePose landmark-index constant for
// the nose either -- mirrored here the same way LEFT_SHOULDER/RIGHT_SHOULDER
// are below, for gestureActivity.
const NOSE = 0;

// Builds a sparse pose-landmarks array with only nose/shoulders populated --
// the only three indices postureFrom reads. `point` (below) is reused, since
// it's the same `{ x, y, visibility }` shape postureFrom's landmarks are.
function makePosturePose({ nose, left, right } = {}) {
  const pose = [];
  pose[NOSE] = nose;
  pose[LEFT_SHOULDER] = left;
  pose[RIGHT_SHOULDER] = right;
  return pose;
}

describe("postureFrom", () => {
  it("computes tilt, lean, and slouch for a clean, fully-visible pose (happy path)", () => {
    const landmarks = makePosturePose({
      nose: point(0.55, 0.25),
      left: point(0.7, 0.55), // landmark 11 (POSE_LEFT_SHOULDER) -- anatomical left
      right: point(0.4, 0.5), // landmark 12 (POSE_RIGHT_SHOULDER)
    });
    const result = postureFrom(landmarks, 1);
    expect(result.shoulderTilt).toBeCloseTo(-9.462322, 5);
    expect(result.lean).toBeCloseTo(0.05, 9); // (0.7 + 0.4) / 2 - 0.5
    expect(result.slouch).toBeCloseTo(0.904194, 5);
  });

  it("reports a tilt near 0, not near 180, for perfectly level shoulders built unmirrored (regression guard)", () => {
    // Unmirrored, matching the real sampler (see bodyLandmarks.js): landmark
    // 11 (POSE_LEFT_SHOULDER, the subject's own anatomical left) sits at the
    // LARGER image x, which makes dx = right.x - left.x NEGATIVE -- exactly
    // the condition that, without an |dx| fix, would land atan2 on the
    // +-180 branch cut instead of reading level.
    const landmarks = makePosturePose({
      left: point(0.6, 0.5), // landmark 11, larger x
      right: point(0.4, 0.5), // landmark 12, smaller x
    });
    const result = postureFrom(landmarks, 1);
    expect(result.shoulderTilt).toBeCloseTo(0, 10);
    expect(Math.abs(result.shoulderTilt)).toBeLessThan(1);
  });

  it("gives equal-magnitude, opposite-sign tilt when the lower shoulder swaps sides, matching the documented sign convention", () => {
    // Case A: landmark 12 (POSE_RIGHT_SHOULDER, smaller x = LEFT SIDE OF THE
    // FRAME) sits lower (larger y) than landmark 11. Per the documented
    // convention, positive tilt means the shoulder on the left side of the
    // FRAME sits lower -- this must come out positive.
    const caseA = postureFrom(makePosturePose({ left: point(0.6, 0.5), right: point(0.4, 0.6) }), 1);
    // Case B: the same vertical offset, but now landmark 11 (larger x =
    // RIGHT SIDE OF THE FRAME) is the one that's lower -- must be negative,
    // the same magnitude as case A.
    const caseB = postureFrom(makePosturePose({ left: point(0.6, 0.6), right: point(0.4, 0.5) }), 1);

    expect(caseA.shoulderTilt).toBeCloseTo(26.565051, 5);
    expect(caseB.shoulderTilt).toBeCloseTo(-26.565051, 5);
    expect(caseA.shoulderTilt).toBeCloseTo(-caseB.shoulderTilt, 8);
  });

  it("keeps slouch and tilt unchanged when the whole pose is scaled toward frame-centre, simulating the same pose farther from the camera", () => {
    const base = postureFrom(
      makePosturePose({ nose: point(0.5, 0.25), left: point(0.62, 0.53), right: point(0.38, 0.5) }),
      1,
    );
    // Every landmark's offset from frame-centre (0.5, 0.5) halved -- the
    // shoulders end up half as far apart on screen, as if the subject sat
    // twice as far from the camera, with the pose itself unchanged.
    const scaled = postureFrom(
      makePosturePose({ nose: point(0.5, 0.375), left: point(0.56, 0.515), right: point(0.44, 0.5) }),
      1,
    );

    expect(base.slouch).toBeCloseTo(1.09564, 4);
    expect(scaled.slouch).toBeCloseTo(base.slouch, 8);
    expect(scaled.shoulderTilt).toBeCloseTo(base.shoulderTilt, 8);
  });

  it("measures the same shoulder tilt and slouch for the same physical pose on a 4:3 frame and a 16:9 frame", () => {
    // Same real-world geometry (shoulders 80 units apart in x, offset 16
    // units in y; nose 40 units above the shoulder line) rendered at two
    // different resolutions/aspects. MediaPipe normalizes x by frame width
    // and y by frame height independently, so the RAW normalized deltas
    // differ between the two frames -- only after toWidthRelativeY's aspect
    // correction do tilt/slouch land on the same value.
    const frameA = postureFrom(
      makePosturePose({
        nose: point(0.55, 0.4333333333333333),
        left: point(0.625, 0.5333333333333333),
        right: point(0.5, 0.5),
      }),
      480 / 640, // 4:3
    );
    const frameB = postureFrom(
      makePosturePose({
        nose: point(0.55, 0.44074074074074077),
        left: point(0.5833333333333334, 0.5296296296296297),
        right: point(0.5, 0.5),
      }),
      540 / 960, // 16:9
    );

    expect(frameA.shoulderTilt).toBeCloseTo(-11.309932, 5);
    expect(frameB.shoulderTilt).toBeCloseTo(-11.309932, 5);
    expect(frameA.slouch).toBeCloseTo(0.49029, 5);
    expect(frameB.slouch).toBeCloseTo(0.49029, 5);
  });

  it("nulls only slouch, not shoulderTilt or lean, when the nose is below the visibility threshold", () => {
    const landmarks = makePosturePose({
      nose: point(0.5, 0.3, MIN_LANDMARK_VISIBILITY - 0.1),
      left: point(0.6, 0.5),
      right: point(0.4, 0.5),
    });
    const result = postureFrom(landmarks, 1);
    expect(result.shoulderTilt).toBeCloseTo(0, 10);
    expect(result.lean).toBeCloseTo(0, 10);
    expect(result.slouch).toBeNull();
  });

  it("nulls only slouch, not shoulderTilt or lean, when the nose landmark is missing entirely", () => {
    const landmarks = makePosturePose({ left: point(0.6, 0.5), right: point(0.4, 0.5) }); // nose omitted
    const result = postureFrom(landmarks, 1);
    expect(result.shoulderTilt).toBeCloseTo(0, 10);
    expect(result.lean).toBeCloseTo(0, 10);
    expect(result.slouch).toBeNull();
  });

  it("nulls slouch, but not shoulderTilt or lean, when the shoulders are too close together to normalize by", () => {
    expect(MIN_SHOULDER_WIDTH_NORM).toBe(0.03);
    const landmarks = makePosturePose({
      nose: point(0.5005, 0.3),
      left: point(0.5, 0.5),
      right: point(0.501, 0.5), // width 0.001, well under MIN_SHOULDER_WIDTH_NORM
    });
    const result = postureFrom(landmarks, 1);
    expect(result.shoulderTilt).toBeCloseTo(0, 10);
    expect(result.lean).toBeCloseTo(0.0005, 10);
    expect(result.slouch).toBeNull();
  });

  it("returns nulls for every field when poseLandmarks is not an array", () => {
    const expected = { shoulderTilt: null, lean: null, slouch: null };
    expect(postureFrom(undefined, 1)).toEqual(expected);
    expect(postureFrom(null, 1)).toEqual(expected);
    expect(postureFrom({}, 1)).toEqual(expected);
  });

  it("returns nulls for every field for an empty landmarks array", () => {
    expect(postureFrom([], 1)).toEqual({ shoulderTilt: null, lean: null, slouch: null });
  });

  it("returns nulls for every field when the left shoulder is below the visibility threshold", () => {
    const landmarks = makePosturePose({
      nose: point(0.5, 0.3),
      left: point(0.6, 0.5, MIN_LANDMARK_VISIBILITY - 0.01),
      right: point(0.4, 0.5),
    });
    expect(postureFrom(landmarks, 1)).toEqual({ shoulderTilt: null, lean: null, slouch: null });
  });

  it("returns nulls for every field when the right shoulder is below the visibility threshold", () => {
    const landmarks = makePosturePose({
      nose: point(0.5, 0.3),
      left: point(0.6, 0.5),
      right: point(0.4, 0.5, MIN_LANDMARK_VISIBILITY - 0.01),
    });
    expect(postureFrom(landmarks, 1)).toEqual({ shoulderTilt: null, lean: null, slouch: null });
  });

  it("returns nulls for every field when a shoulder coordinate is non-finite (NaN)", () => {
    const landmarks = makePosturePose({
      nose: point(0.5, 0.3),
      left: point(NaN, 0.5),
      right: point(0.4, 0.5),
    });
    expect(postureFrom(landmarks, 1)).toEqual({ shoulderTilt: null, lean: null, slouch: null });
  });

  it("treats a shoulder visibility exactly at MIN_LANDMARK_VISIBILITY as visible (inclusive boundary)", () => {
    const landmarks = makePosturePose({
      nose: point(0.5, 0.3),
      left: point(0.6, 0.5, MIN_LANDMARK_VISIBILITY),
      right: point(0.4, 0.5, MIN_LANDMARK_VISIBILITY),
    });
    const result = postureFrom(landmarks, 1);
    expect(result.shoulderTilt).not.toBeNull();
    expect(result.shoulderTilt).toBeCloseTo(0, 10);
  });
});

// --- gestureActivity ---------------------------------------------------

// bodyLanguage.js doesn't export its BlazePose landmark-index constants
// (POSE_LEFT_SHOULDER etc.) -- mirrored here as plain numbers the same way
// this file already mirrors DEG_TO_RAD-style helpers above, and the same way
// videoStats.test.js mirrors that module's private constants.
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

function point(x, y, visibility = 1) {
  return { x, y, visibility };
}

// Builds a sparse pose-landmarks array with only the indices gestureActivity
// actually reads populated -- everything else stays a real "hole" (undefined
// via a plain [] literal), matching what a partial MediaPipe detection looks
// like.
function makePose({ leftShoulder, rightShoulder, leftWrist, rightWrist } = {}) {
  const pose = [];
  pose[LEFT_SHOULDER] = leftShoulder;
  pose[RIGHT_SHOULDER] = rightShoulder;
  pose[LEFT_WRIST] = leftWrist;
  pose[RIGHT_WRIST] = rightWrist;
  return pose;
}

describe("gestureActivity", () => {
  it("normalizes movement by shoulder width so the same physical gesture reads the same near and far from the camera", () => {
    // "Near" the camera: wide-set shoulders, a correspondingly large raw
    // wrist displacement. "Far": shoulders and wrist displacement both
    // scaled down by the same factor (0.5) -- the same physical arm swing,
    // just smaller on screen. Only the left wrist moves in either case so
    // the movement math isn't also averaging in a second reading.
    const near = gestureActivity(
      makePose({
        leftShoulder: point(0.3, 0.5),
        rightShoulder: point(0.7, 0.5),
        leftWrist: point(0.5, 0.5),
      }),
      makePose({
        leftShoulder: point(0.3, 0.5),
        rightShoulder: point(0.7, 0.5),
        leftWrist: point(0.54, 0.5),
      }),
    );
    const far = gestureActivity(
      makePose({
        leftShoulder: point(0.4, 0.5),
        rightShoulder: point(0.6, 0.5),
        leftWrist: point(0.5, 0.5),
      }),
      makePose({
        leftShoulder: point(0.4, 0.5),
        rightShoulder: point(0.6, 0.5),
        leftWrist: point(0.52, 0.5),
      }),
    );

    expect(near.handsVisible).toBe(true);
    expect(far.handsVisible).toBe(true);
    // Raw displacement (0.04 vs 0.02) and raw shoulder width (0.4 vs 0.2)
    // differ by exactly the scale factor, so the normalized reading must
    // land on the same value for both -- this is the whole point of
    // dividing by shoulder width.
    expect(near.movement).toBeCloseTo(0.1, 9);
    expect(far.movement).toBeCloseTo(0.1, 9);
    expect(far.movement).toBeCloseTo(near.movement, 9);
  });

  it("reads hands-not-visible as a distinct null-movement state, not zero gesturing", () => {
    const prev = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
      // Both wrists absent -- out of frame.
    });
    const cur = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
    });

    const result = gestureActivity(prev, cur);

    expect(result.handsVisible).toBe(false);
    expect(result.movement).toBeNull();
    // A false reading here must never collapse to the same shape a real
    // "hands visible but motionless" reading would produce.
    expect(result.movement).not.toBe(0);
  });

  it("reads hands-visible-but-still as movement 0, distinct from the not-visible state", () => {
    const prev = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
      leftWrist: point(0.5, 0.5),
      rightWrist: point(0.5, 0.6),
    });
    const cur = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
      leftWrist: point(0.5, 0.5),
      rightWrist: point(0.5, 0.6),
    });

    const result = gestureActivity(prev, cur);

    expect(result.handsVisible).toBe(true);
    expect(result.movement).toBe(0);
    expect(result.movement).not.toBeNull();
  });

  it("treats a wrist below the visibility threshold the same as an absent one", () => {
    const prev = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
      leftWrist: point(0.5, 0.5, 0.49), // just under MIN_LANDMARK_VISIBILITY
    });
    const cur = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
      leftWrist: point(0.6, 0.5, 0.49),
    });

    const result = gestureActivity(prev, cur);

    expect(result.handsVisible).toBe(false);
    expect(result.movement).toBeNull();
  });

  it("averages both wrists when both are visible, rather than reporting only one", () => {
    const prev = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
      leftWrist: point(0.5, 0.5),
      rightWrist: point(0.5, 0.5),
    });
    const cur = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
      leftWrist: point(0.54, 0.5), // moved 0.04
      rightWrist: point(0.5, 0.58), // moved 0.08
    });

    const result = gestureActivity(prev, cur);

    // shoulderWidth 0.4; average raw displacement (0.04 + 0.08) / 2 = 0.06;
    // normalized: 0.06 / 0.4 = 0.15.
    expect(result.handsVisible).toBe(true);
    expect(result.movement).toBeCloseTo(0.15, 9);
  });

  it("returns movement null but handsVisible true when shoulders aren't measurable to normalize by", () => {
    const prev = makePose({ leftWrist: point(0.5, 0.5) });
    const cur = makePose({ leftWrist: point(0.6, 0.5) });

    const result = gestureActivity(prev, cur);

    expect(result.handsVisible).toBe(true);
    expect(result.movement).toBeNull();
  });

  it("returns movement null but handsVisible true when shoulders are too close together to normalize by", () => {
    expect(MIN_SHOULDER_WIDTH_NORM).toBe(0.03);
    const prev = makePose({
      leftShoulder: point(0.5, 0.5),
      rightShoulder: point(0.5 + MIN_SHOULDER_WIDTH_NORM / 2, 0.5), // half the floor: too narrow
      leftWrist: point(0.5, 0.5),
    });
    const cur = makePose({
      leftShoulder: point(0.5, 0.5),
      rightShoulder: point(0.5 + MIN_SHOULDER_WIDTH_NORM / 2, 0.5),
      leftWrist: point(0.6, 0.5),
    });

    const result = gestureActivity(prev, cur);

    expect(result.handsVisible).toBe(true);
    expect(result.movement).toBeNull();
  });

  it("returns movement null and handsVisible null when either sample is missing entirely", () => {
    const cur = makePose({
      leftShoulder: point(0.3, 0.5),
      rightShoulder: point(0.7, 0.5),
      leftWrist: point(0.5, 0.5),
    });

    expect(gestureActivity(null, cur)).toEqual({ movement: null, handsVisible: null });
    expect(gestureActivity(cur, undefined)).toEqual({ movement: null, handsVisible: null });
    expect(gestureActivity(undefined, undefined)).toEqual({ movement: null, handsVisible: null });
  });
});

// --- expressiveness ------------------------------------------------------

describe("expressiveness", () => {
  function category(categoryName, score) {
    return { categoryName, score };
  }

  it("averages the named smile and brow blendshape magnitudes, ignoring unrelated categories", () => {
    const blendshapes = [
      category("mouthSmileLeft", 0.2),
      category("mouthSmileRight", 0.6),
      category("browInnerUp", 0.1),
      category("browOuterUpLeft", 0.3),
      category("browOuterUpRight", 0.5),
      category("eyeBlinkLeft", 0.9), // not one of the named categories -- must be ignored
    ];

    const result = expressiveness(blendshapes);

    expect(result.smile).toBeCloseTo(0.4, 9); // (0.2 + 0.6) / 2
    expect(result.browMovement).toBeCloseTo(0.3, 9); // (0.1 + 0.3 + 0.5) / 3
  });

  it("never emits an emotion label -- only the two named magnitude fields come back", () => {
    const blendshapes = [category("mouthSmileLeft", 0.9), category("mouthSmileRight", 0.9)];

    const result = expressiveness(blendshapes);

    expect(Object.keys(result).sort()).toEqual(["browMovement", "smile"]);
  });

  it("excludes a missing category from its average instead of treating it as 0", () => {
    // Only one of the two smile categories reported; only one of the three
    // brow categories reported.
    const blendshapes = [category("mouthSmileLeft", 0.8), category("browOuterUpLeft", 0.4)];

    const result = expressiveness(blendshapes);

    // If the missing categories were averaged in as 0 these would read 0.4
    // and 0.1333... instead.
    expect(result.smile).toBe(0.8);
    expect(result.browMovement).toBe(0.4);
  });

  it("returns nulls for both magnitudes when no categories are provided", () => {
    expect(expressiveness([])).toEqual({ smile: null, browMovement: null });
  });

  it("returns nulls for both magnitudes when the input is missing or malformed", () => {
    expect(expressiveness(undefined)).toEqual({ smile: null, browMovement: null });
    expect(expressiveness(null)).toEqual({ smile: null, browMovement: null });
  });

  it("excludes a category whose score is non-finite from the average", () => {
    const blendshapes = [
      category("mouthSmileLeft", 0.5),
      category("mouthSmileRight", NaN), // model reported the category but no usable score
    ];

    const result = expressiveness(blendshapes);

    expect(result.smile).toBe(0.5);
  });
});

// --- framing ---------------------------------------------------------------

describe("framing", () => {
  it("reports centering, offsets, and fill for a well-framed face", () => {
    // Face box centred dead-on, covering roughly 0.3 x 0.3 = 0.09 of the
    // frame -- comfortably inside both the FACE_FILL_MIN/MAX range and the
    // centering radius, away from either edge so this is a genuine
    // "everything is fine" reading, not a boundary case.
    const result = framing({ minX: 0.35, minY: 0.35, maxX: 0.65, maxY: 0.65 });

    expect(result.offsetX).toBeCloseTo(0, 9);
    expect(result.offsetY).toBeCloseTo(0, 9);
    expect(result.centered).toBe(true);
    expect(result.fill).toBeCloseTo(0.09, 9);
    expect(result.tooClose).toBe(false);
    expect(result.tooFar).toBe(false);
  });

  it("stays centered exactly at the comfortable-radius boundary and flips false just past it", () => {
    expect(FRAME_CENTER_COMFORTABLE_RADIUS).toBe(0.18);
    const atBoundary = framing({
      minX: 0.49,
      maxX: 0.51,
      minY: 0.5 + FRAME_CENTER_COMFORTABLE_RADIUS - 0.01,
      maxY: 0.5 + FRAME_CENTER_COMFORTABLE_RADIUS + 0.01,
    });
    expect(atBoundary.offsetY).toBeCloseTo(FRAME_CENTER_COMFORTABLE_RADIUS, 5);
    expect(atBoundary.centered).toBe(true);

    const pastBoundary = framing({
      minX: 0.49,
      maxX: 0.51,
      minY: 0.5 + FRAME_CENTER_COMFORTABLE_RADIUS + 0.001 - 0.01,
      maxY: 0.5 + FRAME_CENTER_COMFORTABLE_RADIUS + 0.001 + 0.01,
    });
    expect(pastBoundary.offsetY).toBeGreaterThan(FRAME_CENTER_COMFORTABLE_RADIUS);
    expect(pastBoundary.centered).toBe(false);
  });

  it("does not read tooFar right at FACE_FILL_MIN, but does just below it", () => {
    expect(FACE_FILL_MIN).toBe(0.04);
    const atMin = framing({ minX: 0.25, maxX: 0.75, minY: 0.46, maxY: 0.54 }); // 0.5 * 0.08 = 0.04
    expect(atMin.fill).toBeCloseTo(0.04, 9);
    expect(atMin.tooFar).toBe(false);

    const belowMin = framing({ minX: 0.25, maxX: 0.75, minY: 0.4605, maxY: 0.5395 }); // 0.5 * 0.079 = 0.0395
    expect(belowMin.fill).toBeLessThan(FACE_FILL_MIN);
    expect(belowMin.tooFar).toBe(true);
  });

  it("does not read tooClose right at FACE_FILL_MAX, but does just above it", () => {
    expect(FACE_FILL_MAX).toBe(0.5);
    const atMax = framing({ minX: 0.1875, maxX: 0.8125, minY: 0.1, maxY: 0.9 }); // 0.625 * 0.8 = 0.5
    expect(atMax.fill).toBeCloseTo(0.5, 9);
    expect(atMax.tooClose).toBe(false);

    const aboveMax = framing({ minX: 0.1875, maxX: 0.8125, minY: 0.095, maxY: 0.905 }); // 0.625 * 0.81 = 0.50625
    expect(aboveMax.fill).toBeGreaterThan(FACE_FILL_MAX);
    expect(aboveMax.tooClose).toBe(true);
  });

  it("returns nulls throughout when the face box is missing", () => {
    expect(framing(undefined)).toEqual({
      centered: null,
      offsetX: null,
      offsetY: null,
      fill: null,
      tooClose: null,
      tooFar: null,
    });
    expect(framing(null)).toEqual({
      centered: null,
      offsetX: null,
      offsetY: null,
      fill: null,
      tooClose: null,
      tooFar: null,
    });
  });

  it("returns nulls throughout for a degenerate box with zero or negative width/height", () => {
    const zeroWidth = framing({ minX: 0.5, minY: 0.4, maxX: 0.5, maxY: 0.6 });
    expect(zeroWidth).toEqual({
      centered: null,
      offsetX: null,
      offsetY: null,
      fill: null,
      tooClose: null,
      tooFar: null,
    });

    const invertedHeight = framing({ minX: 0.4, minY: 0.6, maxX: 0.6, maxY: 0.4 });
    expect(invertedHeight.centered).toBeNull();
    expect(invertedHeight.fill).toBeNull();
  });

  it("returns nulls throughout when a box coordinate is non-finite", () => {
    const result = framing({ minX: 0.4, minY: NaN, maxX: 0.6, maxY: 0.6 });
    expect(result).toEqual({
      centered: null,
      offsetX: null,
      offsetY: null,
      fill: null,
      tooClose: null,
      tooFar: null,
    });
  });
});

// --- summarizeBodyLanguage --------------------------------------------

// Builds one per-tick sample in the shape bodyLandmarks.js's _toSample
// produces -- every field defaults to a "nothing detected this tick" value
// so a test only has to override what it actually cares about.
const NULLABLE_SAMPLE_FIELDS = [
  "yaw", "pitch", "roll", "lookingAtCamera", "shoulderTilt", "lean", "slouch",
  "gestureMovement", "handsVisible", "smile", "browMovement",
  "faceCentered", "faceFill", "faceTooClose", "faceTooFar",
];
function tickSample(tick, overrides = {}) {
  const base = { tick, faceDetected: false, poseDetected: false };
  for (const key of NULLABLE_SAMPLE_FIELDS) base[key] = null;
  return { ...base, ...overrides };
}

const EMPTY_SUMMARY = {
  available: false, frames: 0, faceFrames: 0, poseFrames: 0,
  eyeContactRatio: null, eyeContactSamples: 0,
  headSteadiness: null, headSteadinessSamples: 0,
  shoulderTilt: null, lean: null, postureSamples: 0,
  slouch: null, slouchSamples: 0,
  gestureRate: null, gestureSamples: 0,
  handsVisibleRatio: null, handsVisibleSamples: 0,
  expressiveness: { smile: null, smileSamples: 0, browMovement: null, browMovementSamples: 0 },
  framing: { centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null, samples: 0 },
};

describe("summarizeBodyLanguage", () => {
  it("returns the fully-null, available:false empty summary for no argument or an empty array, and drops falsy entries from the list rather than counting them as frames", () => {
    expect(summarizeBodyLanguage()).toEqual(EMPTY_SUMMARY);
    expect(summarizeBodyLanguage([])).toEqual(EMPTY_SUMMARY);
    const dropped = summarizeBodyLanguage([null, tickSample(1, { faceDetected: true }), undefined, false]);
    expect(dropped.frames).toBe(1);
    expect(dropped.faceFrames).toBe(1);
  });

  it("is available with frames counted, but every derived aggregate null, for a single sample well below every minimum", () => {
    const result = summarizeBodyLanguage([
      tickSample(1, {
        faceDetected: true, poseDetected: true, lookingAtCamera: true,
        yaw: 0, pitch: 0, shoulderTilt: 5, gestureMovement: 1, smile: 0.5, faceFill: 0.1,
      }),
    ]);
    expect(result.available).toBe(true);
    expect(result.frames).toBe(1);
    // One counted sample, but every MIN_*_SAMPLES floor is 3 -- none clear it.
    expect(result.eyeContactRatio).toBeNull();
    expect(result.eyeContactSamples).toBe(1);
    expect(result.shoulderTilt).toBeNull();
    expect(result.gestureRate).toBeNull();
    expect(result.expressiveness.smile).toBeNull();
    expect(result.framing.fill).toBeNull();
  });

  it("is available with every aggregate null -- never NaN, never Infinity, never a bare 0/false -- when every measured field is invalid or the wrong type", () => {
    const garbage = [1, 2, 3, 4, 5].map((tick) =>
      tickSample(tick, {
        faceDetected: true, poseDetected: true, yaw: NaN,
        lookingAtCamera: "yes", // reduceRatio only accepts literal true/false
        shoulderTilt: undefined,
        gestureMovement: Infinity, // reduceNumeric requires Number.isFinite
        handsVisible: 1, // not a real boolean
        smile: -Infinity, faceCentered: "centered", faceFill: Infinity,
      }),
    );
    const result = summarizeBodyLanguage(garbage);

    expect(result.available).toBe(true);
    expect(result.frames).toBe(5);
    expect(result.eyeContactRatio).toBeNull();
    expect(result.eyeContactSamples).toBe(0);
    expect(result.headSteadiness).toBeNull();
    expect(result.shoulderTilt).toBeNull();
    expect(result.gestureRate).toBeNull();
    expect(result.expressiveness.smile).toBeNull();
    expect(result.framing.fill).toBeNull();
    expect(result.framing.centeredRatio).toBeNull();

    // No field, top-level or nested, is ever NaN or +-Infinity -- a null
    // "not measured" must never leak out as one of those instead.
    function assertFiniteOrNull(value) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      else if (value && typeof value === "object") for (const v of Object.values(value)) assertFiniteOrNull(v);
    }
    assertFiniteOrNull(result);
  });

  it("nulls an aggregate whose sample count clears the absolute floor but falls below MIN_COVERAGE_RATIO of all sampled ticks, and flips to a real value right at the boundary", () => {
    expect(MIN_COVERAGE_RATIO).toBe(0.5);
    // 300 total ticks, a face detected -- and looking at the camera every
    // time -- on only 4. 4 clears MIN_FACE_SAMPLES (3) alone, but 4/300 is
    // nowhere near half the answer: must not read as "100% of the time".
    const samples = [];
    for (let i = 1; i <= 300; i += 1) {
      samples.push(i <= 4 ? tickSample(i, { faceDetected: true, lookingAtCamera: true }) : tickSample(i));
    }
    const result = summarizeBodyLanguage(samples);
    expect(result.frames).toBe(300);
    expect(result.faceFrames).toBe(4);
    expect(result.eyeContactRatio).toBeNull();
    // The raw count is still reported honestly even though the value is gated.
    expect(result.eyeContactSamples).toBe(4);

    const base = (n) => tickSample(n, { faceDetected: true, lookingAtCamera: true });
    // 7 ticks, 3 face-detected: 3/7 ~= 0.4286, just under 0.5 -> still null.
    const below = summarizeBodyLanguage([
      base(1), base(2), base(3), tickSample(4), tickSample(5), tickSample(6), tickSample(7),
    ]);
    expect(below.eyeContactRatio).toBeNull();
    // 6 ticks, 3 face-detected: exactly 0.5 (inclusive boundary) -> passes.
    const at = summarizeBodyLanguage([base(1), base(2), base(3), tickSample(4), tickSample(5), tickSample(6)]);
    expect(at.eyeContactRatio).toBe(1);
    expect(at.eyeContactSamples).toBe(3);
  });

  it("only diffs face samples whose tick numbers are genuinely consecutive, skipping the pair that straddles a gap, and reports null when NO pair is consecutive", () => {
    // Ticks 1-4 consecutive (5-degree hops), gap to tick 10 with a huge yaw jump that must NOT be diffed against tick 4, then 11 consecutive with 10.
    const samples = [
      tickSample(1, { faceDetected: true, yaw: 0, pitch: 0 }),
      tickSample(2, { faceDetected: true, yaw: 5, pitch: 0 }),
      tickSample(3, { faceDetected: true, yaw: 10, pitch: 0 }),
      tickSample(4, { faceDetected: true, yaw: 15, pitch: 0 }),
      tickSample(10, { faceDetected: true, yaw: 100, pitch: 0 }), // gap: 4 -> 10
      tickSample(11, { faceDetected: true, yaw: 105, pitch: 0 }),
    ];
    const result = summarizeBodyLanguage(samples);
    // Wrongly diffing tick 4 -> tick 10 (|100-15| = 85) would blow this average up.
    expect(result.headSteadiness).toBeCloseTo(5, 5);
    expect(result.headSteadinessSamples).toBe(4);
    // 4 face samples, but every neighbouring pair is separated by a tick gap -- zero pairs qualify, so this must go null, not average anyway.
    const allGapped = [1, 5, 9, 13].map((tick, i) => tickSample(tick, { faceDetected: true, yaw: i * 20, pitch: 0 }));
    const gappedResult = summarizeBodyLanguage(allGapped);
    expect(gappedResult.headSteadiness).toBeNull();
    expect(gappedResult.headSteadinessSamples).toBe(0);
  });

  it("returns a fresh object graph on every call -- mutating one result's nested fields never leaks into a later call", () => {
    const first = summarizeBodyLanguage([]);
    const second = summarizeBodyLanguage([]);
    expect(first).not.toBe(second);
    expect(first.expressiveness).not.toBe(second.expressiveness);
    expect(first.framing).not.toBe(second.framing);
    first.expressiveness.smile = 0.9;
    first.framing.fill = 0.5;
    first.eyeContactRatio = 0.5;
    const third = summarizeBodyLanguage([]);
    expect(third.expressiveness.smile).toBeNull();
    expect(third.framing.fill).toBeNull();
    expect(third.eyeContactRatio).toBeNull();
  });

  it("computes every aggregate correctly against a hand-worked, fully-populated answer", () => {
    // One column per tick (1-4), zipped into full samples below -- keeps the
    // per-tick numbers each expected aggregate is hand-computed from
    // readable straight off this table.
    const col = {
      yaw: [0, 5, 5, 10], pitch: [0, 0, 5, 5], looking: [true, true, false, true],
      tilt: [10, 20, 30, 40], lean: [0.1, 0.2, 0.3, 0.4], slouch: [0.2, 0.3, 0.4, 0.5],
      gesture: [1, 2, 3, 4], hands: [true, true, false, true],
      smile: [0.5, 0.6, 0.7, 0.8], brow: [0.1, 0.2, 0.3, 0.4],
      centered: [true, true, false, true], fill: [0.1, 0.2, 0.3, 0.4],
      tooClose: [false, false, true, false], tooFar: [false, false, false, true],
    };
    const samples = [0, 1, 2, 3].map((i) =>
      tickSample(i + 1, {
        faceDetected: true, poseDetected: true,
        yaw: col.yaw[i], pitch: col.pitch[i], lookingAtCamera: col.looking[i],
        shoulderTilt: col.tilt[i], lean: col.lean[i], slouch: col.slouch[i],
        gestureMovement: col.gesture[i], handsVisible: col.hands[i],
        smile: col.smile[i], browMovement: col.brow[i], faceCentered: col.centered[i],
        faceFill: col.fill[i], faceTooClose: col.tooClose[i], faceTooFar: col.tooFar[i],
      }),
    );
    const result = summarizeBodyLanguage(samples);
    expect(result.available).toBe(true);
    expect(result.frames).toBe(4);
    expect(result.faceFrames).toBe(4);
    expect(result.poseFrames).toBe(4);
    expect(result.eyeContactRatio).toBeCloseTo(0.75, 5); // 3 of 4 true
    // Consecutive deltas: |5-0|=5, |5-5|+|5-0|=5, |10-5|+|5-5|=5 -> avg 5.
    expect(result.headSteadiness).toBeCloseTo(5, 5);
    expect(result.headSteadinessSamples).toBe(3);
    expect(result.shoulderTilt).toBeCloseTo(25, 5); // avg(10,20,30,40)
    expect(result.lean).toBeCloseTo(0.25, 5);
    expect(result.slouch).toBeCloseTo(0.35, 5);
    expect(result.gestureRate).toBeCloseTo(2.5, 5);
    expect(result.handsVisibleRatio).toBeCloseTo(0.75, 5);
    expect(result.expressiveness.smile).toBeCloseTo(0.65, 5);
    expect(result.expressiveness.browMovement).toBeCloseTo(0.25, 5);
    expect(result.framing.fill).toBeCloseTo(0.25, 5);
    expect(result.framing.centeredRatio).toBeCloseTo(0.75, 5);
    expect(result.framing.tooCloseRatio).toBeCloseTo(0.25, 5);
    expect(result.framing.tooFarRatio).toBeCloseTo(0.25, 5);
  });

  it("counts a reduced aggregate's sample size as only the finite entries actually averaged, not the whole detected-frame count", () => {
    expect(MIN_POSE_SAMPLES).toBe(3);
    // 5 pose-detected frames, but shoulderTilt is a real number on only 3 --
    // the other 2 came back null (landmarks found, field not computed).
    const samples = [10, null, 20, null, 30].map((tilt, i) =>
      tickSample(i + 1, { poseDetected: true, shoulderTilt: tilt }),
    );
    const result = summarizeBodyLanguage(samples);
    expect(result.poseFrames).toBe(5);
    expect(result.postureSamples).toBe(3);
    expect(result.shoulderTilt).toBeCloseTo(20, 5);
  });
});
