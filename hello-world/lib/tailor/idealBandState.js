// N105 Step 8 - the pure state machine behind the Application-ready band, and the
// one place the clean verdict is licensed.
//
// The worst outcome this band can produce is a partial or absent review showing
// "No issues flagged" over a draft nobody analysed: the user submits believing
// they passed. So the clean verdict is a single boolean, `verdictClean`, that is
// true in exactly ONE of the 36 combinations of
//   freshness (fresh | edited | other-version)
//   review kind (none | partial | complete)
//   thin (yes | no)
//   findings (yes | no)
// namely fresh + complete + not thin + no findings. Every other combination
// gets its own copy, and none of it contains a clean-verdict phrase. The
// function is total: it never throws and unusable input fails to the closed
// (not-clean) side.
//
// The three axes:
//   R  reviewVerdict(review), the shared rule N103/N104 also use
//   F  does the text on screen still equal the text that was reviewed
//   T  did the gate keep any accomplishment at all (thin = kept none)

import { reviewVerdict, REVIEW_KIND } from "../review/reviewVerdict.js";

export const FRESHNESS = Object.freeze({
  FRESH: "fresh",
  EDITED: "edited",
  OTHER_VERSION: "other-version",
});

// Chrome text for the band. No string here, other than `clean`, may contain a
// clean-verdict phrase; the partial and no-review wording says what was NOT
// checked, never that something passed.
export const BAND_COPY = Object.freeze({
  otherVersion:
    "A different saved version is showing. The review belongs to the version that was generated, so it is hidden.",
  noReview: "The review did not run for this result. Treat every line as unchecked.",
  partial: "Partial review - mechanical checks only.",
  partialClosing: "Read the whole resume once before you send.",
  partialUnknownCoverage:
    "Which checks ran is unknown for this result. Treat the whole resume as unchecked.",
  clean: "No issues flagged. The automated review is not a guarantee - read it once before you send.",
  header: "Application-ready - built only from claims found in your resume.",
  edited:
    "You have edited this resume since the review ran. The notes below describe the version that was generated.",
  thin:
    "None of the hypothetical's claims could be matched to your resume, so this version has only your employers, dates and education. Add detail to your resume and run again.",
  thinSetAside: "Some lines were set aside for you to verify - see Removed below.",
});

function normalize(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").trim();
}

// Text equality is checked FIRST, on both sides normalised, so a result whose
// stored text differs only by a trailing newline still reads fresh and a
// spurious "hand edited" flag over unchanged text does too.
function freshnessOf(reviewedText, currentText, handEdited) {
  const reviewed = normalize(reviewedText);
  if (reviewed !== "" && normalize(currentText) === reviewed) return FRESHNESS.FRESH;
  return handEdited ? FRESHNESS.EDITED : FRESHNESS.OTHER_VERSION;
}

function findingCounts(review) {
  const removed = review?.removed;
  const flags = review?.flags;
  const unresolved = review?.unresolvedQualifications;
  const leftOut = review?.leftOut;
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    removed: len(removed),
    flags: len(flags),
    unresolved: len(unresolved),
    leftOut: len(leftOut),
    total: len(removed) + len(flags) + len(unresolved),
    // A list that is not an array is unknown, not empty: it cannot license "clean".
    known: Array.isArray(removed) && Array.isArray(flags) && Array.isArray(unresolved),
  };
}

// idealBandState({ ideal, currentText, handEdited })
//   ideal        the response's `ideal` block ({ applicationReady, review, ... })
//   currentText  the application-ready text now on screen
//   handEdited   the user edited this scope (text-only saves set this too)
export function idealBandState({ ideal, currentText, handEdited } = {}) {
  const review = ideal?.review ?? null;
  const verdict = reviewVerdict(review);
  const freshness = freshnessOf(ideal?.applicationReady?.result, currentText, handEdited);
  const counts = findingCounts(review);

  const kept = review?.counts?.keptAccomplishments;
  const thin = kept === 0;
  // "Not thin" must be established, not assumed from a missing count.
  const substantiated = Number.isFinite(kept) && kept > 0;

  const verdictClean =
    verdict.kind === REVIEW_KIND.COMPLETE &&
    freshness === FRESHNESS.FRESH &&
    counts.known &&
    counts.total === 0 &&
    substantiated;

  let headline;
  let tone = "info";
  let groups = "all";
  if (freshness === FRESHNESS.OTHER_VERSION) {
    headline = BAND_COPY.otherVersion;
    groups = "none";
  } else if (verdict.kind === REVIEW_KIND.NONE) {
    headline = BAND_COPY.noReview;
    tone = "warning";
    groups = "none";
  } else if (verdict.kind === REVIEW_KIND.PARTIAL) {
    headline = BAND_COPY.partial;
    tone = "warning";
  } else if (verdictClean) {
    headline = BAND_COPY.clean;
    groups = "leftOutOnly";
  } else {
    headline = BAND_COPY.header;
  }

  const notes = [];
  if (groups !== "none") {
    if (freshness === FRESHNESS.EDITED) notes.push(BAND_COPY.edited);
    if (thin) {
      notes.push(BAND_COPY.thin);
      if (counts.removed > 0) notes.push(BAND_COPY.thinSetAside);
    }
  }

  const coverageUsable =
    review !== null &&
    typeof review === "object" &&
    review.coverage !== null &&
    typeof review.coverage === "object" &&
    Array.isArray(review.coverage.evaluatedCategories);

  // The collapsed (mobile) summary must carry the partial state so it is read
  // without expanding anything.
  const partialHeadline = headline === BAND_COPY.partial;
  let mobileSummary = headline;
  if (partialHeadline) {
    mobileSummary = counts.total > 0 ? `Partial review - ${counts.total} to check` : "Partial review";
  }

  return {
    review: verdict.kind,
    freshness,
    thin,
    verdictClean,
    headline,
    tone,
    notes,
    groups,
    mobileSummary,
    // The tab reads "Resume" again when the review no longer belongs to the file.
    tabReverts: freshness === FRESHNESS.OTHER_VERSION,
    counts,
    // Category ids; the render layer maps them to plain-language names for the
    // "Checked: ... Not fully checked: ..." line (or the unknown-coverage line).
    coverage: {
      usable: coverageUsable,
      ran: verdict.checkedChecks,
      missing: verdict.missingChecks,
    },
  };
}
