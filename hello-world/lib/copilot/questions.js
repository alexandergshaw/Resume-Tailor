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
// AC-R1.3: lead-ins interviewers actually use, beyond the original
// acknowledgement/filler set. "and then" is listed before the bare "and" so
// the alternation consumes the whole two-word phrase in one bite — regex
// alternation takes the first alternative that lets the match succeed at
// that position, not the longest, so "and" listed first would only ever
// strip "and " and leave "then …" behind, which itself opens with nothing
// in STARTERS and would wrongly stay undecided.
const LEAD_IN_RE =
  /^(?:(?:great|awesome|cool|perfect|okay|ok|alright|all right|right|so|well|yeah|yes|thanks|thank you|got it|makes sense|good|sure|anyway|moving on|next question|next up|now|and then|and|last question|quick question|first|just curious|let's see|lets see|one more thing)[,.!\s]+)+/i;
const INTERROGATIVE_RE =
  /^(?:who|what|when|where|why|which|whose|whom|how|can|could|would|will|should|do|does|did|is|are|was|were|have|has|had|am|may|might|shall)\b/i;

// Tidy a detected interviewer question the way the LLM path does: drop lead-in
// acknowledgements ("Great, so, um…"), strip hesitations, collapse stutters
// ("can can you"), fix casing, and end interrogatives with a question mark.
// Purely cosmetic — never changes the substance of the ask.
export function cleanQuestion(text) {
  let q = String(text || "").trim();
  if (!q) return "";

  // AC-R1.2 / AC-R1.5 (defect #2): strip filler and lead-ins from the front
  // in a loop rather than a single fixed pass. Spoken speech interleaves
  // them — "Um, so tell me…", "Okay, um, so describe…" — and a single
  // filler-then-lead-in pass only strips a lead-in that's ALREADY at
  // position 0. A filler word sitting in front of "so" ("Um, so…") blocks
  // LEAD_IN_RE's `^` anchor until the filler itself is gone; looping so
  // each strip can expose the next is what makes the two independent of
  // order. Re-collapsing leftover separators every pass is also what keeps
  // "And, uh, how would you…" from cleaning to "And,, how would you…": the
  // comma either side of a removed filler is swept up in the SAME pass that
  // removes the lead-in beside it, never left dangling for the next one.
  let prev;
  do {
    prev = q;
    q = q.replace(FILLER_RE, " ");
    q = q.replace(LEAD_IN_RE, "");
    q = q.replace(/^[,.\-–—:;\s]+/, "");
  } while (q !== prev && q.length);

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

// Whether `text` OPENS with one of STARTERS, asked independently of
// detectQuestion's punctuation-first ordering below. Exported so a caller
// that already knows `text` is question-shaped — e.g. localDetection.js
// retrying against cleanQuestion's output — can ask this directly instead of
// routing back through detectQuestion. That indirection matters because
// cleanQuestion synthesizes a trailing "?" for any interrogative opener that
// never actually carried one, and detectQuestion's punctuation check runs
// BEFORE its starter check — so re-running detectQuestion on cleaned text
// would always report reason "punctuation" for exactly the spoken utterances
// this exists to catch, never "starter". Also keeps STARTERS defined in
// exactly one place: detectQuestion below delegates here rather than
// restating the loop.
export function hasStarterOpener(text) {
  const lower = normalizeQuestion(text);
  if (!lower) return false;
  if (lower.split(" ").length < MIN_WORDS) return false;
  return STARTERS.some((s) => lower === s || lower.startsWith(`${s} `));
}

// Returns { isQuestion, reason?, question? }. `reason` is "punctuation" when the
// utterance ends in "?" (Deepgram's smart_format/punctuate supplies this) or
// "starter" when it opens with an interrogative / common interview lead-in.
export function detectQuestion(text) {
  const raw = (text || "").trim();
  if (!raw) return { isQuestion: false };

  // Strongest signal: a trailing question mark.
  if (/\?\s*$/.test(raw)) {
    return { isQuestion: true, reason: "punctuation", question: raw };
  }

  if (hasStarterOpener(raw)) {
    return { isQuestion: true, reason: "starter", question: raw };
  }

  return { isQuestion: false };
}
