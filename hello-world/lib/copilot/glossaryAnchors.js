// PASS A -- computed by US, before any model runs -- and the closed anchor space
// every anticipated term must name.
//
// PASS A PRODUCES TWO DIFFERENT THINGS, AND CONFLATING THEM IS A REAL DEFECT:
//
//   THE A-TERMS -- the stored "in this posting" list. TAXONOMY CANONICALS ONLY.
//   The RAKE `topic` tier is EXCLUDED from this half: it was measured producing
//   `push campaigns end`, `leadership monthly`, `acme financial`,
//   `000 employees` and `averaged 30 percent`. Each of those is literally in the
//   posting, so the kind-derivation rule would PROMOTE each to
//   `kind: "explicit"` and show it to a candidate under "In this posting".
//
//   THE ANCHOR SPACE -- parents, never stored as terms. Taxonomy canonicals
//   UNION RAKE topic phrases UNION exactly one validated role token. The topic
//   tier IS needed here: without it a charge-nurse posting has ZERO anchors
//   (measured) and the whole job family caps at fifteen terms.
//
// EVERY ANCHOR IS ITSELF ADMISSIBLE. `Communication` is a soft-skill taxonomy
// canonical present in all four postings measured, so as an anchor it could
// license a hundred children of any kind. Applying the term rules TO THE ANCHOR
// ITSELF is what closes that, and it is why this module imports the filter
// rather than re-deriving a list.
//
// THE ROLE TOKEN IS DELIBERATELY NOT THE CONSTANT "role". The model must NAME
// the role, and we validate that name against `positions.title` -- a constant
// would be satisfied by any string.
//
// Pure and network-free: the same extractor the resume-tailoring flow already
// scores a posting with, so "mention this" and "we tailored for this" cannot
// disagree about what the posting asked for.

import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { literallyMentioned } from "./answerLocal.js";
import { termRuleRejection, normalizeTerm, evidenceSpan } from "./glossaryTerms.js";
import {
  MAX_ANTICIPATED_TERMS,
  MAX_CHILDREN_PER_ANCHOR,
  MAX_ROLE_ANCHORED,
  MAX_TERMS_PER_ANCHOR_QUOTE,
  MAX_EVIDENCE_CHARS,
} from "./glossaryConstants.js";

/** The categories `extractKeywords` returns that are real taxonomy hits. */
const TAXONOMY_CATEGORIES = ["technology", "tool", "methodology", "domain", "soft_skill", "certification"];

function grouped(description) {
  try {
    return extractKeywords(String(description || ""), defaultLibraryData.taxonomy);
  } catch {
    // The same posture `postingBuzzwords` takes: a failure in the extractor
    // degrades the section to absent rather than breaking the feature around it.
    return null;
  }
}

function collect(groups, categories) {
  const out = [];
  for (const category of categories) {
    for (const item of groups?.[category] || []) {
      if (item?.canonical) out.push(item.canonical);
    }
  }
  return out;
}

/**
 * The A-terms: taxonomy canonicals literally present in the posting. UNCAPPED --
 * `MAX_BUZZWORDS = 4` is a DISPLAY budget belonging to a different feature and
 * is not a limit on what this one may mine.
 */
export function explicitTermsFor(description) {
  const text = String(description || "");
  if (!text.trim()) return [];
  const groups = grouped(text);
  if (!groups) return [];
  const seen = new Set();
  const out = [];
  for (const canonical of collect(groups, TAXONOMY_CATEGORIES)) {
    const key = normalizeTerm(canonical);
    if (seen.has(key)) continue;
    if (!literallyMentioned(canonical, text)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

/**
 * The closed set of parents. Every anticipated term must name one of these, and
 * a `parent` outside it is a per-term rejection.
 *
 * @returns {{ taxonomy: string[], topics: string[], roleToken: string, all: Set<string> }}
 */
export function anchorSpace(description, title) {
  const text = String(description || "");
  const groups = grouped(text);

  const taxonomy = [];
  const topics = [];
  const seen = new Set();

  const admissible = (candidate) =>
    candidate &&
    termRuleRejection(candidate) === null &&
    literallyMentioned(candidate, text) &&
    !seen.has(normalizeTerm(candidate));

  for (const canonical of collect(groups, TAXONOMY_CATEGORIES)) {
    if (!admissible(canonical)) continue;
    seen.add(normalizeTerm(canonical));
    taxonomy.push(canonical);
  }
  for (const phrase of collect(groups, ["topic"])) {
    if (!admissible(phrase)) continue;
    seen.add(normalizeTerm(phrase));
    topics.push(phrase);
  }

  const roleToken = `role:${normalizeTerm(title) || "this role"}`;
  return { taxonomy, topics, roleToken, all: new Set([...taxonomy, ...topics, roleToken]) };
}

/**
 * The ceiling for ONE row, computed and stored so a thin posting is visibly thin
 * in the data rather than silently so.
 *
 *   min(MAX_ANTICIPATED_TERMS,
 *       8 x taxonomy anchors + 8 x topic anchors + 20 role-anchored,
 *       6 x distinct quotable spans)
 */
export function maxAnticipatedForRow({ taxonomyCount = 0, topicCount = 0, quoteCount = 0 } = {}) {
  const byAnchor =
    MAX_CHILDREN_PER_ANCHOR * taxonomyCount + MAX_CHILDREN_PER_ANCHOR * topicCount + MAX_ROLE_ANCHORED;
  const byQuote = MAX_TERMS_PER_ANCHOR_QUOTE * quoteCount;
  return Math.min(MAX_ANTICIPATED_TERMS, byAnchor, byQuote);
}

/** The quotable spans of a posting -- the lines an `anchor_quote` may come from. */
export function quotableSpans(description) {
  return String(description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 20 && line.length <= 160);
}

/**
 * A verbatim span of the description containing the term, extracted by US.
 * Re-exported here so the harvest reaches Pass A and evidence through one module.
 */
export function evidenceFor(description, term) {
  return evidenceSpan(description, term, MAX_EVIDENCE_CHARS);
}
