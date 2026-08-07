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

export const MAX_BUZZWORDS = 4;

const STOPWORDS = new Set(defaultLibraryData.stopwords);

// A "significant" word: long enough to carry meaning on its own (drops "a",
// "on", "SQL"'s neighbours like "to") and not one of the domain-generic words
// stopwords.json already excludes from RAKE ("team", "experience", "role"...).
// Reused for both sides of the word-overlap signal below so a question and a
// posting term are judged by the same rule.
function significantWords(text) {
  const words = String(text || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return words.filter((w) => !STOPWORDS.has(w));
}

// A deliberately dumb plural fold — strip a trailing "es" or "s" — applied to
// BOTH the term and the context word before comparing. Real stemming is
// overkill here: this only has to close the gap between "the posting says
// CRM" and "the candidate's question says CRMs", not handle irregular
// plurals or verb conjugation.
function foldPlural(word) {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

// How many of `term`'s own significant words show up among the context's
// significant words, plural-folded on both sides. Used both to decide
// relevance and, per-relevant-term, to rank a term the question is heavily
// about ahead of one it barely touches.
//
// Relevance requires ALL of the term's significant words to be covered, not
// just one — a single shared generic word ("salary" turning up in both a
// salary-expectations question and an unrelated posting phrase like "salary
// range") is exactly the kind of coincidental overlap that produced the
// original bug (a fixed list winning on an accident of vocabulary, not on
// actually being what the question is about). A term with zero significant
// words of its own (a bare "Go", "R", "C" — see isUsableTopic's comment on
// why the taxonomy keeps these) can never clear that bar by word overlap;
// it only ever gets shown via the canonical-intersection signal.
function wordOverlap(term, contextFoldedWords) {
  const termWords = new Set(significantWords(term).map(foldPlural));
  if (termWords.size === 0) return { relevant: false, count: 0 };
  let count = 0;
  for (const w of termWords) {
    if (contextFoldedWords.has(w)) count += 1;
  }
  return { relevant: count === termWords.size, count };
}

// Every canonical extractKeywords recognizes in `context`, across ALL of its
// categories (not just BUZZWORD_CATEGORIES below) — this is a lookup set for
// "did the question/draft already touch this concept", not a source of terms
// to show, so it deliberately casts a wider net than the posting side does.
function collectAllCanonicals(grouped) {
  const set = new Set();
  for (const category of Object.keys(grouped)) {
    for (const item of grouped[category] || []) set.add(String(item.canonical).toLowerCase());
  }
  return set;
}

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
// question. Ranked by how heavily the term overlaps with what is being
// answered (so the same posting yields a different emphasis per question),
// then by the existing tier, then by the extractor's own section-weighted
// score, then by discovery order so the result is fully deterministic.
//
// `context` is the question plus whatever the draft already says: a term the
// answer ALREADY uses is the strongest signal that saying it is natural here,
// not a stretch.
export function postingBuzzwords(description, { question = "", points = [], limit = MAX_BUZZWORDS } = {}) {
  const text = String(description || "").trim();
  if (!text) return [];

  const context = [String(question || ""), ...(Array.isArray(points) ? points : [])]
    .map((p) => String(p || ""))
    .join(" ");

  let grouped;
  let contextCanonicals;
  try {
    grouped = extractKeywords(text, defaultLibraryData.taxonomy);
    // Relevance needs the SAME extractor run over the question/draft, not a
    // second, cheaper heuristic — otherwise "the posting says SQL" and "the
    // question is about SQL" could disagree about what SQL even means here.
    // Both calls share the one taxonomy, so a failure in either degrades the
    // whole section to absent (the existing posture: never break the answer
    // around it, same as profileSkills in answerLocal.js).
    contextCanonicals = collectAllCanonicals(extractKeywords(context, defaultLibraryData.taxonomy));
  } catch {
    return [];
  }

  const contextWords = new Set(significantWords(context).map(foldPlural));

  // Two tiers: taxonomy terms (recognized, canonically cased) and RAKE topic
  // phrases (advisory multiword phrases the taxonomy missed — the fallback
  // that keeps a posting for a non-technical role from coming back empty).
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
    // only survives when it literally occurs in the posting. This guard runs
    // FIRST and is independent of relevance below: a term can be exactly what
    // this question is about and still get dropped here if the posting never
    // actually said it.
    .filter(({ item }) => literallyMentioned(item.canonical, text))
    .map(({ item, tier }, idx) => {
      const overlap = wordOverlap(item.canonical, contextWords);
      return {
        canonical: item.canonical,
        // RELEVANT decides whether the term is shown AT ALL, via two
        // independent signals against the same context:
        //   - canonical intersection: the extractor recognizes this exact
        //     concept somewhere in the question/draft too (handles synonyms
        //     and multiword aliases the extractor already knows about, e.g.
        //     "higher education" -> Education).
        //   - word overlap: every significant word the term is made of also
        //     appears in the context, plural-folded (handles everything the
        //     taxonomy doesn't have an alias for, e.g. "CRMs" against
        //     posting term "CRM" — no taxonomy alias registers "crms").
        // Neither alone covers what the other does, which is why both run.
        relevant: overlap.relevant || contextCanonicals.has(item.canonical.toLowerCase()),
        overlap: overlap.count,
        tier,
        score: item.score || 0,
        idx,
      };
    })
    // A posting term with nothing to do with the question on screen is not a
    // lower-priority suggestion, it is noise: showing a candidate three
    // unrelated words to "work in" is the bug being fixed here. So an
    // irrelevant term is dropped outright rather than ranked to the bottom —
    // there is no "top terms for the posting" fallback tier, because that
    // fallback IS the constant six-word list that made this section useless.
    // An absent row (empty array) is the honest answer when nothing fits;
    // the rows around it still render.
    .filter((r) => r.relevant)
    .sort((a, b) => b.overlap - a.overlap || a.tier - b.tier || b.score - a.score || a.idx - b.idx);

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
