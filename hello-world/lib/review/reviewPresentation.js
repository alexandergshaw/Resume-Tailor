// N103 Step 4 - what a review result may SAY, PURE (no React, no IO).
//
// This is where the chunk's reason to exist lives. A mechanical review that found
// nothing must never read as "no problems", because three of the seven checks never
// ran and the user would send the document believing they passed.
//
//   reviewPresentationState({ outcome, freshness, covered })
//     -> { state, tone, headline, summary, notice, footer, announce, hideUnresolved }
//
//   outcome    a ReviewOutcome (runDocumentReview) or { status: "failed" }
//   freshness  "fresh" | "stale": does the text on screen still equal the text
//              that was reviewed
//   covered    another surface already shows a live review of exactly this text
//
//   notice = { checked, notChecked, sentences }   all plain strings, no markup
//
// The rules, each one a place a wrong build would read as reassurance:
//
//   AC-1   Reassuring copy is licensed in exactly ONE combination: the shared
//          verdict is COMPLETE, the text is fresh, there are no findings, the
//          document is non-empty and the surface gave the reviewer both inputs.
//          It is NEVER gated on `flags.length`: an empty list over a partial
//          review is a partial review.
//   A-1a   Coverage says which checks RAN, not whether they had anything to work
//          on. With no posting requirements the keyword check is listed as
//          evaluated over an empty list. When an input was withheld, the check
//          that needed it moves from Checked to Not fully checked for DISPLAY,
//          and one plain sentence says so.
//   A-2    "mechanical checks only" is a statement about the ENGINE, true only
//          while engineMode is "mechanical-only". It is derived, never typed in
//          as the default, so a later judge that reports fewer than seven
//          categories does not inherit a false suffix.
//   AC-10  An empty document is its own state with its own sentence.
//
// Every check name comes from the shared registry (checkLabel), so a renamed label
// follows it. Unusable input falls to the not-clean side.

import { CATEGORY } from "./contract.js";
import { REVIEW_KIND } from "./reviewVerdict.js";
import { DRAFT_KIND, TIER, bandSummary, checkLabel, groupFlagsBySpan, textRows } from "./flagPresentation.js";

export const REVIEW_STATE = Object.freeze({
  EMPTY: "empty",
  FAILED: "failed",
  COVERED: "covered",
  PARTIAL: "partial",
  FINDINGS: "findings",
  CLEAN: "clean",
  STALE: "stale",
});

export const REVIEW_FRESHNESS = Object.freeze({ FRESH: "fresh", STALE: "stale" });

// No string here, other than `clean`, may contain a reassuring phrase: the partial
// and empty wording says what was NOT checked or that nothing was read. Private:
// the one consumer of these sentences is the state function below.
const REVIEW_COPY = Object.freeze({
  empty: "Nothing to review - this document has no text yet.",
  failed: "The review could not run, so nothing was checked. Try again.",
  covered: "The review above already covers this text. Edit the document, then review again to check your changes.",
  partialMechanical: "Partial review - mechanical checks only.",
  partial: "Partial review.",
  clean: "No issues flagged. The automated review is not a guarantee - read it once before you send.",
  closing: "Read the whole document once before you send.",
  unknownCoverage: "Which checks ran is unknown for this result. Treat the whole document as unchecked.",
  noPosting: "No job posting was available, so keywords were not matched.",
  noRealMaterial:
    "Your uploaded resume was not available to compare against, so role and seniority claims could not be checked against it.",
  staleNote:
    "You have edited this document since this review ran. The notes below describe the earlier text. Review again to check your changes.",
  staleNothing: "This review ran on an earlier version of the text. Review again to check what is on screen now.",
  footer: "These notes are for this session only and change nothing in your document.",
  announceEmpty: "Nothing to review.",
  announceFailed: "The review could not run.",
  announceCovered: "The review above already covers this text.",
  announceClean: "Review finished. No issues flagged.",
});

const MECHANICAL_ONLY = "mechanical-only";
const CATEGORY_ORDER = Object.values(CATEGORY);
const list = (value) => (Array.isArray(value) ? value : []);

function silent(state, headline, announce, tone = "info") {
  return {
    state,
    tone,
    headline,
    summary: "",
    notice: { checked: [], notChecked: [], sentences: [] },
    footer: "",
    announce,
    hideUnresolved: false,
  };
}

// The inputs the surface withheld, each with the one check that needed it. A
// hypothetical is judged against itself, so it never needs real material.
function withheldInputs(outcome) {
  const inputs = outcome.inputs && typeof outcome.inputs === "object" ? outcome.inputs : {};
  const withheld = [];
  if (inputs.posting !== true) withheld.push({ category: CATEGORY.MISSING_KEYWORD, sentence: REVIEW_COPY.noPosting });
  if (outcome.draftKind !== DRAFT_KIND.HYPOTHETICAL && inputs.realMaterial !== true) {
    withheld.push({ category: CATEGORY.UNSUPPORTED_AUTHORITY, sentence: REVIEW_COPY.noRealMaterial });
  }
  return withheld;
}

