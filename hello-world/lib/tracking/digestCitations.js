// The single WRITE-time pass: the model's raw answer in, the three values the
// row is built from out -- `markdown`, `sources`, and the `citation_outcome`
// record.
//
// THE OBSERVABILITY INVARIANT IS THIS MODULE'S MOST VALUABLE OUTPUT, and it is
// the half most likely to be dropped as "extra fields", so it is stated here
// rather than only in the plan:
//
//   Every stage that can narrow a set records its INPUT count beside its
//   OUTPUT count, the pair travels into storage together, and the chain is
//   monotone:
//
//       searched(bool) >= annotations >= urlsUsable >= spansUsable
//                      >= splicesSafe >= placed
//
//   A NON-ZERO INPUT BECOMING A ZERO OUTPUT IS A REPORTABLE ANOMALY, not a
//   normal empty. It is only a normal empty when the input was also zero.
//
// The single number that would have made this feature's original defect loud
// on day one is "grounding returned chunks and zero citations survived". The
// route already computed both halves, one line apart, and joined them
// nowhere -- so the defect was invisible for the life of the feature while
// every digest silently persisted an empty source list. `counts` plus
// `anomaly` is that join, made durable. Every one of these zeros is
// individually legitimate; what is never legitimate is ten in, zero out, and
// no record of which stage ate them. So the anomaly NAMES the stage and
// `refused.reasons` / `refused.spanReasons` name why.
//
// TWO ADDITIONS TO THE RECORD'S PUBLISHED SHAPE, both deliberate:
//   * `urlsUsable`, between `annotations` and `spansUsable`. Without it, a
//     digest in which every annotation carried an unusable url reports
//     `spansUsable: 0` and blames span conversion -- naming the wrong stage,
//     which is worse than naming none.
//   * `refused.spanReasons`, a SPARSE map of the span refusal codes actually
//     seen. `unusableSpan: 5` says five citations died; it does not say
//     whether the vendor sent byte offsets we could not land on a character
//     boundary or offsets of the wrong type entirely, and those call for
//     different action.
//
// ORDER OF OPERATIONS, and why each step is where it is:
//
//   1. Scan the RAW text for residue. The count is taken here, BEFORE
//      coalescing, because coalescing is a removal-safety measure and must
//      never be allowed to under-report what the model wrote.
//   2. Remove it. The stored markdown is what the model wrote MINUS the
//      citation-shaped artefacts, and nothing else. No marker is ever stored,
//      on any path.
//   3. Resolve every annotation's BYTE offsets against the RAW text -- the
//      exact string the vendor's numbers were computed against -- then move
//      the resulting UTF-16 indices through the removal. An offset that fell
//      INSIDE removed text is relocated to that removal's start, never left
//      inside text about to be deleted, or the marker is silently deleted
//      with the residue.
//   4. Stamp the FINAL string, after everything else has touched it and
//      before anything else does.
//   5. Call `renderCitedMarkdown` ONCE and throw the presentation string
//      away. The write path needs to know WHY a citation has no marker so the
//      disclosure can classify it honestly, and the only way to know that
//      without a second implementation of the safety check is to ask the one
//      that will render it. Two loops that must agree byte-for-byte are how
//      they drift; one implementation cannot drift from itself. The
//      render-side check still runs at render, and it is still not redundant:
//      lib/experience/markdown.js is shared with another feature and under no
//      line cap, so a future change there could stale this proof while the
//      markdown -- and therefore the stamp -- is unchanged.
//
// HOW THE OFFSET MOVE IS COMPUTED WITHOUT A SECOND COPY OF THE SEAM RULES.
// `removeResidue` repairs the whitespace seam a removal leaves, so the set of
// characters it actually deletes is slightly wider than the ranges handed to
// it, and those widened bounds are private to that module. Rather than
// restate them here -- a second recogniser, the exact defect this feature
// exists to close -- the number of characters deleted before an index is
// measured by ASKING `removeResidue` itself: it is the length lost when the
// ranges wholly before that index are removed. At most one call per range,
// memoised, and none at all for a clean digest.

