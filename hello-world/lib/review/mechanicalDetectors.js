// The deterministic floor of the shared document reviewer: six pure detectors
// over app-minted spans, plus the unresolved-qualification computation. No model,
// no network, no clock, no randomness - the same input always yields the same
// flags.
//
// Reuse is by MECHANISM, decided per symbol:
//   * extractKeywords (tailor-lite/keywords.js) and headerDateSpan
//     (resume/parseEmployment.js) are exported and pure all the way down their
//     import graphs, so they are imported as-is.
//   * The weak-opener lexicon and the word-boundary presence test live in
//     modules that do not export them (and that would drag a foreign import
//     graph into this pure core), so both are REIMPLEMENTED here as this file's
//     own vocabulary rather than reached into.
//   * The quantified-claim pattern is this file's own. The résumé critique has a
//     numeric pattern too, but it answers the OPPOSITE question there (a bullet
//     LACKING a number is weak), so sharing one pattern would couple two
//     opposite polarities: widening it here would flag more, widening it there
//     would flag less.
//
// Detectors read ids off input span objects and pass them through; none of them
// builds a span id. The orchestrator's emit() chokepoint is what proves that.

import { CATEGORY, ORIGIN } from "./contract.js";
import { selectAuthorityReference } from "./referenceSelect.js";
import { extractKeywords } from "../llm/engines/tailor-lite/keywords.js";
import { headerDateSpan } from "../resume/parseEmployment.js";

// ---------------------------------------------------------------------------
// Own vocabularies
// ---------------------------------------------------------------------------

// Constructions that open a bullet without saying what was done or what changed.
const VAGUE_OPENERS = [
  "responsible for",
  "worked on",
  "helped with",
  "helped to",
  "duties included",
  "assisted with",
  "assisted in",
  "tasked with",
  "involved in",
  "participated in",
  "was part of",
  "in charge of",
  "contributed to",
  "exposure to",
];

// Filler that signals a claim with nothing behind it, wherever it sits.
const VAGUE_FILLER_RE =
  /\b(?:various|several|numerous|miscellaneous|a variety of|a number of|etc|and so on|stuff|things)\b/i;

// What counts as a concrete outcome for the vague-unsupported check: a figure.
const CONCRETE_OUTCOME_RE = /\d|%|\$/;

// A quantified claim: a percentage, a dollar amount, or a multiplier.
const NUMERIC_CLAIM_RE = /\d+(?:\.\d+)?\s?%|\$\s?\d[\d,.]*(?:\s?[kmb]\b)?|\b\d+(?:\.\d+)?x\b/i;

// Something a reader can verify a quantified claim against: a before/after, a
// named comparison, a rate over a period, or a stated source.
const BASELINE_RE =
  /\bfrom\b[^.;]*\bto\b|\bvs\b\.?|\b(?:versus|baseline|compared (?:to|with)|relative to|up from|down from|previously|prior to|year[- ]over[- ]year|quarter[- ]over[- ]quarter|month[- ]over[- ]month|yoy|qoq|per (?:day|week|month|quarter|year|user|customer|request)|source|according to|measured (?:by|via|in))\b/i;

// Seniority ladder, first match wins, for judging an authority claim. The low
// modifiers sit first so "Junior Director" is not read as a director.
const RANK_PATTERNS = [
  [1, /\b(?:junior|jr|intern|interns|internship|trainee|apprentice)\b/i],
  [6, /\b(?:cto|ceo|cfo|coo|cio|cso|chief|president|vp|vice president|founder|co-founder)\b/i],
  [5, /\b(?:director|head of)\b/i],
  [4, /\b(?:manager|principal)\b/i],
  [3, /\b(?:senior|sr|lead|staff)\b/i],
  [1, /\b(?:associate|assistant)\b/i],
  [2, /\b(?:engineer|developer|analyst|designer|scientist|consultant|specialist|coordinator|programmer|architect)\b/i],
];

// Team-size scope: "50-person", "200 engineers", "team of 12".
const SCOPE_PATTERNS = [
  /(\d[\d,]*)\s*[- ]?(?:\+\s*)?(?:person|people|engineers?|developers?|employees?|reports?|members?|staff|analysts?|designers?)\b/i,
  /\b(?:team|org|organization|organisation|group|department) of (\d[\d,]*)/i,
];