function noticeFor(outcome, withheld, closing) {
  const moved = new Set(withheld.map((item) => item.category));
  const checked = list(outcome.checkedChecks).filter((category) => !moved.has(category));
  const notChecked = [...list(outcome.missingChecks)];
  for (const category of moved) if (!notChecked.includes(category)) notChecked.push(category);
  notChecked.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

  const sentences = withheld.map((item) => item.sentence);
  if (checked.length === 0 && notChecked.length === 0) sentences.push(REVIEW_COPY.unknownCoverage);
  if (closing) sentences.push(REVIEW_COPY.closing);
  return { checked: checked.map(checkLabel), notChecked: notChecked.map(checkLabel), sentences };
}

export function reviewPresentationState({ outcome, freshness = REVIEW_FRESHNESS.FRESH, covered = false } = {}) {
  if (covered === true) return silent(REVIEW_STATE.COVERED, REVIEW_COPY.covered, REVIEW_COPY.announceCovered);
  if (outcome?.status === "empty") return silent(REVIEW_STATE.EMPTY, REVIEW_COPY.empty, REVIEW_COPY.announceEmpty);
  if (outcome?.status !== "reviewed") {
    return silent(REVIEW_STATE.FAILED, REVIEW_COPY.failed, REVIEW_COPY.announceFailed, "warning");
  }

  const draftKind = outcome.draftKind === DRAFT_KIND.HYPOTHETICAL ? DRAFT_KIND.HYPOTHETICAL : DRAFT_KIND.APPLICATION_READY;
  const withheld = withheldInputs(outcome);
  const hideUnresolved = withheld.some((item) => item.category === CATEGORY.UNSUPPORTED_AUTHORITY);

  const rows = groupFlagsBySpan(list(outcome.flags), draftKind);
  const confirm = rows.filter((row) => row.tier === TIER.CONFIRM).length;
  const requirements = hideUnresolved ? 0 : textRows(outcome.unresolvedQualifications).length;
  const toCheck = rows.length + requirements;
  const summary = bandSummary({ confirm, requirements, suggestions: rows.length - confirm });

  // AC-1: the single clean license. Read from the verdict, never from flags.length.
  const complete = outcome.verdictKind === REVIEW_KIND.COMPLETE && withheld.length === 0;
  const fresh = freshness !== REVIEW_FRESHNESS.STALE;
  const hasText = Number(outcome.lineCount) > 0;

  let state = REVIEW_STATE.PARTIAL;
  if (complete && toCheck > 0) state = REVIEW_STATE.FINDINGS;
  else if (complete && fresh && hasText) state = REVIEW_STATE.CLEAN;

  const mechanical = outcome.engineMode === MECHANICAL_ONLY;
  const partialHeadline = mechanical ? REVIEW_COPY.partialMechanical : REVIEW_COPY.partial;

  const base = {
    tone: state === REVIEW_STATE.PARTIAL ? "warning" : "info",
    summary,
    footer: REVIEW_COPY.footer,
    hideUnresolved,
  };

  if (state === REVIEW_STATE.CLEAN) {
    const notice = { checked: [], notChecked: [], sentences: [] };
    return { ...base, state, headline: REVIEW_COPY.clean, notice, announce: REVIEW_COPY.announceClean };
  }

  const closing = draftKind !== DRAFT_KIND.HYPOTHETICAL;
  const notice = state === REVIEW_STATE.PARTIAL ? noticeFor(outcome, withheld, closing) : { checked: [], notChecked: [], sentences: [] };
  const headline = state === REVIEW_STATE.FINDINGS ? summary : partialHeadline;
  const announce =
    state === REVIEW_STATE.FINDINGS
      ? `Review finished. ${toCheck} to check.`
      : `Review finished.${toCheck > 0 ? ` ${toCheck} to check.` : ""} Partial review: some checks did not run.`;

  if (!fresh) {
    // The text moved on since this ran. What is shown stays as a to-do list over the
    // earlier text, never as a verdict on what is on screen now, and it is not
    // announced: it flips while the user types.
    notice.sentences = [REVIEW_COPY.staleNote, ...notice.sentences];
    return {
      ...base,
      tone: "warning",
      state: REVIEW_STATE.STALE,
      headline: toCheck > 0 ? headline : REVIEW_COPY.staleNothing,
      notice,
      announce: "",
    };
  }
  return { ...base, state, headline, notice, announce };
}
