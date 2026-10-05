// N104 - what the Regenerate row needs to know about the document on screen, derived
// from the two places a live review can come from. PURE; no React, no IO.
//
//   regenerateSurfaceFor({ scope, idealSurface, request, strip, engine,
//                          idealEnabled, inFlight })
//     -> { state, counts, inputs, handEdited, report, live }
//   live = null | { source, fresh, review: { flags, unresolvedQualifications,
//                                            lineCount, inputs: { posting, realMaterial } } }
//
//   regenerateInputsFor({ idealSurface, live }) -> { pinnedAnalysis, beforeReview }
//
// One review per text version, never two: on an Ideal resume the review that shipped
// with it (the band) describes the text while it is unedited; once it is edited, the
// review the user ran on the new text (the strip) describes it, if they have. A review
// that no longer describes the text on screen is reported `fresh: false` and the row
// asks for a new one. Both sources are read as they are; nothing here runs a detector
// or mints a span.
//
// The classes the row's captions count come from classifyWeaknesses over that one
// review, and the state from regenerateAvailability: this module only gathers the
// descriptor, it decides nothing itself.

import { classifyWeaknesses } from "../review/classifyWeaknesses.js";
import { regenerateAvailability } from "../review/regenerateAvailability.js";
import { FRESHNESS, idealBandState } from "./idealBandState.js";

const norm = (text) => String(text ?? "").replace(/\r\n?/g, "\n").trim();
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const wellFormed = (item) => isObject(item) && typeof item.id === "string" && typeof item.text === "string" && item.text.trim() !== "";

// The text of a review request, the same way the review strip reads it.
function requestText(request) {
  if (Array.isArray(request?.resultLines) && request.resultLines.length > 0) return request.resultLines.join("\n");
  return typeof request?.text === "string" ? request.text : "";
}

// The review that came with an Ideal result: over the lines that ship, scored against
// the posting it was built for and the resume it was checked against.
function bandReview(idealSurface) {
  const { ideal } = idealSurface;
  const review = ideal?.review;
  if (!isObject(review) || !Array.isArray(review.flags)) return null;
  const freshness = idealBandState({
    ideal,
    currentText: idealSurface.currentText,
    handEdited: idealSurface.handEdited,
  }).freshness;
  return {
    fresh: freshness === FRESHNESS.FRESH,
    review: {
      flags: review.flags,
      unresolvedQualifications: Array.isArray(review.unresolvedQualifications) ? review.unresolvedQualifications : [],
      lineCount: review.counts?.kept,
      inputs: {
        posting: (Array.isArray(ideal.postingAnalysis?.requirements) ? ideal.postingAnalysis.requirements : []).some(wellFormed),
        realMaterial: true,
      },
    },
  };
}

function outcomeReview(outcome) {
  return {
    flags: Array.isArray(outcome.flags) ? outcome.flags : [],
    unresolvedQualifications: Array.isArray(outcome.unresolvedQualifications) ? outcome.unresolvedQualifications : [],
    lineCount: outcome.lineCount,
    inputs: { posting: outcome.inputs?.posting === true, realMaterial: outcome.inputs?.realMaterial === true },
  };
}

function liveReview({ idealSurface, strip, onScreenText } = {}) {
  const ran = isObject(strip?.outcome) && strip.outcome.status === "reviewed";
  const stripFresh = ran && norm(strip.text) === norm(onScreenText);
  const fromStrip = (fresh) => ({ source: "strip", fresh, review: outcomeReview(strip.outcome) });

  if (idealSurface) {
    const band = bandReview(idealSurface);
    if (band?.fresh) return { source: "ideal-band", fresh: true, review: band.review };
    if (stripFresh) return fromStrip(true);
    return band ? { source: "ideal-band", fresh: false, review: band.review } : null;
  }
  return ran ? fromStrip(stripFresh) : null;
}

export function regenerateSurfaceFor({ scope, idealSurface, request, strip, engine, idealEnabled, inFlight } = {}) {
  const live =
    scope === "resume" || scope === "cover"
      ? liveReview({ idealSurface: scope === "resume" ? idealSurface : null, strip, onScreenText: requestText(request) })
      : null;
  const classes = live ? classifyWeaknesses(live.review) : null;
  const counts = {
    resolvable: classes ? classes.resolvable.length : 0,
    confirm: classes ? classes.confirm.length : 0,
    unqualified: classes ? classes.genuinelyUnqualified.length : 0,
  };
  const state = regenerateAvailability({
    tab: scope,
    jobKind: idealSurface ? "ideal" : "standard",
    idealEnabled,
    engine,
    reviewSource: live,
    fresh: live?.fresh,
    inputs: live?.review.inputs,
    resolvableCount: counts.resolvable,
    inFlight,
  });
  return {
    state,
    counts,
    inputs: live?.review.inputs,
    handEdited: Boolean(idealSurface?.handEdited),
    report: idealSurface?.ideal?.regenerateReport ?? null,
    live,
  };
}

// The run the regenerate improves on, as the request carries it: the posting analysis
// the on-screen run was scored against and the review of the text on screen.
export function regenerateInputsFor({ idealSurface, live }) {
  const ideal = idealSurface?.ideal;
  return {
    pinnedAnalysis: { postingAnalysis: ideal?.postingAnalysis, keywordMap: ideal?.keywordMap },
    beforeReview: live?.review,
  };
}
