// AC-V4.4. The whitelist that turns the model's `factIds` into something the
// candidate can see, and refuses everything else.
//
// A deliberate STRUCTURAL COPY of lib/copilot/pageCitations.js's
// resolvePageSources — pageCitations.js's own header records that this
// repo's answer to "the same shape for a different surface" is a second
// module in the same shape, rather than a generalisation of the first, and
// cites lib/meeting/insightContract.js as the earlier instance of that
// choice. Two of resolvePageSources' non-obvious rules carry over
// UNCHANGED: the whitelist supplies the displayed `claim`/`url` (never the
// model's echo of them), and `[]` — not an array of nulls — means "citations
// do not apply to this answer" while an array of nulls means "they apply and
// none matched" (a renderer that cannot tell the two apart shows an empty
// citation rail on every answer). ZERO IMPORTS, same as its sibling: this
// lives in lib/copilot/ purely so it is reachable by the server route and,
// later, any client-side surface that wants it, without pulling anything
// else in behind it.
//
// ONE RULE IS DELIBERATELY DIFFERENT FROM resolvePageSources, and it is
// worth stating rather than leaving as a silent divergence: on a POSITIONAL
// LENGTH MISMATCH, resolvePageSources pads out to `new Array(pointCount)
// .fill(null)` — this module returns `[]` instead. A page citation gone
// missing is a missing "from your X page" caption; a fabricated COMPANY FACT
// is the exact defect this whole feature exists to stop (the user's live
// session log: "My research indicates a strong focus on continuous
// improvement," about a company nobody researched). Padding with nulls still
// keeps SOME of the positional pairing alive for a caller that isn't
// careful; `[]` is the version that cannot be mistaken for "these ids do
// apply, they just all missed" by anything downstream.
//
// THE FAILURE THIS MODULE EXISTS TO PREVENT: a candidate, mid-interview,
// reading a claim about their employer that the model invented AND attached
// a fake citation to — worse than an uncited invention, because a citation
// looks checkable. The whole point of AC-V4 is that the candidate only says
// things that were checked, so an id the model was never shown is treated as
// fabricated, not as a richer citation to trust.

function isNonEmptyId(value) {
  return typeof value === "string" && value.trim() !== "";
}

// resolveFactSources(rawFactIds, { includedFacts, pointCount }) ->
// Array<{ id, claim, url } | null>.
//
// `includedFacts` is the exact whitelist the prompt was built from — the
// survivors of companyFactsSource.js's buildCompanyFacts, the same array
// lib/copilot/companyFacts.js's companyFactsBlock rendered into the prompt.
// An entry here is trustworthy by construction (it already passed
// corroboration against a page Google actually visited), so its `claim` and
// `url` are what gets returned, never anything the model said.
//
// Pairs positionally with the drafted points: `rawFactIds[i]` is trusted for
// point `i` ONLY when `rawFactIds` is an array whose length equals
// `pointCount` — the same all-or-nothing rule resolvePageSources already
// applies to its own positional pairing, for the same reason: a citation
// against the wrong point is worse than no citation at all, and truncating
// or padding a mismatched array would keep some of that wrong pairing alive
// rather than refusing all of it.
//
// Returns [] — not an array of nulls — whenever there is nothing to cite at
// all: no included facts, no points, or a length mismatch (see the header
// above for why the mismatch case departs from resolvePageSources here).
//
// Never throws.
export function resolveFactSources(rawFactIds, options) {
  const opts = options && typeof options === "object" ? options : {};
  const includedFacts = Array.isArray(opts.includedFacts) ? opts.includedFacts : [];
  const pointCount = typeof opts.pointCount === "number" && opts.pointCount > 0 ? opts.pointCount : 0;

  if (includedFacts.length === 0 || pointCount === 0) return [];

  // Duplicated ids in the whitelist can only happen through a caller bug —
  // keep the FIRST fact shown under that id, so a citation always points at
  // the fact the model actually saw first in the prompt, not whichever
  // duplicate happened to be pushed last.
  const byId = new Map();
  for (const entry of includedFacts) {
    const id = entry && typeof entry === "object" ? entry.id : undefined;
    if (!isNonEmptyId(id)) continue;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        claim: typeof entry.claim === "string" ? entry.claim : "",
        url: typeof entry.url === "string" ? entry.url : "",
      });
    }
  }

  // A length mismatch means the positions cannot be trusted AT ALL — see
  // this module's header on why that is `[]` here rather than
  // resolvePageSources' array-of-nulls.
  if (!Array.isArray(rawFactIds) || rawFactIds.length !== pointCount) {
    return [];
  }

  return rawFactIds.map((raw) => {
    // The declared model channel is `"factIds": (string|null)[]` — anything
    // that is not a plain id string (an object, a number, a URL someone
    // pasted in directly) is corruption, not a richer citation to unwrap.
    if (!isNonEmptyId(raw)) return null;
    const match = byId.get(raw);
    return match ? { id: match.id, claim: match.claim, url: match.url } : null;
  });
}