import { byteBoundaryMap, spanFor, spanRefusalReason } from "./citationSpans.js";
import { citationHref } from "./citationHref.js";
import {
  removeResidue,
  scanCitationResidue,
  storedMarkdownHasNoLinks,
} from "./citationResidue.js";
import {
  CITATION_OUTCOME_VERSION,
  markdownStamp,
  renderCitedMarkdown,
} from "./renderCitedMarkdown.js";

export { CITATION_OUTCOME_VERSION };

/** The narrowing stages, in order. The chain must be monotone across them. */
export const CITATION_STAGES = Object.freeze([
  "annotations",
  "urlsUsable",
  "spansUsable",
  "splicesSafe",
  "placed",
]);

// Each transition, with the name of the stage that consumed the difference.
// `searched` is the boolean head of the chain: the model having searched is
// the "input" whose zero output is the extraction walk producing nothing.
const TRANSITIONS = Object.freeze([
  { stage: "extraction", from: "searched", to: "annotations" },
  { stage: "url-control", from: "annotations", to: "urlsUsable" },
  { stage: "span-conversion", from: "urlsUsable", to: "spansUsable" },
  { stage: "insertion-safety", from: "spansUsable", to: "splicesSafe" },
  { stage: "placement", from: "splicesSafe", to: "placed" },
]);

/**
 * The reportable anomaly, or null. Pure, so the route can log exactly the
 * verdict that was stored rather than a second opinion about it.
 *
 * Reports the FIRST transition where a non-zero input became a zero output.
 * Once a stage has eaten everything, every later zero is an honest
 * consequence, not a second finding.
 *
 * @param {{searched?: unknown, counts?: unknown}} [record]
 * @returns {{stage: string, from: string, to: string, inputCount: number, outputCount: number}|null}
 */
export function citationCountsAnomaly(record) {
  const counts = record && typeof record.counts === "object" && record.counts ? record.counts : {};
  const value = (name) => {
    if (name === "searched") return record?.searched ? 1 : 0;
    return Number.isInteger(counts[name]) ? counts[name] : 0;
  };
  for (const transition of TRANSITIONS) {
    const inputCount = value(transition.from);
    const outputCount = value(transition.to);
    if (inputCount > 0 && outputCount === 0) {
      return { ...transition, inputCount, outputCount };
    }
  }
  return null;
}

/**
 * The first way `counts` breaks the monotone chain, as a sentence, or null.
 *
 * A violation is RECORDED, never repaired. A count that has to be clamped to
 * satisfy the invariant is a wiring bug upstream, and silently clamping it
 * reproduces the exact failure mode this record exists to make visible: an
 * arithmetic that always looks consistent and therefore proves nothing.
 *
 * @param {unknown} counts
 * @returns {string|null}
 */
export function citationCountsViolation(counts) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    return "citation counts are missing or not an object";
  }
  for (const stage of CITATION_STAGES) {
    if (!Number.isInteger(counts[stage]) || counts[stage] < 0) {
      return `${stage} is not a non-negative integer`;
    }
  }
  for (let i = 1; i < CITATION_STAGES.length; i += 1) {
    const previous = CITATION_STAGES[i - 1];
    const current = CITATION_STAGES[i];
    if (counts[current] > counts[previous]) {
      return `${current} (${counts[current]}) exceeds ${previous} (${counts[previous]})`;
    }
  }
  return null;
}

// One application of `removeResidue`, plus the index map it implies.
//
// `image(p)` answers "where did the character at index p in the input end up".
// An index strictly inside a removed range is relocated to that range's start
// first, because leaving it inside text about to be deleted would delete the
// marker along with the residue.
function removalPass(text, ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = removeResidue(text, sorted);
  const deletedByRangeCount = new Map();

  const deletedBefore = (index) => {
    let count = 0;
    while (count < sorted.length && sorted[count].end <= index) count += 1;
    if (!deletedByRangeCount.has(count)) {
      deletedByRangeCount.set(
        count,
        text.length - removeResidue(text, sorted.slice(0, count)).length
      );
    }
    return deletedByRangeCount.get(count);
  };

  const image = (index) => {
    let at = index;
    for (const range of sorted) {
      if (at > range.start && at < range.end) {
        at = range.start;
        break;
      }
    }
    const moved = at - deletedBefore(at);
    if (moved < 0) return 0;
    return moved > out.length ? out.length : moved;
  };

  return { text: out, image };
}

