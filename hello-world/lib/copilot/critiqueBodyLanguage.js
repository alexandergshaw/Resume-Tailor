// D3's body-language rubric, extracted out of critiqueLocal.js purely to
// stay under that file's 1000-line cap (critiqueLocal.js was already close
// to it before this feature) — there is no architectural reason this
// couldn't live inline; critiqueLocal.js's buildDeliveryNotes/
// computeDeliveryScore call straight into this module exactly as if it
// were still local, and route.js pulls buildBodyLanguageFacts from here
// directly for the Gemini path's ground-truth facts.
//
// D3 layers a body-language read on top of D2's on-device measurements
// (lib/copilot/bodyLanguage.js's summarizeBodyLanguage). The same house
// rule that governs critiqueLocal.js's pace/filler/video scoring governs
// this module too: a null aggregate is NOT MEASURED, never scored or
// worded as if it were. Wording rules (the standard D2 set, restated in
// AC-D3): head orientation is a proxy and must read as "facing the
// camera", never "eye contact", "gaze", or "attention"; posture is
// described only as measured tilt, lean, or slouch; gestures are
// described as hand movement, and hands that were never visible enough to
// measure movement are reported as NOT MEASURED, never as stillness;
// framing is described as position and fill in frame. No emotion,
// confidence, nerves, personality, or appearance language appears
// anywhere below — a camera measured angles and motion, nothing else.

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Finite AND clamped to a sane range — never null (not measured, kept as
// null) but also never an absurd value a malformed or hostile
// `metrics.bodyLanguage` could otherwise smuggle through to both the
// user-facing note and the "ground truth" block handed to Gemini (BUG-10:
// an unclamped value could render as "500%" or "1e+308 degrees").
function numClamped(v, lo, hi) {
  return Number.isFinite(v) ? clamp(v, lo, hi) : null;
}

// Defensively normalizes whatever the caller handed in for
// `metrics.bodyLanguage` to the shape lib/copilot/bodyLanguage.js's
// summarizeBodyLanguage actually produces, mirroring critiqueLocal.js's
// normalizeMetrics video handling: a missing/malformed field degrades to
// null (never a false zero that could be misread as "measured and clear")
// rather than throwing. `available`/`reason` default to false/null so an
// entirely absent summary normalizes to the exact same shape as D2's own
// `available: false` result — see the AC-D3 rule that absent, unavailable,
// and all-null must all behave identically. Exported so critiqueLocal.js's
// normalizeMetrics can fold it into the same normalized `metrics` object
// both engines and route.js already share.
export function normalizeBodyLanguage(raw) {
  const bl = raw && typeof raw === "object" ? raw : {};
  const framingRaw = bl.framing && typeof bl.framing === "object" ? bl.framing : {};
  const ratio = (v) => numClamped(v, 0, 1);
  return {
    available: !!bl.available,
    eyeContactRatio: ratio(bl.eyeContactRatio),
    // Degrees; atan2 against a non-negative x keeps this within [-90, 90]
    // by construction (see postureFrom in bodyLanguage.js) — clamped here
    // anyway as a floor against a hostile/malformed input.
    shoulderTilt: numClamped(bl.shoulderTilt, -90, 90),
    lean: numClamped(bl.lean, -1, 1),
    slouch: numClamped(bl.slouch, 0, 5),
    gestureRate: numClamped(bl.gestureRate, 0, 5),
    handsVisibleRatio: ratio(bl.handsVisibleRatio),
    framing: {
      centeredRatio: ratio(framingRaw.centeredRatio),
      fill: ratio(framingRaw.fill),
      tooCloseRatio: ratio(framingRaw.tooCloseRatio),
      tooFarRatio: ratio(framingRaw.tooFarRatio),
    },
    // BUG-6: carried through so buildBodyLanguageFacts can qualify its
    // "% of the time" facts instead of silently overstating them as
    // whole-answer coverage when the camera was only on for part of it —
    // this was being normalized away entirely before, even though
    // AnswerReview already surfaces the same flag from the raw summary.
    partiallyOff: !!bl.partiallyOff,
    reason: typeof bl.reason === "string" ? bl.reason : null,
  };
}

// Heuristic score thresholds — round numbers in the same unapologetic
// spirit as critiqueLocal.js's FILLER_RATE_GOOD_PCT/VIDEO_LIGHTING_PENALTY:
// there is no universally "correct" value for any of these, only a
// reasonable line between "within a normal range" and "worth a lower
// score."
const SHOULDER_TILT_PENALTY_DEG = 8; // degrees off level before a penalty applies
const SLOUCH_PENALTY_FLOOR = 0.5; // shoulder-to-nose distance (x shoulder width) below this is penalized
const POSTURE_PENALTY = 15;
const GESTURE_STILL_FLOOR = 0.05; // normalized wrist movement per sample below this reads as very still
const GESTURE_PENALTY = 10;
const FRAMING_CENTERED_FLOOR = 0.5;
const FRAMING_PENALTY = 15;

// Head orientation scores directly off the measured facing-the-camera
// ratio — null (excluded, never scored zero) when D2 never cleared its own
// coverage gate for this signal.
function headOrientationScore(bl) {
  return Number.isFinite(bl.eyeContactRatio) ? Math.round(clamp(bl.eyeContactRatio * 100, 0, 100)) : null;
}

// Scores tilt and slouch only. `lean` is deliberately NOT scored here even
// though it is a real posture-adjacent measurement — it is a frame-position
// value (shoulder-midpoint offset from centre), and framingScore below
// already penalizes off-centre framing via `centeredRatio`; scoring it a
// second time here double-counted the same "off to one side" finding under
// two different names (BUG-11). `lean` still appears in
// buildBodyLanguageFacts' text below (the AC's wording rule explicitly
// calls for it) — it just has one scored home, not two.
function postureScore(bl) {
  let measured = false;
  let score = 100;
  if (Number.isFinite(bl.shoulderTilt)) {
    measured = true;
    if (Math.abs(bl.shoulderTilt) > SHOULDER_TILT_PENALTY_DEG) score -= POSTURE_PENALTY;
  }
  if (Number.isFinite(bl.slouch)) {
    measured = true;
    if (bl.slouch < SLOUCH_PENALTY_FLOOR) score -= POSTURE_PENALTY;
  }
  return measured ? Math.max(0, score) : null;
}

// Scores strictly off measured MOVEMENT (gestureRate), never off mere hand
// visibility — hands that were never visible enough to measure movement
// must not read as "held perfectly still" (the standard's explicit rule),
// so this returns null (excluded from the composite) rather than a
// perfect or penalized score whenever movement itself was never measured.
function gestureScore(bl) {
  if (!Number.isFinite(bl.gestureRate)) return null;
  return bl.gestureRate < GESTURE_STILL_FLOOR ? 100 - GESTURE_PENALTY : 100;
}

// tooClose/tooFar are RATIOS (0-1, the share of visible time each flag was
// true), not booleans — scaling the penalty by the ratio itself (rather
// than a flat deduction for any nonzero value) means one transient
// too-close frame costs a sliver of a point, not the same as the whole
// answer being badly framed (BUG-8's disproportionate half).
function framingScore(bl) {
  const fr = bl.framing || {};
  let measured = false;
  let score = 100;
  if (Number.isFinite(fr.centeredRatio)) {
    measured = true;
    if (fr.centeredRatio < FRAMING_CENTERED_FLOOR) score -= FRAMING_PENALTY;
  }
  if (Number.isFinite(fr.tooCloseRatio)) {
    measured = true;
    score -= FRAMING_PENALTY * fr.tooCloseRatio;
  }
  if (Number.isFinite(fr.tooFarRatio)) {
    measured = true;
    score -= FRAMING_PENALTY * fr.tooFarRatio;
  }
  return measured ? Math.max(0, Math.round(score)) : null;
}

// Mirrors critiqueLocal.js's computeVideoScore own null-when-unmeasurable
// pattern, extended to D2's signals: null (not zero) whenever the summary
// is absent, `available: false`, or nothing about it cleared a single
// gate, so a camera that was off is excluded from the delivery composite
// rather than dragging it down as if poor body language had actually been
// observed (the AC-D3 rule that a camera-off user must not lose points for
// it). Exported so critiqueLocal.js's computeDeliveryScore can fold this in
// as a fourth sub-score alongside pace/filler/video, filtered the same way.
//
// Effective weight on the FINAL score (not a defect, just worth stating so
// the next reader does not mistake this for a headline term): this is one
// of up to four equally-weighted inputs to the delivery sub-average, and
// delivery itself is WEIGHT_DELIVERY (0.2) of the overall composite in
// critiqueLocal.js — so at the theoretical extreme (this swinging from 0 to
// 100 with the other three delivery signals present) the FINAL 0-100 score
// moves by roughly 0.25 * 0.2 * 100 = 5 points, and less whenever the other
// delivery components are not themselves at the extremes. A proxy
// measurement should nudge the score, not dominate it — the weights are
// left alone.
export function computeBodyLanguageScore(bl) {
  if (!bl || !bl.available) return null;
  const scores = [headOrientationScore(bl), postureScore(bl), gestureScore(bl), framingScore(bl)].filter(
    (s) => s !== null,
  );
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

// Short, strictly factual sentences (never advice, never a value judgement)
// built ONLY from metrics.bodyLanguage, one per category and only for
// whichever category actually cleared D2's own coverage gate — exported so
// both critiqueLocal.js's own delivery note below AND the Gemini route
// (app/api/copilot/critique/route.js) can hand the model these SAME facts
// as ground truth, exactly like critiqueLocal.js's buildDeliveryNotes
// already does for pace/filler/video. Returns [] (never throws) for a
// summary that is absent, `available: false`, or all-null.
//
// BUG-7: every ratio below (eyeContactRatio, framing.centeredRatio,
// framing.tooCloseRatio, framing.tooFarRatio) is computed over FACE-
// DETECTED samples specifically, not literally every sampled tick of the
// answer (see bodyLanguage.js's summarizeBodyLanguage — the coverage gate
// only guarantees that subset is at least half of the answer). Worded as a
// share of the time your face was visible rather than bare "% of the
// time", which reads as whole-answer coverage it does not have. Framing's
// `fill` is likewise a FACE bounding-box measurement, not a claim about how
// much of the frame the whole person occupies, and is named as such.
export function buildBodyLanguageFacts(bodyLanguage) {
  const bl = bodyLanguage && typeof bodyLanguage === "object" ? bodyLanguage : null;
  if (!bl || !bl.available) return [];
  const facts = [];

  if (Number.isFinite(bl.eyeContactRatio)) {
    facts.push(
      `Head orientation: facing the camera ${Math.round(bl.eyeContactRatio * 100)}% of the time your face was visible to the camera (head orientation, not eye contact).`,
    );
  }

  const postureBits = [];
  if (Number.isFinite(bl.shoulderTilt)) {
    postureBits.push(`shoulder tilt ${Math.abs(bl.shoulderTilt).toFixed(0)} degrees off level`);
  }
  if (Number.isFinite(bl.lean)) {
    postureBits.push(`lean ${Math.abs(Math.round(bl.lean * 100))}% ${bl.lean >= 0 ? "right" : "left"} of frame centre`);
  }
  if (Number.isFinite(bl.slouch)) {
    postureBits.push(`shoulder-to-nose distance ${bl.slouch.toFixed(2)}x shoulder width`);
  }
  if (postureBits.length) facts.push(`Posture: ${postureBits.join("; ")}.`);

  if (Number.isFinite(bl.gestureRate)) {
    const visText = Number.isFinite(bl.handsVisibleRatio)
      ? ` (hands visible ${Math.round(bl.handsVisibleRatio * 100)}% of the time)`
      : "";
    facts.push(`Gestures: hand movement measured ${bl.gestureRate.toFixed(2)} (normalized wrist movement per sample)${visText}.`);
  } else if (Number.isFinite(bl.handsVisibleRatio)) {
    // Hands were seen often enough to measure VISIBILITY but not enough to
    // measure MOVEMENT between consecutive samples — a measurement gap,
    // not stillness, and worded as one.
    facts.push(
      `Gestures: hands visible ${Math.round(bl.handsVisibleRatio * 100)}% of the time, not enough to measure hand movement — a measurement gap, not stillness.`,
    );
  }

  const fr = bl.framing || {};
  const framingBits = [];
  if (Number.isFinite(fr.centeredRatio)) framingBits.push(`centred ${Math.round(fr.centeredRatio * 100)}% of that time`);
  if (Number.isFinite(fr.fill)) framingBits.push(`your face filled about ${Math.round(fr.fill * 100)}% of the frame`);
  // BUG-8: gated on the ROUNDED percentage, not the raw ratio — a ratio that
  // rounds to 0% must not be reported at all, since "sat too close to the
  // camera 0% of the time" is a self-contradiction (a fact claiming nothing
  // happened, about something the score above still penalized).
  const tooClosePct = Number.isFinite(fr.tooCloseRatio) ? Math.round(fr.tooCloseRatio * 100) : 0;
  if (tooClosePct > 0) framingBits.push(`sat too close to the camera ${tooClosePct}% of that time`);
  const tooFarPct = Number.isFinite(fr.tooFarRatio) ? Math.round(fr.tooFarRatio * 100) : 0;
  if (tooFarPct > 0) framingBits.push(`sat too far from the camera ${tooFarPct}% of that time`);
  if (framingBits.length) {
    facts.push(
      `Framing (position and fill in frame, measured over the time your face was visible to the camera): ${framingBits.join("; ")}.`,
    );
  }

  // BUG-6: one leading caveat rather than repeating it in every clause above
  // — mirrors AnswerReview's own partiallyOff alert. Only added when there
  // is other content to qualify; a bare caveat with nothing measured next
  // to it would be confusing on its own, and the "nothing measured" case is
  // already handled by facts staying empty.
  if (bl.partiallyOff && facts.length) {
    facts.unshift("The camera was off for part of this answer, so the figures below reflect only the portion it was on.");
  }

  return facts;
}

// Folds buildBodyLanguageFacts into ONE line for the embedded engine's own
// `delivery` array — not a separate field. The AC-C4-1 response contract is
// locked to its existing eight keys (see route.test.js's "drops any
// unexpected field" case), so body-language content rides inside `delivery`
// exactly the way AC-D3-1 asks, tagged with a "Body language:" prefix so
// the feedback panel (AnswerFeedback.js) can split it back out into its own
// clearly labelled section. Returns null (no line added) whenever nothing
// cleared a gate — never a placeholder "not measured" line, so a camera
// that was off costs nothing and says nothing (AC-D3's explicit rule).
// Exported so critiqueLocal.js's buildDeliveryNotes can call it. Character
// clamping and the delivery-array slot it occupies are both route.js's job
// (see sanitizeCritique) — this function returns the note at whatever
// length the real facts add up to.
export function bodyLanguageDeliveryNote(bodyLanguage) {
  const facts = buildBodyLanguageFacts(bodyLanguage);
  return facts.length ? `Body language: ${facts.join(" ")}` : null;
}
