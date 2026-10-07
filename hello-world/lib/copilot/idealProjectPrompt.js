// AC-N3: the worked example stops being picked from seven hand-authored
// archetypes (idealProjectNarrative.js) and is written fresh, per question,
// by the model — grounded in the actual posting instead of a stock story.
// Reported failure: "the example projects are always this shit", the same
// product story pasted back across twenty practice questions run against one
// posting. Seven templates cannot not repeat; a generator that reads the
// posting can.
//
// This module owns the two halves of that: the prompt asking the model for
// the example (`buildIdealProjectPrompt`), and the gate deciding whether its
// answer is safe to show (`normalizeIdealProject`). idealProjectNarrative.js
// — the deterministic archetype table — is untouched and stays the FALLBACK;
// the caller (app/api/copilot/answer/route.js) only ever shows what comes
// out of `normalizeIdealProject`, and falls back to the deterministic
// archetype for everything else, including a validation reject.
//
// THE SAFETY STORY MOVED, AND GOT STRICTER. R-130/R-135/R-138 kept this
// block honest by construction: idealProjectNarrative.js's every figure is a
// hand-authored constant, and `buildProject` never receives the posting text
// at all — so a posting's own salary band, headcount or experience floor
// could not reach `project` even by accident. That argument was STRUCTURAL,
// not enforced by a check, and it does not survive this change: a model that
// writes the example FROM the posting has the posting in its context, which
// is the one thing the old guarantee depended on being absent. So the
// guarantee moves from the generator to `normalizeIdealProject` below, and
// gets stricter to compensate — see that function's own comment for the
// rule that replaces it.

import {
  MAX_BODY_WORDS,
  MAX_TOTAL_WORDS,
  MIN_BODY_WORDS,
  SECTION_LABELS,
} from "./idealProjectNarrative.js";

// Mirrors the 20000-character posting cap lib/copilot/answerContext.js applies
// when it loads a posting for the answer route (that module's own private
// MAX_POSTING_CHARS; the route defines no such constant). Restated here rather
// than imported — it is not exported, and a lib module importing from a route
// file would run the wrong direction in any case — so this module is safe to
// call with an uncapped description on its own, not only from behind that cap.
const MAX_POSTING_CHARS = 20000;

// Sits beside POINTS_SYSTEM/ANSWER_SYSTEM in the route, so it gets the same
// treatment: a short statement of WHAT this call is for, with every hard
// constraint (shape, invented figures, third person) carried by the prompt
// itself rather than assumed here.
export const IDEAL_PROJECT_SYSTEM = [
  "You write a single hypothetical BENCHMARK project for an interview-prep tool — a worked example of what a strong candidate for a role might describe, never a real project and never the reader's own.",
  "Return ONLY the JSON object requested — no prose outside it, no markdown code fences.",
  "Every figure you write is invented: realistic-sounding and internally consistent with the story, never copied from anything stated in the job posting you are given.",
].join(" ");

// `question` only nudges which KIND of project the example is about — the
// posting still supplies the setting, capability and methodology, exactly
// the way idealProjectNarrative.js's own slots do. An empty question must
// not break the prompt, since live mode's very first question has no prior
// context to bias toward.
function questionBiasLine(question) {
  const q = String(question || "").trim();
  if (!q) return "No specific interview question is driving the choice — pick whatever project shape best fits the posting below.";
  return `The candidate was just asked: "${q}" — let that bias which KIND of project the example is about, without inventing anything the posting itself does not support.`;
}

