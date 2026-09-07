// The knowledge-page scope summary's VIEW module: turns stored state
// (source_pages + retrieval_outcome, as written by knowledgeScope.js's
// classifyScopePages / buildRetrievalOutcome, Wave 3a) into what a panel
// would render, against the LIVE tree the client already holds. No React, no
// DOM, no fetch, no Supabase -- pure functions over plain data, so the panel
// (a later wave) has no logic of its own left to get wrong.
//
// THE FOUR STATES A SUMMARY CAN BE IN, AND WHY THIS MODULE NEVER COLLAPSES
// THEM (3-plan-knowledge.md, DigestPanel.js's own "states that look alike"
// doctrine): content present; the scope genuinely had nothing; the pipeline
// received input and produced nothing; and a record that predates the
// feature (retrieval_outcome is SQL NULL). This module does not itself
// decide which of the four applies -- that reads `retrieval_outcome` and
// `source_pages` directly, at the call site -- but `coverageFor`'s
// `consistent` flag is what stops a panel asserting a coverage claim a
// broken write cannot back up, and it is deliberately NOT vacuously true
// when `retrieval_outcome` is absent (state 4): a record that predates the
// feature has nothing to be consistent WITH, and treating "no evidence" as
// "no problem" is exactly how the third state gets rendered as the first.
//
// STALENESS IS COMPUTED HERE, AT RENDER, AGAINST THE LIVE TREE -- never
// stored, never computed server-side (AC-6.1/6.3): a server value freezes at
// fetch time and goes stale the moment a page changes without a reload,
// while the client's own `pages` array is already live.
//
// MOVE IS SEPARATED FROM EDIT EXACTLY, NOT HEURISTICALLY.
// `lib/supabase/experiencePages.js`'s `applyMoves` writes
// `{parent_id, position, updated_at}` together on every drag, and an
// exhaustive check over 786 production move-update rows found ZERO stamped
// without a `(parent_id, position)` change alongside it. So the rule below --
// `updated_at` changed AND `(parent_id, position)` changed => moved;
// `updated_at` changed alone => changed -- is not a heuristic, it is the
// measured shape of the one write path that produces both signals. The
// residual, stated rather than hidden: a move and a genuine edit inside the
// same interval reads as a move, because there is no content hash to tell
// them apart, and manufacturing one is out of scope for this feature
// (3-plan-knowledge.md §6 item 17).
//
// ATTACHMENTS ARE INVISIBLE TO STALENESS ENTIRELY, ON PURPOSE, STATED.
// `experience_attachments` is a separate table; adding, editing or removing
// an attachment never writes `experience_pages.updated_at`, so no page
// comparison -- however careful -- can detect it. `attachmentsNotCovered` is
// therefore a constant `true`, not a computed value: it exists so the
// panel's copy cannot silently drift from that fact (AC-6.4, accepted miss
// #9). Fixing this needs a scope-wide `max(updated_at)` over
// `experience_attachments` or a stored attachment fingerprint, neither of
// which is Wave 3b's job.
//
// A `temp-` id (an optimistic row minted client-side before the server
// reply lands, `useExperiencePages.js:90`) can never appear in a stored
// `source_pages` array -- it did not exist at generation time -- so it is
// always classified ADDED by construction, never CHANGED. No special-case
// code is needed for that; it is recorded here so a future "smarter" match
// (e.g. fuzzy id matching) does not accidentally break it.
//
// CITATIONS RESOLVE A TITLE FROM THE LIVE TREE, EVERY RENDER, NEVER FROM THE
// STORED RECORD (3-plan-knowledge.md §7 C3). `citations` rows are never
// rewritten and do not cascade when a descendant page is deleted, so a
// title stored there would survive the page it named, forever, in a history
// the user may have built over weeks. `source_pages` is the opposite case
// (overwritten every regeneration, cascades with its scope page) and keeps
// its own stored title -- that asymmetry is knowledgeScope.js's concern, not
// this module's; this module only ever receives a citation's bare
// `{ pageId }` and looks the title up itself, so there is no stored title
// for it to be tempted by.
//
// Every function here treats its input as possibly missing or malformed and
// never throws.

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function safeTitle(value) {
  return typeof value === "string" ? value : "";
}

