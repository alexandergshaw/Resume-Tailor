// THE ONE RULE that decides what a citation may be CALLED. Every path that
// produces a citation's name — the two write paths and the render path —
// derives it here, so there is no second rule to drift from.
//
// WHY THIS FILE EXISTS AT ALL: TWO PATHS ANSWERED THE QUESTION DIFFERENTLY,
// and the same stored record therefore rendered differently depending on which
// one produced it.
//
//   * applicationDigest.js's `groundedTitleForHost` — HOST-ONLY. It looked a
//     link's HOST up in the grounded array and welded whichever entry it hit
//     first onto that link, so re-ordering an array nobody controls changed
//     which real headline was attached to which URL. It then fell back to the
//     model's own link text, and finally to the RAW URL as the source's name.
//   * DigestPanel.js's `entryLabel` — TITLE-FIRST. The entry's own title, else
//     its own host, else "Source (unnamed)", truncated at a word boundary. It
//     never printed a URL and never consulted a foreign array.
//   * digestCitations.js's `buildCitedDigest` — no rule at all. It stored the
//     vendor's `title` beside the vendor's `url`, verbatim and unexamined.
//
// THE HARM THE RULE EXISTS TO STOP is narrower and worse than the
// disagreement. Gemini's legacy grounding metadata returns `web.uri` as a
// `vertexaisearch.cloud.google.com` REDIRECT proxy and `web.title` as the
// PUBLISHER'S BARE DOMAIN (scratchpad/3b-gemini-grounding-facts.md Q1). Pairing
// them verbatim produces a citation that DISPLAYS as "reuters.com" and whose
// href goes to a Google API redirect: a claim about who published this research
// that the link does not support, stored permanently, catchable only by
// hovering. A candidate reads "Reuters" to a recruiter off a link that says no
// such thing.
//
// ------------------------------------------------------------------ THE RULE
//
//     A TITLE THAT NAMES A HOST IS NOT A NAME. The only domain that may appear
//     as a citation's label is the one `citationHost` derives from that
//     citation's OWN href, in the same expression that produces the href.
//
// WHY A RULE AND NOT A COMPARISON. The obvious fix is to compare the domain a
// title names against the host of the citation's own URL and drop it when they
// differ. That comparison is a thing a future edit can get wrong in at least
// four ways — `includes` instead of `===` (so `reuters.com` stands as the name
// of `reuters.com.evil.test`), comparing before trimming, folding `www.` on one
// side only, IDNA-folding neither — and this repo has already paid twice for
// exactly that class of bug: a host-only match that welded one page's headline
// onto another, and a link scanner that disagreed with the renderer on 6 of 9
// measured inputs. The comparison also buys nothing. A title that names the
// citation's OWN host is redundant with the host line the panel already prints
// from that href, so a MATCH and a MISMATCH have the same correct outcome: the
// title is not the label. Removing the comparison is therefore strictly better
// than getting it right — a label can only assert a publisher the URL does
// reach, structurally, because no foreign string can supply a domain at all.
//
// WHAT THIS CHANGES AND WHAT IT DOES NOT. It changes what is SAID about a
// citation, never where the link GOES. The href is untouched: the redirect
// still reaches the publisher, and refusing the citation outright would throw
// away a real source the model did cite and push the digest toward the "we
// found nothing" state that DigestPanel exists to keep separate from "we could
// not place them".
//
// WHAT IS DELIBERATELY NOT A PUBLISHER ASSERTION: a headline. "Nimbus raises
// Series C" claims nothing about who published it, so it survives on any URL,
// redirect included. Only the domain shape is a claim about identity.
//
// ACCEPTED RESIDUAL, stated rather than hidden, and the same direction the
// neighbouring `nonPublisherHosts` rule already leans. The test is the literal
// domain SHAPE, so a title of "Reuters" — a brand name carrying no TLD —
// survives on a redirect. Refusing every capitalised word that could name a
// publisher would discard most real headlines, which is the larger harm; the
// measured vendor behaviour is the bare DOMAIN, and that is what this catches.

import { citationHost } from "./citationHref.js";

/** The cap on a spoken label. The stored title is NOT capped — see below. */
export const CITATION_LABEL_MAX = 80;

