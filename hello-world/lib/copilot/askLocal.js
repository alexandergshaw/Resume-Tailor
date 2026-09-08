// The embedded engine's answer for the ask box: a VERBATIM QUOTING RETRIEVER.
//
// WHY THERE IS AN EMBEDDED ANSWER AT ALL. Engine choice governs every auxiliary
// AI feature in this app through `wantsEmbedded`, and a feature that only works
// on Gemini is a feature half the users cannot use. A refusal was the cheap
// option and was rejected: the question the box answers is "what does my own
// material say about X", which is retrieval, and retrieval does not need a
// model.
//
// WHY IT QUOTES INSTEAD OF COMPOSING, which is the whole safety argument. Every
// line this returns is copied character-for-character out of the candidate's
// own résumé, cover letter, tracking row or knowledge base, prefixed with which
// of those it came from. Nothing is paraphrased, summarised or joined, so there
// is no sentence in the output that the material does not already contain --
// the class of failure a deterministic drafter has (a plausible sentence
// assembled out of two unrelated facts) is unreachable by construction. That
// matters more here than anywhere else in the app: this text is read seconds
// before a candidate says something out loud to an interviewer.
//
// WHY THIS IS NOT lib/chat/extractiveQa.js WIDENED. That module answers a FIXED
// topic taxonomy (salary / remote / degree / experience / benefits / deadline)
// out of the pinned posting's own sentences, routed from `localChatReply`. It
// cannot reach the résumé, the cover letter or the knowledge base, and teaching
// it to would make it a second retrieval implementation over a different corpus
// with a different notion of what a "topic" is. It is deliberately not imported
// here.
//
// THE TOKENIZER IS THE SHARED ONE. `significantTerms`/`overlapScore` come from
// lib/copilot/projectStories.js, the canonical home
// (lib/copilot/significantTerms.shared.test.js pins that there is exactly one).
// A private fifth copy here would be free to drift from the ranking every other
// retrieval surface in this app agrees on.

import { significantTerms, overlapScore, INTERVIEW_SCAFFOLDING } from "@/lib/copilot/projectStories";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";

// R-257's ruling on WHAT MAY COUNT AS OVERLAP, applied unchanged here.
// lib/copilot/answerLocal.js's `rankedExperienceLines` filters the QUESTION's
// terms down to the ones that could DISTINGUISH one line from another before
// anything is counted -- not ordinary English/résumé filler, and not interview
// scaffolding -- and its comment records what happens without it: an unrelated
// beekeeping-club line outscored a real payments line seven to five, purely on
// repeated occurrences of "the", and the engine then offered the beekeeping
// club as the candidate's own example. The identical failure is reachable here
// and is worse, because this text is quoted: "what about underwater
// basketweaving?" would match an interview note on the word "about" alone and
// print it as if it answered the question.
//
// The stopword DATA is shared (this same `defaultLibraryData.stopwords` file
// backs projectStories, answerLocal, critiqueLocal, postingBuzzwords,
// pageRanking and tailor-lite's keyword extractor); the Set is module-local,
// which is what every one of those six does. Filtered on the QUESTION side
// only, deliberately: a line's term can score only if it is also a question
// term, so filtering the line side too would be redundant rather than wrong.
const RANKING_STOPWORDS = new Set(defaultLibraryData.stopwords);

// How many quoted lines one answer may carry. Four is a glance, not a read;
// this is text consumed in the seconds before speaking.
const MAX_QUOTES = 4;

// A line shorter than this is a heading, a date or a fragment -- quoting it
// answers nothing and spends one of the four slots.
const MIN_LINE_CHARS = 24;

// A line longer than this is a wall of prose; it is truncated at a word
// boundary with an ellipsis rather than dropped, because dropping the one line
// that answered the question is the worse failure.
const MAX_LINE_CHARS = 320;

// The short, spoken-aloud name for each block, derived from the label's leading
// clause. The labels themselves (lib/copilot/askContext.js) are written for a
// MODEL -- long, and carrying the attribution warnings -- and would be absurd
// in front of a quote a person is reading.
function shortSource(label) {
  const head = String(label || "").split("(")[0].trim().toLowerCase();
  if (head.startsWith("your own record")) return "your own record of this application";
  if (head.startsWith("scraped job posting")) return "the job posting";
  if (head.startsWith("your submitted resume")) return "your submitted resume";
  if (head.startsWith("your submitted cover letter")) return "your submitted cover letter";
  if (head.startsWith("your professional experience pages")) return "your experience pages";
  return "your material";
}

function trimQuote(line) {
  if (line.length <= MAX_LINE_CHARS) return line;
  const cut = line.slice(0, MAX_LINE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_LINE_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// Candidate quotes out of one block. Split on line breaks first (résumés,
// tracking rows and page bodies are line-structured), then on sentence
// boundaries for any line long enough to hold several -- a cover letter is one
// paragraph, and quoting the whole paragraph answers nothing.
function linesFrom(text) {
  const out = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>#*\-•]+/, "").trim();
    if (line.length < MIN_LINE_CHARS) continue;
    if (line.length <= MAX_LINE_CHARS) {
      out.push(line);
      continue;
    }
    const sentences = line.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [line];
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (s.length >= MIN_LINE_CHARS) out.push(s);
    }
  }
  return out;
}

/**
 * @param {{ question: string, blocks: Array<{label: string, text: string}> }} input
 * @returns {string} plain text, every quoted line copied verbatim from `blocks`.
 */
export function answerAskLocal({ question, blocks } = {}) {
  // NO THRESHOLD on the resulting score, and that is deliberate for the same
  // reason `rankedExperienceLines` gives: porting `clearsHonestyGate`'s ">= 2
  // distinctive terms" floor here would return nothing for every correct
  // one-distinctive-term question ("what did I do about reconciliation lag?"
  // has exactly one term left after filtering, and the résumé line that answers
  // it matches exactly that one). The filtering above is what makes a score of
  // 1 meaningful; a floor on top of it would just discard right answers.
  const terms = new Set(
    [...significantTerms(question)].filter((t) => !RANKING_STOPWORDS.has(t) && !INTERVIEW_SCAFFOLDING.has(t)),
  );

  const scored = [];
  const seen = new Set();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const source = shortSource(block?.label);
    for (const line of linesFrom(block?.text)) {
      const score = terms.size === 0 ? 0 : overlapScore(terms, line);
      if (score <= 0) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      scored.push({ score, source, line });
    }
  }

  if (scored.length === 0) {
    // An explicit, stated miss. The alternative -- printing the highest-scoring
    // line anyway -- is how a retriever starts answering questions it has no
    // evidence for, and this one is read out loud.
    return (
      "Nothing in your material matched that question, so there is nothing to quote. " +
      "The embedded engine only quotes your own resume, cover letter, tracking row and experience pages back to you; " +
      "it does not reason about them. Switch to the Gemini engine for an answer that does."
    );
  }

  // Descending by overlap; ties keep the order the blocks were built in, which
  // puts the user's own record and their submitted documents ahead of the
  // scraped posting.
  scored.sort((a, b) => b.score - a.score);

  const quotes = scored.slice(0, MAX_QUOTES).map(({ source, line }) => `From ${source}: "${trimQuote(line)}"`);
  return ["Quoted from your own material (the embedded engine does not write prose):", ...quotes].join("\n");
}
