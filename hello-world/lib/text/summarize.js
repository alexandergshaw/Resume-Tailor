// Deterministic extractive summarizer — a no-LLM stand-in for "summarize this".
// It scores each sentence by how many of the document's frequent, meaningful
// words it carries (a Luhn/word-frequency approach), boosts sentences that hit
// the caller's query, applies a mild lead bias, then returns the top sentences
// in their original order so the result reads coherently. Fully deterministic:
// the same input always yields the same summary.

const STOPWORDS = new Set(
  (
    "a an the and or but if then else so than that this these those it its it's is are was were be been being am " +
    "of to in on at by for from with as into over under about above below up down out off again further once " +
    "i me my we us our you your he him his she her they them their who whom which what where when why how all any " +
    "both each few more most other some such no nor not only own same too very can will just don't should now " +
    "have has had do does did having would could may might must shall here there also within across per via " +
    "our ours their theirs your yours we're you're they're i'm we've you've they've"
  )
    .split(/\s+/)
    .filter(Boolean),
);

function words(text) {
  return String(text).toLowerCase().match(/[a-z0-9][a-z0-9'+.#-]*/g) || [];
}

function significant(word) {
  return word.length > 2 && !STOPWORDS.has(word);
}

// Split text into sentences without breaking common intra-word dots ("Node.js",
// "$50M."): only split at sentence punctuation that is followed by whitespace and
// the start of a new sentence (capital letter, digit, or opening quote).
export function splitSentences(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Rank sentences by significance; returns [{ sentence, idx, score }] sorted by
// descending score. Exposed for callers that want the top-1 (e.g. a headline).
export function rankSentences(text, { query = "" } = {}) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const freq = new Map();
  for (const s of sentences) {
    for (const w of words(s)) {
      if (significant(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const qTerms = new Set(words(query).filter(significant));

  return sentences
    .map((sentence, idx) => {
      const ws = words(sentence).filter(significant);
      if (ws.length === 0) return { sentence, idx, score: 0 };
      let score = 0;
      let qHits = 0;
      for (const w of ws) {
        score += freq.get(w) || 0;
        if (qTerms.has(w)) qHits += 1;
      }
      // Dampen long-sentence bias, reward query hits, mild lead bias, and
      // penalize very short fragments that rarely stand alone as a summary.
      score /= Math.sqrt(ws.length);
      if (qHits) score *= 1 + qHits * 0.5;
      score *= 1 + Math.max(0, 3 - idx) * 0.03;
      if (ws.length < 4) score *= 0.6;
      return { sentence, idx, score };
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx);
}

// Produce an extractive summary of at most `maxSentences` sentences. When the
// text is already that short it's returned as-is (cleaned). `query`, when given,
// steers selection toward relevant sentences.
export function summarize(text, { maxSentences = 3, query = "" } = {}) {
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences) return sentences.join(" ");

  const top = rankSentences(text, { query })
    .slice(0, maxSentences)
    .sort((a, b) => a.idx - b.idx);
  return top.map((t) => t.sentence).join(" ");
}