/**
 * A label short enough to be spoken, cut at a word boundary, never mid-word.
 *
 * The ellipsis is separated from the last word rather than glued to it, so a
 * reader (and a screen reader) meets a whole word and then the mark that says
 * "there was more", rather than a word that looks misspelled. That separation
 * is what DigestPanel.test.js's `/\S…$/` assertion pins.
 */
function truncateLabel(value, max = CITATION_LABEL_MAX) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()} …`;
}

// One line, no runs of whitespace, no ends. Collapsing rather than only
// trimming is load-bearing twice: a stored title carrying a newline breaks the
// panel's layout, and a cap applied to a padded string measures padding rather
// than what a reader meets.
function normalise(title) {
  return typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
}

// The host a title NAMES, or null when it names none.
//
// `new URL` rather than a regex, because the shapes that must be recognised are
// exactly the shapes the URL parser recognises, and a hand-written domain regex
// is a second recogniser that drifts. Measured consequences, none of them
// enumerable by hand:
//   - "реклама.com" yields "xn--80aanufhx.com". A rule that only understood
//     ASCII would let a Cyrillic-spelled publisher domain through as a headline.
//   - "1.5" yields "1.0.0.5" and "v1.2.3" throws, so a version-shaped title is
//     kept while a numeric-dotted one is not. Both directions are acceptable;
//     over-refusing a title costs a name on an entry that keeps its host and
//     its link.
//   - "[2001:db8::1]" yields itself and carries no dot at all, which is why the
//     bracket clause below is not decoration.
//
// UNGATED `new URL` ON PURPOSE, and the asymmetry with `citationHost` is the
// point. `new URL("data://reuters.com/x").hostname` is "reuters.com".
// citationHost must be gated because it produces something DISPLAYED; this side
// only ever REFUSES, so parsing more strings than safeExternalHref would can
// catch more claims and can never admit one.
function namedHost(title) {
  // A phrase is not a host, and the parser would reject it anyway; testing it
  // here keeps a headline off the parse path entirely.
  if (title === "" || /\s/.test(title)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(title) ? title : `https://${title}`;
  let hostname;
  try {
    hostname = new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
  // "Reuters" parses as the host "reuters" and "..." as the host "...".
  // Neither is a registrable name: one has no dot, the other has no label.
  if (!/[a-z0-9]/.test(hostname)) return null;
  if (!hostname.includes(".") && !hostname.startsWith("[")) return null;
  return hostname;
}

/**
 * The admissible title for a citation: the string that may be shown as its
 * name, or "" when nothing it carries may be.
 *
 * Takes NO url, deliberately — see "WHY A RULE AND NOT A COMPARISON" above. A
 * title is judged on its own, and the citation's own host is supplied only by
 * `citationHost`, from its own href.
 *
 * NOT truncated: this is what gets STORED and what the panel prints in full
 * (DigestPanel.test.js pins that no CSS clamps it). The cap belongs to the
 * spoken label, and lives in `citationLabel`.
 *
 * @param {unknown} title
 * @returns {string}
 */
export function citationTitle(title) {
  const text = normalise(title);
  return namedHost(text) === null ? text : "";
}

/**
 * The one name a citation may be given, and which of the three sources it came
 * from. `kind: "unnamed"` carries an empty `text`: the copy a reader sees for
 * that state belongs to the surface, not to this module.
 *
 * The order is the whole rule: the entry's own admissible title, else the host
 * derived from the entry's OWN href and not suppressed as a non-publisher, else
 * nothing. There is no fourth fallback — the host-only path used to end at the
 * raw URL, and a URL is not a name.
 *
 * @param {unknown} record        a stored `sources` element: `{url, title}`
 * @param {unknown} hiddenHosts   `nonPublisherHosts(...)`, or anything
 * @returns {{text: string, kind: "title"|"host"|"unnamed"}}
 */
export function citationLabel(record, hiddenHosts) {
  const isObject = !!record && typeof record === "object" && !Array.isArray(record);

  const title = citationTitle(isObject ? record.title : undefined);
  if (title !== "") return { text: truncateLabel(title), kind: "title" };

  // SEC-F2: the host comes out of this record's OWN url, in the same expression
  // that decides whether that url may become an href at all.
  const host = citationHost(isObject ? record.url : undefined);
  const hidden = hiddenHosts instanceof Set ? hiddenHosts : new Set();
  if (host !== null && !hidden.has(host)) return { text: host, kind: "host" };

  return { text: "", kind: "unnamed" };
}