// Returns "" for a missing/blank posting (never throws — a caller with
// nothing to ground the example in should get nothing to send the model,
// the same "no posting selected -> no block" contract idealProject.js's own
// null return follows) and never throws on missing arguments at all, so a
// caller can wire this in without a defensive guard of its own.
export function buildIdealProjectPrompt({ description, question } = {}) {
  const posting = String(description || "").trim().slice(0, MAX_POSTING_CHARS);
  if (!posting) return "";

  const shapeLine = SECTION_LABELS.map((label) => `"${label}"`).join(", ");

  return [
    "You are writing a BENCHMARK worked example for a candidate preparing to interview for the job posting below: a hypothetical project a strong candidate for THIS role might describe, invented for the purpose — not a real project, and not the candidate's own.",
    "",
    "--- JOB POSTING ---",
    posting,
    "--- END JOB POSTING ---",
    "",
    questionBiasLine(question),
    "",
    'Return ONLY JSON of this exact shape: { "title": string, "sections": [ { "label": string, "body": string }, ... ], "outcomes": [ { "metric": string, "figure": string }, ... ] }',
    `"sections" must have exactly 4 entries, labelled in this exact order: ${shapeLine}. "${SECTION_LABELS[0]}" is what was broken before the project, "${SECTION_LABELS[1]}" is what the project built, "${SECTION_LABELS[2]}" is how the work actually ran, "${SECTION_LABELS[3]}" is the measured outcome.`,
    `Each section's "body" is one skimmable sentence, ${MIN_BODY_WORDS}-${MAX_BODY_WORDS} words. The title plus all four bodies together must total no more than ${MAX_TOTAL_WORDS} words — this has to be read in one glance, mid-interview.`,
    '"outcomes" must have exactly 3 entries. Each "metric" names a CATEGORY of number with no digit in it at all (for example "adoption rate"). Each "figure" is a specific number for that category (for example "34% -> 71% of teachers active weekly").',
    'Write every word in third person. Never use "I", "my", "we" or "our" anywhere in the response — this describes a hypothetical project, not something the reader did.',
    "Never reuse a number that appears anywhere in the job posting above — not its salary or compensation band, not a years-of-experience requirement, not a headcount, not a campus or site count, not any other figure it states. Every number in your response must be invented: realistic and internally consistent with the story you are telling, but never copied or derived from a number the posting itself contains.",
  ].join("\n");
}

