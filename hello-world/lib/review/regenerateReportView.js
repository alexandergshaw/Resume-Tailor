// N104 - the words and rows of "What regenerating changed". PURE: it turns a
// ClosureReport (compareReviewGaps) plus the new run's own counts into the report's
// headline, groups, sentences and footer. It decides nothing about the documents;
// it only says what the two reviews showed.
//
//   regenerateReportView({ closure, setAside, confirmCount, textUnchanged,
//                          hypotheticalRebuilt })
//     -> { headline, footer, lines, groups, unchanged, correspondenceUnavailable,
//          announcement, facts }
//
//   groups[]      { title, hint?, rows: [{ key, label, term? }] }  - `label` is this
//                 view's own fixed wording; `term` is the posting's keyword, shown as
//                 quoted data and not as wording
//   lines[]       plain sentences
//   announcement  the one short sentence a screen reader is told when the run ends
//   facts         { before, after, newlyFlagged }: counts only, for the activity log
//
// Two promises the view keeps by itself, so a break on either side of it cannot
// ship a false claim:
//
//   - The guard. When the two reviews' requirement ids did not correspond
//     (correspondenceUnavailable) no individual suggestion is reported as "no longer
//     flagged" or "still flagged", even if it is handed rows saying so: a renamed
//     requirement would make a gap that is still missing look gone. Only totals,
//     which need no identity, are reported.
//   - The vocabulary. The mechanical review detects whether a posting term is
//     PRESENT, not that a gap was dealt with, so this chrome only says what the
//     checks flagged: never fixed, resolved, addressed, closed or filled, and never
//     ATS, score or optimize. An empty part is omitted rather than printed as a
//     zero or "none", so an all-clear can never be read off this report.

const FOOTER = "This compares what the checks that ran flagged. It is not a verdict on the whole resume.";
const UNCHANGED_HEADLINE =
  "Regenerated, but the text came out the same, so nothing changed. Your resume may not support more wording for these.";
const GUARDED_HEADLINE =
  "Regenerated. Individual suggestions could not be matched to the earlier review, so only totals are shown.";

const TITLE = { closed: "No longer flagged", still: "Still flagged", added: "Newly flagged" };
const HINT = {
  still: "The new version did not change these.",
  added: "These were not flagged in the version before.",
};

// The three wording checks the comparison counts, with the label each is shown under.
const CATEGORY_LINES = [
  { key: "missingKeyword", label: "Posting keywords flagged" },
  { key: "vague", label: "Vague wording" },
  { key: "repetition", label: "Repeated phrasing" },
];

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const plural = (n, one, many) => (n === 1 ? one : many);

function rowsOf(gaps) {
  return (Array.isArray(gaps) ? gaps : []).map((gap, index) => ({
    key: `${gap.requirementId}-${index}`,
    label: gap.label,
    term: gap.term,
  }));
}

// What each category's total did. A category that rose is "newly flagged"; the rest
// are plain before/now lines, left out when neither side had anything flagged. The
// per-keyword rows already speak for the keyword category when identities held.
function categoryChanges(closure, perGapShown) {
  const added = [];
  const lines = [];
  let newlyFlagged = 0;
  for (const { key, label } of CATEGORY_LINES) {
    const before = count(closure.countsBefore?.[key]);
    const after = count(closure.countsAfter?.[key]);
    if (after > before) newlyFlagged += after - before;
    if (key === "missingKeyword" && perGapShown && after <= before) continue;
    if (before === 0 && after === 0) continue;
    if (after > before) {
      added.push({ key: `added-${key}`, label: `${label}: ${before > 0 ? `${before} before, ` : ""}${after} now.` });
    } else if (after === 0) {
      lines.push(`${label}: ${before} before, not flagged now.`);
    } else {
      lines.push(`${label}: ${before} before, ${after} now.`);
    }
  }
  return { added, lines, newlyFlagged };
}

function setAsideLine(setAside) {
  const removed = count(setAside?.removed);
  const leftOut = count(setAside?.leftOut);
  if (removed === 0 && leftOut === 0) return null;
  const tail = "They are listed in the review.";
  if (removed > 0 && leftOut > 0) {
    return `${removed} ${plural(removed, "line was", "lines were")} set aside for you to verify and ${leftOut} left out because your resume does not support them. ${tail}`;
  }
  if (removed > 0) return `${removed} ${plural(removed, "line was", "lines were")} set aside for you to verify. ${tail}`;
  return `${leftOut} ${plural(leftOut, "line was", "lines were")} left out because your resume does not support ${plural(leftOut, "it", "them")}. ${tail}`;
}

