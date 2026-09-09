// WHAT THE HOVER CARD SAYS -- the wording, as data, so every honesty claim on
// it is checkable without mounting a popover.
//
// ---------------------------------------------------------------------------
// THE LABEL IS THE HOST. IT IS NEVER "Researched."
// ---------------------------------------------------------------------------
// A source on one of these terms means Google attributed a byte span of its own
// answer to that URL. That is ATTRIBUTION. It is not verification, we did not
// fetch the page, and no word on this card may claim more. The stored field is
// still `provenance: "researched"` -- internal, precise, computed by us, and
// gating a database CHECK -- and only the user-facing string changed.
//
// The cost is specific to THIS surface, which is why the ruling is worth its
// own paragraph rather than being a style note: a candidate who reads
// "Researched" thirty seconds before an interview may repeat the definition and
// say "I researched this." That is a claim about their OWN preparation which our
// label licensed and cannot support. On a resume-and-interview product that is
// the product putting a word in a candidate's mouth.
//
// The host buys everything the adjective would have. "postgresql.org" tells a
// reader who said it and whether that is the vendor's own documentation or a
// forum -- actionable, and falsifiable.
//
// ---------------------------------------------------------------------------
// ABOUT HALF THE TERMS ON A FINISHED POSTING CARRY NO SOURCE, BY DESIGN
// ---------------------------------------------------------------------------
// Some terms have no findable source at all: coined internal process names,
// company jargon, terms whose search results are all low quality. A row whose
// research substantially worked is FINISHED at that point rather than retried
// forever. So the unsourced card is the ordinary case, not the error case, and
// it must read like one.
//
// It therefore states the absence POSITIVELY -- a sentence saying it has none,
// not merely a missing link. Absence of a link is not a signal a reader can
// perceive: they cannot know a link was possible. That sentence is what the
// whole partial-research ruling reduces to, and it is why the two cards differ
// in TEXT rather than in colour or position, so the difference survives being
// read aloud and printed in black and white (WCAG 1.4.1).
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE DOES NOT DECIDE
// ---------------------------------------------------------------------------
// Whether a term IS sourced. That decision is `safeExternalHref` plus
// `citationHost` plus the two redirector re-checks, and it lives in
// GlossaryTerm.js in ONE expression beside the anchor it governs -- both
// because app/components/hrefSafety.sweep.test.js only recognises an href
// produced by a same-file `safeExternalHref(` binding, and because the host
// shown must be derived from the anchor's own href in the same expression that
// produces it (SEC-F2), never from the stored `source_host`, which is a
// different string that could have drifted. This module takes `sourced` and
// `host` as inputs and NEVER reads the stored source fields.

/** AC-Q8. The sentence, not the omission. */
export const NO_SOURCE_SENTENCE = "This is a general definition. It has no source.";

/**
 * The embedded engine's variant. It answers a different question -- "why is
 * this term here?" rather than "what does it mean?" -- and conflating the two
 * is the failure this line exists to prevent.
 */
export const POSTING_ONLY_LINE = "From the posting";

const IN_POSTING = "In this posting";
const NOT_IN_POSTING = "Likely to come up — not stated in this posting";
const NO_SOURCE_TAG = "No source";

/** AC-H17 condition 6: meaningful out of context. Never "here", never "link". */
export function sourceLinkLabel(host) {
  const name = typeof host === "string" ? host.trim() : "";
  return name ? `Source: ${name}` : null;
}

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Everything the card renders, in reading order, for one stored term.
 *
 * @param {object|null|undefined} term one entry of the row's `terms[]`
 * @param {{sourced: boolean, host: string|null}} source the render-time
 *   decision, computed by the caller from the anchor's own href
 */
export function glossaryCardModel(term, source) {
  const record = term && typeof term === "object" ? term : {};
  const heading = textOf(record.term);
  const definition = textOf(record.definition);
  const anticipated = record.kind === "anticipated";
  const quote = anticipated ? textOf(record.anchor_quote) : textOf(record.evidence);

  const host = source && source.sourced === true ? textOf(source.host) : "";
  const sourced = Boolean(host);

  // The embedded path stores a quote and NO definition. It has no source to
  // have or to lack, so it gets neither a host, a link, nor the absence
  // sentence -- saying "it has no source" about a posting quote would be
  // answering a question nobody asked.
  if (!definition && quote) {
    return Object.freeze({
      variant: "quotes-only",
      heading,
      provenanceLine: POSTING_ONLY_LINE,
      quote,
      definition: "",
      closingLine: null,
      linkLabel: null,
      order: Object.freeze(["heading", "provenanceLine", "quote"]),
    });
  }

  const where = anticipated ? NOT_IN_POSTING : IN_POSTING;
  return Object.freeze({
    variant: `${anticipated ? "anticipated" : "explicit"}-${sourced ? "sourced" : "unsourced"}`,
    heading,
    // AC-Q9: the provenance -- kind AND source state, both in words -- is the
    // FIRST thing after the term, so a screen reader hears it before the
    // definition rather than discovering it in a footer.
    provenanceLine: `${where} · ${sourced ? host : NO_SOURCE_TAG}`,
    quote,
    definition,
    closingLine: sourced ? null : NO_SOURCE_SENTENCE,
    linkLabel: sourced ? sourceLinkLabel(host) : null,
    order: Object.freeze(["heading", "provenanceLine", "quote", "definition", "sourceLine"]),
  });
}
