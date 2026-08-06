// Deterministic rubric for practice mode's "what did you actually say"
// critique — the embedded engine's implementation of the AC-C4-1 contract
// (score, verdict, strengths, improvements, missing, star, delivery,
// source). C3's lib/copilot/answerMetrics.js already measures HOW the
// answer was delivered; this module judges its SUBSTANCE, on top of those
// numbers. Pure and deterministic: no network, no Date, no randomness —
// the same inputs always produce the same score and the same wording, and
// every string emitted here is grounded in something actually measured or
// detected in the text — never a generic compliment.

import { profileSkills } from "./answerLocal";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { MIN_LUMA_SAMPLES, MIN_MOTION_SAMPLES } from "./videoStats";
// G2: the selected practice interviewType (lib/copilot/interviewTypes.js) is
// the single source of truth for the ideal answer length, what the rubric
// should additionally expect, and how the verdict names the format being
// judged. `interviewType` here is the LOOKUP function (untrusted value ->
// descriptor, normalizing internally) — imported under an alias so it
// doesn't collide with the `interviewType` parameter name below.
import { interviewType as resolveInterviewType, DEFAULT_INTERVIEW_TYPE } from "./interviewTypes";
// D3's body-language rubric — pulled out into its own module purely to
// keep this already-large file under its line cap; see
// critiqueBodyLanguage.js's own header for why and how it's used here.
import {
  normalizeBodyLanguage,
  computeBodyLanguageScore,
  bodyLanguageDeliveryNote,
} from "./critiqueBodyLanguage";