// Third-person guard, split the way idealProjectNarrative.test.js's own
// equivalent check is (capital-only "I", case-insensitive "my"/"we"/"our"):
// a stray lowercase "i" is common English and must not trip this, but the
// capitalized pronoun always means the same thing it means in the archetype
// copy this stands beside.
const FIRST_PERSON_PATTERNS = [/\bI\b/, /\bmy\b/i, /\bwe\b/i, /\bour\b/i];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Leftover template tokens and stringified junk a model can hand back when
// its own JSON generation half-fails — none of it is safe to render as a
// benchmark a candidate reads mid-question.
function hasLeftoverJunk(text) {
  return /[{}]/.test(text) || /undefined/i.test(text) || /\[object/i.test(text);
}

// Every digit RUN in `text`, thousands-separators stripped so "78,496",
// "78 496" and "78.496" all compare equal — three forms a real posting (or a
// model echoing one back) actually used for the same figure: comma, a space,
// and a period used the European way. A comma is always a separator, the way
// it always was; a space or a period only counts as ONE when it is followed
// by exactly three digits and not a fourth — that is a thousands GROUP, and
// checking for exactly three digits (via the `(?!\d)` lookahead) is what
// keeps a decimal like "4.1" from collapsing into "41": there is one digit
// after its period, not three, so it never enters the grouped alternative at
// all and survives as the separate runs "4" and "1". "$105.974" and "78 496"
// do have exactly three digits after their separator, so they group the same
// way "78,496" does. The plain `\d+` alternative is the fallback for
// everything else — a lone "12" in "12 campuses", "9" in "9 weeks" — so
// matching still stops there and doesn't reach into the following word.
// OUT OF SCOPE: numbers spelled out as words ("twelve campuses") — a
// digit-run rule has no way to see them, and no amount of separator-handling
// changes that; it was considered and deliberately left unhandled.
function digitRuns(text) {
  const matches = String(text).match(/\d{1,3}(?:[,.\s]\d{3}(?!\d))+|\d+/g) || [];
  return matches.map((run) => run.replace(/[,.\s]/g, ""));
}

// N125: which of the POSTING's digit runs are compensation-shaped, as the
// normalized runs digitRuns would report them. The posting's own numbers are
// no longer all off-limits (see normalizeIdealProject's header) — only the ones
// that read as pay. Four signals, any one of which marks a run:
//   - a currency sign ($/€/£) immediately before it ("$78,496", "$ 42");
//   - a rate unit immediately after it ("/hr", "/yr", "per hour", "per year",
//     "/week", "/month" — and their short forms);
//   - a pay word ANYWHERE in the run's own SENTENCE (see sentenceSpans), however
//     many words separate them — "The annual salary for this position, after a
//     probation period, is 95000 flat." carries no currency sign and no rate
//     unit, and its pay word is further from the number than any fixed window;
//   - a pay word within COMP_WINDOW characters on either side, kept as an
//     independent catch for a pay word just across a sentence or line break
//     ("Salary:\n95000"), which the sentence scope alone would split apart.
// The sentence scope replaced a window-only pay-word test that leaked exactly
// that shape (R-135's harm: the posting's real pay reaching the screen as a
// project metric). Over-rejecting a benign number that merely shares a sentence
// with a pay word is the accepted cost — it forces the deterministic fallback,
// never a leak. A bare trailing "k" is deliberately NOT a signal: "5k users" is
// a count, and "$5k" is already caught by the currency sign. Same number
// grammar as digitRuns above (this one only adds POSITIONS, so adjacency can be
// tested); the run is then normalized the same way, separators stripped.
const NUMBER_RUN_RE = /\d{1,3}(?:[,.\s]\d{3}(?!\d))+|\d+/g;
const COMP_WINDOW = 16;
const CURRENCY_BEFORE = /[$€£]\s?$/;
const RATE_UNIT_AFTER = /^\s?(?:\/|per\s)\s?(?:hr|hour|yr|year|annum|wk|week|mo|month)\b/i;
const COMP_WORD =
  /\b(?:salary|salaries|salaried|compensation|compensated|compensate|comps?|stipends?|bonus|bonuses|wages?|hourly|annually|annum|remuneration|pay|pays|paid|paying|payscale|paycheck|earn|earns|earning|earnings|income|ote)\b/i;

// A sentence ends at a newline, or at a run of . ! ? that is followed by
// whitespace and a capital letter (or by the end of the text). Requiring the
// space-then-capital is what keeps a thousands/decimal point ("$78,496.00",
// "99.95%") from ending one, and every way of being WRONG here only MERGES two
// sentences (a terminator followed by a quote, a digit or a lowercase word is
// not a break) — a merge can only mark more numbers as pay, never fewer, which
// is the safe direction for this guard.
const SENTENCE_END_RE = /\n|[.!?]+(?=\s+[A-Z]|\s*$)/g;
// A period after fewer letters than this is read as an abbreviation ("Sr.",
// "Dr.", "e.g.", "Inc.") and does not end the sentence — otherwise "The salary
// for Sr. Engineers is 95000" would split its pay word away from its number.
// Short real sentence endings ("...built in AI.") merge with the next sentence,
// which is the safe direction again.
const MIN_SENTENCE_WORD_LETTERS = 4;

function endsOnAbbreviation(text, index) {
  if (text[index] !== ".") return false;
  let i = index;
  while (i > 0 && /[A-Za-z]/.test(text[i - 1])) i -= 1;
  const letters = index - i;
  return letters > 0 && letters < MIN_SENTENCE_WORD_LETTERS;
}

// [start, end) of every sentence in `text`, in order and covering all of it
// (a terminator belongs to the sentence it closes).
function sentenceSpans(text) {
  const spans = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END_RE)) {
    if (endsOnAbbreviation(text, match.index)) continue;
    spans.push([start, match.index]);
    start = match.index + match[0].length;
  }
  spans.push([start, text.length]);
  return spans;
}

