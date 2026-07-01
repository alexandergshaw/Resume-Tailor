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

// Spoken-language filler that live transcription keeps but a written question
// shouldn't: hesitations, hedges, and lead-in acknowledgements.
const FILLER_RE = /\b(?:um+|uh+|erm+|hmm+|you know|i mean|kind of like|sort of like|like,)\s*/gi;
const LEAD_IN_RE =
  /^(?:(?:great|awesome|cool|perfect|okay|ok|alright|all right|right|so|well|yeah|yes|thanks|thank you|got it|makes sense|good|sure|anyway|moving on|next question|next up)[,.!\s]+)+/i;
const INTERROGATIVE_RE =
  /^(?:who|what|when|where|why|which|whose|whom|how|can|could|would|will|should|do|does|did|is|are|was|were|have|has|had|am|may|might|shall)\b/i;

// Tidy a detected interviewer question the way the LLM path does: drop lead-in
// acknowledgements ("Great, so, um…"), strip hesitations, collapse stutters
// ("can can you"), fix casing, and end interrogatives with a question mark.
// Purely cosmetic — never changes the substance of the ask.
export function cleanQuestion(text) {
  let q = String(text || "").trim();
  if (!q) return "";

  q = q.replace(LEAD_IN_RE, "");
  q = q.replace(FILLER_RE, " ");
  // Collapse immediate word repeats from transcription stutter ("can can you").
  q = q.replace(/\b(\w+)(\s+\1\b)+/gi, "$1");
  q = q.replace(/\s+([,.?!])/g, "$1").replace(/\s{2,}/g, " ").trim();
  // Leftover leading separators after stripping ("— so, what…" → "what…").
  q = q.replace(/^[,.\-–—:;\s]+/, "");
  if (!q) return String(text || "").trim();

  q = q.charAt(0).toUpperCase() + q.slice(1);
  // Interrogative sentences should end in "?" (Deepgram sometimes emits ".").
  if (!/[?]$/.test(q)) {
    if (/[.!]$/.test(q) && INTERROGATIVE_RE.test(q)) q = q.replace(/[.!]+$/, "?");
    else if (!/[.!?]$/.test(q) && INTERROGATIVE_RE.test(q)) q = `${q}?`;
  }
  return q;
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