const LEADERSHIP_RE = /\b(?:led|lead|leading|directed|managed|oversaw|headed|ran|supervised)\b/i;

// Words that carry no requirement meaning when matching an unclassifiable
// requirement against draft text.
const REQUIREMENT_FILLER = new Set([
  "must", "have", "hold", "with", "that", "this", "from", "your", "years", "year",
  "experience", "experienced", "ability", "able", "knowledge", "skills", "skill",
  "working", "work", "using", "plus", "preferred", "required", "requirements",
  "requirement", "strong", "good", "great", "excellent", "proven", "demonstrated",
  "understanding", "active", "including", "across", "well", "team", "teams",
  "similar", "related", "relevant", "minimum", "least",
]);

const REPETITION_STOP = new Set([
  "the", "a", "an", "of", "and", "to", "in", "for", "with", "on", "by", "at", "as", "is", "was", "our",
]);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// A draft's usable spans in id order, so every detector is independent of the
// order the caller happened to list them in.
function spansOf(draft) {
  const spans = Array.isArray(draft?.spans) ? draft.spans : [];
  return spans.filter((s) => s && typeof s.id === "string" && typeof s.text === "string").sort(byId);
}

function clip(text, max = 80) {
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word presence test. A bare substring check is wrong here: "react" sits
// inside "reaction" and "go" inside "going", so a required keyword would read as
// present in a draft that never says it. The boundary class counts a hyphen as
// part of a word, so "react-native" is not "react", but "React.js" and "React,"
// are.
function containsTerm(text, term) {
  const t = String(term ?? "").trim().toLowerCase();
  if (!t) return false;
  const re = new RegExp(`(?<![a-z0-9-])${escapeRegExp(t)}(?![a-z0-9-])`);
  return re.test(String(text ?? "").toLowerCase());
}

// The taxonomy keywords a piece of text names. The advisory "topic" phrases the
// extractor also returns are not keywords and are left out.
function keywordTermsOf(text) {
  const grouped = extractKeywords(String(text ?? ""));
  const seen = new Set();
  const out = [];
  for (const category of Object.keys(grouped).sort()) {
    if (category === "topic") continue;
    for (const k of grouped[category]) {
      const key = k.canonical.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(k.canonical);
    }
  }
  return out;
}

// A presence test for one haystack that counts a keyword as present when the
// text says it as a word OR names it by a taxonomy alias ("k8s" for Kubernetes).
function presenceChecker(text) {
  const haystack = String(text ?? "");
  let canonicals = null;
  return (term) => {
    if (containsTerm(haystack, term)) return true;
    if (!canonicals) canonicals = new Set(keywordTermsOf(haystack).map((t) => t.toLowerCase()));
    return canonicals.has(String(term).toLowerCase());
  };
}

function makeFlag(draft, span, category, message, evidenceRef) {
  const flag = { draftKind: draft.kind, spanId: span.id, category, message };
  if (evidenceRef) flag.evidenceRef = evidenceRef;
  return flag;
}

const requirementsOf = (posting) =>
  (Array.isArray(posting?.requirements) ? posting.requirements : []).filter(
    (r) => r && typeof r.id === "string" && typeof r.text === "string",
  );

// ---------------------------------------------------------------------------
// AC-4 missing-keyword
// ---------------------------------------------------------------------------

// Each taxonomy keyword a posting requirement names that the draft never says
// is flagged. The flag's top-level span must be a DRAFT span, so it is anchored
// on the draft's lowest-id span (content-stable, unlike "the first one listed");
// the requirement is named in evidenceRef.
export function detectMissingKeyword(draft, posting) {
  const spans = spansOf(draft);
  if (!spans.length) return [];
  const anchor = spans[0];
  const present = presenceChecker(spans.map((s) => s.text).join("\n"));
  const found = [];
  for (const req of requirementsOf(posting)) {
    for (const term of keywordTermsOf(req.text)) {
      if (present(term)) continue;
      found.push(
        makeFlag(
          draft,
          anchor,
          CATEGORY.MISSING_KEYWORD,
          `The posting asks for "${term}" ("${clip(req.text)}") but this draft never mentions it.`,
          { origin: ORIGIN.POSTING, spanId: req.id },
        ),
      );
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// AC-5 repetition
// ---------------------------------------------------------------------------

function tokensOf(text) {
  return String(text).toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) || [];
}

// The phrases a span can be said to repeat: its three-word opening, and every
// four-word run that carries at least three content words.
function phraseKeysOf(text) {
  const tokens = tokensOf(text);
  const keys = [];
  if (tokens.length >= 3) keys.push(`open:${tokens.slice(0, 3).join(" ")}`);
  for (let i = 0; i + 4 <= tokens.length; i += 1) {
    const gram = tokens.slice(i, i + 4);
    if (gram.filter((w) => !REPETITION_STOP.has(w)).length >= 3) keys.push(`gram:${gram.join(" ")}`);
  }
  return keys;
}

// A span that repeats an earlier span's phrase is flagged, with the earlier span
// as evidence. "Earlier" is by id, not by position, so shuffling the spans does
// not change which one carries the flag; each span carries at most one.
export function detectRepetition(draft) {
  const spans = spansOf(draft);
  const keyed = spans.map((s) => ({ span: s, keys: phraseKeysOf(s.text) }));
  const found = [];
  for (let j = 1; j < keyed.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      const shared = keyed[j].keys.find((k) => keyed[i].keys.includes(k));
      if (!shared) continue;
      const phrase = shared.slice(shared.indexOf(":") + 1);
      found.push(
        makeFlag(
          draft,
          keyed[j].span,
          CATEGORY.REPETITION,
          `Repeats "${phrase}", which another span in this draft already uses.`,
          { origin: ORIGIN.DRAFT, draftKind: draft.kind, spanId: keyed[i].span.id },
        ),
      );
      break;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// AC-6 unverifiable-metric
// ---------------------------------------------------------------------------

// A quantified claim with nothing to check it against (no before/after, no
// comparison, no source) is unverifiable. Verifiability is a property of the
// draft ALONE, so this never consults real material and behaves identically on
// both draft kinds.
export function detectUnverifiableMetric(draft) {
  const found = [];
  for (const span of spansOf(draft)) {
    const claim = span.text.match(NUMERIC_CLAIM_RE);
    if (!claim || BASELINE_RE.test(span.text)) continue;
    found.push(
      makeFlag(
        draft,
        span,
        CATEGORY.UNVERIFIABLE_METRIC,
        `The figure "${claim[0].trim()}" has no baseline, comparison or source to check it against.`,
      ),
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// AC-7 vague-unsupported
// ---------------------------------------------------------------------------

const VAGUE_OPENER_RE = new RegExp(`^(?:${VAGUE_OPENERS.map(escapeRegExp).join("|")})\\b`);

// A span that opens with a vague construction, or leans on filler, and offers no
// concrete figure.
export function detectVagueUnsupported(draft) {
  const found = [];
  for (const span of spansOf(draft)) {
    if (CONCRETE_OUTCOME_RE.test(span.text)) continue;
    const bare = span.text.replace(/^[\s\-*•·]+/, "").toLowerCase();
    const opener = bare.match(VAGUE_OPENER_RE);
    const filler = span.text.match(VAGUE_FILLER_RE);
    if (!opener && !filler) continue;
    const why = opener ? `opens with "${opener[0]}"` : `leans on "${filler[0].toLowerCase()}"`;
    found.push(
      makeFlag(draft, span, CATEGORY.VAGUE_UNSUPPORTED, `Vague and unsupported: it ${why} and states no concrete outcome.`),
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// AC-9 consistency skeleton (cross-draft date contradiction)
// ---------------------------------------------------------------------------

const COMPANY_SUFFIXES = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "company", "gmbh"]);
const PRESENT_RE = /present|current|now|to\s*date|ongoing|today/i;

// The employer a dated header line is about: the text on the date's near side
// (or the far side for a date-first header), lowercased, with separators and
// corporate suffixes dropped so "Acme Corp |" and "Acme," agree.
function employerKey(text, dateSpan) {
  const beside = (s) =>
    s
      .toLowerCase()
      .replace(/[|,;:()[\]–—-]+/g, " ")
      .split(/\s+/)
      .filter((w) => w && !COMPANY_SUFFIXES.has(w))
      .join(" ");
  const before = beside(text.slice(0, dateSpan.start));
  return before || beside(text.slice(dateSpan.end));
}

// { start, end } years of a matched date RANGE; end is "present" for an open
// range. Months are ignored on purpose: only an unambiguous year disagreement
// is a contradiction.
function yearsOf(matched) {
  const years = String(matched).match(/\b(?:19|20)\d{2}\b/g);
  if (!years) return null;
  const open = PRESENT_RE.test(matched);
  const end = open ? "present" : years[1];
  if (!years[0] || !end) return null;
  return { start: years[0], end };
}

// Two drafts that date the same employer differently contradict each other. The
// flag sits on each draft's own span and cites the other draft's span, so either
// draft can show the conflict. This is the unambiguous first-slice depth;
// semantic consistency is the judge's.
export function detectConsistencySkeleton(drafts) {
  const entries = [];
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    for (const span of spansOf(draft)) {
      const dateSpan = headerDateSpan(span.text);
      if (!dateSpan || dateSpan.via !== "range") continue;
      const years = yearsOf(dateSpan.matched);
      const key = employerKey(span.text, dateSpan);
      if (!years || key.length < 2) continue;
      entries.push({ draft, span, key, years });
    }
  }
  const found = [];
  for (const a of entries) {
    for (const b of entries) {
      if (a.draft.kind === b.draft.kind || a.key !== b.key) continue;
      if (a.years.start === b.years.start && a.years.end === b.years.end) continue;
      found.push(
        makeFlag(
          a.draft,
          a.span,
          CATEGORY.CONSISTENCY,
          `Dates for "${a.key}" (${a.years.start}-${a.years.end}) disagree with the ${b.draft.kind} draft (${b.years.start}-${b.years.end}).`,
          { origin: ORIGIN.DRAFT, draftKind: b.draft.kind, spanId: b.span.id },
        ),
      );
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// AC-8 / AC-2 / AC-13 authority skeleton
// ---------------------------------------------------------------------------

function titleRankOf(text) {
  for (const [rank, re] of RANK_PATTERNS) if (re.test(text)) return rank;
  return null;
}

function scopeRankOf(text) {
  for (const re of SCOPE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number.parseInt(m[1].replace(/,/g, ""), 10);
    if (n >= 50) return 5;
    if (n >= 10) return 4;
    if (n >= 5) return 3;
    if (n >= 2) return 2;
  }
  return null;
}

const maxRank = (a, b) => (a === null ? b : b === null ? a : Math.max(a, b));

// What a span claims or evidences about seniority. A dated header line names a
// job, so its title is read from the whole line; any other span only claims a
// title when it LEADS with one ("CTO leading ...", "as a Director ..."), so a
// bullet that merely mentions "the director" claims nothing.
function spanRank(text) {
  const dateSpan = headerDateSpan(text);
  if (dateSpan) {
    const bare = `${text.slice(0, dateSpan.start)} ${text.slice(dateSpan.end)}`;
    return { rank: maxRank(titleRankOf(bare), scopeRankOf(bare)), dated: true };
  }
  const lead = text.split(/\s+/).slice(0, 3).join(" ");
  const asClause = text.match(/\b(?:as|serving as|promoted to|became|appointed|named)\s+(?:an?\s+|the\s+)?((?:\S+\s+){0,3}\S+)/i);
  const titled = titleRankOf(`${lead} ${asClause ? asClause[1] : ""}`);
  return { rank: maxRank(titled, scopeRankOf(text)), dated: false };
}

function rankedSpans(spans) {
  return spans.map((span) => ({ span, ...spanRank(span.text) }));
}

// The single best-evidenced reference: highest rank, lowest id on a tie.
function bestRanked(ranked) {
  let best = null;
  for (const r of ranked) {
    if (r.rank !== null && (best === null || r.rank > best.rank)) best = r;
  }
  return best;
}

// Authority claims, judged against the reference the draft's kind selects.
//   internal-coherence  a claim is unsupported when the draft's OWN dated
//                       entries show a title two or more rungs below it.
//   real-material       a claim is unsupported when the candidate's real
//                       material does not reach it; with NO real material at all
//                       (AC-13) every authority claim fails closed.
// A claim one rung above its reference is tolerated as title inflation.
export function detectAuthoritySkeleton(draft, realMaterial) {
  const spans = spansOf(draft);
  if (!spans.length) return [];
  const { mode, referenceSpans } = selectAuthorityReference(draft, realMaterial);
  const ranked = rankedSpans(spans);
  const found = [];

  if (mode === "internal-coherence") {
    const entry = bestRanked(ranked.filter((r) => r.dated));
    if (!entry) return [];
    for (const r of ranked) {
      if (r.dated || r.rank === null || r.rank < 3 || r.rank - entry.rank < 2) continue;
      found.push(
        makeFlag(
          draft,
          r.span,
          CATEGORY.UNSUPPORTED_AUTHORITY,
          `"${clip(r.span.text)}" claims more seniority than this draft's own dated role ("${clip(entry.span.text)}") supports.`,
          { origin: ORIGIN.DRAFT, draftKind: draft.kind, spanId: entry.span.id },
        ),
      );
    }
    return found;
  }

  const refs = referenceSpans
    .filter((s) => s && typeof s.id === "string" && typeof s.text === "string")
    .sort(byId);
  if (!refs.length) {
    for (const r of ranked) {
      const claims = (r.rank !== null && r.rank >= 3) || LEADERSHIP_RE.test(r.span.text);
      if (!claims) continue;
      found.push(
        makeFlag(
          draft,
          r.span,
          CATEGORY.UNSUPPORTED_AUTHORITY,
          `No candidate material was available to support "${clip(r.span.text)}", so the claim is unsupported.`,
        ),
      );
    }
    return found;
  }

  const best = bestRanked(rankedSpans(refs));
  const reached = best ? best.rank : 0;
  for (const r of ranked) {
    if (r.rank === null || r.rank < 3 || r.rank <= reached + 1) continue;
    found.push(
      makeFlag(
        draft,
        r.span,
        CATEGORY.UNSUPPORTED_AUTHORITY,
        best
          ? `"${clip(r.span.text)}" claims more than the candidate's material supports ("${clip(best.span.text)}").`
          : `"${clip(r.span.text)}" is not supported by any of the candidate's material.`,
        best ? { origin: ORIGIN.REAL_MATERIAL, spanId: best.span.id } : undefined,
      ),
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// AC-14 unresolved qualifications
// ---------------------------------------------------------------------------

function contentWords(text) {
  const words = String(text).toLowerCase().match(/[a-z]{4,}/g) || [];
  return [...new Set(words.filter((w) => !REQUIREMENT_FILLER.has(w)))];
}

// Does the haystack cover most of a requirement's content words? A prefix match
// on the word (so "pipeline" meets "pipelines") with a hard boundary at its start.
function addresses(haystack, requirementText) {
  const words = contentWords(requirementText);
  if (!words.length) return false;
  const lower = String(haystack).toLowerCase();
  const hits = words.filter((w) => new RegExp(`(?<![a-z0-9])${escapeRegExp(w)}[a-z]*`).test(lower)).length;
  return hits >= Math.ceil(words.length * 0.6);
}

// Requirements that rewording cannot resolve. A requirement drops out when the
// drafts already address it, or when everything it asks for is merely missing
// from the drafts but present in the candidate's real material (a phrasing gap,
// surfaced as a missing-keyword flag instead). A requirement the extractor
// cannot classify is matched on its content words. When nothing can be told,
// the requirement is listed: omitting a genuine gap is the worse error.
export function computeUnresolvedQualifications(drafts, posting, realMaterial) {
  const draftText = (Array.isArray(drafts) ? drafts : [])
    .flatMap((d) => spansOf(d).map((s) => s.text))
    .join("\n");
  const corpusText = (Array.isArray(realMaterial?.spans) ? realMaterial.spans : [])
    .filter((s) => s && typeof s.text === "string")
    .map((s) => s.text)
    .join("\n");
  const inDrafts = presenceChecker(draftText);
  const inCorpus = presenceChecker(corpusText);

  const out = [];
  for (const req of requirementsOf(posting)) {
    const terms = keywordTermsOf(req.text);
    let resolved;
    if (terms.length) {
      const missing = terms.filter((t) => !inDrafts(t));
      resolved = missing.length === 0 || missing.every((t) => inCorpus(t));
    } else {
      resolved = addresses(draftText, req.text) || addresses(corpusText, req.text);
    }
    if (!resolved) out.push({ requirementId: req.id, text: req.text });
  }
  return out.sort((a, b) => (a.requirementId < b.requirementId ? -1 : a.requirementId > b.requirementId ? 1 : 0));
}