function compensationShapedNumbers(description) {
  const text = String(description || "");
  const spans = sentenceSpans(text);
  const spanHasPayWord = spans.map(([from, to]) => COMP_WORD.test(text.slice(from, to)));
  const out = [];
  let span = 0;
  for (const match of text.matchAll(NUMBER_RUN_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    // Matches arrive in text order, so the sentence pointer only moves forward.
    while (span < spans.length - 1 && start >= spans[span + 1][0]) span += 1;
    const before = text.slice(Math.max(0, start - COMP_WINDOW), start);
    const after = text.slice(end, end + COMP_WINDOW);
    const compShaped =
      CURRENCY_BEFORE.test(before) ||
      RATE_UNIT_AFTER.test(after) ||
      spanHasPayWord[span] ||
      COMP_WORD.test(before) ||
      COMP_WORD.test(after);
    if (compShaped) out.push(match[0].replace(/[,.\s]/g, ""));
  }
  return out;
}

// Vouches for a model's JSON response, or returns null. Never repairs and
// never partially accepts: a half-valid example would still render as a
// benchmark, still be labelled as one, and nothing downstream would know it
// had been patched — so any single failure rejects the whole thing and the
// caller falls back to the deterministic archetype instead.
//
// THE RULE THAT REPLACES THE OLD STRUCTURAL GUARANTEE. Every fabricated
// figure in idealProjectNarrative.js was safe because that module never saw
// the posting — there was nothing for a salary band to be copied FROM. A
// model that reads the posting has neither property, and R-135's exact
// failure (a posting's own salary band, echoed back as if it were a project
// metric) is now the model's most likely mistake rather than a structurally
// impossible one, because the posting IS sitting in its context. Every digit
// run the example contains (title, section bodies, outcome figures) is
// extracted, and the example is rejected if ANY of them equals a posting
// number that is COMPENSATION-SHAPED (see compensationShapedNumbers above):
// adjacent to a currency sign or a rate unit, or in a sentence with (or right
// beside) a pay word. That catches the salary band, an hourly rate, a stipend
// and a signing bonus at any magnitude — the exact harm R-135 named.
//
// N125 (owner ruling) narrowed this from "any whole number the posting
// states". The old blunt rule also rejected a headcount ("a team of 8"), an
// experience floor ("5+ years") and a reliability target ("99.95%") that the
// example had every right to reuse, and with a posting full of such figures it
// pushed nearly every generated example back to the deterministic fallback. An
// incidental non-comp integer is not pay and is no longer rejected.
export function normalizeIdealProject(parsed, { description } = {}) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const { title, sections, outcomes } = parsed;
  if (!isNonEmptyString(title)) return null;
  if (!Array.isArray(sections) || sections.length !== SECTION_LABELS.length) return null;
  if (!Array.isArray(outcomes) || outcomes.length !== 3) return null;

  for (let i = 0; i < SECTION_LABELS.length; i += 1) {
    const section = sections[i];
    if (!section || typeof section !== "object") return null;
    // Exact label, exact order — "whatever the model called them" is not
    // good enough, because the caller renders these labels directly and a
    // renamed or reordered set is not the shape idealProjectNarrative.test.js
    // already holds the templated example to.
    if (section.label !== SECTION_LABELS[i]) return null;
    if (!isNonEmptyString(section.body)) return null;
  }
  for (const outcome of outcomes) {
    if (!outcome || typeof outcome !== "object") return null;
    if (!isNonEmptyString(outcome.metric)) return null;
    if (!isNonEmptyString(outcome.figure)) return null;
  }

  // Same length bounds the templated archetypes are held to, imported
  // rather than restated (see idealProjectNarrative.js's own export
  // comment), so a generated example and a templated one can never drift
  // into being different shapes of thing.
  let totalWords = wordCount(title);
  for (const section of sections) {
    const words = wordCount(section.body);
    if (words < MIN_BODY_WORDS || words > MAX_BODY_WORDS) return null;
    totalWords += words;
  }
  if (totalWords > MAX_TOTAL_WORDS) return null;

  // Every string the response carries, for the checks that scan the whole
  // thing rather than one field at a time.
  const allText = [title, ...sections.map((s) => s.body), ...outcomes.map((o) => `${o.metric} ${o.figure}`)];
  for (const text of allText) {
    if (FIRST_PERSON_PATTERNS.some((re) => re.test(text))) return null;
    if (hasLeftoverJunk(text)) return null;
  }

  for (const outcome of outcomes) {
    if (/\d/.test(outcome.metric)) return null;
    if (!/\d/.test(outcome.figure)) return null;
  }

  // The posting's own COMPENSATION-SHAPED numbers can never come back — see
  // this function's header comment for the rule and why it is not every digit
  // run the posting contains.
  const postingNumbers = new Set(compensationShapedNumbers(description));
  const exampleNumbers = digitRuns(allText.join(" "));
  if (exampleNumbers.some((n) => postingNumbers.has(n))) return null;

  // Built fresh rather than returned by reference into `parsed` — this
  // function is PURE, so a caller that goes on to mutate what it gets back
  // (or holds onto `parsed` itself) can never corrupt the other's view of
  // the same response.
  return {
    title,
    sections: sections.map((section, i) => ({ label: SECTION_LABELS[i], body: section.body })),
    outcomes: outcomes.map((outcome) => ({ metric: outcome.metric, figure: outcome.figure })),
  };
}