// Two ISO timestamps (or anything Date.parse can read) are "the same" only
// when both parse to a finite instant and those instants match. Anything
// else -- one or both missing, malformed, or genuinely different -- is
// "changed", never silently treated as equal. This is the guard the plan's
// own JSON.stringify warning is about: two BOTH-malformed timestamps must
// not compare as one signal that never fires.
function sameInstant(a, b) {
  if (a === b) return true;
  const ta = typeof a === "string" || typeof a === "number" ? Date.parse(a) : NaN;
  const tb = typeof b === "string" || typeof b === "number" ? Date.parse(b) : NaN;
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

function normalizeParent(value) {
  return value === undefined ? null : value;
}

function normalizePosition(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * stalenessFor(sourcePages, pages) -> { added, removed, moved, changed, attachmentsNotCovered }
 *
 * `sourcePages` is a stored `source_pages` array (knowledgeScope.js's
 * `classifyScopePages` shape: `{ id, title, updated_at, parent_id, position,
 * included, reason, rank, excerpted }`, one entry per page that was IN SCOPE
 * at generation time, whether or not it was included in the model's
 * context). `pages` is the live `experience_pages` rows the client already
 * holds. Every returned entry is `{ id, title }`; `removed` uses the STORED
 * title (the live tree cannot resolve a page that is no longer in it), every
 * other list uses the LIVE title.
 */
export function stalenessFor(sourcePagesInput, pagesInput) {
  const sourcePages = Array.isArray(sourcePagesInput) ? sourcePagesInput : [];
  const pages = Array.isArray(pagesInput) ? pagesInput : [];

  const liveById = new Map();
  for (const page of pages) {
    if (page && isNonEmptyString(page.id)) liveById.set(page.id, page);
  }

  const sourceIds = new Set();
  const added = [];
  const removed = [];
  const moved = [];
  const changed = [];

  for (const source of sourcePages) {
    if (!source || !isNonEmptyString(source.id)) continue;
    sourceIds.add(source.id);
    const live = liveById.get(source.id);

    if (!live) {
      removed.push({ id: source.id, title: safeTitle(source.title) });
      continue;
    }

    if (sameInstant(source.updated_at, live.updated_at)) continue;

    const parentChanged = normalizeParent(source.parent_id) !== normalizeParent(live.parent_id);
    const positionChanged = normalizePosition(source.position) !== normalizePosition(live.position);
    const entry = { id: source.id, title: safeTitle(live.title) };
    if (parentChanged || positionChanged) {
      moved.push(entry);
    } else {
      changed.push(entry);
    }
  }

  for (const live of pages) {
    if (!live || !isNonEmptyString(live.id)) continue;
    if (sourceIds.has(live.id)) continue;
    added.push({ id: live.id, title: safeTitle(live.title) });
  }

  // Always true, never computed -- see module header. A separate table, no
  // write path into experience_pages, no signal this comparison could ever
  // produce.
  return { added, removed, moved, changed, attachmentsNotCovered: true };
}

function safeNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * coverageFor(sourcePages, retrievalOutcome) ->
 *   { total, included, excluded, byReason, attachmentsSkipped, consistent }
 *
 * `byReason` counts only the EXCLUDED pages, grouped by their AC-3.7 reason
 * (a page missing or blank reason groups under "unknown" rather than being
 * dropped from the count -- count-first, matching classifyScopePages' own
 * discipline of never short-circuiting on a malformed row).
 *
 * `attachmentsSkipped` reads `retrievalOutcome.counts.attachmentsSkipped`
 * defensively, defaulting to 0. That field is not one of
 * `KNOWLEDGE_RETRIEVAL_STAGES` (knowledgeScope.js) -- it rides alongside the
 * six named stages on the same `counts` object, the way an extra caller-
 * supplied key survives `buildRetrievalOutcome`'s pass-through -- so reading
 * it defensively costs nothing if that assumption ever needs to move.
 *
 * `consistent` is the one runtime check this module makes on the column-wise
 * upsert's central promise (AC-3.10): `summary`, `source_pages` and
 * `retrieval_outcome` are written together, on every write, so the count of
 * `included` pages actually present in `sourcePages` should always equal
 * `retrievalOutcome.counts.pagesIncluded`. It is deliberately NOT vacuously
 * true when `retrievalOutcome` is missing or malformed (a record that
 * predates the feature, or a corrupted read) -- there is nothing to be
 * consistent WITH, so the honest answer is "cannot confirm", not "assume
 * yes". On false, the caller renders the summary text but refuses the
 * coverage claim and the staleness signal, and says so.
 */
export function coverageFor(sourcePagesInput, retrievalOutcome) {
  const sourcePages = Array.isArray(sourcePagesInput) ? sourcePagesInput : [];

  let included = 0;
  const byReason = {};
  for (const page of sourcePages) {
    const isIncluded = !!(page && page.included === true);
    if (isIncluded) {
      included += 1;
      continue;
    }
    const reason = page && isNonEmptyString(page.reason) ? page.reason : "unknown";
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
  const total = sourcePages.length;
  const excluded = total - included;

  const counts =
    retrievalOutcome && typeof retrievalOutcome === "object" && retrievalOutcome.counts && typeof retrievalOutcome.counts === "object"
      ? retrievalOutcome.counts
      : null;

  const attachmentsSkipped = counts ? safeNonNegativeInt(counts.attachmentsSkipped) : 0;
  const claimedIncluded = counts ? counts.pagesIncluded : undefined;
  const consistent = Number.isInteger(claimedIncluded) && claimedIncluded === included;

  return { total, included, excluded, byReason, attachmentsSkipped, consistent };
}

/**
 * citationView(citations, pages) -> [{ pageId, title, state }]
 *
 * `citations` is a stored `citations` column value -- `[{ pageId }]`, and
 * NOTHING ELSE is ever trusted from it even if present (a hostile or stale
 * extra `title` field on an entry is ignored outright): the title always
 * comes from the LIVE tree, every render (§7 C3 above). `state` is one of:
 *   - "live"     the page exists and is not archived
 *   - "archived" the page exists but is archived (ineligible for the block,
 *                but not gone -- it still has a real title to show)
 *   - "gone"     no page with this id exists in the live tree; title is
 *                `null`, deliberately -- naming a page the user deliberately
 *                deleted is less honest than saying it is gone.
 *
 * A citation entry with no usable `pageId` is dropped rather than rendered
 * as a blank row. Order is preserved.
 */
export function citationView(citationsInput, pagesInput) {
  const citations = Array.isArray(citationsInput) ? citationsInput : [];
  const pages = Array.isArray(pagesInput) ? pagesInput : [];

  const byId = new Map();
  for (const page of pages) {
    if (page && isNonEmptyString(page.id)) byId.set(page.id, page);
  }

  const out = [];
  for (const entry of citations) {
    const pageId = entry && isNonEmptyString(entry.pageId) ? entry.pageId : null;
    if (!pageId) continue;
    const page = byId.get(pageId);
    if (!page) {
      out.push({ pageId, title: null, state: "gone" });
      continue;
    }
    out.push({ pageId, title: safeTitle(page.title), state: page.archived_at ? "archived" : "live" });
  }
  return out;
}

/**
 * answerShortfallFor(retrievalOutcome) -> { shown, withMaterial, shortfall } | null
 *
 * Non-null exactly when `pagesIncluded < pagesWithMaterial` -- pages existed
 * with real material to draw from, and some of them did not make it into the
 * model's context, so a refusal ("I cannot answer from these pages") is
 * true about the BLOCK and may be false about the knowledge base. This
 * drives the sentence that belongs directly beside the answer, not only in
 * the panel's general coverage notice (3-plan-knowledge.md §7 C2 amendment).
 *
 * Never repairs or clamps: a `shown` count that somehow EXCEEDS
 * `withMaterial` is not a shortfall, it is a different problem
 * (`retrievalOutcome.countsViolation` already exists to name that one), so
 * this function returns null rather than a negative shortfall.
 */
export function answerShortfallFor(retrievalOutcome) {
  const counts =
    retrievalOutcome && typeof retrievalOutcome === "object" && retrievalOutcome.counts && typeof retrievalOutcome.counts === "object"
      ? retrievalOutcome.counts
      : null;
  if (!counts) return null;
  const shown = counts.pagesIncluded;
  const withMaterial = counts.pagesWithMaterial;
  if (!Number.isInteger(shown) || !Number.isInteger(withMaterial)) return null;
  if (shown >= withMaterial) return null;
  return { shown, withMaterial, shortfall: withMaterial - shown };
}