// ONE generation of history, and `researchedAt` here is a HISTORICAL SNAPSHOT,
// not this record's own timestamp.
//
// This record deliberately carries no `researchedAt` of its own: research
// recency lives in the `application_digests.researched_at` COLUMN, written by
// the route on the success path only, and two homes for one fact is how they
// come to disagree. The column is the home because SQL wants to filter and
// order by "which digests are stale", and a timestamp buried in jsonb needs a
// cast at every call site, cannot be b-tree indexed without an expression
// index, and yields NULL on a typo in the key name.
//
// `previous.researchedAt` is not a second home for the same fact — it is when
// the PREVIOUS generation was researched, which the column no longer holds
// once the current run overwrites it, and which "it used to have four sources
// and now has none" is useless without. The caller sources it from the column.
function previousGeneration(previousOutcome) {
  if (!previousOutcome || typeof previousOutcome !== "object" || Array.isArray(previousOutcome)) {
    return null;
  }
  const placed = previousOutcome.counts?.placed;
  const refusedCount = previousOutcome.refused?.count;
  const researchedAt = previousOutcome.researchedAt;
  return {
    placed: Number.isInteger(placed) ? placed : null,
    refusedCount: Number.isInteger(refusedCount) ? refusedCount : null,
    researchedAt: typeof researchedAt === "string" ? researchedAt : null,
  };
}

/**
 * Builds everything one digest row needs from one Interaction.
 *
 * @param {object} input
 * @param {unknown} input.text            `interaction.output_text`
 * @param {unknown} input.sources         `extractCitationSources(interaction)`
 * @param {unknown} input.searched        `interactionSearched(interaction)`
 * @param {unknown} input.truncated       `interactionTruncated(interaction)`
 * @param {unknown} input.stageCounts     `interactionStageCounts(interaction)`
 * @param {unknown} input.previousOutcome `existing?.citation_outcome` with its
 *                                        `researchedAt` taken from the row's
 *                                        `researched_at` COLUMN, or null
 * @returns {{markdown: string, sources: Array<object>, outcome: object}}
 */
