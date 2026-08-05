import { describe, it, expect } from "vitest";
import {
  normalizeBodyLanguage,
  computeBodyLanguageScore,
  buildBodyLanguageFacts,
  bodyLanguageDeliveryNote,
} from "./critiqueBodyLanguage";
import { critiqueAnswerLocal } from "./critiqueLocal";
import { MIN_LUMA_SAMPLES, MIN_MOTION_SAMPLES } from "./videoStats";

// normalizeBodyLanguage -- covers the governing rule the rest of this file's
// fixtures assume already happened upstream (see the comment just below):
// a null aggregate stays null, never a coerced 0/false; ratios clamp to
// [0,1] and angles/magnitudes clamp to their own sane ranges so a malformed
// or hostile `metrics.bodyLanguage` from the client can't smuggle an
// "Infinity%", "500%", or "1e+308 degrees" reading through to either the
// user-facing note or the Gemini ground-truth facts (BUG-10); partiallyOff
// and reason are carried through rather than dropped (BUG-6); and a
// missing, null, non-object, or available:false summary normalizes cleanly
// instead of throwing.

const EMPTY_NORMALIZED = {
  available: false,
  eyeContactRatio: null,
  shoulderTilt: null,
  lean: null,
  slouch: null,
  gestureRate: null,
  handsVisibleRatio: null,
  framing: { centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null },
  partiallyOff: false,
  reason: null,
};