function stillListedLines(unqualified, confirmCount) {
  const parts = [];
  if (unqualified > 0) {
    parts.push(`${unqualified} ${plural(unqualified, "requirement", "requirements")} your resume cannot meet by rewording`);
  }
  if (confirmCount > 0) parts.push(`${confirmCount} to confirm`);
  if (parts.length === 0) return [];
  const lines = [`Still listed in the review: ${parts.join(", ")}.`];
  if (unqualified > 0) lines.push("If you do have that experience, add it to your resume and run again.");
  return lines;
}

function headlineOf({ closedCount, stillCount, guarded, hasDetail }) {
  if (guarded) return GUARDED_HEADLINE;
  const total = closedCount + stillCount;
  if (closedCount > 0) {
    return `Regenerated. ${closedCount} of ${total} ${plural(total, "suggestion is", "suggestions are")} no longer flagged.`;
  }
  if (stillCount > 0) return `Regenerated. The ${stillCount} ${plural(stillCount, "suggestion is", "suggestions are")} still flagged.`;
  return hasDetail ? "Regenerated. Totals for the checks that ran are listed below." : "Regenerated.";
}

// What a screen reader is told when the run ends: the same claim as the headline, in
// one short sentence, and just as unable to say more than the comparison measured.
function announcementOf({ closedCount, stillCount, newlyFlagged, guarded }) {
  if (guarded) return GUARDED_HEADLINE;
  const total = closedCount + stillCount;
  const added = newlyFlagged > 0 ? ` ${newlyFlagged} newly flagged.` : "";
  if (closedCount > 0) return `Regenerated. ${closedCount} of ${total} no longer flagged.${added}`;
  if (stillCount > 0) return `Regenerated. ${stillCount} still flagged.${added}`;
  return `Regenerated.${added}`;
}

export function regenerateReportView({ closure, setAside, confirmCount, textUnchanged, hypotheticalRebuilt } = {}) {
  const guarded = closure?.correspondenceUnavailable === true;
  const base = { footer: FOOTER, correspondenceUnavailable: guarded };

  if (textUnchanged === true) {
    return {
      ...base,
      headline: UNCHANGED_HEADLINE,
      lines: [],
      groups: [],
      unchanged: true,
      announcement: "Regenerated. The text did not change.",
      facts: { before: 0, after: 0, newlyFlagged: 0 },
    };
  }

  // Under the guard no per-suggestion row survives, whatever it was handed.
  const closed = guarded ? [] : rowsOf(closure?.closed);
  const stillOpen = guarded ? [] : rowsOf(closure?.stillOpen);
  const { added, lines: categoryLines, newlyFlagged } = categoryChanges(closure ?? {}, !guarded);

  const groups = [];
  if (closed.length > 0) groups.push({ title: TITLE.closed, rows: closed });
  if (stillOpen.length > 0) groups.push({ title: TITLE.still, hint: HINT.still, rows: stillOpen });
  if (added.length > 0) groups.push({ title: TITLE.added, hint: HINT.added, rows: added });

  const lines = [...categoryLines];
  const before = closure?.lineCountBefore;
  const after = closure?.lineCountAfter;
  if (Number.isFinite(before) && Number.isFinite(after) && before > 0 && after > 0 && before !== after) {
    lines.push(`Length: ${before} lines before, ${after} now.`);
  }
  const aside = setAsideLine(setAside);
  if (aside) lines.push(aside);
  const unqualified = Array.isArray(closure?.genuinelyUnqualifiedStillOpen) ? closure.genuinelyUnqualifiedStillOpen.length : 0;
  lines.push(...stillListedLines(unqualified, count(confirmCount)));
  if (hypotheticalRebuilt === true) lines.push("The HYPOTHETICAL version was also rebuilt.");

  const headline = headlineOf({
    closedCount: closed.length,
    stillCount: stillOpen.length,
    guarded,
    hasDetail: groups.length > 0 || lines.length > 0,
  });
  return {
    ...base,
    headline,
    lines,
    groups,
    unchanged: false,
    announcement: announcementOf({ closedCount: closed.length, stillCount: stillOpen.length, newlyFlagged, guarded }),
    facts: { before: closed.length + stillOpen.length, after: stillOpen.length, newlyFlagged },
  };
}