export function buildCitedDigest(input) {
  const {
    text,
    sources,
    searched,
    truncated,
    stageCounts,
    previousOutcome,
  } = input && typeof input === "object" ? input : {};

  const raw = typeof text === "string" ? text : "";
  const list = Array.isArray(sources) ? sources : [];

  // ---- 1 & 2. residue: count before coalescing, remove with the seam repaired
  const firstScan = scanCitationResidue(raw);
  const first = removalPass(raw, firstScan.ranges);

  let markdown = first.text;
  let image = first.image;
  let residueCount = firstScan.count;
  const residueReasons = { ...firstScan.reasons };
  let residueClean = storedMarkdownHasNoLinks(markdown);

  if (!residueClean) {
    // The runtime belt. Removing a span can join two fragments into a syntax
    // neither of them was, so the scanner is re-run ONCE over the result --
    // the same instrument, not a second one, because the renderer's token tree
    // carries no positions and therefore cannot supply removal ranges.
    const secondScan = scanCitationResidue(markdown);
    const second = removalPass(markdown, secondScan.ranges);
    const firstImage = image;
    image = (index) => second.image(firstImage(index));
    markdown = second.text;
    residueCount += secondScan.count;
    for (const key of Object.keys(residueReasons)) {
      residueReasons[key] += secondScan.reasons[key] || 0;
    }
    residueClean = storedMarkdownHasNoLinks(markdown);
  }

  // ---- 3. the one byte -> UTF-16 conversion, against the string the vendor's
  // offsets were computed against, then moved through the removal.
  const byteMap = byteBoundaryMap(raw);
  const spanReasons = {};
  const noteSpanReason = (reason) => {
    const code = typeof reason === "string" ? reason : "bad-shape";
    spanReasons[code] = (spanReasons[code] || 0) + 1;
  };

  const entries = [];
  let unusableAnnotationUrl = 0;
  let unusableSpan = 0;

  for (const source of list) {
    const uri = source && typeof source === "object" && !Array.isArray(source) ? source.uri : null;
    const href = citationHref(uri);
    if (href === null) {
      // It can be neither a marker nor a link, so it is counted and NOT
      // stored: an unusable url in a column that feeds href render paths is
      // exactly the unvalidated population this feature exists to close.
      unusableAnnotationUrl += 1;
      continue;
    }

    const entry = { url: href };
    if (typeof source.title === "string") entry.title = source.title;

    const span = spanFor(raw, source, byteMap);
    if (span === null) {
      unusableSpan += 1;
      noteSpanReason(spanRefusalReason(raw, source, byteMap));
    } else {
      const start = image(span.start);
      const end = image(span.end);
      if (end < start) {
        unusableSpan += 1;
        noteSpanReason("inverted");
      } else {
        entry.start = start;
        entry.end = end;
      }
    }
    entries.push(entry);
  }

  // ---- 4. the stamp, over the final string
  const stamp = markdownStamp(markdown);

  // ---- 5. one call to the renderer, to learn acceptance and its reasons
  const candidates = [];
  entries.forEach((entry, index) => {
    if (Number.isInteger(entry.start) && Number.isInteger(entry.end)) {
      candidates.push({ index, url: entry.url, title: entry.title, start: entry.start, end: entry.end });
    }
  });

  const probe = renderCitedMarkdown(
    markdown,
    candidates.map((c) => ({ url: c.url, title: c.title, start: c.start, end: c.end })),
    {
      version: CITATION_OUTCOME_VERSION,
      residueClean: true,
      counts: { placed: candidates.length },
      len: stamp.len,
      hash: stamp.hash,
    }
  );

  const acceptedEntryIndexes = new Set(
    probe.accepted.map((a) => candidates[a.index]?.index).filter((i) => Number.isInteger(i))
  );

  // A span the renderer will not splice is not written. `placed` therefore
  // equals the number of stored elements carrying a span, which is precisely
  // what the render-side F-2 binding compares against.
  const storedSources = entries.map((entry, index) => {
    if (acceptedEntryIndexes.has(index)) return entry;
    // The span is dropped, not zeroed. An element with no `start`/`end` is an
    // "also searched" entry -- Google supplied it, we could not place it --
    // and it still renders as a real, clickable source. Zeroing the span
    // instead would name the first character of the digest as its passage.
    const kept = { url: entry.url };
    if (typeof entry.title === "string") kept.title = entry.title;
    return kept;
  });

  const placed = storedSources.filter(
    (entry) => Number.isInteger(entry.start) && Number.isInteger(entry.end)
  ).length;

  const annotations = Number.isInteger(stageCounts?.annotations)
    ? stageCounts.annotations
    : list.length;

  const counts = {
    annotations,
    urlsUsable: entries.length,
    spansUsable: candidates.length,
    splicesSafe: probe.accepted.length,
    placed,
  };

  const outcome = {
    version: CITATION_OUTCOME_VERSION,
    surface: "interactions",
    searched: !!searched,
    truncated: !!truncated,
    residueClean,
    counts,
    countsViolation: citationCountsViolation(counts),
    anomaly: citationCountsAnomaly({ searched: !!searched, counts }),
    refused: {
      count: residueCount,
      reasons: {
        ...residueReasons,
        unusableAnnotationUrl,
        unusableSpan: unusableSpan + probe.refused.unusableSpan,
        unmarkableUrl: probe.refused.unusableUrl,
        unsafeInsertionPoint: probe.refused.unsafeInsertionPoint,
        digitAdjacent: probe.refused.digitAdjacent,
      },
      spanReasons,
    },
    len: stamp.len,
    hash: stamp.hash,
    previous: previousGeneration(previousOutcome),
  };

  return { markdown, sources: storedSources, outcome };
}