describe("normalizeBodyLanguage", () => {
  describe("missing, null, non-object, and available:false input never throws", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a bare string", "not an object"],
      ["a number", 42],
      ["an array", [1, 2, 3]],
    ])("normalizes %s to the same all-null, available:false shape", (_label, input) => {
      expect(normalizeBodyLanguage(input)).toEqual(EMPTY_NORMALIZED);
    });

    it("does not throw for available:false input and still normalizes its other fields", () => {
      const result = normalizeBodyLanguage({ available: false, eyeContactRatio: 0.5, reason: "camera-off" });
      expect(result.available).toBe(false);
      // available:false does not itself null out fields that were present --
      // it is computeBodyLanguageScore/buildBodyLanguageFacts that gate on
      // `available`, not normalizeBodyLanguage.
      expect(result.eyeContactRatio).toBe(0.5);
      expect(result.reason).toBe("camera-off");
    });
  });

  describe("a null aggregate stays null, never coerced to 0 or false", () => {
    it("leaves every numeric aggregate null when available but nothing was supplied", () => {
      const result = normalizeBodyLanguage({ available: true });
      expect(result.eyeContactRatio).toBeNull();
      expect(result.shoulderTilt).toBeNull();
      expect(result.lean).toBeNull();
      expect(result.slouch).toBeNull();
      expect(result.gestureRate).toBeNull();
      expect(result.handsVisibleRatio).toBeNull();
      expect(result.framing).toEqual({ centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null });
      // The governing rule, stated as a negative assertion too: a false-zero
      // misread is exactly what this house rule forbids.
      expect(result.eyeContactRatio).not.toBe(0);
      expect(result.shoulderTilt).not.toBe(0);
      expect(result.handsVisibleRatio).not.toBe(0);
    });

    it("nulls a non-finite field (NaN, Infinity, a string) rather than passing it through or defaulting to 0", () => {
      const result = normalizeBodyLanguage({
        available: true,
        eyeContactRatio: NaN,
        shoulderTilt: Infinity,
        lean: -Infinity,
        slouch: "not a number",
        gestureRate: undefined,
      });
      expect(result.eyeContactRatio).toBeNull();
      expect(result.shoulderTilt).toBeNull();
      expect(result.lean).toBeNull();
      expect(result.slouch).toBeNull();
      expect(result.gestureRate).toBeNull();
    });

    it("normalizes a missing or malformed framing sub-object the same way as an absent one, field by field", () => {
      expect(normalizeBodyLanguage({ available: true, framing: "nope" }).framing).toEqual({
        centeredRatio: null,
        fill: null,
        tooCloseRatio: null,
        tooFarRatio: null,
      });
      expect(normalizeBodyLanguage({ available: true, framing: null }).framing).toEqual({
        centeredRatio: null,
        fill: null,
        tooCloseRatio: null,
        tooFarRatio: null,
      });
      expect(normalizeBodyLanguage({ available: true, framing: { fill: 0.4 } }).framing).toEqual({
        centeredRatio: null,
        fill: 0.4,
        tooCloseRatio: null,
        tooFarRatio: null,
      });
    });
  });

  describe("ratios clamp to [0,1] and angles/magnitudes clamp to their own sane range (BUG-10)", () => {
    it("clamps an over-100% ratio down to 1, not through as a value over 100%", () => {
      const result = normalizeBodyLanguage({
        available: true,
        eyeContactRatio: 5,
        handsVisibleRatio: 2.5,
        framing: { centeredRatio: 3, fill: 1.5, tooCloseRatio: 9, tooFarRatio: 100 },
      });
      expect(result.eyeContactRatio).toBe(1);
      expect(result.handsVisibleRatio).toBe(1);
      expect(result.framing).toEqual({ centeredRatio: 1, fill: 1, tooCloseRatio: 1, tooFarRatio: 1 });
    });

    it("clamps a negative ratio up to 0, not through as a negative percentage", () => {
      const result = normalizeBodyLanguage({
        available: true,
        eyeContactRatio: -3,
        handsVisibleRatio: -0.5,
        framing: { centeredRatio: -1, fill: -50, tooCloseRatio: -0.01, tooFarRatio: -100 },
      });
      expect(result.eyeContactRatio).toBe(0);
      expect(result.handsVisibleRatio).toBe(0);
      expect(result.framing).toEqual({ centeredRatio: 0, fill: 0, tooCloseRatio: 0, tooFarRatio: 0 });
    });

    it("clamps an absurd angle (1e308 degrees) down to the +-90 degree shoulder-tilt range", () => {
      const positive = normalizeBodyLanguage({ available: true, shoulderTilt: 1e308 });
      const negative = normalizeBodyLanguage({ available: true, shoulderTilt: -1e308 });
      expect(positive.shoulderTilt).toBe(90);
      expect(negative.shoulderTilt).toBe(-90);
    });

    it("clamps lean, slouch, and gestureRate to their own documented ranges", () => {
      const result = normalizeBodyLanguage({
        available: true,
        lean: -50, // range is [-1, 1]
        slouch: -100, // range is [0, 5]
        gestureRate: 999, // range is [0, 5]
      });
      expect(result.lean).toBe(-1);
      expect(result.slouch).toBe(0);
      expect(result.gestureRate).toBe(5);

      const highLean = normalizeBodyLanguage({ available: true, lean: 50, slouch: 100, gestureRate: -20 });
      expect(highLean.lean).toBe(1);
      expect(highLean.slouch).toBe(5);
      expect(highLean.gestureRate).toBe(0);
    });

    it("nulls Infinity rather than clamping it to the range ceiling -- Infinity is not finite", () => {
      const result = normalizeBodyLanguage({
        available: true,
        eyeContactRatio: Infinity,
        shoulderTilt: Infinity,
        gestureRate: Infinity,
      });
      expect(result.eyeContactRatio).toBeNull();
      expect(result.shoulderTilt).toBeNull();
      expect(result.gestureRate).toBeNull();
    });

    it("keeps an already-in-range value unchanged", () => {
      const result = normalizeBodyLanguage({
        available: true,
        eyeContactRatio: 0.42,
        shoulderTilt: -37.5,
        lean: 0.1,
        slouch: 0.6,
        gestureRate: 1.2,
        handsVisibleRatio: 0.9,
        framing: { centeredRatio: 0.5, fill: 0.3, tooCloseRatio: 0.1, tooFarRatio: 0.05 },
      });
      expect(result.eyeContactRatio).toBe(0.42);
      expect(result.shoulderTilt).toBe(-37.5);
      expect(result.lean).toBe(0.1);
      expect(result.slouch).toBe(0.6);
      expect(result.gestureRate).toBe(1.2);
      expect(result.handsVisibleRatio).toBe(0.9);
      expect(result.framing).toEqual({ centeredRatio: 0.5, fill: 0.3, tooCloseRatio: 0.1, tooFarRatio: 0.05 });
    });

    it("feeds a hostile raw summary through normalizeBodyLanguage into buildBodyLanguageFacts/bodyLanguageDeliveryNote without ever rendering Infinity%, an over-100% ratio, or an absurd degree value", () => {
      const hostileRaw = {
        available: true,
        eyeContactRatio: 5,
        shoulderTilt: 1e308,
        lean: -50,
        slouch: -100,
        gestureRate: 999,
        handsVisibleRatio: Infinity,
        framing: { centeredRatio: -5, fill: 50, tooCloseRatio: NaN, tooFarRatio: 2 },
      };
      const normalized = normalizeBodyLanguage(hostileRaw);
      const facts = buildBodyLanguageFacts(normalized);
      const note = bodyLanguageDeliveryNote(normalized);

      expect(facts).toEqual([
        "Head orientation: facing the camera 100% of the time your face was visible to the camera (head orientation, not eye contact).",
        "Posture: shoulder tilt 90 degrees off level; lean 100% left of frame centre; shoulder-to-nose distance 0.00x shoulder width.",
        "Gestures: hand movement measured 5.00 (normalized wrist movement per sample).",
        "Framing (position and fill in frame, measured over the time your face was visible to the camera): centred 0% of that time; your face filled about 100% of the frame; sat too far from the camera 100% of that time.",
      ]);
      expect(note).toBe(`Body language: ${facts.join(" ")}`);

      const joined = facts.join(" ");
      expect(joined).not.toMatch(/Infinity/);
      expect(joined).not.toMatch(/NaN/);
      expect(joined).not.toMatch(/e\+/i);
      expect(joined).not.toMatch(/500%/);
      // Every percentage figure in the text is within the legitimate 0-100
      // range (100% itself is the correct clamped ceiling, not a defect).
      const percentages = [...joined.matchAll(/(-?\d+)%/g)].map((m) => Number(m[1]));
      expect(percentages.length).toBeGreaterThan(0);
      for (const pct of percentages) {
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    });
  });

  describe("partiallyOff and reason are carried through rather than dropped (BUG-6)", () => {
    it("carries a true partiallyOff flag and a string reason through unchanged", () => {
      const result = normalizeBodyLanguage({
        available: true,
        partiallyOff: true,
        reason: "inference-partially-failed",
      });
      expect(result.partiallyOff).toBe(true);
      expect(result.reason).toBe("inference-partially-failed");
    });

    it("defaults partiallyOff to false and reason to null when absent", () => {
      const result = normalizeBodyLanguage({ available: true });
      expect(result.partiallyOff).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("coerces a truthy non-boolean partiallyOff to true rather than dropping it", () => {
      const result = normalizeBodyLanguage({ available: true, partiallyOff: "yes" });
      expect(result.partiallyOff).toBe(true);
    });

    it("nulls a non-string reason instead of passing through a raw code/number/object", () => {
      expect(normalizeBodyLanguage({ available: true, reason: 12345 }).reason).toBeNull();
      expect(normalizeBodyLanguage({ available: true, reason: { code: "x" } }).reason).toBeNull();
      expect(normalizeBodyLanguage({ available: true, reason: true }).reason).toBeNull();
    });

    it("carries partiallyOff/reason through even when available is false", () => {
      const result = normalizeBodyLanguage({ available: false, partiallyOff: true, reason: "camera-off" });
      expect(result.partiallyOff).toBe(true);
      expect(result.reason).toBe("camera-off");
    });
  });
});

// computeBodyLanguageScore always receives the output shape
// normalizeBodyLanguage produces (see critiqueLocal.js's normalizeMetrics,
// which calls normalizeBodyLanguage(m.bodyLanguage) before ever handing the
// result to computeBodyLanguageScore) -- ratios already clamped to [0,1],
// shoulderTilt to [-90,90], slouch to [0,5], gestureRate to [0,5]. Fixtures
// below stay inside that same normalized shape/range throughout, exactly as
// the real call site always does.

// A fully-populated, empty-of-signal starting point every fixture below
// overrides from, so each test only has to state the fields it actually
// cares about (mirrors bodyLanguage.test.js's tickSample helper).
function bl(overrides = {}) {
  const framing = { centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null, ...overrides.framing };
  return {
    available: true,
    eyeContactRatio: null,
    shoulderTilt: null,
    lean: null,
    slouch: null,
    gestureRate: null,
    handsVisibleRatio: null,
    partiallyOff: false,
    reason: null,
    ...overrides,
    framing,
  };
}

const ALL_PERFECT = bl({
  eyeContactRatio: 1,
  shoulderTilt: 0,
  lean: 0,
  slouch: 1,
  gestureRate: 1,
  handsVisibleRatio: 1,
  framing: { centeredRatio: 1, fill: 0.2, tooCloseRatio: 0, tooFarRatio: 0 },
});

// Every measured field pushed to its worst reading, but still inside the
// range normalizeBodyLanguage's own clamping guarantees (a truly
// out-of-contract input, e.g. a negative ratio, never reaches this function
// from the real call site).
const ALL_WORST = bl({
  eyeContactRatio: 0,
  shoulderTilt: 90,
  lean: 0.9,
  slouch: 0,
  gestureRate: 0,
  handsVisibleRatio: 0,
  partiallyOff: true,
  framing: { centeredRatio: 0, fill: 0.9, tooCloseRatio: 1, tooFarRatio: 0 },
});

describe("computeBodyLanguageScore", () => {
  describe("null (not zero) when nothing was measurable", () => {
    it("returns null for a missing summary entirely", () => {
      expect(computeBodyLanguageScore(null)).toBeNull();
      expect(computeBodyLanguageScore(undefined)).toBeNull();
    });

    it("returns null when available is false, even if fields carry stale numbers", () => {
      // Simulates a camera the user turned off part-way through: the
      // summary object can still carry leftover numeric fields, but
      // available:false must short-circuit straight to null rather than
      // scoring off the stale data.
      const result = computeBodyLanguageScore(
        bl({ available: false, eyeContactRatio: 0, shoulderTilt: 45, gestureRate: 0 }),
      );
      expect(result).toBeNull();
    });

    it("returns null, not zero, when available is true but every field is null (camera never produced a reading)", () => {
      const result = computeBodyLanguageScore(bl({ available: true }));
      expect(result).toBeNull();
      expect(result).not.toBe(0);
    });

    it("returns null when the framing sub-object itself is missing", () => {
      const noFraming = { available: true, eyeContactRatio: null, shoulderTilt: null, slouch: null, gestureRate: null };
      expect(computeBodyLanguageScore(noFraming)).toBeNull();
    });
  });

  describe("stays within 0-100, and never NaN, across the extremes", () => {
    it("scores exactly 100 for an all-perfect fixture", () => {
      expect(computeBodyLanguageScore(ALL_PERFECT)).toBe(100);
    });

    it("scores a specific, bounded value for an all-worst fixture -- never negative, never over 100, never NaN", () => {
      const result = computeBodyLanguageScore(ALL_WORST);
      // head=0 (ratio 0), posture=70 (both tilt>8 and slouch<0.5 breach,
      // -15 each), gesture=90 (rate 0 < still floor, -10),
      // framing=70 (not centered -15, tooCloseRatio 1 -> -15*1).
      // average(0, 70, 90, 70) = 57.5 -> rounds to 58.
      expect(result).toBe(58);
      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it.each([
      ["only head measured, mid-range", bl({ eyeContactRatio: 0.73 })],
      ["only posture measured, both sub-signals breaching", bl({ shoulderTilt: 45, slouch: 0.1 })],
      ["only gesture measured, still", bl({ gestureRate: 0 })],
      ["only framing measured, badly framed on every axis", bl({ framing: { centeredRatio: 0, fill: 0.9, tooCloseRatio: 1, tooFarRatio: 1 } })],
      ["every signal measured at a mixed, non-extreme reading", ALL_WORST],
      ["every signal measured at its best reading", ALL_PERFECT],
    ])("%s", (_label, fixture) => {
      const result = computeBodyLanguageScore(fixture);
      expect(result).not.toBeNull();
      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  describe("too-close/too-far framing penalty scales with the ratio", () => {
    it("costs almost nothing for a ratio representing one transient frame, versus a real deduction for the whole answer", () => {
      // Isolate framing as the only measured component (all else null) so
      // the composite equals framingScore exactly, with centeredRatio held
      // at a non-penalized 1 throughout so only the tooClose scaling moves.
      const transient = computeBodyLanguageScore(
        bl({ framing: { centeredRatio: 1, fill: 0.2, tooCloseRatio: 0.05, tooFarRatio: 0 } }),
      );
      const wholeAnswer = computeBodyLanguageScore(
        bl({ framing: { centeredRatio: 1, fill: 0.2, tooCloseRatio: 1, tooFarRatio: 0 } }),
      );

      // 100 - 15*0.05 = 99.25 -> rounds to 99: a one-point ding.
      expect(transient).toBe(99);
      // 100 - 15*1 = 85: the full penalty.
      expect(wholeAnswer).toBe(85);
      // A flat (non-scaling) penalty would have made these identical --
      // they must not be.
      expect(transient).not.toBe(wholeAnswer);
      expect(100 - transient).toBeLessThan(100 - wholeAnswer);
    });

    it("moves the score proportionally to a mid-range ratio, not in a fixed step", () => {
      const lowRatio = computeBodyLanguageScore(
        bl({ framing: { centeredRatio: 1, fill: 0.2, tooCloseRatio: 0.2, tooFarRatio: 0 } }),
      );
      const highRatio = computeBodyLanguageScore(
        bl({ framing: { centeredRatio: 1, fill: 0.2, tooCloseRatio: 0.8, tooFarRatio: 0 } }),
      );

      // 100 - 15*0.2 = 97; 100 - 15*0.8 = 88.
      expect(lowRatio).toBe(97);
      expect(highRatio).toBe(88);
      // The 4x larger ratio (0.8 vs 0.2) costs a proportionally larger
      // deduction (12 points vs 3), not the same deduction either way.
      expect(100 - lowRatio).toBe(3);
      expect(100 - highRatio).toBe(12);
    });

    it("applies the same scaling to tooFarRatio independently of tooCloseRatio", () => {
      const transientFar = computeBodyLanguageScore(
        bl({ framing: { centeredRatio: 1, fill: 0.2, tooCloseRatio: 0, tooFarRatio: 0.1 } }),
      );
      const wholeAnswerFar = computeBodyLanguageScore(
        bl({ framing: { centeredRatio: 1, fill: 0.2, tooCloseRatio: 0, tooFarRatio: 1 } }),
      );

      // 100 - 15*0.1 = 98.5 -> rounds to 99 (banker's-away-from-zero: .5 up).
      expect(transientFar).toBe(99);
      expect(wholeAnswerFar).toBe(85);
    });
  });

  describe("lean is never scored here", () => {
    it("leaves the score unchanged as lean varies across its full range, with framing's own centeredRatio held fixed", () => {
      const centered = { centeredRatio: 1, fill: 0.2, tooCloseRatio: 0, tooFarRatio: 0 };
      const atCenter = computeBodyLanguageScore(bl({ lean: 0, framing: centered }));
      const farRight = computeBodyLanguageScore(bl({ lean: 0.9, framing: centered }));
      const farLeft = computeBodyLanguageScore(bl({ lean: -0.9, framing: centered }));
      const missing = computeBodyLanguageScore(bl({ lean: null, framing: centered }));

      expect(atCenter).toBe(farRight);
      expect(atCenter).toBe(farLeft);
      expect(atCenter).toBe(missing);
    });

    it("does not double-penalize an off-centre sitter: a bad lean alongside a bad centeredRatio scores the same as the bad centeredRatio alone", () => {
      const offCentreFraming = { centeredRatio: 0, fill: 0.2, tooCloseRatio: 0, tooFarRatio: 0 };
      const withBadLean = computeBodyLanguageScore(bl({ lean: 0.9, framing: offCentreFraming }));
      const withoutLeanMeasured = computeBodyLanguageScore(bl({ lean: null, framing: offCentreFraming }));

      expect(withBadLean).toBe(withoutLeanMeasured);
      // The single, real off-centre penalty (framing's centeredRatio
      // breach): 100 - 15 = 85, not two 15-point deductions stacked into 70.
      expect(withBadLean).toBe(85);
    });
  });

  describe("deterministic output", () => {
    it("returns the identical score across repeated calls with the same input", () => {
      const first = computeBodyLanguageScore(ALL_WORST);
      const second = computeBodyLanguageScore(ALL_WORST);
      const third = computeBodyLanguageScore(ALL_WORST);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it("returns the identical score for two separately-built objects carrying the same values", () => {
      const a = bl({ eyeContactRatio: 0.6, shoulderTilt: 12, slouch: 0.3, gestureRate: 0.02, framing: { centeredRatio: 0.4, fill: 0.3, tooCloseRatio: 0.5, tooFarRatio: 0 } });
      const b = bl({ eyeContactRatio: 0.6, shoulderTilt: 12, slouch: 0.3, gestureRate: 0.02, framing: { centeredRatio: 0.4, fill: 0.3, tooCloseRatio: 0.5, tooFarRatio: 0 } });
      expect(computeBodyLanguageScore(a)).toBe(computeBodyLanguageScore(b));
    });
  });

  describe("threshold boundaries stay non-penalizing exactly at the line, and penalize just past it", () => {
    it("shoulder tilt: no penalty at exactly 8 degrees, penalty just past it", () => {
      const atBoundary = computeBodyLanguageScore(bl({ shoulderTilt: 8, slouch: 1 }));
      const pastBoundary = computeBodyLanguageScore(bl({ shoulderTilt: 8.01, slouch: 1 }));
      expect(atBoundary).toBe(100);
      expect(pastBoundary).toBe(85);
    });

    it("slouch: no penalty at exactly 0.5, penalty just below it", () => {
      const atBoundary = computeBodyLanguageScore(bl({ shoulderTilt: 0, slouch: 0.5 }));
      const pastBoundary = computeBodyLanguageScore(bl({ shoulderTilt: 0, slouch: 0.49 }));
      expect(atBoundary).toBe(100);
      expect(pastBoundary).toBe(85);
    });

    it("gesture stillness: no penalty at exactly the still floor, penalty just below it", () => {
      const atBoundary = computeBodyLanguageScore(bl({ gestureRate: 0.05 }));
      const pastBoundary = computeBodyLanguageScore(bl({ gestureRate: 0.049 }));
      expect(atBoundary).toBe(100);
      expect(pastBoundary).toBe(90);
    });

    it("framing centering: no penalty at exactly the centered floor, penalty just below it", () => {
      const atBoundary = computeBodyLanguageScore(bl({ framing: { centeredRatio: 0.5, fill: 0.2, tooCloseRatio: 0, tooFarRatio: 0 } }));
      const pastBoundary = computeBodyLanguageScore(bl({ framing: { centeredRatio: 0.49, fill: 0.2, tooCloseRatio: 0, tooFarRatio: 0 } }));
      expect(atBoundary).toBe(100);
      expect(pastBoundary).toBe(85);
    });
  });

  describe("only measured components enter the composite", () => {
    it("averages over just the two measured sub-scores when head and gesture were never measured", () => {
      // posture perfect (100), framing perfect (100), head/gesture null and
      // excluded rather than dragging the average down as a phantom 0.
      const result = computeBodyLanguageScore(
        bl({ shoulderTilt: 0, slouch: 1, framing: { centeredRatio: 1, fill: 0.2, tooCloseRatio: 0, tooFarRatio: 0 } }),
      );
      expect(result).toBe(100);
    });

    it("a single measured, badly-scoring component is not diluted by phantom perfect scores from the unmeasured ones", () => {
      const result = computeBodyLanguageScore(bl({ eyeContactRatio: 0 }));
      expect(result).toBe(0);
    });
  });
});

// buildBodyLanguageFacts / bodyLanguageDeliveryNote -- covers AC-D3's fact-
// wording rules: a null aggregate is NOT MEASURED (never praised, never
// criticized, and produces no fact at all); a rounded-to-0% ratio is never
// reported (BUG-8); head orientation is a proxy that must never read as eye
// contact/gaze/attention; percentages are stated against the visible-face
// denominator, not whole-answer coverage; face fill is the face's box, not
// "the person"; hands that were never visible enough to measure MOVEMENT are
// a measurement gap, never stillness (and hands never visible at all emit
// nothing); partiallyOff adds one coverage caveat rather than rewording
// every percentage; and no emotion/confidence/nerves/personality/appearance
// vocabulary appears anywhere in the emitted text.

// Fully-populated normalized bodyLanguage object -- the same shape `bl`
// above builds, reused with its own name here since every fact-wording test
// below overrides most of its fields at once (an all-null base like `bl`
// would make every happy-path fixture verbose to construct).
function fullBodyLanguage(overrides = {}) {
  return {
    available: true,
    eyeContactRatio: 0.83,
    shoulderTilt: 12.4,
    lean: 0.15,
    slouch: 0.62,
    gestureRate: 1.234,
    handsVisibleRatio: 0.91,
    framing: {
      centeredRatio: 0.77,
      fill: 0.22,
      tooCloseRatio: 0.05,
      tooFarRatio: 0.02,
    },
    partiallyOff: false,
    reason: null,
    ...overrides,
  };
}

describe("buildBodyLanguageFacts — happy path wording", () => {
  it("produces one exact sentence per category, worded per the AC-D3 rules", () => {
    const facts = buildBodyLanguageFacts(fullBodyLanguage());

    expect(facts).toEqual([
      "Head orientation: facing the camera 83% of the time your face was visible to the camera (head orientation, not eye contact).",
      "Posture: shoulder tilt 12 degrees off level; lean 15% right of frame centre; shoulder-to-nose distance 0.62x shoulder width.",
      "Gestures: hand movement measured 1.23 (normalized wrist movement per sample) (hands visible 91% of the time).",
      "Framing (position and fill in frame, measured over the time your face was visible to the camera): centred 77% of that time; your face filled about 22% of the frame; sat too close to the camera 5% of that time; sat too far from the camera 2% of that time.",
    ]);
  });

  it("folds the same facts into one Body language: line via bodyLanguageDeliveryNote", () => {
    const note = bodyLanguageDeliveryNote(fullBodyLanguage());
    const facts = buildBodyLanguageFacts(fullBodyLanguage());
    expect(note).toBe(`Body language: ${facts.join(" ")}`);
    expect(note.startsWith("Body language: Head orientation: facing the camera 83%")).toBe(true);
  });

  it("flips lean's sign wording (left vs right) with the ratio's sign, magnitude stated as a positive percentage either way", () => {
    const right = buildBodyLanguageFacts(fullBodyLanguage({ lean: 0.3 }))[1];
    const left = buildBodyLanguageFacts(fullBodyLanguage({ lean: -0.3 }))[1];
    expect(right).toContain("lean 30% right of frame centre");
    expect(left).toContain("lean 30% left of frame centre");
  });
});

describe("buildBodyLanguageFacts — null aggregates never become a fact, in either direction", () => {
  it("omits the Head orientation fact entirely when eyeContactRatio is null, without praising or criticizing it", () => {
    const facts = buildBodyLanguageFacts(fullBodyLanguage({ eyeContactRatio: null }));
    expect(facts.some((f) => f.startsWith("Head orientation"))).toBe(false);
    expect(facts.join(" ")).not.toMatch(/eye contact|facing the camera/i);
    // The other three categories still cleared their own gates independently.
    expect(facts).toHaveLength(3);
  });

  it("omits the Posture fact entirely when every posture field is null", () => {
    const facts = buildBodyLanguageFacts(fullBodyLanguage({ shoulderTilt: null, lean: null, slouch: null }));
    expect(facts.some((f) => f.startsWith("Posture"))).toBe(false);
  });

  it("includes only the posture bits that are actually finite, not a placeholder for the null ones", () => {
    const facts = buildBodyLanguageFacts(fullBodyLanguage({ lean: null }));
    const posture = facts.find((f) => f.startsWith("Posture"));
    expect(posture).toBe("Posture: shoulder tilt 12 degrees off level; shoulder-to-nose distance 0.62x shoulder width.");
    expect(posture).not.toMatch(/lean/);
  });

  it("omits the Gestures fact entirely when hands were never visible enough to measure anything (gestureRate and handsVisibleRatio both null)", () => {
    const facts = buildBodyLanguageFacts(fullBodyLanguage({ gestureRate: null, handsVisibleRatio: null }));
    expect(facts.some((f) => f.startsWith("Gestures"))).toBe(false);
  });

  it("omits the Framing fact entirely when every framing field is null", () => {
    const facts = buildBodyLanguageFacts(
      fullBodyLanguage({ framing: { centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null } }),
    );
    expect(facts.some((f) => f.startsWith("Framing"))).toBe(false);
  });

  it("returns an empty array (never a single bare fact) when every aggregate is null", () => {
    expect(
      buildBodyLanguageFacts(
        fullBodyLanguage({
          eyeContactRatio: null,
          shoulderTilt: null,
          lean: null,
          slouch: null,
          gestureRate: null,
          handsVisibleRatio: null,
          framing: { centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null },
        }),
      ),
    ).toEqual([]);
  });

  it("returns an empty array for an unavailable summary, and for missing/malformed input, never throwing", () => {
    expect(buildBodyLanguageFacts({ available: false })).toEqual([]);
    expect(buildBodyLanguageFacts(null)).toEqual([]);
    expect(buildBodyLanguageFacts(undefined)).toEqual([]);
    expect(buildBodyLanguageFacts("not an object")).toEqual([]);
  });

  it("returns null (no line, no placeholder) from bodyLanguageDeliveryNote when nothing cleared a gate", () => {
    expect(bodyLanguageDeliveryNote({ available: true })).toBeNull();
    expect(bodyLanguageDeliveryNote(null)).toBeNull();
  });
});

describe("buildBodyLanguageFacts — a rounded-to-0% ratio is never reported (BUG-8)", () => {
  it("drops sat-too-close and sat-too-far entirely when both ratios round to 0%, even though they are real nonzero measurements", () => {
    const facts = buildBodyLanguageFacts(
      fullBodyLanguage({ framing: { centeredRatio: 0.77, fill: 0.22, tooCloseRatio: 0.004, tooFarRatio: 0.004 } }),
    );
    const framing = facts.find((f) => f.startsWith("Framing"));
    expect(framing).toBe(
      "Framing (position and fill in frame, measured over the time your face was visible to the camera): centred 77% of that time; your face filled about 22% of the frame.",
    );
    expect(framing).not.toMatch(/too close|too far/);
  });

  it("still reports a too-close/too-far clause once its rounded percentage clears 0%, at the rounding boundary", () => {
    const facts = buildBodyLanguageFacts(
      fullBodyLanguage({ framing: { centeredRatio: 0.77, fill: 0.22, tooCloseRatio: 0.005, tooFarRatio: 0 } }),
    );
    const framing = facts.find((f) => f.startsWith("Framing"));
    expect(framing).toContain("sat too close to the camera 1% of that time");
    expect(framing).not.toMatch(/too far/);
  });

  it("drops the whole Framing fact when centeredRatio/fill are null and the only other signals round to 0%", () => {
    const facts = buildBodyLanguageFacts(
      fullBodyLanguage({ framing: { centeredRatio: null, fill: null, tooCloseRatio: 0.001, tooFarRatio: 0.002 } }),
    );
    expect(facts.some((f) => f.startsWith("Framing"))).toBe(false);
  });
});

describe("buildBodyLanguageFacts — wording rules, asserted on the actual emitted strings", () => {
  it("never labels head orientation as eye contact except inside the explicit disclaimer negating it", () => {
    const fact = buildBodyLanguageFacts(fullBodyLanguage())[0];
    expect(fact).not.toMatch(/gaze/i);
    expect(fact).not.toMatch(/attention/i);
    // The only occurrence of "eye contact" is the "(head orientation, not
    // eye contact)" disclaimer -- stripping that exact clause must remove
    // every trace of the phrase, proving it is never used as a positive claim.
    expect(fact.replace("not eye contact", "")).not.toMatch(/eye contact/i);
  });

  it("states head-orientation and framing percentages against the visible-face denominator, not whole-answer coverage", () => {
    const [headFact, , , framingFact] = buildBodyLanguageFacts(fullBodyLanguage());
    expect(headFact).toContain("of the time your face was visible to the camera");
    expect(framingFact).toContain("measured over the time your face was visible to the camera");
  });

  it("describes framing fill as the face, not the person filling the frame", () => {
    const framingFact = buildBodyLanguageFacts(fullBodyLanguage())[3];
    expect(framingFact).toContain("your face filled about 22% of the frame");
    expect(framingFact).not.toMatch(/person/i);
    expect(framingFact).not.toMatch(/you filled/i);
  });

  it("reports hands visible but movement unmeasured as a measurement gap, never as stillness", () => {
    const facts = buildBodyLanguageFacts(fullBodyLanguage({ gestureRate: null, handsVisibleRatio: 0.4 }));
    const gestures = facts.find((f) => f.startsWith("Gestures"));
    expect(gestures).toBe(
      "Gestures: hands visible 40% of the time, not enough to measure hand movement — a measurement gap, not stillness.",
    );
  });

  it("describes gestures as hand movement measured, not as a personality trait, when movement was actually measured", () => {
    const gestures = buildBodyLanguageFacts(fullBodyLanguage({ gestureRate: 0.01, handsVisibleRatio: 0.6 }))[2];
    expect(gestures).toBe(
      "Gestures: hand movement measured 0.01 (normalized wrist movement per sample) (hands visible 60% of the time).",
    );
  });
});

describe("buildBodyLanguageFacts — partiallyOff adds a coverage caveat, not a rewording of the percentages", () => {
  it("prepends one caveat sentence ahead of the other facts, leaving their percentage wording unchanged", () => {
    const withoutFlag = buildBodyLanguageFacts(fullBodyLanguage({ partiallyOff: false }));
    const withFlag = buildBodyLanguageFacts(fullBodyLanguage({ partiallyOff: true }));

    expect(withFlag[0]).toBe(
      "The camera was off for part of this answer, so the figures below reflect only the portion it was on.",
    );
    expect(withFlag).toHaveLength(withoutFlag.length + 1);
    // Every fact after the caveat is byte-for-byte identical to the
    // no-caveat run -- the caveat qualifies them, it does not rewrite them
    // into whole-answer figures.
    expect(withFlag.slice(1)).toEqual(withoutFlag);
  });

  it("does not prepend a bare caveat when partiallyOff is set but nothing else cleared a gate", () => {
    const facts = buildBodyLanguageFacts(
      fullBodyLanguage({
        partiallyOff: true,
        eyeContactRatio: null,
        shoulderTilt: null,
        lean: null,
        slouch: null,
        gestureRate: null,
        handsVisibleRatio: null,
        framing: { centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null },
      }),
    );
    expect(facts).toEqual([]);
  });
});

describe("buildBodyLanguageFacts / bodyLanguageDeliveryNote — no subjective vocabulary, swept over the output", () => {
  const BANNED_TERMS = [
    "confiden",
    "nervous",
    "nerve",
    "emotion",
    "anxious",
    "anxiety",
    "personality",
    "appearance",
    "attractive",
    "charisma",
    "engaging",
    "enthusias",
    "friendly",
    "awkward",
    "poised",
    "poise",
    "relaxed",
    "stressed",
    "likable",
    "likeable",
    "trustworthy",
    "attentive",
    "distracted",
    "focused",
    "professional-looking",
  ];

  // Exercises every branch at once (all categories present, the
  // hands-visible-but-unmeasured gesture branch, and the partiallyOff
  // caveat) so the sweep has the largest possible surface to catch a leaked
  // subjective word in.
  const kitchenSink = fullBodyLanguage({ gestureRate: null, handsVisibleRatio: 0.4, partiallyOff: true });

  it("contains none of the banned emotion/confidence/nerves/personality/appearance terms in buildBodyLanguageFacts' output", () => {
    const text = buildBodyLanguageFacts(kitchenSink).join(" ").toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    for (const term of BANNED_TERMS) {
      expect(text).not.toContain(term);
    }
  });

  it("contains none of the banned terms in bodyLanguageDeliveryNote's folded output either", () => {
    const note = bodyLanguageDeliveryNote(kitchenSink).toLowerCase();
    for (const term of BANNED_TERMS) {
      expect(note).not.toContain(term);
    }
  });
});

describe("buildBodyLanguageFacts / bodyLanguageDeliveryNote — deterministic", () => {
  it("returns identical wording across repeated calls on separate but equal inputs", () => {
    const a = buildBodyLanguageFacts(fullBodyLanguage());
    const b = buildBodyLanguageFacts(fullBodyLanguage());
    expect(a).toEqual(b);
    expect(bodyLanguageDeliveryNote(fullBodyLanguage())).toBe(bodyLanguageDeliveryNote(fullBodyLanguage()));
  });

  it("returns identical wording across repeated calls on the exact same input object", () => {
    const same = fullBodyLanguage();
    expect(buildBodyLanguageFacts(same)).toEqual(buildBodyLanguageFacts(same));
  });
});

// Integration: the AC-D3 property that matters most, exercised through the
// real public entry point (critiqueAnswerLocal, critiqueLocal.js) rather
// than by inspecting computeBodyLanguageScore/computeDeliveryScore
// internals -- an answer whose camera was off must produce the exact same
// composite score, verdict, and delivery notes as an otherwise identical
// answer that never had a camera at all: the component is excluded and the
// remaining weights renormalize, never scored zero and blamed.
describe("critiqueAnswerLocal integration — camera-off parity (AC-D3)", () => {
  const question = "Tell me about a time you improved a process.";
  const answer =
    "During my time at Acme, my task was to improve onboarding for new hires. " +
    "I built a new training program and rolled it out to the team. " +
    "Support tickets fell by 40% after the change.";

  const baseMetrics = {
    wordCount: 42,
    speechDurationSec: 21,
    wordsPerMinute: 120,
    paceLabel: "conversational",
    fillerCount: 0,
    fillerRate: 0,
    fillers: [],
    hasMetric: true,
    micMuted: false,
    video: { hadVideo: false },
  };

  it("scores an answer that never had a camera at all identically, field for field, to one where the camera was explicitly off", () => {
    const neverHadCamera = { ...baseMetrics }; // no bodyLanguage key whatsoever
    const cameraOff = { ...baseMetrics, bodyLanguage: { available: false, reason: "camera-off" } };

    const a = critiqueAnswerLocal({ question, type: "behavioral", answer, metrics: neverHadCamera });
    const b = critiqueAnswerLocal({ question, type: "behavioral", answer, metrics: cameraOff });

    expect(b).toEqual(a);
    // Guard against a vacuous pass where both sides simply came out broken
    // the same way — pin the actual composite and confirm the delivery
    // array never mentions body language when nothing was ever measured.
    expect(a.score).toBe(64);
    expect(a.delivery.join(" ")).not.toMatch(/Body language/);
  });

  it("stray numeric data behind available:false does not change the score relative to no body-language data at all", () => {
    const strayData = {
      ...baseMetrics,
      bodyLanguage: { available: false, eyeContactRatio: 0.95, shoulderTilt: 1, gestureRate: 0.3 },
    };
    const noKeyAtAll = { ...baseMetrics };

    const withStray = critiqueAnswerLocal({ question, type: "behavioral", answer, metrics: strayData });
    const withoutKey = critiqueAnswerLocal({ question, type: "behavioral", answer, metrics: noKeyAtAll });

    expect(withStray).toEqual(withoutKey);
  });

  it("a genuinely measured, imperfect body-language reading DOES move the composite down — proving the parity cases above exercise real exclusion logic, not dead code", () => {
    const measuredPoor = {
      ...baseMetrics,
      video: {
        hadVideo: true,
        frames: MIN_LUMA_SAMPLES,
        motionSamples: MIN_MOTION_SAMPLES,
        tooDark: false,
        tooBright: false,
        veryStill: false,
        fidgety: false,
      },
      bodyLanguage: {
        available: true,
        eyeContactRatio: 0.1,
        shoulderTilt: 45,
        slouch: 0.1,
        gestureRate: 0.01,
        framing: { centeredRatio: 0.1, tooCloseRatio: 0.9, tooFarRatio: 0 },
      },
    };
    const cameraOff = { ...baseMetrics, bodyLanguage: { available: false } };

    const poor = critiqueAnswerLocal({ question, type: "behavioral", answer, metrics: measuredPoor });
    const off = critiqueAnswerLocal({ question, type: "behavioral", answer, metrics: cameraOff });

    expect(poor.score).toBe(62);
    expect(off.score).toBe(64);
    expect(poor.score).toBeLessThan(off.score);
    expect(poor.delivery.join(" ")).toMatch(/Body language:/);
  });

  it("the composite is a 0-100 integer for every body-language coverage state: no summary, an all-null summary, camera off, and fully measured", () => {
    const allNullSummary = {
      ...baseMetrics,
      bodyLanguage: {
        available: false,
        eyeContactRatio: null,
        shoulderTilt: null,
        lean: null,
        slouch: null,
        gestureRate: null,
        handsVisibleRatio: null,
        framing: { centeredRatio: null, fill: null, tooCloseRatio: null, tooFarRatio: null },
        partiallyOff: false,
        reason: null,
      },
    };
    const fullyMeasured = {
      ...baseMetrics,
      video: {
        hadVideo: true,
        frames: MIN_LUMA_SAMPLES,
        motionSamples: MIN_MOTION_SAMPLES,
        tooDark: false,
        tooBright: false,
        veryStill: false,
        fidgety: false,
      },
      bodyLanguage: {
        available: true,
        eyeContactRatio: 0.9,
        shoulderTilt: 2,
        lean: 0.05,
        slouch: 0.7,
        gestureRate: 0.3,
        handsVisibleRatio: 0.8,
        framing: { centeredRatio: 0.9, fill: 0.3, tooCloseRatio: 0, tooFarRatio: 0 },
      },
    };

    const cases = {
      "no summary": { ...baseMetrics },
      "all-null summary": allNullSummary,
      "camera off": { ...baseMetrics, bodyLanguage: { available: false, reason: "camera-off" } },
      "fully measured": fullyMeasured,
    };

    for (const [label, metrics] of Object.entries(cases)) {
      const result = critiqueAnswerLocal({ question, type: "behavioral", answer, metrics });
      expect(Number.isInteger(result.score), `${label}: score must be an integer`).toBe(true);
      expect(result.score, `${label}: score must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(result.score, `${label}: score must be <= 100`).toBeLessThanOrEqual(100);
    }
  });
});
