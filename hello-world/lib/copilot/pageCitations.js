// Which of the candidate's own knowledge-base pages each drafted answer
// point actually came from. Pure, zero imports (see pageCitations.test.js's
// header — this file lives in lib/copilot/ and has no reason to import
// anything, so it stays free to be used by both the server route and, later,
// a client-side cache round-trip without dragging anything else in behind
// it).
//
// THE FAILURE THIS MODULE EXISTS TO PREVENT: a candidate, mid-interview,
// reading "from your Payments migration page" out loud for a page the model
// invented. lib/meeting/insightContract.js's normalizeInsights learned this
// first — it downgrades any page citation that is not in the set the prompt
// actually showed. This is the same rule for the interview copilot's answer
// surface, made stricter in one place: the TITLE shown to the user always
// comes from the whitelist (what the prompt actually included), never from
// the model's own echoed title, because a model that copies an id correctly
// and paraphrases the title produces a citation the user cannot recognise as
// their own page — and the route already holds the real value, so there is
// no reason to trust a second, possibly-drifted copy of it.

function isNonEmptyId(value) {
  return typeof value === "string" && value.trim() !== "";
}

// resolvePageSources(rawPageIds, { includedPages, pointCount }) ->
// Array<{ id, title } | null>.
//
// `includedPages` is the exact whitelist the prompt was built from
// (buildKnowledgeBaseBlock's own `includedPages`) — an entry here is
// trustworthy by construction, so its `title` is what gets returned, never
// anything the model said.
//
// Pairs positionally with the drafted points: `rawPageIds[i]` is trusted for
// point `i` ONLY when `rawPageIds` is an array whose length equals
// `pointCount` — the same all-or-nothing rule resolveCues and answerLines
// already apply to their own positional pairings, for the same reason: a
// citation against the wrong beat is worse than no citation at all.
//
// Returns [] — not an array of nulls — whenever there is nothing to cite at
// all (no included pages, or no points). This distinction is load-bearing
// downstream: answerLines' own pairing gate treats [] as "no page sources
// supplied" and renders nothing extra, whereas an array of nulls the right
// length would pass that gate and render an empty citation slot next to
// every line (AC-6.3 — no empty row, no "0 pages").
//
// Never throws.
export function resolvePageSources(rawPageIds, options) {
  const opts = options && typeof options === "object" ? options : {};
  const includedPages = Array.isArray(opts.includedPages) ? opts.includedPages : [];
  const pointCount = typeof opts.pointCount === "number" && opts.pointCount > 0 ? opts.pointCount : 0;

  if (includedPages.length === 0 || pointCount === 0) return [];

  // Duplicated ids in the whitelist can only happen through a caller bug —
  // keep the FIRST page shown under that id, so the citation always points
  // at the page the model actually saw first in the prompt, not whichever
  // duplicate happened to be pushed last.
  const byId = new Map();
  for (const entry of includedPages) {
    const id = entry && typeof entry === "object" ? entry.id : undefined;
    if (!isNonEmptyId(id)) continue;
    if (!byId.has(id)) byId.set(id, { id, title: typeof entry.title === "string" ? entry.title : "" });
  }

  if (!Array.isArray(rawPageIds) || rawPageIds.length !== pointCount) {
    return new Array(pointCount).fill(null);
  }

  return rawPageIds.map((raw) => {
    // The declared model channel is `"pageIds": (string|null)[]` — anything
    // that is not a plain id string (an object, a number, ...) is
    // corruption, not a richer citation to unwrap. Unwrapping an object here
    // would let the model's own `title` back in through the side door this
    // module exists to close.
    if (!isNonEmptyId(raw)) return null;
    const match = byId.get(raw);
    return match ? { id: match.id, title: match.title } : null;
  });
}
