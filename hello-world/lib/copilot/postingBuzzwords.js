// The posting's own vocabulary — the terms a candidate should say back to
// the interviewer, mined from the job description they applied against.
//
// This is the ONE place the posting description is allowed to influence an
// answer, and it does so as a separate, clearly-labelled list rather than as
// grounding: app/api/copilot/answer/route.js still never puts the description
// into either prompt (AC-H7.27), because an answer that quietly absorbs the
// posting's wording is how a candidate ends up claiming experience the
// posting described rather than experience they have. A list the candidate
// reads and chooses from does not have that failure mode — they decide which
// of these they can honestly say.
//
// Reuses tailor-lite's deterministic extractor rather than a second scraper:
// the terms surfaced here are then the SAME canonical terms the résumé
// tailoring flow already scores a posting on, so "mention this" and "we
// tailored for this" cannot disagree about what the posting asked for.
//
// Pure and network-free: no LLM, no API key, identical output for identical
// input — the embedded engine and the Gemini engine both call this, so the
// buzzword list never depends on which engine drafted the answer.

import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { literallyMentioned } from "./answerLocal.js";

export const MAX_BUZZWORDS = 6;

// Taxonomy categories worth saying out loud in an interview, in the order
// they are drawn on when trimming to the cap. `subject` (academic subjects)
// is deliberately absent: naming a school subject back at an interviewer is
// not what this list is for.
const BUZZWORD_CATEGORIES = ["technology", "tool_platform", "methodology", "domain", "soft_skill", "certification"];

function collect(grouped, categories) {
  const items = [];
  for (const category of categories) {
    for (const item of grouped[category] || []) items.push(item);
  }
  return items;
}

// A usability filter for the `topic` (RAKE) tier ONLY — never the taxonomy
// tier, whose real canonicals include single-letter/short names like "Go",
// "R", "C", "C++", "C#" that a `part.length >= 2` rule would wrongly delete.
// RAKE topic phrases are unbounded free text pulled off the posting, so
// without a filter they can run to a single ~84-char (or worse, ~21,000-char
// on pathological input) chip, or split on punctuation into garbage like
// "d partnership" / "support r" / "grade c".
const MAX_TOPIC_WORDS = 4;
const MAX_TERM_CHARS = 32;
function isUsableTopic(canonical) {
  const parts = String(canonical).trim().split(/\s+/);
  return (
    canonical.length <= MAX_TERM_CHARS &&
    parts.length >= 2 &&
    parts.length <= MAX_TOPIC_WORDS &&
    parts.every((part) => part.length >= 2)
  );
}

// The terms from `description` most worth working into the answer for THIS
// question. Ranked by whether the term is already relevant to what is being
// answered (so the same posting yields a different emphasis per question),
// then by the extractor's own section-weighted score, then by discovery order
// so the result is fully deterministic.
//
// `context` is the question plus whatever the draft already says: a term the
// answer ALREADY uses is the strongest signal that saying it is natural here,
// not a stretch.
export function postingBuzzwords(description, { question = "", points = [], limit = MAX_BUZZWORDS } = {}) {
  const text = String(description || "").trim();
  if (!text) return [];

  let grouped;
  try {
    grouped = extractKeywords(text, defaultLibraryData.taxonomy);
  } catch {
    // Same posture as profileSkills (answerLocal.js): a taxonomy failure
    // degrades this section to absent, never breaks the answer around it.
    return [];
  }

  const context = [String(question || ""), ...(Array.isArray(points) ? points : [])]
    .map((p) => String(p || ""))
    .join(" ");

  // Two tiers: taxonomy terms (recognized, canonically cased) and RAKE topic
  // phrases (advisory multiword phrases the taxonomy missed — the fallback
  // that keeps a posting for a non-technical role from coming back empty).
  //
  // RELEVANCE outranks tier, deliberately. A recognized term the answer has
  // nothing to do with is worse advice than an unrecognized phrase the answer
  // is already about: this list is "say these here", not "these are the
  // important words in the posting". Tier only decides between two terms that
  // are equally relevant — their scores come from different scales and are
  // not comparable across tiers.
  const candidates = [
    ...collect(grouped, BUZZWORD_CATEGORIES).map((item) => ({ item, tier: 0 })),
    ...collect(grouped, ["topic"])
      .filter((item) => isUsableTopic(item.canonical))
      .map((item) => ({ item, tier: 1 })),
  ];
  const ranked = candidates
    // A canonical name is a taxonomy INFERENCE, not necessarily the words the
    // posting used — the recorded "team" -> "Microsoft Teams" hazard. Telling
    // a candidate to say "Microsoft Teams" because the posting said "team"
    // would put a false term in their mouth in a live interview, so a term
    // only survives when it literally occurs in the posting.
    .filter(({ item }) => literallyMentioned(item.canonical, text))
    .map(({ item, tier }, idx) => ({
      canonical: item.canonical,
      relevant: literallyMentioned(item.canonical, context) ? 1 : 0,
      tier,
      score: item.score || 0,
      idx,
    }))
    .sort((a, b) => b.relevant - a.relevant || a.tier - b.tier || b.score - a.score || a.idx - b.idx);

  const seen = new Set();
  const out = [];
  for (const item of ranked) {
    const key = item.canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.canonical);
    if (out.length >= limit) break;
  }
  return out;
}
