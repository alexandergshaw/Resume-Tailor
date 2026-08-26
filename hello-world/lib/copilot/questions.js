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
  "talk about", "talk to me", "talk me through", "talk us through", "let's talk", "lets talk",
  "help me understand", "i'd love to hear", "i would love to hear",
  "i'm curious", "im curious", "i was wondering", "was wondering",
];

const MIN_WORDS = 3;

export function normalizeQuestion(text) {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Spoken-language filler that live transcription keeps but a written question
// shouldn't: hesitations and hedges. These are NEVER content — unconditional,
// same as always.
const HESITATION_RE = /\b(?:um+|uh+|erm+|hmm+|kind of like|sort of like|like,)\s*/gi;
// AC-V3.1: "you know" and "i mean" are NOT unconditional filler the way the
// hesitations above are. "What do you know about Purple Wave?" — a real
// question from a real session (see questions.fidelity.test.js) — had its
// main verb deleted by the old unconditional rule, and the model was then
// asked to answer "What do about Purple Wave?". These two phrases are filler
// ONLY at a clause boundary: opening the utterance, or touching a comma on
// at least one side. Everywhere else ("what do you know", "what I mean by")
// they carry the ask and must survive untouched.
//
// The three boundary shapes this alternation covers, one branch each
// (questions.fidelity.test.js's AC-V3.3.1 pins all three separately, so a
// comma-after-only rule that happens to satisfy a comma-heavy fixture set
// cannot pass here):
//   1. comma on BOTH sides — "when, you know, a deadline" — the leading `,`
//      is consumed and the optional trailing `,?` greedily consumes the
//      second one too, so both disappear in one match, not one per pass
//      (leaving "when,, a deadline" is exactly the old bug this replaces).
//   2. start-of-utterance, comma after only — "You know, tell me…" — `^`
//      matches position 0; the trailing comma is still consumed if present.
//   3. comma before only, no comma after — "…went, you know." — the leading
//      `,` is consumed; the marker is simply removed up to (not including)
//      whatever follows.
// Replacement is always a single space; the loop's own leading-separator
// strip (below) mops up anything left dangling at the front, and the
// post-loop whitespace collapse mops up the middle.
//
// AC-V3.1.1: `\b` AFTER each alternation, and it is load-bearing. Without
// it, `,\s*(?:you know|i mean)` matched inside "I meant" — the "mean" was
// deleted out of the middle of the word and the orphaned "t" was then
// capitalised into the front of the sentence ("So, I meant to ask about
// scale." -> "T to ask about scale."). The same hole ate the front of
// ", you knowledge". Inherited from the old unconditional rule rather than
// introduced with the clause-boundary rewrite, but it is the exact defect
// class this rule exists to fix, one word over, and it is what makes the
// paragraph above ("they carry the ask and must survive untouched") actually
// true. A leading `\b` is NOT needed and is not added: the `^`/`,\s*` prefixes
// already pin the left edge, and "you"/"i" begin with word characters, so the
// preceding comma or start-of-string supplies the boundary for free.
const DISCOURSE_MARKER_RE =
  /(?:^\s*(?:you know|i mean)\b\s*,?\s*|,\s*(?:you know|i mean)\b\s*,?\s*)/gi;
// AC-V3.2/V3.3: a leading interviewer acknowledgement of their OWN question
// ("That's a great question.", "What a tough question,", "Good question —"),
// stripped so the stored question is the question that was asked (and so two
// phrasings of the same question normalize to the same cache key). Anchored
// at `^` — deliberately, and unlike the composable pieces above this one
// must NOT be found mid-utterance: an unanchored version deletes the ask out
// of the middle of "What makes a great question in a design review?" and
// "Tell me about a time you asked a really good question." (both pinned in
// questions.fidelity.test.js under AC-V3.3). The adjective set is the same
// one voiceCues.js's PIN_QUESTION_RE already established for this exact
// phrase family; the optional "that's"/"that is"/"what a" opener (with the
// apostrophe-variance handling STT actually produces — straight/curly/
// dropped) is this module's own addition, needed because unlike
// PIN_QUESTION_RE this rule is expected to consume the WHOLE preamble, not
// just its invariant tail. "That's"/"that is" take an indefinite article
// ("That's A great question"); "what a" already carries its own. The
// required terminator is a run of `[,.!?]`, or any whitespace, or end of string,
// and it is also what stops this from eating the front of "Good questions
// come from…".
//
// AC-V3.2.1: the PUNCTUATION terminator is CONSUMED; whitespace/end-of-string
// stays a lookahead. It used to be a lookahead in all three cases, on the
// stated reasoning that the loop's leading-separator strip below would mop up
// whatever was left — but that strip is `/^[,.\-–—:;\s]+/`, which has no `!`
// in it, so "Fair question! What is your salary expectation?" cleaned to
// "! What is your salary expectation?" and "Great question! Why us?" to
// "! Why us?". "Great question!" is one of the most common things an
// interviewer says, and the stored question, the answer-cache key and the
// text sent to the model all began with a stray "! ".
//
// Consuming it here rather than adding `!?` to the two separator strips,
// deliberately: the leftover is produced by THIS rule, so this is where it
// costs nothing to reason about, and it leaves the strips as a description of
// actual separators instead of a grab-bag that would also silently eat a
// leading `?` off anything else the loop hands them. It is also the shape
// LEAD_IN_RE beside it already uses — that rule consumes its own `[,.!\s]+`
// terminator rather than deferring it. The comma/period framings are
// unaffected either way; they were already swept up by the strip.
//
// P3: that fix closed one case and left three, because the class it consumed
// held one character and had no `?` in it. `[,.!?]+` — a class with `?` in
// it, repeated — is what actually closes R4:
//
//   "Great question!!!"                              -> "!!"
//   "Tough question!! Why us?"                       -> "! Why us?"
//   "Great question!?"                               -> "?"
//   "Fair question? What is your salary expectation?" -> not stripped at all
//
// A doubled mark is ordinary in transcribed speech, and "Fair question?" —
// the interviewer asking whether it WAS a fair question — is as common a
// framing as "Fair question!". Each of these left R4's stated harm intact:
// the stored question, the answer-cache key and the text sent to the model
// all begin with a stray mark, and two identical questions asked minutes
// apart normalize to different keys.
//
// The whitespace/end-of-string alternative stays a LOOKAHEAD, and that is
// still what keeps this rule off the front of "Good questions come from real
// curiosity" — `+` on the punctuation class widens what a terminator may
// look like, never whether one is required. A preamble that is the whole
// utterance still ends up stripped to nothing, and cleanQuestion's existing
// "if stripping leaves nothing, return the original" contract still returns
// it untouched; questions.fidelity.test.js pins both halves.
const PREAMBLE_RE =
  /^(?:(?:that['’]?s|that\s+is)\s+an?\s+|what\s+a\s+)?(?:good|great|interesting|tough|fair|excellent)\s+question(?:[,.!?]+|(?=\s|$))/i;
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
    q = q.replace(HESITATION_RE, " ");
    q = q.replace(DISCOURSE_MARKER_RE, " ");
    // AC-V3.2: preamble stripping runs alongside LEAD_IN_RE in the same pass,
    // in the same loop, for the same reason the header above already gives
    // for filler-then-lead-in: the two compose in either order
    // ("Good question, so tell me about your last role." needs preamble
    // first then lead-in; "That's a great question. What do you know…" needs
    // preamble alone) and a single fixed-order pass only catches whichever
    // one happens to already sit at position 0.
    q = q.replace(PREAMBLE_RE, "");
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
