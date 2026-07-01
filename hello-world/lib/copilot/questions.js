// Zero-cost heuristic question detector. Runs on finalized interviewer
// utterances to decide whether a line is (likely) a question the candidate
// should answer. Phase 4 layers an LLM confirm on top to catch the indirect
// asks this misses.

const STARTERS = [
  // interrogatives
  "who", "what", "whats", "what's", "when", "where", "why", "which", "whose",
  "whom", "how",
  // auxiliary / modal openers
  "can", "could", "would", "will", "should", "do", "does", "did", "is", "are",
  "was", "were", "have", "has", "had", "am", "may", "might", "shall",
  // indirect / imperative asks common in interviews
  "tell me", "walk me", "walk us", "describe", "explain", "give me", "share",
  "talk about", "talk me through", "talk us through", "let's talk", "lets talk",
  "help me understand", "i'd love to hear", "i would love to hear",
  "i'm curious", "im curious", "i was wondering", "was wondering",
];

const MIN_WORDS = 3;

export function normalizeQuestion(text) {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Returns { isQuestion, reason?, question? }. `reason` is "punctuation" when the
// utterance ends in "?" (Deepgram's smart_format/punctuate supplies this) or
// "starter" when it opens with an interrogative / common interview lead-in.
export function detectQuestion(text) {
  const raw = (text || "").trim();
  if (!raw) return { isQuestion: false };

  const lower = raw.toLowerCase();

  // Strongest signal: a trailing question mark.
  if (/\?\s*$/.test(raw)) {
    return { isQuestion: true, reason: "punctuation", question: raw };
  }

  if (lower.split(/\s+/).length < MIN_WORDS) return { isQuestion: false };

  for (const s of STARTERS) {
    if (lower === s || lower.startsWith(`${s} `)) {
      return { isQuestion: true, reason: "starter", question: raw };
    }
  }

  return { isQuestion: false };
}
