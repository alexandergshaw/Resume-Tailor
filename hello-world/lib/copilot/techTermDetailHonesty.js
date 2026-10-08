// THE MANDATORY OUTPUT GATE for a tech term's detail. SERVER-ONLY.
//
// WHY A GATE AND NOT ONLY A PROMPT CLAUSE. These terms are surfaced precisely as
// vocabulary the candidate may NOT have. A detail that drifts into "You could
// say: 'I used X to ...'" hands them a copy-paste claim they cannot back up in
// the room, which is the one lie that ends an interview. TECH_TERM_DETAIL_SYSTEM
// bans that shape, but a prompt clause is not a control anyone can apply to what
// the model actually wrote. This module is: the route runs it on every
// non-embedded success, unconditionally, and what it returns is what the reader
// sees.
//
// THE SHAPE of expansionHonesty.js (total, never throws, each rule a standalone
// control) with the first-person rule INVERTED. expansionHonesty keeps only
// first-person sentences grounded in the candidate's own page, because there the
// candidate speaking about their own material is correct; here a first-person
// experiential claim is exactly what must not reach the screen. It needs no
// source material: the detail is general knowledge, so this is a claim-SHAPE
// filter, not a provenance filter.
//
// THE DETECTOR IS THIS MODULE'S OWN. questionVocabulary.js's FIRST_PERSON_RE is
// a bare "contains I" test (it would fire on "I/O"), and its meaning is the
// opposite of the one needed here.

// Owner-tunable. Mirrors the prompt's "two to four short sentences".
export const TECH_TERM_DETAIL_MAX_SENTENCES = 4;

// A detail is a few short sentences. A model stuck in a loop can return far
// more, and the strip below scans what it is given, so the input is bounded
// before it is scanned.
const MAX_RAW_CHARS = 4000;

// Each entry is a standalone control: delete one and a crafted sentence of its
// shape slips through, which its own case in the suite then catches. A named
// list rather than one expression, so a reviewer can see which claim shape each
// line is for.
const FIRST_PERSON_CLAIM_RES = [
  // "I / we [have] used | built | implemented | led | designed | ... | have
  // experience with"
  /\b(?:I|we)\s+(?:have\s+|had\s+|'ve\s+)?(?:used|build|built|implement(?:ed)?|led|design(?:ed)?|develop(?:ed)?|manag(?:e|ed)|creat(?:e|ed)|deploy(?:ed)?|architect(?:ed)?|own(?:ed)?|wrote|ran|run|ship(?:ped)?|deliver(?:ed)?|introduc(?:e|ed)|drove|driven|work(?:ed)?\s+with|have\s+experience\s+with)\b/i,
  // The scripted-line framing: "You could say: 'I ...'" / "you might say we ..."
  /\byou\s+(?:could|might|can|should|would)\s+say\b[^.?!]*\b(?:I|we)\b/i,
  // "in my experience / role / work / projects ..."
  /\bin\s+my\s+(?:experience|role|work|projects?|job|career)\b/i,
  // "my experience / team / project / work with | using X"
  /\bmy\s+(?:experience|team|project|work)\b[^.?!]*\b(?:with|using)\b/i,
];

/** True iff the sentence asserts, or scripts, something the candidate did. */
export function isFirstPersonClaim(sentence) {
  if (typeof sentence !== "string") return false;
  return FIRST_PERSON_CLAIM_RES.some((re) => re.test(sentence));
}

// A full stop after one of these is not the end of a sentence. Without it a
// claim written "I used e.g. Kafka" would split into a dropped half and a
// surviving "Kafka ..." half.
const ABBREVIATION_TAIL_RE = /(?:\be\.g|\bi\.e|\bvs|\bcf|\bapprox)$/i;

// Terminal punctuation, then any closing quote or bracket, then whitespace or the
// end. The closing characters matter: a scripted claim ends `...charges.'` and
// the next sentence follows the quote, so splitting on the bare full stop would
// fuse the claim to the clean sentence after it and drop both.
const SENTENCE_END_RE = /[.!?]+["'”’)\]]*(?=\s|$)/g;

function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END_RE)) {
    if (match[0].startsWith(".") && ABBREVIATION_TAIL_RE.test(text.slice(start, match.index))) continue;
    const end = match.index + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

// Trailing sentence punctuation that a removed URL was carrying along with it.
function trailingPunctuation(match) {
  return match.match(/[.,;:!?]+$/)?.[0] ?? "";
}

// Markdown, links, URLs and email addresses out, prose kept. The prompt asks for
// none of them; this makes that a hard property of what reaches the screen.
function stripMarkup(text) {
  return (
    text
      // [label](url) -> label
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/[^\s<>)\]]+/gi, trailingPunctuation)
      .replace(/\bwww\.[^\s<>)\]]+/gi, trailingPunctuation)
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "")
      // <angle links>, but not a bare comparison such as "x < y and y > z".
      .replace(/<(?!\s)[^<>\n]*(?<!\s)>/g, "")
      // **bold**, __bold__, *italic*
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, "$1")
      .replace(/`+/g, "")
      // Line-start heading, blockquote, bullet and list-number characters.
      .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+•][ \t]+|\d+[.)][ \t]+)/gm, "")
      // Whitespace left where a token was removed.
      .replace(/\s+/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim()
  );
}

/**
 * The model's detail -> the string that may be shown.
 *
 *   1. coerce a non-string to ""
 *   2. strip markdown, links, URLs and email addresses
 *   3. split into sentences, in order
 *   4. DROP every sentence for which isFirstPersonClaim is true
 *   5. rejoin, capped at TECH_TERM_DETAIL_MAX_SENTENCES
 *
 * The offending SENTENCE is stripped and the clean remainder kept, rather than
 * refusing the whole detail: a two-to-four sentence explanation with one
 * claim-sentence removed is still honest and still useful. When EVERY sentence
 * is a claim the result is "" and the route reports an honest empty.
 *
 * Never throws: a splitter edge case degrades to "" rather than an error.
 */
export function sanitizeTechTermDetail(raw) {
  try {
    if (typeof raw !== "string") return "";
    const cleaned = stripMarkup(raw.trim().slice(0, MAX_RAW_CHARS));
    if (!cleaned) return "";
    return splitSentences(cleaned)
      .filter((sentence) => !isFirstPersonClaim(sentence))
      .slice(0, TECH_TERM_DETAIL_MAX_SENTENCES)
      .join(" ")
      .trim();
  } catch {
    return "";
  }
}
