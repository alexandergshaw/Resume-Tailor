// PHASE 1 -- THE HARVEST. One ungrounded `models.generateContent` call, and the
// pure ingest around it.
//
// THE HARVEST PRODUCES DEFINITIONS, NOT JUST TERMS, and that is load-bearing in
// two independent ways:
//
//   1. THE SCHEDULE NEEDS SOMETHING STORABLE BETWEEN INVOCATIONS. A cron worker
//      resumes from a row. A harvest that produced 120 terms with no definitions
//      would have nothing to write, nothing to resume from, and nothing to
//      queue -- the row that already exists IS the queue entry.
//   2. IT CLOSES A HOLE THAT HAS NOTHING TO DO WITH SCHEDULING. "A batch whose
//      research failed does not fail the row -- its terms become recalled" is
//      only implementable if those terms HAVE a definition to fall back to.
//      Without one they are unstorable, so they are silently lost, and the rule
//      describes an outcome the schema forbids.
//
// So every write is a complete, honest, useful row: after the POST returns, the
// posting has its terms and its definitions, all labelled as having no source.
// The hover feature WORKS -- with weaker definitions and no attribution -- from
// the first invocation, and Phase 2 is an UPGRADE PASS over it. That costs about
// 7,200 extra output tokens per posting, which is noise against a bill dominated
// by grounded requests.
//
// A CONSEQUENCE WORTH NAMING: because research only ever upgrades a term in
// place, `researched_count` is MONOTONE BY CONSTRUCTION within one posting
// fingerprint. That is what makes the route's rank gate decidable BEFORE a call
// rather than at write time, after the money is spent.

import { anchorSpace, explicitTermsFor, quotableSpans, maxAnticipatedForRow } from "./glossaryAnchors.js";
import { admitHarvestedTerms } from "./glossaryTerms.js";
import { buildHarvestUserTurn } from "./glossaryPrompt.js";
import { fitTermsToByteBudget } from "./glossaryStore.js";
import {
  MAX_POSTING_CHARS,
  RESEARCH_BATCH_SIZE,
  RESEARCH_TOTAL_MAX,
} from "./glossaryConstants.js";

/**
 * Everything computable about a posting before any model runs: Pass A, the
 * closed anchor space, the per-row anticipated ceiling, and the fenced user
 * turn. Pure and network-free.
 */
export function prepareHarvest(position) {
  const description = String(position?.description || "").slice(0, MAX_POSTING_CHARS);
  const title = String(position?.title || "");
  const space = anchorSpace(description, title);
  const quotes = quotableSpans(description);
  const explicitTerms = explicitTermsFor(description);
  const maxAnticipated = maxAnticipatedForRow({
    taxonomyCount: space.taxonomy.length,
    topicCount: space.topics.length,
    quoteCount: quotes.length,
  });

  return {
    description,
    explicitTerms,
    anchors: space.all,
    maxAnticipated,
    quoteCount: quotes.length,
    userTurn: buildHarvestUserTurn({
      description,
      title,
      company: position?.company,
      explicitTerms,
      anchors: space.all,
      maxAnticipated,
    }),
  };
}

/**
 * The model's terms, read tolerantly. A harvest that comes back wrapped in a
 * code fence, or with prose either side of the object, is a formatting miss and
 * not a reason to throw away a paid call; a harvest that comes back as something
 * else entirely yields an empty list, which the caller records as a failed row
 * rather than as a thin one.
 */
export function parseHarvestTerms(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(parsed?.terms) ? parsed.terms : [];
  } catch {
    return [];
  }
}

/**
 * The row fields a completed harvest writes.
 *
 * THE TERMS ARE ORDERED RECALLED-FIRST, which is the batching invariant the
 * worker depends on: within a generation the first
 * `research_total * RESEARCH_BATCH_SIZE` positions ARE the work list, they never
 * move while it runs, and batch `i` is therefore always the same twelve
 * positions across invocations. Slicing a filtered "still recalled" list instead
 * would skip a term every time a batch succeeded.
 */
export function buildHarvestFields({ prepared, candidates, previousTerms = null }) {
  const admitted = admitHarvestedTerms(candidates, {
    description: prepared.description,
    anchors: prepared.anchors,
    maxAnticipated: prepared.maxAnticipated,
  });

  // A RETRY RESEARCHES ONLY WHAT IS MISSING and never re-rolls Phase 1. When the
  // caller supplies the previous generation's terms, already-researched ones are
  // carried through untouched and only the recalled residue is re-batched -- so
  // the term list is stable across retries and the fingerprint still describes
  // it.
  const carried = Array.isArray(previousTerms)
    ? previousTerms.filter((t) => t?.provenance === "researched")
    : [];
  const carriedKeys = new Set(carried.map((t) => String(t.term).toLowerCase()));
  const fresh = admitted.terms.filter((t) => !carriedKeys.has(t.term.toLowerCase()));

  const ordered = [...fresh, ...carried];
  const fitted = fitTermsToByteBudget(ordered);

  const recalled = fitted.terms.filter((t) => t.provenance === "recalled").length;
  const researched = fitted.terms.length - recalled;
  const researchTotal = Math.min(
    RESEARCH_TOTAL_MAX,
    Math.ceil(recalled / RESEARCH_BATCH_SIZE),
  );

  // `fields` carries ONLY column names, so the caller can hand it straight to
  // the write path's allow-list without filtering. The per-rule tally travels
  // beside it rather than inside it: it is diagnostics, not a column, and a key
  // no column matches is this repo's signature silent drop.
  return {
    fields: {
      terms: fitted.terms,
      explicit_count: fitted.terms.filter((t) => t.kind === "explicit").length,
      anticipated_count: fitted.terms.filter((t) => t.kind === "anticipated").length,
      researched_count: researched,
      recalled_count: recalled,
      rejected_count: admitted.rejectedCount,
      dropped_count: admitted.droppedCount + fitted.droppedCount,
      truncated_reason: fitted.truncatedReason,
      max_anticipated: prepared.maxAnticipated,
      research_cursor: 0,
      research_total: researchTotal,
    },
    rejectedByRule: admitted.rejectedByRule,
  };
}
