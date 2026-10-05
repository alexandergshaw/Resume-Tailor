// N105 Step 7 - the pure bridge between a tailoring entry that carries an Ideal
// run and the two-output preview surface that shows it. No React, no IO.
//
// An entry's `ideal` block is what the pipeline returned (idealPipeline.js): the
// two drafts, `review`, and the gate's own output (`removed`, `leftOut`,
// `counts`) at the TOP of the block. The Application-ready band reads those
// three from INSIDE `review`, so this module is the one place that joins them
// and hands the band the shape it reads.
//
//   - A live review (Step 9) keeps every field it carries; only the three gate
//     lists are filled in underneath it when it has none of its own.
//   - A null review with gate output present (slice 1) becomes a review-shaped
//     object with NO coverage. reviewVerdict reads a missing coverage as
//     "partial, unknown", never as complete, so the band says nothing was fully
//     checked while still listing what the gate removed and left out.
//   - A null review and no gate output stays null: the band's "review did not
//     run" state.
// Nothing here can make a result read clean: the clean verdict needs
// coverage.complete === true, which only a reviewer can supply.
//
// Flag lists are passed through untouched unless they are arrays: a list that is
// not an array is UNKNOWN to the band, and turning it into [] would turn
// unknown into "no findings".

import { editedForScope } from "../document/previewBlob.js";
import { textRows } from "../review/flagPresentation.js";
import { resolveFlagExcerpts } from "../review/resolveFlagExcerpts.js";
import { FRESHNESS, idealBandState } from "./idealBandState.js";
import { resolveActiveDocumentTitle } from "./documentScopes.js";

const RESUME_TAB_LABEL = "Application-ready";
const HYPOTHETICAL_TAB_LABEL = "HYPOTHETICAL";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// A reviewer flag carries span ids, never text. When the response supplies the
// id -> text tables (`ideal.spanTexts`: { applicationReady, hypothetical,
// realMaterial, posting }, each { [id]: text }) the shared join
// (lib/review/resolveFlagExcerpts.js, also N103's) resolves the lines onto
// `excerpt` and `evidenceExcerpt` so the panel can quote them.
function bandIdealFor(ideal) {
  const review = isObject(ideal.review) ? ideal.review : null;
  const hasGateOutput = Array.isArray(ideal.removed) || Array.isArray(ideal.leftOut);
  if (review === null && !hasGateOutput) return ideal;
  const base = review ?? {};
  const joined = {
    ...base,
    removed: base.removed ?? ideal.removed,
    leftOut: base.leftOut ?? ideal.leftOut,
    counts: base.counts ?? ideal.counts,
  };
  if (Array.isArray(base.flags)) joined.flags = resolveFlagExcerpts(base.flags, ideal.spanTexts);
  return { ...ideal, review: joined };
}

function hypotheticalLinesOf(hypothetical) {
  if (Array.isArray(hypothetical?.resultLines) && hypothetical.resultLines.length > 0) {
    return hypothetical.resultLines.map((line) => (typeof line === "string" ? line : ""));
  }
  return String(hypothetical?.result ?? "").split("\n");
}

/**
 * idealSurfaceFor(entry, { title, company })
 *
 * => null for an entry with no Ideal run (every level 1-5 job), else
 *    { ideal,            the `ideal` block in the shape IdealResultBands reads
 *      currentText,      the application-ready text on screen
 *      handEdited,       the resume scope was edited by hand
 *      resumeTabLabel,   "Application-ready", or null when the review no longer
 *                        belongs to the file on screen (the tab reads "Resume")
 *      announces,        the band has Copy-line rows, so it needs the preview's
 *                        live-region pair to announce a copy
 *      reviewCovered,    the band shows a live reviewer result for exactly the
 *                        text on screen (fresh, with usable coverage), so N103's
 *                        on-demand review says so instead of a second verdict
 *      hypothetical,     { available, text, fileName, tabLabel } for the dialog's
 *                        `scopes.hypothetical`; fileName is the marked name the
 *                        download resolves to
 *      hypotheticalLines the hypothetical's own lines (never the application-
 *                        ready's), for the read-only render }
 */
export function idealSurfaceFor(entry, { title = "", company = "" } = {}) {
  if (!isObject(entry?.ideal)) return null;
  const ideal = bandIdealFor(entry.ideal);
  const currentText = typeof entry.result === "string" ? entry.result : "";
  const handEdited = editedForScope(entry, "resume");
  const state = idealBandState({ ideal, currentText, handEdited });
  const hypotheticalText = typeof entry.ideal.hypothetical?.result === "string" ? entry.ideal.hypothetical.result : "";
  return {
    ideal,
    currentText,
    handEdited,
    resumeTabLabel: state.tabReverts ? null : RESUME_TAB_LABEL,
    announces: state.groups === "all" && textRows(ideal.review?.removed).length > 0,
    reviewCovered: state.freshness === FRESHNESS.FRESH && state.coverage.usable,
    hypothetical: {
      available: hypotheticalText.trim().length > 0,
      text: hypotheticalText,
      // The committed name is forced through the marker resolver, so what the
      // banner shows is exactly what the download is named.
      fileName: resolveActiveDocumentTitle("", entry.hypotheticalFileName, title, company, "Resume", true),
      tabLabel: HYPOTHETICAL_TAB_LABEL,
    },
    hypotheticalLines: hypotheticalLinesOf(entry.ideal.hypothetical),
  };
}
