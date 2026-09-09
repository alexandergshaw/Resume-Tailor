// THE ADMISSION FILTER -- the executable half of the storability rule.
//
// THE RULE, in one sentence: a term is worth storing if and only if a candidate
// for this posting could be asked "what is X?" in the interview AND COULD GET IT
// WRONG -- which is true exactly when the term's meaning is NOT recoverable from
// the ordinary English of its own words. The discriminator is
// NON-COMPOSITIONALITY.
//
//   communication                 recoverable                    NO
//   cross-functional collaboration "collaboration across functions" NO
//   attention to detail           recoverable                    NO
//   idempotency                   not recoverable                YES
//   SOC 2 Type II                 a named standard with a scope  YES
//   schema normalization          "schema" + "normalization" does not yield 1NF YES
//   indexing                      the everyday sense does not yield B-trees YES
//   the team                      trivially recoverable          NO
//
// NECESSARY, NOT SUFFICIENT. `transaction wraparound` satisfies it perfectly and
// is worthless to a lifecycle marketer. Storability is about the TERM; relevance
// is about the TERM-ROLE PAIR, and NOTHING IN THIS REPOSITORY CAN COMPUTE
// RELEVANCE -- the bundled taxonomy has zero conceptual terms, so there is no
// knowledge base against which "MVCC is irrelevant to lifecycle marketing" could
// be evaluated. The anchoring rules below bound VOLUME and force SPREAD; they do
// not detect relevance and must not be described as if they did.
//
// A PROMPT IS A REQUEST, NOT A CONTROL. The same eight contrasts are stated to
// the model verbatim, because a request that matches the control wastes less of
// the budget on terms that will be rejected -- but this file is what decides.
//
// `kind` AND `provenance` ARE THE TWO FIELDS THAT DESCRIBE THE HONESTY OF A ROW,
// AND BOTH ARE COMPUTED BY US. `kind` is overridden in BOTH directions against
// `literallyMentioned`, the function guarding this repo's two other posting-term
// miners, both of whose headers record it as the fix for the measured
// "team" -> "Microsoft Teams" mining hazard. A model-supplied `provenance` is a
// write-time REJECTION rather than a warning.

import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { literallyMentioned } from "./answerLocal.js";
import { significantTerms } from "./projectStories.js";
import {
  MAX_TERMS_PER_POSTING,
  MAX_EXPLICIT_TERMS,
  MAX_ANTICIPATED_TERMS,
  MAX_CHILDREN_PER_ANCHOR,
  MAX_ROLE_ANCHORED,
  MAX_TERMS_PER_ANCHOR_QUOTE,
  MAX_ANCHOR_QUOTE_CHARS,
  DEFINITION_HARD_MIN_WORDS,
  DEFINITION_HARD_MAX_WORDS,
  DEFINITION_MIN_RESIDUAL_TERMS,
} from "./glossaryConstants.js";

const STOPWORDS = new Set(defaultLibraryData.stopwords);

/**
 * G2. Single words whose meaning is genuinely ambiguous without a qualifier, and
 * which `stopwords.json` VERIFIABLY DOES NOT CONTAIN -- `platform`, `scale` and
 * `index` are the three that were measured absent from it, which is the entire
 * reason this list exists as a separate rule rather than a stopword addition.
 * They may enter only as unambiguous multiword forms: `database index`,
 * `horizontal scaling`, `message queue`.
 */
export const AMBIGUOUS_SINGLE_WORDS = new Set([
  "platform", "scale", "service", "pipeline", "stack", "cluster", "container",
  "queue", "bucket", "key", "partition", "index", "model", "agent", "channel",
  "driver", "thread", "process", "table", "view", "function", "class", "object",
  "event", "stream", "node", "cloud", "network", "security", "data", "product",
  "design", "growth", "impact", "ownership", "delivery", "discovery",
  "coverage", "retention", "attribution",
]);

/** G4. The executable half of the storability rule. */
export const GENERIC_PROFESSIONAL_PHRASES = new Set([
  "communication", "teamwork", "collaboration", "cross-functional collaboration",
  "problem solving", "attention to detail", "fast-paced environment",
  "self-starter", "stakeholder management", "time management", "work ethic",
  "growth mindset", "customer focus", "results-driven", "team player",
  "strong communicator", "analytical skills", "critical thinking",
  "adaptability", "leadership", "mentorship", "ownership mentality",
  "bias for action", "first principles", "best practices",
  "continuous improvement", "project management", "written communication",
  "verbal communication", "interpersonal skills", "organizational skills",
  "multitasking", "prioritization", "initiative", "creativity", "flexibility",
  "reliability", "professionalism", "motivation", "passion",
]);