const VALID_TYPES = ["behavioral", "technical", "general"];
const MAX_LIST = 4;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function countWords(s) {
  const trimmed = String(s || "").trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same sentence split as answerMetrics.js: Deepgram's punctuate/smart_format
// mean finalized speech is usually already sentence-punctuated.
function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// --- Structure: STAR / technical / general cue detection -----------------

// Context/when cues — a behavioral answer's "Situation" beat sets a scene:
// when or where this happened. Anchored to real scene-setting constructions
// rather than a bare preposition: the previous "at (?:my|a|the)" alternative
// matched "I looked at the logs", crediting a Situation beat to an answer
// that sets no scene at all; the previous "previously," alternative could
// never match anything (a trailing \b right after a comma cannot hold), so
// it's dropped rather than repaired into something equally loose (BUG-9).
const SITUATION_RE =
  /\b(when i was (?:at|a|working)|while (?:i was )?working (?:at|on|as)|during my (?:time|tenure|role) (?:at|with|as)|at my (?:previous|last|first|current) (?:job|role|company|position)|in my (?:previous|last|current) (?:role|job|position)|back when i (?:was|worked)|a few (?:months|years|weeks) ago|last (?:year|summer|quarter|month))\b/i;

// Goal / responsibility cues — the "Task" beat: what the candidate owned.
const TASK_RE =
  /\b(my (?:task|job|goal|responsibility|objective) was|i was (?:responsible|tasked|asked) (?:for|to)|i needed to|the goal was|we needed to|had to (?:figure out|deliver|solve|fix|build))\b/i;

// First-person action cues — the "Action" beat: concrete steps the
// candidate personally took, not a vague "we" for the whole team.
const ACTION_RE =
  /\bi\s+(?:built|led|created|designed|implemented|wrote|developed|managed|organized|coordinated|decided|proposed|analyzed|debugged|fixed|planned|delivered|launched|drove|reduced|improved|increased|introduced|took|handled|resolved|negotiated|collaborated|prioritized|reviewed|refactored|migrated|automated|shipped|owned|ran)\b/i;

// Outcome / result cues — the "Result" beat: what happened because of it,
// ideally quantified. Split into phrase cues (word-bounded, like the other
// STAR regexes) and metric cues (a percentage or dollar figure), which must
// NOT share that boundary wrapper: a trailing \b right after "%" cannot
// hold in ordinary prose ("40% " has no word/non-word transition at the
// "%", since both it and the following space are non-word characters), and
// a leading \b right before "$" can't hold either (both it and a preceding
// space are non-word) — so both numeric alternatives were silently
// unmatchable, and the single most important STAR signal was never
// detected (BUG-7).
const RESULT_PHRASE_RE =
  /\b(as a result|resulted in|which led to|ultimately|in the end|the outcome was|(?:we|i) (?:achieved|improved|increased|reduced|delivered|saved|cut|grew|boosted))\b/i;
// "%"/"$" are inherently unambiguous punctuation, so there's no
// false-positive risk from matching mid-word the way a bare word alternative
// would have — no word-boundary wrapper needed here.
const RESULT_METRIC_RE = /\d+(?:\.\d+)?%|\$\s?\d[\d,.]*/;

function hasResultCue(answer) {
  return RESULT_PHRASE_RE.test(answer) || RESULT_METRIC_RE.test(answer);
}

function detectStar(answer) {
  return {
    situation: SITUATION_RE.test(answer),
    task: TASK_RE.test(answer),
    action: ACTION_RE.test(answer),
    result: hasResultCue(answer),
  };
}

// Restating the problem in your own words before diving into a solution.
const TECH_RESTATE_RE =
  /\b(the problem is|what we're trying to (?:do|solve)|to solve this|the goal here is|so the question is|the core issue is|in other words|restating the problem)\b/i;

// Naming a concrete approach, not just describing the problem.
const TECH_APPROACH_RE =
  /\b(i would|i'd|my approach|one approach|the approach|i(?:'d)? (?:start|begin) by|first,? i|i will|i'll|we could use|use a |using a |i propose|the approach would be)\b/i;

// Acknowledging a trade-off — the single most common gap in a technical
// answer that otherwise sounds confident. Requires a cue that actually
// names a comparison or a cost, not a bare contrastive connective — the
// previous "however"/"although"/"but this"/"whereas"/"on the other hand"
// alternatives fired on any sentence with a turn in it, whether or not
// anything resembling a trade-off actually followed (BUG-9).
const TECH_TRADEOFF_RE =
  /\b(trade-?off|the downside|the (?:cost|price|drawback)|at the cost of|in exchange for|comes at the expense of|versus|vs\.)\b/i;

function detectTechnical(answer) {
  return {
    restatesProblem: TECH_RESTATE_RE.test(answer),
    namesApproach: TECH_APPROACH_RE.test(answer),
    acknowledgesTradeoff: TECH_TRADEOFF_RE.test(answer),
  };
}

// A concrete, named example — the "supporting specific" a general answer
// needs alongside its claim.
const GENERAL_SPECIFIC_RE =
  /\b(for example|for instance|specifically|in particular|such as|e\.g\.|one example|a good example)\b/i;

function detectGeneral(answer, hasMetric, properNounCount) {
  const sentences = splitSentences(answer);
  const first = sentences[0] || "";
  return {
    // A "clear claim" is a real assertion, not a one- or two-word non-answer
    // ("Yes." / "I don't know") — six words is a deliberately low bar: this
    // only screens out answers with no opening statement at all.
    claim: countWords(first) >= 6,
    specific: GENERAL_SPECIFIC_RE.test(answer) || hasMetric || properNounCount > 0,
  };
}

function computeStructure({ type, answer, hasMetric, properNounCount }) {
  if (type === "behavioral") {
    const star = detectStar(answer);
    const hits = Object.values(star).filter(Boolean).length;
    return { kind: "behavioral", star, detail: star, score: Math.round((hits / 4) * 100) };
  }
  if (type === "technical") {
    const tech = detectTechnical(answer);
    const hits = Object.values(tech).filter(Boolean).length;
    return { kind: "technical", star: null, detail: tech, score: Math.round((hits / 3) * 100) };
  }
  const general = detectGeneral(answer, hasMetric, properNounCount);
  const hits = Object.values(general).filter(Boolean).length;
  return { kind: "general", star: null, detail: general, score: Math.round((hits / 2) * 100) };
}

// --- Specificity -----------------------------------------------------------

// The count of capitalized proper nouns — a cheap but real specificity
// signal: naming an actual company, tool, or product reads as concrete in a
// way "a project" or "the team" doesn't. Skips each sentence's first word
// (capitalized because it opens the sentence, not because it's a proper
// noun).
function countProperNouns(answer) {
  let count = 0;
  for (const sentence of splitSentences(answer)) {
    const words = sentence.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    words.forEach((w, i) => {
      if (i === 0) return;
      if (/^[A-Z][a-z]+$/.test(w)) count += 1;
    });
  }
  return count;
}

// The posting's own vocabulary, extracted the same way profileSkills does
// in answerLocal.js (extractKeywords + defaultLibraryData.taxonomy) — reused
// directly since a posting's title/company/description is just more text to
// mine for skills/tools/domain terms, exactly like a candidate profile is.
const POSTING_TERMS_LIMIT = 20;

function postingKeyTerms(posting) {
  const text = [posting?.title, posting?.company, posting?.description].filter(Boolean).join("\n");
  return profileSkills(text, POSTING_TERMS_LIMIT);
}

// Word-boundary term test — a bare String.includes would match "Go" inside
// "going" or "C" inside "Cathy" and manufacture posting-vocabulary overlap
// the answer never earned. `\b` alone treats a hyphen as a word boundary, so
// the lookaround additionally requires a non-alphanumeric, non-hyphen
// character on each side — the same discipline lib/copilot/answerMetrics.js
// uses for filler phrases (BUG-10).
function containsTerm(text, term) {
  const pattern = String(term || "")
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  if (!pattern) return false;
  const re = new RegExp(`(?<![a-z0-9-])${pattern}(?![a-z0-9-])`, "i");
  return re.test(text);
}

// Canonicals shorter than this are skipped entirely rather than matched —
// even with word-boundary discipline, a 1-2 character term ("Go", "C", "R")
// is too likely to coincide with an ordinary short word to safely credit as
// "the answer used this posting term" (BUG-10).
const MIN_POSTING_TERM_LENGTH = 3;

const HAS_METRIC_POINTS = 40; // a quantified result was mentioned
const PROPER_NOUN_POINTS = 10; // per named proper noun
const MAX_PROPER_NOUN_CREDIT = 30;
const OVERLAP_POINTS = 15; // per posting term the answer actually uses
const MAX_OVERLAP_CREDIT = 30;

function computeSpecificity({ hasMetric, properNounCount, overlapCount }) {
  return clamp(
    (hasMetric ? HAS_METRIC_POINTS : 0) +
      Math.min(MAX_PROPER_NOUN_CREDIT, properNounCount * PROPER_NOUN_POINTS) +
      Math.min(MAX_OVERLAP_CREDIT, overlapCount * OVERLAP_POINTS),
    0,
    100,
  );
}

// --- Relevance ---------------------------------------------------------

const STOPWORDS = new Set(defaultLibraryData.stopwords);

// Interview-question boilerplate: words that appear in almost every
// question's PHRASING ("tell me about a time...", "describe a
// situation...", "walk me through...") but say nothing about what the
// question is actually asking about. Without stripping these, a directly
// responsive answer that (reasonably) never echoes the question's own
// scaffolding back can score zero overlap and be told it drifts from what
// was asked. Stripped from the QUESTION side only — these are common
// enough words that stripping them from the answer too wouldn't change
// which of the question's REAL terms it hits (BUG-11).
const QUESTION_BOILERPLATE = new Set([
  "tell",
  "describe",
  "walk",
  "give",
  "explain",
  "share",
  "talk",
  "me",
  "us",
  "your",
  "you",
  "about",
  "time",
  "example",
  "situation",
  "when",
  "where",
  "how",
  "what",
  "why",
  "which",
  "instance",
]);

function meaningfulTerms(text, extraStopwords) {
  const words = String(text || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return new Set(words.filter((w) => !STOPWORDS.has(w) && !(extraStopwords && extraStopwords.has(w))));
}

// Meaningful-term overlap between the question and the answer: an answer
// that never engages the question scores badly here no matter how polished
// it is otherwise. Uses the same meaningful-term filtering the rest of this
// module applies, plus QUESTION_BOILERPLATE stripped from the question side.
function computeRelevance(question, answer) {
  const qTerms = meaningfulTerms(question, QUESTION_BOILERPLATE);
  const aTerms = meaningfulTerms(answer);
  if (qTerms.size === 0) {
    // No meaningful terms to check overlap against (an empty or
    // boilerplate-only question) — there's nothing to penalize.
    return { score: 100, overlapCount: 0, qCount: 0 };
  }
  let overlapCount = 0;
  for (const term of qTerms) {
    if (aTerms.has(term)) overlapCount += 1;
  }
  return { score: Math.round((overlapCount / qTerms.size) * 100), overlapCount, qCount: qTerms.size };
}

// --- Length ---------------------------------------------------------------

// The ideal word-count band is the selected interview type's own
// `lengthTarget` (lib/copilot/interviewTypes.js) — a { minWords, maxWords }
// pair, passed in rather than hardcoded here. "general"'s is {80, 220}: long
// enough to cover a real example, short enough to stay tight in a live
// interview (roughly 45-90 seconds of speech at a conversational pace), and
// is the exact band this file used before interview types existed.
// How many words over maxWords costs one point, once over the band.
const OVER_LENGTH_WORDS_PER_POINT = 4;

function computeLengthScore(wordCount, { minWords, maxWords }) {
  if (wordCount <= 0) return 0;
  if (wordCount >= minWords && wordCount <= maxWords) return 100;
  if (wordCount < minWords) {
    return Math.round(clamp(wordCount / minWords, 0, 1) * 100);
  }
  const over = wordCount - maxWords;
  return Math.round(clamp(100 - over / OVER_LENGTH_WORDS_PER_POINT, 0, 100));
}

// --- Delivery: built strictly from the C3 metrics -------------------------

const MAX_TOP_PHRASES = 3;

function topPhrasesText(list) {
  return (list || [])
    .slice(0, MAX_TOP_PHRASES)
    .map((f) => `"${f.phrase}" x${f.count}`)
    .join(", ");
}

// Null-prototype lookup maps: normalizeMetrics below whitelists paceLabel to
// exactly these three strings before it ever reaches this map, but the map
// itself is hardened too — a plain object literal would resolve a key like
// "constructor" to Object's constructor function instead of undefined,
// which is exactly the kind of prototype-pollution-adjacent surprise that
// produced a "NaN/100" verdict before the whitelist existed (BUG-6).
const PACE_SCORE_BY_LABEL = Object.assign(Object.create(null), {
  conversational: 100,
  slow: 60,
  rushed: 60,
});
const DEFAULT_PACE_SCORE = 80; // an unrecognized paceLabel shouldn't happen, but must never throw

const FILLER_RATE_GOOD_PCT = 1; // at/below this filler-word rate, full credit
const FILLER_RATE_BAD_PCT = 10; // at/above this rate, minimum credit
const FILLER_SCORE_MIN = 30;

const VIDEO_LIGHTING_PENALTY = 20; // tooDark or tooBright
const VIDEO_MOTION_PENALTY = 10; // veryStill or fidgety

function computePaceScore(m) {
  if (m.wordCount <= 0 || m.speechDurationSec <= 0) return null;
  return PACE_SCORE_BY_LABEL[m.paceLabel] ?? DEFAULT_PACE_SCORE;
}

function computeFillerScore(m) {
  if (m.wordCount <= 0) return null;
  const rate = m.fillerRate;
  if (rate <= FILLER_RATE_GOOD_PCT) return 100;
  if (rate >= FILLER_RATE_BAD_PCT) return FILLER_SCORE_MIN;
  const span = FILLER_RATE_BAD_PCT - FILLER_RATE_GOOD_PCT;
  return Math.round(100 - ((rate - FILLER_RATE_GOOD_PCT) / span) * (100 - FILLER_SCORE_MIN));
}

// Mirrors the sample-gating in summarizeVideoStats (lib/copilot/videoStats.js)
// exactly: tooDark/tooBright only mean something once MIN_LUMA_SAMPLES have
// been seen, veryStill/fidgety only once MIN_MOTION_SAMPLES have. A flag
// that's false because there wasn't enough data must never be scored as
// "measured and fine".
function computeVideoScore(video) {
  if (!video.hadVideo) return null;
  let score = 100;
  let measured = false;
  if (video.frames >= MIN_LUMA_SAMPLES) {
    measured = true;
    if (video.tooDark) score -= VIDEO_LIGHTING_PENALTY;
    if (video.tooBright) score -= VIDEO_LIGHTING_PENALTY;
  }
  if (video.motionSamples >= MIN_MOTION_SAMPLES) {
    measured = true;
    if (video.veryStill) score -= VIDEO_MOTION_PENALTY;
    if (video.fidgety) score -= VIDEO_MOTION_PENALTY;
  }
  return measured ? Math.max(0, score) : null;
}

// Returns null (not 0) when nothing about delivery was measurable at all —
// no speech AND no usable camera data. A component that was never assessed
// must not silently score as the worst possible outcome: the caller
// excludes a null delivery score from both the weighted composite and
// "weakest component" picking, rather than averaging in a zero (BUG-12).
function computeDeliveryScore(m) {
  const scores = [
    computePaceScore(m),
    computeFillerScore(m),
    computeVideoScore(m.video),
    // One of up to four equally-weighted delivery sub-scores, so it moves
    // the FINAL composite by only a few points at the extreme — see
    // computeBodyLanguageScore's own doc comment in critiqueBodyLanguage.js
    // for the exact math. Deliberate: a proxy measurement should nudge the
    // score, not dominate it.
    computeBodyLanguageScore(m.bodyLanguage),
  ].filter((s) => s !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

// Delivery notes grounded strictly in the C3 metrics. The video flags are
// already sample-gated upstream (see computeVideoScore's comment); the
// wording here never restates one as a measurement without checking the
// same sample counts, and never claims anything visual when the camera was
// off. Exported so the Gemini prompt (app/api/copilot/critique/route.js)
// can hand the model these SAME facts rather than asking it to re-derive
// them from raw numbers.
export function buildDeliveryNotes(m) {
  const notes = [];

  if (m.wordCount > 0 && m.speechDurationSec > 0) {
    notes.push(
      `You spoke for ${Math.round(m.speechDurationSec)} seconds at ${Math.round(m.wordsPerMinute)} words per minute (${m.paceLabel}).`,
    );
  } else if (m.wordCount > 0) {
    // A real transcript exists, but Deepgram never supplied usable word
    // timings for it — that's a measurement gap, not silence, and must not
    // be worded as if nothing was said (BUG-12).
    notes.push(
      `${m.wordCount} word${m.wordCount === 1 ? " was" : "s were"} captured, but there wasn't enough timing data to measure pace.`,
    );
  } else {
    notes.push("No speech was captured for this answer.");
  }

  if (m.fillerCount > 0) {
    notes.push(
      `${m.fillerCount} filler word${m.fillerCount === 1 ? "" : "s"} (${m.fillerRate.toFixed(1)}% of words) — mostly ${topPhrasesText(m.fillers)}.`,
    );
  } else if (m.wordCount > 0) {
    notes.push("No filler words were heard.");
  }

  const video = m.video;
  const hasEnoughLuma = video.hadVideo && video.frames >= MIN_LUMA_SAMPLES;
  const hasEnoughMotion = video.hadVideo && video.motionSamples >= MIN_MOTION_SAMPLES;
  if (!video.hadVideo) {
    notes.push("The camera was off for this answer, so there are no visual delivery notes.");
  } else if (!hasEnoughLuma && !hasEnoughMotion) {
    notes.push(
      video.partiallyOff
        ? "The camera was off for part of this answer — not enough on-camera data for lighting or steadiness notes."
        : "Not enough camera data was captured for lighting or steadiness notes.",
    );
  } else {
    // Only claim what was actually measured: lighting is only asserted
    // (dark/overexposed/fine) when luma had enough samples, motion only
    // (still/fidgety/steady) when motion did — never both from one, since
    // it's possible for only one of the two to have enough samples. The
    // old fallback ("Camera looked well lit and steady.") asserted BOTH
    // regardless of which was actually measured (BUG-12).
    const cameraNotes = [];
    if (hasEnoughLuma) {
      if (video.tooDark) cameraNotes.push("lighting looked dark");
      else if (video.tooBright) cameraNotes.push("lighting looked overexposed");
      else cameraNotes.push("lighting looked fine");
    }
    if (hasEnoughMotion) {
      if (video.veryStill) cameraNotes.push("very little movement in frame");
      else if (video.fidgety) cameraNotes.push("a lot of movement in frame");
      else cameraNotes.push("motion looked steady");
    }
    if (video.partiallyOff) cameraNotes.push("camera was off for part of this answer");
    notes.push(
      cameraNotes.length
        ? `Camera: ${cameraNotes.join("; ")}.`
        : "Not enough camera data was captured for lighting or steadiness notes.",
    );
  }

  if (m.micMuted) {
    notes.push("The mic was muted for part of this answer, so word count and pace may be understated.");
  }

  // BUG-1: reserve body language its own slot rather than letting it
  // compete with pace/filler/camera/mic for the same MAX_LIST cap — with
  // the mic muted, those four already fill every slot, and appending the
  // body-language note last meant `notes.slice(0, MAX_LIST)` silently threw
  // away a fully measured note (and the score it had already moved) every
  // time. When it exists, it always survives, even if that means trimming
  // an older note first.
  const bodyLanguageNote = bodyLanguageDeliveryNote(m.bodyLanguage);
  if (bodyLanguageNote) {
    return [...notes.slice(0, MAX_LIST - 1), bodyLanguageNote];
  }
  return notes.slice(0, MAX_LIST);
}

// --- Composite score --------------------------------------------------

// Named weights for the five rubric components above — they sum to 1.
// Structure carries the most weight (0.3): it's the strongest signal of
// whether the candidate actually answered with substance. Specificity,
// relevance, and delivery are tied at 0.2 each; length is the lightest
// signal (0.1) — a well-sized answer says little on its own about whether
// it was actually structured, specific, on-topic, or well delivered.
const WEIGHT_STRUCTURE = 0.3;
const WEIGHT_SPECIFICITY = 0.2;
const WEIGHT_RELEVANCE = 0.2;
const WEIGHT_LENGTH = 0.1;
const WEIGHT_DELIVERY = 0.2;

// --- Strengths / improvements / missing text ------------------------------

const STRENGTH_THRESHOLD = 75;
const IMPROVEMENT_THRESHOLD = 60;

function structureStrengthText(structure) {
  if (structure.kind === "behavioral") {
    const present = ["situation", "task", "action", "result"].filter((k) => structure.detail[k]);
    if (present.length === 4) {
      return "You covered situation, task, action, and result clearly — a complete STAR story.";
    }
    // This function is only called once the structure score clears
    // STRENGTH_THRESHOLD (>= 75%, i.e. at least 3 of 4 beats) — name
    // exactly what was covered rather than claiming completeness the
    // answer didn't earn. The same response's `missing` list names
    // whichever beat is absent, so this must not contradict it (BUG-8).
    return `You clearly covered ${present.join(", ")} — a strong start on a STAR story.`;
  }
  if (structure.kind === "technical") {
    const present = [];
    if (structure.detail.restatesProblem) present.push("restated the problem");
    if (structure.detail.namesApproach) present.push("named a concrete approach");
    if (structure.detail.acknowledgesTradeoff) present.push("called out a trade-off");
    return `You ${present.join(", ")}.`;
  }
  return "You opened with a clear claim and backed it with a specific example.";
}

function structureImprovementText(structure) {
  if (structure.kind === "behavioral") {
    const missing = ["situation", "task", "action", "result"].filter((k) => !structure.detail[k]);
    return `This behavioral answer is missing ${missing.join(" and ")} — a complete STAR story needs ${missing.length > 1 ? "all of them" : "it"}.`;
  }
  if (structure.kind === "technical") {
    const missing = [];
    if (!structure.detail.restatesProblem) missing.push("restate the problem");
    if (!structure.detail.namesApproach) missing.push("name a concrete approach");
    if (!structure.detail.acknowledgesTradeoff) missing.push("call out a trade-off");
    return `Strengthen the structure: ${missing.join(", ")}.`;
  }
  const missing = [];
  if (!structure.detail.claim) missing.push("open with a clear claim");
  if (!structure.detail.specific) missing.push("back it with a specific example or number");
  return `${capitalize(missing.join(" and "))}.`;
}

function structureMissingItems(structure) {
  if (structure.kind === "behavioral") {
    const labels = {
      situation: "a situation or context",
      task: "a clear task or goal",
      action: "the specific actions taken",
      result: "a measurable result",
    };
    return ["situation", "task", "action", "result"]
      .filter((k) => !structure.detail[k])
      .map((k) => `The question calls for a STAR answer, and this one never establishes ${labels[k]}.`);
  }
  if (structure.kind === "technical") {
    const items = [];
    if (!structure.detail.restatesProblem) items.push("The answer never restates the problem before diving in.");
    if (!structure.detail.namesApproach) items.push("No concrete approach is named.");
    if (!structure.detail.acknowledgesTradeoff) items.push("No trade-off is acknowledged.");
    return items;
  }
  const items = [];
  if (!structure.detail.claim) items.push("The answer never opens with a clear claim.");
  if (!structure.detail.specific) items.push("The claim is never backed with a specific example or number.");
  return items;
}

function specificityStrengthText({ hasMetric, properNounCount, overlapCount }) {
  const bits = [];
  if (hasMetric) bits.push("a quantified result");
  if (properNounCount > 0) bits.push(`${properNounCount} named detail${properNounCount === 1 ? "" : "s"}`);
  if (overlapCount > 0) bits.push(`${overlapCount} term${overlapCount === 1 ? "" : "s"} straight from the posting`);
  return `You grounded this in specifics: ${bits.join(", ")}.`;
}

function specificityImprovementText({ hasMetric, properNounCount }) {
  if (!hasMetric && properNounCount === 0) {
    return "Add a concrete number or name a specific tool, project, or company — right now this reads generically.";
  }
  if (!hasMetric) {
    return "Add a quantified result (a percentage, a dollar figure, a count) — specifics without a number are still vague.";
  }
  return "Name a specific tool, project, or company to back up the number you gave.";
}

function relevanceStrengthText({ overlapCount, qCount }) {
  return `You stayed on-topic — ${overlapCount}/${qCount} of the question's key terms showed up in your answer.`;
}

function relevanceImprovementText({ overlapCount, qCount }) {
  return `This answer drifts from what was actually asked — only ${overlapCount}/${qCount} of the question's key terms appear in it.`;
}

function lengthStrengthText(wordCount) {
  return `Length was well-calibrated at ${wordCount} words.`;
}

function lengthImprovementText(wordCount, { minWords, maxWords }) {
  if (wordCount < minWords) {
    return `At ${wordCount} words, this is short for the ${minWords}-${maxWords} word range interviewers expect — add more detail.`;
  }
  return `At ${wordCount} words, this runs long — aim for ${minWords}-${maxWords} words and trim the rest.`;
}

function postingMissingItems(posting, missingTerms) {
  if (!posting) return [];
  return missingTerms.slice(0, 2).map((term) => `The posting emphasizes "${term}" — this answer never brings it up.`);
}

// AC-G2-B-5: the selected interview type's own `expectations`
// (lib/copilot/interviewTypes.js) — cues a strong answer in THAT specific
// format should hit, on top of the rubric's own structure/posting checks
// above. Each cue maps to a detector this file already has; no new
// detection logic is introduced here, only the mapping. "general"'s
// expectations list is empty, so this appends nothing for a caller that
// never opts into a specific interview type — see AC-G2-B-7.
const EXPECTATION_DETECTORS = {
  "result-metric": (answer) => RESULT_METRIC_RE.test(answer),
  tradeoff: (answer) => TECH_TRADEOFF_RE.test(answer),
  approach: (answer) => TECH_APPROACH_RE.test(answer),
  "star-result": (answer) => hasResultCue(answer),
  "specific-example": (answer) => countProperNouns(answer) > 0,
};

function expectationMissingItems(descriptor, answer) {
  return descriptor.expectations
    .filter((expectation) => !EXPECTATION_DETECTORS[expectation.cue](answer))
    .map((expectation) => expectation.note);
}

// --- Verdict ---------------------------------------------------------------

const WEAKEST_HINT = {
  structure: "the structure is thin",
  specificity: "it stays generic instead of citing specifics",
  relevance: "it doesn't fully engage what was actually asked",
  length: "the length is off from what this kind of answer calls for",
  delivery: "the delivery — pace or filler words — needs attention",
};

function pickWeakest(components) {
  return components.reduce((min, c) => (c.score < min.score ? c : min));
}

// AC-G2-B-6: names the format being judged (e.g. "for a system design
// interview") so the user can see the standard that was applied — but only
// once there is a real score to attach it to (wordCount === 0 has nothing to
// evaluate, format or not) and never for "general", which stays worded
// exactly as before interview types existed (AC-G2-B-7).
function formatPhrase(descriptor) {
  return descriptor.value === DEFAULT_INTERVIEW_TYPE ? "" : ` for a ${descriptor.label.toLowerCase()} interview`;
}

function buildVerdict({ score, wordCount, weakestKey, descriptor }) {
  if (wordCount === 0) {
    return "No answer was captured for this question, so there is nothing to evaluate.";
  }
  const format = formatPhrase(descriptor);
  if (score >= 85) return `Strong answer at ${score}/100${format} — well structured, specific, and on point.`;
  if (score >= 70) return `Solid answer at ${score}/100${format}, though ${WEAKEST_HINT[weakestKey]}.`;
  if (score >= 50) return `This needs work${format} — ${score}/100, mainly because ${WEAKEST_HINT[weakestKey]}.`;
  return `This answer falls short at ${score}/100${format} — ${WEAKEST_HINT[weakestKey]}.`;
}

// --- Metrics normalization ---------------------------------------------

// The only paceLabel values computeAnswerMetrics ever actually produces —
// whitelisting against this (rather than accepting any string) closes off
// PACE_SCORE_BY_LABEL to anything else, including a prototype key like
// "constructor" that would otherwise resolve to a real (non-nullish) value
// on an ordinary object and produce a "NaN/100" verdict downstream (BUG-6).
const VALID_PACE_LABELS = new Set(["slow", "rushed", "conversational"]);

// Defensively normalizes whatever the caller handed in for `metrics` to the
// shape computeAnswerMetrics/summarizeVideoStats actually produce, so a
// missing or malformed field degrades to a safe zero/false rather than
// throwing or silently producing NaN in the score or the wording. Exported
// so the Gemini route (app/api/copilot/critique/route.js) can normalize the
// SAME client-supplied metrics before formatting them into its prompt.
export function normalizeMetrics(raw) {
  const m = raw && typeof raw === "object" ? raw : {};
  const video = m.video && typeof m.video === "object" ? m.video : {};
  return {
    wordCount: Number.isFinite(m.wordCount) ? m.wordCount : 0,
    durationSec: Number.isFinite(m.durationSec) ? m.durationSec : 0,
    speechDurationSec: Number.isFinite(m.speechDurationSec) ? m.speechDurationSec : 0,
    wordsPerMinute: Number.isFinite(m.wordsPerMinute) ? m.wordsPerMinute : 0,
    paceLabel: VALID_PACE_LABELS.has(m.paceLabel) ? m.paceLabel : "conversational",
    fillerCount: Number.isFinite(m.fillerCount) ? m.fillerCount : 0,
    fillerRate: Number.isFinite(m.fillerRate) ? m.fillerRate : 0,
    fillers: Array.isArray(m.fillers) ? m.fillers : [],
    hasMetric: !!m.hasMetric,
    micMuted: !!m.micMuted,
    video: {
      hadVideo: !!video.hadVideo,
      frames: Number.isFinite(video.frames) ? video.frames : 0,
      motionSamples: Number.isFinite(video.motionSamples) ? video.motionSamples : 0,
      tooDark: !!video.tooDark,
      tooBright: !!video.tooBright,
      veryStill: !!video.veryStill,
      fidgety: !!video.fidgety,
      partiallyOff: !!video.partiallyOff,
    },
    // D3: metrics.bodyLanguage rides alongside metrics.video the same way it
    // already reaches the client (usePracticeAnswer's doneAnswer sets it
    // directly on the metrics object it hands to the critique request) —
    // this is what actually threads it into the rubric/Gemini-facts below,
    // since neither read raw client input directly.
    bodyLanguage: normalizeBodyLanguage(m.bodyLanguage),
  };
}

// --- Main entry point --------------------------------------------------

// Judges one completed practice answer's substance and returns the
// AC-C4-1 contract: { score, verdict, strengths, improvements, missing,
// star, delivery, source: "embedded" }. `metrics` is the C3
// computeAnswerMetrics output for this same answer — see
// lib/copilot/answerMetrics.js and lib/copilot/videoStats.js for the exact
// shape. An empty or whitespace-only answer never throws: it returns a low
// score, an honest verdict that nothing was captured, no strengths, and
// improvements that say plainly that nothing was recorded rather than
// critiquing the style of prose that doesn't exist.
//
// G2: `interviewType` is the practice session's selected format (an
// untrusted value from lib/copilot/interviewTypes.js's vocabulary, or
// anything else — resolveInterviewType normalizes it, defaulting to
// "general"). It governs the ideal length band (AC-G2-B-4), extra
// format-specific expectations appended to `missing` (AC-G2-B-5), and the
// format name in the verdict (AC-G2-B-6). Omitted or "general" reproduces
// today's exact output, unchanged (AC-G2-B-7) — it is a distinct concept
// from `type` (the QUESTION's classification: behavioral/technical/general),
// which alone still gates `star` (AC-G2-B-8).
export function critiqueAnswerLocal({
  question = "",
  type = "general",
  answer = "",
  posting = null,
  profile = "",
  metrics = null,
  interviewType,
} = {}) {
  // `profile` isn't used by the rubric today — the candidate's background
  // doesn't change how THIS answer is judged the way it changes what
  // talking points draftAnswerLocal proposes — but it's accepted (and
  // ignored) so the call signature matches the Gemini path's, which DOES
  // use it to judge whether the answer draws on real experience.
  void profile;

  const t = VALID_TYPES.includes(type) ? type : "general";
  const descriptor = resolveInterviewType(interviewType);
  const cleanAnswer = String(answer || "").trim();
  const m = normalizeMetrics(metrics);

  const wordCount = countWords(cleanAnswer);
  const properNounCount = countProperNouns(cleanAnswer);
  const postingTerms = postingKeyTerms(posting).filter((term) => term.length >= MIN_POSTING_TERM_LENGTH);
  const overlapTerms = postingTerms.filter((term) => containsTerm(cleanAnswer, term));
  const missingPostingTerms = postingTerms.filter((term) => !containsTerm(cleanAnswer, term));

  const structure = computeStructure({ type: t, answer: cleanAnswer, hasMetric: m.hasMetric, properNounCount });
  const specificityScore = computeSpecificity({
    hasMetric: m.hasMetric,
    properNounCount,
    overlapCount: overlapTerms.length,
  });
  const relevance = computeRelevance(question, cleanAnswer);
  const lengthScore = computeLengthScore(wordCount, descriptor.lengthTarget);
  const deliveryScore = computeDeliveryScore(m); // number | null — see its own comment

  // Weighted composite: when delivery is genuinely unmeasurable (null), it
  // is dropped from the sum entirely and the remaining weights are
  // renormalized (divided by their own total) so they still span 0-100 —
  // see computeDeliveryScore's comment and BUG-12.
  const scoredComponents = [
    { key: "structure", score: structure.score, weight: WEIGHT_STRUCTURE },
    { key: "specificity", score: specificityScore, weight: WEIGHT_SPECIFICITY },
    { key: "relevance", score: relevance.score, weight: WEIGHT_RELEVANCE },
    { key: "length", score: lengthScore, weight: WEIGHT_LENGTH },
  ];
  if (deliveryScore !== null) {
    scoredComponents.push({ key: "delivery", score: deliveryScore, weight: WEIGHT_DELIVERY });
  }
  const totalWeight = scoredComponents.reduce((sum, c) => sum + c.weight, 0);
  const weighted = scoredComponents.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight;
  const score = Math.round(clamp(weighted, 0, 100));

  // Delivery is intentionally excluded from strengths/improvements below —
  // it already has its own dedicated `delivery` field, and repeating the
  // same fact there as a strength/improvement bullet would just say it
  // twice.
  const contentComponents = [
    { key: "structure", score: structure.score },
    { key: "specificity", score: specificityScore },
    { key: "relevance", score: relevance.score },
    { key: "length", score: lengthScore },
  ];

  const strengths = [];
  for (const c of [...contentComponents].sort((a, b) => b.score - a.score)) {
    if (c.score < STRENGTH_THRESHOLD) continue;
    if (c.key === "structure") strengths.push(structureStrengthText(structure));
    else if (c.key === "specificity") {
      strengths.push(
        specificityStrengthText({ hasMetric: m.hasMetric, properNounCount, overlapCount: overlapTerms.length }),
      );
    } else if (c.key === "relevance" && relevance.qCount > 0) strengths.push(relevanceStrengthText(relevance));
    else if (c.key === "length") strengths.push(lengthStrengthText(wordCount));
    if (strengths.length >= MAX_LIST) break;
  }

  const improvements = [];
  for (const c of [...contentComponents].sort((a, b) => a.score - b.score)) {
    if (c.score >= IMPROVEMENT_THRESHOLD) continue;
    if (c.key === "structure") improvements.push(structureImprovementText(structure));
    else if (c.key === "specificity") {
      improvements.push(specificityImprovementText({ hasMetric: m.hasMetric, properNounCount }));
    } else if (c.key === "relevance" && relevance.qCount > 0) improvements.push(relevanceImprovementText(relevance));
    else if (c.key === "length" && wordCount > 0) improvements.push(lengthImprovementText(wordCount, descriptor.lengthTarget));
    if (improvements.length >= MAX_LIST) break;
  }

  // AC-G2-B-5: type-specific expectation notes are appended AFTER whatever
  // the rubric already produced (structure gaps, then posting-vocabulary
  // gaps), and the existing MAX_LIST cap still applies to the combined list.
  const missing = [
    ...structureMissingItems(structure),
    ...postingMissingItems(posting, missingPostingTerms),
    ...expectationMissingItems(descriptor, cleanAnswer),
  ].slice(0, MAX_LIST);

  const delivery = buildDeliveryNotes(m);

  // A null delivery score (nothing measurable) is excluded here too — it
  // must never be picked as the "weakest" component and blamed in the
  // verdict when it was never assessed in the first place (BUG-12).
  const weakestCandidates =
    deliveryScore === null ? contentComponents : [...contentComponents, { key: "delivery", score: deliveryScore }];
  const weakest = pickWeakest(weakestCandidates);
  const verdict = buildVerdict({ score, wordCount, weakestKey: weakest.key, descriptor });

  return {
    score,
    verdict,
    // No speech at all: nothing was said, so nothing was earned — the
    // caller must see empty strengths rather than praise for silence, even
    // though the loop above would otherwise still be able to credit a
    // camera that happened to look fine.
    strengths: wordCount === 0 ? [] : strengths.slice(0, MAX_LIST),
    // Likewise, an empty answer's improvements must say plainly that
    // nothing was captured rather than critiquing the style/relevance of
    // prose that was never actually said (BUG-12).
    improvements:
      wordCount === 0
        ? ["No speech was captured for this answer — there is nothing to improve on until you record one."]
        : improvements.slice(0, MAX_LIST),
    missing,
    star: structure.star,
    delivery,
    source: "embedded",
  };
}