const TERM_SHAPE_RE = /^[A-Za-z0-9 +#./&'()-]+$/;
const CATEGORIES = new Set(["tech", "process", "terminology", "standard", "other"]);
/**
 * `<` immediately followed by a letter or a slash -- never a bare comparison, so
 * "latency < 100ms" is prose and is not refused. The recogniser the ask route
 * already uses, imported in spirit rather than re-derived by feel.
 */
const HTML_TAG_RE = /<\/?[a-zA-Z]/;

/** @param {unknown} value */
export function normalizeTerm(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function wordsOf(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

/**
 * G1-G5, applied to a bare term string. Returns the failing rule's name, or
 * null. Exported so `glossaryAnchors` can apply the same rules TO AN ANCHOR
 * ITSELF -- an anchor that would not survive as a term must not be allowed to
 * license a hundred children.
 *
 * @returns {"G1"|"G2"|"G3"|"G4"|"G5"|null}
 */
export function termRuleRejection(term) {
  const raw = String(term ?? "").trim();
  const normalized = normalizeTerm(raw);
  const tokens = wordsOf(normalized);

  // G5, shape. Checked first because the others assume a sane string.
  if (raw.length < 3 || raw.length > 60) return "G5";
  if (tokens.length > 5) return "G5";
  if (!TERM_SHAPE_RE.test(raw)) return "G5";

  if (tokens.length === 1) {
    if (STOPWORDS.has(tokens[0])) return "G1";
    if (AMBIGUOUS_SINGLE_WORDS.has(tokens[0])) return "G2";
  } else if (tokens.every((t) => STOPWORDS.has(t))) {
    // G3. Kills "working with teams", "new role", "build experience".
    return "G3";
  }

  if (GENERIC_PROFESSIONAL_PHRASES.has(normalized)) return "G4";
  return null;
}

/**
 * G6 and the definition contract. Applied at HARVEST ingest and AGAIN at
 * research ingest -- a grounded definition can be a restatement too, and a
 * grounded call is looking at web pages, so a definition that tries to paste a
 * URL into its own text is a likely failure mode. The URL belongs in
 * `source_url` where the href gate can see it, never inline in prose.
 *
 * @returns {"length"|"markup"|"G6"|null}
 */
export function definitionRejection(term, definition) {
  const text = String(definition ?? "").trim();
  const words = wordsOf(text);
  if (words.length < DEFINITION_HARD_MIN_WORDS || words.length > DEFINITION_HARD_MAX_WORDS) {
    return "length";
  }
  if (/https?:\/\//i.test(text) || text.includes("](") || HTML_TAG_RE.test(text)) return "markup";
  if (/(^|\s)\[[^\]]*\]/.test(text)) return "markup";

  // G6. Strip the term's own tokens and every stopword; what is left must carry
  // real content. Kills "communication: the act of communicating clearly with
  // the people on your team."
  const own = new Set(wordsOf(normalizeTerm(term)));
  const residual = new Set();
  for (const token of significantTerms(text)) {
    if (own.has(token)) continue;
    if (STOPWORDS.has(token)) continue;
    if ([...own].some((o) => o.startsWith(token) || token.startsWith(o))) continue;
    residual.add(token);
  }
  if (residual.size < DEFINITION_MIN_RESIDUAL_TERMS) return "G6";
  return null;
}

function bump(counter, key) {
  counter[key] = (counter[key] || 0) + 1;
}

/**
 * The whole harvest ingest. Takes the model's proposed terms and the computed
 * anchor space, and returns the rows that will actually be stored.
 *
 * ONE BAD TERM NEVER POISONS THE ROW: ingest is per term, a failure is dropped
 * and counted, and the rest are stored.
 *
 * @param {Array<object>} candidates the model's own output, untrusted
 * @param {{ description: string, title?: string, anchors: Set<string>|Array<string>,
 *           maxAnticipated?: number }} context
 */
export function admitHarvestedTerms(candidates, context) {
  const description = String(context?.description || "");
  const anchors = context?.anchors instanceof Set ? context.anchors : new Set(context?.anchors || []);
  const maxAnticipated = Number.isFinite(context?.maxAnticipated)
    ? Math.min(context.maxAnticipated, MAX_ANTICIPATED_TERMS)
    : MAX_ANTICIPATED_TERMS;

  const rejectedByRule = {};
  const terms = [];
  const seen = new Map();
  const perAnchor = new Map();
  const perQuote = new Map();
  let rejectedCount = 0;
  let droppedCount = 0;
  let explicitCount = 0;
  let anticipatedCount = 0;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate !== "object") {
      rejectedCount += 1;
      bump(rejectedByRule, "shape");
      continue;
    }

    // The two honesty fields are ours. A model that supplied one is not making a
    // suggestion we can ignore; it is asserting something only we may compute.
    if ("provenance" in candidate) {
      rejectedCount += 1;
      bump(rejectedByRule, "provenance");
      continue;
    }

    const term = String(candidate.term ?? "").trim().replace(/\s+/g, " ");
    const ruleFailure = termRuleRejection(term);
    if (ruleFailure) {
      rejectedCount += 1;
      bump(rejectedByRule, ruleFailure);
      continue;
    }

    const definition = String(candidate.definition ?? "").trim();
    const definitionFailure = definitionRejection(term, definition);
    if (definitionFailure) {
      rejectedCount += 1;
      bump(rejectedByRule, definitionFailure);
      continue;
    }

    const category = CATEGORIES.has(candidate.category) ? candidate.category : "other";

    // `kind` is DERIVED. Tagged explicit but not literally present -> DEMOTED to
    // anticipated (never discarded -- the demotion IS the honesty control), and
    // it must then satisfy the anchoring rules like any other anticipated term.
    // Tagged anticipated but literally present -> PROMOTED to explicit, and its
    // anchor is dropped because an explicit term needs no parent.
    const present = literallyMentioned(term, description);
    const kind = present ? "explicit" : "anticipated";

    let record;
    if (kind === "explicit") {
      const evidence = evidenceSpan(description, term);
      if (!evidence) {
        rejectedCount += 1;
        bump(rejectedByRule, "G7c");
        continue;
      }
      record = { term, kind, category, evidence, definition, provenance: "recalled" };
    } else {
      const parent = String(candidate.parent ?? "").trim();
      // G7a. The anchor space is CLOSED. A naive "declare a parent from the
      // Pass-A list" rule checks string membership and never the child-parent
      // relation, so one incidental `SQL` mention licenses a hundred
      // PostgreSQL-internals terms for a lifecycle marketer.
      if (!parent || !anchors.has(parent)) {
        rejectedCount += 1;
        bump(rejectedByRule, "G7a");
        continue;
      }
      // G7c. Verbatim, and verified here rather than trusted.
      const quote = String(candidate.anchor_quote ?? "").trim();
      if (!quote || quote.length > MAX_ANCHOR_QUOTE_CHARS || !description.includes(quote)) {
        rejectedCount += 1;
        bump(rejectedByRule, "G7c");
        continue;
      }
      record = {
        term,
        kind,
        category,
        parent,
        anchor_quote: quote,
        definition,
        provenance: "recalled",
      };
    }

    // G8. Case-insensitive dedupe, longest surface form wins. A term equal to,
    // or a case variant of, an explicit term collapses into the explicit one.
    const key = normalizeTerm(term);
    const existing = seen.get(key);
    if (existing) {
      droppedCount += 1;
      if (record.kind === "explicit" && existing.kind !== "explicit") {
        Object.assign(existing, record);
      } else if (record.term.length > existing.term.length && record.kind === existing.kind) {
        existing.term = record.term;
      }
      continue;
    }

    if (record.kind === "anticipated") {
      // G7b, a per-anchor child budget on EVERY anchor, and G7d, a per-quote
      // budget. Both bound volume and force spread across the posting.
      const anchorBudget = record.parent.startsWith("role:")
        ? MAX_ROLE_ANCHORED
        : MAX_CHILDREN_PER_ANCHOR;
      const usedByAnchor = perAnchor.get(record.parent) || 0;
      if (usedByAnchor >= anchorBudget) {
        droppedCount += 1;
        bump(rejectedByRule, "G7b");
        continue;
      }
      const usedByQuote = perQuote.get(record.anchor_quote) || 0;
      if (usedByQuote >= MAX_TERMS_PER_ANCHOR_QUOTE) {
        droppedCount += 1;
        bump(rejectedByRule, "G7d");
        continue;
      }
      if (anticipatedCount >= maxAnticipated) {
        droppedCount += 1;
        bump(rejectedByRule, "ceiling");
        continue;
      }
      perAnchor.set(record.parent, usedByAnchor + 1);
      perQuote.set(record.anchor_quote, usedByQuote + 1);
      anticipatedCount += 1;
    } else {
      if (explicitCount >= MAX_EXPLICIT_TERMS) {
        droppedCount += 1;
        bump(rejectedByRule, "ceiling");
        continue;
      }
      explicitCount += 1;
    }

    if (terms.length >= MAX_TERMS_PER_POSTING) {
      droppedCount += 1;
      bump(rejectedByRule, "ceiling");
      if (record.kind === "explicit") explicitCount -= 1;
      else anticipatedCount -= 1;
      continue;
    }

    seen.set(key, record);
    terms.push(record);
  }

  return {
    terms,
    rejectedCount,
    droppedCount,
    rejectedByRule,
    explicitCount,
    anticipatedCount,
  };
}

/**
 * A verbatim span of the description containing the term, extracted SERVER-SIDE
 * BY US and never quoted back by the model. Exported through `glossaryAnchors`
 * as `evidenceFor`; kept here because the admission filter needs it and a second
 * copy would be the drift this file's rules exist to prevent.
 */
export function evidenceSpan(description, term, maxChars = 200) {
  const text = String(description || "");
  const needle = String(term || "");
  if (!needle) return null;
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;

  // Prefer the sentence-ish line the term sits on; fall back to a window.
  const lineStart = text.lastIndexOf("\n", at) + 1;
  const lineEndRaw = text.indexOf("\n", at);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  const line = text.slice(lineStart, lineEnd).trim();
  if (line.length > 0 && line.length <= maxChars && text.includes(line)) return line;

  const half = Math.floor((maxChars - needle.length) / 2);
  const from = Math.max(0, at - Math.max(half, 0));
  return text.slice(from, Math.min(text.length, from + maxChars));
}
